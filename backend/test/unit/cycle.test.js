/*
 * The month cycle.
 *
 * Validure's payroll month runs 25th to 24th, named for the month it ends in, so
 * "August 2026" is 25 Jul - 24 Aug. Every screen that says "month" has to agree
 * on that. The arithmetic is small but the edges are the whole point: January
 * reaches back into the previous year, a start day the month is too short for
 * has to clamp WITHOUT letting two cycles claim the same day, and a company on
 * calendar months has to keep behaving exactly as before.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

require('../helpers/testEnv');
const {
  cycleRange, cycleDates, cycleLabel, cycleForDate, endDayFor, clampStartDay,
  boundaryDay, cycleEndDate, DEFAULT_START_DAY,
} = require('../../src/cycle');

const nextDay = (ds) => {
  const [y, m, d] = ds.split('-').map(Number);
  const t = new Date(y, m - 1, d + 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

test('a month is named for the month it ends in', () => {
  assert.deepEqual(cycleRange(2026, 8, 25), { from: '2026-07-25', to: '2026-08-24' });
});

test('January reaches back into the previous year', () => {
  assert.deepEqual(cycleRange(2026, 1, 25), { from: '2025-12-25', to: '2026-01-24' });
});

test('December does not roll the year forward', () => {
  assert.deepEqual(cycleRange(2026, 12, 25), { from: '2026-11-25', to: '2026-12-24' });
});

test('start day 1 means real calendar months, not 1st-to-31st arithmetic', () => {
  // A company that never wanted a payroll cycle must behave exactly as before,
  // including short months.
  assert.deepEqual(cycleRange(2026, 2, 1), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(cycleRange(2024, 2, 1), { from: '2024-02-01', to: '2024-02-29' }, 'leap year');
  assert.deepEqual(cycleRange(2026, 4, 1), { from: '2026-04-01', to: '2026-04-30' });
});

test('a cycle crossing February is still contiguous', () => {
  const dates = cycleDates(2026, 3, 25);
  assert.equal(dates[0], '2026-02-25');
  assert.equal(dates[dates.length - 1], '2026-03-24');
  // 4 days of February (25-28) + 24 of March
  assert.equal(dates.length, 28);
});

test('the day list has no gaps or repeats across a month boundary', () => {
  const dates = cycleDates(2026, 8, 25);
  assert.equal(dates[0], '2026-07-25');
  assert.equal(dates[dates.length - 1], '2026-08-24');
  assert.equal(new Set(dates).size, dates.length, 'no repeated days');
  assert.ok(dates.includes('2026-07-31') && dates.includes('2026-08-01'), 'no gap at the month change');
});

test('any day of the month is allowed, including the 29th to 31st', () => {
  assert.equal(clampStartDay(29), 29);
  assert.equal(clampStartDay(31), 31);
  assert.equal(clampStartDay(28), 28);
  // Genuinely impossible values still fall back rather than being honoured.
  assert.equal(clampStartDay(32), DEFAULT_START_DAY);
  assert.equal(clampStartDay(0), DEFAULT_START_DAY);
  assert.equal(clampStartDay('nonsense'), DEFAULT_START_DAY);
});

test('a boundary too late for the month falls back to that last day', () => {
  assert.equal(boundaryDay(2026, 2, 31), 28, 'February 2026 has 28 days');
  assert.equal(boundaryDay(2024, 2, 31), 29, 'February 2024 is a leap year');
  assert.equal(boundaryDay(2026, 4, 31), 30, 'April has 30');
  assert.equal(boundaryDay(2026, 3, 31), 31, 'March has all 31');
});

test('a 31st start clamps February without overlapping March', () => {
  // The bug this design exists to avoid: clamping each end independently puts
  // 28 Feb in BOTH cycles, and a day counted twice is a day paid twice.
  assert.deepEqual(cycleRange(2026, 2, 31), { from: '2026-01-31', to: '2026-02-27' });
  assert.deepEqual(cycleRange(2026, 3, 31), { from: '2026-02-28', to: '2026-03-30' });
  assert.equal(nextDay('2026-02-27'), '2026-02-28', 'March picks up the day after February ends');
});

test('consecutive cycles are contiguous for every start day, across leap years', () => {
  // The property that guarantees no day is ever double-counted or lost. Walks
  // every month of a leap year and the year around it, for the start days that
  // actually move.
  for (const startDay of [25, 28, 29, 30, 31]) {
    let prev = null;
    for (const year of [2024, 2025, 2026]) {
      for (let month = 1; month <= 12; month++) {
        const range = cycleRange(year, month, startDay);
        assert.ok(range.from <= range.to, `${year}-${month} start ${startDay}: range is inverted`);
        if (prev) {
          assert.equal(range.from, nextDay(prev),
            `start ${startDay}: ${year}-${month} must begin the day after the previous cycle ended`);
        }
        prev = range.to;
      }
    }
  }
});

test('every date still maps back to exactly one cycle when the boundary clamps', () => {
  for (const startDay of [29, 30, 31]) {
    for (const month of [1, 2, 3, 4, 12]) {
      for (const ds of cycleDates(2026, month, startDay)) {
        assert.deepEqual(cycleForDate(ds, startDay), { year: 2026, month },
          `start ${startDay}: ${ds} should belong to cycle 2026-${month}`);
      }
    }
  }
});

test('the accrual date follows the clamped boundary, not the nominal day', () => {
  // With a 31st start the nominal end day is the 30th, but February's cycle
  // ends on the 27th because the next one begins at the clamped 28th. Crediting
  // on the 28th would credit a day that belongs to March.
  assert.equal(cycleEndDate(2026, 2, 31), '2026-02-27');
  assert.equal(cycleEndDate(2024, 2, 31), '2024-02-28', 'leap year');
  assert.equal(cycleEndDate(2026, 4, 31), '2026-04-29', 'April has 30 days');
  assert.equal(cycleEndDate(2026, 3, 31), '2026-03-30');
  assert.equal(cycleEndDate(2026, 8, 25), '2026-08-24', 'the ordinary case is unchanged');
});

test('the accrual day is the day before the cycle starts', () => {
  // One number drives both; this is the derivation that replaced the separate
  // accrual_day setting, and 25 -> 24 is what that setting already held.
  assert.equal(endDayFor(25), 24);
  assert.equal(endDayFor(1), null, 'calendar months have no day-before');
});

test('a date is attributed to the cycle it belongs to', () => {
  // On or after the start day belongs to the NEXT month's cycle.
  assert.deepEqual(cycleForDate('2026-08-24', 25), { year: 2026, month: 8 });
  assert.deepEqual(cycleForDate('2026-08-25', 25), { year: 2026, month: 9 });
  assert.deepEqual(cycleForDate('2026-12-25', 25), { year: 2027, month: 1 }, 'rolls into next year');
  assert.deepEqual(cycleForDate('2026-08-15', 1), { year: 2026, month: 8 }, 'calendar months');
});

test('attribution and range agree with each other', () => {
  // The property that actually matters: every date in a cycle must attribute
  // back to that same cycle. If these two ever disagree, a day shows in one
  // month's grid and counts towards another's total.
  for (const month of [1, 2, 3, 8, 12]) {
    for (const ds of cycleDates(2026, month, 25)) {
      assert.deepEqual(cycleForDate(ds, 25), { year: 2026, month },
        `${ds} should belong to cycle 2026-${month}`);
    }
  }
});

test('the label spells out the dates, and names the year once', () => {
  assert.equal(cycleLabel(2026, 8, 25), '25 Jul – 24 Aug 2026');
  assert.equal(cycleLabel(2026, 1, 25), '25 Dec 2025 – 24 Jan 2026', 'year shown when the cycle crosses it');
  assert.equal(cycleLabel(2026, 8, 1), 'August 2026', 'calendar months read as before');
});
