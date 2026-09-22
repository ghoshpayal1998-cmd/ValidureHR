/* Roles (company-level, managed by the platform admin) and per-user permission grants.
 * A grant does not appear in the user's UI until the admin gives it — the frontend
 * builds its menu from the permission list returned by /auth/me. */
const express = require('express');
const { tq, tqOne } = require('../db');
const { PERMISSIONS, ALL_KEYS, parsePerms } = require('../permissions');
const audit = require('../audit');
const { authenticate, requireAdmin, tenant, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, tenant);

// GET /api/access/permissions — catalogue of grantable permissions
router.get('/permissions', (req, res) => res.json(PERMISSIONS));

// GET /api/access/roles — visible to anyone who can manage employees (role dropdown)
router.get('/roles', requirePerm('employees.view'), async (req, res, next) => {
  try {
    const roles = await tq(req.s, 'SELECT * FROM {s}.roles ORDER BY is_system DESC, name');
    res.json(roles.map((r) => ({ ...r, permissions: parsePerms(r.permissions) })));
  } catch (e) { next(e); }
});

// ---- Role management: platform admin only ----

router.post('/roles', requireAdmin, async (req, res, next) => {
  try {
    const { name, permissions } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Role name is required' });
    const perms = (permissions || []).filter((p) => ALL_KEYS.includes(p));
    try {
      await tq(req.s, `INSERT INTO {s}.roles (name, is_system, permissions) VALUES ($1,FALSE,$2)`,
        [name.trim().toUpperCase(), JSON.stringify(perms)]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A role with that name already exists' });
      throw err;
    }
    audit(req, 'ROLE_CREATED', `Role ${name.trim().toUpperCase()} (${perms.length} permission(s))`);
    res.status(201).json({ message: 'Role created' });
  } catch (e) { next(e); }
});

router.put('/roles/:id', requireAdmin, async (req, res, next) => {
  try {
    const role = await tqOne(req.s, 'SELECT * FROM {s}.roles WHERE id=$1', [req.params.id]);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(400).json({ error: 'System roles (OWNER, DIRECTOR, HR, EMPLOYEE) cannot be edited' });
    const perms = (req.body?.permissions || []).filter((p) => ALL_KEYS.includes(p));
    const name = (req.body?.name || role.name).trim().toUpperCase();
    await tq(req.s, `UPDATE {s}.roles SET name=$1, permissions=$2 WHERE id=$3`,
      [name, JSON.stringify(perms), role.id]);
    audit(req, 'ROLE_UPDATED', `Role ${name}`);
    res.json({ message: 'Role updated' });
  } catch (e) { next(e); }
});

router.delete('/roles/:id', requireAdmin, async (req, res, next) => {
  try {
    const role = await tqOne(req.s, 'SELECT * FROM {s}.roles WHERE id=$1', [req.params.id]);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(400).json({ error: 'System roles cannot be deleted' });
    const used = (await tqOne(req.s, 'SELECT COUNT(*)::int c FROM {s}.users WHERE role_id=$1', [role.id])).c;
    if (used) return res.status(400).json({ error: `Cannot delete: ${used} user(s) hold this role` });
    await tq(req.s, 'DELETE FROM {s}.roles WHERE id=$1', [role.id]);
    audit(req, 'ROLE_DELETED', `Role ${role.name}`);
    res.json({ message: 'Role deleted' });
  } catch (e) { next(e); }
});

// ---- Per-user extra grants: platform admin only ----

// GET /api/access/users — every user with role + extra grants
router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const users = await tq(req.s, `
      SELECT u.id, u.username, u.email, r.name AS role, r.permissions AS role_permissions,
             (e.first_name || ' ' || e.last_name) AS name
      FROM {s}.users u
      LEFT JOIN {s}.roles r ON r.id = u.role_id
      LEFT JOIN {s}.employees e ON e.id = u.employee_id
      ORDER BY u.username`);
    const grants = await tq(req.s, 'SELECT user_id, permission FROM {s}.user_permissions');
    res.json(users.map((u) => ({
      ...u,
      role_permissions: parsePerms(u.role_permissions),
      extra_permissions: grants.filter((g) => g.user_id === u.id).map((g) => g.permission),
    })));
  } catch (e) { next(e); }
});

// PUT /api/access/users/:id { permissions: [] } — replaces the user's extra grants
router.put('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const user = await tqOne(req.s, 'SELECT * FROM {s}.users WHERE id=$1', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const perms = [...new Set((req.body?.permissions || []).filter((p) => ALL_KEYS.includes(p)))];
    await tq(req.s, 'DELETE FROM {s}.user_permissions WHERE user_id=$1', [user.id]);
    for (const p of perms) {
      await tq(req.s, 'INSERT INTO {s}.user_permissions (user_id, permission) VALUES ($1,$2)', [user.id, p]);
    }
    audit(req, 'ACCESS_GRANTED', `Extra permissions for ${user.username}: ${perms.join(', ') || '(none)'}`);
    res.json({ message: `Access updated for ${user.username}` });
  } catch (e) { next(e); }
});

module.exports = router;
