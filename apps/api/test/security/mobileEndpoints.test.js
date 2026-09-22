/*
 * M-1 — the mobile app was written against an API that never matched the real
 * backend: roughly nine endpoints did not exist, so the Attendance, Leaves,
 * Profile and admin-stats screens 404'd. Worse, several failures rendered as
 * plausible data rather than as errors (M-5).
 *
 * This test extracts every path the mobile app calls and checks it against the
 * routes Express has actually registered. It is the regression guard the
 * project did not have: nothing else connects the two halves.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildApp } = require('../helpers/testApp');

/* Four levels: test/security -> test -> api -> apps -> repo root. */
const MOBILE_JS = path.join(__dirname, '..', '..', '..', '..', 'mobile', 'www', 'js');

/* ValidureHR has no mobile client yet. These tests guard the contract
 * between the mobile app and this API, so they are kept intact and skip
 * until a mobile app exists rather than being deleted - the day one is
 * added, the guard comes back on by itself. */
const MOBILE_ABSENT = !fs.existsSync(MOBILE_JS) && 'no mobile client in this project yet';


/** Every registered route, as { method, regexp } drawn from the Express router stack. */
function registeredRoutes(app) {
  const routes = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
        // A router's own '/' route becomes '/api/companies/' when concatenated;
        // the clients call '/api/companies'. Drop the trailing slash so the two
        // spellings compare equal.
        const full = (prefix + layer.route.path).replace(/\/+$/, '') || '/';
        routes.push({ methods, path: full });
      } else if (layer.name === 'router' && layer.handle?.stack) {
        // Recover the mount path from the layer's regexp.
        const source = layer.regexp.source
          .replace('^\\/', '/')
          .replace('\\/?(?=\\/|$)', '')
          .replace(/\\\//g, '/')
          .replace(/\$$/, '');
        walk(layer.handle.stack, prefix + (source === '/^/?(?=/|$)' ? '' : source));
      }
    }
  };
  walk(app._router ? app._router.stack : app.router.stack, '');
  return routes;
}

/** Turns '/api/leaves/:id/approve' into a RegExp that matches a concrete path. */
function routeMatcher(routePath) {
  const pattern = routePath
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z_]\w*/g, '[^/]+');
  return new RegExp(`^${pattern}$`);
}

/**
 * Extracts API calls from the mobile source: ApiClient.api('/path', { method })
 * and ApiClient.downloadFile('/path'). Template literals have their ${...}
 * segments replaced with a placeholder id.
 */
function mobileApiCalls() {
  const calls = [];
  const files = [
    'api.js', 'app.js',
    ...fs.readdirSync(path.join(MOBILE_JS, 'pages')).filter((f) => f.endsWith('.js')).map((f) => `pages/${f}`),
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(MOBILE_JS, file), 'utf8');

    // ApiClient.api('/x') / api(`/x/${id}`) with an optional options object.
    const apiCall = /\bapi\(\s*([`'"])([^`'"]+)\1\s*(?:,\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\})?/g;
    for (const m of source.matchAll(apiCall)) {
      const rawPath = m[2];
      const options = m[3] || '';
      const method = (options.match(/method\s*:\s*['"](\w+)['"]/) || [, 'GET'])[1].toUpperCase();
      calls.push({ file, path: normalise(rawPath), method, raw: rawPath });
    }

    const downloadCall = /\bdownloadFile\(\s*([`'"])([^`'"]+)\1/g;
    for (const m of source.matchAll(downloadCall)) {
      calls.push({ file, path: normalise(m[2]), method: 'GET', raw: m[2] });
    }
  }
  return calls;
}

/** '/leaves/${id}/approve?x=1' -> '/api/leaves/1/approve' */
function normalise(rawPath) {
  const withoutQuery = rawPath.split('?')[0];
  const concrete = withoutQuery.replace(/\$\{[^}]*\}/g, '1');
  return `/api${concrete}`;
}

const app = buildApp();
const ROUTES = registeredRoutes(app);

test('the route extractor found the backend routes', { skip: MOBILE_ABSENT }, () => {
  // Guards against this whole file silently passing because the walk failed.
  assert.ok(ROUTES.length > 20, `expected many routes, found ${ROUTES.length}`);
  assert.ok(
    ROUTES.some((r) => r.path === '/api/leaves/balance'),
    'expected /api/leaves/balance among the registered routes',
  );
});

test('the call extractor found the mobile API calls', { skip: MOBILE_ABSENT }, () => {
  const calls = mobileApiCalls();
  assert.ok(calls.length > 10, `expected many mobile calls, found ${calls.length}`);
  assert.ok(calls.some((c) => c.path === '/api/auth/login'), 'expected the login call to be found');
});

test('every endpoint the mobile app calls exists on the backend', { skip: MOBILE_ABSENT }, () => {
  const calls = mobileApiCalls();
  const missing = [];

  for (const call of calls) {
    const hit = ROUTES.some((route) =>
      route.methods.includes(call.method) && routeMatcher(route.path).test(call.path));
    if (!hit) missing.push(`${call.file}: ${call.method} ${call.raw}  ->  ${call.path}`);
  }

  assert.deepEqual(missing, [],
    `the mobile app calls endpoints the backend does not expose:\n  ${missing.join('\n  ')}`);
});

test('the endpoints that were wrong before are gone from the mobile source', { skip: MOBILE_ABSENT }, () => {
  // The specific nine from the audit. Named explicitly so a reintroduction is
  // reported as itself rather than as a generic "route not found".
  const removed = [
    '/attendance/my',
    '/dashboard/summary',
    '/balances/my',
    '/leaves/my',
    '/admin/stats',
    '/attendance/today',
    '/documents/offer-letters/my',
  ];
  const calls = mobileApiCalls();
  const found = [];
  for (const call of calls) {
    for (const bad of removed) {
      if (call.raw.split('?')[0] === bad) found.push(`${call.file}: ${bad}`);
    }
  }
  assert.deepEqual(found, [], `non-existent endpoints still referenced:\n  ${found.join('\n  ')}`);
});

test('cancelling a leave uses DELETE, not the non-existent POST /cancel', { skip: MOBILE_ABSENT }, () => {
  const calls = mobileApiCalls();
  const cancelPosts = calls.filter((c) => /\/cancel$/.test(c.raw.split('?')[0]));
  assert.deepEqual(cancelPosts, [], 'POST /leaves/:id/cancel does not exist — DELETE /leaves/:id does');

  const deletes = calls.filter((c) => c.method === 'DELETE' && /^\/leaves\//.test(c.raw));
  assert.ok(deletes.length > 0, 'expected the app to cancel a leave with DELETE /leaves/:id');
});
