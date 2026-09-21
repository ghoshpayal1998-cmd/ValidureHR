/*
 * S-6, through the real route rather than the filter in isolation.
 *
 * Leave attachments are uploadable by ANY authenticated employee — the lowest
 * privilege in the system — and were previously served back inline from an
 * origin the portal shares in single-tunnel mode. That combination is stored
 * XSS against the portal, so the rejection has to happen at the endpoint, not
 * merely in a helper nobody calls.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const path = require('path');

const { fakeDb } = require('../helpers/testEnv');
const { buildApp, userToken, COMPANY } = require('../helpers/testApp');
const { SYSTEM_ROLES } = require(path.join(__dirname, '..', '..', 'src', 'permissions'));

const app = buildApp();
const ME = 5;

function seed({ role = 'EMPLOYEE' } = {}) {
  fakeDb.reset();
  fakeDb.on(/SELECT \* FROM companies WHERE/, [COMPANY]);
  fakeDb.on(/FROM c_\w+\.users u LEFT JOIN c_\w+\.roles r/, [{
    is_active: true, is_locked: false, role_name: role,
    role_perms: JSON.stringify(SYSTEM_ROLES[role] ?? []),
  }]);
  fakeDb.on(/SELECT permission FROM c_\w+\.user_permissions/, []);
}

const asEmployee = () => `Bearer ${userToken({ role: 'EMPLOYEE', employeeId: ME })}`;

/** Posts a leave application with an attached file of the given type. */
function applyWithFile(filename, contentType, body = '<script>alert(document.domain)</script>') {
  return request(app)
    .post('/api/leaves/apply')
    .set('Authorization', asEmployee())
    .field('leave_type_id', '1')
    .field('from_date', '2026-09-01')
    .field('to_date', '2026-09-01')
    .field('reason', 'test')
    .attach('document', Buffer.from(body), { filename, contentType });
}

test('an HTML leave attachment is rejected at the endpoint', async () => {
  seed();
  const res = await applyWithFile('payload.html', 'text/html');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not accepted/);
});

test('an SVG leave attachment is rejected', async () => {
  seed();
  const res = await applyWithFile('logo.svg', 'image/svg+xml', '<svg onload="alert(1)"></svg>');
  assert.equal(res.status, 400);
});

test('a script disguised with a PDF content type is rejected on its extension', async () => {
  seed();
  const res = await applyWithFile('payload.html', 'application/pdf');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /does not match/);
});

test('the rejection is a 400 with a readable reason, not an opaque 500', async () => {
  // The multer error has to reach the error handler as a client error, or an
  // employee just sees "Internal server error" and files a bug.
  seed();
  const res = await applyWithFile('x.exe', 'application/x-msdownload');
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
  assert.doesNotMatch(res.body.error, /Internal server error/);
});

test('a PDF attachment passes the filter and reaches the handler', async () => {
  // Proves the filter is not simply rejecting everything: this one gets past
  // the upload stage and fails later, on business validation.
  seed();
  fakeDb.on(/FROM c_\w+\.holidays/, []);
  fakeDb.on(/FROM c_\w+\.leave_types WHERE id=\$1/, [{ code: 'CL' }]);
  fakeDb.on(/FROM c_\w+\.employees WHERE id=\$1/, [{ probation_until: null }]);
  fakeDb.on(/FROM c_\w+\.leave_balances WHERE employee_id=\$1/, []);

  const res = await applyWithFile('certificate.pdf', 'application/pdf', '%PDF-1.4 test');
  assert.equal(res.status, 400);
  // "No leave balance found" is the business check, i.e. the upload was accepted.
  assert.match(res.body.error, /No leave balance found/);
});

test('an unauthenticated upload is refused before any file is stored', async () => {
  seed();
  const res = await request(app)
    .post('/api/leaves/apply')
    .attach('document', Buffer.from('x'), { filename: 'a.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 401);
});

test('an employee cannot upload a company policy document', async () => {
  seed();
  const res = await request(app)
    .post('/api/documents/policies')
    .set('Authorization', asEmployee())
    .field('title', 'Fake Policy')
    .field('category', 'HR')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'p.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /documents\.manage/);
});

test('an employee cannot upload a salary slip for themselves', async () => {
  seed();
  const res = await request(app)
    .post('/api/documents/salary-slips/upload')
    .set('Authorization', asEmployee())
    .field('employee_id', String(ME))
    .field('month', '7')
    .field('year', '2026')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 's.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 403);
});
