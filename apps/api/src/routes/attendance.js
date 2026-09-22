const express = require('express');
const { pool, tq, tqOne, ts, assertSchema } = require('../db');
const audit = require('../audit');
const { authenticate, tenant, requirePerm, requireAdmin } = require('../middleware/auth');
const { getCycleStartDay, cycleRange, cycleDates, cycleLabel, currentYearMonth, todayIso } = require('../cycle');

const router = express.Router();
router.use(authenticate, tenant);

/* ------------------------------------------------------------------ *
 * SCALABILITY: ensure a standalone index on `date` so that overview  *
 * queries (WHERE date = $1 across ALL employees) are O(log N).       *
 * The existing UNIQUE(employee_id, date) index is employee-first     *
 * and can't serve date-only lookups efficiently.                     *
 * This runs once per tenant on first request — idempotent.           *
 * ------------------------------------------------------------------ */
const indexEnsured = new Set();
async function ensureDateIndex(schema) {
  if (indexEnsured.has(schema)) return;
  await tq(schema, `CREATE INDEX IF NOT EXISTS idx_attendance_date ON {s}.attendance (date)`);
  indexEnsured.add(schema);
}

/*
 * Builds the full month grid for one employee. The company holiday list and
 * weekends are merged in for EVERY employee automatically — a stored attendance
 * row always wins (so HR can still override a specific day), otherwise a
 * holiday shows as 'Holiday' (with its name) and Sat/Sun as 'Weekend'.
 */
/*
 * The attendance GRID is a calendar month — the 1st to the last day — while
 * PAYROLL runs the company's 25th-to-24th cycle. Those two deliberately differ:
 * people read an attendance calendar as the month on the wall, and were asked
 * to have it back that way, but pay is still earned over the cycle. Anything
 * about money (the salary sheet, LOP, the CSV export HR reconciles against)
 * therefore stays on cycleRange with the real start day — see routes/payroll.js
 * and the /export route below, whose tests pin them to 25–24 precisely so this
 * change cannot quietly spread into pay.
 *
 * cycle.js already treats a start day of 1 as an exact calendar month, so this
 * reuses that arithmetic rather than growing a second implementation of "what
 * are the days in a month" that could disagree with it in February.
 */
const CALENDAR_MONTH_START = 1;

async function monthGrid(schema, empId, year, month) {
  /*
   * Ranges rather than a LIKE prefix: 'YYYY-MM%' would happen to work for a
   * calendar month, but the window travels back to the browser and is used to
   * draw the grid, so it has to be real dates either way. Dates are stored as
   * 'YYYY-MM-DD' text, which sorts and compares correctly, so BETWEEN is exact.
   */
  const startDay = CALENDAR_MONTH_START;
  const { from, to } = cycleRange(year, month, startDay);

  const stored = await tq(schema, `
    SELECT date, status, check_in, check_out, late_mark, remarks
    FROM {s}.attendance WHERE employee_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date`, [empId, from, to]);
  const holidays = await tq(schema, `SELECT date, name FROM {s}.holidays WHERE date BETWEEN $1 AND $2`, [from, to]);

  const holByDate = Object.fromEntries(holidays.map((h) => [h.date, h.name]));
  const byDate = Object.fromEntries(stored.map((r) => [r.date, r]));

  const records = [];
  let totalWorkingDays = 0;
  for (const ds of cycleDates(year, month, startDay)) {
    const [dy, dm, dd] = ds.split('-').map(Number);
    const dow = new Date(dy, dm - 1, dd).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const holidayName = holByDate[ds] || null;
    if (!isWeekend && !holidayName) totalWorkingDays++;

    if (byDate[ds]) {
      records.push({ ...byDate[ds], holiday_name: holidayName });
    } else if (holidayName) {
      records.push({ date: ds, status: 'Holiday', check_in: null, check_out: null, late_mark: false, remarks: null, holiday_name: holidayName });
    } else if (isWeekend) {
      records.push({ date: ds, status: 'Weekend', check_in: null, check_out: null, late_mark: false, remarks: null, holiday_name: null });
    }
    // unmarked working days are intentionally absent from the list (blank cells)
  }
  /*
   * The window comes back with the records. The calendar draws whatever range
   * it is given rather than assuming a calendar month — a cycle starts on the
   * 25th and spans two of them, and a grid built from year/month alone cannot
   * show that. startDay is returned too so a caller needing the same window
   * does not re-read the setting.
   */
  return { records, totalWorkingDays, period: { from, to, label: cycleLabel(year, month, startDay) } };
}

