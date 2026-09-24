/*
 * Permission keys — the unit of access control.
 * A tenant user's effective permissions = their role's permissions ∪ per-user grants.
 * Platform admins implicitly hold every permission in every company.
 */
const PERMISSIONS = [
  { key: 'employees.view', label: 'View employees' },
  { key: 'employees.manage', label: 'Add / edit / delete employees, reset passwords' },
  { key: 'attendance.view_all', label: 'View all attendance' },
  { key: 'attendance.manage', label: 'Edit / regularize attendance' },
  { key: 'attendance.export', label: 'Export attendance reports' },
  { key: 'leaves.view_all', label: 'View all leave applications' },
  { key: 'leaves.approve', label: 'Approve / reject leave' },
  { key: 'balances.manage', label: 'Manage leave balances & accrual rates' },
  { key: 'documents.manage', label: 'Upload / manage documents & salary slips' },
  { key: 'payroll.manage', label: 'Run the payroll cycle, salary structures & sheet export' },
  { key: 'reports.view', label: 'View reports' },
  { key: 'analytics.view', label: 'View analytics' },
  { key: 'settings.manage', label: 'Manage settings (holidays, announcements, org)' },
];
const ALL_KEYS = PERMISSIONS.map((p) => p.key);
const KEY_SET = new Set(ALL_KEYS);

/*
 * roles.permissions is a TEXT column holding a JSON array. Parse defensively:
 * a malformed or hand-edited value must yield "no permissions", never a crash
 * and never a permission that isn't a real key.
 */
function parsePerms(raw) {
  if (Array.isArray(raw)) return raw.filter((k) => KEY_SET.has(k));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => KEY_SET.has(k)) : [];
  } catch {
    return [];
  }
}

/*
 * System roles created in every company.
 *  - OWNER    : the company's owner. Full access to their own company.
 *  - DIRECTOR : the company's administrator. Full access to their own company.
 *  - HR       : does the work (per requirement, HR approval alone fully
 *               approves a leave). Everything except analytics.
 *  - EMPLOYEE : self-service only.
 *
 * OWNER and DIRECTOR hold every permission BY LISTING THEM, not by a
 * special-case in the middleware. That distinction matters: the middleware used
 * to substitute ALL_KEYS for anyone whose role was named DIRECTOR, which made
 * the stored permission list dead code, hid the true access level from the
 * Access Control screen, and meant a company could never define a director who
 * was actually scoped. The list below is the single source of truth, and the
 * middleware simply reads it.
 *
 * A tenant role never reaches across companies — "full access" is always full
 * access to the caller's own company schema. Platform admins remain a separate
 * thing entirely (the `adm` token claim).
 */
const COMPANY_ADMIN_PERMISSIONS = [...ALL_KEYS];

const SYSTEM_ROLES = {
  OWNER: COMPANY_ADMIN_PERMISSIONS,
  DIRECTOR: COMPANY_ADMIN_PERMISSIONS,
  HR: [
    'employees.view', 'employees.manage',
    'attendance.view_all', 'attendance.manage', 'attendance.export',
    'leaves.view_all', 'leaves.approve', 'balances.manage',
    'documents.manage', 'payroll.manage', 'reports.view', 'settings.manage',
  ],
  EMPLOYEE: [],
};

/*
 * Roles that administer their own company. Used for the checks that are about
 * seniority rather than a specific permission — e.g. approving one's own leave,
 * which a company administrator may do because there is nobody above them.
 */
const COMPANY_ADMIN_ROLES = new Set(['OWNER', 'DIRECTOR']);

/*
 * Plans — what a company has BOUGHT, as opposed to what a role is allowed to do.
 *
 * These two were the same thing until now, which meant the three tiers on the
 * pricing page were decoration: nothing stopped a company that had paid for
 * Basic from running payroll, because payroll was gated by documents.manage and
 * every company's OWNER holds every key.
 *
 * A plan is a CEILING, not a grant. Effective permissions are
 *   (role ∪ user grants) ∩ plan entitlements
 * so buying Advanced never hands anyone a permission their role was not given,
 * and downgrading to Basic takes payroll away without rewriting any role.
 *
 * Platform admins are deliberately exempt: support has to be able to see a
 * customer's company whatever they pay.
 */
const PLAN_KEYS = ['basic', 'essential', 'advanced'];
const DEFAULT_PLAN = 'essential';

const BASIC_ENTITLEMENTS = [
  'employees.view', 'employees.manage',
  'attendance.view_all', 'attendance.manage', 'attendance.export',
  'leaves.view_all', 'leaves.approve', 'balances.manage',
  'documents.manage', 'settings.manage',
];

const PLAN_ENTITLEMENTS = {
  // Attendance, leave, documents and payslips. No payroll cycle, no reporting.
  basic: BASIC_ENTITLEMENTS,
  // Adds the cycle itself, the structures behind it, and the reporting on top.
  essential: [...BASIC_ENTITLEMENTS, 'payroll.manage', 'reports.view', 'analytics.view'],
  // Everything the product has. The extras Advanced sells beyond this — the
  // mobile app and more than one company — are not permission keys: the first
  // is a client that has to identify itself, the second is how many companies
  // we provision for the customer.
  advanced: [...ALL_KEYS],
};

const normalisePlan = (raw) => {
  const v = String(raw || '').trim().toLowerCase();
  return PLAN_KEYS.includes(v) ? v : null;
};

/** The permissions a plan permits. An unknown plan falls back to the default
 *  rather than to nothing, so a bad value can never lock a paying customer out. */
function planEntitlements(plan) {
  return new Set(PLAN_ENTITLEMENTS[normalisePlan(plan) || DEFAULT_PLAN]);
}

const isCompanyAdminRole = (roleName) => COMPANY_ADMIN_ROLES.has(String(roleName || '').toUpperCase());

module.exports = {
  PERMISSIONS, ALL_KEYS, SYSTEM_ROLES, parsePerms,
  COMPANY_ADMIN_ROLES, COMPANY_ADMIN_PERMISSIONS, isCompanyAdminRole,
  PLAN_KEYS, DEFAULT_PLAN, PLAN_ENTITLEMENTS, planEntitlements, normalisePlan,
};
