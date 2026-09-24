/* Platform admin: create and manage companies. Every company is a self-contained
 * object — its own PostgreSQL schema, its own uploads folder, its own roles. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { q, qOne, tq, tqOne, pool, createTenantSchema, assertSchema } = require('../db');
const bcrypt = require('bcryptjs');
const { normalisePlan, DEFAULT_PLAN, SYSTEM_ROLES } = require('../permissions');
const { generateTempPassword } = require('../passwords');
const { sendMailNow } = require('../mailer');
const { ensureCompanyDirs, UPLOADS_ROOT } = require('../storage');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAdmin);

// Every leave type starts at a 0/month rate — employees begin with ZERO leaves.
// HR grants leave by setting rates and/or manual credits on the Leave Balances page.
const DEFAULT_LEAVE_TYPES = [
  ['Casual Leave', 'CL', 0],
  ['Earned Leave', 'EL', 0],
  ['Sick Leave', 'SL', 0],
  ['Comp Off', 'CO', 0],
];

// GET /api/companies
router.get('/', async (req, res, next) => {
  try {
    const companies = await q('SELECT * FROM companies ORDER BY name');
    for (const c of companies) {
      try {
        c.employees = (await tqOne(c.schema_name, 'SELECT COUNT(*)::int c FROM {s}.employees')).c;
        c.pending_leaves = (await tqOne(c.schema_name, `SELECT COUNT(*)::int c FROM {s}.leave_applications WHERE status='Pending'`)).c;
      } catch { c.employees = 0; c.pending_leaves = 0; }
    }
    res.json(companies);
  } catch (e) { next(e); }
});

// POST /api/companies { name, slug?, plan?, owner? } — schema, folders, system
// roles, leave types, and optionally the first login so the company is usable
// the moment it is created.
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    let { slug } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Company name is required' });
    slug = (slug || name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
    if (slug.length < 2) return res.status(400).json({ error: 'Slug must be at least 2 letters/digits' });

    const dup = await qOne('SELECT id FROM companies WHERE LOWER(name)=LOWER($1) OR slug=$2', [name.trim(), slug]);
    if (dup) return res.status(409).json({ error: 'A company with that name or slug already exists' });

    const plan = normalisePlan((req.body || {}).plan) || DEFAULT_PLAN;
    const schema = assertSchema(`c_${slug}`);
    const hasDeviceAttendance = !!(req.body || {}).has_device_attendance;
    const company = await qOne(
      `INSERT INTO companies (name, slug, schema_name, has_device_attendance, plan) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name.trim(), slug, schema, hasDeviceAttendance, plan]);

    // createTenantSchema also seeds/refreshes the system roles (see syncSystemRoles).
    await createTenantSchema(schema);
    ensureCompanyDirs(slug);

    // default leave types (monthly accrual rates — HR can change them later)
    for (const [n, code, rate] of DEFAULT_LEAVE_TYPES) {
      await tq(schema, `INSERT INTO {s}.leave_types (name, code, monthly_accrual) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING`,
        [n, code, rate]);
    }
    await tq(schema, `INSERT INTO {s}.audit_logs (actor, action, details) VALUES ($1,'COMPANY_CREATED',$2)`,
      [req.user.username, `Company "${name.trim()}" provisioned on the ${plan} plan`]);

    /*
     * The first login, in the same call.
     *
     * Creating a company used to leave a schema with no users in it, so the
     * admin had to remember a second, undocumented step through /employees
     * before anyone could sign in. Handing the keys over is the product — the
     * site sells "we create it and hand you the logins" — so it belongs here.
     */
    let owner = null;
    const o = (req.body || {}).owner;
    if (o && o.email && String(o.email).includes('@')) {
      // employees.dob is NOT NULL, and a placeholder date of birth is not a
      // small lie in a system that computes payroll — so it is asked for.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.dob || ''))) {
        return res.status(201).json({
          message: `Company "${name.trim()}" created, but the owner account was not`,
          company,
          owner: null,
          warning: 'The owner needs a date of birth (YYYY-MM-DD) — the employee record requires one. '
                 + "Add the first user from the company's Employees screen.",
        });
      }
      const code = (o.emp_code || 'ADMIN-001').trim();
      const first = (o.first_name || 'Company').trim();
      const last = (o.last_name || 'Owner').trim();
      const password = o.password || generateTempPassword();
      const email = o.email.trim();

      // An email identifies a person across the whole platform, not within one
      // company: user_directory is how a login resolves to a tenant. Skipping
      // this check is how you get two companies claiming the same address and a
      // sign-in that cannot decide which one it means.
      const clash = await qOne('SELECT id FROM user_directory WHERE LOWER(email)=LOWER($1)', [email]);
      if (clash) {
        return res.status(201).json({
          message: `Company "${name.trim()}" created, but the owner account was not`,
          company,
          owner: null,
          warning: `${email} is already registered on the platform, so no login was created. Add the first user from the company's Employees screen with a different address.`,
        });
      }

      const role = await tqOne(schema, `SELECT id FROM {s}.roles WHERE name='OWNER'`);
      const emp = await tqOne(schema,
        `INSERT INTO {s}.employees (emp_code, first_name, last_name, email, doj, dob, status)
         VALUES ($1,$2,$3,$4,$5,$6,'Active') RETURNING id`,
        [code, first, last, email, (o.doj || '').match(/^\d{4}-\d{2}-\d{2}$/) ? o.doj : new Date().toISOString().slice(0, 10), o.dob]);
      const user = await tqOne(schema,
        `INSERT INTO {s}.users (username, email, password_hash, role_id, employee_id, must_change_password)
         VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id`,
        [code, email, bcrypt.hashSync(password, 10), role.id, emp.id]);
      await q('INSERT INTO user_directory (email, username, company_id, tenant_user_id) VALUES ($1,$2,$3,$4)',
        [email, code, company.id, user.id]);

      // The generated password exists in exactly one place after this response.
      // Report whether the mail actually left, rather than assuming it did.
      const mail = await sendMailNow(schema, email,
        `Your ${name.trim()} HR portal account`,
        `Hi ${first},

Your company has been set up on ValidureHR.

Username : ${code}
Email : ${email}
Password : ${password}

Please sign in and change your password immediately.`);
      owner = { username: code, email, password, emailed: !!(mail && mail.ok) };
      await tq(schema, `INSERT INTO {s}.audit_logs (actor, action, details) VALUES ($1,'COMPANY_OWNER_CREATED',$2)`,
        [req.user.username, `Owner account ${code} created for "${name.trim()}"`]);
    }

    res.status(201).json({ message: `Company "${name.trim()}" created`, company, owner });
  } catch (e) { next(e); }
});

