/* Platform admin: create and manage companies. Every company is a self-contained
 * object — its own PostgreSQL schema, its own uploads folder, its own roles. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { q, qOne, tq, tqOne, pool, createTenantSchema, assertSchema } = require('../db');
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

// POST /api/companies { name, slug? } — creates the schema, folders, system roles, leave types
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    let { slug } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Company name is required' });
    slug = (slug || name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
    if (slug.length < 2) return res.status(400).json({ error: 'Slug must be at least 2 letters/digits' });

    const dup = await qOne('SELECT id FROM companies WHERE LOWER(name)=LOWER($1) OR slug=$2', [name.trim(), slug]);
    if (dup) return res.status(409).json({ error: 'A company with that name or slug already exists' });

    const schema = assertSchema(`c_${slug}`);
    const hasDeviceAttendance = !!(req.body || {}).has_device_attendance;
    const company = await qOne(
      `INSERT INTO companies (name, slug, schema_name, has_device_attendance) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name.trim(), slug, schema, hasDeviceAttendance]);

    // createTenantSchema also seeds/refreshes the system roles (see syncSystemRoles).
    await createTenantSchema(schema);
    ensureCompanyDirs(slug);

    // default leave types (monthly accrual rates — HR can change them later)
    for (const [n, code, rate] of DEFAULT_LEAVE_TYPES) {
      await tq(schema, `INSERT INTO {s}.leave_types (name, code, monthly_accrual) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING`,
        [n, code, rate]);
    }
    await tq(schema, `INSERT INTO {s}.audit_logs (actor, action, details) VALUES ($1,'COMPANY_CREATED',$2)`,
      [req.user.username, `Company "${name.trim()}" provisioned`]);

    res.status(201).json({ message: `Company "${name.trim()}" created`, company });
  } catch (e) { next(e); }
});

// PUT /api/companies/:id { status } — suspend / activate
router.put('/:id', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!['Active', 'Suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const result = await q('UPDATE companies SET status=$1 WHERE id=$2 RETURNING id', [status, req.params.id]);
    if (!result.length) return res.status(404).json({ error: 'Company not found' });
    res.json({ message: `Company ${status === 'Active' ? 'activated' : 'suspended'}` });
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
