/*
 * S-2 — login had no attempt counter and no lockout. bcrypt slowed each guess
 * but bounded nothing, and combined with S-4's shared default password the
 * admin account was reachable by grinding.
 *
 * These tests run the login route with a low limit so the behaviour is
 * observable, and assert both halves of the control: the per-account lockout
 * (durable, in the database) and the per-identifier rate limiter (in memory).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const path = require('path');

// Must be set before the rate-limit middleware is required.
process.env.LOGIN_RATE_MAX = '5';
process.env.LOGIN_MAX_ATTEMPTS = '3';
process.env.LOGIN_LOCKOUT_MINUTES = '15';

const { fakeDb } = require('../helpers/testEnv');
const { buildApp, COMPANY } = require('../helpers/testApp');
const { MAX_ATTEMPTS } = require(path.join(__dirname, '..', '..', 'src', 'loginAttempts'));

const PASSWORD = 'correct-horse-battery';
const HASH = bcrypt.hashSync(PASSWORD, 4); // low cost: these tests do many compares

/*
 * The rate limiter keeps its buckets in module-level memory for the lifetime of
 * the process, keyed on (identifier, ip). Every test therefore uses a fresh
 * identifier — otherwise the first test to exhaust the limit would 429 all the
 * ones after it, and the suite would be testing its own bookkeeping rather than
 * the product.
 */
let identifierCounter = 0;
const freshIdentifier = () => `admin-${process.pid}-${++identifierCounter}`;

/**
 * Wires up a single platform admin whose failed_attempts/locked_until live in a
 * mutable object, so the counter behaves the way the real UPDATE does.
 * The lookup matches any identifier, so callers pass a fresh one per test.
 */
function seedAdmin({ username = 'admin' } = {}) {
  const state = { failed_attempts: 0, locked_until: null };
  fakeDb.reset();
  fakeDb.on(/FROM admins WHERE LOWER\(username\)/, () => [{
    id: 1, username, email: 'admin@validuresolutions.com', password_hash: HASH, ...state,
  }]);
  fakeDb.on(/SELECT failed_attempts, locked_until FROM admins/, () => [{ ...state }]);
  fakeDb.on(/UPDATE admins SET failed_attempts/, (sql, params) => {
    state.failed_attempts = params[0];
    state.locked_until = params[1];
    return [];
  });
  return state;
}

function login(app, identifier, password) {
  return request(app).post('/api/auth/login').send({ identifier, password });
}

test('a wrong password is rejected with a generic message', async () => {
  const app = buildApp({ '/api/auth': 'auth' });
  seedAdmin();
  const res = await login(app, freshIdentifier(), 'wrong');
  assert.equal(res.status, 401);
  // Must not distinguish "no such user" from "wrong password", or the form
  // becomes an account-enumeration oracle.
  assert.equal(res.body.error, 'Invalid credentials');
});

test('an unknown account gives exactly the same response as a wrong password', async () => {
  const app = buildApp({ '/api/auth': 'auth' });
  fakeDb.reset();
  fakeDb.on(/FROM admins WHERE LOWER\(username\)/, []);
  fakeDb.on(/FROM user_directory WHERE LOWER\(email\)/, []);
  fakeDb.on(/FROM user_directory WHERE LOWER\(username\)/, []);
  const res = await login(app, 'no-such-person', 'whatever');
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Invalid credentials');
});

test('the account locks after the configured number of consecutive failures', async () => {
  const app = buildApp({ '/api/auth': 'auth' });
  const state = seedAdmin();
  const id = freshIdentifier();

  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    const res = await login(app, id, 'wrong');
    assert.equal(res.status, 401, `attempt ${i} should still be a plain rejection`);
  }

  const locking = await login(app, id, 'wrong');
  assert.equal(locking.status, 429, 'the attempt that hits the limit should lock');
  assert.match(locking.body.error, /locked for \d+ more minute/);
  assert.ok(state.locked_until, 'the lock must be persisted, not just in memory');
});

