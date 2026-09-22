/*
 * Monthly leave accrual.
 *
 * Policy (per client requirement): every employee starts at ZERO leaves.
 * HR grants leave either as manual credits (Leave Balances -> Adjust) or by
 * setting a monthly accrual rate per leave type (decimals allowed, e.g. 1.5).
 *
 * The engine is strictly PROSPECTIVE: every balance row carries a last_accrued
 * high-water mark (YYYY-MM) that advances every run even when the rate is 0 or
 * the employee is on probation. So:
 *   - setting a rate later never back-credits earlier months;
 *   - probation months are never credited afterwards (balance locked).
 * Every credit is written to the leave_ledger so calculations are traceable.
 *
 * ONE EXCEPTION, at employee creation only (routes/employees.js): a new record
 * whose DOJ is in the past receives an OPENING BALANCE covering the months
 * already worked, computed by calculateAccumulatedAccruals() below. Backdated
 * data entry is normal, and without it a hire entered a month late would silently
 * lose that month. It is a one-off credit written to the ledger as such, it is
 * suppressed for employees still on probation, and it never runs again — the
 * prospective rule above governs every subsequent month.
 *
 * Runs on server start, every 12 hours, and on demand from the Leave Balances
 * page — idempotent per month.
 */
const { q, tq } = require('./db');
const { getCycleStartDay, endDayFor, cycleEndDate, todayIso } = require('./cycle');

/*
 * UTC, like today() below and like every date stored in this system. This used
 * to read the LOCAL calendar (getFullYear/getMonth), and the container's clock
 * is not UTC — on 2026-08-31 at 19:04 UTC it already said 1 September, which
 * credited an extra month of leave to 14 people.
 */
const ym = (d = new Date()) => d.toISOString().slice(0, 7);
const today = () => todayIso();

/*
 * Leave credits on the day the month cycle ENDS, so a month is only credited
 * once it has actually been worked. That day is derived from the single
 * cycle_start_day setting rather than stored separately: this used to be its
 * own `accrual_day`, and two numbers that must agree but can be edited apart
 * is a bug waiting to happen. A 25th start means accrual on the 24th, which is
 * exactly what accrual_day already held.
 *
 * A calendar-month company (start day 1) has no "day before", so it keeps the
 * long-standing default of the 24th.
 */
async function getAccrualDay(schema) {
  const startDay = await getCycleStartDay(schema);
  return endDayFor(startDay) ?? 24;
}

/*
 * `cycleStartDay` is optional. When given, the credit lands on the day the
 * month's cycle actually ENDS, which in a month too short for the start day is
 * earlier than `accrualDay` — a 31st start ends February on the 27th, because
 * the next cycle begins at the clamped boundary of the 28th. Without it the
 * function keeps its original behaviour of clamping the accrual day to the end
 * of the month, which is what callers predating the cycle setting expect.
 */
