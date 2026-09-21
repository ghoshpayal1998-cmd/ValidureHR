/*
 * Attendance Manager ingest endpoint.
 *
 * This runs with no user session and WRITES tenant data, so the shared secret
 * plus the company-slug lookup are the entire access control story. If either
 * can be bypassed, anyone on the internet can plant attendance times for any
 * employee of any tenant.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const path = require('path');

const { fakeDb } = require('../helpers/testEnv');

const ROUTE = path.join(__dirname, '..', '..', 'src', 'routes', 'integrations.js');
const SECRET = 'a-real-sync-secret-value-0123456789';

/** Builds an app with the integrations router loaded under a specific secret. */
function buildApp(secret) {
  delete require.cache[require.resolve(ROUTE)];
  const saved = process.env.ATTENDANCE_SYNC_SECRET;
  if (secret === undefined) delete process.env.ATTENDANCE_SYNC_SECRET;
  else process.env.ATTENDANCE_SYNC_SECRET = secret;

  const app = express();
  app.use(express.json());
  app.use('/api/integrations', require(ROUTE));
  app.use((err, req, res, next) => res.status(500).json({ error: 'Internal server error' }));

  if (saved === undefined) delete process.env.ATTENDANCE_SYNC_SECRET;
  else process.env.ATTENDANCE_SYNC_SECRET = saved;
  return app;
}

const FTR = { id: 2, name: 'Validure', slug: 'ftr', schema_name: 'c_vs', status: 'Active', has_device_attendance: true };

test.beforeEach(() => {
  fakeDb.reset();
  fakeDb.on(/FROM companies WHERE slug/, [FTR]);
  fakeDb.on(/INSERT INTO c_vs\.device_employee_map/, []);
  // Machine 22 is mapped to employee #7; everything else is unmapped.
  fakeDb.on(/FROM c_vs\.device_employee_map WHERE machine_id/, [{ machine_id: '22', employee_id: 7 }]);
  fakeDb.on(/audit_logs/, []);
});

function goodRow(overrides) {
  return { machine_id: '22', date: '2026-08-12', check_in: '19:02', check_out: '04:01', ...overrides };
}

function post(app) {
  return request(app)
    .post('/api/integrations/attendance')
    .set('x-sync-secret', SECRET)
    .set('x-company-slug', 'ftr');
}

// --- the secret ---------------------------------------------------------------

test('an anonymous caller is refused', async () => {
  const app = buildApp(SECRET);
  const res = await request(app).post('/api/integrations/attendance').send({ rows: [] });
  assert.equal(res.status, 401);
  assert.match(res.body.error, /sync credentials/);
});

test('a wrong secret is refused', async () => {
  const app = buildApp(SECRET);
  for (const wrong of ['nope', SECRET.slice(0, -1), `${SECRET}x`, '']) {
    const res = await request(app)
      .post('/api/integrations/attendance')
      .set('x-sync-secret', wrong)
      .send({ rows: [] });
    assert.equal(res.status, 401, `secret "${wrong}" should be refused`);
  }
});

test('the correct secret is accepted as a Bearer token', async () => {
  const app = buildApp(SECRET);
  const res = await request(app)
    .post('/api/integrations/attendance')
    .set('Authorization', `Bearer ${SECRET}`)
    .set('x-company-slug', 'ftr')
    .send({ rows: [] });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Nothing to sync');
});

test('the secret is NOT accepted from the query string', async () => {
  // URLs land in access logs, browser history and Referer headers.
  const app = buildApp(SECRET);
  const res = await request(app)
    .post(`/api/integrations/attendance?secret=${SECRET}`)
    .set('x-company-slug', 'ftr')
    .send({ rows: [] });
  assert.equal(res.status, 401);
});

test('with no ATTENDANCE_SYNC_SECRET configured the route fails closed', async () => {
  // Defaulting open would leave an unauthenticated write path into tenant data.
  const app = buildApp(undefined);
  const res = await request(app)
    .post('/api/integrations/attendance')
    .set('x-sync-secret', 'anything')
    .send({ rows: [] });
  assert.equal(res.status, 503);
  assert.match(res.body.error, /not configured/);
});

test('an empty secret does not authorise an empty header', async () => {
  const app = buildApp('');
  const res = await request(app)
    .post('/api/integrations/attendance')
    .set('x-sync-secret', '')
    .send({ rows: [] });
  assert.equal(res.status, 503);
});

// --- the tenant ----------------------------------------------------------------

test('a missing company slug is a 400', async () => {
  const app = buildApp(SECRET);
  const res = await request(app)
    .post('/api/integrations/attendance')
    .set('x-sync-secret', SECRET)
    .send({ rows: [] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /x-company-slug/);
});

test('an unknown company slug is a 404', async () => {
  const app = buildApp(SECRET);
  fakeDb.reset();
  fakeDb.on(/FROM companies WHERE slug/, []);
  const res = await request(app)
    .post('/api/integrations/attendance')
    .set('x-sync-secret', SECRET)
    .set('x-company-slug', 'nope')
    .send({ rows: [] });
  assert.equal(res.status, 404);
});

test('a company without device attendance is refused', async () => {
  // The creation-time checkbox is the feature switch: a company that never
  // enabled biometric attendance must not accept device pushes at all.
  const app = buildApp(SECRET);
  fakeDb.reset();
  fakeDb.on(/FROM companies WHERE slug/, [{ ...FTR, has_device_attendance: false }]);
  const res = await request(app)
    .post('/api/integrations/attendance')
    .set('x-sync-secret', SECRET)
    .set('x-company-slug', 'ftr')
    .send({ rows: [] });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /not enabled/);
});