// PUT /api/companies/:id { status, plan } — suspend / activate, or change plan
router.put('/:id', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    const plan = normalisePlan((req.body || {}).plan);

    // Either field on its own, so changing a plan does not require restating
    // the status and accidentally reactivating a suspended company.
    if (status === undefined && !plan) {
      return res.status(400).json({ error: 'Provide a status or a plan' });
    }
    if (status !== undefined && !['Active', 'Suspended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if ((req.body || {}).plan !== undefined && !plan) {
      return res.status(400).json({ error: 'Plan must be basic, essential or advanced' });
    }

    const sets = [];
    const vals = [];
    if (status !== undefined) { sets.push(`status=$${sets.length + 1}`); vals.push(status); }
    if (plan) { sets.push(`plan=$${sets.length + 1}`); vals.push(plan); }
    vals.push(req.params.id);

    const result = await q(
      `UPDATE companies SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING id, name, schema_name, status, plan`,
      vals);
    if (!result.length) return res.status(404).json({ error: 'Company not found' });

    const c = result[0];
    if (plan) {
      await tq(c.schema_name, `INSERT INTO {s}.audit_logs (actor, action, details) VALUES ($1,'PLAN_CHANGED',$2)`,
        [req.user.username, `Plan set to ${plan}`]);
    }
    const parts = [];
    if (status !== undefined) parts.push(`Company ${status === 'Active' ? 'activated' : 'suspended'}`);
    if (plan) parts.push(`plan set to ${plan}`);
    res.json({ message: parts.join(', '), company: c });
  } catch (e) { next(e); }
});

// DELETE /api/companies/:id — drops the entire tenant (schema + files). Irreversible.
router.delete('/:id', async (req, res, next) => {
  try {
    const company = await qOne('SELECT * FROM companies WHERE id=$1', [req.params.id]);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    await pool.query(`DROP SCHEMA IF EXISTS ${assertSchema(company.schema_name)} CASCADE`);
    await q('DELETE FROM user_directory WHERE company_id=$1', [company.id]);
    await q('DELETE FROM companies WHERE id=$1', [company.id]);
    const dir = path.join(UPLOADS_ROOT, company.slug);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    res.json({ message: `Company "${company.name}" and all its data deleted` });
  } catch (e) { next(e); }
});

module.exports = router;
