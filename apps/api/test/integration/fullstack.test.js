/*
 * Full-stack integration check.
 *
 * The unit and security suites replace src/db.js with a fake pool, which is
 * the right call there — it keeps them fast and it keeps them away from a
 * real database. The cost is that nothing in them exercises actual SQL, the
 * tenant schemas, or the wiring between a route and Postgres. This file does.
 *
 * It needs a running API and a seeded database:
 *
 *   npm run db:up && npm run init && npm run seed:validure
 *   npm run dev:api
 *   npm run test:integration --workspace @validurehr/api
 *
 * Without them every test skips rather than fails, so it is safe to run in a
 * checkout where neither is up.
 *
 * SAFETY: it refuses to run unless DATABASE_URL points at localhost. It
 * creates and deletes a company, and that must never happen anywhere near a
 * deployment with real payroll in it.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const API = process.env.INTEGRATION_API_URL || 'http://localhost:5050/api';
const SEED_PASSWORD = process.env.INTEGRATION_SEED_PASSWORD || 'Validure@123';
const PROBE_COMPANY = 'itestco';

const ctx = { up: false, why: '', tokens: {}, admin: null };

function localOnly() {
  const url = process.env.DATABASE_URL || '';
  if (!url) return 'DATABASE_URL is not set';
  let host;
  try { host = new URL(url).hostname; } catch { return 'DATABASE_URL is not a URL'; }
  const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'];
  return local.includes(host) ? null : `refusing to run against ${host} — localhost only`;
}

async function call(path, { token, method = 'GET', body, slug, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (slug) headers['x-company-slug'] = slug;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) return res;
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text.slice(0, 200); }
  return { status: res.status, body: json };
}
const login = (identifier, password) => call('/auth/login', { method: 'POST', body: { identifier, password } });

/** Skips the test with a reason instead of failing when the stack is not up. */
function need(t) {
  if (!ctx.up) { t.skip(ctx.why); return false; }
  return true;
}

before(async () => {
  const unsafe = localOnly();
  if (unsafe) { ctx.why = unsafe; return; }

  try {
    const health = await call('/health');
    if (health.status !== 200) { ctx.why = `API health returned ${health.status}`; return; }
  } catch (e) {
    ctx.why = `API not reachable at ${API} (${e.code || e.message})`;
    return;
  }

  if (!process.env.ADMIN_PASSWORD) { ctx.why = 'ADMIN_PASSWORD is not set'; return; }
  const admin = await login('admin', process.env.ADMIN_PASSWORD);
  if (admin.status !== 200) { ctx.why = `platform admin login returned ${admin.status}`; return; }
  ctx.admin = admin.body.token;

  for (const [role, user] of [['OWNER', 'VS-0101'], ['HR', 'VS-0104'], ['EMPLOYEE', 'VS-0113']]) {
    const r = await login(user, SEED_PASSWORD);
    if (r.status !== 200) { ctx.why = `${role} login returned ${r.status} — is the database seeded?`; return; }
    ctx.tokens[role] = r.body.token;
  }
  ctx.up = true;
});

/* The probe company is created by the isolation tests. Drop it however they
 * end, so a failed run does not poison the next one. */
after(async () => {
  if (!ctx.admin) return;
  const all = await call('/companies/', { token: ctx.admin });
  const stray = Array.isArray(all.body) && all.body.find((c) => c.slug === PROBE_COMPANY);
  if (stray) await call(`/companies/${stray.id}`, { token: ctx.admin, method: 'DELETE' });
});

// ------------------------------------------------------------------- auth
test('a wrong password is refused', async (t) => {
  if (!need(t)) return;
  // One failure only, and the successful logins in before() already reset the
  // counter for these accounts — five in a row would lock them for 15 minutes.
  const r = await login('VS-0113', 'definitely-not-the-password');
  assert.equal(r.status, 401);
});

test('no token, and a forged token, are both refused', async (t) => {
  if (!need(t)) return;
  assert.equal((await call('/employees/')).status, 401);
  assert.equal((await call('/employees/', { token: 'not.a.real.token' })).status, 401);
});

test('/auth/me identifies the caller', async (t) => {
  if (!need(t)) return;
  const r = await call('/auth/me', { token: ctx.tokens.EMPLOYEE });
  assert.equal(r.status, 200);
});

