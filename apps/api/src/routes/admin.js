/* Tenant management endpoints: overview, reports, analytics, org settings,
 * audit log and email log — all permission-gated. */
const express = require('express');
const { qOne, tq, tqOne } = require('../db');
const audit = require('../audit');
const { sendMail } = require('../mailer');
const { reconcileLeave } = require('../leaveReconcile');
const { addNotification } = require('../notifications');
const { authenticate, tenant, requirePerm } = require('../middleware/auth');
const {
  getCycleStartDay, cycleRange, cycleForDate, cycleLabel, endDayFor, currentYearMonth, todayIso,
  MIN_START_DAY, MAX_START_DAY,
} = require('../cycle');

const router = express.Router();
router.use(authenticate, tenant);

// GET /api/admin/overview — management home (HR / Director)
router.get('/overview', requirePerm('employees.view'), async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const totals = {
      employees: (await tqOne(req.s, `SELECT COUNT(*)::int c FROM {s}.employees`)).c,
      activeEmployees: (await tqOne(req.s, `SELECT COUNT(*)::int c FROM {s}.employees WHERE status='Active'`)).c,
      departments: (await tqOne(req.s, `SELECT COUNT(*)::int c FROM {s}.departments`)).c,
      pendingLeaves: (await tqOne(req.s, `SELECT COUNT(*)::int c FROM {s}.leave_applications WHERE status='Pending'`)).c,
    };
    const todayAttendance = await tq(req.s, `SELECT status, COUNT(*)::int c FROM {s}.attendance WHERE date=$1 GROUP BY status`, [today]);
    /*
     * Department strength, plus an "Unassigned" row.
     *
     * The department-only query drops every active employee whose
     * department_id is NULL, so the widget's rows summed to less than the
     * headline employee count with nothing on screen explaining the gap
     * (11 vs 14 on the live instance). A missing department is worth seeing —
     * it is usually a data-entry gap — so it gets its own row instead of
     * silently disappearing. The row is omitted when the count is zero.
     */
    const deptStrength = await tq(req.s, `
      SELECT d.name, COUNT(e.id)::int c FROM {s}.departments d
      LEFT JOIN {s}.employees e ON e.department_id = d.id AND e.status='Active'
      GROUP BY d.id, d.name ORDER BY c DESC`);
    const unassigned = (await tqOne(req.s,
      `SELECT COUNT(*)::int c FROM {s}.employees WHERE status='Active' AND department_id IS NULL`)).c;
    if (unassigned > 0) deptStrength.push({ name: 'Unassigned', c: unassigned, unassigned: true });
    const recentLeaves = await tq(req.s, `
      SELECT la.id, la.from_date, la.to_date, la.days, la.status,
             lt.code AS leave_code, e.emp_code, (e.first_name || ' ' || e.last_name) AS employee_name
      FROM {s}.leave_applications la
      JOIN {s}.leave_types lt ON lt.id=la.leave_type_id
      JOIN {s}.employees e ON e.id=la.employee_id
      WHERE la.status='Pending'
      ORDER BY la.applied_at DESC LIMIT 6`);
    const recentAudit = await tq(req.s, `SELECT actor, action, details, timestamp FROM {s}.audit_logs ORDER BY id DESC LIMIT 8`);
    res.json({ totals, todayAttendance, deptStrength, recentLeaves, recentAudit, today });
  } catch (e) { next(e); }
});

