/*
 * Endpoints for an external scheduler.
 *
 * WHY THIS EXISTS
 * ---------------
 * Leave accrual runs from a setInterval started at boot (see accrual.js). That
 * works on a machine that stays up, and not at all on a host that sleeps: a
 * Render free instance spins down after 15 minutes idle, so the 12-hour timer
 * never fires and balances quietly stop accruing. Nobody notices for a month.
 *
 * So the schedule moves outside the process. A cron service (cron-job.org, a
 * GitHub Actions schedule, anything that can make an HTTP request) calls these.
 *
 * SECURITY
 * --------
 * These run without a user session, so the shared secret in CRON_SECRET is the
 * only thing standing in front of them. Without it configured the routes refuse
 * to run at all rather than defaulting open — an unauthenticated endpoint that
 * mutates leave balances would be worse than no scheduler.
 */
const express = require('express');
const crypto = require('crypto');
const { q } = require('../db');
const { runAccrualAllCompanies } = require('../accrual');
const { runCloudBackup } = require('../cloudBackup');
const { checkStaleSyncs } = require('../deviceSync');
const { checkBackupFreshness } = require('../backupWatchdog');

const router = express.Router();

const CRON_SECRET = process.env.CRON_SECRET || '';

/** Constant-time comparison, so the secret cannot be recovered by timing. */
function secretMatches(provided) {
  if (!CRON_SECRET || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(CRON_SECRET);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length — compare hashes so the inputs are always the same size.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/*
 * Accepts the secret as a Bearer token or an x-cron-secret header. Not as a
 * query parameter: URLs end up in access logs, browser history and referrers,
 * and this one is effectively a password.
 */
function requireCronSecret(req, res, next) {
  if (!CRON_SECRET) {
    return res.status(503).json({
      error: 'Scheduled tasks are not configured on this deployment (CRON_SECRET is unset).',
    });
  }
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const provided = bearer || req.headers['x-cron-secret'];
  if (!secretMatches(provided)) {
    return res.status(401).json({ error: 'Invalid or missing scheduler credentials' });
  }
  next();
}

/*
 * POST /api/cron/accrual — credit any months that are due.
 *
 * Idempotent: every balance row carries a last_accrued high-water mark, so
 * running this hourly, daily or twice in a minute credits the same total. That
 * matters because a cron service will retry on timeout.
 */
router.post('/accrual', requireCronSecret, async (req, res, next) => {
  try {
    const startedAt = Date.now();
    await runAccrualAllCompanies();
    /*
     * Piggy-backed rather than given its own schedule: the device-sync watchdog
     * needs a daily heartbeat and this is already one, so it costs no new cron
     * entry on a deployment whose scheduling is hand-configured on free tiers.
     * checkStaleSyncs never throws — a watchdog must not be able to fail the
     * job it is riding on.
     */
    const deviceSync = await checkStaleSyncs();
    /*
     * Second watchdog on the same heartbeat, for the same reason: it asks
     * whether a backup bundle actually reached Drive, which is the one failure
     * the backup job cannot report on its own behalf — a scheduled run that
     * never happened produces no run, and therefore no failure email. Like
     * checkStaleSyncs it never throws, so it cannot fail this job.
     */
    const backup = await checkBackupFreshness();
    res.json({
      ok: true,
      task: 'accrual',
      duration_ms: Date.now() - startedAt,
      ran_at: new Date().toISOString(),
      device_sync: deviceSync,
      backup,
    });
  } catch (e) { next(e); }
});

/*
 * POST /api/cron/keepalive — touch the database so a free Supabase project does
 * not pause.
 *
 * Supabase pauses free projects after 7 days of inactivity, and "activity"
 * means database activity. Pinging /api/health would keep Render awake while
 * Supabase quietly paused underneath it, so this issues a real query. It is
 * behind the secret because it is the one cheap endpoint that touches the
 * database — leaving it open would hand out a free load generator.
 */
router.post('/keepalive', requireCronSecret, async (req, res, next) => {
  try {
    const rows = await q('SELECT COUNT(*)::int AS companies FROM companies');
    res.json({
      ok: true,
      task: 'keepalive',
      companies: rows[0]?.companies ?? 0,
      ran_at: new Date().toISOString(),
    });
  } catch (e) { next(e); }
});

/*
 * POST /api/cron/backup — dump the database and every stored document into one
 * compressed bundle and upload it to Google Drive.
 *
 * Runs here rather than on the office PC so backups do not depend on that
 * machine being on. Synchronous on purpose: the caller (and its failure
 * notifications) must learn whether the backup actually happened. Keep the
 * schedule inside the keep-awake window so the instance is already warm — a
 * cold start plus a backup can exceed a scheduler's request timeout.
 */
router.post('/backup', requireCronSecret, async (req, res, next) => {
  try {
    const result = await runCloudBackup();
    if (!result.ok) {
      console.error(`[backup] FAILED at ${result.stage}: ${result.error}`);
      // 500 so an external scheduler records a failed run and alerts, rather
      // than a green tick over a backup that never happened.
      return res.status(500).json({ ok: false, task: 'backup', ...result });
    }
    res.json({ task: 'backup', ...result });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.requireCronSecret = requireCronSecret;
