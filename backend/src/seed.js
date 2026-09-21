/*
 * DEMO DATA seeder (optional, development/testing only).
 * Creates a "Demo Corp" company with a small team so every feature can be tried.
 * Safe to re-run: it drops and recreates only the demo company.
 * Usage: npm run seed:demo
 */
const bcrypt = require('bcryptjs');
const { q, qOne, tq, tqOne, pool, initSchema, createTenantSchema } = require('./db');
const { ensureCompanyDirs } = require('./storage');
const { ym } = require('./accrual');

const SLUG = 'demo';
const SCHEMA = `c_${SLUG}`;

(async () => {
  await initSchema();

  // recreate the demo company from scratch
  const existing = await qOne('SELECT * FROM companies WHERE slug=$1', [SLUG]);
  if (existing) {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await q('DELETE FROM user_directory WHERE company_id=$1', [existing.id]);
    await q('DELETE FROM companies WHERE id=$1', [existing.id]);
  }
  const company = await qOne(
    `INSERT INTO companies (name, slug, schema_name) VALUES ('Demo Corp',$1,$2) RETURNING *`, [SLUG, SCHEMA]);
  await createTenantSchema(SCHEMA);
  ensureCompanyDirs(SLUG);

  // The system roles are NOT inserted here: createTenantSchema above already
  // calls syncSystemRoles, which is the one authoritative writer of those rows
  // and is idempotent. Inserting them a second time hit the unique index on
  // roles.name and aborted the whole seed with "duplicate key ... (name)=(OWNER)".
  for (const [n, code, rate] of [['Casual Leave', 'CL', 1], ['Earned Leave', 'EL', 1.5], ['Sick Leave', 'SL', 0.75], ['Comp Off', 'CO', 0]]) {
    await tq(SCHEMA, `INSERT INTO {s}.leave_types (name, code, monthly_accrual) VALUES ($1,$2,$3)`, [n, code, rate]);
  }
  for (const d of ['Engineering', 'Human Resources', 'Finance']) {
    await tq(SCHEMA, 'INSERT INTO {s}.departments (name) VALUES ($1)', [d]);
  }
  for (const t of ['Director', 'HR Manager', 'Tech Lead', 'Software Engineer', 'Accountant']) {
    await tq(SCHEMA, 'INSERT INTO {s}.designations (title) VALUES ($1)', [t]);
  }
  for (const [date, name] of [['2026-08-15', 'Independence Day'], ['2026-10-02', 'Gandhi Jayanti'], ['2026-11-08', 'Diwali'], ['2026-12-25', 'Christmas']]) {
    await tq(SCHEMA, 'INSERT INTO {s}.holidays (date, name) VALUES ($1,$2)', [date, name]);
  }

  const deptId = async (n) => (await tqOne(SCHEMA, 'SELECT id FROM {s}.departments WHERE name=$1', [n])).id;
  const desigId = async (t) => (await tqOne(SCHEMA, 'SELECT id FROM {s}.designations WHERE title=$1', [t])).id;
  const roleId = async (n) => (await tqOne(SCHEMA, 'SELECT id FROM {s}.roles WHERE name=$1', [n])).id;

  const hash = bcrypt.hashSync('Demo@123', 10);
  // [code, first, last, doj, dob, dept, desig, role, managerCode]
  const people = [
    ['DEMO001', 'Rajiv', 'Khanna', '2020-04-01', '1975-02-18', 'Engineering', 'Director', 'DIRECTOR', null],
    ['DEMO002', 'Priya', 'Sharma', '2021-06-15', '1988-07-22', 'Human Resources', 'HR Manager', 'HR', 'DEMO001'],
    ['DEMO003', 'Arjun', 'Mehta', '2021-01-10', '1990-11-05', 'Engineering', 'Tech Lead', 'EMPLOYEE', 'DEMO001'],
    ['DEMO004', 'Sneha', 'Iyer', '2022-03-01', '1993-04-30', 'Engineering', 'Software Engineer', 'EMPLOYEE', 'DEMO003'],
    ['DEMO005', 'Kavita', 'Nair', '2023-05-09', '1994-07-14', 'Finance', 'Accountant', 'EMPLOYEE', 'DEMO001'],
  ];
  for (const [code, fn, ln, doj, dob, dept, desig, role, mgr] of people) {
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}@democorp.test`;
    const mgrId = mgr ? (await tqOne(SCHEMA, 'SELECT id FROM {s}.employees WHERE emp_code=$1', [mgr])).id : null;
    const emp = await tqOne(SCHEMA, `
      INSERT INTO {s}.employees (emp_code, first_name, last_name, phone, email, doj, dob, department_id, designation_id, reporting_manager_id)
      VALUES ($1,$2,$3,'+91 98100 00000',$4,$5,$6,$7,$8,$9) RETURNING id`,
      [code, fn, ln, email, doj, dob, await deptId(dept), await desigId(desig), mgrId]);
    const user = await tqOne(SCHEMA,
      `INSERT INTO {s}.users (username, email, password_hash, role_id, employee_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [code, email, hash, await roleId(role), emp.id]);
    await q('INSERT INTO user_directory (email, username, company_id, tenant_user_id) VALUES ($1,$2,$3,$4)',
      [email, code, company.id, user.id]);
    // balances with a few months of history already accrued
    await tq(SCHEMA, `
      INSERT INTO {s}.leave_balances (employee_id, leave_type_id, accrued, used, last_accrued)
      SELECT $1, id, monthly_accrual * 6, 0, $2 FROM {s}.leave_types`, [emp.id, ym()]);
  }

  // current-month attendance (weekdays Present, one late mark each)
  const now = new Date();
  const emps = await tq(SCHEMA, 'SELECT id FROM {s}.employees');
  for (const e of emps) {
    for (let d = new Date(now.getFullYear(), now.getMonth(), 1); d <= now; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      const status = dow === 0 || dow === 6 ? 'Weekend' : 'Present';
      await tq(SCHEMA, `
        INSERT INTO {s}.attendance (employee_id, date, status, check_in, check_out, late_mark)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [e.id, ds, status, status === 'Present' ? '09:15' : null, status === 'Present' ? '18:10' : null, false]);
    }
  }

  // one pending leave application (Sneha) so the approval inbox has content
  const sneha = await tqOne(SCHEMA, `SELECT id FROM {s}.employees WHERE emp_code='DEMO004'`);
  const cl = await tqOne(SCHEMA, `SELECT id FROM {s}.leave_types WHERE code='CL'`);
  await tq(SCHEMA, `
    INSERT INTO {s}.leave_applications (employee_id, leave_type_id, from_date, to_date, days, reason, status)
    VALUES ($1,$2,'2026-08-03','2026-08-04',2,'Family function','Pending')`, [sneha.id, cl.id]);

  await tq(SCHEMA, `INSERT INTO {s}.announcements (title, body, date) VALUES
    ('Welcome to Demo Corp','This is a demo company seeded for evaluation.', $1)`,
    [now.toISOString().slice(0, 10)]);

  console.log('Demo seed complete.');
  console.log('Platform admin -> admin / Admin@123 (run npm run init first if missing)');
  console.log('Demo Corp logins (password Demo@123):');
  console.log('  DEMO001 Rajiv (DIRECTOR) | DEMO002 Priya (HR) | DEMO003 Arjun (manager) | DEMO004/5 employees');
  await pool.end();
})().catch((e) => { console.error('Seed failed:', e); process.exit(1); });