// GET /api/admin/analytics — Director's analytics view
router.get('/analytics', requirePerm('analytics.view'), async (req, res, next) => {
  try {
    // attendance rate for the last 6 months, counted back from the UTC month
    const nowYm = currentYearMonth();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(nowYm.year, nowYm.month - 1 - i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    /*
     * Each point covers that month's CYCLE, not the calendar month, so the
     * trend line matches the attendance pages it is drawn from. The labels are
     * unchanged — a cycle is named for the month it ends in.
     */
    const startDay = await getCycleStartDay(req.s);
    const attendanceTrend = [];
    for (const ym of months) {
      const [tYear, tMonth] = ym.split('-').map(Number);
      const { from, to } = cycleRange(tYear, tMonth, startDay);
      const agg = await tqOne(req.s, `
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('Present','WFH') THEN 1 WHEN status='Half Day' THEN 0.5 ELSE 0 END), 0) AS present,
          COALESCE(SUM(CASE WHEN status IN ('Present','WFH','Half Day','Absent','Leave') THEN 1 ELSE 0 END), 0) AS working
        FROM {s}.attendance WHERE date BETWEEN $1 AND $2`, [from, to]);
      attendanceTrend.push({ month: ym, rate: agg.working ? Math.round((agg.present / agg.working) * 100) : 0 });
    }
    const leaveByType = await tq(req.s, `
      SELECT lt.name, lt.code, COALESCE(SUM(la.days), 0) AS days, COUNT(la.id)::int AS applications
      FROM {s}.leave_types lt
      LEFT JOIN {s}.leave_applications la ON la.leave_type_id = lt.id AND la.status='Approved'
      GROUP BY lt.id, lt.name, lt.code ORDER BY lt.id`);
    const deptHeadcount = await tq(req.s, `
      SELECT d.name, COUNT(e.id)::int c FROM {s}.departments d
      LEFT JOIN {s}.employees e ON e.department_id=d.id AND e.status='Active'
      GROUP BY d.id, d.name ORDER BY c DESC`);
    // "This month" here is the running cycle, same as the dashboard counters.
    const nowCycle = cycleForDate(todayIso(), startDay);
    const nowRange = cycleRange(nowCycle.year, nowCycle.month, startDay);
    const lateTop = await tq(req.s, `
      SELECT e.emp_code, (e.first_name || ' ' || e.last_name) AS name,
             COALESCE(SUM(CASE WHEN a.late_mark THEN 1 ELSE 0 END), 0)::int late_marks
      FROM {s}.employees e
      LEFT JOIN {s}.attendance a ON a.employee_id=e.id AND a.date BETWEEN $1 AND $2
      WHERE e.status='Active'
      GROUP BY e.id, e.emp_code, name
      HAVING COALESCE(SUM(CASE WHEN a.late_mark THEN 1 ELSE 0 END), 0) > 0
      ORDER BY late_marks DESC LIMIT 5`, [nowRange.from, nowRange.to]);
    const leaveStatusSplit = await tq(req.s,
      `SELECT status, COUNT(*)::int c FROM {s}.leave_applications GROUP BY status`);
    res.json({ attendanceTrend, leaveByType, deptHeadcount, lateTop, leaveStatusSplit });
  } catch (e) { next(e); }
});

// ---- Reports ----

router.get('/reports/attendance-summary', requirePerm('reports.view'), async (req, res, next) => {
  try {
    const now = new Date();
    // UTC: the container's clock is ahead of it, so the local getters name the
    // NEXT month for several hours each evening and the page would silently
    // open on the wrong one.
    const nowYm = currentYearMonth();
    const year = parseInt(req.query.year) || nowYm.year;
    const month = parseInt(req.query.month) || nowYm.month;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    // The report covers the payroll cycle for that month, so its totals match
    // the attendance page and the export rather than quietly differing.
    const { from, to } = cycleRange(year, month, await getCycleStartDay(req.s));
    const rows = await tq(req.s, `
      SELECT e.emp_code, (e.first_name || ' ' || e.last_name) AS name, d.name AS department,
        COALESCE(SUM(CASE WHEN a.status='Present' THEN 1 ELSE 0 END), 0)::int present,
        COALESCE(SUM(CASE WHEN a.status='WFH' THEN 1 ELSE 0 END), 0)::int wfh,
        COALESCE(SUM(CASE WHEN a.status='Half Day' THEN 1 ELSE 0 END), 0)::int half_days,
        COALESCE(SUM(CASE WHEN a.status='Absent' THEN 1 ELSE 0 END), 0)::int absent,
        COALESCE(SUM(CASE WHEN a.status='Leave' THEN 1 ELSE 0 END), 0)::int leave,
        COALESCE(SUM(CASE WHEN a.late_mark THEN 1 ELSE 0 END), 0)::int late_marks
      FROM {s}.employees e
      LEFT JOIN {s}.departments d ON d.id=e.department_id
      LEFT JOIN {s}.attendance a ON a.employee_id=e.id AND a.date BETWEEN $1 AND $2
      WHERE e.status='Active'
      GROUP BY e.id, e.emp_code, name, d.name ORDER BY e.emp_code`, [from, to]);
    res.json({ year, month, period: { from, to }, rows });
  } catch (e) { next(e); }
});

router.get('/reports/leave-summary', requirePerm('reports.view'), async (req, res, next) => {
  try {
    const rows = await tq(req.s, `
      SELECT e.emp_code, (e.first_name || ' ' || e.last_name) AS name,
             lt.code, b.accrued, b.used, (b.accrued-b.used) AS balance
      FROM {s}.leave_balances b
      JOIN {s}.employees e ON e.id=b.employee_id
      JOIN {s}.leave_types lt ON lt.id=b.leave_type_id
      WHERE e.status='Active'
      ORDER BY e.emp_code, lt.id`);
    const byEmp = {};
    for (const r of rows) {
      byEmp[r.emp_code] = byEmp[r.emp_code] || { emp_code: r.emp_code, name: r.name };
      byEmp[r.emp_code][r.code] = { accrued: +r.accrued.toFixed(2), used: r.used, balance: +r.balance.toFixed(2) };
    }
    res.json({ rows: Object.values(byEmp) });
  } catch (e) { next(e); }
});

// ---- Org settings ----

router.get('/departments', requirePerm('employees.view'), async (req, res, next) => {
  try { res.json(await tq(req.s, 'SELECT * FROM {s}.departments ORDER BY name')); } catch (e) { next(e); }
});
router.post('/departments', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Department name is required' });
    try {
      await tq(req.s, 'INSERT INTO {s}.departments (name) VALUES ($1)', [name.trim()]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'That department already exists' });
      throw err;
    }
    audit(req, 'DEPARTMENT_ADDED', name.trim());
    res.status(201).json({ message: 'Department added' });
  } catch (e) { next(e); }
});
router.delete('/departments/:id', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const used = (await tqOne(req.s, 'SELECT COUNT(*)::int c FROM {s}.employees WHERE department_id=$1', [req.params.id])).c;
    if (used) return res.status(400).json({ error: `Cannot delete: ${used} employee(s) are assigned to this department` });
    const result = await tq(req.s, 'DELETE FROM {s}.departments WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.length) return res.status(404).json({ error: 'Department not found' });
    audit(req, 'DEPARTMENT_DELETED', `Department #${req.params.id}`);
    res.json({ message: 'Department removed' });
  } catch (e) { next(e); }
});