test('a locked account refuses even the CORRECT password', async () => {
  // The whole point: the lock has to short-circuit the password check, or an
  // attacker still gets an unbounded number of guesses.
  const app = buildApp({ '/api/auth': 'auth' });
  seedAdmin();
  const id = freshIdentifier();

  for (let i = 0; i < MAX_ATTEMPTS; i++) await login(app, id, 'wrong');

  const res = await login(app, id, PASSWORD);
  assert.equal(res.status, 429);
  assert.match(res.body.error, /locked for \d+ more minute/);
});

test('an expired lock lets the correct password through again', async () => {
  const app = buildApp({ '/api/auth': 'auth' });
  const state = seedAdmin();
  state.failed_attempts = MAX_ATTEMPTS;
  state.locked_until = new Date(Date.now() - 60_000).toISOString(); // expired a minute ago

  const res = await login(app, freshIdentifier(), PASSWORD);
  assert.equal(res.status, 200, 'a lapsed lock must not be permanent');
  assert.ok(res.body.token);
});

test('a successful login clears the failure counter', async () => {
  const app = buildApp({ '/api/auth': 'auth' });
  const state = seedAdmin();
  const id = freshIdentifier();

  await login(app, id, 'wrong');
  await login(app, id, 'wrong');
  assert.equal(state.failed_attempts, 2);

  const ok = await login(app, id, PASSWORD);
  assert.equal(ok.status, 200);
  assert.equal(state.failed_attempts, 0, 'the counter must reset so a typo does not accumulate forever');
  assert.equal(state.locked_until, null);
});

test('a correct login still succeeds and returns a token', async () => {
  const app = buildApp({ '/api/auth': 'auth' });
  seedAdmin();
  const res = await login(app, freshIdentifier(), PASSWORD);
  assert.equal(res.status, 200);
  assert.ok(res.body.token, 'expected a JWT');
  assert.equal(res.body.user.admin, true);
  assert.equal(res.body.user.role, 'ADMIN');
});

test('the login response never leaks the password hash', async () => {
  const app = buildApp({ '/api/auth': 'auth' });
  seedAdmin();
  const res = await login(app, freshIdentifier(), PASSWORD);
  const body = JSON.stringify(res.body);
  assert.doesNotMatch(body, /password_hash/);
  assert.doesNotMatch(body, /\$2[aby]\$/, 'no bcrypt hash may appear in the response');
});

test('login requires both an identifier and a password', async () => {
  const app = buildApp({ '/api/auth': 'auth' });
  fakeDb.reset();
  for (const body of [{}, { identifier: freshIdentifier() }, { password: 'x' }, { identifier: '', password: '' }]) {
    const res = await request(app).post('/api/auth/login').send(body);
    assert.equal(res.status, 400, `body ${JSON.stringify(body)} should be a 400`);
  }
});

test('an empty password does not bypass the check', async () => {
  const app = buildApp({ '/api/auth': 'auth' });
  seedAdmin();
  const res = await login(app, freshIdentifier(), '');
  assert.equal(res.status, 400);
});

test('the IP/identifier rate limiter caps repeated failures independently of the lockout', async () => {
  /*
   * The limiter is keyed on (identifier, ip) rather than ip alone: in
   * single-tunnel mode every request reaches the API from the Next.js proxy's
   * address, so an ip-only key would put the whole company in one bucket and
   * let one attacker lock everyone out.
   */
  const app = buildApp({ '/api/auth': 'auth' });
  fakeDb.reset();
  fakeDb.on(/FROM admins WHERE LOWER\(username\)/, []);
  fakeDb.on(/FROM user_directory WHERE LOWER\(email\)/, []);
  fakeDb.on(/FROM user_directory WHERE LOWER\(username\)/, []);

  const identifier = `victim-${Date.now()}@example.com`;
  let sawRateLimit = false;
  for (let i = 0; i < 12; i++) {
    const res = await login(app, identifier, 'wrong');
    if (res.status === 429) { sawRateLimit = true; break; }
  }
  assert.ok(sawRateLimit, 'repeated failures against one identifier must eventually be rate-limited');

  // A different identifier from the same client still gets through.
  const other = await login(app, `bystander-${Date.now()}@example.com`, 'wrong');
  assert.equal(other.status, 401, 'one attacked account must not lock out everyone else');
});
