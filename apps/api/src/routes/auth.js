const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { q, qOne, tq, tqOne } = require('../db');
const { ALL_KEYS, parsePerms } = require('../permissions');
const { authenticate, JWT_SECRET } = require('../middleware/auth');
const { loginLimiter, changePasswordLimiter } = require('../middleware/rateLimit');
const { validatePassword } = require('../passwords');
const { sendMail } = require('../mailer');
const {
  adminStore, tenantStore, checkLock, recordFailure, recordSuccess, MAX_ATTEMPTS,
} = require('../loginAttempts');

const router = express.Router();

// A wrong password, an unknown account and a locked account must be
// indistinguishable to an unauthenticated caller, otherwise the login form
// becomes an account-enumeration oracle.
const INVALID_CREDENTIALS = 'Invalid credentials';

const lockedMessage = (minutes) =>
  `Too many failed sign-in attempts. This account is locked for ${minutes} more minute(s).`;

async function tenantUserPayload(company, user) {
  const employee = user.employee_id
    ? await tqOne(company.schema_name,
        'SELECT emp_code, first_name, last_name, email FROM {s}.employees WHERE id=$1', [user.employee_id])
    : null;
  const role = user.role_id
    ? await tqOne(company.schema_name, 'SELECT name, permissions FROM {s}.roles WHERE id=$1', [user.role_id])
    : null;
  const grants = await tq(company.schema_name,
    'SELECT permission FROM {s}.user_permissions WHERE user_id=$1', [user.id]);
  
  // No role bypasses its own permission list — see permissions.js. This must
  // stay in step with middleware/auth.js `tenant`, or the menu the client
  // renders will disagree with what the API actually allows.
  const permissions = [...new Set([...parsePerms(role?.permissions), ...grants.map((g) => g.permission)])];

  return {
    admin: false,
    id: user.id,
    username: user.username,
    email: user.email,
    role: role?.name || 'EMPLOYEE',
    permissions,
    employee,
    must_change_password: !!user.must_change_password,
    company: { id: company.id, name: company.name, slug: company.slug },
  };
}

/*
 * POST /api/auth/login { identifier, password }
 * ONE login for everyone — platform admins, HR, directors, employees, custom roles.
 * The database decides who you are: platform admins are matched first, then the
 * user directory routes the identifier (email or username) to its company.
 */
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ error: 'Identifier and password are required' });

    // 1) platform admin?
    const admin = await qOne(
      `SELECT * FROM admins WHERE LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($1)`, [identifier]);
    if (admin) {
      const lock = await checkLock(adminStore, admin.id);
      if (lock.locked) return res.status(429).json({ error: lockedMessage(lock.minutes) });

      if (!bcrypt.compareSync(password, admin.password_hash)) {
        const result = await recordFailure(adminStore, admin.id);
        if (result.locked) return res.status(429).json({ error: lockedMessage(result.minutes) });
        return res.status(401).json({ error: INVALID_CREDENTIALS });
      }
      await recordSuccess(adminStore, admin.id);
      const token = jwt.sign({ adm: true, id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '8h' });
      return res.json({
        token,
        user: { admin: true, username: admin.username, email: admin.email, role: 'ADMIN', permissions: ALL_KEYS },
      });
    }

    // 2) tenant user via the directory (email is globally unique; username must be unambiguous)
    let entry = await qOne(`SELECT * FROM user_directory WHERE LOWER(email)=LOWER($1)`, [identifier]);
    if (!entry) {
      const matches = await q(`SELECT * FROM user_directory WHERE LOWER(username)=LOWER($1)`, [identifier]);
      if (matches.length > 1) {
        return res.status(400).json({ error: 'This ID exists in more than one company — please log in with your email address' });
      }
      entry = matches[0];
    }
    if (!entry) return res.status(401).json({ error: INVALID_CREDENTIALS });

    const company = await qOne('SELECT * FROM companies WHERE id=$1', [entry.company_id]);
    if (!company) return res.status(401).json({ error: INVALID_CREDENTIALS });
    if (company.status !== 'Active') return res.status(403).json({ error: 'Your company account is suspended. Contact the administrator.' });

    const store = tenantStore(company.schema_name);
    const lock = await checkLock(store, entry.tenant_user_id);
    if (lock.locked) return res.status(429).json({ error: lockedMessage(lock.minutes) });

    const user = await tqOne(company.schema_name, 'SELECT * FROM {s}.users WHERE id=$1', [entry.tenant_user_id]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      if (user) {
        const result = await recordFailure(store, user.id);
        if (result.locked) return res.status(429).json({ error: lockedMessage(result.minutes) });
      }
      return res.status(401).json({ error: INVALID_CREDENTIALS });
    }
    await recordSuccess(store, user.id);
    if (!user.is_active) return res.status(403).json({ error: 'This account has been disabled. Contact HR.' });
    if (user.is_locked) return res.status(403).json({ error: 'This account is locked. Contact HR.' });

    const payload = await tenantUserPayload(company, user);
    const token = jwt.sign(
      {
        id: user.id, username: user.username, companyId: company.id,
        slug: company.slug, employeeId: user.employee_id, role: payload.role,
      },
      JWT_SECRET, { expiresIn: '8h' }
    );
    tq(company.schema_name,
      `INSERT INTO {s}.audit_logs (user_id, actor, action, details) VALUES ($1,$2,'LOGIN',$3)`,
      [user.id, user.username, `${payload.role} login (${user.username})`]).catch(() => {});
    res.json({ token, user: payload });
  } catch (e) { next(e); }
});

