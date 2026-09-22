/*
 * Object-level authorization.
 *
 * This is a multi-tenant HRMS holding PAN numbers, bank account details and
 * salary data. Permission checks answer "may this role use this feature";
 * these tests answer the separate question "may this user reach THIS record" —
 * the class of bug where an employee changes an id in a URL and reads someone
 * else's payslip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const path = require('path');

const { fakeDb } = require('../helpers/testEnv');
const { buildApp, userToken, COMPANY } = require('../helpers/testApp');
const { SYSTEM_ROLES } = require(path.join(__dirname, '..', '..', 'src', 'permissions'));

const app = buildApp();

const ME = 5;      // the caller's employee id
const SOMEONE_ELSE = 99;

function seed({ role = 'EMPLOYEE', grants = [] } = {}) {
  fakeDb.reset();
  fakeDb.on(/SELECT \* FROM companies WHERE/, [COMPANY]);
  fakeDb.on(/FROM c_\w+\.users u LEFT JOIN c_\w+\.roles r/, [{
    is_active: true, is_locked: false, role_name: role,
    role_perms: JSON.stringify(SYSTEM_ROLES[role] ?? []),
  }]);
  fakeDb.on(/SELECT permission FROM c_\w+\.user_permissions/, grants.map((permission) => ({ permission })));
}

const asEmployee = () => `Bearer ${userToken({ role: 'EMPLOYEE', employeeId: ME })}`;

/* ---------------- Salary slips ---------------- */

test('an employee cannot download another employee\'s salary slip', async () => {
  seed({ role: 'EMPLOYEE' });
  fakeDb.on(/FROM c_\w+\.salary_slips s/, [{
    id: 77, employee_id: SOMEONE_ELSE, emp_code: 'FTRN001', name: 'Someone Else',
    month: 7, year: 2026, net_pay: 100000, file_name: null,
    pan_no: 'ABCDE1234F', bank_account_no: '123456789',
  }]);

  const res = await request(app).get('/api/documents/salary-slips/77/pdf').set('Authorization', asEmployee());
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'Not allowed');
});

test('the refused salary-slip response leaks no PII', async () => {
  seed({ role: 'EMPLOYEE' });
  fakeDb.on(/FROM c_\w+\.salary_slips s/, [{
    id: 77, employee_id: SOMEONE_ELSE, emp_code: 'FTRN001', name: 'Someone Else',
    month: 7, year: 2026, net_pay: 100000, file_name: null,
    pan_no: 'ABCDE1234F', bank_account_no: '123456789', bank_ifsc: 'HDFC0001234',
  }]);

  const res = await request(app).get('/api/documents/salary-slips/77/pdf').set('Authorization', asEmployee());
  const body = JSON.stringify(res.body);
  for (const secret of ['ABCDE1234F', '123456789', 'HDFC0001234', '100000', 'Someone Else']) {
    assert.doesNotMatch(body, new RegExp(secret), `response leaked "${secret}"`);
  }
});

test('an employee can download their own salary slip', async () => {
  seed({ role: 'EMPLOYEE' });
  fakeDb.on(/FROM c_\w+\.salary_slips s/, [{
    id: 78, employee_id: ME, emp_code: 'FTRN020', name: 'Me',
    month: 7, year: 2026, net_pay: null, file_name: null,
  }]);

  const res = await request(app).get('/api/documents/salary-slips/78/pdf').set('Authorization', asEmployee());
  // net_pay null and no uploaded file -> 400, but crucially NOT 403: the
  // ownership check passed.
  assert.equal(res.status, 400);
});

test('an employee cannot list another employee\'s salary slips via a query parameter', async () => {
  // ?employee_id= is only honoured for documents.manage holders.
  seed({ role: 'EMPLOYEE' });
  const queried = [];
  fakeDb.on(/FROM c_\w+\.salary_slips/, (sql, params) => { queried.push(params[0]); return []; });

  const res = await request(app)
    .get(`/api/documents/salary-slips?employee_id=${SOMEONE_ELSE}`)
    .set('Authorization', asEmployee());

  assert.equal(res.status, 200);
  assert.deepEqual(queried, [ME], 'the query must be scoped to the caller, not the parameter');
});

/* ---------------- Offer letters ---------------- */

test('an employee cannot download another employee\'s offer letter', async () => {
  seed({ role: 'EMPLOYEE' });
  fakeDb.on(/FROM c_\w+\.offer_letters/, [{ id: 3, employee_id: SOMEONE_ELSE, title: 'Offer', file_name: 'x.pdf' }]);

  const res = await request(app).get('/api/documents/offer-letters/3/file').set('Authorization', asEmployee());
  assert.equal(res.status, 403);
});

