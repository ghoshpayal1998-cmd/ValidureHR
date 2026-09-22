const express = require('express');
const { tq, tqOne } = require('../db');
const audit = require('../audit');
const { sendMail } = require('../mailer');
const { addNotification } = require('../notifications');
const { uploader, filePath, sendUserFile } = require('../storage');
const { authenticate, tenant, requirePerm } = require('../middleware/auth');
const { getCycleStartDay, cycleRange, currentYearMonth } = require('../cycle');
const { isCompanyAdminRole } = require('../permissions');

const router = express.Router();
router.use(authenticate, tenant);

const leaveDocUpload = uploader('leave-docs');

async function holidaySet(schema) {
  return new Set((await tq(schema, 'SELECT date FROM {s}.holidays')).map((h) => h.date));
}

function workingDays(from, to, hols) {
  let n = 0;
  for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !hols.has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

const LEAVE_LIST_SQL = `
  SELECT la.*, lt.name AS leave_type, lt.code AS leave_code,
         e.emp_code, (e.first_name || ' ' || e.last_name) AS employee_name
  FROM {s}.leave_applications la
  JOIN {s}.leave_types lt ON lt.id = la.leave_type_id
  JOIN {s}.employees e ON e.id = la.employee_id`;

/*
 * Everyone who actually holds leaves.approve — through their role or through an
 * individual grant. Per requirement, leave requests are mailed to HR and the
 * director.
 *
 * Membership is tested against the parsed JSON array, not with a substring
 * LIKE: '%leaves.approve%' would also match a future key such as
 * 'leaves.approve_final' and quietly widen who receives (and is assumed to
 * hold) approval rights.
 */
async function approverEmails(schema) {
  const rows = await tq(schema, `
    SELECT DISTINCT u.email FROM {s}.users u
    LEFT JOIN {s}.roles r ON r.id = u.role_id
    WHERE u.is_active AND u.email IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM json_array_elements_text(COALESCE(NULLIF(r.permissions, ''), '[]')::json) AS perm
        WHERE perm = 'leaves.approve'
      )
      OR EXISTS (
        SELECT 1 FROM {s}.user_permissions up
        WHERE up.user_id = u.id AND up.permission = 'leaves.approve'
      )
    )`);
  return rows.map((r) => r.email);
}

async function managerOf(schema, employeeId) {
  return tqOne(schema, `
    SELECT m.id, m.email, (m.first_name || ' ' || m.last_name) AS name
    FROM {s}.employees e JOIN {s}.employees m ON m.id = e.reporting_manager_id
    WHERE e.id = $1`, [employeeId]);
}

async function actorName(req) {
  if (req.user.adm) return `${req.user.username} (Platform Admin)`;
  const me = await tqOne(req.s, `
    SELECT (e.first_name || ' ' || e.last_name) AS name, r.name AS role
    FROM {s}.users u
    LEFT JOIN {s}.employees e ON e.id = u.employee_id
    LEFT JOIN {s}.roles r ON r.id = u.role_id
    WHERE u.id=$1`, [req.user.id]);
  return `${me?.name || req.user.username} (${me?.role || 'User'})`;
}

// GET /api/leaves/types
router.get('/types', async (req, res, next) => {
  try { res.json(await tq(req.s, 'SELECT * FROM {s}.leave_types ORDER BY id')); } catch (e) { next(e); }
});

const todayStr = () => new Date().toISOString().slice(0, 10);

async function probationOf(schema, empId) {
  const e = await tqOne(schema, 'SELECT probation_until FROM {s}.employees WHERE id=$1', [empId]);
  const until = e?.probation_until || null;
  return { onProbation: !!until && todayStr() <= until, until };
}

// GET /api/leaves/balance — own balances + probation state + recent ledger
router.get('/balance', async (req, res, next) => {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    const rows = await tq(req.s, `
      SELECT lt.id AS leave_type_id, lt.name, lt.code, lt.monthly_accrual,
             COALESCE(b.accrued, 0) AS accrued, COALESCE(b.used, 0) AS used,
             COALESCE(b.accrued - b.used, 0) AS balance
      FROM {s}.leave_types lt
      LEFT JOIN {s}.leave_balances b ON lt.id = b.leave_type_id AND b.employee_id=$1
      ORDER BY lt.id`, [empId]);
    const { onProbation, until } = await probationOf(req.s, empId);
    const ledger = await tq(req.s, `
      SELECT l.delta, l.kind, l.note, l.created_at, lt.code
      FROM {s}.leave_ledger l JOIN {s}.leave_types lt ON lt.id = l.leave_type_id
      WHERE l.employee_id=$1 ORDER BY l.id DESC LIMIT 15`, [empId]);
    res.json({ balances: rows, on_probation: onProbation, probation_until: until, ledger });
  } catch (e) { next(e); }
});

