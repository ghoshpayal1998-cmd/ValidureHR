/*
 * ValidureHR demo seed — Validure Solutions Pvt. Ltd.
 *
 * This is the same company, people and numbers the clickable mockup
 * shows (mockup/assets/js/data.js), so the running product and the
 * design reference tell the same story: 24 employees, six leave types,
 * a night shift, and enough history that every screen has something in
 * it on first boot instead of an empty state.
 *
 * Safe to re-run: it drops and recreates only this one company.
 * Usage: npm run seed:validure
 */
const bcrypt = require('bcryptjs');
const { q, qOne, tq, tqOne, pool, initSchema, createTenantSchema } = require('./db');
const { ensureCompanyDirs } = require('./storage');
const { ym } = require('./accrual');

const SLUG = 'vs';
const SCHEMA = `c_${SLUG}`;
const DOMAIN = 'validuresolutions.com';
const PASSWORD = 'Validure@123';

/* The shift runs 19:00–04:00 IST, so a punch-out lands on the calendar
 * day after the punch-in. Attendance is keyed on the shift's START
 * date, never on the raw timestamp — the same rule the API applies. */
const SHIFT_IN = '19:00';
const SHIFT_OUT = '04:00';

const DEPARTMENTS = [
  'Engineering', 'Infrastructure', 'Quality', 'Design', 'Data', 'Delivery',
  'People', 'Finance', 'Marketing', 'Sales', 'Product', 'Support',
];

const DESIGNATIONS = [
  'Software Engineer', 'Senior Software Engineer', 'Tech Lead', 'Engineering Manager',
  'QA Engineer', 'QA Lead', 'DevOps Engineer', 'Cloud Architect', 'Solution Architect',
  'Data Engineer', 'Database Administrator', 'UI/UX Designer', 'Product Manager',
  'Business Analyst', 'HR Manager', 'Talent Acquisition', 'Finance Executive',
  'Sales Manager', 'Marketing Executive', 'Content Strategist', 'Support Engineer',
  'Full Stack Developer', 'Mobile Developer',
];

/* first, last, designation, department, joined, role, manager (by name).
 * Managers are named rather than coded: employee codes here are derived
 * from list position, so a hand-written code silently points at whoever
 * happens to sit at that index. */