// ------------------------------------------------------------ permissions
test('permissions are granted, not assumed', async (t) => {
  if (!need(t)) return;
  assert.equal((await call('/employees/', { token: ctx.tokens.EMPLOYEE })).status, 403,
    'an EMPLOYEE has no employees.view');
  assert.equal((await call('/admin/audit-logs', { token: ctx.tokens.EMPLOYEE })).status, 403,
    'an EMPLOYEE has no settings.manage');

  const hr = await call('/employees/', { token: ctx.tokens.HR });
  assert.equal(hr.status, 200);
  assert.ok(Array.isArray(hr.body) && hr.body.length > 0, 'HR sees the employee list');
});

test('analytics.view is a distinct grant, and HR does not hold it', async (t) => {
  if (!need(t)) return;
  // Not an oversight in the seed: reports.view and analytics.view are separate
  // keys, and the HR role is given only the first.
  assert.equal((await call('/admin/analytics', { token: ctx.tokens.HR })).status, 403);
  assert.equal((await call('/admin/analytics', { token: ctx.tokens.OWNER })).status, 200);
  assert.equal((await call('/admin/reports/leave-summary', { token: ctx.tokens.HR })).status, 200);
});

test('an employee reads their own record without employees.view', async (t) => {
  if (!need(t)) return;
  const r = await call('/employees/me', { token: ctx.tokens.EMPLOYEE });
  assert.equal(r.status, 200);
  assert.ok(r.body.id, 'the record comes back');
});

test('a tenant user cannot reach platform-admin routes', async (t) => {
  if (!need(t)) return;
  assert.equal((await call('/companies/', { token: ctx.tokens.OWNER })).status, 403);
});

// -------------------------------------------------------------- isolation
test('a second company is provisioned into its own schema, and starts empty', async (t) => {
  if (!need(t)) return;
  let created = await call('/companies/', {
    token: ctx.admin, method: 'POST', body: { name: 'ITest Holdings', slug: PROBE_COMPANY },
  });
  if (created.status === 409) {
    const all = await call('/companies/', { token: ctx.admin });
    created = { status: 201, body: { company: all.body.find((c) => c.slug === PROBE_COMPANY) } };
  }
  assert.equal(created.status, 201);
  assert.equal(created.body.company.schema_name, `c_${PROBE_COMPANY}`);

  const staff = await call('/employees/', { token: ctx.admin, slug: PROBE_COMPANY });
  assert.equal(staff.status, 200);
  assert.equal(staff.body.length, 0, 'a new company has nobody in it');
});

test('a tenant token cannot be pointed at another company', async (t) => {
  if (!need(t)) return;
  // req.s comes from the caller's own token. x-company-slug is only read for
  // platform admins, so this header has to be inert here.
  const own = await call('/employees/', { token: ctx.tokens.HR });
  const crossed = await call('/employees/', { token: ctx.tokens.HR, slug: PROBE_COMPANY });
  assert.equal(crossed.status, 200);
  assert.equal(crossed.body.length, own.body.length,
    'the caller stayed in their own company despite the header');
});

test("a record outside the caller's schema is absent, not forbidden", async (t) => {
  if (!need(t)) return;
  // This is the distinction the marketing site makes: isolation is not a
  // permission check that could be mis-configured, it is that the row is not
  // in the schema the query runs against.
  const r = await call('/documents/salary-slips/999999/pdf', { token: ctx.tokens.EMPLOYEE });
  assert.equal(r.status, 404);
});

test('a payslip is served only to its owner, and only with a session', async (t) => {
  if (!need(t)) return;
  const mine = await call('/documents/salary-slips', { token: ctx.tokens.EMPLOYEE });
  assert.equal(mine.status, 200);
  const slipId = mine.body[0]?.id;
  assert.ok(slipId, 'the seeded employee has a payslip');

  const pdf = await call(`/documents/salary-slips/${slipId}/pdf`, { token: ctx.tokens.EMPLOYEE, raw: true });
  assert.equal(pdf.status, 200);
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), '%PDF', 'a real PDF, not an error page');

  const anon = await call(`/documents/salary-slips/${slipId}/pdf`, { raw: true });
  assert.equal(anon.status, 401, 'no forwardable link');

  const theirs = await call('/documents/salary-slips?employee_id=8', { token: ctx.tokens.HR });
  const otherId = theirs.body?.[0]?.id;
  if (otherId && otherId !== slipId) {
    const denied = await call(`/documents/salary-slips/${otherId}/pdf`, { token: ctx.tokens.EMPLOYEE });
    assert.equal(denied.status, 403, "another employee's slip needs documents.manage");
  }
});