// POST /api/leaves/apply — multipart: leave_type_id, from_date, to_date, reason + optional document
router.post('/apply', leaveDocUpload.single('document'), async (req, res, next) => {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    const { leave_type_id, from_date, to_date, reason } = req.body || {};
    if (!leave_type_id || !from_date || !to_date || !reason) {
      return res.status(400).json({ error: 'Leave type, dates and reason are required' });
    }
    if (new Date(to_date) < new Date(from_date)) return res.status(400).json({ error: 'To date cannot be before from date' });

    const days = workingDays(from_date, to_date, await holidaySet(req.s));
    if (days <= 0) return res.status(400).json({ error: 'Selected range has no working days' });

    // Check if the leave type is Unpaid Leave (UL)
    const ltInfo = await tqOne(req.s, 'SELECT code FROM {s}.leave_types WHERE id=$1', [leave_type_id]);
    const isUnpaidType = ltInfo?.code === 'UL';

    // Probation: only UNPAID leave is possible — the balance is locked and untouched.
    const { onProbation } = await probationOf(req.s, empId);
    
    if (onProbation && !isUnpaidType) {
      return res.status(400).json({ error: 'During probationary periods, you can only apply for unpaid leaves.' });
    }

    const unpaid = isUnpaidType || onProbation;

    if (!unpaid) {
      const bal = await tqOne(req.s,
        `SELECT (accrued - used) AS balance FROM {s}.leave_balances WHERE employee_id=$1 AND leave_type_id=$2`,
        [empId, leave_type_id]);
      if (!bal) return res.status(400).json({ error: 'No leave balance found for this type' });
      if (bal.balance < days) {
        return res.status(400).json({ error: `Insufficient balance: ${bal.balance.toFixed(2)} day(s) available, ${days} requested` });
      }
    }

    // no double-booking: reject if any pending/approved application overlaps the range
    const overlap = await tqOne(req.s, `
      SELECT id, from_date, to_date FROM {s}.leave_applications
      WHERE employee_id=$1 AND status IN ('Pending','Approved') AND from_date <= $3 AND to_date >= $2`,
      [empId, from_date, to_date]);
    if (overlap) {
      return res.status(400).json({ error: `You already have a pending/approved leave overlapping those dates (#${overlap.id}: ${overlap.from_date} to ${overlap.to_date})` });
    }

    const inserted = await tqOne(req.s, `
      INSERT INTO {s}.leave_applications
        (employee_id, leave_type_id, from_date, to_date, days, reason, attachment_file, status, is_unpaid)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending',$8) RETURNING id`,
      [empId, leave_type_id, from_date, to_date, days, reason, req.file ? req.file.filename : null, unpaid]);

    const emp = await tqOne(req.s,
      `SELECT emp_code, email, (first_name || ' ' || last_name) AS name FROM {s}.employees WHERE id=$1`, [empId]);
    const lt = await tqOne(req.s, 'SELECT name FROM {s}.leave_types WHERE id=$1', [leave_type_id]);

    // mail the approvers (HR + Director) …
    const approvers = await approverEmails(req.s);
    sendMail(req.s, approvers,
      `[Leave Request] ${emp.name} — ${from_date} to ${to_date} (${days}d${onProbation ? ', UNPAID' : ''})`,
      `A new leave application is awaiting approval.\n\n` +
      `  Employee : ${emp.name} (${emp.emp_code})\n  Type     : ${lt.name}${onProbation ? ' — UNPAID (employee on probation, balance locked)' : ''}\n` +
      `  Dates    : ${from_date} to ${to_date} (${days} working day(s))\n  Reason   : ${reason}\n` +
      (req.file ? `  Document : attached in the portal\n` : '') +
      `\nApprove or reject it in the ValidureHR portal (Leave Approvals).`);

    // … and an intimation to the reporting manager (they don't approve — just informed)
    const mgr = await managerOf(req.s, empId);
    if (mgr) {
      sendMail(req.s, mgr.email,
        `[Leave Intimation] ${emp.name} has applied for leave`,
        `This is an intimation — no action is needed from you.\n\n` +
        `  Employee : ${emp.name} (${emp.emp_code})\n  Type     : ${lt.name}\n` +
        `  Dates    : ${from_date} to ${to_date} (${days} working day(s))\n  Reason   : ${reason}\n\n` +
        `HR / the Director will approve or reject the request.`);
    }

    // Trigger in-app notifications for reporting manager and all leave approvers (HR/DIRECTOR)
    if (mgr) {
      await addNotification(req.s, mgr.id, 'Team Leave Application', `${emp.name} applied: ${from_date} to ${to_date} (${days} days)`, '/leave/approvals');
    }
    const approverUsers = await tq(req.s, `
      SELECT u.employee_id FROM {s}.users u
      JOIN {s}.roles r ON r.id = u.role_id
      WHERE r.name IN ('HR', 'DIRECTOR') AND u.employee_id IS NOT NULL
    `);
    for (const app of approverUsers) {
      if (app.employee_id !== empId) {
        await addNotification(req.s, app.employee_id, 'Pending Leave Request', `${emp.name} applied: ${from_date} to ${to_date} (${days} days)`, '/leave/approvals');
      }
    }

    // Trigger notification for applicant themselves
    await addNotification(req.s, empId, 'Leave Request Submitted', `Your leave request from ${from_date} to ${to_date} (${days} days) has been submitted.`, '/leave/history');

    audit(req, 'LEAVE_APPLIED', `Leave application #${inserted.id} (${from_date} to ${to_date}, ${days} day(s)${unpaid ? ', unpaid' : ''})`);
    res.status(201).json({
      message: unpaid
        ? 'Leave application submitted as UNPAID (your balance is not affected)'
        : 'Leave application submitted',
      id: inserted.id, days, is_unpaid: unpaid,
    });
  } catch (e) { next(e); }
});

