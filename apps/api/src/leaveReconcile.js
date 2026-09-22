/*
 * Leave reconciliation.
 *
 * Attendance and leave are separate subsystems and can drift apart in silence.
 * HR's bulk-mark writes a status straight onto {s}.attendance and never touches
 * a balance; the approval endpoint deducts a balance and marks attendance. So
 * a day can end up marked "EL" with no approved application behind it, and an
 * application can end up Approved with nothing deducted — and nothing anywhere
 * notices either.
 *
 * Found on 2026-08-31 while checking one employee's balance: three days marked
 * Earned Leave in attendance, one approved application between them, and a
 * balance overstated by two days as a result. That was not a code failure —
 * both halves behaved as designed — which is exactly why it needed a check of
 * its own rather than a fix.
 *
 * Two directions, because they fail independently:
 *
 *   unbackedAttendance   — a day marked as leave with no approved application
 *                          covering it. The balance was never reduced, so the
 *                          employee still appears to hold leave they have taken.
 *   undeductedApprovals  — an approved, paid application with no leave_taken
 *                          ledger entry. The approval did not go through the
 *                          endpoint, so the deduction never happened.
 *
 * Read-only. This reports; it never adjusts a balance. Deciding whether a
 * marked day was really leave is a question about what happened in the office,
 * not something a query can settle.
 */
const { tq, tqOne } = require('./db');

/** The day after `ds`, as 'YYYY-MM-DD'. Calendar days, so local Date is right. */
function nextDay(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const t = new Date(y, m - 1, d + 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/*
 * Statuses that mean "this person was on leave AND a balance should have moved".
 *
 * LOP is deliberately absent. Loss of Pay is unpaid — it deducts nothing by
 * design, exactly like an unpaid leave application — so an LOP day can never
 * overstate a balance. Reporting it would be a permanent false positive, and a
 * report that always has entries in it is one people stop opening. The tenant
 * has three such days; before this they sat in the list forever with nothing
 * anyone could do about them.
 *
 * Kept in one place because the attendance CHECK constraint allows more values
 * than the leave system knows about, and a new one added there has to be
 * considered here too.
 */
const LEAVE_STATUSES = ['EL', 'SL', 'Leave'];

/** Attendance statuses that are unpaid, and so never move a balance. */
const UNPAID_STATUSES = ['LOP'];

/*
 * The date through which the historical backlog has been reviewed and accepted.
 *
 * The days before it were settled through manual balance adjustments whose note
 * is a bare "Manual adjustment" with no date, so nothing can match an
 * adjustment to the day it covered — proven on 2026-09-01, when the report
 * flagged two days for FTRN009 whose balance the owner confirmed was already
 * correct. Re-listing them forever would be the same false-positive trap as
 * LOP: a report that always has entries is one nobody opens.
 *
 * So the backlog is baselined rather than pretended away. Anything ON or AFTER
 * this date is a NEW divergence and is reported. `?since=` overrides it, which
 * is how you look at the history again.
 */
async function reconciledThrough(schema) {
  try {
    const row = await tqOne(schema, `SELECT value FROM {s}.settings WHERE key='leave_reconciled_through'`);
    return row && /^\d{4}-\d{2}-\d{2}$/.test(row.value) ? row.value : null;
  } catch {
    return null;
  }
}

/** Days marked as leave in attendance with no approved application behind them. */
async function unbackedAttendance(schema, { since = null } = {}) {
  return tq(schema, `
    SELECT e.emp_code, (e.first_name || ' ' || e.last_name) AS name,
           a.date, a.status, a.remarks
    FROM {s}.attendance a
    JOIN {s}.employees e ON e.id = a.employee_id
    WHERE a.status = ANY($1)
      AND ($2::text IS NULL OR a.date >= $2)
      AND NOT EXISTS (
        SELECT 1 FROM {s}.leave_applications la
        WHERE la.employee_id = a.employee_id
          AND la.status = 'Approved'
          AND a.date BETWEEN la.from_date AND la.to_date)
      /*
       * Nor already settled by hand. A day can be reconciled without an
       * application ever existing — that is what happened to the days found on
       * 2026-08-31 — and once the balance has been reduced the day is no longer
       * a discrepancy. Matched on the date appearing in the ledger note, which
       * is a heuristic: there is no column linking a ledger entry to a date.
       * It errs towards hiding a settled day rather than nagging about it.
       */
      AND NOT EXISTS (
        SELECT 1 FROM {s}.leave_ledger l
        WHERE l.employee_id = a.employee_id
          AND l.kind = 'leave_taken'
          AND l.note LIKE '%' || a.date || '%')
    ORDER BY a.date DESC, e.emp_code`, [LEAVE_STATUSES, since]);
}

/**
 * Approved paid applications whose deduction never happened.
 *
 * Matched on the ledger note the approval endpoint writes ("Leave #<id>
 * approved ..."), which is the only link between an application and its
 * ledger entry — there is no foreign key. Unpaid leave is excluded because it
 * deliberately deducts nothing.
 */
async function undeductedApprovals(schema) {
  return tq(schema, `
    SELECT e.emp_code, (e.first_name || ' ' || e.last_name) AS name,
           la.id, lt.code, la.days, la.from_date, la.to_date
    FROM {s}.leave_applications la
    JOIN {s}.employees e ON e.id = la.employee_id
    JOIN {s}.leave_types lt ON lt.id = la.leave_type_id
    WHERE la.status = 'Approved'
      AND NOT la.is_unpaid
      AND NOT EXISTS (
        SELECT 1 FROM {s}.leave_ledger l
        WHERE l.kind = 'leave_taken'
          AND l.employee_id = la.employee_id
          AND l.leave_type_id = la.leave_type_id
          AND l.note LIKE 'Leave #' || la.id || ' %')
    ORDER BY la.from_date DESC`, []);
}

/**
 * Both checks for one tenant. Never throws — this is diagnostic, and a
 * reconciliation that fails must not take down whatever it is reported beside.
 */
async function reconcileLeave(schema, options = {}) {
  try {
    // An explicit ?since= wins; otherwise start after the reviewed backlog.
    const baseline = options.since ? null : await reconciledThrough(schema);
    const since = options.since || (baseline ? nextDay(baseline) : null);

    const [unbacked, undeducted] = await Promise.all([
      unbackedAttendance(schema, { since }),
      undeductedApprovals(schema),
    ]);
    return {
      ok: true,
      since,
      reviewed_through: baseline,
      unbacked_attendance: unbacked,
      undeducted_approvals: undeducted,
      total: unbacked.length + undeducted.length,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  reconcileLeave, unbackedAttendance, undeductedApprovals, reconciledThrough,
  LEAVE_STATUSES, UNPAID_STATUSES,
};