function summarize(records, totalWorkingDays) {
  const s = { totalWorkingDays, presentDays: 0, absentDays: 0, halfDays: 0, wfhDays: 0, leaveDays: 0, lateMarks: 0 };
  for (const r of records) {
    if (r.status === 'Present') s.presentDays++;
    if (r.status === 'Absent') s.absentDays++;
    if (r.status === 'Half Day') s.halfDays++;
    if (r.status === 'WFH') s.wfhDays++;
    if (r.status === 'Leave') s.leaveDays++;
    if (r.late_mark) s.lateMarks++;
  }
  return s;
}

// GET /api/attendance/me?year&month — own attendance
router.get('/me', async (req, res, next) => {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    const now = new Date();
    // UTC: the container's clock is ahead of it, so the local getters name the
    // NEXT month for several hours each evening and the page would silently
    // open on the wrong one.
    const nowYm = currentYearMonth();
    const year = parseInt(req.query.year) || nowYm.year;
    const month = parseInt(req.query.month) || nowYm.month;
    const { records, totalWorkingDays, period } = await monthGrid(req.s, empId, year, month);

    // The manual check_in/check_out fields are retired (HR never used them).
    // The times an employee sees are their OWN biometric device times — own
    // data only, so this stays within the "device times are not rolled out to
    // tenant roles" rule; /employee/:id (HR's view of others) gets none.
    // Companies without biometric attendance skip this entirely.
    if (req.company?.has_device_attendance) {
      // The grid's OWN window, not a recomputed one: device times that cover a
      // different set of days than the statuses they merge into is a bug that
      // has happened here before, and two calls that must agree eventually will
      // not. There is only one window now.
      const { from, to } = period;
      const device = await tq(req.s, `
        SELECT date, check_in, check_out FROM {s}.device_attendance
        WHERE employee_id=$1 AND date BETWEEN $2 AND $3`, [empId, from, to]);
      const deviceByDate = Object.fromEntries(device.map((d) => [d.date, d]));
      for (const r of records) {
        r.check_in = deviceByDate[r.date]?.check_in || r.check_in || null;
        r.check_out = deviceByDate[r.date]?.check_out || r.check_out || null;
      }
      // Days with punches that HR never marked still deserve their times.
      const seen = new Set(records.map((r) => r.date));
      for (const d of device) {
        if (!seen.has(d.date)) {
          records.push({ date: d.date, status: null, check_in: d.check_in, check_out: d.check_out, late_mark: false, remarks: null, holiday_name: null });
        }
      }
      records.sort((a, b) => (a.date < b.date ? -1 : 1));
    }

    res.json({ year, month, period, summary: summarize(records, totalWorkingDays), records });
  } catch (e) { next(e); }
});

// GET /api/attendance/employee/:id?year&month — any employee (view_all)
router.get('/employee/:id', requirePerm('attendance.view_all'), async (req, res, next) => {
  try {
    const now = new Date();
    // UTC: the container's clock is ahead of it, so the local getters name the
    // NEXT month for several hours each evening and the page would silently
    // open on the wrong one.
    const nowYm = currentYearMonth();
    const year = parseInt(req.query.year) || nowYm.year;
    const month = parseInt(req.query.month) || nowYm.month;
    const { records, totalWorkingDays, period } = await monthGrid(req.s, req.params.id, year, month);
    res.json({ year, month, period, summary: summarize(records, totalWorkingDays), records });
  } catch (e) { next(e); }
});

