/*
 * The company's month cycle.
 *
 * A "month" here is a PAYROLL cycle, not a calendar month. Validure runs
 * 25th-to-24th: what everyone calls "August 2026" is 25 Jul – 24 Aug 2026,
 * named for the month it ENDS in. Attendance grids, summaries, exports,
 * dashboard counts, salary-slip periods and leave accrual all have to agree on
 * that, or the same person is present 21 days on one screen and 22 on another.
 *
 * ONE SETTING DRIVES EVERYTHING. `cycle_start_day` in {s}.settings is the only
 * number; the boundary it implies (the cycle ends the day before) is derived,
 * never stored twice. Leave accrual used to carry its own `accrual_day`, which
 * happened to be 24 — the same boundary expressed the other way round. Two
 * numbers that must agree but can be edited apart is a bug waiting to happen,
 * so `accrual_day` is now DERIVED from this and never read back — see
 * getCycleStartDay for why reading it was a mistake.
 *
 * Day 1 means "calendar months", and is handled as an exact calendar month
 * rather than "1st to the last day" arithmetic, so a company that never wanted
 * a payroll cycle behaves exactly as it did before.
 */
const { tqOne } = require('./db');

const DEFAULT_START_DAY = 25;

/*
 * Today, in UTC, as 'YYYY-MM-DD'.
 *
 * Every business date in this system is UTC — attendance rows, accrual's
 * today(), the device-sync day. The container's LOCAL clock is not UTC (the
 * service runs in Render's Singapore region), so `new Date().getMonth()` and
 * friends roll over to the next day hours before UTC does. Mixing the two is
 * what credited an extra month of leave on 2026-08-31: at 19:04 UTC the local
 * clock already said 1 September.
 *
 * Anything asking "what month is it" must come through here.
 */
const todayIso = () => new Date().toISOString().slice(0, 10);

/** The UTC year/month a caller should default to when none was given. */
function currentYearMonth() {
  const [year, month] = todayIso().split('-').map(Number);
  return { year, month };
}

/*
 * Any day of the month is allowed, 29th–31st included.
 *
 * Those days do not exist in every month, so the boundary CLAMPS to the last
 * day of the month it falls in: with a 31st start, the cycle boundary is
 * 31 Jan, 28 Feb (29th in a leap year), 31 Mar, 30 Apr, and so on.
 *
 * Clamping the boundary — rather than clamping each cycle's two ends
 * independently — is what keeps the months contiguous. Every cycle runs from
 * one boundary up to the day before the next, so consecutive cycles cannot
 * overlap or leave a gap no matter how the months vary in length. Clamping the
 * ends separately is the obvious approach and it is wrong: with a 31st start
 * it puts 28 Feb in both February's cycle and March's, and a day counted twice
 * is a day paid twice.
 */
const MIN_START_DAY = 1;
const MAX_START_DAY = 31;

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

/**
 * The day of `month` on which a cycle boundary falls — the configured start
 * day, or the last day of the month when that month is too short for it.
 */
function boundaryDay(year, month, startDay) {
  return Math.min(clampStartDay(startDay), daysInMonth(year, month));
}

function clampStartDay(value, fallback = DEFAULT_START_DAY) {
  const day = parseInt(value, 10);
  if (!Number.isFinite(day) || day < MIN_START_DAY || day > MAX_START_DAY) return fallback;
  return day;
}

/**
 * The configured start day for a tenant, defaulting to 25.
 *
 * There is deliberately NO fallback to the old `accrual_day`. That was tried
 * and it was wrong: accrual_day means "credit leave on this day", and Validure
 * had it set to 1. Reading it as a cycle END day produced a 2nd-to-1st cycle
 * on live data — every attendance page showed the wrong month and one extra
 * month of leave was credited to 14 people. An unset cycle means the default,
 * not a guess derived from an unrelated setting.
 *
 * Never throws: a settings read that fails must not take out an attendance
 * page.
 */
async function getCycleStartDay(schema) {
  try {
    const row = await tqOne(schema, `SELECT value FROM {s}.settings WHERE key='cycle_start_day'`);
    if (row && row.value !== null && row.value !== undefined) {
      return clampStartDay(row.value);
    }
    return DEFAULT_START_DAY;
  } catch {
    return DEFAULT_START_DAY;
  }
}

/**
 * The NOMINAL day a cycle ends on — the day before the configured start day.
 *
 * For display only. In a month too short for the start day the real end day is
 * earlier (a 31st start ends February on the 27th, because the next cycle
 * begins at the clamped boundary of the 28th). Use `cycleEndDate` for anything
 * that has to be correct in February.
 */
