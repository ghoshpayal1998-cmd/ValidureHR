const express = require('express');
const bcrypt = require('bcryptjs');
const { q, qOne, tq, tqOne } = require('../db');
const audit = require('../audit');
const { sendMail, sendMailNow } = require('../mailer');
const { generateWelcomeEmail } = require('../emailTemplate');
const path = require('path');
const { ym, getAccrualDay, calculateAccumulatedAccruals, completedCycleYm } = require('../accrual');
const { getCycleStartDay, endDayFor } = require('../cycle');
const { uploader, filePath, sendUserFile } = require('../storage');
const photoUpload = uploader('photos');
const { authenticate, tenant, requirePerm } = require('../middleware/auth');
const { generateTempPassword, validatePassword } = require('../passwords');

const router = express.Router();
router.use(authenticate, tenant);

const LIST_SQL = `
  SELECT e.*, d.name AS department, g.title AS designation,
         (m.first_name || ' ' || m.last_name) AS reporting_manager,
         u.id AS user_id, u.is_active, u.is_locked, r.name AS role, u.role_id, e.photo_file
  FROM {s}.employees e
  LEFT JOIN {s}.departments d ON d.id = e.department_id
  LEFT JOIN {s}.designations g ON g.id = e.designation_id
  LEFT JOIN {s}.employees m ON m.id = e.reporting_manager_id
  LEFT JOIN {s}.users u ON u.employee_id = e.id
  LEFT JOIN {s}.roles r ON r.id = u.role_id`;

/*
 * Route params reach the query as-is, and Postgres raises a 500 on a
 * non-numeric value for an integer column. Anything unparseable is a client
 * mistake, so it gets a 400 here instead.
 */
function numericId(raw) {
  if (!/^\d+$/.test(String(raw))) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function ageOn(dateStr, dob) {
  const d = new Date(dateStr), b = new Date(dob);
  let age = d.getFullYear() - b.getFullYear();
  const m = d.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) age--;
  return age;
}

// GET /api/employees/meta — dropdown data for the employee form
router.get('/meta', requirePerm('employees.view'), async (req, res, next) => {
  try {
    const roles = await tq(req.s, 'SELECT id, name, is_system FROM {s}.roles ORDER BY is_system DESC, name');
    res.json({
      departments: await tq(req.s, 'SELECT * FROM {s}.departments ORDER BY name'),
      designations: await tq(req.s, 'SELECT * FROM {s}.designations ORDER BY title'),
      managers: await tq(req.s, `SELECT id, emp_code, (first_name || ' ' || last_name) AS name FROM {s}.employees WHERE status='Active' ORDER BY emp_code`),
      roles,
    });
  } catch (e) { next(e); }
});

// GET /api/employees?q=search
router.get('/', requirePerm('employees.view'), async (req, res, next) => {
  try {
    const search = (req.query.q || '').trim();
    let sql = LIST_SQL;
    const args = [];
    if (search) {
      sql += ` WHERE e.emp_code ILIKE $1 OR e.first_name ILIKE $1 OR e.last_name ILIKE $1 OR e.email ILIKE $1 OR d.name ILIKE $1`;
      args.push(`%${search}%`);
    }
    sql += ' ORDER BY e.emp_code';
    res.json(await tq(req.s, sql, args));
  } catch (e) { next(e); }
});

/*
 * GET /api/employees/me — the caller's own record.
 * Declared before '/:id' so "me" is never parsed as an id, and it needs no
 * employees.view permission: everyone may read their own profile.
 */
router.get('/me', async (req, res, next) => {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee profile linked to this account' });
    const row = await tqOne(req.s, LIST_SQL + ' WHERE e.id=$1', [empId]);
    if (!row) return res.status(404).json({ error: 'Employee not found' });
    res.json(row);
  } catch (e) { next(e); }
});

// GET /api/employees/:id
router.get('/:id', requirePerm('employees.view'), async (req, res, next) => {
  try {
    const id = numericId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Employee id must be a number' });
    const row = await tqOne(req.s, LIST_SQL + ' WHERE e.id=$1', [id]);
    if (!row) return res.status(404).json({ error: 'Employee not found' });
    res.json(row);
  } catch (e) { next(e); }
});

