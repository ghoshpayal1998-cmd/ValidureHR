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
const PDFDocument = require('pdfkit');
const { q, qOne, tq, tqOne, pool, initSchema, createTenantSchema } = require('./db');
const { ensureCompanyDirs, driver, objectKey } = require('./storage');
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

/* first, last, designation, department, joined, dob, role, manager (by name).
 * Managers are named rather than coded: employee codes here are derived
 * from list position, so a hand-written code silently points at whoever
 * happens to sit at that index. */
const PEOPLE = [
  ['Vikram', 'Rao', 'Engineering Manager', 'Engineering', '2021-02-08', '1984-03-12', 'OWNER', null],
  ['Sneha', 'Nair', 'HR Manager', 'People', '2020-11-02', '1986-11-30', 'HR', 'Vikram Rao'],
  ['Karthik', 'Subramanian', 'Tech Lead', 'Engineering', '2020-08-24', '1983-07-19', 'DIRECTOR', 'Vikram Rao'],
  ['Rahul', 'Chatterjee', 'Solution Architect', 'Delivery', '2021-09-06', '1982-09-05', 'DIRECTOR', 'Vikram Rao'],
  ['Ananya', 'Iyer', 'Senior Software Engineer', 'Engineering', '2023-04-17', '1993-06-24', 'EMPLOYEE', 'Vikram Rao'],
  ['Priya', 'Sharma', 'QA Lead', 'Quality', '2022-07-11', '1989-02-14', 'EMPLOYEE', 'Vikram Rao'],
  ['Rohan', 'Mehta', 'DevOps Engineer', 'Infrastructure', '2023-01-23', '1994-12-01', 'EMPLOYEE', 'Aditya Verma'],
  ['Arjun', 'Kulkarni', 'Full Stack Developer', 'Engineering', '2023-09-04', '1995-08-17', 'EMPLOYEE', 'Vikram Rao'],
  ['Kavya', 'Reddy', 'UI/UX Designer', 'Design', '2024-02-19', '1997-04-09', 'EMPLOYEE', 'Vikram Rao'],
  ['Siddharth', 'Joshi', 'Data Engineer', 'Data', '2022-10-10', '1985-10-22', 'EMPLOYEE', 'Aditya Verma'],
  ['Meera', 'Krishnan', 'Business Analyst', 'Delivery', '2024-06-03', '1996-01-28', 'EMPLOYEE', 'Rahul Chatterjee'],
  ['Aditya', 'Verma', 'Cloud Architect', 'Infrastructure', '2021-05-17', '1987-05-03', 'EMPLOYEE', 'Vikram Rao'],
  ['Divya', 'Menon', 'Software Engineer', 'Engineering', '2025-01-13', '1999-09-16', 'EMPLOYEE', 'Karthik Subramanian'],
  ['Ishita', 'Bose', 'Content Strategist', 'Marketing', '2024-08-12', '1998-03-27', 'EMPLOYEE', 'Vikram Rao'],
  ['Nikhil', 'Agarwal', 'Software Engineer', 'Engineering', '2024-11-18', '1999-11-08', 'EMPLOYEE', 'Karthik Subramanian'],
  ['Pooja', 'Desai', 'Finance Executive', 'Finance', '2023-06-05', '1992-07-15', 'EMPLOYEE', 'Vikram Rao'],
  ['Tanvi', 'Shah', 'QA Engineer', 'Quality', '2025-03-10', '2000-02-21', 'EMPLOYEE', 'Priya Sharma'],
  ['Manish', 'Gupta', 'Sales Manager', 'Sales', '2022-03-28', '1988-06-11', 'EMPLOYEE', 'Vikram Rao'],
  ['Lakshmi', 'Pillai', 'Talent Acquisition', 'People', '2024-04-15', '1996-10-04', 'EMPLOYEE', 'Sneha Nair'],
  ['Gaurav', 'Singh', 'Mobile Developer', 'Engineering', '2023-11-20', '1995-05-19', 'EMPLOYEE', 'Karthik Subramanian'],
  ['Riya', 'Malhotra', 'Product Manager', 'Product', '2022-01-17', '1990-08-26', 'EMPLOYEE', 'Vikram Rao'],
  ['Abhishek', 'Pandey', 'Support Engineer', 'Support', '2025-05-26', '2001-01-30', 'EMPLOYEE', 'Rahul Chatterjee'],
  ['Shruti', 'Kapoor', 'Marketing Executive', 'Marketing', '2025-02-03', '1999-06-07', 'EMPLOYEE', 'Ishita Bose'],
  ['Deepak', 'Nambiar', 'Database Administrator', 'Data', '2022-12-12', '1991-12-13', 'EMPLOYEE', 'Vikram Rao'],
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

  /* Earlier months, so Leave History opens on a real list rather than its
   * empty state — including Sneha Nair, who is the HR account most of the
   * admin screens are demonstrated from. */
  ['Sneha Nair', 'EL', '2026-07-20', '2026-07-24', 5, 'Annual leave — Coorg', 'Approved'],
  ['Sneha Nair', 'CL', '2026-06-12', '2026-06-12', 1, 'Property registration', 'Approved'],
  ['Sneha Nair', 'SL', '2026-05-04', '2026-05-05', 2, 'Migraine', 'Approved'],
  ['Vikram Rao', 'EL', '2026-07-06', '2026-07-10', 5, 'Family holiday', 'Approved'],
  ['Ananya Iyer', 'SL', '2026-08-13', '2026-08-14', 2, 'Food poisoning', 'Approved'],
  ['Ananya Iyer', 'EL', '2026-06-22', '2026-06-26', 5, 'Wedding in the family', 'Approved'],
  ['Ananya Iyer', 'CL', '2026-05-18', '2026-05-18', 1, 'Passport appointment', 'Rejected'],
  ['Karthik Subramanian', 'CL', '2026-07-30', '2026-07-30', 1, 'School admission', 'Approved'],
  ['Priya Sharma', 'EL', '2026-06-01', '2026-06-04', 4, 'Vacation', 'Approved'],
  ['Rohan Mehta', 'SL', '2026-08-05', '2026-08-05', 1, 'Dental surgery', 'Approved'],
];