// PUT /api/leaves/:id — the OWNER edits their own application while it is still Pending.
// (Requirement: HR can edit their own leaves — this applies to every employee's own leaves.)
router.put('/:id', leaveDocUpload.single('document'), async (req, res, next) => {
  try {
    const row = await tqOne(req.s, 'SELECT * FROM {s}.leave_applications WHERE id=$1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Leave application not found' });
    if (row.employee_id !== req.user.employeeId) return res.status(403).json({ error: 'You can only edit your own applications' });
    if (row.status !== 'Pending') return res.status(400).json({ error: `Only pending applications can be edited (this one is ${row.status})` });

    const b = req.body || {};
    const leave_type_id = b.leave_type_id || row.leave_type_id;
    const from_date = b.from_date || row.from_date;
    const to_date = b.to_date || row.to_date;
    const reason = b.reason || row.reason;
    if (new Date(to_date) < new Date(from_date)) return res.status(400).json({ error: 'To date cannot be before from date' });

    const days = workingDays(from_date, to_date, await holidaySet(req.s));
    if (days <= 0) return res.status(400).json({ error: 'Selected range has no working days' });

    /*
     * Unpaid follows the leave TYPE as well as the current probation state —
     * the same rule POST /apply applies. Deciding it from probation alone ran
     * the balance check against Unpaid Leave, whose balance is always zero,
     * so an employee not on probation could never edit an unpaid request:
     * saving an unchanged reason answered "Insufficient balance: 0.00 day(s)
     * available", and the Edit button could not be made to work at all.
     */
    const editType = await tqOne(req.s, 'SELECT code FROM {s}.leave_types WHERE id=$1', [leave_type_id]);
    const { onProbation } = await probationOf(req.s, row.employee_id);
    const unpaid = editType?.code === 'UL' || onProbation;
    if (!unpaid) {
      const bal = await tqOne(req.s,
        `SELECT (accrued - used) AS balance FROM {s}.leave_balances WHERE employee_id=$1 AND leave_type_id=$2`,
        [row.employee_id, leave_type_id]);
      if (!bal) return res.status(400).json({ error: 'No leave balance found for this type' });
      if (bal.balance < days) {
        return res.status(400).json({ error: `Insufficient balance: ${bal.balance.toFixed(2)} day(s) available, ${days} requested` });
      }
    }

    // overlap check excluding this very application
    const overlap = await tqOne(req.s, `
      SELECT id, from_date, to_date FROM {s}.leave_applications
      WHERE employee_id=$1 AND id <> $2 AND status IN ('Pending','Approved') AND from_date <= $4 AND to_date >= $3`,
      [row.employee_id, row.id, from_date, to_date]);
    if (overlap) {
      return res.status(400).json({ error: `Another pending/approved leave overlaps those dates (#${overlap.id}: ${overlap.from_date} to ${overlap.to_date})` });
    }

    await tq(req.s, `
      UPDATE {s}.leave_applications
      SET leave_type_id=$1, from_date=$2, to_date=$3, days=$4, reason=$5, is_unpaid=$6,
          attachment_file=COALESCE($7, attachment_file)
      WHERE id=$8`,
      [leave_type_id, from_date, to_date, days, reason, unpaid,
        req.file ? req.file.filename : null, row.id]);

    const emp = await tqOne(req.s,
      `SELECT emp_code, (first_name || ' ' || last_name) AS name FROM {s}.employees WHERE id=$1`, [row.employee_id]);
    sendMail(req.s, await approverEmails(req.s),
      `[Leave Request Updated] ${emp.name} — now ${from_date} to ${to_date} (${days}d)`,
      `Leave application #${row.id} was edited by the applicant and is still awaiting approval.\n\n` +
      `  Employee : ${emp.name} (${emp.emp_code})\n  Dates    : ${from_date} to ${to_date} (${days} working day(s))\n` +
      `  Reason   : ${reason}\n\nReview it in the ValidureHR portal (Leave Approvals).`);

    audit(req, 'LEAVE_EDITED', `Leave #${row.id} edited by owner (${from_date} to ${to_date}, ${days} day(s))`);
    res.json({ message: 'Leave application updated', days, is_unpaid: unpaid });
  } catch (e) { next(e); }
});

