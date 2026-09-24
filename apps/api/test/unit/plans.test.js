/*
 * Plan entitlements.
 *
 * A plan is a ceiling on what a company has bought, applied on top of what a
 * role is allowed to do. These tests exist because the three tiers on the
 * pricing page were decoration until this layer landed: every company's OWNER
 * holds every permission key, so nothing stopped a company paying for Basic
 * from running payroll.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  ALL_KEYS, PLAN_KEYS, DEFAULT_PLAN, PLAN_ENTITLEMENTS,
  planEntitlements, normalisePlan, SYSTEM_ROLES,
} = require('../../src/permissions');

test('payroll.manage exists and is separate from documents.manage', () => {
  // Basic sells payslips; Essential sells the cycle that produces them. One key
  // could not express that, which is what made the tiers unenforceable.
  assert.ok(ALL_KEYS.includes('payroll.manage'));
  assert.ok(ALL_KEYS.includes('documents.manage'));
});

test('every plan entitlement is a real permission key', () => {
  for (const plan of PLAN_KEYS) {
    for (const key of PLAN_ENTITLEMENTS[plan]) {
      assert.ok(ALL_KEYS.includes(key), `${plan} entitles an unknown key: ${key}`);
    }
  }
});

test('basic sells payslips but not the payroll cycle', () => {
  const basic = planEntitlements('basic');
  assert.ok(basic.has('documents.manage'), 'payslips are part of Basic');
  assert.ok(!basic.has('payroll.manage'), 'the cycle is not');
  assert.ok(!basic.has('reports.view'));
  assert.ok(!basic.has('analytics.view'));
});

test('essential adds the cycle and the reporting on top of it', () => {
  const essential = planEntitlements('essential');
  assert.ok(essential.has('payroll.manage'));
  assert.ok(essential.has('reports.view'));
  assert.ok(essential.has('analytics.view'));
});

test('advanced entitles every key in the catalogue', () => {
  const advanced = planEntitlements('advanced');
  for (const key of ALL_KEYS) assert.ok(advanced.has(key), `advanced is missing ${key}`);
});

test('the plans are ordered — each tier contains the one below it', () => {
  const basic = planEntitlements('basic');
  const essential = planEntitlements('essential');
  const advanced = planEntitlements('advanced');
  for (const k of basic) assert.ok(essential.has(k), `essential drops ${k}`);
  for (const k of essential) assert.ok(advanced.has(k), `advanced drops ${k}`);
});

test('an unknown or missing plan falls back to the default, never to nothing', () => {
  // Locking a paying customer out of their own company because a column held
  // an unexpected string is the worse failure of the two.
  for (const bad of [null, undefined, '', 'enterprise', 'BASIC ', 42, {}]) {
    const set = planEntitlements(bad);
    assert.ok(set.size > 0, `"${String(bad)}" produced an empty entitlement set`);
  }
  assert.deepEqual([...planEntitlements('nonsense')].sort(),
                   [...planEntitlements(DEFAULT_PLAN)].sort());
});

test('normalisePlan accepts the three tiers case-insensitively and rejects the rest', () => {
  assert.equal(normalisePlan('BASIC'), 'basic');
  assert.equal(normalisePlan('  Advanced '), 'advanced');
  assert.equal(normalisePlan('free'), null);
  assert.equal(normalisePlan(undefined), null);
});

test('the OWNER role still lists every key — the plan caps it, the role does not', () => {
  // If a downgrade rewrote roles instead, upgrading again would not restore
  // what the company had, and a hand-scoped role would be silently destroyed.
  for (const key of ALL_KEYS) {
    assert.ok(SYSTEM_ROLES.OWNER.includes(key), `OWNER role is missing ${key}`);
  }
  assert.ok(!planEntitlements('basic').has('payroll.manage'),
    'so an OWNER on Basic still cannot reach payroll');
});

test('HR can run payroll when the plan allows it', () => {
  assert.ok(SYSTEM_ROLES.HR.includes('payroll.manage'));
  assert.ok(!SYSTEM_ROLES.EMPLOYEE.includes('payroll.manage'));
});

/* ---------------------------------------------------------- overrides ---- */

const { parseOverrides, effectiveEntitlements } = require('../../src/permissions');

test('a granted key lifts a company above its plan without changing the plan', () => {
  // The point of the feature: give one Basic customer one Advanced capability
  // without moving them onto Advanced and billing them for it.
  const e = effectiveEntitlements('basic', '{"grant":["payroll.manage"]}');
  assert.ok(e.has('payroll.manage'));
  assert.ok(e.has('documents.manage'), 'and the rest of Basic is untouched');
});

test('a revoked key is withheld even when the plan includes it', () => {
  const e = effectiveEntitlements('advanced', '{"revoke":["analytics.view"]}');
  assert.ok(!e.has('analytics.view'));
  assert.ok(e.has('payroll.manage'));
});

test('revoke beats grant — a contradiction resolves to withheld', () => {
  const e = effectiveEntitlements('basic', '{"grant":["payroll.manage"],"revoke":["payroll.manage"]}');
  assert.ok(!e.has('payroll.manage'));
});

test('a malformed override means no override, never a crash and never a stray key', () => {
  const base = [...effectiveEntitlements('basic', null)].sort();
  for (const bad of ['not json', '[]', '{}', 'null', '', undefined, 42, '{"grant":"payroll.manage"}']) {
    assert.deepEqual([...effectiveEntitlements('basic', bad)].sort(), base, `"${String(bad)}" changed the result`);
  }
});

test('overrides cannot invent a permission key', () => {
  const e = effectiveEntitlements('basic', '{"grant":["wat.nope","payroll.manage"]}');
  assert.ok(!e.has('wat.nope'));
  assert.ok(e.has('payroll.manage'), 'the real key alongside it still applies');
});

test('parseOverrides always returns two arrays', () => {
  for (const raw of [null, 'x', '{"grant":null}', { revoke: ['analytics.view'] }]) {
    const o = parseOverrides(raw);
    assert.ok(Array.isArray(o.grant) && Array.isArray(o.revoke));
  }
  assert.deepEqual(parseOverrides({ revoke: ['analytics.view'] }).revoke, ['analytics.view']);
});

test('an override never grants a permission a role was not given', () => {
  // The entitlement set is a ceiling. The middleware intersects it with the
  // user's granted permissions, so this is the property that matters: an
  // EMPLOYEE at a company granted every key still holds nothing.
  const entitled = effectiveEntitlements('advanced', '{"grant":["payroll.manage"]}');
  const employeeGrants = new Set(SYSTEM_ROLES.EMPLOYEE);
  const effective = [...employeeGrants].filter((k) => entitled.has(k));
  assert.deepEqual(effective, [], 'an EMPLOYEE still has no permissions');
});