/* ------------------------------------------------------------------- pay */

/* A monthly basic per designation. Everything else on a payslip is derived
 * from it, so the payslip and the salary sheet can never disagree about what
 * somebody is paid. Indian structure: HRA at 40% of basic, a fixed
 * conveyance, PF at 12% of basic capped at the statutory 1,800. */
const BASIC_BY_DESIGNATION = {
  'Engineering Manager': 96000, 'Cloud Architect': 88000, 'Solution Architect': 86000,
  'Tech Lead': 82000, 'Product Manager': 74000, 'HR Manager': 68000,
  'Senior Software Engineer': 64000, 'QA Lead': 62000, 'Database Administrator': 58000,
  'Data Engineer': 56000, 'DevOps Engineer': 55000, 'Sales Manager': 54000,
  'Full Stack Developer': 52000, 'Mobile Developer': 50000, 'Business Analyst': 46000,
  'UI/UX Designer': 45000, 'Software Engineer': 42000, 'QA Engineer': 40000,
  'Content Strategist': 38000, 'Finance Executive': 37000, 'Talent Acquisition': 36000,
  'Marketing Executive': 34000, 'Support Engineer': 32000,
};

const BANKS = [
  ['HDFC Bank', 'HDFC0001842'], ['ICICI Bank', 'ICIC0004417'],
  ['State Bank of India', 'SBIN0011203'], ['Axis Bank', 'UTIB0002165'],
  ['Kotak Mahindra Bank', 'KKBK0008091'],
];

function payComponents(basic) {
  const hra = Math.round(basic * 0.4);
  const conveyance = 1600;
  const special = Math.round(basic * 0.25);
  const gross = basic + hra + conveyance + special;
  const pf = Math.min(Math.round(basic * 0.12), 1800);
  const tax = gross > 100000 ? Math.round(gross * 0.12)
    : gross > 60000 ? Math.round(gross * 0.08)
      : gross > 40000 ? Math.round(gross * 0.04) : 0;
  /* ESIC applies only below the statutory gross ceiling, so most of this
   * company is outside it — which is itself worth showing on the screen. */
  const esic = gross <= 21000 ? Math.round(gross * 0.0075) : 0;
  return { basic, hra, conveyance, special, gross, pf, tax, esic };
}

/* The three months of payslips the demo opens with, newest last. */
const SLIP_MONTHS = [[2026, 7], [2026, 8], [2026, 9]];

/* Unpaid days by employee index and month, so a couple of slips carry a real
 * LOP line instead of every one of them being arithmetically identical. */
const LOP_DAYS = { '7|2026|8': 1, '12|2026|9': 2, '19|2026|7': 0.5 };

/* --------------------------------------------------------------- documents */

