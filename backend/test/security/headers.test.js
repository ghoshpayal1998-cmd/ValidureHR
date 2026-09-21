/*
 * S-8 — no helmet, no CSP, no HSTS anywhere in the API.
 * S-6 (serving half) — user-uploaded files were sent with
 * `Content-Disposition: inline`, so an uploaded .html rendered as a page in the
 * API's origin. In single-tunnel mode that origin is the portal's.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildApp } = require('../helpers/testApp');
const { sendUserFile } = require(path.join(__dirname, '..', '..', 'src', 'storage'));

const app = buildApp();

test('responses carry a Content-Security-Policy', async () => {
  const res = await request(app).get('/api/health');
  assert.ok(res.headers['content-security-policy'], 'CSP header missing');
});

test('the CSP denies everything by default', async () => {
  // This service returns JSON and file downloads; it renders no pages of its
  // own, so the correct policy is the maximally restrictive one.
  const res = await request(app).get('/api/health');
  const csp = res.headers['content-security-policy'];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/, 'clickjacking protection missing');
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
});

test('the CSP allows no script sources', async () => {
  const res = await request(app).get('/api/health');
  const csp = res.headers['content-security-policy'];
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('HSTS is set', async () => {
  const res = await request(app).get('/api/health');
  const hsts = res.headers['strict-transport-security'];
  assert.ok(hsts, 'HSTS header missing');
  assert.match(hsts, /max-age=\d+/);
  const maxAge = Number(hsts.match(/max-age=(\d+)/)[1]);
  assert.ok(maxAge >= 15552000, `max-age ${maxAge} is under the recommended 180 days`);
});

test('MIME sniffing is disabled', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('framing is denied', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
});

test('the referrer is not leaked', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('the server banner is not advertised', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.headers['x-powered-by'], undefined, 'Express should not announce itself');
});

test('an unknown API path is a clean 404, not a stack trace', async () => {
  const res = await request(app).get('/api/definitely-not-a-route');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'Endpoint not found' });
});

/* ---- S-6: how user-uploaded bytes come back out ---- */

/*
 * sendUserFile now takes an OBJECT KEY ("<slug>/<kind>/<file>") rather than an
 * absolute path, so that the same call works against local disk and against a
 * Supabase bucket. Files are staged through the active driver, which also
 * exercises the real write path.
 */
const { driver } = require(path.join(__dirname, '..', '..', 'src', 'storage'));

async function stage(kind, name, contents, contentType) {
  const key = `ftr/${kind}/${name}`;
  await driver.put(key, Buffer.from(contents), contentType);
  return key;
}

test('sendUserFile forces a download rather than rendering the file', async () => {
  const key = await stage('leave-docs', 'payload.html', '<script>alert(document.domain)</script>', 'text/html');

  const fileApp = express();
  fileApp.get('/file', (req, res) => sendUserFile(res, key, 'payload.html'));

  const res = await request(fileApp).get('/file');
  assert.equal(res.status, 200);
  // inline would render it in this origin — the whole point of the finding.
  assert.match(res.headers['content-disposition'], /^attachment/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('sendUserFile never echoes a renderable Content-Type', async () => {
  // Even for a file stored with an HTML content type, the response type is
  // derived from the validated extension — never from what was uploaded.
  const key = await stage('leave-docs', 'payload2.html', '<script>alert(1)</script>', 'text/html');

  const fileApp = express();
  fileApp.get('/file', (req, res) => sendUserFile(res, key, 'payload2.html'));

  const res = await request(fileApp).get('/file');
  assert.doesNotMatch(res.headers['content-type'] || '', /text\/html/);
});

test('sendUserFile 404s for a key that is not in storage', async () => {
  const fileApp = express();
  fileApp.get('/file', (req, res) => sendUserFile(res, 'ftr/slips/does-not-exist.pdf', 'x.pdf'));

  const res = await request(fileApp).get('/file');
  assert.equal(res.status, 404);
  assert.match(res.body.error, /File missing on server/);
});

test('sendUserFile sanitises the download filename', async () => {
  const key = await stage('slips', 'doc.pdf', '%PDF-1.4', 'application/pdf');

  const fileApp = express();
  // A title carrying a quote would otherwise break out of the header value and
  // let the caller inject a second header directive.
  fileApp.get('/file', (req, res) => sendUserFile(res, key, 'evil"; download="x.html'));

  const res = await request(fileApp).get('/file');
  const disposition = res.headers['content-disposition'];
  assert.match(disposition, /^attachment/);
  assert.equal((disposition.match(/"/g) || []).length, 2, 'exactly one quoted filename');
});

test('a stored file name cannot traverse out of its company prefix', async () => {
  // objectKey() runs basename() on the stored name, so a database row holding
  // "../../other-tenant/slips/x.pdf" still resolves inside this company.
  const { objectKey } = require(path.join(__dirname, '..', '..', 'src', 'storage'));
  assert.equal(objectKey('ftr', 'slips', '../../etc/passwd'), 'ftr/slips/passwd');
  assert.equal(objectKey('ftr', 'slips', '/etc/passwd'), 'ftr/slips/passwd');
  assert.throws(() => objectKey('../oth', 'slips', 'x.pdf'), /Invalid company slug/);
  assert.throws(() => objectKey('ftr', 'wat', 'x.pdf'), /Invalid storage kind/);
});
