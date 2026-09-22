/*
 * S-7 — OWNER and DIRECTOR administer their own company and hold every
 * permission. The point of these tests is WHERE that comes from: the role's own
 * permission list, not a special case in the middleware. The old code
 * substituted ALL_KEYS for anyone named DIRECTOR, which made the stored list
 * dead code and hid the real access level from the Access Control screen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  ALL_KEYS, SYSTEM_ROLES, parsePerms, isCompanyAdminRole, COMPANY_ADMIN_ROLES, PERMISSIONS,
} = require(path.join(__dirname, '..', '..', 'src', 'permissions'));

test('DIRECTOR holds every permission through its own role list', () => {
  for (const key of ALL_KEYS) {
    assert.ok(SYSTEM_ROLES.DIRECTOR.includes(key), `DIRECTOR is missing ${key}`);
  }
});

test('OWNER holds every permission through its own role list', () => {
  for (const key of ALL_KEYS) {
    assert.ok(SYSTEM_ROLES.OWNER.includes(key), `OWNER is missing ${key}`);
  }
});

test('EMPLOYEE holds no permissions', () => {
  assert.deepEqual(SYSTEM_ROLES.EMPLOYEE, []);
});

test('HR holds the operational permissions but is not a company administrator', () => {
  assert.ok(SYSTEM_ROLES.HR.includes('employees.manage'));
  assert.ok(SYSTEM_ROLES.HR.includes('leaves.approve'));
  assert.ok(!isCompanyAdminRole('HR'));
});

test('every system role lists only real permission keys', () => {
  const valid = new Set(ALL_KEYS);
  for (const [role, perms] of Object.entries(SYSTEM_ROLES)) {
    for (const key of perms) {
      assert.ok(valid.has(key), `role ${role} lists unknown permission "${key}"`);
    }
  }
});

test('the permission catalogue has no duplicate keys', () => {
  const keys = PERMISSIONS.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('isCompanyAdminRole recognises OWNER and DIRECTOR, case-insensitively', () => {
  assert.ok(isCompanyAdminRole('OWNER'));
  assert.ok(isCompanyAdminRole('DIRECTOR'));
  assert.ok(isCompanyAdminRole('director'));
  assert.ok(!isCompanyAdminRole('HR'));
  assert.ok(!isCompanyAdminRole('EMPLOYEE'));
  assert.ok(!isCompanyAdminRole('MARKETING MANAGER'));
  assert.ok(!isCompanyAdminRole(null));
  assert.ok(!isCompanyAdminRole(undefined));
});

test('COMPANY_ADMIN_ROLES is exactly OWNER and DIRECTOR', () => {
  assert.deepEqual([...COMPANY_ADMIN_ROLES].sort(), ['DIRECTOR', 'OWNER']);
});

/* ---- parsePerms: roles.permissions is TEXT, so it can hold anything ---- */

test('parsePerms reads a normal JSON array', () => {
  assert.deepEqual(parsePerms('["employees.view","leaves.approve"]'), ['employees.view', 'leaves.approve']);
});

test('parsePerms returns no permissions for malformed or empty input', () => {
  // A parse failure must mean "no access", never a crash and never a default.
  assert.deepEqual(parsePerms('not json'), []);
  assert.deepEqual(parsePerms(''), []);
  assert.deepEqual(parsePerms(null), []);
  assert.deepEqual(parsePerms(undefined), []);
  assert.deepEqual(parsePerms('{"employees.view":true}'), []);
  assert.deepEqual(parsePerms('"employees.view"'), []);
});

test('parsePerms drops values that are not real permission keys', () => {
  // A hand-edited row must not be able to invent a permission.
  assert.deepEqual(parsePerms('["employees.view","made.up","*"]'), ['employees.view']);
  assert.deepEqual(parsePerms('["leaves.approve_final"]'), []);
});

test('parsePerms accepts an already-parsed array', () => {
  assert.deepEqual(parsePerms(['employees.view', 'nope']), ['employees.view']);
});