test('a suspended company is refused', async () => {
  const app = buildApp(SECRET);
  fakeDb.reset();
  fakeDb.on(/FROM companies WHERE slug/, [{ ...FTR, status: 'Suspended' }]);
  const res = await request(app)
    .post('/api/integrations/attendance')
    .set('x-sync-secret', SECRET)
    .set('x-company-slug', 'ftr')
    .send({ rows: [] });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /suspended/);
});

// --- validation ------------------------------------------------------------------

test('empty rows[] with no roster is a valid connection test', async () => {
  const app = buildApp(SECRET);
  const res = await post(app).send({ rows: [] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { message: 'Nothing to sync', updated: 0 });
});

test('a missing rows array is a 400', async () => {
  const app = buildApp(SECRET);
  const res = await post(app).send({});
  assert.equal(res.status, 400);
});

test('a roster entry without machine_id is a 400', async () => {
  const app = buildApp(SECRET);
  const res = await post(app).send({ users: [{ device_name: 'ghost' }], rows: [] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /machine_id/);
});

test('a malformed date is a 400', async () => {
  const app = buildApp(SECRET);
  for (const date of ['12-08-2026', '2026/08/12', '2026-8-12', 'today']) {
    const res = await post(app).send({ rows: [goodRow({ date })] });
    assert.equal(res.status, 400, `date "${date}" should be refused`);
    assert.match(res.body.error, /YYYY-MM-DD/);
  }
});

test('a future date is a 400', async () => {
  const app = buildApp(SECRET);
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await post(app).send({ rows: [goodRow({ date: future })] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /future/);
});

test('malformed times are a 400', async () => {
  const app = buildApp(SECRET);
  for (const bad of [{ check_in: '7:02 PM' }, { check_in: '1902' }, { check_out: '4' }]) {
    const res = await post(app).send({ rows: [goodRow(bad)] });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /HH:MM/);
  }
});

test('a row with neither time is a 400', async () => {
  const app = buildApp(SECRET);
  const res = await post(app).send({ rows: [goodRow({ check_in: null, check_out: null })] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /neither/);
});

test('an oversized batch is a 400', async () => {
  const app = buildApp(SECRET);
  const rows = Array.from({ length: 501 }, () => goodRow());
  const res = await post(app).send({ rows });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /max 500/);
});

// --- behaviour --------------------------------------------------------------------

test('a row from a mapped machine is upserted and acknowledged', async () => {
  const app = buildApp(SECRET);
  const res = await post(app).send({ rows: [goodRow()] });
  assert.equal(res.status, 200);
  assert.equal(res.body.updated, 1);
  assert.equal(res.body.received, 1);
  assert.deepEqual(res.body.unmapped_machines, []);
});

test('an unmapped machine is reported with its device name, and held back', async () => {
  const app = buildApp(SECRET);
  const res = await post(app).send({
    users: [{ machine_id: '99', device_name: 'tanuj' }],
    rows: [goodRow({ machine_id: '99' })],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.updated, 0);
  assert.deepEqual(res.body.unmapped_machines, [{ machine_id: '99', device_name: 'tanuj' }]);
});

test('a roster-only push updates the map table', async () => {
  const app = buildApp(SECRET);
  const res = await post(app).send({ users: [{ machine_id: '5', device_name: 'zahir' }], rows: [] });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Roster updated');
  const rosterWrites = fakeDb.calls.filter((c) => /INSERT INTO c_vs\.device_employee_map/.test(c.sql));
  assert.equal(rosterWrites.length, 1);
  assert.deepEqual(rosterWrites[0].params, ['5', 'zahir']);
});

test('the roster upsert can never change who a machine is mapped to', async () => {
  // The sync only maintains machine_id + device_name; employee_id is set
  // exclusively by a platform admin through the dashboard.
  const app = buildApp(SECRET);
  await post(app).send({ users: [{ machine_id: '22', device_name: 'Rahul Paul' }], rows: [] });
  const rosterWrites = fakeDb.calls.filter((c) => /INSERT INTO c_vs\.device_employee_map/.test(c.sql));
  assert.equal(rosterWrites.length, 1);
  assert.doesNotMatch(rosterWrites[0].sql, /employee_id\s*=/, 'roster upsert must not touch employee_id');
});

test('the ingest never writes to the HR attendance table', async () => {
  // {s}.attendance.status is HR-managed; device times live in device_attendance.
  const app = buildApp(SECRET);
  await post(app).send({ rows: [goodRow()] });
  for (const w of fakeDb.calls.filter((c) => /INSERT INTO/i.test(c.sql))) {
    assert.doesNotMatch(w.sql, /INSERT INTO c_vs\.attendance\b/, 'must not touch {s}.attendance');
  }
});

test('GET is not accepted — this endpoint mutates state', async () => {
  const app = buildApp(SECRET);
  const res = await request(app).get('/api/integrations/attendance').set('x-sync-secret', SECRET);
  assert.equal(res.status, 404);
});
