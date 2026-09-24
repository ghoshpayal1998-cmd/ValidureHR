const express = require('express');
const { tq, tqOne } = require('../db');
const { authenticate, tenant, requirePerm } = require('../middleware/auth');
const audit = require('../audit');
/*
 * Payroll runs on the company's CYCLE, not the calendar month — the same
 * 25th-to-24th window attendance, leave accrual and the salary slip already
 * use. This module was written before that change landed and counted
 * 'YYYY-MM%' days instead, which pays people for the wrong 30 days: with a
 * 25th start, "September" collected 1–30 Sep when the payroll period is
 * 25 Aug – 24 Sep. Every date filter here goes through cycle.js so all the
 * screens keep agreeing about what one month is.
 */
const { getCycleStartDay, cycleRange, cycleDates, cycleLabel } = require('../cycle');

const router = express.Router();
router.use(authenticate, tenant);

router.get('/structures', requirePerm('payroll.manage'), async (req, res, next) => {
  try {
    const q = `
      SELECT 
        e.id as employee_id, e.emp_code, e.first_name, e.last_name, 
        d.name as department, g.title as designation,
        COALESCE(s.basic, 0) as basic, 
        COALESCE(s.hra, 0) as hra, 
        COALESCE(s.special_allowance, 0) as special_allowance,
        COALESCE(s.conveyance, 1600) as conveyance,
        COALESCE(s.pf_deduction, 0) as pf_deduction,
        COALESCE(s.esic_deduction, 0) as esic_deduction,
        COALESCE(s.tax_deduction, 0) as tax_deduction,
        COALESCE(s.bank_name, e.bank_name) AS bank_name,
        COALESCE(s.bank_account_no, e.bank_account_no) AS bank_account_no,
        COALESCE(s.bank_ifsc, e.bank_ifsc) AS bank_ifsc,
        COALESCE(s.pan_no, e.pan_no) AS pan_no
      FROM {s}.employees e
      LEFT JOIN {s}.departments d ON d.id = e.department_id
      LEFT JOIN {s}.designations g ON g.id = e.designation_id
      LEFT JOIN {s}.salary_structures s ON s.employee_id = e.id
      WHERE e.status='Active'
      ORDER BY e.first_name, e.last_name
    `;
    const rows = await tq(req.s, q);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.put('/structures/:id', requirePerm('payroll.manage'), async (req, res, next) => {
  try {
    const eid = parseInt(req.params.id, 10);
    const { basic, hra, special_allowance, conveyance, pf_deduction, esic_deduction, tax_deduction, bank_name, bank_account_no, bank_ifsc, pan_no } = req.body;
    
    // A blank or absent ESIC means "I am not changing it", not "set it to 0".
    const esicOrKeep = (esic_deduction === undefined || esic_deduction === null || esic_deduction === '')
      ? null : Number(esic_deduction);

    // UPSERT
    const existing = await tqOne(req.s, `SELECT employee_id FROM {s}.salary_structures WHERE employee_id=$1`, [eid]);
    if (existing) {
      await tq(req.s, `
        UPDATE {s}.salary_structures SET 
          basic=$1, hra=$2, special_allowance=$3, conveyance=$4, pf_deduction=$5, tax_deduction=$6,
          bank_name=$7, bank_account_no=$8, bank_ifsc=$9, pan_no=$10, updated_at=CURRENT_TIMESTAMP,
          esic_deduction=COALESCE($12::numeric, esic_deduction)
        WHERE employee_id=$11
      `, [basic, hra, special_allowance, conveyance, pf_deduction, tax_deduction, bank_name, bank_account_no, bank_ifsc, pan_no, eid, esicOrKeep]);
    } else {
      await tq(req.s, `
        INSERT INTO {s}.salary_structures 
          (employee_id, basic, hra, special_allowance, conveyance, pf_deduction, tax_deduction, bank_name, bank_account_no, bank_ifsc, pan_no, esic_deduction)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [eid, basic, hra, special_allowance, conveyance, pf_deduction, tax_deduction, bank_name, bank_account_no, bank_ifsc, pan_no, esicOrKeep || 0]);
    }
    // Salary and bank details are the most sensitive fields in the system and
    // this was the only writer of them with no audit entry.
    audit(req, 'SALARY_STRUCTURE_UPDATED', `Salary structure updated for employee #${eid}`);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.get('/lop/:year/:month', requirePerm('documents.manage'), async (req, res, next) => {
  try {
    const y = parseInt(req.params.year, 10);
    const m = parseInt(req.params.month, 10);
    const startDay = await getCycleStartDay(req.s);
    const { from, to } = cycleRange(y, m, startDay);

    const rows = await tq(req.s, `
      SELECT employee_id, 
        SUM(CASE WHEN status IN ('Absent', 'LOP') THEN 1 WHEN status='Half Day' THEN 0.5 ELSE 0 END) as lop_days,
        SUM(CASE WHEN status='EL' THEN 1 ELSE 0 END) as el_days,
        SUM(CASE WHEN status='SL' THEN 1 ELSE 0 END) as sl_days,
        SUM(CASE WHEN status='WFH' THEN 1 ELSE 0 END) as wfh_days
      FROM {s}.attendance 
      WHERE date BETWEEN $1 AND $2
      GROUP BY employee_id
    `, [from, to]);
    
    res.json({
      /*
       * The window these counts were taken over. The Run Payroll screen divides
       * monthly pay by `days` to price one LOP day; it used a hardcoded 30,
       * which disagreed with the salary sheet below for every cycle that is not
       * 30 days long — the same absence was worth two different amounts
       * depending on which one you read.
       */
      period: {
        from,
        to,
        days: cycleDates(y, m, startDay).length,
        label: cycleLabel(y, m, startDay),
      },
      rows,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/export/:year/:month', requirePerm('payroll.manage'), async (req, res, next) => {
  try {
    const { year, month } = req.params;
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const startDay = await getCycleStartDay(req.s);
    const { from, to } = cycleRange(y, m, startDay);
    // The cycle's actual days. Its length is NOT the calendar month's: a
    // 25th-to-24th September runs 31 days, and per-day pay divides by this.
    const dates = cycleDates(y, m, startDay);

    const employees = await tq(req.s, `
      SELECT 
        e.id, e.first_name, e.last_name, e.doj,
        g.title as designation,
        COALESCE(s.basic, 0) as basic, 
        COALESCE(s.hra, 0) as hra, 
        COALESCE(s.special_allowance, 0) as special_allowance,
        COALESCE(s.conveyance, 1600) as conveyance,
        COALESCE(s.bank_name, e.bank_name) AS bank_name,
        COALESCE(s.bank_account_no, e.bank_account_no) AS bank_account_no,
        COALESCE(s.bank_ifsc, e.bank_ifsc) AS bank_ifsc
      FROM {s}.employees e
      LEFT JOIN {s}.designations g ON g.id = e.designation_id
      LEFT JOIN {s}.salary_structures s ON s.employee_id = e.id
      WHERE e.status='Active'
      ORDER BY e.first_name, e.last_name
    `);

    const attData = await tq(req.s, `SELECT employee_id, date, status FROM {s}.attendance WHERE date BETWEEN $1 AND $2`, [from, to]);
    const attByEmpDate = {};
    for (const a of attData) {
      if (!attByEmpDate[a.employee_id]) attByEmpDate[a.employee_id] = {};
      attByEmpDate[a.employee_id][a.date] = a.status;
    }

    const holData = await tq(req.s, `SELECT date, name FROM {s}.holidays WHERE date BETWEEN $1 AND $2`, [from, to]);
    const holByDate = {};
    for (const h of holData) holByDate[h.date] = h.name;

    const row1 = ['Sl. No', 'Name', 'Designation', 'DOJ (DD/MM/YY)'];
    const row2 = ['', '', '', ''];

    for (const ds of dates) {
      const [dy, dm, dd] = ds.split('-').map(Number);
      const dateObj = new Date(dy, dm - 1, dd);
      const dow = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      row1.push(dow);
      row2.push(`${dm}/${dd}/${dy}`);
    }

    const trailingHeaders = [
      'Total No. Of days', 'Present Days', 'Absent Days', 'Days to be processed for Salary',
      'Annual Salary', 'Monthly Salary', 'Per Day', 'Salary Amount to be processed',
      'Remarks', 'Bank name', 'Account no', 'IFSC'
    ];
    row1.push(...trailingHeaders);
    row2.push(...Array(trailingHeaders.length).fill(''));

    const csvRows = [
      row1.map(c => `"${c}"`).join(','),
      row2.map(c => `"${c}"`).join(',')
    ];

    let slNo = 1;
    for (const emp of employees) {
      let dojFormatted = '';
      if (emp.doj) {
        const parts = emp.doj.split('-');
        if (parts.length === 3) dojFormatted = `${parts[2]}/${parts[1]}/${parts[0].slice(-2)}`;
      }

      const row = [
        slNo++,
        `${emp.first_name} ${emp.last_name}`,
        emp.designation || '',
        dojFormatted
      ];

      let presentCount = 0;
      let absentCount = 0;
      let halfDayCount = 0;

      for (const ds of dates) {
        const [dy, dm, dd] = ds.split('-').map(Number);
        const dateObj = new Date(dy, dm - 1, dd);
        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
        const isHoliday = !!holByDate[ds];
        
        let status = '';
        if (attByEmpDate[emp.id] && attByEmpDate[emp.id][ds]) {
          status = attByEmpDate[emp.id][ds];
        } else if (isHoliday) {
          status = 'Holiday';
        } else if (isWeekend) {
          status = 'Weekend';
        }

        if (status === 'Present' || status === 'WFH') presentCount++;
        else if (status === 'Absent' || status === 'LOP') absentCount++;
        else if (status === 'Half Day') { halfDayCount++; presentCount += 0.5; }
        else if (status === 'Leave' || status === 'EL' || status === 'SL') presentCount++;
        else if (status === 'Holiday' || status === 'Weekend') presentCount++;

        row.push(status || '');
      }

      const totalDays = dates.length;
      const totalAbsents = absentCount + (halfDayCount * 0.5);
      const processedDays = totalDays - totalAbsents;
      const monthlySalary = emp.basic + emp.hra + emp.special_allowance + emp.conveyance;
      const annualSalary = monthlySalary * 12;
      const perDay = monthlySalary / totalDays;
      const salaryProcessed = perDay * processedDays;

      row.push(
        totalDays,
        presentCount,
        totalAbsents,
        processedDays,
        annualSalary,
        monthlySalary,
        Math.round(perDay * 100) / 100,
        Math.round(salaryProcessed),
        '', 
        emp.bank_name || '',
        emp.bank_account_no || '',
        emp.bank_ifsc || ''
      );

      csvRows.push(row.map(c => typeof c === 'string' ? `"${c.replace(/"/g, '""')}"` : c).join(','));
    }

    audit(req, 'PAYROLL_EXPORTED',
      `Exported payroll sheet with salary and bank details for ${y}-${String(m).padStart(2, '0')} (${from} to ${to})`);
    res.setHeader('Content-Type', 'text/csv');
    // The period is in the filename, not a banner row above the header — a
    // sheet whose first line is not the column names breaks every consumer.
    res.setHeader('Content-Disposition',
      `attachment; filename="payroll-${y}-${String(m).padStart(2, '0')}_${from}_to_${to}.csv"`);
    res.send(csvRows.join('\n'));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
