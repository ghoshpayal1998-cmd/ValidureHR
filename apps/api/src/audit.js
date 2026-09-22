const { tq } = require('./db');

/** audit(req, action, details) — writes to the request's tenant audit log. */
function audit(req, action, details) {
  if (!req.s) return;
  const actor = req.user?.adm ? `${req.user.username} (platform admin)` : req.user?.username || 'system';
  tq(req.s, 'INSERT INTO {s}.audit_logs (user_id, actor, action, details) VALUES ($1,$2,$3,$4)', [
    req.user?.adm ? null : req.user?.id || null,
    actor,
    action,
    details || null,
  ]).catch((e) => console.error('audit log failed:', e.message));
}

module.exports = audit;