router.get('/designations', requirePerm('employees.view'), async (req, res, next) => {
  try { res.json(await tq(req.s, 'SELECT * FROM {s}.designations ORDER BY title')); } catch (e) { next(e); }
});
router.post('/designations', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const { title } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: 'Designation title is required' });
    try {
      await tq(req.s, 'INSERT INTO {s}.designations (title) VALUES ($1)', [title.trim()]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'That designation already exists' });
      throw err;
    }
    audit(req, 'DESIGNATION_ADDED', title.trim());
    res.status(201).json({ message: 'Designation added' });
  } catch (e) { next(e); }
});
router.delete('/designations/:id', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const used = (await tqOne(req.s, 'SELECT COUNT(*)::int c FROM {s}.employees WHERE designation_id=$1', [req.params.id])).c;
    if (used) return res.status(400).json({ error: `Cannot delete: ${used} employee(s) hold this designation` });
    const result = await tq(req.s, 'DELETE FROM {s}.designations WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.length) return res.status(404).json({ error: 'Designation not found' });
    audit(req, 'DESIGNATION_DELETED', `Designation #${req.params.id}`);
    res.json({ message: 'Designation removed' });
  } catch (e) { next(e); }
});

router.get('/holidays', async (req, res, next) => {
  try { res.json(await tq(req.s, 'SELECT * FROM {s}.holidays ORDER BY date')); } catch (e) { next(e); }
});
router.post('/holidays', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const { date, name } = req.body || {};
    if (!date || !name) return res.status(400).json({ error: 'Date and name are required' });
    try {
      await tq(req.s, 'INSERT INTO {s}.holidays (date, name) VALUES ($1,$2)', [date, name]);
      
      // Trigger notification for all users
      const formattedDate = date.split('-').reverse().join('/'); // DD/MM/YYYY format
      await addNotification(req.s, null, 'New Holiday Added 🗓️', `${name} has been added as a company holiday on ${formattedDate}.`, '/attendance');
      
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A holiday already exists on that date' });
      throw err;
    }
    audit(req, 'HOLIDAY_ADDED', `${name} (${date})`);
    res.status(201).json({ message: 'Holiday added' });
  } catch (e) { next(e); }
});
router.delete('/holidays/:id', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const result = await tq(req.s, 'DELETE FROM {s}.holidays WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.length) return res.status(404).json({ error: 'Holiday not found' });
    audit(req, 'HOLIDAY_DELETED', `Holiday #${req.params.id}`);
    res.json({ message: 'Holiday removed' });
  } catch (e) { next(e); }
});