const POLICIES = [
  ['Leave and Attendance Policy', 'People',
    'Entitlements, monthly accrual, the approval chain, and how a 19:00–04:00 shift is counted against a calendar day.'],
  ['Code of Conduct', 'People',
    'What Validure expects of everyone, and how a concern is raised, recorded and closed.'],
  ['IT and Security Policy', 'Security',
    'Device standards, VPN access, password rules, and how to report a suspected incident.'],
  ['Travel and Expense Policy', 'Finance',
    'Booking limits by grade, per-diem rates, and how to file a claim with receipts.'],
  ['Remote Work Policy', 'People',
    'Eligibility, core overlap hours, and the equipment the company provides and insures.'],
  ['POSH Policy', 'Compliance',
    'Prevention of sexual harassment: the committee, the redressal process, and the timelines it runs to.'],
];

const EMAIL_LOG = [
  ['Leave application approved', 'sent'],
  ['Your payslip for August 2026 is ready', 'sent'],
  ['Leave application rejected', 'sent'],
  ['Password changed on your account', 'sent'],
  ['New announcement: Appraisal cycle', 'sent'],
  ['Leave application received', 'sent'],
  ['Monthly attendance summary', 'failed'],
  ['Welcome to ValidureHR', 'sent'],
];

/* Collects a PDFKit document into a buffer the storage driver can take,
 * rather than writing straight to disk — the same seed then works against
 * Supabase storage, where there is no local path to write to. */
function pdfBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

async function storePdf(kind, fileName, build) {
  const buf = await pdfBuffer(build);
  await driver.put(objectKey(SLUG, kind, fileName), buf, 'application/pdf');
  return fileName;
}

/* A plain, readable document. It is placeholder content and says so — an
 * uploaded policy replaces it — but it is a real PDF that really opens, so
 * the View and Download buttons can be tested end to end. */
