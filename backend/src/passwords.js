/*
 * Temporary credential generation.
 *
 * Every new employee used to be created with the literal string 'Welcome@123',
 * and password resets wrote the same value — so anyone who knew the convention
 * could sign in as a colleague between the account being created and that
 * person's first login. Each account now gets its own random password, and the
 * account is flagged must_change_password so the temporary value only ever
 * survives one sign-in.
 */
const crypto = require('crypto');

// Unambiguous alphabet: no O/0, l/1/I — these get read off an email and typed
// on a phone, and a mistyped temporary password looks like an outage to the
// employee and a support call to HR.
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '@#$%&*!?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** Uniform random index — rejection sampling, so no modulo bias. */
function pick(alphabet) {
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  for (;;) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < limit) return alphabet[byte % alphabet.length];
  }
}

function shuffle(chars) {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

/**
 * A temporary password of `length` characters, guaranteed to contain at least
 * one character from each class so it satisfies any downstream policy check.
 */
function generateTempPassword(length = 14) {
  const min = 12;
  const n = Math.max(min, length);
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < n) chars.push(pick(ALL));
  return shuffle(chars).join('');
}

/*
 * Minimum policy for a password a human chose. Deliberately modest — length is
 * what matters, and a long list of composition rules pushes people towards
 * predictable substitutions.
 */
const MIN_PASSWORD_LENGTH = 8;

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) return 'Password is too long';
  const weak = new Set(['Welcome@123', 'Admin@123', 'password', 'Password1', '12345678', 'changeme']);
  if (weak.has(password)) return 'That password is too common — please choose another';
  return null;
}

module.exports = { generateTempPassword, validatePassword, MIN_PASSWORD_LENGTH };
