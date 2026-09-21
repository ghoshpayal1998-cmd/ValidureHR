/*
 * S-1 — the API must refuse to run on a signing key anybody can look up.
 * The original bug was a fallback chain that made an unconfigured deployment
 * indistinguishable from a configured one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { requireJwtSecret, requireAdminPassword, PUBLISHED_SECRETS, MIN_SECRET_LENGTH } =
  require(path.join(__dirname, '..', '..', 'src', 'config'));

test('requireJwtSecret rejects a missing secret', () => {
  assert.throws(() => requireJwtSecret({}), /JWT_SECRET is not set/);
  assert.throws(() => requireJwtSecret({ JWT_SECRET: '' }), /JWT_SECRET is not set/);
});

test('requireJwtSecret rejects a secret shorter than the minimum', () => {
  assert.throws(
    () => requireJwtSecret({ JWT_SECRET: 'a'.repeat(MIN_SECRET_LENGTH - 1) }),
    /at least 32 characters/,
  );
});

test('requireJwtSecret rejects every secret published in the repo', () => {
  // These are long enough to pass a length check, which is exactly why they
  // have to be rejected by value.
  for (const published of PUBLISHED_SECRETS) {
    assert.throws(
      () => requireJwtSecret({ JWT_SECRET: published }),
      /published in this repository/,
      `expected "${published}" to be rejected`,
    );
  }
});

test('requireJwtSecret rejects the exact value the live container was running', () => {
  assert.throws(
    () => requireJwtSecret({ JWT_SECRET: 'validurehr-change-this-secret-to-a-long-random-string' }),
    /published in this repository/,
  );
});

test('requireJwtSecret rejects the old hardcoded middleware fallback', () => {
  assert.throws(
    () => requireJwtSecret({ JWT_SECRET: 'validurehr-dev-secret-change-in-production' }),
    /published in this repository/,
  );
});

test('requireJwtSecret accepts a long random secret', () => {
  const secret = require('crypto').randomBytes(48).toString('base64url');
  assert.equal(requireJwtSecret({ JWT_SECRET: secret }), secret);
});

test('requireAdminPassword rejects the documented default', () => {
  assert.throws(() => requireAdminPassword({ ADMIN_PASSWORD: 'Admin@123' }), /documented default/);
  assert.throws(() => requireAdminPassword({ ADMIN_PASSWORD: 'Welcome@123' }), /documented default/);
});

test('requireAdminPassword requires a length and a value', () => {
  assert.throws(() => requireAdminPassword({}), /not set/);
  assert.throws(() => requireAdminPassword({ ADMIN_PASSWORD: 'short' }), /at least 12 characters/);
  assert.equal(requireAdminPassword({ ADMIN_PASSWORD: 'a-perfectly-fine-password' }), 'a-perfectly-fine-password');
});
