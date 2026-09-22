const express = require('express');
const path = require('path');
const PDFDocument = require('pdfkit');
const { tq, tqOne } = require('../db');
const audit = require('../audit');
const { uploader, filePath, sendUserFile } = require('../storage');
const { authenticate, tenant, requirePerm } = require('../middleware/auth');
const { getCycleStartDay, cycleLabel } = require('../cycle');

const router = express.Router();
router.use(authenticate, tenant);

const slipUpload = uploader('slips');
const policyUpload = uploader('policies');
const offerUpload = uploader('offers');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const inr = (n) => 'Rs. ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });

// ---------- Salary slips ----------

// GET /api/documents/salary-slips  (own; ?employee_id= needs documents.manage)
router.get('/salary-slips', async (req, res, next) => {
  try {
    let empId = req.user.employeeId;
    if (req.query.employee_id && req.perms.has('documents.manage')) empId = req.query.employee_id;
    if (!empId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    const rows = await tq(req.s, `
      SELECT id, month, year, net_pay, file_name, generated_at, basic, hra, special_allowance, conveyance, pf_deduction, tax_deduction, lop_deduction, esic_deduction FROM {s}.salary_slips
      WHERE employee_id=$1 ORDER BY year DESC, month DESC`, [empId]);
    /*
     * month/year name the cycle the slip covers, and the cycle is the
     * company's payroll month — with a 25th start, "August 2026" is
     * 25 Jul - 24 Aug. `period` spells that out so nobody has to know the
     * setting to read the slip; `label` keeps the short month name the lists
     * are laid out around.
     */
    const startDay = await getCycleStartDay(req.s);
    res.json(rows.map((r) => ({
      ...r,
      label: `${MONTHS[r.month - 1]} ${r.year}`,
      period: cycleLabel(r.year, r.month, startDay),
      source: r.file_name ? 'uploaded' : 'generated',
    })));
  } catch (e) { next(e); }
});

// GET /api/documents/salary-slips/:id/pdf — uploaded file if present, else generated PDF
router.get('/salary-slips/:id/pdf', async (req, res, next) => {
  try {
    const slip = await tqOne(req.s, `
      SELECT s.*, e.emp_code, (e.first_name || ' ' || e.last_name) AS name, e.email, e.doj,
             d.name AS department, g.title AS designation, e.pan_no, e.bank_name, e.bank_account_no, e.bank_ifsc
      FROM {s}.salary_slips s
      JOIN {s}.employees e ON e.id = s.employee_id
      LEFT JOIN {s}.departments d ON d.id = e.department_id
      LEFT JOIN {s}.designations g ON g.id = e.designation_id
      WHERE s.id=$1`, [req.params.id]);
    if (!slip) return res.status(404).json({ error: 'Salary slip not found' });
    if (slip.employee_id !== req.user.employeeId && !req.perms.has('documents.manage')) {
      return res.status(403).json({ error: 'Not allowed' });
    }

    const fileLabel = `salary-slip-${slip.emp_code}-${slip.year}-${String(slip.month).padStart(2, '0')}.pdf`;
    audit(req, 'SALARY_SLIP_DOWNLOADED', `Slip #${slip.id} (${slip.emp_code} ${slip.month}/${slip.year})`);

    // uploaded PDF takes precedence
    if (slip.file_name) {
      const file = filePath(req.company.slug, 'slips', slip.file_name);
      if (!file) return res.status(404).json({ error: 'File missing on server' });
      return sendUserFile(res, file, fileLabel);
    }
    if (slip.net_pay === null) return res.status(400).json({ error: 'This slip has neither amounts nor an uploaded PDF' });

    const gross = slip.basic + slip.hra + slip.special_allowance + slip.conveyance;
    const deductions = slip.pf_deduction + slip.tax_deduction + (slip.lop_deduction || 0);
    // Resolved before the document starts: once PDFKit is streaming, an await
    // in the middle of the layout is a needless gap.
    const slipPeriod = cycleLabel(slip.year, slip.month, await getCycleStartDay(req.s));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileLabel}"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // Validure Logo at top right, bounded so it does not overlap the line
    try {
      doc.image(path.join(__dirname, '../assets/validure_logo.png'), 440, 35, { fit: [120, 45], align: 'right' });
    } catch (err) {
      // ignore missing logo gracefully
    }

    doc.fontSize(24).font('Helvetica-Bold').text('ValidureHR');
    doc.fontSize(10).font('Helvetica').fillColor('#555').text(`${req.company.name}  |  ValidureHR`);
    doc.moveDown(0.4);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor('#333').stroke();
    doc.moveDown(0.8);
    doc.fillColor('#000').fontSize(16).font('Helvetica-Bold')
      .text(`Salary Slip - ${MONTHS[slip.month - 1]} ${slip.year}`, { align: 'center' });
    /*
     * The dates the slip actually covers, under the month name. A payslip
     * headed "August" that pays 25 Jul - 24 Aug is the single most common
     * thing an employee queries, and the answer belongs on the document.
     */
    doc.moveDown(0.2);
    doc.fontSize(9).font('Helvetica').fillColor('#555')
      .text(`Period: ${slipPeriod}`, { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(1);

    doc.fontSize(10).font('Helvetica');
    const info = [
      ['Employee Name', slip.name, 'Employee ID', slip.emp_code],
      ['Designation', slip.designation || '-', 'Department', slip.department || '-'],
      ['Email', slip.email, 'Date of Joining', slip.doj],
      ['PAN Number', slip.pan_no || '-', 'Bank Name', slip.bank_name || '-'],
      ['Bank Account', slip.bank_account_no || '-', 'Bank IFSC', slip.bank_ifsc || '-']
    ];
    for (const [l1, v1, l2, v2] of info) {
      const y = doc.y;
      doc.font('Helvetica-Bold').text(l1 + ':', 50, y, { width: 110 });
      doc.font('Helvetica').text(String(v1), 160, y, { width: 160 });
      doc.font('Helvetica-Bold').text(l2 + ':', 330, y, { width: 110 });
      doc.font('Helvetica').text(String(v2), 440, y, { width: 130 });
      doc.moveDown(0.6);
    }
    doc.moveDown(0.8);

    const startY = doc.y;
    const rowH = 22;
    const earnings = [];
    if (slip.basic !== 0) earnings.push(['Basic Salary', slip.basic]);
    if (slip.hra !== 0) earnings.push(['HRA', slip.hra]);
    if (slip.special_allowance !== 0) earnings.push(['Special Allowance', slip.special_allowance]);
    earnings.push(['Conveyance', slip.conveyance]);
    const deds = [['Provident Fund', slip.pf_deduction], ['ESIC', slip.esic_deduction || 0],
      ['Income Tax (TDS)', slip.tax_deduction], ['Loss of Pay (LOP)', slip.lop_deduction || 0]];
    doc.font('Helvetica-Bold').fontSize(11);
    doc.rect(50, startY, 256, rowH).fill('#1e293b');
    doc.rect(306, startY, 256, rowH).fill('#1e293b');
    doc.fillColor('#fff').text('EARNINGS', 60, startY + 6).text('DEDUCTIONS', 316, startY + 6);
    doc.fillColor('#000').font('Helvetica').fontSize(10);
    const maxRows = Math.max(earnings.length, deds.length);
    for (let i = 0; i < maxRows; i++) {
      const y = startY + rowH * (i + 1);
      doc.rect(50, y, 256, rowH).stroke('#cbd5e1');
      doc.rect(306, y, 256, rowH).stroke('#cbd5e1');
      if (earnings[i]) {
        doc.text(earnings[i][0], 60, y + 6, { width: 140 });
        doc.text(inr(earnings[i][1]), 200, y + 6, { width: 100, align: 'right' });
      }
      if (deds[i]) {
        doc.text(deds[i][0], 316, y + 6, { width: 140 });
        doc.text(inr(deds[i][1]), 456, y + 6, { width: 100, align: 'right' });
      }
    }
    const totY = startY + rowH * (maxRows + 1);
    doc.rect(50, totY, 256, rowH).fillAndStroke('#f1f5f9', '#cbd5e1');
    doc.rect(306, totY, 256, rowH).fillAndStroke('#f1f5f9', '#cbd5e1');
    doc.fillColor('#000').font('Helvetica-Bold');
    doc.text('Gross Earnings', 60, totY + 6, { width: 140 });
    doc.text(inr(gross), 200, totY + 6, { width: 100, align: 'right' });
    doc.text('Total Deductions', 316, totY + 6, { width: 140 });
    doc.text(inr(deductions), 456, totY + 6, { width: 100, align: 'right' });
    doc.fontSize(13).text(`NET PAY: ${inr(slip.net_pay)}`, 50, totY + rowH + 20);
    doc.fontSize(9).font('Helvetica').fillColor('#666')
      .text('This is a computer generated salary slip and does not require a signature.', 50, totY + rowH + 50);
    doc.end();
  } catch (e) { next(e); }
});

// POST /api/documents/salary-slips — create a slip from amounts (generated PDF)
router.post('/salary-slips', requirePerm('documents.manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const required = ['employee_id', 'month', 'year', 'basic', 'hra', 'special_allowance', 'conveyance', 'pf_deduction', 'tax_deduction'];
    for (const f of required) if (b[f] === undefined || b[f] === '') return res.status(400).json({ error: `${f} is required` });
    const net = ['basic', 'hra', 'special_allowance', 'conveyance'].reduce((s, k) => s + Number(b[k]), 0)
      - Number(b.pf_deduction) - Number(b.tax_deduction) - Number(b.lop_deduction || 0)
      - Number(b.esic_deduction || 0);
    try {
    /*
     * Statutory identifiers are only ever WRITTEN here, never cleared. The
     * caller is a payslip generator: an omitted or blank field means "I do not
     * have this", not "delete it". The previous version passed `|| null` for
     * each, so generating a slip for one of the fifteen employees with no
     * salary_structures row erased their PAN and bank account — the very
     * columns the bank-transfer export reads.
     *
     * COALESCE keeps the stored value whenever the incoming one is blank, so
     * the update is a no-op unless something real was supplied.
     */
    const blankToNull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
    const pan = blankToNull(b.pan_no);
    const bankName = blankToNull(b.bank_name);
    const bankAcc = blankToNull(b.bank_account_no);
    const bankIfsc = blankToNull(b.bank_ifsc);
    if (pan || bankName || bankAcc || bankIfsc) {
      await tq(req.s, `UPDATE {s}.employees SET
        pan_no = COALESCE($1, pan_no), bank_name = COALESCE($2, bank_name),
        bank_account_no = COALESCE($3, bank_account_no), bank_ifsc = COALESCE($4, bank_ifsc)
        WHERE id = $5`,
        [pan, bankName, bankAcc, bankIfsc, b.employee_id]);
    }

      const inserted = await tqOne(req.s, `
        INSERT INTO {s}.salary_slips
          (employee_id, month, year, basic, hra, special_allowance, conveyance, pf_deduction, tax_deduction, lop_deduction, esic_deduction, net_pay)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [b.employee_id, b.month, b.year, b.basic, b.hra, b.special_allowance, b.conveyance, b.pf_deduction, b.tax_deduction, b.lop_deduction || 0, b.esic_deduction || 0, net]);
      audit(req, 'SALARY_SLIP_GENERATED', `Slip for employee #${b.employee_id} (${b.month}/${b.year})`);
      res.status(201).json({ message: 'Salary slip generated', id: inserted.id });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A slip for that employee/month already exists' });
      throw err;
    }
  } catch (e) { next(e); }
});

// POST /api/documents/salary-slips/upload — upload a ready-made PDF slip (multipart)
router.post('/salary-slips/upload', requirePerm('documents.manage'), slipUpload.single('file'), async (req, res, next) => {
  try {
    const { employee_id, month, year } = req.body || {};
    if (!employee_id || !month || !year || !req.file) {
      return res.status(400).json({ error: 'Employee, month, year and a PDF file are required' });
    }
    // upsert: replace the file if a slip already exists for that period
    const existing = await tqOne(req.s,
      'SELECT id FROM {s}.salary_slips WHERE employee_id=$1 AND month=$2 AND year=$3', [employee_id, month, year]);
    if (existing) {
      await tq(req.s, `UPDATE {s}.salary_slips SET file_name=$1, generated_at=to_char(now(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$2`,
        [req.file.filename, existing.id]);
    } else {
      await tq(req.s, `INSERT INTO {s}.salary_slips (employee_id, month, year, file_name) VALUES ($1,$2,$3,$4)`,
        [employee_id, month, year, req.file.filename]);
    }
    audit(req, 'SALARY_SLIP_UPLOADED', `Uploaded PDF slip for employee #${employee_id} (${month}/${year})`);
    res.status(201).json({ message: existing ? 'Slip PDF replaced' : 'Salary slip PDF uploaded' });
  } catch (e) { next(e); }
});

// DELETE /api/documents/salary-slips/:id
router.delete('/salary-slips/:id', requirePerm('documents.manage'), async (req, res, next) => {
  try {
    const result = await tq(req.s, 'DELETE FROM {s}.salary_slips WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.length) return res.status(404).json({ error: 'Salary slip not found' });
    audit(req, 'SALARY_SLIP_DELETED', `Slip #${req.params.id} deleted`);
    res.json({ message: 'Salary slip deleted' });
  } catch (e) { next(e); }
});

// ---------- Policies ----------

router.get('/policies', async (req, res, next) => {
  try { res.json(await tq(req.s, 'SELECT * FROM {s}.policies ORDER BY title')); } catch (e) { next(e); }
});

router.get('/policies/:id/file', async (req, res, next) => {
  try {
    const p = await tqOne(req.s, 'SELECT * FROM {s}.policies WHERE id=$1', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Policy not found' });
    const file = filePath(req.company.slug, 'policies', p.file_name);
    if (!file) return res.status(404).json({ error: 'File missing on server' });
    audit(req, 'POLICY_DOWNLOADED', p.title);
    sendUserFile(res, file, `${p.title.replace(/[^a-zA-Z0-9 ]/g, '')}${path.extname(file)}`);
  } catch (e) { next(e); }
});

router.post('/policies', requirePerm('documents.manage'), policyUpload.single('file'), async (req, res, next) => {
  try {
    const { title, category, description, replace_id } = req.body || {};
    if (!title || !category) return res.status(400).json({ error: 'Title and category are required' });
    if (!req.file && !replace_id) return res.status(400).json({ error: 'A PDF file is required' });

    if (replace_id) {
      const p = await tqOne(req.s, 'SELECT * FROM {s}.policies WHERE id=$1', [replace_id]);
      if (!p) return res.status(404).json({ error: 'Policy not found' });
      const fileName = req.file ? req.file.filename : p.file_name;
      await tq(req.s, `UPDATE {s}.policies SET title=$1, category=$2, description=$3, file_name=$4,
        uploaded_at=to_char(now(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$5`,
        [title, category, description || p.description, fileName, replace_id]);
      audit(req, 'POLICY_REPLACED', `Replaced policy: ${title}`);
      return res.json({ message: 'Policy updated' });
    }
    await tq(req.s, 'INSERT INTO {s}.policies (title, category, description, file_name) VALUES ($1,$2,$3,$4)',
      [title, category, description || null, req.file.filename]);
    audit(req, 'POLICY_UPLOADED', `Uploaded policy: ${title}`);
    res.status(201).json({ message: 'Policy uploaded' });
  } catch (e) { next(e); }
});

router.delete('/policies/:id', requirePerm('documents.manage'), async (req, res, next) => {
  try {
    const p = await tqOne(req.s, 'SELECT * FROM {s}.policies WHERE id=$1', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Policy not found' });
    await tq(req.s, 'DELETE FROM {s}.policies WHERE id=$1', [p.id]);
    audit(req, 'POLICY_DELETED', `Deleted policy: ${p.title}`);
    res.json({ message: 'Policy deleted' });
  } catch (e) { next(e); }
});

// ---------- Offer letters ----------

router.get('/offer-letters', async (req, res, next) => {
  try {
    if (req.perms.has('documents.manage')) {
      const { employee_id } = req.query;
      let sql = `SELECT o.*, e.emp_code, (e.first_name || ' ' || e.last_name) AS employee_name
                 FROM {s}.offer_letters o JOIN {s}.employees e ON e.id=o.employee_id`;
      const args = [];
      if (employee_id) { sql += ' WHERE o.employee_id=$1'; args.push(employee_id); }
      return res.json(await tq(req.s, sql + ' ORDER BY e.emp_code, o.uploaded_at DESC', args));
    }
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    res.json(await tq(req.s, 'SELECT * FROM {s}.offer_letters WHERE employee_id=$1 ORDER BY uploaded_at DESC', [empId]));
  } catch (e) { next(e); }
});

router.get('/offer-letters/:id/file', async (req, res, next) => {
  try {
    const o = await tqOne(req.s, 'SELECT * FROM {s}.offer_letters WHERE id=$1', [req.params.id]);
    if (!o) return res.status(404).json({ error: 'Offer letter not found' });
    if (o.employee_id !== req.user.employeeId && !req.perms.has('documents.manage')) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const file = filePath(req.company.slug, 'offers', o.file_name);
    if (!file) return res.status(404).json({ error: 'File missing on server' });
    audit(req, 'OFFER_LETTER_DOWNLOADED', o.title);
    sendUserFile(res, file, `${o.title.replace(/[^a-zA-Z0-9 -]/g, '')}${path.extname(file)}`);
  } catch (e) { next(e); }
});

router.post('/offer-letters', requirePerm('documents.manage'), offerUpload.single('file'), async (req, res, next) => {
  try {
    const { employee_id, title, is_revised } = req.body || {};
    if (!employee_id || !req.file) return res.status(400).json({ error: 'Employee and PDF file are required' });
    const e = await tqOne(req.s, 'SELECT * FROM {s}.employees WHERE id=$1', [employee_id]);
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    await tq(req.s, 'INSERT INTO {s}.offer_letters (employee_id, title, file_name, is_revised) VALUES ($1,$2,$3,$4)',
      [employee_id, title || `Offer Letter - ${e.emp_code}${is_revised === 'true' ? ' (Revised)' : ''}`,
        req.file.filename, is_revised === 'true']);
    audit(req, 'OFFER_LETTER_UPLOADED', `Offer letter for ${e.emp_code}`);
    res.status(201).json({ message: 'Offer letter uploaded' });
  } catch (e) { next(e); }
});

router.delete('/offer-letters/:id', requirePerm('documents.manage'), async (req, res, next) => {
  try {
    const o = await tqOne(req.s, 'SELECT * FROM {s}.offer_letters WHERE id=$1', [req.params.id]);
    if (!o) return res.status(404).json({ error: 'Offer letter not found' });
    await tq(req.s, 'DELETE FROM {s}.offer_letters WHERE id=$1', [o.id]);
    audit(req, 'OFFER_LETTER_DELETED', `Deleted: ${o.title}`);
    res.json({ message: 'Offer letter deleted' });
  } catch (e) { next(e); }
});

module.exports = router;
