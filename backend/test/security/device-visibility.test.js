/*
 * Device-time visibility.
 *
 * The rules as the owner rolled them out (2026-08-14):
 *  - Day overview: device times for EVERY attendance.view_all holder
 *    (HR/OWNER/DIRECTOR and platform admins) — the "list + date picker" view.
 *  - /me: an employee's OWN device times only.
 *  - /employee/:id (someone else's month) and the CSV export: no device times.
 *  - Device Mapping panel and its endpoints: platform admin only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { fakeDb } = require('../helpers/testEnv');
const { buildApp, adminToken, userToken, COMPANY } = require('../helpers/testApp');

function stubTenantData() {
  fakeDb.on(/FROM companies WHERE slug/, [COMPANY]);
  fakeDb.on(/FROM companies WHERE id/, [COMPANY]);
  fakeDb.on(/FROM c_vs\.users u LEFT JOIN c_vs\.roles/, [{
    is_active: true, is_locked: false, role_name: 'HR', role_perms: '["attendance.view_all"]',
  }]);
  fakeDb.on(/FROM c_vs\.user_permissions/, []);
  fakeDb.on(/CREATE INDEX IF NOT EXISTS idx_attendance_date/, []);
  fakeDb.on(/FROM c_vs\.holidays/, []);
  fakeDb.on(/FROM c_vs\.employees e/, []);
}

test.beforeEach(() => { fakeDb.reset(); stubTenantData(); });

test('the overview queries device times for a platform admin', async () => {
  const app = buildApp({ routes: { '/api/attendance': 'attendance' } });
  const res = await request(app)
    .get('/api/attendance/overview?date=2026-08-12')
    .set('Authorization', `Bearer ${adminToken()}`)
    .set('x-company-slug', 'ftr');
  assert.equal(res.status, 200);

  const overviewCalls = fakeDb.calls.filter((c) => /FROM c_vs\.employees e/.test(c.sql));
  assert.equal(overviewCalls.length, 1, 'expected exactly one overview query');
  assert.match(overviewCalls[0].sql, /device_attendance/, 'admin overview must join device times');
});

test('the overview includes device times for an HR user (rolled out)', async () => {
  const app = buildApp({ routes: { '/api/attendance': 'attendance' } });
  const res = await request(app)
    .get('/api/attendance/overview?date=2026-08-12')
    .set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);
  assert.equal(res.status, 200);

  const overviewCalls = fakeDb.calls.filter((c) => /FROM c_vs\.employees e/.test(c.sql));
  assert.equal(overviewCalls.length, 1);
  assert.match(overviewCalls[0].sql, /device_attendance/, 'the HR day view now joins device times');
});

test('an employee sees their OWN device times on /me', async () => {
  fakeDb.on(/FROM c_vs\.attendance WHERE employee_id/, [
    { date: '2026-08-12', status: 'Present', check_in: null, check_out: null, late_mark: false, remarks: null },
  ]);
  fakeDb.on(/FROM c_vs\.device_attendance/, [
    { date: '2026-08-12', check_in: '19:09', check_out: '04:01' },
    { date: '2026-08-13', check_in: '19:23', check_out: null },
  ]);
  const app = buildApp({ routes: { '/api/attendance': 'attendance' } });
  const res = await request(app)
    .get('/api/attendance/me?year=2026&month=8')
    .set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);
  assert.equal(res.status, 200);

  const marked = res.body.records.find((r) => r.date === '2026-08-12');
  assert.equal(marked.check_in, '19:09', 'device time must fill the retired manual field');
  assert.equal(marked.check_out, '04:01');
  const unmarked = res.body.records.find((r) => r.date === '2026-08-13');
  assert.ok(unmarked, 'a punched day HR never marked must still appear');
  assert.equal(unmarked.status, null);
  assert.equal(unmarked.check_in, '19:23');
});

test("HR viewing ANOTHER employee's month gets no device times", async () => {
  fakeDb.on(/FROM c_vs\.attendance WHERE employee_id/, []);
  const app = buildApp({ routes: { '/api/attendance': 'attendance' } });
  const res = await request(app)
    .get('/api/attendance/employee/9?year=2026&month=8')
    .set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);
  assert.equal(res.status, 200);
  for (const call of fakeDb.calls) {
    assert.doesNotMatch(call.sql, /device_attendance/, 'the view_all month grid must not read device times');
  }
});

test('a company without device attendance gets no device features at all', async () => {
  // Simulates a tenant created with the fingerprint checkbox OFF.
  fakeDb.reset();
  const nonDevice = { ...COMPANY, has_device_attendance: false };
  fakeDb.on(/FROM companies WHERE slug/, [nonDevice]);
  fakeDb.on(/FROM companies WHERE id/, [nonDevice]);
  fakeDb.on(/FROM c_vs\.users u LEFT JOIN c_vs\.roles/, [{
    is_active: true, is_locked: false, role_name: 'HR', role_perms: '["attendance.view_all"]',
  }]);
  fakeDb.on(/FROM c_vs\.user_permissions/, []);
  fakeDb.on(/CREATE INDEX IF NOT EXISTS idx_attendance_date/, []);
  fakeDb.on(/FROM c_vs\.holidays/, []);
  fakeDb.on(/FROM c_vs\.employees e/, []);
  fakeDb.on(/FROM c_vs\.attendance WHERE employee_id/, []);
  const app = buildApp({ routes: { '/api/attendance': 'attendance' } });

  const overview = await request(app)
    .get('/api/attendance/overview?date=2026-08-12')
    .set('Authorization', `Bearer ${adminToken()}`)
    .set('x-company-slug', 'ftr');
  assert.equal(overview.status, 200);

  const me = await request(app)
    .get('/api/attendance/me?year=2026&month=8')
    .set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);
  assert.equal(me.status, 200);

  const map = await request(app)
    .get('/api/attendance/device-map')
    .set('Authorization', `Bearer ${adminToken()}`)
    .set('x-company-slug', 'ftr');
  assert.equal(map.status, 404);
  assert.match(map.body.error, /not enabled/);

  for (const call of fakeDb.calls) {
    assert.doesNotMatch(call.sql, /device_attendance|device_employee_map/,
      'a non-biometric company must never touch device tables');
  }
});

test('the device-map listing is platform-admin only', async () => {
  fakeDb.on(/FROM c_vs\.device_employee_map m/, [
    { machine_id: '16', device_name: 'Arjun', employee_id: null, emp_code: null, employee_name: null },
  ]);
  const app = buildApp({ routes: { '/api/attendance': 'attendance' } });

  const admin = await request(app)
    .get('/api/attendance/device-map')
    .set('Authorization', `Bearer ${adminToken()}`)
    .set('x-company-slug', 'ftr');
  assert.equal(admin.status, 200);
  assert.equal(admin.body[0].machine_id, '16');

  const callsBefore = fakeDb.calls.length;
  const hr = await request(app)
    .get('/api/attendance/device-map')
    .set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);
  assert.equal(hr.status, 403);
  for (const call of fakeDb.calls.slice(callsBefore)) {
    assert.doesNotMatch(call.sql, /device_employee_map/, 'tenant users must never reach the map query');
  }
});

test('editing a mapping is platform-admin only and validated', async () => {
  fakeDb.on(/FROM c_vs\.employees WHERE id/, [{ id: 7 }]);
  fakeDb.on(/INSERT INTO c_vs\.device_employee_map/, []);
  const app = buildApp({ routes: { '/api/attendance': 'attendance' } });

  const hr = await request(app)
    .put('/api/attendance/device-map/16')
    .set('Authorization', `Bearer ${userToken({ role: 'HR' })}`)
    .send({ employee_id: 7 });
  assert.equal(hr.status, 403);

  const bad = await request(app)
    .put('/api/attendance/device-map/16')
    .set('Authorization', `Bearer ${adminToken()}`)
    .set('x-company-slug', 'ftr')
    .send({ employee_id: 'seven' });
  assert.equal(bad.status, 400);

  const ok = await request(app)
    .put('/api/attendance/device-map/16')
    .set('Authorization', `Bearer ${adminToken()}`)
    .set('x-company-slug', 'ftr')
    .send({ employee_id: 7 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.message, 'Mapping saved');

  const unmap = await request(app)
    .put('/api/attendance/device-map/16')
    .set('Authorization', `Bearer ${adminToken()}`)
    .set('x-company-slug', 'ftr')
    .send({ employee_id: null });
  assert.equal(unmap.status, 200);
});
