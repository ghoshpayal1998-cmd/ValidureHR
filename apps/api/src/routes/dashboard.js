const express = require('express');
const { tq, tqOne } = require('../db');
const { authenticate, tenant } = require('../middleware/auth');
const { getCycleStartDay, cycleRange, cycleForDate, cycleLabel, todayIso } = require('../cycle');

const router = express.Router();
router.use(authenticate, tenant);

// GET /api/dashboard — employee home dashboard (+ manager's team-leave intimations)
router.get('/', async (req, res, next) => {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee profile linked to this account' });

    const profile = await tqOne(req.s, `
      SELECT e.id, e.emp_code, e.first_name, e.last_name, e.phone, e.emergency_contact, e.email, e.doj, e.dob, e.status, e.probation_until, e.photo_file,
             d.name AS department, g.title AS designation,
             (m.first_name || ' ' || m.last_name) AS reporting_manager
      FROM {s}.employees e
      LEFT JOIN {s}.departments d ON d.id = e.department_id
      LEFT JOIN {s}.designations g ON g.id = e.designation_id
      LEFT JOIN {s}.employees m ON m.id = e.reporting_manager_id
      WHERE e.id = $1`, [empId]);

    /*
     * "This month" means the CURRENT CYCLE, not the calendar month — the same
     * window the attendance page shows. On the 26th these counters would
     * otherwise reset while the attendance grid still showed the running
     * cycle, and the employee sees two different answers to "how many days
     * have I been in this month".
     */
    const now = new Date();
    const startDay = await getCycleStartDay(req.s);
    // UTC, like accrual and every stored date. The container's clock is AHEAD
    // of UTC, so local getters would put this counter in the next cycle for
    // several hours each evening.
    const current = cycleForDate(todayIso(), startDay);
    const ym = `${current.year}-${String(current.month).padStart(2, '0')}`;
    const { from, to } = cycleRange(current.year, current.month, startDay);
    const monthAgg = await tqOne(req.s, `
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('Present','WFH') THEN 1 WHEN status='Half Day' THEN 0.5 ELSE 0 END), 0) AS present_days,
        COALESCE(SUM(CASE WHEN status='Absent' THEN 1 ELSE 0 END), 0) AS absent_days,
        COALESCE(SUM(CASE WHEN status='WFH' THEN 1 ELSE 0 END), 0) AS wfh_days,
        COALESCE(SUM(CASE WHEN late_mark = true THEN 1 ELSE 0 END), 0) AS late_days
      FROM {s}.attendance WHERE employee_id=$1 AND date BETWEEN $2 AND $3`, [empId, from, to]);

    const balances = await tq(req.s, `
      SELECT lt.name, lt.code, lt.monthly_accrual, b.accrued, b.used, (b.accrued - b.used) AS balance
      FROM {s}.leave_balances b JOIN {s}.leave_types lt ON lt.id = b.leave_type_id
      WHERE b.employee_id=$1 ORDER BY lt.id`, [empId]);
    const totalLeaveBalance = +balances.reduce((s, b) => s + b.balance, 0).toFixed(2);

    const today = todayIso();
    const upcomingHolidays = await tq(req.s, `SELECT date, name FROM {s}.holidays WHERE date >= $1 ORDER BY date LIMIT 4`, [today]);

    // The employee's own entry time today, from the biometric device. The
    // server's UTC date matches the night shift's attendance day for the whole
    // 19:00–04:00 IST stretch, so "today" is the current shift's row. Absent
    // (key omitted, card hidden) for companies without biometric attendance.
    const todayDevice = req.company?.has_device_attendance
      ? await tqOne(req.s, `
          SELECT check_in FROM {s}.device_attendance WHERE employee_id=$1 AND date=$2`, [empId, today])
      : undefined;

    const employees = await tq(req.s, `
      SELECT e.id, e.emp_code, e.first_name, e.last_name, e.dob, e.doj, e.photo_file,
             e.email, e.phone, e.emergency_contact,
             d.name as department, g.title as designation,
             (m.first_name || ' ' || m.last_name) AS reporting_manager
      FROM {s}.employees e
      LEFT JOIN {s}.departments d ON d.id = e.department_id
      LEFT JOIN {s}.designations g ON g.id = e.designation_id
      LEFT JOIN {s}.employees m ON m.id = e.reporting_manager_id
      WHERE e.status='Active'
      ORDER BY e.first_name
    `);
    const upcomingBirthdays = employees
      .map((e) => {
        const [, m, d] = e.dob.split('-').map(Number);
        let year = now.getFullYear();
        if (new Date(year, m - 1, d) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) year++;
        const bday = new Date(year, m - 1, d);
        const label = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        return { ...e, next_birthday: label, diff: (bday - now) / 86400000 };
      })
      .filter((e) => e.diff <= 45)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 5)
      .map(({ diff, dob, ...rest }) => rest);

    const announcements = await tq(req.s, `SELECT title, body, date FROM {s}.announcements ORDER BY date DESC LIMIT 5`);

    // Leave intimations for reporting managers: recent applications from direct reports.
    // Managers do not approve — this is informational (matching the email intimation).
    const teamLeaves = await tq(req.s, `
      SELECT la.id, la.from_date, la.to_date, la.days, la.status, la.reason, la.applied_at,
             lt.code AS leave_code, e.emp_code, (e.first_name || ' ' || e.last_name) AS employee_name
      FROM {s}.leave_applications la
      JOIN {s}.leave_types lt ON lt.id = la.leave_type_id
      JOIN {s}.employees e ON e.id = la.employee_id
      WHERE e.reporting_manager_id = $1
      ORDER BY la.applied_at DESC LIMIT 6`, [empId]);

    const todayPunch = await tqOne(req.s, `SELECT check_in, check_out FROM {s}.attendance WHERE employee_id=$1 AND date=$2`, [empId, today]);

    res.json({
      profile,
      widgets: {
        presentDays: monthAgg.present_days,
        absentDays: monthAgg.absent_days,
        wfhDays: monthAgg.wfh_days,
        lateDays: monthAgg.late_days,
        leaveBalance: totalLeaveBalance,
        month: ym,
        // So the widget can say which dates it is counting, rather than
        // leaving "this month" to be read as the calendar one.
        periodLabel: cycleLabel(current.year, current.month, startDay),
        todayPunch: { checkIn: todayPunch?.check_in || null, checkOut: todayPunch?.check_out || null },
        ...(todayDevice !== undefined ? { todayEntry: todayDevice?.check_in || null } : {}),
      },
      leaveBalances: balances,
      upcomingHolidays,
      upcomingBirthdays,
      announcements,
      teamLeaves,
      /*
       * The colleague staff directory, and an intentional one: clicking a
       * colleague opens Employee Details with their mail ID, contact number,
       * emergency contact, joining date and reporting manager. That is the
       * whole point of the feature, and it is what an internal directory is
       * for.
       *
       * These columns were briefly trimmed out of here on the reasoning that
       * the directory LIST only draws a name and a designation, so the rest was
       * unused. That was wrong — it missed the detail modal the list opens, and
       * every field in it went blank on the live site. If this is narrowed
       * again, check every consumer of activeEmployees first, not just the one
       * that renders the list.
       *
       * dob is fetched for the birthday widget and dropped here.
       */
      activeEmployees: employees.map(({ dob, ...rest }) => rest),
    });
  } catch (e) { next(e); }
});

module.exports = router;
