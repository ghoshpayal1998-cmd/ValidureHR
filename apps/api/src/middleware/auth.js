const jwt = require('jsonwebtoken');
const { qOne, tq, tqOne } = require('../db');
const { ALL_KEYS, parsePerms, effectiveEntitlements } = require('../permissions');
const { requireJwtSecret } = require('../config');

// Throws at require() time if the secret is missing, too short, or one of the
// values published in this repo. Failing to boot is the correct outcome: a
// forgeable signing key means every tenant's PII is readable without a password.
const JWT_SECRET = requireJwtSecret();

/** Verifies the JWT. Token payload:
 *  platform admin: { adm: true, id, username }
 *  tenant user   : { id, username, companyId, slug, schema, employeeId, role }
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.adm) return res.status(403).json({ error: 'Platform admin access required' });
  next();
}

/*
 * Resolves the tenant (company schema) for the request and loads the caller's
 * effective permissions.
 *  - Tenant users: company comes from their token; permissions = role ∪ user grants.
 *  - Platform admins: company comes from the x-company-slug header (they can enter
 *    any company); permissions = everything.
 */
async function tenant(req, res, next) {
  try {
    if (req.user.adm) {
      const slug = (req.headers['x-company-slug'] || '').toLowerCase();
      if (!slug) return res.status(400).json({ error: 'No company selected (x-company-slug header missing)' });
      const company = await qOne('SELECT * FROM companies WHERE slug=$1', [slug]);
      if (!company) return res.status(404).json({ error: 'Company not found' });
      req.company = company;
      req.s = company.schema_name;
      req.perms = new Set(ALL_KEYS);
      return next();
    }

    const company = await qOne('SELECT * FROM companies WHERE id=$1', [req.user.companyId]);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    if (company.status !== 'Active') return res.status(403).json({ error: 'This company account is suspended' });
    req.company = company;
    req.s = company.schema_name;

    const u = await tqOne(req.s,
      `SELECT u.is_active, u.is_locked, r.name AS role_name, r.permissions AS role_perms
       FROM {s}.users u LEFT JOIN {s}.roles r ON r.id = u.role_id WHERE u.id=$1`,
      [req.user.id]);
    if (!u || !u.is_active || u.is_locked) return res.status(403).json({ error: 'Account disabled or locked' });

    req.user.role = u.role_name;
    const grants = await tq(req.s, `SELECT permission FROM {s}.user_permissions WHERE user_id=$1`, [req.user.id]);

    // Every tenant user — DIRECTOR included — gets exactly what their role plus
    // their individual grants say. There is deliberately no role that bypasses
    // this: a director who needs to manage employees is given the permission,
    // not an exemption from the check.
    const granted = new Set([...parsePerms(u.role_perms), ...grants.map((g) => g.permission)]);

    // ...and then the plan caps it. The company's OWNER role lists every key,
    // so without this intersection a company on Basic would still run payroll
    // and the three tiers would be a picture on a website. Downgrading a plan
    // takes the capability away without touching a single role.
    // The plan, widened or narrowed by whatever this company was granted or
    // withheld individually.
    const entitled = effectiveEntitlements(company.plan, company.entitlement_overrides);
    req.plan = company.plan;
    req.entitled = entitled;
    req.perms = new Set([...granted].filter((k) => entitled.has(k)));
    next();
  } catch (e) { next(e); }
}

const requirePerm = (key) => (req, res, next) => {
  if (!req.perms?.has(key)) return res.status(403).json({ error: `Missing permission: ${key}` });
  next();
};

module.exports = { authenticate, requireAdmin, tenant, requirePerm, JWT_SECRET };