// GET /api/auth/me — fresh profile + permissions (menu updates without re-login)
router.get('/me', authenticate, async (req, res, next) => {
  try {
    if (req.user.adm) {
      const admin = await qOne('SELECT id, username, email FROM admins WHERE id=$1', [req.user.id]);
      if (!admin) return res.status(404).json({ error: 'User not found' });
      return res.json({ admin: true, username: admin.username, email: admin.email, role: 'ADMIN', permissions: ALL_KEYS });
    }
    const company = await qOne('SELECT * FROM companies WHERE id=$1', [req.user.companyId]);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    const user = await tqOne(company.schema_name, 'SELECT * FROM {s}.users WHERE id=$1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(await tenantUserPayload(company, user));
  } catch (e) { next(e); }
});

// POST /api/auth/change-password { currentPassword, newPassword }
router.post('/change-password', authenticate, changePasswordLimiter, async (req, res, next) => {
  try {
    // The mobile client historically sent snake_case; accept both so an older
    // installed APK keeps working after this deploy.
    const body = req.body || {};
    const currentPassword = body.currentPassword ?? body.current_password;
    const newPassword = body.newPassword ?? body.new_password;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both current and new password are required' });
    const invalid = validatePassword(newPassword);
    if (invalid) return res.status(400).json({ error: invalid });
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'The new password must be different from the current one' });
    }

    if (req.user.adm) {
      const admin = await qOne('SELECT * FROM admins WHERE id=$1', [req.user.id]);
      if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      await q('UPDATE admins SET password_hash=$1 WHERE id=$2', [bcrypt.hashSync(newPassword, 10), admin.id]);
      return res.json({ message: 'Password changed successfully' });
    }

    const company = await qOne('SELECT * FROM companies WHERE id=$1', [req.user.companyId]);
    const user = await tqOne(company.schema_name, 'SELECT * FROM {s}.users WHERE id=$1', [req.user.id]);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    // Clearing must_change_password here is what ends the temporary-credential
    // window opened by employee creation / HR reset.
    await tq(company.schema_name,
      'UPDATE {s}.users SET password_hash=$1, must_change_password=FALSE WHERE id=$2',
      [bcrypt.hashSync(newPassword, 10), user.id]);
    tq(company.schema_name,
      `INSERT INTO {s}.audit_logs (user_id, actor, action, details) VALUES ($1,$2,'PASSWORD_CHANGED','User changed own password')`,
      [user.id, user.username]).catch(() => {});

    /*
     * Tell the account holder their password changed. Fire-and-forget, not
     * sendMailNow: the change has already happened and the mail carries no
     * credential, so a mail problem must never make a successful change look
     * like a failure. Its only job is to make a change the user did NOT make
     * get noticed — which is why it names the time and says who to tell.
     *
     * Never put the new password in here. HR reset mails carry one because the
     * employee has no other way to learn it; someone who just typed their own
     * password does not need it read back to them over plaintext mail.
     *
     * Platform admins get no such mail: sendMail records every send in a
     * tenant's email_log, and an admin belongs to no tenant.
     */
    const emp = user.employee_id
      ? await tqOne(company.schema_name, 'SELECT first_name, email FROM {s}.employees WHERE id=$1', [user.employee_id])
        .catch(() => null)
      : null;
    const notifyAddress = user.email || emp?.email;
    if (notifyAddress) {
      const when = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
      });
      sendMail(company.schema_name, notifyAddress,
        `Your ${company.name} HR portal password was changed`,
        `Hi ${emp?.first_name || user.username},\n\n`
        + `The password for your ${company.name} HR portal account (${user.username}) was just changed.\n\n`
        + `  When : ${when} IST\n\n`
        + `If that was you, there is nothing to do.\n\n`
        + `If it was NOT you, someone else may have access to your account. Tell HR straight away so it can be locked and reset.\n\n`
        + `Regards,\nHR Team, ${company.name}`);
    }

    res.json({ message: 'Password changed successfully' });
  } catch (e) { next(e); }
});

module.exports = router;
