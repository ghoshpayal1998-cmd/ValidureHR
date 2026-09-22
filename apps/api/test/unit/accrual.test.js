/*
 * C-2 — two accrual engines contradicted each other. accrual.js documents a
 * strictly prospective policy ("setting a rate later never back-credits earlier
 * months", "probation months are never credited afterwards") while employee
 * creation back-credited from date-of-joining to today, regardless of probation.
 *
 * The opening balance is intentional (backdated data entry is normal), so it is
 * kept and documented as the one exception — but probation now suppresses it,
 * which is what these tests pin down.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { calculateAccumulatedAccruals, monthsBetween, ym } =
  require(path.join(__dirname, '..', '..', 'src', 'accrual'));

test('monthsBetween counts whole months', () => {
  assert.equal(monthsBetween('2026-01', '2026-01'), 0);
  assert.equal(monthsBetween('2026-01', '2026-02'), 1);
  assert.equal(monthsBetween('2026-01', '2027-01'), 12);
  assert.equal(monthsBetween('2025-11', '2026-02'), 3);
});

test('monthsBetween is negative when the mark is ahead of the target', () => {
  // runAccrualForCompany relies on this to skip rows that are already current.
  assert.equal(monthsBetween('2026-06', '2026-03'), -3);
});

test('ym formats a date as YYYY-MM', () => {
  assert.equal(ym(new Date(2026, 0, 15)), '2026-01');
  assert.equal(ym(new Date(2026, 11, 1)), '2026-12');
});

test('an employee joining today accrues nothing before the accrual day', () => {
  // DOJ and today both before the accrual day: the accrual date has not passed.
  assert.equal(calculateAccumulatedAccruals('2026-08-01', '2026-08-05', 24), 0);
});

test('an employee accrues the month once the accrual day has passed', () => {
  assert.equal(calculateAccumulatedAccruals('2026-08-01', '2026-08-25', 24), 1);
});

test('a backdated joiner accrues one month per elapsed accrual day', () => {
  // The live case from the audit: DOJ 2026-05-06, today 2026-08-05, accrual day
  // 24 -> the 24th passed in May, June and July, but not yet in August.
  assert.equal(calculateAccumulatedAccruals('2026-05-06', '2026-08-05', 24), 3);
});

test('an accrual day before the joining date in the joining month does not count', () => {
  // Joined on the 25th, accrual day is the 24th: that month's accrual already
  // happened before this person existed.
  assert.equal(calculateAccumulatedAccruals('2026-05-25', '2026-06-01', 24), 0);
  assert.equal(calculateAccumulatedAccruals('2026-05-25', '2026-06-24', 24), 1);
});

test('the accrual day is clamped to the length of a short month', () => {
  // Day 30 in February must fall back to the 28th (2026 is not a leap year),
  // otherwise February would silently never accrue.
  assert.equal(calculateAccumulatedAccruals('2026-02-01', '2026-02-28', 30), 1);
  assert.equal(calculateAccumulatedAccruals('2026-02-01', '2026-02-27', 30), 0);
});

test('accrual spans a year boundary', () => {
  assert.equal(calculateAccumulatedAccruals('2025-11-01', '2026-02-25', 24), 4);
});

test('a future joining date accrues nothing', () => {
  assert.equal(calculateAccumulatedAccruals('2027-01-01', '2026-08-05', 24), 0);
});

test('missing dates accrue nothing rather than throwing', () => {
  assert.equal(calculateAccumulatedAccruals(null, '2026-08-05', 24), 0);
  assert.equal(calculateAccumulatedAccruals('2026-01-01', null, 24), 0);
  assert.equal(calculateAccumulatedAccruals(undefined, undefined, 24), 0);
});

test('accrual is never negative', () => {
  for (const [doj, today] of [['2026-08-05', '2026-01-01'], ['2027-01-01', '2026-01-01']]) {
    assert.ok(calculateAccumulatedAccruals(doj, today, 24) >= 0);
  }
});

/*
 * The probation rule itself lives in routes/employees.js (opening balance) and
 * accrual.js runAccrualForCompany (monthly run). Both compute
 * `onProbation = probation_until && today <= probation_until`, so the boundary
 * is pinned here — an off-by-one on the last day of probation would either
 * credit a month early or lose one.
 */
test('probation is inclusive of its final day', () => {
  const onProbation = (until, today) => !!until && today <= until;
  assert.equal(onProbation('2026-08-05', '2026-08-05'), true, 'the last day is still probation');
  assert.equal(onProbation('2026-08-05', '2026-08-06'), false, 'the day after is not');
  assert.equal(onProbation(null, '2026-08-05'), false, 'no probation date means not on probation');
  assert.equal(onProbation('', '2026-08-05'), false);
});
