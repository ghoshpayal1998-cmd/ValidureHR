/*
 * Authorization: who may do what, and in which company.
 *
 * Covers S-7 (a role's permissions come from its own list, with OWNER and
 * DIRECTOR holding everything), tenant isolation (a token for one company must
 * not reach another), and B-1 (an unparseable id is a 400, not a 500).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const path = require('path');

const { fakeDb } = require('../helpers/testEnv');
const { buildApp, adminToken, userToken, COMPANY } = require('../helpers/testApp');
const { SYSTEM_ROLES, ALL_KEYS } = require(path.join(__dirname, '..', '..', 'src', 'permissions'));

const app = buildApp();

/**
 * Wires the fake DB for a tenant user with the given role, so the `tenant`
 * middleware resolves the company and loads permissions exactly as in production.
 */
function seedTenantUser({ role = 'EMPLOYEE', grants = [], company = COMPANY, active = true, locked = false } = {}) {
  fakeDb.reset();
  fakeDb.on(/SELECT \* FROM companies WHERE/, [company]);
  fakeDb.on(/FROM c_\w+\.users u LEFT JOIN c_\w+\.roles r/, [{
    is_active: active,
    is_locked: locked,
    role_name: role,
    role_perms: JSON.stringify(SYSTEM_ROLES[role] ?? []),
  }]);
  fakeDb.on(/SELECT permission FROM c_\w+\.user_permissions/, grants.map((permission) => ({ permission })));
}

/* ---------------- Permission enforcement ---------------- */

test('an EMPLOYEE cannot list employees', async () => {
  seedTenantUser({ role: 'EMPLOYEE' });
  const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${userToken({ role: 'EMPLOYEE' })}`);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Missing permission: employees\.view/);
});

test('an EMPLOYEE cannot create an employee', async () => {
  seedTenantUser({ role: 'EMPLOYEE' });
  const res = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${userToken({ role: 'EMPLOYEE' })}`)
    .send({ emp_code: 'X1', first_name: 'A', last_name: 'B', email: 'a@b.c', doj: '2020-01-01', dob: '1990-01-01' });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /employees\.manage/);
});

test('an EMPLOYEE cannot read the approval inbox', async () => {
  seedTenantUser({ role: 'EMPLOYEE' });
  const res = await request(app).get('/api/leaves/pending').set('Authorization', `Bearer ${userToken({ role: 'EMPLOYEE' })}`);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /leaves\.approve/);
});

test('an EMPLOYEE cannot read the audit log', async () => {
  seedTenantUser({ role: 'EMPLOYEE' });
  const res = await request(app).get('/api/admin/audit-logs').set('Authorization', `Bearer ${userToken({ role: 'EMPLOYEE' })}`);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /settings\.manage/);
});

test('a DIRECTOR can manage employees — company administrator, via the role list', async () => {
  // This is the behaviour the middleware used to grant by special case. It now
  // comes from SYSTEM_ROLES.DIRECTOR, which is what makes it visible in Access
  // Control and what these tests actually verify.
  seedTenantUser({ role: 'DIRECTOR' });
  fakeDb.on(/FROM c_\w+\.employees e/, []);
  const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${userToken({ role: 'DIRECTOR' })}`);
  assert.equal(res.status, 200);
});

test('an OWNER can manage employees', async () => {
  seedTenantUser({ role: 'OWNER' });
  fakeDb.on(/FROM c_\w+\.employees e/, []);
  const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${userToken({ role: 'OWNER' })}`);
  assert.equal(res.status, 200);
});

test('a DIRECTOR reaches every permission-gated route', async () => {
  // Walk the whole permission catalogue rather than spot-checking one route.
  for (const key of ALL_KEYS) {
    assert.ok(SYSTEM_ROLES.DIRECTOR.includes(key), `DIRECTOR cannot ${key}`);
    assert.ok(SYSTEM_ROLES.OWNER.includes(key), `OWNER cannot ${key}`);
  }
});