// --------------------------------------------------------- business flows
test('attendance answers for a year and a month', async (t) => {
  if (!need(t)) return;
  // year and month are two integers, not a YYYY-MM string. Getting this wrong
  // produced a period of "2026-2026-01" and records dated 2194.
  const r = await call('/attendance/me?year=2026&month=9', { token: ctx.tokens.EMPLOYEE });
  assert.equal(r.status, 200);
  assert.ok(r.body.period?.from && r.body.period?.to, 'the period has real bounds');
  assert.doesNotMatch(JSON.stringify(r.body), /undefined/);
  assert.equal(typeof r.body.summary.presentDays, 'number');
});

test('the accrual day is derived and has no writer', async (t) => {
  if (!need(t)) return;
  const read = await call('/balances/accrual-day', { token: ctx.tokens.HR });
  assert.equal(read.status, 200);
  assert.equal(typeof read.body.accrual_day, 'number');

  const write = await call('/balances/accrual-day', { token: ctx.tokens.HR, method: 'PUT', body: { day: 3 } });
  assert.ok([404, 405].includes(write.status),
    `storing it would let it drift from the cycle start day, got ${write.status}`);
});

test('the payroll cycle resolves even with no rows in settings', async (t) => {
  if (!need(t)) return;
  // A company that has never opened the settings screen still has to be able
  // to close a month; the cycle falls back to its default.
  const lop = await call('/payroll/lop/2026/9', { token: ctx.tokens.HR });
  assert.equal(lop.status, 200);

  const slips = await call('/documents/salary-slips', { token: ctx.tokens.EMPLOYEE });
  assert.match(slips.body[0].period, /\d{1,2} \w{3} – \d{1,2} \w{3} \d{4}/,
    'the slip spells out the cycle it covers');
});

test('the salary sheet exports as CSV', async (t) => {
  if (!need(t)) return;
  const res = await call('/payroll/export/2026/9', { token: ctx.tokens.HR, raw: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /csv/);
  assert.ok((await res.text()).length > 0);
});

test('the employee-facing screens have something to render', async (t) => {
  if (!need(t)) return;
  for (const path of ['/dashboard/', '/leaves/balance', '/leaves/types',
                      '/documents/policies', '/documents/offer-letters', '/notifications/']) {
    const r = await call(path, { token: ctx.tokens.EMPLOYEE });
    assert.equal(r.status, 200, `${path} returned ${r.status}`);
  }
});

// ------------------------------------------------------------ round trip
test('applying for leave and approving it moves the balance', async (t) => {
  if (!need(t)) return;
  const rows = (r) => (Array.isArray(r) ? r : r?.balances) || [];
  const types = await call('/leaves/types', { token: ctx.tokens.EMPLOYEE });
  const cl = types.body.find((x) => x.code === 'CL');
  assert.ok(cl, 'the seed has a casual leave type');

  const before = rows((await call('/leaves/balance', { token: ctx.tokens.EMPLOYEE })).body)
    .find((b) => b.code === 'CL');
  assert.ok(before, 'the employee has a CL balance row');

  const applied = await call('/leaves/apply', {
    token: ctx.tokens.EMPLOYEE, method: 'POST',
    body: { leave_type_id: cl.id, from_date: '2026-12-18', to_date: '2026-12-18', reason: 'Integration check' },
  });
  assert.ok([200, 201].includes(applied.status), `apply returned ${applied.status}`);
  const id = applied.body.id || applied.body.application?.id;
  assert.ok(id, 'the application has an id');

  try {
    const approved = await call(`/leaves/${id}/approve`, { token: ctx.tokens.HR, method: 'POST', body: {} });
    assert.ok([200, 201].includes(approved.status), `approve returned ${approved.status}`);

    const after = rows((await call('/leaves/balance', { token: ctx.tokens.EMPLOYEE })).body)
      .find((b) => b.code === 'CL');
    assert.ok(Number(after.used) > Number(before.used),
      `the approved day should be drawn from the balance: used ${before.used} -> ${after.used}`);
  } finally {
    await call(`/leaves/${id}`, { token: ctx.tokens.HR, method: 'DELETE' });
  }
});