// GET /api/attendance/overview?date=YYYY-MM-DD — all employees for a day
router.get('/overview', requirePerm('attendance.view_all'), async (req, res, next) => {
  try {
    await ensureDateIndex(req.s);
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    // Device times started as a platform-admin preview; on 2026-08-14 the
    // owner rolled the DAY VIEW out to every attendance.view_all holder
    // (HR/OWNER/DIRECTOR). The per-employee month view and the CSV export
    // still carry no device times, and the Device Mapping panel remains
    // platform-admin only. Companies without biometric attendance (the
    // has_device_attendance flag, asked at creation) get none of it.
    const withDevice = !!req.company?.has_device_attendance;
    const rows = await tq(req.s, `
      SELECT e.id AS employee_id, e.emp_code, (e.first_name || ' ' || e.last_name) AS name,
             d.name AS department, a.status, a.late_mark, a.check_in, a.check_out
             ${withDevice ? ', da.check_in AS device_check_in, da.check_out AS device_check_out' : ''}
      FROM {s}.employees e
      LEFT JOIN {s}.departments d ON d.id = e.department_id
      LEFT JOIN {s}.attendance a ON a.employee_id = e.id AND a.date = $1
      ${withDevice ? 'LEFT JOIN {s}.device_attendance da ON da.employee_id = e.id AND da.date = $1' : ''}
      WHERE e.status = 'Active'
      ORDER BY e.emp_code`, [date]);

    // company holiday / weekend applies to everyone without an explicit record
    const hol = await tqOne(req.s, 'SELECT name FROM {s}.holidays WHERE date=$1', [date]);
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const fallback = hol ? 'Holiday' : (dow === 0 || dow === 6) ? 'Weekend' : null;
    for (const r of rows) if (!r.status && fallback) r.status = fallback;

    res.json({ date, holiday_name: hol?.name || null, rows });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ *
 * Device mapping — platform-admin preview, like the device-time       *
 * columns. The sync script pushes the biometric device's roster into  *
 * {s}.device_employee_map; these endpoints let the admin link each    *
 * machine to an employee. Registered BEFORE the '/:empId/:date' PUT   *
 * so 'device-map' is never swallowed by that pattern.                 *
 * ------------------------------------------------------------------ */
// Companies without biometric attendance have no mapping to manage.
function requireDeviceAttendance(req, res, next) {
  if (!req.company?.has_device_attendance) {
    return res.status(404).json({ error: 'Device attendance is not enabled for this company' });
  }
  next();
}

router.get('/device-map', requireAdmin, requireDeviceAttendance, async (req, res, next) => {
  try {
    const rows = await tq(req.s, `
      SELECT m.machine_id, m.device_name, m.employee_id, e.emp_code,
             (e.first_name || ' ' || e.last_name) AS employee_name
      FROM {s}.device_employee_map m
      LEFT JOIN {s}.employees e ON e.id = m.employee_id
      ORDER BY (CASE WHEN m.machine_id ~ '^[0-9]+$' THEN m.machine_id::int END), m.machine_id`);
    res.json(rows);
  } catch (e) { next(e); }
});

router.put('/device-map/:machineId', requireAdmin, requireDeviceAttendance, async (req, res, next) => {
  try {
    const machineId = String(req.params.machineId || '').trim();
    if (!machineId) return res.status(400).json({ error: 'Machine id required' });
    const employeeId = (req.body || {}).employee_id ?? null;
    if (employeeId !== null && !Number.isInteger(employeeId)) {
      return res.status(400).json({ error: 'employee_id must be an integer or null' });
    }
    if (employeeId !== null) {
      const emp = await tqOne(req.s, 'SELECT id FROM {s}.employees WHERE id=$1', [employeeId]);
      if (!emp) return res.status(404).json({ error: 'Employee not found' });
    }
    await tq(req.s, `
      INSERT INTO {s}.device_employee_map (machine_id, employee_id) VALUES ($1, $2)
      ON CONFLICT (machine_id) DO UPDATE SET
        employee_id = EXCLUDED.employee_id,
        updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`, [machineId, employeeId]);
    audit(req, 'DEVICE_MAP_EDITED', `Machine ${machineId} -> employee #${employeeId === null ? 'none' : employeeId}`);
    res.json({ message: 'Mapping saved' });
  } catch (e) { next(e); }
});

function isFutureDate(dateStr) {
  const serverToday = new Date();
  // Allow tomorrow (local server time) to accommodate clients in later timezones
  const tomorrow = new Date(serverToday.getTime() + 24 * 60 * 60 * 1000);
  const maxAllowed = tomorrow.toISOString().slice(0, 10);
  return dateStr > maxAllowed;
}

// PUT /api/attendance/:empId/:date — edit / regularize
router.put('/:empId/:date', requirePerm('attendance.manage'), async (req, res, next) => {
  try {
    const { empId, date } = req.params;
    // Manual check_in/check_out are retired — HR never filled them, and real
    // times now come from the biometric device (device_attendance).
    const { status, late_mark, remarks } = req.body || {};

    if (isFutureDate(date)) {
      return res.status(400).json({ error: 'Cannot mark attendance for a future date' });
    }

    const valid = ['Present', 'Absent', 'Half Day', 'WFH', 'Leave', 'Holiday', 'Weekend', 'LOP', 'SL', 'EL'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await tq(req.s, `
      INSERT INTO {s}.attendance (employee_id, date, status, late_mark, remarks)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (employee_id, date) DO UPDATE SET
        status=EXCLUDED.status, late_mark=EXCLUDED.late_mark, remarks=EXCLUDED.remarks`,
      [empId, date, status, !!late_mark, remarks || 'Regularized']);
    audit(req, 'ATTENDANCE_EDITED', `Set ${date} = ${status} for employee #${empId}`);
    res.json({ message: 'Attendance updated' });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ *
 * POST /api/attendance/bulk — batch-mark attendance for a whole day  *
 *                                                                    *
 * Body: { date: "YYYY-MM-DD", entries: [{ employee_id, status }] }  *
 *                                                                    *
 * Scalability:                                                       *
 *  • Single multi-row INSERT … ON CONFLICT in ONE database query     *
 *  • Wrapped in a transaction — all-or-nothing                       *
 *  • Parameterized values — no SQL injection risk                    *
 *  • Client sends only changed entries (dirty-checking on frontend)  *
 * ------------------------------------------------------------------ */
router.post('/bulk', requirePerm('attendance.manage'), async (req, res, next) => {
  try {
    const { date, entries } = req.body || {};
    if (!date || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'date and non-empty entries[] required' });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    if (isFutureDate(date)) {
      return res.status(400).json({ error: 'Cannot mark attendance for a future date' });
    }

    const valid = ['Present', 'Absent', 'Half Day', 'WFH', 'Leave', 'Holiday', 'LOP', 'SL', 'EL'];
    for (const e of entries) {
      if (!e.employee_id || !valid.includes(e.status)) {
        return res.status(400).json({ error: `Invalid entry: employee_id=${e.employee_id}, status=${e.status}` });
      }
    }

    // Build a single multi-row INSERT with parameterized values.
    // For N entries we generate: VALUES ($1,$2,$3,$4), ($5,$6,$7,$8), ...
    const schema = req.s;
    assertSchema(schema);

    const valueClauses = [];
    const params = [];
    let idx = 1;
    for (const e of entries) {
      valueClauses.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3})`);
      params.push(e.employee_id, date, e.status, e.remarks || 'Bulk marked by HR');
      idx += 4;
    }

    const sql = `
      INSERT INTO ${schema}.attendance (employee_id, date, status, remarks)
      VALUES ${valueClauses.join(', ')}
      ON CONFLICT (employee_id, date) DO UPDATE SET
        status = EXCLUDED.status,
        remarks = EXCLUDED.remarks`;

    // Execute in a transaction for atomicity
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql, params);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    audit(req, 'ATTENDANCE_BULK', `Bulk-marked ${entries.length} employees for ${date}`);
    res.json({ message: 'Bulk attendance saved', count: entries.length });
  } catch (e) { next(e); }
});

// GET /api/attendance/export?year&month — CSV of ALL employees (Director + HR)
router.get('/export', requirePerm('attendance.export'), async (req, res, next) => {
  try {
    const now = new Date();
    // UTC: the container's clock is ahead of it, so the local getters name the
    // NEXT month for several hours each evening and the page would silently
    // open on the wrong one.
    const nowYm = currentYearMonth();
    const year = parseInt(req.query.year) || nowYm.year;
    const month = parseInt(req.query.month) || nowYm.month;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const startDay = await getCycleStartDay(req.s);
    const { from, to } = cycleRange(year, month, startDay);
    const rows = await tq(req.s, `
      SELECT e.emp_code, (e.first_name || ' ' || e.last_name) AS name, a.date, a.status, a.late_mark, a.check_in, a.check_out
      FROM {s}.attendance a JOIN {s}.employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1 AND $2 ORDER BY e.emp_code, a.date`, [from, to]);

    // Entry/Exit are the device times. They were left out of this export while
    // nothing consumed them; payroll now reconciles against the same sheet, so
    // the columns are back and the row mapper below emits them. Header width
    // and row width have to stay in step — a CSV whose first line is short by
    // two columns silently shifts every field after Status.
    //
    // The header stays the FIRST line. A "Period: ..." banner above it reads
    // nicely in Excel and silently breaks anything that treats row 1 as the
    // column names, which is most things that consume a CSV. The period goes in
    // the filename instead, where it cannot corrupt the shape — this sheet
    // covers a payroll cycle, not a calendar month, and the dates have to be
    // discoverable somewhere.
    const header = 'Employee Code,Name,Date,Status,Entry Time,Exit Time,Late Mark';
    const csv = [header, ...rows.map((r) =>
      [r.emp_code, `"${r.name}"`, r.date, r.status, r.check_in || '', r.check_out || '', r.late_mark ? 'Yes' : 'No'].join(',')
    )].join('\n');

    audit(req, 'ATTENDANCE_EXPORTED', `Exported attendance report for ${ym} (${from} to ${to})`);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition',
      `attachment; filename="attendance-${req.company.slug}-${ym}_${from}_to_${to}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

router.post('/punch', async (req, res, next) => {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee profile linked' });
    const { action } = req.body;
    if (action !== 'in' && action !== 'out') return res.status(400).json({ error: 'Invalid action' });

    /*
     * The DAY is UTC, like every other business date here — see cycle.js. It
     * has to be, because the dashboard reads this row back with todayIso(),
     * and the container's local clock is Render's Singapore region (UTC+8).
     * Taking the day from the local clock put every punch after 16:00 IST on
     * TOMORROW's row, which the dashboard then could not find: the card went
     * blank and the day the office actually worked was recorded against the
     * next one. The UTC day also matches the night shift's attendance row for
     * the whole 19:00-04:00 IST stretch, which is the behaviour the device
     * sync already relies on.
     *
     * The CLOCK TIME is IST, because it sits in the same column as the
     * biometric device's check_in/check_out, and those are the office's wall
     * clock. Server-local time would show every punch 2.5 hours ahead of the
     * time the employee actually saw.
     */
    const IST_OFFSET_MS = (5 * 60 + 30) * 60000;
    const now = new Date();
    const date = todayIso();
    const time = new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(11, 19);

    /*
     * Self-service punching is deliberate: the employee's own Login/Logout is
     * allowed to mark them Present. That means this endpoint can create the row
     * payroll counts a day from, so the audit entry has to say WHICH of the two
     * things happened — a punch that merely stamped a time onto a day HR or the
     * device had already decided is unremarkable, and a punch that asserted the
     * day's attendance by itself is the one worth being able to find later.
     *
     * `xmax = 0` is true only for a row this statement inserted, so it
     * distinguishes the two without a second query.
     */
    if (action === 'in') {
      const [row] = await tq(req.s, `
        INSERT INTO {s}.attendance (employee_id, date, status, check_in)
        VALUES ($1, $2, 'Present', $3)
        ON CONFLICT (employee_id, date) DO UPDATE SET
          check_in = EXCLUDED.check_in,
          status = {s}.attendance.status
        RETURNING (xmax = 0) AS created, status
      `, [empId, date, time]);
      audit(req, 'PUNCH_IN', row && row.created
        ? `Punched in at ${time} — self-service punch created today's row as Present`
        : `Punched in at ${time} (day already marked ${(row && row.status) || 'Present'})`);
    } else {
      const [row] = await tq(req.s, `
        INSERT INTO {s}.attendance (employee_id, date, status, check_out)
        VALUES ($1, $2, 'Present', $3)
        ON CONFLICT (employee_id, date) DO UPDATE SET
          check_out = EXCLUDED.check_out,
          status = {s}.attendance.status
        RETURNING (xmax = 0) AS created, status
      `, [empId, date, time]);
      audit(req, 'PUNCH_OUT', row && row.created
        ? `Punched out at ${time} — self-service punch created today's row as Present`
        : `Punched out at ${time} (day already marked ${(row && row.status) || 'Present'})`);
    }
    res.json({ message: `Punched ${action} successfully`, time, action });
  } catch (e) { next(e); }
});

module.exports = router;
