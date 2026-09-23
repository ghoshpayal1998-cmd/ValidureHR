/* The pricing data, shared by the server-rendered page and the interactive
 * cards. One module so the comparison table and the cards can never disagree
 * about what a plan costs or contains. */

export const FEATURES = [
  ['Attendance, including shifts that cross midnight', 1, 1, 1],
  ['Month calendar, day sheet and bulk corrections', 1, 1, 1],
  ['Leave applications, approvals and balances', 1, 1, 1],
  ['Monthly accrual on your own rates, per leave type', 1, 1, 1],
  ['Holiday calendar and week-off pattern', 1, 1, 1],
  ['Employee records, reporting lines and directory', 1, 1, 1],
  ['Documents and policies, filed per employee', 1, 1, 1],
  ['Roles and permissions, granted not assumed', 1, 1, 1],
  ['Audit log of who changed what', 1, 1, 1],
  ['Biometric reader sync', 1, 1, 1],
  ['Payroll cycle run against real attendance', 0, 1, 1],
  ['Salary structures — basic, HRA, allowances, PF, PT, TDS', 0, 1, 1],
  ['Payslip PDFs, released to the employee', 0, 1, 1],
  ['Loss of pay, priced the same on slip and sheet', 0, 1, 1],
  ['Salary sheet export for your bank and your CA', 0, 1, 1],
  ['Reports and analytics', 0, 1, 1],
  ['The mobile app, for every employee', 0, 0, 1],
  ['Punch in and apply for leave from a phone', 0, 0, 1],
  ['More than one company, each provisioned by us', 0, 0, 1],
  ['A payroll cycle set per company, not one for all', 0, 0, 1],
  ['One invoice across every company you run', 0, 0, 1],
  ['A named contact and priority turnaround', 0, 0, 1],
];

export const PLANS = [
  {
    key: 'attendance',
    name: 'Attendance & Leave',
    line: 'For a company that needs the days right before it needs the money right.',
    year: 71,
    month: 85,
    day: '2.40',
    min: 'From 25 people',
    highlights: [
      'Attendance, night shifts included',
      'Leave, approvals and accrual',
      'Employee records and documents',
      'Biometric reader sync',
      'Roles, permissions and audit log',
    ],
  },
  {
    key: 'payroll',
    name: 'Payroll',
    rec: true,
    line: 'Everything above, plus the month actually closing — the only plan that gets you to a payslip.',
    year: 99,
    month: 119,
    day: '3.30',
    min: 'From 25 people',
    inherits: 'Attendance & Leave',
    highlights: [
      'Payroll run against real attendance',
      'Salary structures and payslip PDFs',
      'Loss of pay, priced consistently',
      'Salary sheet export',
      'Reports and analytics',
    ],
  },
  {
    key: 'everything',
    name: 'Everything',
    line: 'The same system in your people’s pockets, and as many companies as you run.',
    year: 124,
    month: 149,
    day: '4.10',
    min: 'From 25 people',
    inherits: 'Payroll',
    highlights: [
      'The mobile app for every employee',
      'Punch in and apply for leave from a phone',
      'As many companies as you run',
      'A payroll cycle set per company',
      'A named contact, priority turnaround',
    ],
  },
];

export const SIZES = [25, 50, 100, 250];

/* What a plan does NOT include, taken straight from FEATURES. Four is enough
 * to make the gap felt; the rest is one anchor away. */
const SHOWN = 4;
export function missingFor(index) {
  const all = FEATURES.filter((f) => !f[index + 1]).map((f) => f[0]);
  return { shown: all.slice(0, SHOWN), rest: Math.max(0, all.length - SHOWN) };
}