// GET /api/leaves/history — own history
router.get('/history', async (req, res, next) => {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    res.json(await tq(req.s, LEAVE_LIST_SQL + ' WHERE la.employee_id=$1 ORDER BY la.applied_at DESC', [empId]));
  } catch (e) { next(e); }
});

// GET /api/leaves/pending — the approval inbox (HR / Director / anyone granted leaves.approve)
router.get('/pending', requirePerm('leaves.approve'), async (req, res, next) => {
  try {
    let sql = LEAVE_LIST_SQL + ` WHERE la.status='Pending'`;
    const args = [];
    // An owner/director administers their own company and has nobody above
    // them, so their own request stays in their inbox. Everyone else's is
    // filtered out — you do not approve your own leave.
    if (!req.user.adm && req.user.employeeId && !isCompanyAdminRole(req.user.role)) {
      sql += ' AND la.employee_id <> $1';
      args.push(req.user.employeeId);
    }
    res.json(await tq(req.s, sql + ' ORDER BY la.applied_at', args));
  } catch (e) { next(e); }
});

// GET /api/leaves?status= — all applications (view-all)
router.get('/', requirePerm('leaves.view_all'), async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = LEAVE_LIST_SQL;
    const args = [];
    if (status && status !== 'All') { sql += ' WHERE la.status=$1'; args.push(status); }
    res.json(await tq(req.s, sql + ' ORDER BY la.applied_at DESC', args));
  } catch (e) { next(e); }
});

