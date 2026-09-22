/*
 * Two bugs that reached production on 2026-08-31, pinned so they cannot come
 * back. Both were invisible to every other test because both needed real
 * conditions the suite did not reproduce: a container clock that is not UTC,
 * and a tenant with the legacy `accrual_day` set.
 *
 * 1. TIMEZONE. Date arithmetic used the LOCAL calendar (getFullYear/getMonth/
 *    getDate). The service runs in Render's Singapore region and its clock is
 *    ahead of UTC, so at 19:04 UTC on 31 August the container already said
 *    1 September. Accrual credited a month that had not finished — 20.5 days
 *    across 14 people.
 *
 * 2. THE FALLBACK. getCycleStartDay used to read `accrual_day` and treat it as
 *    the day the cycle ENDS. accrual_day means "credit leave on this day", and
 *    Validure had it set to 1 — so the live cycle silently became 2nd-to-1st
 *    instead of 25th-to-24th, and every attendance page showed the wrong month.
 *
 * The timezone test runs in a CHILD PROCESS with TZ set, because Node reads TZ
 * once at startup. Asserting against a plain Date in this process would pass
 * whether or not the bug exists.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const { fakeDb } = require('../helpers/testEnv');
const { getCycleStartDay, DEFAULT_START_DAY } = require('../../src/cycle');

const BACKEND = path.join(__dirname, '..', '..');

/** Runs an expression in a child node process under the given TZ. */
function underTz(tz, expression) {
  return execFileSync(process.execPath, ['-e', `
    const { completedCycleYm } = require(${JSON.stringify(path.join(BACKEND, 'src', 'accrual.js'))});
    process.stdout.write(String(${expression}));
  `], {
    encoding: 'utf8',
    env: { ...process.env, TZ: tz, NODE_ENV: 'test' },
  }).trim();
}

// 19:04 UTC on 31 Aug 2026 — the exact instant the bad accrual ran. In
// Asia/Kolkata that is 00:34 on 1 September; in Asia/Singapore, 03:04.
const THE_INSTANT = '2026-08-31T19:04:12Z';

for (const tz of ['UTC', 'Asia/Kolkata', 'Asia/Singapore']) {
  test(`the completed cycle is the same under TZ=${tz}`, () => {
    const got = underTz(tz, `completedCycleYm(25, new Date(${JSON.stringify(THE_INSTANT)}))`);
    assert.equal(got, '2026-08',
      'August had not finished at 19:04 UTC on the 31st; only the local clock thought otherwise');
  });
}

test('a container ahead of UTC does not credit a month early', () => {
  // The specific regression: with the 2nd-to-1st cycle the fallback produced,
  // a local clock already in September returned 2026-09 and credited a month.
  const utc = underTz('UTC', `completedCycleYm(2, new Date(${JSON.stringify(THE_INSTANT)}))`);
  const ahead = underTz('Asia/Kolkata', `completedCycleYm(2, new Date(${JSON.stringify(THE_INSTANT)}))`);
  assert.equal(ahead, utc, 'the answer must not depend on the container timezone');
  assert.equal(utc, '2026-08');
});

test('the month rolls over on the UTC boundary, not the local one', () => {
  // 23:30 UTC on 24 Sep is already the 25th in Kolkata. The September cycle
  // ends on the 24th, so it HAS completed — both must agree it is 2026-09.
  const instant = '2026-09-24T23:30:00Z';
  const utc = underTz('UTC', `completedCycleYm(25, new Date(${JSON.stringify(instant)}))`);
  const ahead = underTz('Asia/Kolkata', `completedCycleYm(25, new Date(${JSON.stringify(instant)}))`);
  assert.equal(utc, '2026-09');
  assert.equal(ahead, utc);
});

test('a legacy accrual_day is NOT read as the cycle boundary', async () => {
  // Validure had accrual_day=1. Reading it as a cycle end day made the live
  // cycle 2nd-to-1st. An unset cycle means the default, not a guess derived
  // from a setting that means something else.
  fakeDb.reset();
  fakeDb.on(/settings WHERE key='cycle_start_day'/, []);
  fakeDb.on(/settings WHERE key='accrual_day'/, [{ value: '1' }]);

  assert.equal(await getCycleStartDay('c_vs'), DEFAULT_START_DAY);

  // And accrual_day must not even be queried — reading it at all invites
  // someone to re-add the fallback.
  const askedForAccrualDay = fakeDb.calls.some((c) => /accrual_day/.test(c.sql));
  assert.equal(askedForAccrualDay, false, 'getCycleStartDay should not consult accrual_day');
});

test('an explicitly configured cycle still wins', async () => {
  fakeDb.reset();
  fakeDb.on(/settings WHERE key='cycle_start_day'/, [{ value: '25' }]);
  assert.equal(await getCycleStartDay('c_vs'), 25);
});