router.get('/announcements', requirePerm('settings.manage'), async (req, res, next) => {
  try { res.json(await tq(req.s, 'SELECT * FROM {s}.announcements ORDER BY date DESC')); } catch (e) { next(e); }
});
router.post('/announcements', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const { title, body, date } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: 'Title and body are required' });
    await tq(req.s, 'INSERT INTO {s}.announcements (title, body, date) VALUES ($1,$2,$3)',
      [title, body, date || new Date().toISOString().slice(0, 10)]);
    
    // Trigger in-app notification for all users
    await addNotification(req.s, null, `New Announcement: ${title}`, body, '/dashboard');
    
    audit(req, 'ANNOUNCEMENT_POSTED', title);
    res.status(201).json({ message: 'Announcement posted' });
  } catch (e) { next(e); }
});
router.delete('/announcements/:id', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const result = await tq(req.s, 'DELETE FROM {s}.announcements WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.length) return res.status(404).json({ error: 'Announcement not found' });
    res.json({ message: 'Announcement removed' });
  } catch (e) { next(e); }
});

// ---- Org settings ----
router.get('/org-settings', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const rows = await tq(req.s, `SELECT key, value FROM {s}.settings`);
    const settingsMap = {};
    for (const r of rows) settingsMap[r.key] = r.value;

    const cycleStartDay = await getCycleStartDay(req.s);
    // UTC, as everywhere else that asks "what is today" server-side.
    const current = cycleForDate(new Date().toISOString().slice(0, 10), cycleStartDay);

    res.json({
      cycle_start_day: cycleStartDay,
      // Derived, not stored — shown so the page can explain what the number
      // means without the reader doing the arithmetic.
      cycle_end_day: endDayFor(cycleStartDay),
      cycle_example: cycleLabel(current.year, current.month, cycleStartDay),
      // Kept in the response because leave accrual still has an accrual day;
      // it is now DERIVED from the cycle rather than separately editable.
      accrual_day: endDayFor(cycleStartDay) ?? 24,
      default_probation_months: settingsMap.default_probation_months ? parseInt(settingsMap.default_probation_months, 10) : 0
    });
  } catch (e) { next(e); }
});