// POST /api/employees — add employee + login account + directory entry + welcome email
router.post('/', requirePerm('employees.manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const required = ['emp_code', 'first_name', 'last_name', 'email', 'doj', 'dob'];
    for (const f of required) if (!b[f]) return res.status(400).json({ error: `${f} is required` });

    // Birthday validation: nobody below 18 years of age (as of today)
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dob) || isNaN(new Date(b.dob))) {
      return res.status(400).json({ error: 'Invalid date of birth' });
    }
    if (ageOn(today, b.dob) < 18) {
      return res.status(400).json({ error: 'Employee must be at least 18 years old' });
    }
    if (b.probation_until && !/^\d{4}-\d{2}-\d{2}$/.test(b.probation_until)) {
      return res.status(400).json({ error: 'Invalid probation end date' });
    }

    const dupLocal = await tqOne(req.s, 'SELECT id FROM {s}.employees WHERE emp_code=$1 OR email=$2', [b.emp_code, b.email]);
    if (dupLocal) return res.status(409).json({ error: 'Employee code or email already exists in this company' });
    const dupGlobal = await qOne('SELECT id FROM user_directory WHERE LOWER(email)=LOWER($1)', [b.email]);
    if (dupGlobal) return res.status(409).json({ error: 'That email is already registered on the platform' });

    // role assignment at creation (defaults to the EMPLOYEE system role)
    let role = b.role_id
      ? await tqOne(req.s, 'SELECT * FROM {s}.roles WHERE id=$1', [b.role_id])
      : await tqOne(req.s, `SELECT * FROM {s}.roles WHERE name='EMPLOYEE'`);
    if (!role) return res.status(400).json({ error: 'Invalid role' });

    const emp = await tqOne(req.s,
      `INSERT INTO {s}.employees
        (emp_code, first_name, last_name, phone, emergency_contact, email, doj, dob, department_id, designation_id, reporting_manager_id, status, probation_until, pan_no, bank_name, bank_account_no, bank_ifsc)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Active',$12,$13,$14,$15,$16) RETURNING id`,
      [b.emp_code, b.first_name, b.last_name, b.phone || null, b.emergency_contact || null, b.email, b.doj, b.dob,
        b.department_id || null, b.designation_id || null, b.reporting_manager_id || null,
        b.probation_until || null, b.pan_no || null, b.bank_name || null, b.bank_account_no || null, b.bank_ifsc || null]);

    /*
     * A random password per employee, not a shared convention. must_change_password
     * makes the emailed value single-use: the account cannot do anything else
     * until it is replaced, so a credential sitting in an inbox stops being a
     * standing key to the employee's PAN and bank details.
     */
    if (b.password) {
      const invalid = validatePassword(b.password);
      if (invalid) return res.status(400).json({ error: invalid });
    }
    const password = b.password || generateTempPassword();
    const user = await tqOne(req.s,
      `INSERT INTO {s}.users (username, email, password_hash, role_id, employee_id, must_change_password)
       VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id`,
      [b.emp_code, b.email, bcrypt.hashSync(password, 10), role.id, emp.id]);

    await q(`INSERT INTO user_directory (email, username, company_id, tenant_user_id) VALUES ($1,$2,$3,$4)`,
      [b.email, b.emp_code, req.company.id, user.id]);

    /*
     * OPENING BALANCE — the one deliberate exception to the prospective accrual
     * engine (see the header of accrual.js). Backdating a hire is routine: the
     * employee joined on DOJ and the record is entered afterwards, so the months
     * already worked are credited once, here, at creation.
     *
     * Probation suppresses it, exactly as it suppresses the monthly run: an
     * employee still on probation starts at zero and their balance stays locked
     * until probation ends. Without this the two engines disagree — the monthly
     * run credits nothing during probation while creation credited everything.
     */
    const leaveTypes = await tq(req.s, `SELECT id, code, monthly_accrual FROM {s}.leave_types`);
    // Derived locally rather than via getAccrualDay, which would re-read the
    // same setting: one number drives both.
    const cycleStartDay = await getCycleStartDay(req.s);
    const accrualDay = endDayFor(cycleStartDay) ?? 24;
    const todayStr = new Date().toISOString().slice(0, 10);
    const onProbation = !!b.probation_until && todayStr <= b.probation_until;
    const monthsAccrued = onProbation
      ? 0
      : calculateAccumulatedAccruals(b.doj, todayStr, accrualDay, cycleStartDay);

    /*
     * The same high-water mark the monthly run would set. Shared with
     * runAccrualForCompany rather than recomputed here: when these two
     * disagreed, a joiner created just before the cycle end got an opening
     * balance the next run then credited again.
     */
    const lastAccruedYm = completedCycleYm(cycleStartDay, new Date());

    for (const lt of leaveTypes) {
      const credit = +(monthsAccrued * lt.monthly_accrual).toFixed(2);
      await tq(req.s,
        `INSERT INTO {s}.leave_balances (employee_id, leave_type_id, accrued, used, last_accrued)
         VALUES ($1, $2, $3, 0, $4)`,
        [emp.id, lt.id, credit, lastAccruedYm]);

      if (credit > 0) {
        await tq(req.s,
          `INSERT INTO {s}.leave_ledger (employee_id, leave_type_id, delta, kind, note, actor)
           VALUES ($1, $2, $3, 'accrual', $4, 'system')`,
          [emp.id, lt.id, credit, `Opening accrued leaves from DOJ (${b.doj}) to today: ${monthsAccrued} month(s) x ${lt.monthly_accrual} (code ${lt.code})`]);
      }
    }

    // requirement: the new employee is intimated by email with username & password
    const loginUrl = process.env.FRONTEND_URL || 'https://app.validurehr.example/';
    const plainTextBody = `Hi ${b.first_name},\n\nAn account has been created for you on the ${req.company.name} HR portal.\n\nUsername : ${b.emp_code}\nEmail : ${b.email}\nPassword : ${password}\n\nPlease log in and change your password immediately.`;
    
    const htmlBody = generateWelcomeEmail({
      name: b.first_name,
      username: b.emp_code,
      email: b.email,
      password: password,
      companyName: req.company.name,
      loginUrl: loginUrl
    });

    const manualPath = path.join(__dirname, '../../../docs/EMPLOYEE_MANUAL.pdf');

    // Awaited for the same reason as the reset: when the server generated the
    // password, this mail is its only copy.
    const mail = await sendMailNow(req.s, b.email,
      `Welcome to ${req.company.name} — your ValidureHR account`,
      plainTextBody,
      htmlBody,
      [{
        filename: 'Employee Manual.pdf',
        path: manualPath
      }]
    );

    audit(req, 'EMPLOYEE_CREATED',
      `Created employee ${b.emp_code} (${b.first_name} ${b.last_name}), role ${role.name} (welcome email ${mail.ok ? 'sent' : 'FAILED'})`);
    res.status(201).json({
      message: mail.ok
        ? `Employee created — credentials emailed to ${b.email}`
        : `Employee created, but the welcome email could NOT be delivered (${mail.error}). Set a password for them from the Reset Password button and hand it over directly.`,
      emailed: mail.ok,
      email_error: mail.ok ? undefined : mail.error,
      id: emp.id,
    });
  } catch (e) { next(e); }
});

