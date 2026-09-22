/*
 * S-4 — every employee used to be created with the literal 'Welcome@123', and
 * a password reset wrote the same value. These tests pin the properties that
 * make the replacement actually random rather than merely different.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { generateTempPassword, validatePassword, MIN_PASSWORD_LENGTH } =
  require(path.join(__dirname, '..', '..', 'src', 'passwords'));

test('generateTempPassword returns a password of at least the minimum length', () => {
  assert.ok(generateTempPassword().length >= 12);
  assert.equal(generateTempPassword(20).length, 20);
  // A caller asking for something too short still gets a safe length.
  assert.ok(generateTempPassword(4).length >= 12);
});

test('generateTempPassword includes every character class', () => {
  for (let i = 0; i < 200; i++) {
    const pw = generateTempPassword();
    assert.match(pw, /[a-z]/, `no lowercase in ${pw}`);
    assert.match(pw, /[A-Z]/, `no uppercase in ${pw}`);
    assert.match(pw, /[0-9]/, `no digit in ${pw}`);
    assert.match(pw, /[@#$%&*!?]/, `no symbol in ${pw}`);
  }
});

test('generateTempPassword avoids visually ambiguous characters', () => {
  // These get read off an email and typed on a phone; O/0 and l/1/I are where
  // a "wrong password" support call comes from.
  for (let i = 0; i < 200; i++) {
    assert.doesNotMatch(generateTempPassword(), /[O0lI1]/);
  }
});

test('generateTempPassword does not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(generateTempPassword());
  assert.equal(seen.size, 500, 'generated passwords must all be distinct');
});

test('generateTempPassword does not always place classes in the same positions', () => {
  // Guards against building the password as [lower][upper][digit][symbol]+rest
  // and forgetting to shuffle, which would make the first four characters
  // predictable by class.
  const firstCharClasses = new Set();
  for (let i = 0; i < 200; i++) {
    const c = generateTempPassword()[0];
    if (/[a-z]/.test(c)) firstCharClasses.add('lower');
    else if (/[A-Z]/.test(c)) firstCharClasses.add('upper');
    else if (/[0-9]/.test(c)) firstCharClasses.add('digit');
    else firstCharClasses.add('symbol');
  }
  assert.ok(firstCharClasses.size > 1, 'first character should not always be the same class');
});

test('validatePassword enforces a minimum length', () => {
  assert.match(validatePassword('short'), /at least 8 characters/);
  assert.equal(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH)), null);
  assert.match(validatePassword('a'.repeat(500)), /too long/);
  assert.match(validatePassword(undefined), /at least 8 characters/);
});

test('validatePassword rejects the old shared defaults', () => {
  assert.match(validatePassword('Welcome@123'), /too common/);
  assert.match(validatePassword('Admin@123'), /too common/);
  assert.match(validatePassword('password'), /too common/);
});
