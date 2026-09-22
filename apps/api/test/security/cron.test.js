/*
 * Scheduler endpoints.
 *
 * These run with no user session and they mutate leave balances, so the shared
 * secret is the entire access control story. If it can be bypassed, anyone on
 * the internet can drive accrual against every tenant.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const path = require('path');

const { fakeDb } = require('../helpers/testEnv');

const CRON_ROUTE = path.join(__dirname, '..', '..', 'src', 'routes', 'cron.js');
const SECRET = 'a-real-cron-secret-value-0123456789';

/** Builds an app with the cron router loaded under a specific CRON_SECRET. */
function buildCronApp(secret) {
  delete require.cache[require.resolve(CRON_ROUTE)];
  const saved = process.env.CRON_SECRET;
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;

  const app = express();
  app.use(express.json());
  app.use('/api/cron', require(CRON_ROUTE));
  app.use((err, req, res, next) => res.status(500).json({ error: 'Internal server error' }));

  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
  return app;
}

test.beforeEach(() => {
  fakeDb.reset();
  fakeDb.on(/FROM companies/, [{ schema_name: 'c_vs', companies: 1 }]);
  fakeDb.on(/FROM c_vs\./, []);
});

test('the backup endpoint refuses an anonymous caller', async () => {
  // It reads the whole database and every stored document into one archive and
  // ships it off-site. Unauthenticated, it would be an exfiltration endpoint.
  const app = buildCronApp(SECRET);
  const res = await request(app).post('/api/cron/backup');
  assert.equal(res.status, 401);
});

test('the backup endpoint refuses a wrong secret', async () => {
  const app = buildCronApp(SECRET);
  const res = await request(app).post('/api/cron/backup').set('x-cron-secret', 'not-the-secret');
  assert.equal(res.status, 401);
});

test('the backup endpoint fails closed when no secret is configured', async () => {
  const app = buildCronApp(undefined);
  const res = await request(app).post('/api/cron/backup').set('x-cron-secret', 'anything');
  assert.equal(res.status, 503);
});

test('the accrual endpoint refuses an anonymous caller', async () => {
  const app = buildCronApp(SECRET);
  const res = await request(app).post('/api/cron/accrual');
  assert.equal(res.status, 401);
  assert.match(res.body.error, /scheduler credentials/);
});

test('the keepalive endpoint refuses an anonymous caller', async () => {
  const app = buildCronApp(SECRET);
  const res = await request(app).post('/api/cron/keepalive');
  assert.equal(res.status, 401);
});

test('a wrong secret is refused', async () => {
  const app = buildCronApp(SECRET);
  for (const wrong of ['nope', SECRET.slice(0, -1), `${SECRET}x`, '']) {
    const res = await request(app).post('/api/cron/accrual').set('x-cron-secret', wrong);
    assert.equal(res.status, 401, `secret "${wrong}" should be refused`);
  }
});

test('the correct secret is accepted as a Bearer token', async () => {
  const app = buildCronApp(SECRET);
  const res = await request(app).post('/api/cron/accrual').set('Authorization', `Bearer ${SECRET}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.task, 'accrual');
});

test('the correct secret is accepted as x-cron-secret', async () => {
  const app = buildCronApp(SECRET);
  const res = await request(app).post('/api/cron/keepalive').set('x-cron-secret', SECRET);
  assert.equal(res.status, 200);
  assert.equal(res.body.task, 'keepalive');
});

test('the secret is NOT accepted from the query string', async () => {
  // URLs land in access logs, browser history and Referer headers. A secret
  // that works in a query parameter will eventually leak into one of them.
  const app = buildCronApp(SECRET);
  const res = await request(app).post(`/api/cron/accrual?secret=${SECRET}`);
  assert.equal(res.status, 401);
});

test('with no CRON_SECRET configured the routes fail closed', async () => {
  // Defaulting open would leave an unauthenticated endpoint that rewrites leave
  // balances — strictly worse than having no scheduler at all.
  const app = buildCronApp(undefined);
  const res = await request(app).post('/api/cron/accrual').set('x-cron-secret', 'anything');
  assert.equal(res.status, 503);
  assert.match(res.body.error, /not configured/);
});

test('an empty CRON_SECRET does not authorise an empty header', async () => {
  const app = buildCronApp('');
  const res = await request(app).post('/api/cron/accrual').set('x-cron-secret', '');
  assert.equal(res.status, 503);
});

test('the accrual endpoint is idempotent enough to be retried', async () => {
  // Cron services retry on timeout; the high-water mark in leave_balances makes
  // repeat calls credit nothing extra. Here we assert only that a second call
  // succeeds rather than erroring.
  const app = buildCronApp(SECRET);
  for (let i = 0; i < 3; i++) {
    const res = await request(app).post('/api/cron/accrual').set('x-cron-secret', SECRET);
    assert.equal(res.status, 200, `call ${i + 1} should succeed`);
  }
});

test('keepalive actually queries the database', async () => {
  // Pinging a route that does no database work would keep Render awake while a
  // free Supabase project paused underneath it.
  const app = buildCronApp(SECRET);
  fakeDb.reset();
  let queried = false;
  fakeDb.on(/FROM companies/, () => { queried = true; return [{ companies: 1 }]; });

  const res = await request(app).post('/api/cron/keepalive').set('x-cron-secret', SECRET);
  assert.equal(res.status, 200);
  assert.ok(queried, 'keepalive must issue a real query');
});

test('GET is not accepted — these endpoints mutate state', async () => {
  const app = buildCronApp(SECRET);
  const res = await request(app).get('/api/cron/accrual').set('x-cron-secret', SECRET);
  assert.equal(res.status, 404);
});