// GET /api/leaves/:id/attachment — the uploaded supporting document
router.get('/:id/attachment', async (req, res, next) => {
  try {
    const row = await tqOne(req.s, 'SELECT * FROM {s}.leave_applications WHERE id=$1', [req.params.id]);
    if (!row || !row.attachment_file) return res.status(404).json({ error: 'No document attached' });
    const isOwner = row.employee_id === req.user.employeeId;
    if (!isOwner && !req.perms.has('leaves.view_all') && !req.perms.has('leaves.approve')) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const file = filePath(req.company.slug, 'leave-docs', row.attachment_file);
    if (!file) return res.status(404).json({ error: 'File missing on server' });
    sendUserFile(res, file, `leave-${row.id}-document${require('path').extname(file)}`);
  } catch (e) { next(e); }
});

/*
 * POST /api/leaves/:id/approve — SINGLE-STEP approval.
 * Any one approver (HR or Director — or a user granted leaves.approve) fully
 * approves: balance is deducted, attendance marked, employee + manager emailed.
 */
router.post('/:id/approve', requirePerm('leaves.approve'), async (req, res, next) => {
  try {
    const row = await tqOne(req.s, 'SELECT * FROM {s}.leave_applications WHERE id=$1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Leave application not found' });
    if (row.status !== 'Pending') return res.status(400).json({ error: `Cannot approve an application that is ${row.status}` });
    if (!req.user.adm && !isCompanyAdminRole(req.user.role) && row.employee_id === req.user.employeeId) {
      return res.status(403).json({ error: 'You cannot approve your own leave application' });
    }

    const approvedBy = await actorName(req);

    if (!row.is_unpaid) {
      // re-check the balance at approval time — it may have shrunk since the application
      const balNow = await tqOne(req.s,
        `SELECT (accrued - used) AS balance FROM {s}.leave_balances WHERE employee_id=$1 AND leave_type_id=$2`,
        [row.employee_id, row.leave_type_id]);
      if (!balNow || balNow.balance < row.days) {
        return res.status(400).json({
          error: `Insufficient balance at approval time: ${(balNow?.balance ?? 0).toFixed(2)} day(s) available, ${row.days} needed. Adjust the balance or reject the request.`,
        });
      }
      await tq(req.s, `UPDATE {s}.leave_balances SET used = used + $1 WHERE employee_id=$2 AND leave_type_id=$3`,
        [row.days, row.employee_id, row.leave_type_id]);
      await tq(req.s, `
        INSERT INTO {s}.leave_ledger (employee_id, leave_type_id, delta, kind, note, actor)
        VALUES ($1,$2,$3,'leave_taken',$4,$5)`,
        [row.employee_id, row.leave_type_id, -row.days,
          `Leave #${row.id} approved (${row.from_date} to ${row.to_date})`, approvedBy]);
    }
    // unpaid (probation) leave: balance locked — nothing deducted, nothing accrues

    const hols = await holidaySet(req.s);
    for (let d = new Date(row.from_date); d <= new Date(row.to_date); d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6 && !hols.has(ds)) {
        await tq(req.s, `
          INSERT INTO {s}.attendance (employee_id, date, status, remarks) VALUES ($1,$2,'Leave',$3)
          ON CONFLICT (employee_id, date) DO UPDATE SET status='Leave', check_in=NULL, check_out=NULL, late_mark=FALSE, remarks=EXCLUDED.remarks`,
          [row.employee_id, ds, row.is_unpaid ? 'Unpaid leave (probation)' : null]);
      }
    }
    await tq(req.s, `UPDATE {s}.leave_applications SET status='Approved', decided_by=$1,
      decided_at=to_char(now(),'YYYY-MM-DD') WHERE id=$2`, [approvedBy, row.id]);

    const emp = await tqOne(req.s,
      `SELECT emp_code, email, first_name, (first_name || ' ' || last_name) AS name FROM {s}.employees WHERE id=$1`,
      [row.employee_id]);
    const mgr = await managerOf(req.s, row.employee_id);
    // approval mail to the designated employee and their manager
    sendMail(req.s, emp.email,
      `[Approved] Your leave ${row.from_date} to ${row.to_date}`,
      `Hi ${emp.first_name},\n\nYour leave application has been APPROVED${row.is_unpaid ? ' as UNPAID leave (probation — your balance is not affected)' : ''}.\n\n` +
      `  Dates       : ${row.from_date} to ${row.to_date} (${row.days} day(s))\n` +
      `  Approved by : ${approvedBy}\n\nEnjoy your time off!\n\nValidureHR, ${req.company.name}`);
    if (mgr) {
      sendMail(req.s, mgr.email,
        `[Leave Approved] ${emp.name} — ${row.from_date} to ${row.to_date}`,
        `Intimation: leave for your team member has been approved.\n\n` +
        `  Employee    : ${emp.name} (${emp.emp_code})\n` +
        `  Dates       : ${row.from_date} to ${row.to_date} (${row.days} day(s))\n` +
        `  Approved by : ${approvedBy}\n\nValidureHR, ${req.company.name}`);
    }

    // Trigger in-app notifications for employee and manager
    await addNotification(req.s, row.employee_id, 'Leave Approved 🎉', `Your leave from ${row.from_date} to ${row.to_date} (${row.days} days) has been APPROVED by ${approvedBy}.`, '/leave/history');
    if (mgr) {
      await addNotification(req.s, mgr.id, 'Team Leave Approved', `Leave request for ${emp.name} (${row.from_date} to ${row.to_date}) was approved.`, '/leave/history');
    }

    audit(req, 'LEAVE_APPROVED', `Leave #${row.id} approved by ${approvedBy}`);
    res.json({ message: 'Leave approved', status: 'Approved' });
  } catch (e) { next(e); }
});