test('an individual grant lifts a single restriction and nothing more', async () => {
  seedTenantUser({ role: 'EMPLOYEE', grants: ['employees.view'] });
  fakeDb.on(/FROM c_\w+\.employees e/, []);
  const token = `Bearer ${userToken({ role: 'EMPLOYEE' })}`;

  const allowed = await request(app).get('/api/employees').set('Authorization', token);
  assert.equal(allowed.status, 200, 'the granted permission should work');

  const denied = await request(app).get('/api/leaves/pending').set('Authorization', token);
  assert.equal(denied.status, 403, 'an unrelated permission must stay denied');
});

test('a role whose stored permissions are corrupt grants nothing', async () => {
  fakeDb.reset();
  fakeDb.on(/SELECT \* FROM companies WHERE/, [COMPANY]);
  fakeDb.on(/FROM c_\w+\.users u LEFT JOIN c_\w+\.roles r/, [{
    is_active: true, is_locked: false, role_name: 'HR', role_perms: 'not-json',
  }]);
  fakeDb.on(/SELECT permission FROM c_\w+\.user_permissions/, []);
  const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);
  assert.equal(res.status, 403, 'unparseable permissions must fail closed');
});

test('a role cannot invent a permission key that is not in the catalogue', async () => {
  fakeDb.reset();
  fakeDb.on(/SELECT \* FROM companies WHERE/, [COMPANY]);
  fakeDb.on(/FROM c_\w+\.users u LEFT JOIN c_\w+\.roles r/, [{
    is_active: true, is_locked: false, role_name: 'CUSTOM',
    role_perms: JSON.stringify(['employees.view.all', '*', 'admin']),
  }]);
  fakeDb.on(/SELECT permission FROM c_\w+\.user_permissions/, []);
  const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${userToken({ role: 'CUSTOM' })}`);
  assert.equal(res.status, 403);
});

/* ---------------- Account state ---------------- */

test('a disabled account is refused even with a valid token', async () => {
  seedTenantUser({ role: 'HR', active: false });
  const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /disabled or locked/);
});

test('a locked account is refused even with a valid token', async () => {
  // The token outlives the lock — HR locking someone out must take effect
  // immediately, not at the next login.
  seedTenantUser({ role: 'HR', locked: true });
  const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);
  assert.equal(res.status, 403);
});

test('a suspended company blocks all its users', async () => {
  seedTenantUser({ role: 'HR', company: { ...COMPANY, status: 'Suspended' } });
  const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /suspended/);
});

/* ---------------- Tenant isolation ---------------- */

test('a tenant token cannot select another company with x-company-slug', async () => {
  // The header is only honoured for platform admins. A tenant user's company
  // comes from their token, so sending the header must change nothing.
  const otherCompany = { id: 2, name: 'Other Co', slug: 'oth', schema_name: 'c_oth', status: 'Active' };
  fakeDb.reset();
  const companyLookups = [];
  fakeDb.on(/SELECT \* FROM companies WHERE id=\$1/, (sql, params) => {
    companyLookups.push(params[0]);
    return [COMPANY];
  });
  fakeDb.on(/SELECT \* FROM companies WHERE slug=\$1/, [otherCompany]);
  fakeDb.on(/FROM c_\w+\.users u LEFT JOIN c_\w+\.roles r/, [{
    is_active: true, is_locked: false, role_name: 'HR', role_perms: JSON.stringify(SYSTEM_ROLES.HR),
  }]);
  fakeDb.on(/SELECT permission FROM c_\w+\.user_permissions/, []);
  const seen = [];
  fakeDb.on(/FROM c_\w+\.employees e/, (sql) => { seen.push(sql); return []; });

  const res = await request(app)
    .get('/api/employees')
    .set('Authorization', `Bearer ${userToken({ role: 'HR', companyId: 1 })}`)
    .set('x-company-slug', 'oth');

  assert.equal(res.status, 200);
  assert.deepEqual(companyLookups, [1], 'company must be resolved from the token, not the header');
  assert.ok(seen.length > 0);
  for (const sql of seen) {
    assert.match(sql, /c_vs\./, 'queries must target the token\'s schema');
    assert.doesNotMatch(sql, /c_oth\./, 'a tenant user must never reach another schema');
  }
});

test('a platform admin without x-company-slug is refused, not defaulted', async () => {
  fakeDb.reset();
  const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /No company selected/);
});

test('a platform admin naming an unknown company gets a 404', async () => {
  fakeDb.reset();
  fakeDb.on(/SELECT \* FROM companies WHERE slug=\$1/, []);
  const res = await request(app)
    .get('/api/employees')
    .set('Authorization', `Bearer ${adminToken()}`)
    .set('x-company-slug', 'nope');
  assert.equal(res.status, 404);
});

test('an injection attempt in x-company-slug does not reach a query', async () => {
  fakeDb.reset();
  fakeDb.on(/SELECT \* FROM companies WHERE slug=\$1/, (sql, params) => {
    // The slug is parameterised, so it arrives as a value, never as SQL.
    assert.match(sql, /\$1/);
    return [];
  });
  const res = await request(app)
    .get('/api/employees')
    .set('Authorization', `Bearer ${adminToken()}`)
    .set('x-company-slug', "ftr'; DROP SCHEMA c_vs CASCADE; --");
  assert.equal(res.status, 404);
});

test('the tenant schema name is validated before it reaches SQL', async () => {
  // schema_name is interpolated into SQL by ts(), not parameterised, so it is
  // the one identifier that must be pattern-checked.
  const { assertSchema } = require(path.join(__dirname, '..', '..', 'src', 'db'));
  assert.equal(assertSchema('c_vs'), 'c_vs');
  for (const bad of ['public', 'c_', 'c_FTR', 'c_vs; DROP', 'c_vs--', '', 'x_ftr']) {
    assert.throws(() => assertSchema(bad), /Invalid tenant schema/, `"${bad}" should be rejected`);
  }
});

/* ---------------- B-1: id validation ---------------- */

test('a non-numeric employee id returns 400, not a 500', async () => {
  /*
   * "me" is deliberately NOT in this list any more: it used to fall through to
   * /employees/:id and blow up in the pg driver, and now matches the real /me
   * route declared above it (covered by the two tests below). Everything else
   * unparseable must still be a client error rather than a server one.
   */
  seedTenantUser({ role: 'HR' });
  for (const badId of ['abc', '1;DROP', '1e5', '-1', 'null', '1.5']) {
    const res = await request(app)
      .get(`/api/employees/${encodeURIComponent(badId)}`)
      .set('Authorization', `Bearer ${userToken({ role: 'HR' })}`);
    assert.equal(res.status, 400, `id "${badId}" produced a ${res.status}`);
    assert.match(res.body.error, /must be a number/);
  }
});

test('GET /employees/me returns the caller\'s own record without employees.view', async () => {
  seedTenantUser({ role: 'EMPLOYEE' });
  fakeDb.on(/FROM c_\w+\.employees e/, [{ id: 5, emp_code: 'FTRN020', first_name: 'Test', last_name: 'User' }]);
  const res = await request(app).get('/api/employees/me').set('Authorization', `Bearer ${userToken({ role: 'EMPLOYEE', employeeId: 5 })}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.emp_code, 'FTRN020');
});

