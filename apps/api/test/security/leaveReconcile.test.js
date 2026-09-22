/*
 * Leave reconciliation.
 *
 * The case this exists for, found on live data 2026-08-31: one employee had
 * three days marked "EL" in attendance, exactly one approved application
 * between them, and a balance overstated by two days. Neither subsystem was
 * broken — HR's bulk-mark writes attendance and never touches a balance, and
 * only the approval endpoint deducts one. They simply had no reason to agree,
 * and nothing was watching.
 *
 * The same employee also had an approved paid leave with no deduction at all:
 * the approval had not gone through the endpoint, so there was no leave_taken
 * ledger entry — just a bare "Manual adjustment" someone had made by hand.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { fakeDb } = require('../helpers/testEnv');
const { buildApp, userToken, COMPANY } = require('../helpers/testApp');
const { SYSTEM_ROLES } = require('../../src/permissions');
const { reconcileLeave, LEAVE_STATUSES, UNPAID_STATUSES } = require('../../src/leaveReconcile');

const noBaseline = () => fakeDb.on(/leave_reconciled_through/, []);

function seedAuth(role = 'HR') {
  fakeDb.reset();
  fakeDb.on(/SELECT \* FROM companies WHERE/, [COMPANY]);
  fakeDb.on(/FROM c_\w+\.users u LEFT JOIN c_\w+\.roles r/, [{
    is_active: true, is_locked: false, role_name: role,
    role_perms: JSON.stringify(SYSTEM_ROLES[role] ?? []),
  }]);
  fakeDb.on(/SELECT permission FROM c_\w+\.user_permissions/, []);
}

test('a day marked as leave with no approved application is reported', async () => {
  fakeDb.reset();
  // 7 Aug: bulk-marked EL, nothing approved behind it — the real case.
  fakeDb.on(/FROM \{?c_vs\}?\.attendance a/, [
    { emp_code: 'FTRN028', name: 'Rahul Paul', date: '2026-08-07', status: 'EL', remarks: 'Bulk marked by HR' },
  ]);
  fakeDb.on(/FROM c_vs\.attendance a/, [
    { emp_code: 'FTRN028', name: 'Rahul Paul', date: '2026-08-07', status: 'EL', remarks: 'Bulk marked by HR' },
  ]);
  fakeDb.on(/FROM c_vs\.leave_applications la/, []);
  noBaseline();

  const result = await reconcileLeave('c_vs');

  assert.equal(result.ok, true);
  assert.equal(result.unbacked_attendance.length, 1);
  assert.equal(result.unbacked_attendance[0].date, '2026-08-07');
  assert.equal(result.total, 1);
});

test('an approved paid leave with no deduction is reported', async () => {
  fakeDb.reset();
  fakeDb.on(/FROM c_vs\.attendance a/, []);
  fakeDb.on(/FROM c_vs\.leave_applications la/, [
    { emp_code: 'FTRN028', name: 'Rahul Paul', id: 10, code: 'EL', days: 1, from_date: '2026-08-03', to_date: '2026-08-03' },
  ]);
  noBaseline();

  const result = await reconcileLeave('c_vs');

  assert.equal(result.undeducted_approvals.length, 1);
  assert.equal(result.undeducted_approvals[0].id, 10);
});

test('the queries exclude unpaid leave and match the ledger note format', async () => {
  // Unpaid leave deliberately deducts nothing (leaves.js: `if (!row.is_unpaid)`),
  // so reporting it would be a permanent false positive. And the only link
  // between an application and its ledger entry is the note text the approval
  // endpoint writes — there is no foreign key, so the LIKE has to match it.
  fakeDb.reset();
  fakeDb.on(/FROM c_vs\.attendance a/, []);
  fakeDb.on(/FROM c_vs\.leave_applications la/, []);
  noBaseline();

  await reconcileLeave('c_vs');

  // Matched on the leave_types join, which only the approvals query has. Both
  // queries now mention leave_applications AND leave_ledger somewhere inside a
  // NOT EXISTS, so either of those picks the wrong one.
  const approvalQuery = fakeDb.calls.find((c) => /JOIN c_vs\.leave_types lt/.test(c.sql));
  assert.ok(approvalQuery, 'the approvals query should have run');
  assert.match(approvalQuery.sql, /NOT la\.is_unpaid/, 'unpaid leave must be excluded');
  assert.match(approvalQuery.sql, /'Leave #' \|\| la\.id/, 'must match the note the approval endpoint writes');
});

test('every PAID leave status is covered', () => {
  // HR's bulk-mark can write any of these; a paid status missing here is a day
  // the check would silently ignore, and a balance left overstated.
  for (const s of ['EL', 'SL', 'Leave']) {
    assert.ok(LEAVE_STATUSES.includes(s), `${s} must be reconciled`);
  }
});

test('LOP is never reported — unpaid days cannot overstate a balance', () => {
  // Loss of Pay deducts nothing by design, exactly like an unpaid application.
  // Listing it would put permanent entries in the report with nothing anyone
  // could do about them, and a report that always has entries stops being read.
  assert.ok(UNPAID_STATUSES.includes('LOP'));
  assert.ok(!LEAVE_STATUSES.includes('LOP'), 'LOP must not be flagged as a discrepancy');
});

test('a day already settled by hand is not reported again', async () => {
  // Reconciled without an application ever existing — the balance HAS been
  // reduced, so it is no longer a discrepancy and must drop out of the report.
  fakeDb.reset();
  fakeDb.on(/FROM c_vs\.attendance a/, []);
  fakeDb.on(/FROM c_vs\.leave_applications la/, []);
  noBaseline();

  await reconcileLeave('c_vs');

  const attendanceQuery = fakeDb.calls.find((c) => /FROM c_vs\.attendance a/.test(c.sql));
  assert.match(attendanceQuery.sql, /kind = 'leave_taken'/,
    'a day whose balance was already reduced must be excluded');
});

test('a reconciliation failure is reported, not thrown', async () => {
  // It is diagnostic, and must not take down whatever it is reported beside.
  fakeDb.reset(); // no handlers — every query rejects

  const result = await reconcileLeave('c_vs');

  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('the endpoint is behind leaves.view_all — it names who was absent', async () => {
  seedAuth('EMPLOYEE');
  const res = await request(buildApp())
    .get('/api/admin/leave-reconciliation')
    .set('Authorization', `Bearer ${userToken({ role: 'EMPLOYEE' })}`);
  assert.equal(res.status, 403);
});

test('HR can read it', async () => {
  seedAuth('HR');
  fakeDb.on(/FROM c_vs\.attendance a/, []);
  fakeDb.on(/FROM c_vs\.leave_applications la/, []);
  noBaseline();

  const res = await request(buildApp())
    .get('/api/admin/leave-reconciliation')
    .set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 0);
});

test('the reviewed backlog is baselined, so only new divergence is reported', async () => {
  // The days before the baseline were settled through manual adjustments whose
  // note carries no date, so nothing can match one to the day it covered.
  // Re-listing them forever is the same trap as LOP.
  fakeDb.reset();
  fakeDb.on(/leave_reconciled_through/, [{ value: '2026-08-31' }]);
  fakeDb.on(/FROM c_vs\.attendance a/, []);
  fakeDb.on(/FROM c_vs\.leave_applications la/, []);

  const result = await reconcileLeave('c_vs');

  assert.equal(result.reviewed_through, '2026-08-31');
  assert.equal(result.since, '2026-09-01', 'the day AFTER the reviewed date');

  const attendanceQuery = fakeDb.calls.find((c) => /FROM c_vs\.attendance a/.test(c.sql));
  assert.equal(attendanceQuery.params[1], '2026-09-01');
});

test('an explicit since overrides the baseline, so history stays reachable', async () => {
  fakeDb.reset();
  fakeDb.on(/leave_reconciled_through/, [{ value: '2026-08-31' }]);
  fakeDb.on(/FROM c_vs\.attendance a/, []);
  fakeDb.on(/FROM c_vs\.leave_applications la/, []);

  const result = await reconcileLeave('c_vs', { since: '2026-01-01' });

  assert.equal(result.since, '2026-01-01');
  assert.equal(result.reviewed_through, null, 'an explicit window is not a baselined one');
});
