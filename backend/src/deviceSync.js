/*
 * Device-sync failure alerting.
 *
 * The office PC's scheduled task is the only thing that carries biometric
 * punches into ValidureHR, and until now it failed in silence. On 2026-08-17 the PC
 * was on the wrong Wi-Fi when the task fired; the device was unreachable, the
 * script exited 1, and the only trace was a line in a log file on that machine.
 * Four days of device times were missing before anyone went looking.
 *
 * Two halves, because either alone leaves a hole:
 *
 *   reportSyncFailure — the script ran, failed, and said so. Fast and carries
 *                       the actual error. Cannot fire when the failure is
 *                       "cannot reach the API", which is the case it misses.
 *   checkStaleSyncs   — nobody has said anything for too long. Catches the PC
 *                       being off, the task never firing, the script dying
 *                       outright and the API being unreachable — none of which
 *                       can report on their own behalf.
 */
const { q, tq } = require('./db');
const { sendMail } = require('./mailer');

/*
 * The longest healthy silence is the weekend: the task runs Mon–Fri, so a
 * Friday night run is followed by nothing until Monday night — 72 hours. The
 * threshold sits just past that so a normal weekend never alerts, and a missed
 * weekday run is caught by the next daily check.
 */
const STALE_AFTER_HOURS = 80;

/**
 * Who hears about it: whoever can act on it. `settings.manage` is the
 * permission that already gates the Email Log and integration settings, so it
 * is the same audience that would go looking when device times stop arriving.
 */
async function alertRecipients(schema) {
  const rows = await tq(schema, `
    SELECT DISTINCT u.email FROM {s}.users u
    LEFT JOIN {s}.roles r ON r.id = u.role_id
    WHERE u.is_active AND u.email IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM json_array_elements_text(COALESCE(NULLIF(r.permissions, ''), '[]')::json) AS perm
        WHERE perm = 'settings.manage'
      )
      OR EXISTS (
        SELECT 1 FROM {s}.user_permissions up
        WHERE up.user_id = u.id AND up.permission = 'settings.manage'
      )
    )`);
  return rows.map((r) => r.email).filter(Boolean);
}

/** The script reported a failure it hit on the office PC. */
async function reportSyncFailure(schema, companyName, detail) {
  const to = await alertRecipients(schema);
  if (!to.length) return { notified: 0 };

  sendMail(schema, to,
    `[ValidureHR] Attendance sync failed — ${companyName}`,
    `The biometric attendance sync on the office PC ran and failed.\n\n`
    + `  Error : ${detail}\n\n`
    + `Device times will not be updated until a run succeeds. Punches are not\n`
    + `lost — they stay on the device, and the next successful run backfills\n`
    + `everything since the last one.\n\n`
    + `Most common causes, in the order worth checking:\n`
    + `  1. The office PC is not on the same network as the device.\n`
    + `  2. The device is powered off, or its IP has changed.\n`
    + `  3. The PC was asleep or logged out when the task fired.\n\n`
    + `The log on that PC is sync-log.txt, next to sync-attendance.ps1.\n`
    + `To retry immediately:  schtasks /Run /TN "ValidureHR Attendance Sync"`);

  return { notified: to.length };
}

/**
 * Nobody has reported anything for too long. Runs across every tenant with
 * device attendance enabled, so a second company is covered without new
 * scheduling. Never throws — this is a watchdog bolted onto another job, and
 * it must not be able to fail that job.
 */
async function checkStaleSyncs() {
  const results = [];
  try {
    const companies = await q(
      `SELECT name, schema_name FROM companies WHERE status='Active' AND has_device_attendance`);

    for (const c of companies) {
      try {
        const [row] = await tq(c.schema_name, `
          SELECT max(synced_at) AS last_sync,
                 EXTRACT(EPOCH FROM (now() AT TIME ZONE 'UTC' - max(synced_at)::timestamp)) / 3600 AS hours_ago
          FROM {s}.device_attendance`);

        // Never synced at all: a tenant that has just switched the feature on
        // has nothing to be stale about, and nagging about it would train
        // people to ignore these mails.
        if (!row || !row.last_sync) {
          results.push({ company: c.name, state: 'never_synced' });
          continue;
        }

        const hoursAgo = Number(row.hours_ago);
        if (hoursAgo <= STALE_AFTER_HOURS) {
          results.push({ company: c.name, state: 'ok', hours_ago: Math.round(hoursAgo) });
          continue;
        }

        const to = await alertRecipients(c.schema_name);
        if (to.length) {
          sendMail(c.schema_name, to,
            `[ValidureHR] No attendance sync for ${Math.floor(hoursAgo / 24)} days — ${c.name}`,
            `No biometric attendance sync has reached ValidureHR since ${row.last_sync} UTC\n`
            + `(${Math.round(hoursAgo)} hours ago).\n\n`
            + `Nothing reported a failure, which usually means the sync never ran at\n`
            + `all rather than running and failing — the office PC being off, or the\n`
            + `scheduled task not firing.\n\n`
            + `On the office PC:\n`
            + `  schtasks /Query /TN "ValidureHR Attendance Sync" /V /FO LIST\n`
            + `Check Last Run Time and Last Result (0 = success), then force a run:\n`
            + `  schtasks /Run /TN "ValidureHR Attendance Sync"\n\n`
            + `Punches are not lost — they stay on the device, and one successful run\n`
            + `backfills everything since the last one.`);
        }
        results.push({ company: c.name, state: 'stale', hours_ago: Math.round(hoursAgo), notified: to.length });
      } catch (inner) {
        results.push({ company: c.name, state: 'check_failed', error: inner.message });
      }
    }
  } catch (e) {
    return { checked: 0, error: e.message };
  }
  return { checked: results.length, results };
}

module.exports = { reportSyncFailure, checkStaleSyncs, alertRecipients, STALE_AFTER_HOURS };