function endDayFor(startDay) {
  return clampStartDay(startDay) === 1 ? null : clampStartDay(startDay) - 1;
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * The date range for one labelled month, inclusive of both ends.
 *
 * `year`/`month` name the month the cycle ENDS in, which is the convention
 * everyone already uses when they say "the August payroll".
 *
 *   cycleRange(2026, 8, 25) -> { from: '2026-07-25', to: '2026-08-24' }
 *   cycleRange(2026, 1, 25) -> { from: '2025-12-25', to: '2026-01-24' }
 *   cycleRange(2026, 8, 1)  -> { from: '2026-08-01', to: '2026-08-31' }
 *
 * With a start day some month is too short for, both ends move to that month's
 * clamped boundary, which keeps consecutive cycles butted up against each
 * other:
 *
 *   cycleRange(2026, 2, 31) -> { from: '2026-01-31', to: '2026-02-27' }
 *   cycleRange(2026, 3, 31) -> { from: '2026-02-28', to: '2026-03-30' }
 */
function cycleRange(year, month, startDay) {
  const start = clampStartDay(startDay);

  if (start === 1) {
    return { from: iso(year, month, 1), to: iso(year, month, daysInMonth(year, month)) };
  }

  // The previous month, rolling the year back across January.
  const fromMonth = month === 1 ? 12 : month - 1;
  const fromYear = month === 1 ? year - 1 : year;

  /*
   * The cycle ends the day before THIS month's boundary, not on a fixed
   * `start - 1`. In a short month the boundary has moved earlier, and the end
   * has to move with it or the next cycle starts on a day this one already
   * claimed. Both boundaries are at least the 2nd (the start day is >= 2 and
   * every month has 28 days), so subtracting one never leaves the month.
   */
  return {
    from: iso(fromYear, fromMonth, boundaryDay(fromYear, fromMonth, start)),
    to: iso(year, month, boundaryDay(year, month, start) - 1),
  };
}

/** The date a cycle ends on, as 'YYYY-MM-DD'. Correct in short months. */
function cycleEndDate(year, month, startDay) {
  return cycleRange(year, month, startDay).to;
}

/** Every date in the cycle, as 'YYYY-MM-DD', in order. */
function cycleDates(year, month, startDay) {
  const { from, to } = cycleRange(year, month, startDay);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);

  const dates = [];
  // Local-time Date arithmetic on purpose: these are calendar days, not
  // instants, and UTC construction would shift them for anyone east of GMT.
  const cursor = new Date(fy, fm - 1, fd);
  const last = new Date(ty, tm - 1, td);
  while (cursor <= last) {
    dates.push(iso(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/**
 * Human label for the period, for payslips and export headers:
 *   '25 Jul – 24 Aug 2026', or 'August 2026' when the cycle is calendar months.
 */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function cycleLabel(year, month, startDay) {
  if (clampStartDay(startDay) === 1) return `${MONTHS_LONG[month - 1]} ${year}`;
  const { from, to } = cycleRange(year, month, startDay);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [, tm, td] = to.split('-').map(Number);
  // The start year is shown only when the cycle crosses a year boundary,
  // which is exactly the January case.
  const fromPart = fy === year
    ? `${fd} ${MONTHS_SHORT[fm - 1]}`
    : `${fd} ${MONTHS_SHORT[fm - 1]} ${fy}`;
  return `${fromPart} – ${td} ${MONTHS_SHORT[tm - 1]} ${year}`;
}

/**
 * Which labelled cycle a given date falls in.
 * A date on or after the start day belongs to the NEXT month's cycle.
 */
function cycleForDate(dateStr, startDay) {
  const start = clampStartDay(startDay);
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (start === 1) return { year: y, month: m };
  // Compared against THIS month's clamped boundary, the same one cycleRange
  // uses. Comparing against the raw start day would strand 28 Feb outside every
  // cycle when the start day is the 31st.
  if (d < boundaryDay(y, m, start)) return { year: y, month: m };
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

module.exports = {
  getCycleStartDay,
  todayIso,
  currentYearMonth,
  cycleRange,
  cycleEndDate,
  cycleDates,
  cycleLabel,
  cycleForDate,
  boundaryDay,
  endDayFor,
  clampStartDay,
  DEFAULT_START_DAY,
  MIN_START_DAY,
  MAX_START_DAY,
};