const PEOPLE = [
  ['Vikram', 'Rao', 'Engineering Manager', 'Engineering', '2021-02-08', 'OWNER', null],
  ['Sneha', 'Nair', 'HR Manager', 'People', '2020-11-02', 'HR', 'Vikram Rao'],
  ['Karthik', 'Subramanian', 'Tech Lead', 'Engineering', '2020-08-24', 'DIRECTOR', 'Vikram Rao'],
  ['Rahul', 'Chatterjee', 'Solution Architect', 'Delivery', '2021-09-06', 'DIRECTOR', 'Vikram Rao'],
  ['Ananya', 'Iyer', 'Senior Software Engineer', 'Engineering', '2023-04-17', 'EMPLOYEE', 'Vikram Rao'],
  ['Priya', 'Sharma', 'QA Lead', 'Quality', '2022-07-11', 'EMPLOYEE', 'Vikram Rao'],
  ['Rohan', 'Mehta', 'DevOps Engineer', 'Infrastructure', '2023-01-23', 'EMPLOYEE', 'Aditya Verma'],
  ['Arjun', 'Kulkarni', 'Full Stack Developer', 'Engineering', '2023-09-04', 'EMPLOYEE', 'Vikram Rao'],
  ['Kavya', 'Reddy', 'UI/UX Designer', 'Design', '2024-02-19', 'EMPLOYEE', 'Vikram Rao'],
  ['Siddharth', 'Joshi', 'Data Engineer', 'Data', '2022-10-10', 'EMPLOYEE', 'Aditya Verma'],
  ['Meera', 'Krishnan', 'Business Analyst', 'Delivery', '2024-06-03', 'EMPLOYEE', 'Rahul Chatterjee'],
  ['Aditya', 'Verma', 'Cloud Architect', 'Infrastructure', '2021-05-17', 'EMPLOYEE', 'Vikram Rao'],
  ['Divya', 'Menon', 'Software Engineer', 'Engineering', '2025-01-13', 'EMPLOYEE', 'Karthik Subramanian'],
  ['Ishita', 'Bose', 'Content Strategist', 'Marketing', '2024-08-12', 'EMPLOYEE', 'Vikram Rao'],
  ['Nikhil', 'Agarwal', 'Software Engineer', 'Engineering', '2024-11-18', 'EMPLOYEE', 'Karthik Subramanian'],
  ['Pooja', 'Desai', 'Finance Executive', 'Finance', '2023-06-05', 'EMPLOYEE', 'Vikram Rao'],
  ['Tanvi', 'Shah', 'QA Engineer', 'Quality', '2025-03-10', 'EMPLOYEE', 'Priya Sharma'],
  ['Manish', 'Gupta', 'Sales Manager', 'Sales', '2022-03-28', 'EMPLOYEE', 'Vikram Rao'],
  ['Lakshmi', 'Pillai', 'Talent Acquisition', 'People', '2024-04-15', 'EMPLOYEE', 'Sneha Nair'],
  ['Gaurav', 'Singh', 'Mobile Developer', 'Engineering', '2023-11-20', 'EMPLOYEE', 'Karthik Subramanian'],
  ['Riya', 'Malhotra', 'Product Manager', 'Product', '2022-01-17', 'EMPLOYEE', 'Vikram Rao'],
  ['Abhishek', 'Pandey', 'Support Engineer', 'Support', '2025-05-26', 'EMPLOYEE', 'Rahul Chatterjee'],
  ['Shruti', 'Kapoor', 'Marketing Executive', 'Marketing', '2025-02-03', 'EMPLOYEE', 'Ishita Bose'],
  ['Deepak', 'Nambiar', 'Database Administrator', 'Data', '2022-12-12', 'EMPLOYEE', 'Vikram Rao'],
];

const LEAVE_TYPES = [
  ['Casual Leave', 'CL', 1],
  ['Sick Leave', 'SL', 1],
  ['Earned Leave', 'EL', 1.5],
  ['Comp Off', 'CO', 0],
  ['Maternity Leave', 'ML', 0],
  ['Loss of Pay', 'LOP', 0],
];

const HOLIDAYS = [
  ['2026-01-26', 'Republic Day'], ['2026-03-04', 'Holi'],
  ['2026-04-14', 'Dr. Ambedkar Jayanti'], ['2026-05-01', 'Maharashtra Day'],
  ['2026-08-15', 'Independence Day'], ['2026-09-25', 'Ganesh Chaturthi'],
  ['2026-10-02', 'Gandhi Jayanti'], ['2026-10-20', 'Dussehra'],
  ['2026-11-08', 'Diwali'], ['2026-12-25', 'Christmas'],
];

const ANNOUNCEMENTS = [
  ['Ganesh Chaturthi — office closed',
   'The Bengaluru and Pune offices will be closed on Friday, 25 September. On-call rotation stays as published.',
   '2026-09-14'],
  ['Q3 appraisal window opens 1 October',
   'Self-assessment forms will be shared on 1 October and close on 12 October. Your manager will schedule the review conversation in the week that follows.',
   '2026-09-10'],
  ['New VPN gateway',
   'The Singapore gateway is being retired on 30 September. Please switch your client to the Mumbai endpoint before then — instructions are in the IT & Security Policy.',
   '2026-09-05'],
  ['Referral bonus revised',
   'The referral bonus for senior engineering roles has been revised to ₹75,000, payable after the referred employee completes 90 days.',
   '2026-08-28'],
];