// PUT /api/employees/:id — edit (incl. role change)
router.put('/:id', requirePerm('employees.manage'), async (req, res, next) => {
  try {
    const id = numericId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Employee id must be a number' });
    const e = await tqOne(req.s, 'SELECT * FROM {s}.employees WHERE id=$1', [id]);
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    const b = { ...e, ...req.body };

    const today = new Date().toISOString().slice(0, 10);
    if (ageOn(today, b.dob) < 18) return res.status(400).json({ error: 'Employee must be at least 18 years old' });

    if (b.email !== e.email) {
      // global email uniqueness check (excluding this user's own directory entry)
      const clash = await qOne(
        `SELECT id FROM user_directory WHERE LOWER(email)=LOWER($1) AND NOT (company_id=$2 AND username=$3)`,
        [b.email, req.company.id, e.emp_code]);
      if (clash) return res.status(409).json({ error: 'That email is already registered on the platform' });
    }

    // probation: HR can set, change or remove it (send null/empty to remove)
    if (b.probation_until && !/^\d{4}-\d{2}-\d{2}$/.test(b.probation_until)) {
      return res.status(400).json({ error: 'Invalid probation end date' });
    }
    const probationChanged = (b.probation_until || null) !== (e.probation_until || null);

    await tq(req.s,
      `UPDATE {s}.employees SET first_name=$1, last_name=$2, phone=$3, emergency_contact=$4, email=$5, doj=$6, dob=$7,
        department_id=$8, designation_id=$9, reporting_manager_id=$10, status=$11, probation_until=$12,
        pan_no=$13, bank_name=$14, bank_account_no=$15, bank_ifsc=$16 WHERE id=$17`,
      [b.first_name, b.last_name, b.phone, b.emergency_contact || null, b.email, b.doj, b.dob,
        b.department_id || null, b.designation_id || null, b.reporting_manager_id || null, b.status,
        b.probation_until || null, b.pan_no || null, b.bank_name || null, b.bank_account_no || null, b.bank_ifsc || null, e.id]);
    if (probationChanged) {
      audit(req, 'PROBATION_SET', b.probation_until
        ? `${e.emp_code}: probation until ${b.probation_until} (unpaid leave only, balance locked)`
        : `${e.emp_code}: probation removed`);
    }

    const roleId = b.role_id || null;
    await tq(req.s, 'UPDATE {s}.users SET email=$1, is_active=$2' + (roleId ? ', role_id=$4' : '') + ' WHERE employee_id=$3',
      roleId ? [b.email, b.status === 'Active', e.id, roleId] : [b.email, b.status === 'Active', e.id]);
    await q('UPDATE user_directory SET email=$1 WHERE company_id=$2 AND username=$3', [b.email, req.company.id, e.emp_code]);

    audit(req, 'EMPLOYEE_UPDATED', `Updated employee ${e.emp_code}`);
    res.json({ message: 'Employee updated' });
  } catch (e) { next(e); }
});