test('an employee listing offer letters only sees their own', async () => {
  seed({ role: 'EMPLOYEE' });
  const queried = [];
  fakeDb.on(/FROM c_\w+\.offer_letters/, (sql, params) => { queried.push({ sql, params }); return []; });

  const res = await request(app).get('/api/documents/offer-letters').set('Authorization', asEmployee());
  assert.equal(res.status, 200);
  assert.equal(queried.length, 1);
  assert.match(queried[0].sql, /WHERE employee_id=\$1/);
  assert.deepEqual(queried[0].params, [ME]);
});

/* ---------------- Leave attachments ---------------- */

test('an employee cannot read another employee\'s leave attachment', async () => {
  seed({ role: 'EMPLOYEE' });
  fakeDb.on(/FROM c_\w+\.leave_applications WHERE id=\$1/, [{
    id: 12, employee_id: SOMEONE_ELSE, attachment_file: 'medical-certificate.pdf',
  }]);

  const res = await request(app).get('/api/leaves/12/attachment').set('Authorization', asEmployee());
  assert.equal(res.status, 403);
});

test('an approver can read a leave attachment they need to judge', async () => {
  seed({ role: 'HR' });
  fakeDb.on(/FROM c_\w+\.leave_applications WHERE id=\$1/, [{
    id: 12, employee_id: SOMEONE_ELSE, attachment_file: 'note.pdf',
  }]);

  const res = await request(app)
    .get('/api/leaves/12/attachment')
    .set('Authorization', `Bearer ${userToken({ role: 'HR', employeeId: ME })}`);
  // The file is not on disk in the test, so 404 — but not 403.
  assert.equal(res.status, 404);
  assert.match(res.body.error, /File missing on server/);
});

/* ---------------- Leave applications ---------------- */

test('an employee cannot edit someone else\'s leave application', async () => {
  seed({ role: 'EMPLOYEE' });
  fakeDb.on(/FROM c_\w+\.leave_applications WHERE id=\$1/, [{
    id: 20, employee_id: SOMEONE_ELSE, status: 'Pending', from_date: '2026-09-01', to_date: '2026-09-02',
  }]);

  const res = await request(app)
    .put('/api/leaves/20')
    .set('Authorization', asEmployee())
    .send({ reason: 'changed by someone else' });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /only edit your own/);
});

test('an employee cannot cancel someone else\'s leave application', async () => {
  seed({ role: 'EMPLOYEE' });
  fakeDb.on(/FROM c_\w+\.leave_applications WHERE id=\$1/, [{
    id: 21, employee_id: SOMEONE_ELSE, status: 'Pending',
  }]);

  const res = await request(app).delete('/api/leaves/21').set('Authorization', asEmployee());
  assert.equal(res.status, 403);
});

test('an employee cannot approve their own leave application', async () => {
  // Granting the permission alone must not defeat separation of duties.
  seed({ role: 'EMPLOYEE', grants: ['leaves.approve'] });
  fakeDb.on(/FROM c_\w+\.leave_applications WHERE id=\$1/, [{
    id: 22, employee_id: ME, status: 'Pending', days: 1,
  }]);

  const res = await request(app).post('/api/leaves/22/approve').set('Authorization', asEmployee());
  assert.equal(res.status, 403);
  assert.match(res.body.error, /cannot approve your own/);
});

test('an employee cannot reject their own leave application', async () => {
  seed({ role: 'EMPLOYEE', grants: ['leaves.approve'] });
  fakeDb.on(/FROM c_\w+\.leave_applications WHERE id=\$1/, [{
    id: 23, employee_id: ME, status: 'Pending',
  }]);

  const res = await request(app)
    .post('/api/leaves/23/reject')
    .set('Authorization', asEmployee())
    .send({ reason: 'no' });
  assert.equal(res.status, 403);
});

test('an already-decided leave cannot be approved a second time', async () => {
  // A double approval would deduct the balance twice.
  seed({ role: 'HR' });
  fakeDb.on(/FROM c_\w+\.leave_applications WHERE id=\$1/, [{
    id: 24, employee_id: SOMEONE_ELSE, status: 'Approved', days: 2,
  }]);

  const res = await request(app)
    .post('/api/leaves/24/approve')
    .set('Authorization', `Bearer ${userToken({ role: 'HR', employeeId: ME })}`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Cannot approve an application that is Approved/);
});