function calculateAccumulatedAccruals(dojStr, todayStr, accrualDay, cycleStartDay = null) {
  if (!dojStr || !todayStr) return 0;
  const [dYear, dMonth, dDay] = dojStr.split('-').map(Number);
  const [tYear, tMonth, tDay] = todayStr.split('-').map(Number);

  const useCycle = Number.isFinite(cycleStartDay) && cycleStartDay > 1;

  let accruedMonths = 0;
  let year = dYear;
  let month = dMonth;

  while (year < tYear || (year === tYear && month <= tMonth)) {
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const actualAccrualDay = Math.min(accrualDay, lastDayOfMonth);
    const accrualDateStr = useCycle
      ? cycleEndDate(year, month, cycleStartDay)
      : `${year}-${String(month).padStart(2, '0')}-${String(actualAccrualDay).padStart(2, '0')}`;

    if (accrualDateStr >= dojStr && accrualDateStr <= todayStr) {
      accruedMonths++;
    }

    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return accruedMonths;
}

/**
 * The latest month whose cycle has finished — what accrual credits up to.
 *
 * Compared against the day the CURRENT month's cycle really ends, which in a
 * short month is earlier than the nominal accrual day (a 31st start ends
 * February on the 27th). Both the monthly run and employee creation need this
 * answer and must give the same one, or a new joiner's opening balance
 * disagrees with the next monthly run.
 *
 * The end day itself credits — reaching it completes the cycle.
 */
function completedCycleYm(startDay, when = new Date()) {
  /*
   * Everything below is derived from the UTC date string, never from Date's
   * local getters. The container's clock is ahead of UTC, so local getters
   * roll the month over early and credit a month that has not finished.
   */
  const iso = (when instanceof Date ? when : new Date(when)).toISOString().slice(0, 10);
  const [year, month, day] = iso.split('-').map(Number);

  const endDay = Number.isFinite(startDay) && startDay > 1
    ? Number(cycleEndDate(year, month, startDay).slice(8, 10))
    : Math.min(24, new Date(Date.UTC(year, month, 0)).getUTCDate());

  if (day >= endDay) return iso.slice(0, 7);

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

function monthsBetween(fromYm, toYm) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Credits pending months for every employee/type in one company. Returns rows credited. */
async function runAccrualForCompany(schema) {
  const serverToday = new Date();
  const startDay = await getCycleStartDay(schema);
  const targetYm = completedCycleYm(startDay, serverToday);

  const rows = await tq(schema,
    `SELECT b.id, b.employee_id, b.leave_type_id, b.last_accrued,
            lt.monthly_accrual, lt.code, e.probation_until
     FROM {s}.leave_balances b
     JOIN {s}.leave_types lt ON lt.id = b.leave_type_id
     JOIN {s}.employees e ON e.id = b.employee_id
     WHERE e.status='Active'`);
  let credited = 0;
  for (const r of rows) {
    const months = monthsBetween(r.last_accrued, targetYm);
    if (months <= 0) continue;

    // Balance locked during probation: the mark advances but nothing is credited,
    // so probation months are never paid out retroactively.
    const onProbation = r.probation_until && today() <= r.probation_until;
    const credit = onProbation ? 0 : +(months * r.monthly_accrual).toFixed(2);

    await tq(schema,
      `UPDATE {s}.leave_balances SET accrued = accrued + $1, last_accrued = $2 WHERE id = $3`,
      [credit, targetYm, r.id]);
    if (credit > 0) {
      await tq(schema,
        `INSERT INTO {s}.leave_ledger (employee_id, leave_type_id, delta, kind, note, actor)
         VALUES ($1,$2,$3,'accrual',$4,'system')`,
        [r.employee_id, r.leave_type_id, credit,
          `Monthly accrual ${r.code}: ${months} month(s) x ${r.monthly_accrual} (up to ${targetYm})`]);
      credited++;
    }
  }
  if (credited) {
    await tq(schema, `INSERT INTO {s}.audit_logs (actor, action, details) VALUES ('system','ACCRUAL_RUN',$1)`,
      [`Monthly accrual credited on ${credited} balance row(s) up to ${targetYm}`]);
  }
  return credited;
}

async function runAccrualAllCompanies() {
  const companies = await q(`SELECT schema_name FROM companies WHERE status='Active'`);
  for (const c of companies) {
    try {
      await runAccrualForCompany(c.schema_name);
    } catch (e) {
      console.error(`[accrual] ${c.schema_name} failed:`, e.message);
    }
  }
}

function startAccrualScheduler() {
  runAccrualAllCompanies().catch((e) => console.error('[accrual] initial run failed:', e.message));
  setInterval(() => runAccrualAllCompanies().catch(() => {}), 12 * 60 * 60 * 1000);
}

module.exports = {
  runAccrualForCompany,
  // Exported for routes/cron.js: on a host that sleeps, the in-process
  // scheduler never fires and accrual is driven over HTTP instead.
  runAccrualAllCompanies,
  startAccrualScheduler,
  ym,
  monthsBetween,
  getAccrualDay,
  calculateAccumulatedAccruals,
  completedCycleYm,
};