// POST /api/leaves/:id/reject { reason }
router.post('/:id/reject', requirePerm('leaves.approve'), async (req, res, next) => {
  try {
    const row = await tqOne(req.s, 'SELECT * FROM {s}.leave_applications WHERE id=$1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Leave application not found' });
    if (row.status !== 'Pending') return res.status(400).json({ error: `Cannot reject an application that is ${row.status}` });
    if (!req.user.adm && !isCompanyAdminRole(req.user.role) && row.employee_id === req.user.employeeId) {
      return res.status(403).json({ error: 'You cannot act on your own leave application' });
    }
    const reason = req.body?.reason || 'Not specified';
    const rejectedBy = await actorName(req);
    await tq(req.s, `UPDATE {s}.leave_applications SET status='Rejected', rejection_reason=$1,
      decided_by=$2, decided_at=to_char(now(),'YYYY-MM-DD') WHERE id=$3`, [reason, rejectedBy, row.id]);

    const emp = await tqOne(req.s,
      `SELECT emp_code, email, first_name, (first_name || ' ' || last_name) AS name FROM {s}.employees WHERE id=$1`,
      [row.employee_id]);
    const mgr = await managerOf(req.s, row.employee_id);
    sendMail(req.s, emp.email,
      `[Rejected] Your leave ${row.from_date} to ${row.to_date}`,
      `Hi ${emp.first_name},\n\nYour leave application has been REJECTED.\n\n` +
      `  Dates       : ${row.from_date} to ${row.to_date} (${row.days} day(s))\n` +
      `  Rejected by : ${rejectedBy}\n  Reason      : ${reason}\n\nValidureHR, ${req.company.name}`);
    if (mgr) {
      sendMail(req.s, mgr.email,
        `[Leave Rejected] ${emp.name} — ${row.from_date} to ${row.to_date}`,
        `Intimation: a leave request from your team member was rejected.\n\n` +
        `  Employee : ${emp.name} (${emp.emp_code})\n  Reason   : ${reason}\n\nValidureHR, ${req.company.name}`);
    }

    // Trigger in-app notifications for employee and manager on rejection
    await addNotification(req.s, row.employee_id, 'Leave Rejected ❌', `Your leave from ${row.from_date} to ${row.to_date} was rejected by ${rejectedBy}. Reason: ${reason}`, '/leave/history');
    if (mgr) {
      await addNotification(req.s, mgr.id, 'Team Leave Rejected', `Leave request for ${emp.name} (${row.from_date} to ${row.to_date}) was rejected.`, '/leave/history');
    }

    audit(req, 'LEAVE_REJECTED', `Leave #${row.id} rejected by ${rejectedBy}: ${reason}`);
    res.json({ message: 'Leave application rejected' });
  } catch (e) { next(e); }
});