/* employee (by name), type, from, to, days, reason, status */
const LEAVE_APPLICATIONS = [
  ['Arjun Kulkarni', 'CL', '2026-09-24', '2026-09-25', 2, 'Family function in Mysuru', 'Pending'],
  ['Kavya Reddy', 'SL', '2026-09-22', '2026-09-22', 1, 'Fever, doctor advised rest', 'Pending'],
  ['Divya Menon', 'EL', '2026-10-06', '2026-10-10', 5, 'Pre-planned vacation — Kerala', 'Pending'],
  ['Ananya Iyer', 'CL', '2026-09-11', '2026-09-11', 1, 'Personal work', 'Approved'],
  ['Nikhil Agarwal', 'SL', '2026-09-08', '2026-09-09', 2, 'Viral infection', 'Approved'],
  ['Tanvi Shah', 'EL', '2026-09-01', '2026-09-03', 3, 'Sibling’s wedding', 'Approved'],
  ['Gaurav Singh', 'CL', '2026-08-28', '2026-08-28', 1, 'Bank work', 'Rejected'],
  ['Meera Krishnan', 'CO', '2026-08-21', '2026-08-21', 1, 'Worked Sunday 16 Aug for the UAT window', 'Approved'],
];

const empCode = (i) => `VS-${String(101 + i * 3).padStart(4, '0')}`;

/* September 2026, keyed on the shift start date. P=present W=weekend
 * L=leave H=holiday. Index 0 is the 1st. */
const SEPT = 'PPPPPWWPPPPPWWPLPPPWWP'.split('');