function simpleDoc(title, subtitle, paragraphs) {
  return (doc) => {
    doc.fontSize(20).text('Validure Solutions Pvt. Ltd.', { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#666').text(subtitle);
    doc.moveDown(1.2);
    doc.fillColor('#000').fontSize(15).text(title);
    doc.moveDown(0.8);
    doc.fontSize(10.5).fillColor('#222');
    for (const p of paragraphs) {
      doc.text(p, { align: 'left', lineGap: 3 });
      doc.moveDown(0.7);
    }
    doc.moveDown(1);
    doc.fontSize(8).fillColor('#888').text(
      'Demo content generated by the ValidureHR seed. Replace it by uploading the real document.',
    );
  };
}

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
    const [first, last, desig, dept, doj, dob, role, mgr] = PEOPLE[i];
    const code = empCode(i);
    const email = `${first}.${last}`.toLowerCase() + '@' + DOMAIN;
    const emp = await tqOne(SCHEMA, `
      INSERT INTO {s}.employees
        (emp_code, first_name, last_name, phone, email, doj, dob, department_id, designation_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [code, first, last, '+91 98450 ' + String(10000 + i * 431).slice(0, 5),
       email, doj, dob, await deptId(dept), await desigId(desig)]);

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

  /* ----------------------------------------------------- pay and documents
   *
   * Without this section the payroll, payslip, policy and offer-letter
   * screens all open on their empty state, which shows the layout but
   * proves nothing about how they render real rows. Everything below is
   * demo content and labels itself as such.
   */
  const staff = await tq(SCHEMA, `
    SELECT e.id, e.emp_code, e.first_name, e.last_name, e.doj, e.email,
           g.title AS designation
    FROM {s}.employees e
    LEFT JOIN {s}.designations g ON g.id = e.designation_id
    ORDER BY e.id`);

  let structures = 0;
  let slips = 0;
  for (const [i, e] of staff.entries()) {
    const basic = BASIC_BY_DESIGNATION[e.designation] || 40000;
    const p = payComponents(basic);
    const [bank, ifsc] = BANKS[i % BANKS.length];
    /* A PAN that is obviously synthetic, so nobody mistakes demo data for
     * somebody's real tax number. */
    const pan = `ABCDE${String(1000 + i).slice(-4)}F`;

    await tq(SCHEMA, `
      INSERT INTO {s}.salary_structures
        (employee_id, basic, hra, special_allowance, conveyance,
         pf_deduction, tax_deduction, esic_deduction,
         bank_name, bank_account_no, bank_ifsc, pan_no)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [e.id, p.basic, p.hra, p.special, p.conveyance, p.pf, p.tax, p.esic,
      bank, `${50100000000 + i * 7771}`, ifsc, pan]);
    structures++;

    for (const [year, month] of SLIP_MONTHS) {
      const lopDays = LOP_DAYS[`${i}|${year}|${month}`] || 0;
      /* A day of unpaid leave costs a thirtieth of gross — the same rule the
       * payslip and the salary sheet both apply. */
      const lop = Math.round((p.gross / 30) * lopDays);
      const net = p.gross - p.pf - p.tax - p.esic - lop;
      await tq(SCHEMA, `
        INSERT INTO {s}.salary_slips
          (employee_id, month, year, basic, hra, special_allowance, conveyance,
           pf_deduction, tax_deduction, esic_deduction, lop_deduction, net_pay)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [e.id, month, year, p.basic, p.hra, p.special, p.conveyance,
        p.pf, p.tax, p.esic, lop, net]);
      slips++;
    }
  }

  /* Policies and offer letters are stored files, so a row without bytes
   * behind it gives the reader a button that 404s. Each row gets a real
   * PDF written through the same storage driver an upload would use. */
  for (const [title, category, description] of POLICIES) {
    const fileName = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
    await storePdf('policies', fileName, simpleDoc(title, `${category} · Policy document`, [
      description,
      'This placeholder stands in for the signed policy document. It exists so the '
      + 'document list, the viewer and the download all work end to end in the demo.',
      'Questions about this policy go to the People team.',
    ]));
    await tq(SCHEMA, `
      INSERT INTO {s}.policies (title, category, description, file_name)
      VALUES ($1,$2,$3,$4)`, [title, category, description, fileName]);
  }

  let offers = 0;
  for (const e of staff) {
    const fileName = `offer-${e.emp_code}.pdf`;
    const name = `${e.first_name} ${e.last_name}`;
    await storePdf('offers', fileName, simpleDoc(
      `Letter of appointment — ${name}`,
      `${e.emp_code} · issued ${e.doj}`,
      [
        `Dear ${e.first_name}, we are pleased to confirm your appointment as `
        + `${e.designation} with Validure Solutions Pvt. Ltd., effective ${e.doj}.`,
        'Your working hours follow the company shift of 19:00 to 04:00 IST. Your '
        + 'compensation, leave entitlement and notice period are set out in the '
        + 'annexure to this letter.',
        'We look forward to working with you.',
      ],
    ));
    await tq(SCHEMA, `
      INSERT INTO {s}.offer_letters (employee_id, title, file_name, uploaded_at)
      VALUES ($1,$2,$3,$4)`,
    [e.id, `Letter of appointment — ${name}`, fileName, `${e.doj} 10:00:00`]);
    offers++;
  }

  /* A few read and unread notifications, so the bell in the top bar has both
   * states to show rather than only its empty one. */
  let notes = 0;
  for (const [i, e] of staff.entries()) {
    const seeds = [
      ['Payslip available', 'Your payslip for September 2026 is ready to download.',
        '/documents/salary-slips', i % 3 === 0],
      ['Attendance reminder', 'You have not punched out for one shift this month.',
        '/attendance', i % 4 === 0],
    ];
    for (const [title, body, link, isRead] of seeds) {
      await tq(SCHEMA, `
        INSERT INTO {s}.notifications (employee_id, title, body, link, is_read)
        VALUES ($1,$2,$3,$4,$5)`, [e.id, title, body, link, isRead]);
      notes++;
    }
  }

  /* The email log records what the mailer did. SMTP is not configured in the
   * demo, so a seeded log is the only way this screen has anything to show —
   * including one failure, because the screen has to render that too. */
  for (const [i, [subject, status]] of EMAIL_LOG.entries()) {
    const to = staff[i % staff.length];
    await tq(SCHEMA, `
      INSERT INTO {s}.email_log (to_email, subject, body, status, created_at)
      VALUES ($1,$2,$3,$4,$5)`,
    [to.email, subject,
      `${subject}\n\nThis is a seeded record of a notification email.`,
      status, `2026-09-${String(8 + i).padStart(2, '0')} 09:${String(10 + i * 5).padStart(2, '0')}:00`]);
  }

  console.log('ValidureHR seed complete — Validure Solutions Pvt. Ltd.');
  console.log(`  ${emps.length} employees, ${linked} reporting lines, ${attRows} attendance rows,`);
  console.log(`  ${apps} leave applications, ${HOLIDAYS.length} holidays, ${ANNOUNCEMENTS.length} announcements,`);
  console.log(`  ${structures} salary structures, ${slips} payslips, ${POLICIES.length} policies,`);
  console.log(`  ${offers} offer letters, ${notes} notifications, ${EMAIL_LOG.length} email-log rows.`);
  console.log('');
  console.log(`  Sign in with any employee code, password ${PASSWORD}:`);
  console.log(`    ${empCode(0)}  Vikram Rao      OWNER`);
  console.log(`    ${empCode(1)}  Sneha Nair      HR`);
  console.log(`    ${empCode(4)}  Ananya Iyer     EMPLOYEE`);
  console.log('  Platform admin: run `npm run init` (username admin, ADMIN_PASSWORD).');
  await pool.end();
})().catch((e) => { console.error('Seed failed:', e); process.exit(1); });
