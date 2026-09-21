/*
 * Machine-to-machine integration endpoints.
 *
 * WHY THIS EXISTS
 * ---------------
 * The office PC runs a scheduled sync script that reads the biometric device
 * over the office LAN and pushes OUTBOUND to this endpoint (Render cannot
 * reach the LAN): the device's user roster plus one row per machine per day
 * carrying the first entry and last exit time. Rows land in
 * {s}.device_attendance — never in {s}.attendance, whose status column is
 * HR-managed.
 *
 * Machines are matched to employees through {s}.device_employee_map, which
 * platform admins edit in the portal (Attendance → Device Mapping). Punches
 * from unmapped machines are reported back and held, not stored — mapping is
 * a dashboard action, not a config file on the office PC.
 *
 * SECURITY
 * --------
 * Same model as routes/cron.js: no user session, so the shared secret in
 * ATTENDANCE_SYNC_SECRET is the only thing standing in front of a write path
 * into tenant data. Without it configured the route refuses to run rather
 * than defaulting open. The tenant comes from x-company-slug, validated
 * against public.companies exactly like the platform-admin path in
 * middleware/auth.js.
 */
const express = require('express');
const crypto = require('crypto');
const { pool, q, qOne, tq, assertSchema } = require('../db');
const audit = require('../audit');
const { reportSyncFailure } = require('../deviceSync');

const router = express.Router();

const SYNC_SECRET = process.env.ATTENDANCE_SYNC_SECRET || '';