test('GET /employees/me is a 404 for an account with no employee profile', async () => {
  seedTenantUser({ role: 'HR' });
  const res = await request(app).get('/api/employees/me').set('Authorization', `Bearer ${userToken({ role: 'HR', employeeId: null })}`);
  assert.equal(res.status, 404);
});

/* ---------------- Platform-admin-only surface ---------------- */

test('a tenant user cannot reach platform-admin routes', async () => {
  seedTenantUser({ role: 'DIRECTOR' });
  const token = `Bearer ${userToken({ role: 'DIRECTOR' })}`;

  // Even a company administrator is not a PLATFORM admin — company creation and
  // deletion sit above the tenant boundary.
  const list = await request(app).get('/api/companies').set('Authorization', token);
  assert.equal(list.status, 403);
  assert.match(list.body.error, /Platform admin access required/);

  const create = await request(app).post('/api/companies').set('Authorization', token).send({ name: 'Evil Corp' });
  assert.equal(create.status, 403);

  const destroy = await request(app).delete('/api/companies/1').set('Authorization', token);
  assert.equal(destroy.status, 403);
});

test('role management is platform-admin only', async () => {
  seedTenantUser({ role: 'DIRECTOR' });
  const token = `Bearer ${userToken({ role: 'DIRECTOR' })}`;
  const res = await request(app).post('/api/access/roles').set('Authorization', token).send({ name: 'SUPER', permissions: [] });
  assert.equal(res.status, 403);
});
