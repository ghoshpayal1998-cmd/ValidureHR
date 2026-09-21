/*
 * S-1 — token forgery.
 *
 * The original audit proved a token signed with the public compose default was
 * accepted by a platform-admin-only endpoint, returning the real company list
 * with no password involved. These tests assert that a token signed with
 * anything other than the configured secret is rejected, and that the published
 * secrets in particular are worthless to an attacker.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const path = require('path');

const { fakeDb } = require('../helpers/testEnv');
const { buildApp, adminToken, forgedToken, COMPANY } = require('../helpers/testApp');
const { PUBLISHED_SECRETS } = require(path.join(__dirname, '..', '..', 'src', 'config'));

const app = buildApp();

test.beforeEach(() => {
  fakeDb.reset();
  fakeDb.on(/FROM companies/, [COMPANY]);
});

test('a request with no token is rejected', async () => {
  const res = await request(app).get('/api/companies');
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Authentication required');
});

test('a token signed with the OLD public compose default is rejected', async () => {
  // This is the exact attack the audit demonstrated: forge {adm:true} with the
  // secret published in docker-compose.yml and read every tenant's data.
  const token = forgedToken('validurehr-change-this-secret-to-a-long-random-string');
  const res = await request(app).get('/api/companies').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Invalid or expired session');
});

test('a token signed with the old hardcoded middleware fallback is rejected', async () => {
  const token = forgedToken('validurehr-dev-secret-change-in-production');
  const res = await request(app).get('/api/companies').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 401);
});

test('no published secret can mint a working admin token', async () => {
  for (const secret of PUBLISHED_SECRETS) {
    const token = forgedToken(secret);
    const res = await request(app).get('/api/companies').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401, `secret "${secret}" produced a ${res.status}`);
  }
});

test('a token with a tampered payload fails signature verification', async () => {
  // Flip an employee token into an admin one by editing the payload segment.
  const real = jwt.sign({ id: 10, username: 'FTRN020', companyId: 1, slug: 'ftr', employeeId: 5, role: 'EMPLOYEE' },
    require('../helpers/testApp').JWT_SECRET);
  const [header, , signature] = real.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ adm: true, id: 1, username: 'admin' }))
    .toString('base64url');
  const res = await request(app)
    .get('/api/companies')
    .set('Authorization', `Bearer ${header}.${forgedPayload}.${signature}`);
  assert.equal(res.status, 401);
});

test('an alg=none token is rejected', async () => {
  // The classic JWT downgrade: strip the signature and claim no algorithm.
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ adm: true, id: 1, username: 'admin' })).toString('base64url');
  const res = await request(app)
    .get('/api/companies')
    .set('Authorization', `Bearer ${header}.${payload}.`);
  assert.equal(res.status, 401);
});

test('an expired token is rejected', async () => {
  const token = jwt.sign({ adm: true, id: 1, username: 'admin' },
    require('../helpers/testApp').JWT_SECRET, { expiresIn: '-1s' });
  const res = await request(app).get('/api/companies').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Invalid or expired session');
});

test('a malformed Authorization header is rejected', async () => {
  for (const header of ['Bearer', 'Bearer ', 'Basic abc', 'garbage', 'Bearer a.b.c']) {
    const res = await request(app).get('/api/companies').set('Authorization', header);
    assert.equal(res.status, 401, `header "${header}" produced a ${res.status}`);
  }
});

test('a correctly signed admin token IS accepted — the tests above are not passing by accident', async () => {
  const res = await request(app).get('/api/companies').set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(res.status, 200);
});
