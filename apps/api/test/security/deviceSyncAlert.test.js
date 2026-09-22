/*
 * Device-sync failure alerting.
 *
 * The sync used to fail in silence — a wrong Wi-Fi network stopped four days of
 * biometric times on 2026-08-17 and was found only because someone went looking.
 * Two mechanisms cover it, and the tests that matter here are the ones proving
 * the *second* exists: the reporting endpoint cannot fire when the failure is
 * "could not reach the API", so the staleness watchdog is not redundant.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const path = require('path');

const { fakeDb, sentMail } = require('../helpers/testEnv');

const ROUTE = path.join(__dirname, '..', '..', 'src', 'routes', 'integrations.js');
const SECRET = 'a-real-sync-secret-value-0123456789';

const FTR = { id: 2, name: 'Validure', slug: 'ftr', schema_name: 'c_vs', status: 'Active', has_device_attendance: true };

function buildApp() {
  delete require.cache[require.resolve(ROUTE)];
  const saved = process.env.ATTENDANCE_SYNC_SECRET;
  process.env.ATTENDANCE_SYNC_SECRET = SECRET;
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', require(ROUTE));
  app.use((err, req, res, next) => res.status(500).json({ error: 'Internal server error' }));
  if (saved === undefined) delete process.env.ATTENDANCE_SYNC_SECRET;
  else process.env.ATTENDANCE_SYNC_SECRET = saved;
  return app;
}

test.beforeEach(() => {
  fakeDb.reset();
  sentMail.length = 0;
  fakeDb.on(/FROM companies WHERE slug/, [FTR]);
  fakeDb.on(/audit_logs/, []);
  fakeDb.on(/FROM c_vs\.users u/, [{ email: 'sneha.nair@validuresolutions.com' }, { email: 'vikram.rao@validuresolutions.com' }]);
});

const alert = (body, secret = SECRET) =>
  request(buildApp())
    .post('/api/integrations/attendance/alert')
    .set('x-sync-secret', secret)
    .set('x-company-slug', 'ftr')
    .send(body);

test('a reported failure emails whoever can act on it', async () => {
  const res = await alert({ error: 'BioMax SDK connection failed (code -2)' });

  assert.equal(res.status, 200);
  assert.equal(res.body.notified, 2);
  assert.equal(sentMail.length, 1);
  assert.deepEqual(sentMail[0].to, ['sneha.nair@validuresolutions.com', 'vikram.rao@validuresolutions.com']);
  assert.match(sentMail[0].subject, /Attendance sync failed/i);
  assert.match(sentMail[0].subject, /Validure/);
  assert.match(sentMail[0].body, /BioMax SDK connection failed \(code -2\)/);
});

test('the mail says punches are safe, so nobody panics about lost data', async () => {
  await alert({ error: 'Device read failed' });
  assert.match(sentMail[0].body, /not\s+lost/i, 'the reader needs to know the device still holds them');
});

test('the alert endpoint is behind the same secret as the ingest', async () => {
  const res = await alert({ error: 'anything' }, 'wrong-secret-entirely');
  assert.equal(res.status, 401);
  assert.equal(sentMail.length, 0, 'an unauthenticated caller must not be able to send mail');
});

test('an empty error is rejected rather than mailing a blank alert', async () => {
  for (const body of [{}, { error: '' }, { error: '   ' }]) {
    const res = await alert(body);
    assert.equal(res.status, 400);
  }
  assert.equal(sentMail.length, 0);
});

/* ---- the watchdog, which covers what the endpoint structurally cannot ---- */

const { checkStaleSyncs, STALE_AFTER_HOURS } = require(path.join(__dirname, '..', '..', 'src', 'deviceSync'));

function wireStaleness({ hoursAgo, lastSync = '2026-08-13 20:18:37' }) {
  fakeDb.reset();
  sentMail.length = 0;
  fakeDb.on(/FROM companies WHERE status='Active' AND has_device_attendance/, [
    { name: 'Validure', schema_name: 'c_vs' },
  ]);
  fakeDb.on(/FROM c_vs\.device_attendance/, [
    { last_sync: hoursAgo === null ? null : lastSync, hours_ago: hoursAgo },
  ]);
  fakeDb.on(/FROM c_vs\.users u/, [{ email: 'sneha.nair@validuresolutions.com' }]);
}

test('a normal weekend gap does not alert', async () => {
  // Friday night run to Monday night run is 72h of healthy silence. Alerting
  // on that would arrive every Monday and train everyone to ignore these.
  wireStaleness({ hoursAgo: 72 });
  const out = await checkStaleSyncs();

  assert.equal(out.results[0].state, 'ok');
  assert.equal(sentMail.length, 0);
  assert.ok(STALE_AFTER_HOURS > 72, 'the threshold must clear the weekend');
});

test('silence past the threshold alerts', async () => {
  wireStaleness({ hoursAgo: 96 });
  const out = await checkStaleSyncs();

  assert.equal(out.results[0].state, 'stale');
  assert.equal(sentMail.length, 1);
  assert.match(sentMail[0].subject, /No attendance sync/i);
  assert.match(sentMail[0].body, /schtasks/, 'tell them how to check the task');
});

test('a tenant that has never synced is not nagged', async () => {
  wireStaleness({ hoursAgo: null });
  const out = await checkStaleSyncs();

  assert.equal(out.results[0].state, 'never_synced');
  assert.equal(sentMail.length, 0);
});

test('the watchdog never throws, so it cannot fail the job it rides on', async () => {
  fakeDb.reset();
  sentMail.length = 0;
  // No handler registered at all: every query rejects.
  const out = await checkStaleSyncs();
  assert.ok(out.error || out.checked === 0, 'must degrade quietly, not reject');
});