/** Constant-time comparison, so the secret cannot be recovered by timing. */
function secretMatches(provided) {
  if (!SYNC_SECRET || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(SYNC_SECRET);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length — compare hashes so the inputs are always the same size.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/*
 * Accepts the secret as a Bearer token or an x-sync-secret header. Not as a
 * query parameter: URLs end up in access logs, browser history and referrers,
 * and this one is effectively a password.
 */
function requireSyncSecret(req, res, next) {
  if (!SYNC_SECRET) {
    return res.status(503).json({
      error: 'Attendance sync is not configured on this deployment (ATTENDANCE_SYNC_SECRET is unset).',
    });
  }
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const provided = bearer || req.headers['x-sync-secret'];
  if (!secretMatches(provided)) {
    return res.status(401).json({ error: 'Invalid or missing sync credentials' });
  }
  next();
}

/*
 * Resolves the tenant for a secret-authenticated caller. Mirrors the
 * platform-admin branch of middleware/auth.js tenant(): slug header → company
 * row → req.s. There is no req.user here, so audit() records actor 'system'.
 */
async function resolveCompany(req, res, next) {
  try {
    const slug = (req.headers['x-company-slug'] || '').toLowerCase();
    if (!slug) return res.status(400).json({ error: 'No company selected (x-company-slug header missing)' });
    const company = await qOne('SELECT * FROM companies WHERE slug=$1', [slug]);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    if (company.status !== 'Active') return res.status(403).json({ error: 'This company account is suspended' });
    if (!company.has_device_attendance) {
      return res.status(403).json({ error: 'Device attendance is not enabled for this company' });
    }
    req.company = company;
    req.s = company.schema_name;
    next();
  } catch (e) { next(e); }
}

// Same tolerance as routes/attendance.js: allow tomorrow (server time) so a
// client in a later timezone is not rejected at its local end of day.
function isFutureDate(dateStr) {
  const serverToday = new Date();
  const tomorrow = new Date(serverToday.getTime() + 24 * 60 * 60 * 1000);
  const maxAllowed = tomorrow.toISOString().slice(0, 10);
  return dateStr > maxAllowed;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/*
 * POST /api/integrations/attendance
 * Body: {
 *   users: [{ machine_id, device_name }],            // device roster (optional)
 *   rows:  [{ machine_id, date, check_in, check_out }]
 * }
 *   date      YYYY-MM-DD (the attendance day, already cutoff-adjusted)
 *   check_in  HH:MM or null — first punch of that day
 *   check_out HH:MM or null — last punch of that day
 *
 * Idempotent: re-sending a window upserts on (employee_id, date), so the
 * script simply re-sends its recent window on every sync and late punches
 * self-heal. An empty rows[] with no users is valid and doubles as the
 * script's connection test.
 */
router.post('/attendance', requireSyncSecret, resolveCompany, async (req, res, next) => {
  try {
    const body = req.body || {};
    const rows = body.rows;
    const users = body.users == null ? [] : body.users;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows[] required' });
    if (!Array.isArray(users)) return res.status(400).json({ error: 'users must be an array' });
    if (rows.length > 500) return res.status(400).json({ error: 'Too many rows in one sync (max 500)' });
    if (users.length > 500) return res.status(400).json({ error: 'Too many users in one sync (max 500)' });

    for (const u of users) {
      if (!u || typeof u.machine_id !== 'string' || !u.machine_id.trim()) {
        return res.status(400).json({ error: 'Invalid roster entry (missing machine_id)' });
      }
      if (u.device_name != null && typeof u.device_name !== 'string') {
        return res.status(400).json({ error: `Invalid device_name for machine ${u.machine_id}` });
      }
    }
    for (const r of rows) {
      const label = `machine_id=${r && r.machine_id}, date=${r && r.date}`;
      if (!r || typeof r.machine_id !== 'string' || !r.machine_id.trim()) {
        return res.status(400).json({ error: `Invalid row (missing machine_id): ${label}` });
      }
      if (typeof r.date !== 'string' || !DATE_RE.test(r.date)) {
        return res.status(400).json({ error: `Invalid date (use YYYY-MM-DD): ${label}` });
      }
      if (isFutureDate(r.date)) {
        return res.status(400).json({ error: `Cannot record device attendance for a future date: ${label}` });
      }
      if (r.check_in != null && !TIME_RE.test(r.check_in)) {
        return res.status(400).json({ error: `Invalid check_in (use HH:MM): ${label}` });
      }
      if (r.check_out != null && !TIME_RE.test(r.check_out)) {
        return res.status(400).json({ error: `Invalid check_out (use HH:MM): ${label}` });
      }
      if (r.check_in == null && r.check_out == null) {
        return res.status(400).json({ error: `Row has neither check_in nor check_out: ${label}` });
      }
    }

    const schema = req.s;
    assertSchema(schema);

    // Roster upsert: every machine the device reported, plus any machine that
    // punched — so the admin's Device Mapping panel always shows the complete
    // list with names, including machines nobody has mapped yet. A blank name
    // never overwrites a stored one.
    const nameByMachine = new Map();
    for (const u of users) nameByMachine.set(u.machine_id.trim(), (u.device_name || '').trim());
    for (const r of rows) {
      const mid = r.machine_id.trim();
      if (!nameByMachine.has(mid)) nameByMachine.set(mid, '');
    }
    if (nameByMachine.size > 0) {
      const valueClauses = [];
      const params = [];
      let idx = 1;
      for (const [mid, dname] of nameByMachine) {
        valueClauses.push(`($${idx},$${idx + 1})`);
        params.push(mid, dname);
        idx += 2;
      }
      await q(`
        INSERT INTO ${schema}.device_employee_map (machine_id, device_name)
        VALUES ${valueClauses.join(', ')}
        ON CONFLICT (machine_id) DO UPDATE SET
          device_name = CASE WHEN EXCLUDED.device_name = '' THEN device_employee_map.device_name
                             ELSE EXCLUDED.device_name END`, params);
    }

    if (rows.length === 0) {
      return res.json({ message: users.length ? 'Roster updated' : 'Nothing to sync', updated: 0 });
    }

    // Resolve machines through the admin-managed map; unmapped ones are
    // reported back (with names) and their rows held, never stored.
    const machineIds = [...new Set(rows.map((r) => r.machine_id.trim()))];
    const mapped = await tq(req.s,
      'SELECT machine_id, employee_id FROM {s}.device_employee_map WHERE machine_id = ANY($1) AND employee_id IS NOT NULL',
      [machineIds]);
    const idByMachine = new Map(mapped.map((m) => [m.machine_id, m.employee_id]));
    const unmapped = machineIds
      .filter((m) => !idByMachine.has(m))
      .map((m) => ({ machine_id: m, device_name: nameByMachine.get(m) || '' }));

    // Last write wins if a payload repeats an (employee, date) pair — Postgres
    // rejects a multi-row upsert that touches the same row twice.
    const byKey = new Map();
    for (const r of rows) {
      const id = idByMachine.get(r.machine_id.trim());
      if (id !== undefined) byKey.set(`${id}|${r.date}`, { id, ...r });
    }
    const resolved = [...byKey.values()];

    if (resolved.length === 0) {
      return res.json({ message: 'No rows matched a mapped machine', received: rows.length, updated: 0, unmapped_machines: unmapped });
    }

    // Single multi-row parameterized INSERT … ON CONFLICT, in a transaction —
    // same shape as POST /api/attendance/bulk.
    const valueClauses = [];
    const params = [];
    let idx = 1;
    for (const r of resolved) {
      valueClauses.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3})`);
      params.push(r.id, r.date, r.check_in || null, r.check_out || null);
      idx += 4;
    }

    const sql = `
      INSERT INTO ${schema}.device_attendance (employee_id, date, check_in, check_out)
      VALUES ${valueClauses.join(', ')}
      ON CONFLICT (employee_id, date) DO UPDATE SET
        check_in = EXCLUDED.check_in,
        check_out = EXCLUDED.check_out,
        synced_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql, params);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const dates = resolved.map((r) => r.date).sort();
    audit(req, 'DEVICE_ATTENDANCE_SYNC', `Upserted ${resolved.length} device time rows (${dates[0]}..${dates[dates.length - 1]})`);
    res.json({
      message: 'Device attendance saved',
      received: rows.length,
      updated: resolved.length,
      unmapped_machines: unmapped,
    });
  } catch (e) { next(e); }
});

/*
 * POST /api/integrations/attendance/alert
 * Body: { error: string }
 *
 * The sync script calls this from its own catch block so a failed run reaches
 * somebody the same night, instead of being a line in a log file on the office
 * PC that nobody reads until device times are visibly missing.
 *
 * It deliberately cannot tell the caller whether mail went out: the script's
 * job is to report, and blocking its exit on our SMTP is not an improvement.
 * The case this endpoint structurally cannot cover is "the script could not
 * reach the API" — routes/cron.js runs the staleness check for that.
 */
router.post('/attendance/alert', requireSyncSecret, resolveCompany, async (req, res, next) => {
  try {
    const detail = String(req.body?.error || '').trim().slice(0, 500);
    if (!detail) return res.status(400).json({ error: 'An "error" description is required' });

    const { notified } = await reportSyncFailure(req.s, req.company.name, detail);
    audit(req, 'DEVICE_SYNC_FAILED', detail.slice(0, 200));
    res.json({ message: 'Failure recorded', notified });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.requireSyncSecret = requireSyncSecret;
