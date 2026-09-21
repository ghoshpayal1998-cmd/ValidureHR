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
    'documents.manage', 'reports.view', 'settings.manage',
  ],
  EMPLOYEE: [],
};

/*
 * Roles that administer their own company. Used for the checks that are about
 * seniority rather than a specific permission — e.g. approving one's own leave,
 * which a company administrator may do because there is nobody above them.
 */
const COMPANY_ADMIN_ROLES = new Set(['OWNER', 'DIRECTOR']);

const isCompanyAdminRole = (roleName) => COMPANY_ADMIN_ROLES.has(String(roleName || '').toUpperCase());

module.exports = {
  PERMISSIONS, ALL_KEYS, SYSTEM_ROLES, parsePerms,
  COMPANY_ADMIN_ROLES, COMPANY_ADMIN_PERMISSIONS, isCompanyAdminRole,
};