test('an employee\'s own leave history is scoped to them', async () => {
  seed({ role: 'EMPLOYEE' });
  const queried = [];
  fakeDb.on(/FROM c_\w+\.leave_applications la/, (sql, params) => { queried.push({ sql, params }); return []; });

  const res = await request(app).get('/api/leaves/history').set('Authorization', asEmployee());
  assert.equal(res.status, 200);
  assert.match(queried[0].sql, /WHERE la\.employee_id=\$1/);
  assert.deepEqual(queried[0].params, [ME]);
});

test('an employee cannot list all leave applications', async () => {
  seed({ role: 'EMPLOYEE' });
  const res = await request(app).get('/api/leaves').set('Authorization', asEmployee());
  assert.equal(res.status, 403);
  assert.match(res.body.error, /leaves\.view_all/);
});

/* ---------------- Own-record endpoints ---------------- */

test('an account with no employee profile cannot read leave balances', async () => {
  seed({ role: 'HR' });
  const res = await request(app)
    .get('/api/leaves/balance')
    .set('Authorization', `Bearer ${userToken({ role: 'HR', employeeId: null })}`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /No employee profile/);
});

test('leave balances are scoped to the caller', async () => {
  seed({ role: 'EMPLOYEE' });
  const queried = [];
  fakeDb.on(/FROM c_\w+\.leave_types lt/, (sql, params) => { queried.push(params); return []; });
  fakeDb.on(/FROM c_\w+\.employees WHERE id=\$1/, [{ probation_until: null }]);
  fakeDb.on(/FROM c_\w+\.leave_ledger l/, []);

  const res = await request(app).get('/api/leaves/balance').set('Authorization', asEmployee());
  assert.equal(res.status, 200);
  assert.deepEqual(queried[0], [ME]);
});

test('own attendance is scoped to the caller', async () => {
  seed({ role: 'EMPLOYEE' });
  const queried = [];
  fakeDb.on(/FROM c_\w+\.attendance WHERE employee_id=\$1/, (sql, params) => { queried.push(params); return []; });
  fakeDb.on(/FROM c_\w+\.holidays/, []);
  // /me also merges the caller's own biometric device times — same scoping rule.
  const deviceQueried = [];
  fakeDb.on(/FROM c_\w+\.device_attendance/, (sql, params) => { deviceQueried.push(params); return []; });

  const res = await request(app).get('/api/attendance/me?year=2026&month=8').set('Authorization', asEmployee());
  assert.equal(res.status, 200);
  assert.equal(queried[0][0], ME);
  assert.equal(deviceQueried[0][0], ME, 'device times must be scoped to the caller too');
});

test('an employee cannot read another employee\'s attendance', async () => {
  seed({ role: 'EMPLOYEE' });
  const res = await request(app)
    .get(`/api/attendance/employee/${SOMEONE_ELSE}?year=2026&month=8`)
    .set('Authorization', asEmployee());
  assert.equal(res.status, 403);
  assert.match(res.body.error, /attendance\.view_all/);
});

test('an employee cannot mark attendance', async () => {
  seed({ role: 'EMPLOYEE' });
  const res = await request(app)
    .put(`/api/attendance/${ME}/2026-08-05`)
    .set('Authorization', asEmployee())
    .send({ status: 'Present' });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /attendance\.manage/);
});

test('an employee cannot bulk-mark attendance', async () => {
  seed({ role: 'EMPLOYEE' });
  const res = await request(app)
    .post('/api/attendance/bulk')
    .set('Authorization', asEmployee())
    .send({ date: '2026-08-05', entries: [{ employee_id: ME, status: 'Present' }] });
  assert.equal(res.status, 403);
});

test('attendance cannot be marked with a status outside the allowed set', async () => {
  // The column has a CHECK constraint; rejecting here keeps it a 400 rather
  // than a constraint violation surfacing as a 500.
  seed({ role: 'HR' });
  const res = await request(app)
    .put(`/api/attendance/${ME}/2026-08-05`)
    .set('Authorization', `Bearer ${userToken({ role: 'HR', employeeId: ME })}`)
    .send({ status: 'Vacation' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Invalid status/);
});

test('attendance cannot be marked for a future date', async () => {
  seed({ role: 'HR' });
  const farFuture = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const res = await request(app)
    .put(`/api/attendance/${ME}/${farFuture}`)
    .set('Authorization', `Bearer ${userToken({ role: 'HR', employeeId: ME })}`)
    .send({ status: 'Present' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /future date/);
});
