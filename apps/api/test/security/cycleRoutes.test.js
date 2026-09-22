/*
 * The month cycle, as the routes actually serve it.
 *
 * cycle.test.js proves the arithmetic. This proves the wiring: that the
 * endpoints ask the database for the cycle window and not the calendar month,
 * and that they still respond at all.
 *
 * That second half is not a formality. While moving the dashboard onto the
 * cycle, a `const now = new Date()` was removed while later code still used it
 * — a ReferenceError on the landing page every employee sees. The unit tests
 * were green throughout, because nothing exercised the handler. These tests
 * exist so that class of mistake fails here instead of in production.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { fakeDb } = require('../helpers/testEnv');
const { buildApp, userToken, COMPANY } = require('../helpers/testApp');
const { SYSTEM_ROLES } = require('../../src/permissions');

const EMPLOYEE_ID = 5;
const token = userToken({ employeeId: EMPLOYEE_ID });

/** Records the params of the first query whose SQL matches, and returns rows. */
function capture(pattern, rows = []) {
  const seen = [];
  fakeDb.on(pattern, (sql, params) => {
    seen.push({ sql, params });
    return rows;
  });
  return seen;
}

/** Auth plumbing every request goes through, plus a 25th-start cycle. */
function seed({ role = 'EMPLOYEE' } = {}) {
  fakeDb.reset();
  fakeDb.on(/SELECT \* FROM companies WHERE/, [COMPANY]);
  fakeDb.on(/FROM c_\w+\.users u LEFT JOIN c_\w+\.roles r/, [{
    is_active: true, is_locked: false, role_name: role,
    role_perms: JSON.stringify(SYSTEM_ROLES[role] ?? []),
  }]);
  fakeDb.on(/SELECT permission FROM c_\w+\.user_permissions/, []);
  // A 25th start: "August 2026" is 25 Jul - 24 Aug.
  fakeDb.on(/settings WHERE key='cycle_start_day'/, [{ value: '25' }]);
  fakeDb.on(/settings WHERE key='accrual_day'/, []);
}

/*
 * The attendance SCREENS draw a calendar month; everything about PAY stays on
 * the 25th-to-24th cycle. The two tests below pin the screens to 1–31 and the
 * two after them pin the dashboard and the CSV export to 25–24. Keeping all
 * four is the point: they mark where the boundary runs, so a later change to
 * one side cannot quietly cross into the other.
 */
test('the attendance grid asks for the calendar month, not the cycle', async () => {
  seed();
  const attendance = capture(/FROM c_vs\.attendance WHERE employee_id/);
  fakeDb.on(/FROM c_vs\.holidays/, []);
  fakeDb.on(/FROM c_vs\.device_attendance/, []);

  const res = await request(buildApp())
    .get('/api/attendance/me?year=2026&month=8')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.ok(attendance.length, 'the attendance query should have run');
  // August 2026 in full, even though this company's payroll cycle is 25–24.
  assert.deepEqual(attendance[0].params.slice(1), ['2026-08-01', '2026-08-31']);
  // Still a range, not a 'YYYY-MM%' prefix: the window travels to the browser
  // and draws the grid, so it has to be real dates.
  assert.ok(!/LIKE/.test(attendance[0].sql), 'the window has to be real dates');
});

test('the device times cover the same window as the statuses they merge into', async () => {
  seed();
  fakeDb.on(/FROM c_vs\.attendance WHERE employee_id/, []);
  fakeDb.on(/FROM c_vs\.holidays/, []);
  const device = capture(/FROM c_vs\.device_attendance/);

  const res = await request(buildApp())
    .get('/api/attendance/me?year=2026&month=8')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.ok(device.length, 'the device query should have run');
  assert.deepEqual(device[0].params.slice(1), ['2026-08-01', '2026-08-31'],
    'device times must not cover a different set of days than the grid');
});

test('the dashboard responds, and counts the running cycle', async () => {
  // The regression guard: this route was briefly a 500 with every unit test
  // still green.
  seed();
  const agg = capture(/FROM c_vs\.attendance WHERE employee_id/, [{ present_days: 3.5, absent_days: 0 }]);
  fakeDb.on(/FROM c_vs\.employees e\s+LEFT JOIN/, [{ id: EMPLOYEE_ID, emp_code: 'FTRN028', dob: '1997-09-06' }]);
  fakeDb.on(/FROM c_vs\.leave_balances/, []);
  fakeDb.on(/FROM c_vs\.holidays/, []);
  fakeDb.on(/FROM c_vs\.device_attendance/, []);
  fakeDb.on(/FROM c_vs\.employees WHERE status/, []);
  fakeDb.on(/FROM c_vs\.announcements/, []);
  fakeDb.on(/FROM c_vs\.leave_applications/, []);

  const res = await request(buildApp())
    .get('/api/dashboard')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200, `dashboard returned ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(agg.length, 'the month aggregate should have run');

  // A BETWEEN over a cycle, and the widget says which dates it counted.
  const [, from, to] = agg[0].params;
  assert.match(from, /^\d{4}-\d{2}-25$/, 'a cycle starts on the 25th');
  assert.match(to, /^\d{4}-\d{2}-24$/, 'and ends on the 24th');
  assert.ok(res.body.widgets.periodLabel, 'the period must be stated, not implied');
});

test('the CSV export keeps its header on the first line', async () => {
  // A "Period: ..." banner above the header reads nicely in Excel and breaks
  // every consumer that treats row 1 as the column names. The dates belong in
  // the filename instead.
  seed({ role: 'HR' });
  fakeDb.on(/FROM c_vs\.attendance a JOIN/, []);
  fakeDb.on(/audit_logs/, []);

  const res = await request(buildApp())
    .get('/api/attendance/export?year=2026&month=8')
    .set('Authorization', `Bearer ${userToken({ employeeId: EMPLOYEE_ID, role: 'HR' })}`);

  // HR holds attendance.export, so this must be a real CSV — accepting a 403
  // here would let the test pass without ever checking the file.
  assert.equal(res.status, 200, `export returned ${res.status}: ${res.text?.slice(0, 200)}`);
  // Entry/Exit joined this sheet with the payroll work. What the assertion is
  // really guarding is the SHAPE: row 1 is the column names, and it names every
  // column the row mapper emits — a header narrower than its rows silently
  // shifts every field after Status.
  assert.match(res.text.split('\n')[0], /^Employee Code,Name,Date,Status,Entry Time,Exit Time,Late Mark$/);
  assert.match(res.headers['content-disposition'], /2026-07-25_to_2026-08-24/,
    'the period belongs in the filename, where it cannot corrupt the CSV shape');
});
