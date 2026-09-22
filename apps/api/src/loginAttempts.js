/*
 * Per-account failed-login throttling.
 *
 * bcrypt makes each guess expensive but does not bound the total, so an
 * unattended account with a guessable password falls eventually. This adds a
 * counter per account: after MAX_ATTEMPTS consecutive failures the account is
 * locked for LOCKOUT_MINUTES, and the window doubles nothing — it simply
 * refuses to check the password at all until it expires.
 *
 * Why per-account rather than per-IP: in single-tunnel mode the API sits behind
 * the Next.js proxy, so every request arrives from the same container address.
 * An IP counter would either be useless (one bucket for everyone) or a denial
 * of service (one attacker locks out the whole company). The IP limiter in
 * middleware/rateLimit.js is a second, deliberately loose ceiling on top of
 * this one.
 *
 * `is_locked` remains the separate, manual, HR-controlled flag — this module
 * never touches it, so an automatic lockout expiring cannot silently re-enable
 * an account HR disabled on purpose.
 */
const { q, qOne, tq, tqOne } = require('./db');

const MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10);
const LOCKOUT_MINUTES = parseInt(process.env.LOGIN_LOCKOUT_MINUTES || '15', 10);

const nowIso = () => new Date().toISOString();
const lockUntilIso = () => new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();

/** Minutes remaining on an active lock, or 0 if the account is not locked. */
function lockRemainingMinutes(lockedUntil) {
  if (!lockedUntil) return 0;
  const ms = new Date(lockedUntil).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

/*
 * Platform admins live in the public `admins` table; tenant users live in each
 * company schema. Same logic, two storage locations — these two tiny adapters
 * keep the policy in one place.
 */
const adminStore = {
  read: (id) => qOne('SELECT failed_attempts, locked_until FROM admins WHERE id=$1', [id]),
  write: (id, attempts, lockedUntil) =>
    q('UPDATE admins SET failed_attempts=$1, locked_until=$2 WHERE id=$3', [attempts, lockedUntil, id]),
};

const tenantStore = (schema) => ({
  read: (id) => tqOne(schema, 'SELECT failed_attempts, locked_until FROM {s}.users WHERE id=$1', [id]),
  write: (id, attempts, lockedUntil) =>
    tq(schema, 'UPDATE {s}.users SET failed_attempts=$1, locked_until=$2 WHERE id=$3', [attempts, lockedUntil, id]),
});

/**
 * Returns { locked: true, minutes } when the account is inside an active
 * lockout window and the password must not be checked.
 */
async function checkLock(store, id) {
  const row = await store.read(id);
  const minutes = lockRemainingMinutes(row?.locked_until);
  return minutes > 0 ? { locked: true, minutes } : { locked: false, minutes: 0 };
}

/** Records a failed password check. Returns { locked, minutes, attempts }. */
async function recordFailure(store, id) {
  const row = await store.read(id);
  const attempts = (row?.failed_attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    const until = lockUntilIso();
    await store.write(id, attempts, until);
    return { locked: true, minutes: LOCKOUT_MINUTES, attempts };
  }
  await store.write(id, attempts, null);
  return { locked: false, minutes: 0, attempts };
}

/** Clears the counter after a successful login. */
async function recordSuccess(store, id) {
  const row = await store.read(id);
  if (!row || (row.failed_attempts === 0 && !row.locked_until)) return;
  await store.write(id, 0, null);
}

module.exports = {
  MAX_ATTEMPTS,
  LOCKOUT_MINUTES,
  adminStore,
  tenantStore,
  checkLock,
  recordFailure,
  recordSuccess,
  lockRemainingMinutes,
  nowIso,
};