// POST /api/employees/:id/end-probation — remove probation
router.post('/:id/end-probation', requirePerm('employees.manage'), async (req, res, next) => {
  try {
    const id = numericId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Employee id must be a number' });
    const e = await tqOne(req.s, 'SELECT emp_code, first_name, last_name FROM {s}.employees WHERE id=$1', [id]);
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    await tq(req.s, 'UPDATE {s}.employees SET probation_until = NULL WHERE id=$1', [id]);
    audit(req, 'PROBATION_REMOVED', `${e.emp_code}: probation ended`);
    res.json({ message: `Probation ended for ${e.first_name} ${e.last_name}` });
  } catch (err) { next(err); }
});

// DELETE /api/employees/:id
router.delete('/:id', requirePerm('employees.manage'), async (req, res, next) => {
  try {
    const id = numericId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Employee id must be a number' });
    const e = await tqOne(req.s, 'SELECT * FROM {s}.employees WHERE id=$1', [id]);
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    const user = await tqOne(req.s, 'SELECT id FROM {s}.users WHERE employee_id=$1', [e.id]);
    if (user) await tq(req.s, 'DELETE FROM {s}.user_permissions WHERE user_id=$1', [user.id]);
    for (const table of ['attendance', 'leave_applications', 'leave_balances', 'leave_ledger', 'salary_slips', 'offer_letters', 'users']) {
      await tq(req.s, `DELETE FROM {s}.${table} WHERE employee_id=$1`, [e.id]);
    }
    await tq(req.s, 'UPDATE {s}.employees SET reporting_manager_id=NULL WHERE reporting_manager_id=$1', [e.id]);
    await tq(req.s, 'DELETE FROM {s}.employees WHERE id=$1', [e.id]);
    await q('DELETE FROM user_directory WHERE company_id=$1 AND username=$2', [req.company.id, e.emp_code]);
    audit(req, 'EMPLOYEE_DELETED', `Deleted employee ${e.emp_code}`);
    res.json({ message: 'Employee deleted' });
  } catch (e) { next(e); }
});

