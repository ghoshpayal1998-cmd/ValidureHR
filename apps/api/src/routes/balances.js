/* Leave balance management (HR): monthly accrual rates per leave type, the
 * employees × types balance grid, manual adjustments (decimals allowed) and an
 * on-demand accrual run. Balances accumulate monthly and never expire. */
const express = require('express');
const { tq, tqOne } = require('../db');
const audit = require('../audit');
const { runAccrualForCompany, ym, getAccrualDay } = require('../accrual');
const { authenticate, tenant, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, tenant, requirePerm('balances.manage'));

// GET /api/balances — grid of every active employee × leave type
router.get('/', async (req, res, next) => {
  try {
    const types = await tq(req.s, 'SELECT * FROM {s}.leave_types ORDER BY id');
    const rows = await tq(req.s, `
      SELECT b.*, e.emp_code, (e.first_name || ' ' || e.last_name) AS employee_name
      FROM {s}.leave_balances b
      JOIN {s}.employees e ON e.id = b.employee_id
      WHERE e.status='Active'
      ORDER BY e.emp_code`);
    const byEmp = {};
    for (const r of rows) {
      byEmp[r.emp_code] = byEmp[r.emp_code] || { emp_code: r.emp_code, employee_id: r.employee_id, name: r.employee_name, balances: {} };
      byEmp[r.emp_code].balances[r.leave_type_id] = {
        accrued: r.accrued, used: r.used, balance: +(r.accrued - r.used).toFixed(2), last_accrued: r.last_accrued,
      };
    }
    res.json({ types, employees: Object.values(byEmp), current_period: ym() });
  } catch (e) { next(e); }
});

// PUT /api/balances/rates/:typeId { monthly_accrual } — HR sets leaves on a monthly basis
router.put('/rates/:typeId', async (req, res, next) => {
  try {
    const { monthly_accrual } = req.body || {};
    const rate = Number(monthly_accrual);
    if (isNaN(rate) || rate < 0) return res.status(400).json({ error: 'Monthly accrual must be a non-negative number (decimals allowed)' });
    const result = await tq(req.s, 'UPDATE {s}.leave_types SET monthly_accrual=$1 WHERE id=$2 RETURNING name', [rate, req.params.typeId]);
    if (!result.length) return res.status(404).json({ error: 'Leave type not found' });
    audit(req, 'ACCRUAL_RATE_SET', `${result[0].name}: ${rate} day(s)/month`);
    res.json({ message: `${result[0].name}: ${rate} day(s) will accrue per month` });
  } catch (e) { next(e); }
});

// POST /api/balances/types { name, code, monthly_accrual } — add a leave type
router.post('/types', async (req, res, next) => {
  try {
    const { name, code, monthly_accrual } = req.body || {};
    if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });
    const rate = Number(monthly_accrual) || 0;
    let type;
    try {
      type = await tqOne(req.s, `INSERT INTO {s}.leave_types (name, code, monthly_accrual) VALUES ($1,$2,$3) RETURNING id`,
        [name.trim(), code.trim().toUpperCase(), rate]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A leave type with that name or code already exists' });
      throw err;
    }
    // balances always open at ZERO — accrual (if any) starts from the next month
    await tq(req.s, `
      INSERT INTO {s}.leave_balances (employee_id, leave_type_id, accrued, used, last_accrued)
      SELECT id, $1, 0, 0, $2 FROM {s}.employees`, [type.id, ym()]);
    audit(req, 'LEAVE_TYPE_ADDED', `${name.trim()} (${rate}/month)`);
    res.status(201).json({ message: 'Leave type added — balances opened at 0 for all employees' });
  } catch (e) { next(e); }
});

// PUT /api/balances/types/:id { name, code }
router.put('/types/:id', async (req, res, next) => {
  try {
    const { name, code } = req.body || {};
    if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });
    try {
      const result = await tq(req.s, 'UPDATE {s}.leave_types SET name=$1, code=$2 WHERE id=$3 RETURNING id',
        [name.trim(), code.trim().toUpperCase(), req.params.id]);
      if (!result.length) return res.status(404).json({ error: 'Leave type not found' });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A leave type with that name or code already exists' });
      throw err;
    }
    audit(req, 'LEAVE_TYPE_EDITED', `${name.trim()} (${code.trim().toUpperCase()})`);
    res.json({ message: 'Leave type updated' });
  } catch (e) { next(e); }
});

