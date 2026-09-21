/* ============================================================
   ValidureHR — sample data
   Everything the mockup renders comes from here. It is shaped
   like the real F1HR payloads so swapping in a live API later
   is a fetch() change, not a re-write of the screens.
   ============================================================ */
window.VHR_DATA = (function () {
  'use strict';

  var me = {
    name: 'Ananya Iyer',
    code: 'VS-0142',
    role: 'Employee',
    designation: 'Senior Software Engineer',
    department: 'Engineering',
    company: 'Validure Solutions Pvt. Ltd.',
    email: 'ananya.iyer@validuresolutions.com',
    phone: '+91 98450 22178',
    joined: '2023-04-17',
    manager: 'Vikram Rao',
    location: 'Bengaluru',
    shift: '19:00 – 04:00 IST',
    bank: 'HDFC Bank ••••4471',
    pan: 'AYQPI••••K',
    uan: '1012••••3388'
  };

  /* 24 employees — enough to make tables, filters and pagination
     look real without padding the file to no purpose. */
  var names = [
    ['Ananya', 'Iyer', 'Senior Software Engineer', 'Engineering', 'F'],
    ['Vikram', 'Rao', 'Engineering Manager', 'Engineering', 'M'],
    ['Priya', 'Sharma', 'QA Lead', 'Quality', 'F'],
    ['Rohan', 'Mehta', 'DevOps Engineer', 'Infrastructure', 'M'],
    ['Sneha', 'Nair', 'HR Manager', 'People', 'F'],
    ['Arjun', 'Kulkarni', 'Full Stack Developer', 'Engineering', 'M'],
    ['Kavya', 'Reddy', 'UI/UX Designer', 'Design', 'F'],
    ['Siddharth', 'Joshi', 'Data Engineer', 'Data', 'M'],
    ['Meera', 'Krishnan', 'Business Analyst', 'Delivery', 'F'],
    ['Aditya', 'Verma', 'Cloud Architect', 'Infrastructure', 'M'],
    ['Divya', 'Menon', 'Software Engineer', 'Engineering', 'F'],
    ['Karthik', 'Subramanian', 'Tech Lead', 'Engineering', 'M'],
    ['Ishita', 'Bose', 'Content Strategist', 'Marketing', 'F'],
    ['Nikhil', 'Agarwal', 'Software Engineer', 'Engineering', 'M'],
    ['Pooja', 'Desai', 'Finance Executive', 'Finance', 'F'],
    ['Rahul', 'Chatterjee', 'Solution Architect', 'Delivery', 'M'],
    ['Tanvi', 'Shah', 'QA Engineer', 'Quality', 'F'],
    ['Manish', 'Gupta', 'Sales Manager', 'Sales', 'M'],
    ['Lakshmi', 'Pillai', 'Talent Acquisition', 'People', 'F'],
    ['Gaurav', 'Singh', 'Mobile Developer', 'Engineering', 'M'],
    ['Riya', 'Malhotra', 'Product Manager', 'Product', 'F'],
    ['Abhishek', 'Pandey', 'Support Engineer', 'Support', 'M'],
    ['Shruti', 'Kapoor', 'Marketing Executive', 'Marketing', 'F'],
    ['Deepak', 'Nambiar', 'Database Administrator', 'Data', 'M']
  ];

  var salaries = [
    1450000, 2600000, 1380000, 1250000, 1520000, 1180000, 1050000, 1320000,
    980000, 2350000, 860000, 1980000, 820000, 840000, 760000, 2180000,
    720000, 1640000, 690000, 1120000, 1880000, 640000, 620000, 1160000
  ];

  var joinDates = [
    '2023-04-17', '2021-02-08', '2022-07-11', '2023-01-23', '2020-11-02',
    '2023-09-04', '2024-02-19', '2022-10-10', '2024-06-03', '2021-05-17',
    '2025-01-13', '2020-08-24', '2024-08-12', '2024-11-18', '2023-06-05',
    '2021-09-06', '2025-03-10', '2022-03-28', '2024-04-15', '2023-11-20',
    '2022-01-17', '2025-05-26', '2025-02-03', '2022-12-12'
  ];

  var employees = names.map(function (n, i) {
    var statuses = ['Active', 'Active', 'Active', 'Active', 'Active', 'Probation', 'Active', 'Notice'];
    return {
      id: i + 1,
      code: 'VS-' + String(101 + i * 3).padStart(4, '0'),
      first: n[0], last: n[1],
      name: n[0] + ' ' + n[1],
      designation: n[2],
      department: n[3],
      email: (n[0] + '.' + n[1]).toLowerCase() + '@validuresolutions.com',
      phone: '+91 9' + String(8000000000 + i * 3717219).slice(1, 10),
      joined: joinDates[i],
      status: i === 5 || i === 22 ? 'Probation' : i === 17 ? 'Notice' : 'Active',
      ctc: salaries[i],
      location: ['Bengaluru', 'Pune', 'Hyderabad', 'Kolkata'][i % 4],
      manager: i === 1 ? '—' : names[[1, 11, 15, 4][i % 4]][0] + ' ' + names[[1, 11, 15, 4][i % 4]][1],
      type: i % 9 === 0 ? 'Contract' : 'Full-time'
    };
  });

  /* ---------------------------------------------------------- leave */
  var leaveTypes = [
    { code: 'CL', name: 'Casual Leave', entitled: 12, used: 5, color: 'info' },
    { code: 'SL', name: 'Sick Leave', entitled: 12, used: 3, color: 'warn' },
    { code: 'EL', name: 'Earned Leave', entitled: 18, used: 6.5, color: 'ok' },
    { code: 'LOP', name: 'Loss of Pay', entitled: 0, used: 1, color: 'err' },
    { code: 'ML', name: 'Maternity Leave', entitled: 182, used: 0, color: 'neutral' },
    { code: 'CO', name: 'Comp Off', entitled: 4, used: 2, color: 'info' }
  ];

  var leaveRequests = [
    { id: 4821, emp: 'Arjun Kulkarni', code: 'VS-0116', type: 'Casual Leave', from: '2026-09-24', to: '2026-09-25', days: 2, reason: 'Family function in Mysuru', status: 'Pending', applied: '2026-09-18', approver: 'Vikram Rao' },
    { id: 4820, emp: 'Kavya Reddy', code: 'VS-0119', type: 'Sick Leave', from: '2026-09-22', to: '2026-09-22', days: 1, reason: 'Fever, doctor advised rest', status: 'Pending', applied: '2026-09-21', approver: 'Vikram Rao' },
    { id: 4819, emp: 'Divya Menon', code: 'VS-0131', type: 'Earned Leave', from: '2026-10-06', to: '2026-10-10', days: 5, reason: 'Pre-planned vacation — Kerala', status: 'Pending', applied: '2026-09-15', approver: 'Karthik Subramanian' },
    { id: 4818, emp: 'Ananya Iyer', code: 'VS-0142', type: 'Casual Leave', from: '2026-09-11', to: '2026-09-11', days: 1, reason: 'Personal work', status: 'Approved', applied: '2026-09-08', approver: 'Vikram Rao' },
    { id: 4817, emp: 'Nikhil Agarwal', code: 'VS-0140', type: 'Sick Leave', from: '2026-09-08', to: '2026-09-09', days: 2, reason: 'Viral infection', status: 'Approved', applied: '2026-09-08', approver: 'Karthik Subramanian' },
    { id: 4816, emp: 'Tanvi Shah', code: 'VS-0149', type: 'Earned Leave', from: '2026-09-01', to: '2026-09-03', days: 3, reason: 'Sister\'s wedding', status: 'Approved', applied: '2026-08-20', approver: 'Priya Sharma' },
    { id: 4815, emp: 'Gaurav Singh', code: 'VS-0158', type: 'Casual Leave', from: '2026-08-28', to: '2026-08-28', days: 1, reason: 'Bank work', status: 'Rejected', applied: '2026-08-27', approver: 'Vikram Rao', note: 'Sprint release day — please re-apply for next week.' },
    { id: 4814, emp: 'Meera Krishnan', code: 'VS-0125', type: 'Comp Off', from: '2026-08-21', to: '2026-08-21', days: 1, reason: 'Worked Sunday 16 Aug for the UAT window', status: 'Approved', applied: '2026-08-18', approver: 'Rahul Chatterjee' },
    { id: 4813, emp: 'Ananya Iyer', code: 'VS-0142', type: 'Earned Leave', from: '2026-07-14', to: '2026-07-18', days: 5, reason: 'Annual holiday', status: 'Approved', applied: '2026-06-30', approver: 'Vikram Rao' },
    { id: 4812, emp: 'Ananya Iyer', code: 'VS-0142', type: 'Sick Leave', from: '2026-06-03', to: '2026-06-04', days: 2, reason: 'Food poisoning', status: 'Approved', applied: '2026-06-03', approver: 'Vikram Rao' },
    { id: 4811, emp: 'Ananya Iyer', code: 'VS-0142', type: 'Loss of Pay', from: '2026-05-19', to: '2026-05-19', days: 1, reason: 'Balance exhausted — personal emergency', status: 'Approved', applied: '2026-05-18', approver: 'Vikram Rao' },
    { id: 4810, emp: 'Ananya Iyer', code: 'VS-0142', type: 'Casual Leave', from: '2026-04-02', to: '2026-04-03', days: 2, reason: 'Visiting parents', status: 'Approved', applied: '2026-03-28', approver: 'Vikram Rao' }
  ];

  /* ---------------------------------------------------------- attendance
     Futurn runs a night shift, so a "day" starts at 19:00 and the
     punch-out lands after midnight. The calendar keys on the
     shift's start date, never on the raw timestamp. */
  var attendance = (function () {
    var out = [], d;
    var pattern = ['P','P','P','P','P','W','W','P','P','P','P','P','W','W','P','L','P','P','P','W','W','P','P','P','H','P','W','W','P','P'];
    for (var i = 0; i < 30; i++) {
      var day = i + 1;
      var st = pattern[i];
      d = '2026-09-' + String(day).padStart(2, '0');
      if (day > 21) { out.push({ date: d, status: 'Future' }); continue; }
      out.push({
        date: d,
        status: st === 'P' ? 'Present' : st === 'W' ? 'Weekend' : st === 'L' ? 'Leave' : 'Holiday',
        inTime: st === 'P' ? (i % 4 === 0 ? '19:06' : i % 3 === 0 ? '18:58' : '19:02') : null,
        outTime: st === 'P' ? (i % 5 === 0 ? '04:12' : '04:03') : null,
        hours: st === 'P' ? (i % 5 === 0 ? 9.1 : 9.0) : 0,
        late: st === 'P' && i % 7 === 3,
        device: st === 'P' ? 'BIOMAX-BLR-01' : null
      });
    }
    return out;
  })();

  var holidays = [
    { date: '2026-01-26', name: 'Republic Day', type: 'National' },
    { date: '2026-03-04', name: 'Holi', type: 'Festival' },
    { date: '2026-04-14', name: 'Dr. Ambedkar Jayanti', type: 'National' },
    { date: '2026-05-01', name: 'Maharashtra Day', type: 'Regional' },
    { date: '2026-08-15', name: 'Independence Day', type: 'National' },
    { date: '2026-09-25', name: 'Ganesh Chaturthi', type: 'Festival' },
    { date: '2026-10-02', name: 'Gandhi Jayanti', type: 'National' },
    { date: '2026-10-20', name: 'Dussehra', type: 'Festival' },
    { date: '2026-11-08', name: 'Diwali', type: 'Festival' },
    { date: '2026-12-25', name: 'Christmas', type: 'Festival' }
  ];

  /* ---------------------------------------------------------- payroll */
  var payslips = [
    { month: 'August 2026', period: '2026-08', gross: 120833, net: 103470, lop: 0, status: 'Paid', paidOn: '2026-08-31' },
    { month: 'July 2026', period: '2026-07', gross: 120833, net: 103470, lop: 0, status: 'Paid', paidOn: '2026-07-31' },
    { month: 'June 2026', period: '2026-06', gross: 120833, net: 103470, lop: 0, status: 'Paid', paidOn: '2026-06-30' },
    { month: 'May 2026', period: '2026-05', gross: 120833, net: 99572, lop: 1, status: 'Paid', paidOn: '2026-05-31' },
    { month: 'April 2026', period: '2026-04', gross: 120833, net: 103470, lop: 0, status: 'Paid', paidOn: '2026-04-30' },
    { month: 'March 2026', period: '2026-03', gross: 112500, net: 96840, lop: 0, status: 'Paid', paidOn: '2026-03-31' }
  ];

  var payslipDetail = {
    month: 'August 2026',
    earnings: [
      { head: 'Basic Salary', amount: 48333 },
      { head: 'House Rent Allowance', amount: 24167 },
      { head: 'Special Allowance', amount: 36250 },
      { head: 'Conveyance Allowance', amount: 1600 },
      { head: 'Medical Allowance', amount: 1250 },
      { head: 'Night Shift Allowance', amount: 9233 }
    ],
    deductions: [
      { head: 'Provident Fund (12%)', amount: 5800 },
      { head: 'Professional Tax', amount: 200 },
      { head: 'Income Tax (TDS)', amount: 10363 },
      { head: 'Loss of Pay (0 days)', amount: 0 },
      { head: 'Health Insurance', amount: 1000 }
    ],
    workedDays: 22, paidDays: 22, lopDays: 0
  };

  var payrollRuns = [
    { period: 'September 2026', headcount: 24, gross: 2418750, deductions: 402118, net: 2016632, status: 'Draft', cutoff: '2026-09-25' },
    { period: 'August 2026', headcount: 24, gross: 2418750, deductions: 402118, net: 2016632, status: 'Paid', cutoff: '2026-08-25' },
    { period: 'July 2026', headcount: 23, gross: 2331250, deductions: 387540, net: 1943710, status: 'Paid', cutoff: '2026-07-25' },
    { period: 'June 2026', headcount: 23, gross: 2331250, deductions: 387540, net: 1943710, status: 'Paid', cutoff: '2026-06-25' }
  ];

  /* ---------------------------------------------------------- documents */
  var documents = [
    { name: 'Offer Letter — Ananya Iyer.pdf', type: 'Offer Letter', owner: 'Ananya Iyer', size: '184 KB', uploaded: '2023-04-10', by: 'Sneha Nair' },
    { name: 'Employee Handbook 2026.pdf', type: 'Policy', owner: 'All employees', size: '2.1 MB', uploaded: '2026-01-06', by: 'Sneha Nair' },
    { name: 'Leave Policy v3.pdf', type: 'Policy', owner: 'All employees', size: '412 KB', uploaded: '2026-04-01', by: 'Sneha Nair' },
    { name: 'Code of Conduct.pdf', type: 'Policy', owner: 'All employees', size: '298 KB', uploaded: '2025-11-14', by: 'Sneha Nair' },
    { name: 'IT & Security Policy.pdf', type: 'Policy', owner: 'All employees', size: '520 KB', uploaded: '2026-02-20', by: 'Rohan Mehta' },
    { name: 'POSH Policy.pdf', type: 'Policy', owner: 'All employees', size: '186 KB', uploaded: '2025-09-30', by: 'Sneha Nair' },
    { name: 'Form 16 — FY 2025-26.pdf', type: 'Tax', owner: 'Ananya Iyer', size: '96 KB', uploaded: '2026-06-15', by: 'Pooja Desai' },
    { name: 'Appraisal Letter Apr-2026.pdf', type: 'Letter', owner: 'Ananya Iyer', size: '148 KB', uploaded: '2026-04-01', by: 'Sneha Nair' }
  ];

  var policies = [
    { name: 'Employee Handbook', version: 'v2026.1', updated: '2026-01-06', summary: 'How we work, what we expect, and what you can expect from us.', pages: 34 },
    { name: 'Leave Policy', version: 'v3', updated: '2026-04-01', summary: 'Entitlements, accrual, carry-forward and the approval path.', pages: 9 },
    { name: 'Code of Conduct', version: 'v2', updated: '2025-11-14', summary: 'Professional standards, conflicts of interest and escalation.', pages: 12 },
    { name: 'IT & Security Policy', version: 'v4', updated: '2026-02-20', summary: 'Device handling, access control, and incident reporting.', pages: 16 },
    { name: 'POSH Policy', version: 'v2', updated: '2025-09-30', summary: 'Prevention of sexual harassment — committee, process, redressal.', pages: 11 },
    { name: 'Travel & Reimbursement', version: 'v1.3', updated: '2026-03-12', summary: 'Claim limits, approval chain and settlement timelines.', pages: 7 }
  ];


  /* ---------------------------------------------------------- org */
  var departments = [
    { name: 'Engineering', head: 'Vikram Rao', count: 8 },
    { name: 'Infrastructure', head: 'Aditya Verma', count: 2 },
    { name: 'Quality', head: 'Priya Sharma', count: 2 },
    { name: 'Design', head: 'Kavya Reddy', count: 1 },
    { name: 'Data', head: 'Deepak Nambiar', count: 2 },
    { name: 'Delivery', head: 'Rahul Chatterjee', count: 2 },
    { name: 'People', head: 'Sneha Nair', count: 2 },
    { name: 'Finance', head: 'Pooja Desai', count: 1 },
    { name: 'Marketing', head: 'Ishita Bose', count: 2 },
    { name: 'Sales', head: 'Manish Gupta', count: 1 },
    { name: 'Product', head: 'Riya Malhotra', count: 1 },
    { name: 'Support', head: 'Abhishek Pandey', count: 1 }
  ];

  var designations = [
    'Software Engineer', 'Senior Software Engineer', 'Tech Lead', 'Engineering Manager',
    'QA Engineer', 'QA Lead', 'DevOps Engineer', 'Cloud Architect', 'Solution Architect',
    'Data Engineer', 'Database Administrator', 'UI/UX Designer', 'Product Manager',
    'Business Analyst', 'HR Manager', 'Talent Acquisition', 'Finance Executive',
    'Sales Manager', 'Marketing Executive', 'Content Strategist', 'Support Engineer',
    'Full Stack Developer', 'Mobile Developer'
  ];

  /* Team-mates away in the next fortnight - drives the home page's
     "who is out" card so nobody plans a review for an empty room. */
  var teamLeave = [
    { name: 'Arjun Kulkarni', type: 'Casual Leave', from: '2026-09-24', to: '2026-09-25', status: 'Pending' },
    { name: 'Divya Menon', type: 'Earned Leave', from: '2026-10-06', to: '2026-10-10', status: 'Pending' },
    { name: 'Kavya Reddy', type: 'Sick Leave', from: '2026-09-22', to: '2026-09-22', status: 'Pending' },
    { name: 'Nikhil Agarwal', type: 'Earned Leave', from: '2026-09-29', to: '2026-09-30', status: 'Approved' }
  ];

  var birthdays = [
    { name: 'Priya Sharma', date: '2026-09-23', dept: 'Quality' },
    { name: 'Siddharth Joshi', date: '2026-09-28', dept: 'Data' },
    { name: 'Riya Malhotra', date: '2026-10-04', dept: 'Product' },
    { name: 'Manish Gupta', date: '2026-10-11', dept: 'Sales' }
  ];

  var announcements = [
    { title: 'Ganesh Chaturthi - office closed', body: 'The Bengaluru and Pune offices will be closed on Friday, 25 September. On-call rotation stays as published.', by: 'Sneha Nair', at: '2026-09-14', pinned: true },
    { title: 'Q3 appraisal window opens 1 October', body: 'Self-assessment forms will be shared on 1 October and close on 12 October. Your manager will schedule the review conversation in the week that follows.', by: 'Sneha Nair', at: '2026-09-10', pinned: false },
    { title: 'New VPN gateway', body: 'The Singapore gateway is being retired on 30 September. Please switch your client to the Mumbai endpoint before then - instructions are in the IT & Security Policy.', by: 'Rohan Mehta', at: '2026-09-05', pinned: false },
    { title: 'Referral bonus revised', body: 'The referral bonus for senior engineering roles has been revised to 75,000, payable after the referred employee completes 90 days.', by: 'Lakshmi Pillai', at: '2026-08-28', pinned: false }
  ];

  /* Biometric readers on the floor. The night shift means a punch
     recorded at 03:58 belongs to the PREVIOUS day's shift. */
  var devices = [
    { device: 'BIOMAX-BLR-01', location: 'Bengaluru - Main entrance', mapped: 18, lastSync: '2026-09-21 04:12', status: 'Online' },
    { device: 'BIOMAX-BLR-02', location: 'Bengaluru - 3rd floor', mapped: 4, lastSync: '2026-09-21 04:10', status: 'Online' },
    { device: 'BIOMAX-PUN-01', location: 'Pune - Reception', mapped: 2, lastSync: '2026-09-20 22:47', status: 'Stale' }
  ];

  var deviceMap = [
    { deviceId: '1042', device: 'BIOMAX-BLR-01', employee: 'Ananya Iyer', code: 'VS-0142', since: '2023-04-17' },
    { deviceId: '1043', device: 'BIOMAX-BLR-01', employee: 'Vikram Rao', code: 'VS-0104', since: '2021-02-08' },
    { deviceId: '1044', device: 'BIOMAX-BLR-01', employee: 'Priya Sharma', code: 'VS-0107', since: '2022-07-11' },
    { deviceId: '2011', device: 'BIOMAX-PUN-01', employee: 'Rohan Mehta', code: 'VS-0110', since: '2023-01-23' },
    { deviceId: '-', device: 'Unmapped', employee: 'Shruti Kapoor', code: 'VS-0167', since: '-' }
  ];

  var salaryStructures = [
    { code: 'VS-0142', name: 'Ananya Iyer', ctc: 1450000, basic: 48333, hra: 24167, special: 36250, conveyance: 1600, medical: 1250, shift: 9233, pf: 5800, pt: 200 },
    { code: 'VS-0104', name: 'Vikram Rao', ctc: 2600000, basic: 86667, hra: 43333, special: 65000, conveyance: 1600, medical: 1250, shift: 0, pf: 10400, pt: 200 },
    { code: 'VS-0107', name: 'Priya Sharma', ctc: 1380000, basic: 46000, hra: 23000, special: 34500, conveyance: 1600, medical: 1250, shift: 8800, pf: 5520, pt: 200 },
    { code: 'VS-0110', name: 'Rohan Mehta', ctc: 1250000, basic: 41667, hra: 20833, special: 31250, conveyance: 1600, medical: 1250, shift: 7950, pf: 5000, pt: 200 },
    { code: 'VS-0116', name: 'Arjun Kulkarni', ctc: 1180000, basic: 39333, hra: 19667, special: 29500, conveyance: 1600, medical: 1250, shift: 7500, pf: 4720, pt: 200 },
    { code: 'VS-0119', name: 'Kavya Reddy', ctc: 1050000, basic: 35000, hra: 17500, special: 26250, conveyance: 1600, medical: 1250, shift: 6680, pf: 4200, pt: 200 }
  ];

  var audit = [
    { at: '2026-09-21 20:14', who: 'Sneha Nair', action: 'leave.approve', target: 'Request #4818 - Ananya Iyer', ip: '103.21.58.7' },
    { at: '2026-09-21 19:52', who: 'Sneha Nair', action: 'employee.update', target: 'VS-0167 - Shruti Kapoor', ip: '103.21.58.7' },
    { at: '2026-09-20 23:31', who: 'Pooja Desai', action: 'payroll.draft', target: 'September 2026 run', ip: '103.21.58.19' },
    { at: '2026-09-20 21:08', who: 'system', action: 'attendance.sync', target: 'BIOMAX-BLR-01 - 22 punches', ip: '-' },
    { at: '2026-09-19 20:45', who: 'Rahul Paul', action: 'role.update', target: 'Team Lead - added leaves.approve', ip: '49.36.180.204' },
    { at: '2026-09-19 19:30', who: 'Sneha Nair', action: 'document.upload', target: 'Leave Policy v3.pdf', ip: '103.21.58.7' },
    { at: '2026-09-18 22:19', who: 'system', action: 'email.send', target: 'leave_approval_request to Vikram Rao', ip: '-' },
    { at: '2026-09-18 21:14', who: 'Arjun Kulkarni', action: 'leave.apply', target: 'Request #4821', ip: '157.48.92.11' }
  ];

  /* Today's floor state, for the admin overview and day sheet. */
  var todayAttendance = { present: 19, absent: 1, onLeave: 2, wfh: 2, late: 3, notPunched: 0, total: 24 };

  var attendanceTrend = [
    { month: 'Apr', rate: 95.2 }, { month: 'May', rate: 93.8 }, { month: 'Jun', rate: 96.1 },
    { month: 'Jul', rate: 94.5 }, { month: 'Aug', rate: 97.0 }, { month: 'Sep', rate: 95.8 }
  ];

  var leaveByType = [
    { type: 'Casual Leave', days: 38 }, { type: 'Sick Leave', days: 24 },
    { type: 'Earned Leave', days: 57 }, { type: 'Comp Off', days: 9 }, { type: 'Loss of Pay', days: 4 }
  ];

  /* ---------------------------------------------------------- notifications */
  var notifications = [
    { id: 1, title: 'Leave approved', body: 'Your casual leave for 11 Sep 2026 was approved by Vikram Rao.', time: '2 hours ago', read: false, link: 'employee/leave/history.html' },
    { id: 2, title: 'Payslip available', body: 'Your payslip for August 2026 is ready to download.', time: 'Yesterday', read: false, link: 'employee/documents/salary-slips.html' },
    { id: 3, title: 'Attendance regularisation', body: 'Missing punch-out on 16 Sep 2026. Please raise a regularisation request.', time: '2 days ago', read: false, link: 'employee/attendance.html' },
    { id: 4, title: 'Policy updated', body: 'Leave Policy v3 has been published. Please review the carry-forward changes.', time: '5 days ago', read: true, link: 'employee/documents/policies.html' },
    { id: 5, title: 'Holiday announcement', body: 'Ganesh Chaturthi (25 Sep) is a declared holiday for the Bengaluru office.', time: '1 week ago', read: true, link: 'employee/attendance.html' }
  ];

  /* ---------------------------------------------------------- email log */
  var emails = [
    { to: 'arjun.kulkarni@validuresolutions.com', subject: 'Leave request received — #4821', template: 'leave_applied', sent: '2026-09-18 21:14', status: 'Delivered' },
    { to: 'vikram.rao@validuresolutions.com', subject: 'Approval needed — Arjun Kulkarni', template: 'leave_approval_request', sent: '2026-09-18 21:14', status: 'Delivered' },
    { to: 'ananya.iyer@validuresolutions.com', subject: 'Your payslip for August 2026', template: 'payslip_ready', sent: '2026-08-31 23:02', status: 'Delivered' },
    { to: 'kavya.reddy@validuresolutions.com', subject: 'Leave request received — #4820', template: 'leave_applied', sent: '2026-09-21 19:38', status: 'Delivered' },
    { to: 'deepak.nambiar@validuresolutions.com', subject: 'Missing punch-out on 19 Sep', template: 'attendance_alert', sent: '2026-09-20 05:00', status: 'Bounced' },
    { to: 'all@validuresolutions.com', subject: 'Holiday — Ganesh Chaturthi', template: 'announcement', sent: '2026-09-14 20:00', status: 'Delivered' },
    { to: 'tanvi.shah@validuresolutions.com', subject: 'Leave approved — #4816', template: 'leave_approved', sent: '2026-08-20 22:41', status: 'Delivered' },
    { to: 'gaurav.singh@validuresolutions.com', subject: 'Leave rejected — #4815', template: 'leave_rejected', sent: '2026-08-27 20:09', status: 'Delivered' }
  ];

  /* ---------------------------------------------------------- companies */
  var companies = [
    { name: 'Validure Solutions Pvt. Ltd.', code: 'VS', employees: 24, active: 23, city: 'Bengaluru', plan: 'Enterprise', since: '2020-06-01' },
    { name: 'Futurn Technologies', code: 'FT', employees: 41, active: 39, city: 'Pune', plan: 'Growth', since: '2022-03-15' },
    { name: 'Northbridge Analytics', code: 'NA', employees: 12, active: 12, city: 'Hyderabad', plan: 'Starter', since: '2024-09-09' }
  ];

  var roles = [
    { name: 'Employee', users: 19, perms: ['attendance.view_own', 'leaves.apply', 'documents.view_own'] },
    { name: 'Team Lead', users: 3, perms: ['attendance.view_own', 'leaves.apply', 'leaves.approve', 'employees.view'] },
    { name: 'HR Manager', users: 1, perms: ['employees.view', 'employees.manage', 'attendance.view_all', 'leaves.view_all', 'leaves.approve', 'balances.manage', 'documents.manage', 'reports.view', 'analytics.view', 'settings.manage'] },
    { name: 'Finance', users: 1, perms: ['payroll.view', 'payroll.run', 'reports.view'] }
  ];

  var allPerms = [
    'employees.view', 'employees.manage', 'attendance.view_own', 'attendance.view_all',
    'attendance.manage', 'leaves.apply', 'leaves.approve', 'leaves.view_all',
    'balances.manage', 'payroll.view', 'payroll.run', 'documents.view_own',
    'documents.manage', 'reports.view', 'analytics.view', 'settings.manage'
  ];

  return {
    me: me,
    employees: employees,
    leaveTypes: leaveTypes,
    leaveRequests: leaveRequests,
    attendance: attendance,
    holidays: holidays,
    payslips: payslips,
    payslipDetail: payslipDetail,
    payrollRuns: payrollRuns,
    documents: documents,
    policies: policies,
    notifications: notifications,
    emails: emails,
    companies: companies,
    roles: roles,
    allPerms: allPerms,
    departments: departments,
    designations: designations,
    teamLeave: teamLeave,
    birthdays: birthdays,
    announcements: announcements,
    devices: devices,
    deviceMap: deviceMap,
    salaryStructures: salaryStructures,
    audit: audit,
    todayAttendance: todayAttendance,
    attendanceTrend: attendanceTrend,
    leaveByType: leaveByType
  };
})();