// DELETE /api/leaves/:id — owner cancels a pending one; approvers can cancel an approved one
router.delete('/:id', async (req, res, next) => {
  try {
    const row = await tqOne(req.s, 'SELECT * FROM {s}.leave_applications WHERE id=$1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Leave application not found' });
    const isOwner = row.employee_id === req.user.employeeId;
    const canManage = req.perms.has('leaves.approve');
    if (!isOwner && !canManage) return res.status(403).json({ error: 'Not allowed' });
    if (['Rejected', 'Cancelled'].includes(row.status)) return res.status(400).json({ error: `Already ${row.status}` });
    if (row.status === 'Approved') {
      if (!canManage) return res.status(403).json({ error: 'Only an approver can cancel an approved leave' });
      if (!row.is_unpaid) {
        await tq(req.s, `UPDATE {s}.leave_balances SET used = used - $1 WHERE employee_id=$2 AND leave_type_id=$3`,
          [row.days, row.employee_id, row.leave_type_id]);
        await tq(req.s, `
          INSERT INTO {s}.leave_ledger (employee_id, leave_type_id, delta, kind, note, actor)
          VALUES ($1,$2,$3,'leave_cancelled',$4,$5)`,
          [row.employee_id, row.leave_type_id, row.days,
            `Approved leave #${row.id} cancelled (${row.from_date} to ${row.to_date})`, await actorName(req)]);
      }
      // revert the marked days to "unmarked" (the calendar re-derives holidays/weekends)
      await tq(req.s, `DELETE FROM {s}.attendance WHERE employee_id=$1 AND date BETWEEN $2 AND $3 AND status='Leave'`,
        [row.employee_id, row.from_date, row.to_date]);
    }
    await tq(req.s, `UPDATE {s}.leave_applications SET status='Cancelled' WHERE id=$1`, [row.id]);
    audit(req, 'LEAVE_CANCELLED', `Leave application #${row.id} cancelled`);
    res.json({ message: 'Leave application cancelled' });
  } catch (e) { next(e); }
});

// GET /api/leaves/calendar?year&month — approved leaves for calendar view
router.get('/calendar', requirePerm('leaves.view_all'), async (req, res, next) => {
  try {
    const now = new Date();
    // UTC: the container's clock is ahead of it, so the local getters name the
    // NEXT month for several hours each evening and the page would silently
    // open on the wrong one.
    const nowYm = currentYearMonth();
    const year = parseInt(req.query.year) || nowYm.year;
    const month = parseInt(req.query.month) || nowYm.month;
    /*
     * The month is the company's payroll cycle, as everywhere else, so this
     * list lines up with the attendance page for the same month.
     *
     * OVERLAP, not "starts or ends in the month". The previous LIKE test missed
     * any leave that spanned the whole period — a fortnight from the 20th to
     * the 5th of the next month straddled the boundary and appeared in neither
     * month's list.
     */
    const { from, to } = cycleRange(year, month, await getCycleStartDay(req.s));
    const rows = await tq(req.s, `
      SELECT la.from_date, la.to_date, lt.code AS leave_code, e.emp_code,
             (e.first_name || ' ' || e.last_name) AS employee_name
      FROM {s}.leave_applications la
      JOIN {s}.leave_types lt ON lt.id = la.leave_type_id
      JOIN {s}.employees e ON e.id = la.employee_id
      WHERE la.status='Approved' AND la.from_date <= $2 AND la.to_date >= $1
      ORDER BY la.from_date`, [from, to]);
    res.json({ year, month, period: { from, to }, leaves: rows });
  } catch (e) { next(e); }
});

module.exports = router;
