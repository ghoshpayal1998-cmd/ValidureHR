/*
 * Changing your own password now tells you it happened, so a change you did
 * not make is visible to you rather than only to an audit log nobody reads.
 *
 * The assertion that matters most here is the negative one: the notice must
 * never carry the password. HR reset mails do, because the employee has no
 * other way to learn a generated password — but someone who just typed their
 * own has no need of it, and mail is plaintext at rest in email_log.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { fakeDb, sentMail } = require('../helpers/testEnv');
const { buildApp, userToken, COMPANY } = require('../helpers/testApp');

const CURRENT = 'current-password-9931';
const NEW = 'a-brand-new-password-7742';

const USER = {
  id: 10,
  username: 'FTRN012',
  email: 'priya.sharma@validuresolutions.com',
  employee_id: 5,
  password_hash: bcrypt.hashSync(CURRENT, 4),
};

const app = buildApp({ routes: { '/api/auth': 'auth' } });

function wireDb({ userEmail = USER.email, employee = { first_name: 'Priya', email: 'priya.alt@validuresolutions.com' } } = {}) {
  fakeDb.reset();
  sentMail.length = 0;
  fakeDb.on(/FROM companies WHERE id/, COMPANY);
  fakeDb.on(/SELECT \* FROM c_vs\.users WHERE id/, { ...USER, email: userEmail });
  fakeDb.on(/SELECT first_name, email FROM c_vs\.employees/, employee ? [employee] : []);
  fakeDb.on(/UPDATE c_vs\.users SET password_hash/, []);
  fakeDb.on(/INSERT INTO c_vs\.audit_logs/, []);
}

const change = (body) =>
  request(app)
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${userToken({ id: USER.id, username: USER.username })}`)
    .send(body);

test('a successful change emails the account holder', async () => {
  wireDb();
  const res = await change({ currentPassword: CURRENT, newPassword: NEW });

  assert.equal(res.status, 200);
  assert.equal(sentMail.length, 1, 'expected exactly one notification');
  const mail = sentMail[0];
  assert.equal(mail.schema, COMPANY.schema_name);
  assert.equal(mail.to, USER.email);
  assert.match(mail.subject, /password was changed/i);
  assert.match(mail.subject, new RegExp(COMPANY.name));
});

test('the notification never carries the password', async () => {
  wireDb();
  await change({ currentPassword: CURRENT, newPassword: NEW });

  const { subject, body } = sentMail[0];
  for (const secret of [NEW, CURRENT, USER.password_hash]) {
    assert.ok(!body.includes(secret), 'password or hash leaked into the mail body');
    assert.ok(!subject.includes(secret), 'password or hash leaked into the subject');
  }
});

test('it says when the change happened and who to tell', async () => {
  wireDb();
  await change({ currentPassword: CURRENT, newPassword: NEW });

  const { body } = sentMail[0];
  assert.match(body, /IST/, 'the reader needs a time they can recognise');
  assert.match(body, /HR/, 'the reader needs to know who to report it to');
  assert.match(body, new RegExp(USER.username), 'the mail should name the account');
});

test('a wrong current password changes nothing and emails nobody', async () => {
  wireDb();
  const res = await change({ currentPassword: 'not-the-password', newPassword: NEW });

  assert.equal(res.status, 400);
  assert.equal(sentMail.length, 0);
  assert.equal(
    fakeDb.calls.filter((c) => /UPDATE c_vs\.users SET password_hash/.test(c.sql)).length,
    0,
    'the password must not have been written',
  );
});

test('a user with no email on record still gets their password changed', async () => {
  // The notice is a courtesy; failing the change because we cannot send it
  // would lock someone out of rotating their own credential.
  wireDb({ userEmail: null, employee: null });
  const res = await change({ currentPassword: CURRENT, newPassword: NEW });

  assert.equal(res.status, 200);
  assert.equal(sentMail.length, 0);
});

test('it falls back to the employee record when the user row has no email', async () => {
  wireDb({ userEmail: null });
  await change({ currentPassword: CURRENT, newPassword: NEW });

  assert.equal(sentMail.length, 1);
  assert.equal(sentMail[0].to, 'priya.alt@validuresolutions.com');
});