// DELETE /api/balances/types/:id — only if never used
router.delete('/types/:id', async (req, res, next) => {
  try {
    const used = (await tqOne(req.s, 'SELECT COUNT(*)::int c FROM {s}.leave_applications WHERE leave_type_id=$1', [req.params.id])).c;
    if (used) return res.status(400).json({ error: `Cannot delete: ${used} application(s) reference this type` });
    await tq(req.s, 'DELETE FROM {s}.leave_balances WHERE leave_type_id=$1', [req.params.id]);
    const result = await tq(req.s, 'DELETE FROM {s}.leave_types WHERE id=$1 RETURNING name', [req.params.id]);
    if (!result.length) return res.status(404).json({ error: 'Leave type not found' });
    audit(req, 'LEAVE_TYPE_DELETED', result[0].name);
    res.json({ message: 'Leave type deleted' });
  } catch (e) { next(e); }
});

// POST /api/balances/adjust { employee_id, leave_type_id, delta, note } — manual credit/debit
router.post('/adjust', async (req, res, next) => {
  try {
    const { employee_id, leave_type_id, delta, note } = req.body || {};
    const d = Number(delta);
    if (!employee_id || !leave_type_id || isNaN(d) || d === 0) {
      return res.status(400).json({ error: 'Employee, leave type and a non-zero adjustment are required' });
    }
    const row = await tqOne(req.s,
      `UPDATE {s}.leave_balances SET accrued = accrued + $1 WHERE employee_id=$2 AND leave_type_id=$3 RETURNING accrued, used`,
      [d, employee_id, leave_type_id]);
    if (!row) return res.status(404).json({ error: 'Balance row not found' });
    await tq(req.s, `
      INSERT INTO {s}.leave_ledger (employee_id, leave_type_id, delta, kind, note, actor)
      VALUES ($1,$2,$3,'adjustment',$4,$5)`,
      [employee_id, leave_type_id, d, note || 'Manual adjustment', req.user.username]);
    audit(req, 'BALANCE_ADJUSTED', `Employee #${employee_id}, type #${leave_type_id}: ${d > 0 ? '+' : ''}${d} (${note || 'no note'})`);
    res.json({ message: `Balance adjusted by ${d > 0 ? '+' : ''}${d} day(s)`, balance: +(row.accrued - row.used).toFixed(2) });
  } catch (e) { next(e); }
});

// GET /api/balances/ledger/:employeeId — the full calculation trail for one employee
router.get('/ledger/:employeeId', async (req, res, next) => {
  try {
    const emp = await tqOne(req.s,
      `SELECT emp_code, (first_name || ' ' || last_name) AS name, probation_until FROM {s}.employees WHERE id=$1`,
      [req.params.employeeId]);
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const entries = await tq(req.s, `
      SELECT l.delta, l.kind, l.note, l.actor, l.created_at, lt.code, lt.name AS type_name
      FROM {s}.leave_ledger l JOIN {s}.leave_types lt ON lt.id = l.leave_type_id
      WHERE l.employee_id=$1 ORDER BY l.id DESC LIMIT 200`, [req.params.employeeId]);
    res.json({ employee: emp, entries });
  } catch (e) { next(e); }
});

// POST /api/balances/run-accrual — credit all pending months now (also runs automatically)
router.post('/run-accrual', async (req, res, next) => {
  try {
    const credited = await runAccrualForCompany(req.s);
    res.json({ message: credited ? `Accrual credited on ${credited} balance row(s)` : 'All balances already up to date for this month' });
  } catch (e) { next(e); }
});

/*
 * GET /api/balances/accrual-day — the day accrual actually credits on.
 *
 * DERIVED from cycle_start_day, never stored. These two handlers used to read
 * and write a separate `accrual_day` setting, but cycle.js abandoned that on
 * purpose ("DERIVED from this and never read back", and deliberately no
 * fallback to it), and PUT /admin/org-settings deletes the row outright. So
 * the old GET reported a number the engine ignores and the old PUT wrote one
 * nothing would ever read — it answered with a success message, disagreed
 * with the Settings screen, and changed nothing. There is no PUT here now:
 * the cycle start day is the single place this is configured.
 */
router.get('/accrual-day', async (req, res, next) => {
  try {
    res.json({ accrual_day: await getAccrualDay(req.s) });
  } catch (e) { next(e); }
});

module.exports = router;
