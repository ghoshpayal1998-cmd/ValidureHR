/*
 * Backup staleness watchdog.
 *
 * WHY THIS EXISTS
 * ---------------
 * The nightly backup reports its own failures well: POST /api/cron/backup
 * returns 500 with the stage and error, and the GitHub workflow turns that
 * into a failed run and an email. What nothing covered is the backup that
 * never ran at all.
 *
 * On 2026-08-31 that gap was measured. The workflow was scheduled at 03:30 UTC
 * and actually fired +37m, +39m, +10h54m, +12h02m and +6h28m late on five
 * consecutive weekdays — GitHub delays the schedule event under load, and the
 * half-hour is its most oversubscribed slot. Twice it appears not to have
 * fired at all. A dropped schedule produces no workflow run, so it produces no
 * failure email: the only way to notice was to look in Google Drive.
 *
 * That is the same shape as the attendance-sync hole closed in 7090df2. The
 * self-report cannot fire when the thing never ran, so it needs a watchdog
 * beside it that asks the opposite question: is there a recent bundle?
 *
 * Deliberately asks GOOGLE DRIVE, not a local table. Drive holding the bundle
 * is what "the backup happened" actually means — a row written by the backup
 * job would only prove the job thought it succeeded, and would still be
 * written if the upload silently went nowhere.
 *
 * Rides the daily accrual cron (see routes/cron.js) rather than taking its own
 * schedule: this deployment's scheduling is hand-configured on free tiers, and
 * every extra entry is another thing to get disabled. Never throws — a
 * watchdog must not be able to fail the job it is bolted onto.
 */
const { q } = require('./db');
const { sendMail } = require('./mailer');
const gdrive = require('./gdrive');

/*
 * The backup runs weekdays only, so the longest HEALTHY silence is Friday
 * morning to Monday morning — 72 hours. The threshold sits past that, plus
 * room for the scheduler's habitual lateness, so a normal weekend never
 * alerts. Same reasoning and same number as the device-sync watchdog: an alert
 * that fires every Monday teaches everyone to ignore it.
 */
const STALE_AFTER_HOURS = 80;

/**
 * Who hears about it. A missing backup is a platform-level problem, not a
 * tenant one — no amount of HR access fixes a scheduler — so this goes to the
 * platform admins rather than to `settings.manage` holders.
 */
async function alertRecipients() {
  const rows = await q(`SELECT email FROM admins WHERE email IS NOT NULL`);
  return rows.map((r) => r.email).filter(Boolean);
}

/*
 * sendMail writes every send to a TENANT email_log, and a platform admin has
 * no tenant of their own. The oldest active company's log is used as the place
 * of record so the mail is still visible in the app's Email Log rather than
 * vanishing. The body carries no tenant data, so this leaks nothing between
 * companies.
 */
async function logSchema() {
  const [row] = await q(
    `SELECT schema_name FROM companies WHERE status='Active' ORDER BY id LIMIT 1`);
  return row ? row.schema_name : null;
}

/** True when this deployment is configured to back up to Drive at all. */
function driveConfigured() {
  try {
    gdrive.getConfig();
    return true;
  } catch {
    return false;
  }
}

function hoursSince(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return (Date.now() - then) / 3600000;
}

async function notify(subject, body) {
  const [to, schema] = await Promise.all([alertRecipients(), logSchema()]);
  if (!to.length || !schema) return 0;
  sendMail(schema, to, subject, body);
  return to.length;
}

/**
 * Checks that a backup bundle actually landed in Drive recently, and mails the
 * platform admins when one did not.
 *
 * Returns a plain result for the caller to include in its response; never
 * throws and never rejects.
 */
async function checkBackupFreshness() {
  try {
    /*
     * A deployment with no Drive credentials is not doing cloud backups at
     * all (local dev, or the test suite). Saying so is right; mailing about it
     * every single day would not be.
     */
    if (!driveConfigured()) return { state: 'not_configured' };

    const folderId = await gdrive.ensureFolder();
    const files = await gdrive.listBackups(folderId); // newest first

    if (!files.length) {
      const notified = await notify(
        '[ValidureHR] No backup has ever reached Google Drive',
        'The backup folder in Google Drive is empty.\n\n'
        + 'Either no backup has ever completed, or the bundles are being written\n'
        + 'somewhere other than where this check is looking.\n\n'
        + 'Run the workflow by hand — GitHub -> Actions -> "Nightly backup" ->\n'
        + 'Run workflow — and read the response it prints. It names the stage\n'
        + 'that failed.\n\n'
        + 'Until this is resolved there is NO off-site copy of the database or\n'
        + 'of any stored document. Supabase does not back up Storage objects on\n'
        + 'any plan, and its free tier has no automated database backups.');
      return { state: 'empty', notified };
    }

    const newest = files[0];
    const ageHours = hoursSince(newest.createdTime);

    // A bundle whose timestamp cannot be parsed is not evidence of anything.
    // Treat it as a check failure rather than quietly passing.
    if (ageHours === null) {
      return { state: 'check_failed', error: `unparseable createdTime on ${newest.name}` };
    }

    if (ageHours <= STALE_AFTER_HOURS) {
      return { state: 'ok', newest: newest.name, hours_ago: Math.round(ageHours) };
    }

    const notified = await notify(
      `[ValidureHR] No backup for ${Math.floor(ageHours / 24)} days`,
      `The most recent backup in Google Drive is ${newest.name},\n`
      + `taken ${Math.round(ageHours)} hours ago (${newest.createdTime}).\n\n`
      + `Backups are expected every weekday morning. Nothing reported a failure,\n`
      + `which usually means the scheduled run never happened rather than running\n`
      + `and failing — GitHub delays or drops scheduled workflows under load.\n\n`
      + `What to check, in order:\n`
      + `  1. GitHub -> Actions -> "Nightly backup". If there are no runs on the\n`
      + `     missing days, the schedule was dropped; run it by hand now.\n`
      + `  2. If runs exist and are red, open the newest one — the response body\n`
      + `     names the stage that failed.\n\n`
      + `Running it by hand is safe and takes about a minute. Every day without\n`
      + `one is a day where the only copy of payroll data — PANs, bank details,\n`
      + `salaries — is the live Supabase project.`);

    return {
      state: 'stale',
      newest: newest.name,
      hours_ago: Math.round(ageHours),
      notified,
    };
  } catch (e) {
    /*
     * Reported, not mailed. This path is reached by a transient Drive or
     * network error as easily as by a real misconfiguration, and a watchdog
     * that mails on every blip is one people filter. A genuine outage still
     * surfaces: the bundles stop arriving and the staleness branch above fires
     * within the threshold.
     */
    return { state: 'check_failed', error: e.message };
  }
}

module.exports = { checkBackupFreshness, STALE_AFTER_HOURS };