router.put('/org-settings', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const { cycle_start_day, accrual_day, default_probation_months } = req.body || {};

    /*
     * One number governs the whole month cycle: attendance grids, summaries,
     * exports, dashboard counters, payslip periods and leave accrual. The old
     * `accrual_day` field is still accepted so an older client does not start
     * failing mid-deploy, but it is interpreted as the day the cycle ENDS and
     * converted — never stored alongside, because two numbers that must agree
     * are two numbers that can disagree.
     */
    const requestedStart = cycle_start_day !== undefined
      ? parseInt(cycle_start_day, 10)
      : (accrual_day !== undefined ? parseInt(accrual_day, 10) + 1 : undefined);

    if (requestedStart !== undefined) {
      if (isNaN(requestedStart) || requestedStart < MIN_START_DAY || requestedStart > MAX_START_DAY) {
        return res.status(400).json({
          error: `Cycle start day must be a number between ${MIN_START_DAY} and ${MAX_START_DAY}.`,
        });
      }
      await tq(req.s, `
        INSERT INTO {s}.settings (key, value) VALUES ('cycle_start_day', $1)
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [String(requestedStart)]);
      /*
       * The superseded key is removed rather than left behind: getCycleStartDay
       * falls back to accrual_day for tenants configured before this existed,
       * and a stale value would quietly win if cycle_start_day were ever
       * cleared.
       */
      await tq(req.s, `DELETE FROM {s}.settings WHERE key='accrual_day'`);

      const end = endDayFor(requestedStart);
      audit(req, 'CYCLE_START_DAY_SET', end === null
        ? 'Month cycle set to calendar months'
        : `Month cycle set to ${requestedStart}th – ${end}th (leave accrues on the ${end}th)`);
    }

    if (default_probation_months !== undefined) {
      const months = parseInt(default_probation_months, 10);
      if (isNaN(months) || months < 0 || months > 120) {
        return res.status(400).json({ error: 'Default probation period must be a non-negative number of months' });
      }
      await tq(req.s, `
        INSERT INTO {s}.settings (key, value) VALUES ('default_probation_months', $1)
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [String(months)]);
      audit(req, 'DEFAULT_PROBATION_SET', `Default probation period set to ${months} month(s)`);
    }

    res.json({ message: 'Organisation settings updated successfully' });
  } catch (e) { next(e); }
});

/*
 * GET /api/admin/leave-reconciliation — where attendance and leave disagree.
 *
 * Bulk-marking attendance never touches a balance and the approval endpoint is
 * the only thing that does, so the two drift apart silently. This surfaces the
 * drift; it never corrects it, because whether a day marked "EL" was really
 * leave is a question about what happened in the office.
 *
 * Behind leaves.view_all — it names who was absent and when.
 */
router.get('/leave-reconciliation', requirePerm('leaves.view_all'), async (req, res, next) => {
  try {
    const since = /^\d{4}-\d{2}-\d{2}$/.test(req.query.since || '') ? req.query.since : null;
    res.json(await reconcileLeave(req.s, { since }));
  } catch (e) { next(e); }
});

// ---- Logs ----

router.get('/audit-logs', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json(await tq(req.s, 'SELECT * FROM {s}.audit_logs ORDER BY id DESC LIMIT $1', [limit]));
  } catch (e) { next(e); }
});

router.get('/email-log', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json(await tq(req.s, 'SELECT * FROM {s}.email_log ORDER BY id DESC LIMIT $1', [limit]));
  } catch (e) { next(e); }
});

// POST /api/admin/test-email { to? } — verifies the SMTP configuration end to end.
// The result lands in the email log with its delivery status.
router.post('/test-email', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    /* A platform admin's id comes from `admins`, a tenant user's from the
     * company's own `users`. Looking every caller up in {s}.users meant an
     * admin's test mail went to whichever employee happened to share their
     * id — a real message, to a real person, while the admin watched an
     * inbox that never received anything and concluded SMTP was broken. */
    const to = req.body?.to
      || (req.user.adm
        ? (await qOne('SELECT email FROM admins WHERE id=$1', [req.user.id]))?.email
        : (await tqOne(req.s, 'SELECT email FROM {s}.users WHERE id=$1', [req.user.id]))?.email)
      || null;
    if (!to) return res.status(400).json({ error: 'Provide a "to" address (your account has no email)' });
    const smtpConfigured = !!process.env.SMTP_HOST;
    sendMail(req.s, to,
      `[ValidureHR] Test email — ${req.company.name}`,
      `This is a test email from ValidureHR.\n\nIf you are reading this in your inbox, SMTP is configured correctly.\n\nSent: ${new Date().toISOString()}`);
    audit(req, 'TEST_EMAIL_SENT', `Test email queued to ${to}`);
    res.json({
      message: smtpConfigured
        ? `Test email queued to ${to} — check the inbox and the Email Log status`
        : `SMTP is NOT configured — the test mail was recorded in the Email Log only. Set SMTP_HOST/SMTP_USER/SMTP_PASS and redeploy.`,
      smtp_configured: smtpConfigured,
    });
  } catch (e) { next(e); }
});

module.exports = router;