(async () => {
  await initSchema();

  const existing = await qOne('SELECT * FROM companies WHERE slug=$1', [SLUG]);
  if (existing) {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await q('DELETE FROM user_directory WHERE company_id=$1', [existing.id]);
    await q('DELETE FROM companies WHERE id=$1', [existing.id]);
  }

  const company = await qOne(
    `INSERT INTO companies (name, slug, schema_name) VALUES ($1,$2,$3) RETURNING *`,
    ['Validure Solutions Pvt. Ltd.', SLUG, SCHEMA]);
  await createTenantSchema(SCHEMA);
  ensureCompanyDirs(SLUG);

  for (const [name, code, rate] of LEAVE_TYPES) {
    await tq(SCHEMA, `INSERT INTO {s}.leave_types (name, code, monthly_accrual) VALUES ($1,$2,$3)`,
      [name, code, rate]);
  }
  for (const d of DEPARTMENTS) {
    await tq(SCHEMA, 'INSERT INTO {s}.departments (name) VALUES ($1)', [d]);
  }
  for (const t of DESIGNATIONS) {
    await tq(SCHEMA, 'INSERT INTO {s}.designations (title) VALUES ($1)', [t]);
  }
  for (const [date, name] of HOLIDAYS) {
    await tq(SCHEMA, 'INSERT INTO {s}.holidays (date, name) VALUES ($1,$2)', [date, name]);
  }

  const deptId = async (n) => (await tqOne(SCHEMA, 'SELECT id FROM {s}.departments WHERE name=$1', [n])).id;
  const desigId = async (t) => (await tqOne(SCHEMA, 'SELECT id FROM {s}.designations WHERE title=$1', [t])).id;
  const roleId = async (n) => (await tqOne(SCHEMA, 'SELECT id FROM {s}.roles WHERE name=$1', [n])).id;

  const hash = bcrypt.hashSync(PASSWORD, 10);

  /* Managers are referenced by code, so people are inserted in an order
   * where a manager always exists before their reports. Anyone whose
   * manager has not landed yet is linked in a second pass. */
  const pending = [];
  for (let i = 0; i < PEOPLE.length; i++) {
    const [first, last, desig, dept, doj, role, mgr] = PEOPLE[i];
    const code = empCode(i);
    const email = `${first}.${last}`.toLowerCase() + '@' + DOMAIN;
    const emp = await tqOne(SCHEMA, `
      INSERT INTO {s}.employees
        (emp_code, first_name, last_name, phone, email, doj, department_id, designation_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [code, first, last, '+91 98450 ' + String(10000 + i * 431).slice(0, 5),
       email, doj, await deptId(dept), await desigId(desig)]);

    const user = await tqOne(SCHEMA,
      `INSERT INTO {s}.users (username, email, password_hash, role_id, employee_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [code, email, hash, await roleId(role), emp.id]);

    await q(`INSERT INTO user_directory (email, username, company_id, tenant_user_id)
             VALUES ($1,$2,$3,$4)`, [email, code, company.id, user.id]);

    if (mgr) pending.push([code, mgr]);   // resolved by name in the second pass

    await tq(SCHEMA, `
      INSERT INTO {s}.leave_balances (employee_id, leave_type_id, accrued, used, last_accrued)
      SELECT $1, id, monthly_accrual * 9, 0, $2 FROM {s}.leave_types`, [emp.id, ym()]);
  }

  let linked = 0;
  for (const [code, mgr] of pending) {
    const [mf, ml] = mgr.split(' ');
    const m = await tqOne(SCHEMA,
      'SELECT id FROM {s}.employees WHERE first_name=$1 AND last_name=$2', [mf, ml]);
    if (!m) { console.warn(`  ! manager not found for ${code}: ${mgr}`); continue; }
    await tq(SCHEMA, 'UPDATE {s}.employees SET reporting_manager_id=$1 WHERE emp_code=$2', [m.id, code]);
    linked++;
  }

  /* Attendance for September 2026. Present days carry the night shift's
   * in/out, and every seventh working day gets a late mark so the late
   * counters and the analytics page are not uniformly zero. */
  const emps = await tq(SCHEMA, 'SELECT id, emp_code FROM {s}.employees ORDER BY id');
  let attRows = 0;
  for (const [n, e] of emps.entries()) {
    for (let d = 0; d < SEPT.length; d++) {
      const date = `2026-09-${String(d + 1).padStart(2, '0')}`;
      const mark = SEPT[d];
      const status = mark === 'P' ? 'Present' : mark === 'W' ? 'Weekend'
        : mark === 'L' ? 'Leave' : 'Holiday';
      const present = status === 'Present';
      const late = present && (d + n) % 7 === 3;
      await tq(SCHEMA, `
        INSERT INTO {s}.attendance (employee_id, date, status, check_in, check_out, late_mark)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [e.id, date, status, present ? (late ? '19:12' : SHIFT_IN) : null,
         present ? SHIFT_OUT : null, late]);
      attRows++;
    }
  }

  let apps = 0;
  for (const [who, type, from, to, days, reason, status] of LEAVE_APPLICATIONS) {
    const [wf, wl] = who.split(' ');
    const emp = await tqOne(SCHEMA,
      'SELECT id FROM {s}.employees WHERE first_name=$1 AND last_name=$2', [wf, wl]);
    const lt = await tqOne(SCHEMA, 'SELECT id FROM {s}.leave_types WHERE code=$1', [type]);
    if (!emp || !lt) { console.warn(`  ! leave application skipped: ${who} / ${type}`); continue; }
    await tq(SCHEMA, `
      INSERT INTO {s}.leave_applications
        (employee_id, leave_type_id, from_date, to_date, days, reason, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [emp.id, lt.id, from, to, days, reason, status]);
    apps++;
  }

  for (const [title, body, date] of ANNOUNCEMENTS) {
    await tq(SCHEMA, 'INSERT INTO {s}.announcements (title, body, date) VALUES ($1,$2,$3)',
      [title, body, date]);
  }

  console.log('ValidureHR seed complete — Validure Solutions Pvt. Ltd.');
  console.log(`  ${emps.length} employees, ${linked} reporting lines, ${attRows} attendance rows,`);
  console.log(`  ${apps} leave applications, ${HOLIDAYS.length} holidays, ${ANNOUNCEMENTS.length} announcements.`);
  console.log('');
  console.log(`  Sign in with any employee code, password ${PASSWORD}:`);
  console.log(`    ${empCode(0)}  Vikram Rao      OWNER`);
  console.log(`    ${empCode(1)}  Sneha Nair      HR`);
  console.log(`    ${empCode(4)}  Ananya Iyer     EMPLOYEE`);
  console.log('  Platform admin: run `npm run init` (username admin, ADMIN_PASSWORD).');
  await pool.end();
})().catch((e) => { console.error('Seed failed:', e); process.exit(1); });