// POST /api/employees/:id/reset-password { newPassword }
router.post('/:id/reset-password', requirePerm('employees.manage'), async (req, res, next) => {
  try {
    const id = numericId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Employee id must be a number' });
    const e = await tqOne(req.s, 'SELECT * FROM {s}.employees WHERE id=$1', [id]);
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    if (req.body?.newPassword) {
      const invalid = validatePassword(req.body.newPassword);
      if (invalid) return res.status(400).json({ error: invalid });
    }
    const newPassword = req.body?.newPassword || generateTempPassword();
    await tq(req.s, 'UPDATE {s}.users SET password_hash=$1, must_change_password=TRUE, failed_attempts=0, locked_until=NULL WHERE employee_id=$2',
      [bcrypt.hashSync(newPassword, 10), e.id]);

    /*
     * Awaited, not fire-and-forget: this mail carries the only copy of the new
     * password when HR let the server generate one. Reporting "emailed" without
     * knowing is what left an employee unable to log in — the password existed
     * solely inside a message that never sent.
     */
    const mail = await sendMailNow(req.s, e.email,
      `Your ${req.company.name} HR portal password was reset`,
      `Hi ${e.first_name},\n\nYour password has been reset by HR.\n\n  Username : ${e.emp_code}\n  Password : ${newPassword}\n\nPlease log in and change it immediately.\n\nRegards,\nHR Team, ${req.company.name}`);

    audit(req, 'PASSWORD_RESET',
      `Reset password for ${e.emp_code} (email ${mail.ok ? 'sent' : 'FAILED'})`);

    res.json({
      message: mail.ok
        ? `Password reset for ${e.emp_code} — emailed to ${e.email}`
        : `Password reset for ${e.emp_code}, but the email could NOT be delivered (${mail.error}). Give the new password to the employee directly.`,
      emailed: mail.ok,
      email_error: mail.ok ? undefined : mail.error,
    });
  } catch (e) { next(e); }
});

// POST /api/employees/:id/lock | /unlock | /enable | /disable
for (const [action, field, value, label] of [
  ['lock', 'is_locked', true, 'locked'],
  ['unlock', 'is_locked', false, 'unlocked'],
  ['disable', 'is_active', false, 'disabled'],
  ['enable', 'is_active', true, 'enabled'],
]) {
  router.post(`/:id/${action}`, requirePerm('employees.manage'), async (req, res, next) => {
    try {
      const id = numericId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Employee id must be a number' });
      const e = await tqOne(req.s, 'SELECT * FROM {s}.employees WHERE id=$1', [id]);
      if (!e) return res.status(404).json({ error: 'Employee not found' });
      // Unlocking by hand also clears any automatic failed-attempt lockout.
      const extra = action === 'unlock' ? ', failed_attempts=0, locked_until=NULL' : '';
      await tq(req.s, `UPDATE {s}.users SET ${field}=$1${extra} WHERE employee_id=$2`, [value, e.id]);
      audit(req, `ACCOUNT_${action.toUpperCase()}`, `Account ${label} for ${e.emp_code}`);
      res.json({ message: `Account ${label} for ${e.emp_code}` });
    } catch (e) { next(e); }
  });
}

// POST /api/employees/:id/photo
router.post('/:id/photo', requirePerm('employees.manage'), photoUpload.single('file'), async (req, res, next) => {
  try {
    const id = numericId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Employee id must be a number' });
    if (!req.file) return res.status(400).json({ error: 'A photo file is required' });
    
    const e = await tqOne(req.s, 'SELECT * FROM {s}.employees WHERE id=$1', [id]);
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    
    await tq(req.s, 'UPDATE {s}.employees SET photo_file=$1 WHERE id=$2', [req.file.filename, e.id]);
    audit(req, 'PHOTO_UPLOADED', `Uploaded photo for ${e.emp_code}`);
    res.json({ message: 'Photo uploaded successfully' });
  } catch(e) { next(e); }
});

// GET /api/employees/:id/photo
router.get('/:id/photo', async (req, res, next) => {
  try {
    const id = numericId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Employee id must be a number' });
    
    const e = await tqOne(req.s, 'SELECT * FROM {s}.employees WHERE id=$1', [id]);
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    
    // permissions: self or HR
    if (e.id !== req.user.employeeId && !req.perms.has('employees.manage')) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    
    if (!e.photo_file) return res.status(404).json({ error: 'No photo uploaded' });
    
    const file = filePath(req.company.slug, 'photos', e.photo_file);
    if (!file) return res.status(404).json({ error: 'File missing on server' });
    
    sendUserFile(res, file, `photo-${e.emp_code}${path.extname(file)}`, true);
  } catch(e) { next(e); }
});

module.exports = router;
