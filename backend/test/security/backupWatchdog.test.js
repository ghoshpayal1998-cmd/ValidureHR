/*
 * Backup staleness watchdog.
 *
 * The backup reports its own failures well. What it cannot report is a run
 * that never happened — a dropped GitHub schedule produces no workflow run and
 * therefore no failure email, which on 2026-08-31 was measured happening on
 * two of five consecutive weekdays. These tests pin the behaviour that closes
 * that hole, and equally the behaviour that stops it crying wolf: a normal
 * weekend must stay silent, or the alert gets filtered and the real one with
 * it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { fakeDb, sentMail, SRC, stubModule } = require('../helpers/testEnv');

const WATCHDOG = path.join(SRC, 'backupWatchdog.js');

/*
 * The Drive client is stubbed at module level, then steered per test through
 * `drive`. backupWatchdog requires gdrive at load time, so the stub has to be
 * installed before the first require of it.
 */
const drive = { configured: true, files: [], throws: null };
stubModule(require.resolve(path.join(SRC, 'gdrive.js')), {
  getConfig() {
    if (!drive.configured) throw new Error('Google Drive is not configured — missing GOOGLE_REFRESH_TOKEN');
    return { folderName: 'ValidureHR Backups' };
  },
  async ensureFolder() {
    if (drive.throws) throw new Error(drive.throws);
    return 'folder-id';
  },
  async listBackups() {
    if (drive.throws) throw new Error(drive.throws);
    return drive.files;
  },
});

const { checkBackupFreshness, STALE_AFTER_HOURS } = require(WATCHDOG);

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
const bundle = (h) => ({ id: 'f1', name: `vhr-backup-${h}h.tar.gz`, createdTime: hoursAgo(h) });

test.beforeEach(() => {
  fakeDb.reset();
  sentMail.length = 0;
  drive.configured = true;
  drive.files = [];
  drive.throws = null;
  fakeDb.on(/FROM admins/, [{ email: 'admin@validuresolutions.com' }]);
  fakeDb.on(/FROM companies WHERE status/, [{ schema_name: 'c_vs' }]);
});

test('a backup from this morning is not an alert', async () => {
  drive.files = [bundle(3)];

  const result = await checkBackupFreshness();

  assert.equal(result.state, 'ok');
  assert.equal(result.hours_ago, 3);
  assert.equal(sentMail.length, 0);
});

test('a normal weekend stays silent', async () => {
  // Friday morning to Monday morning is 72 hours with nothing wrong. An alert
  // here would fire every single Monday and train everyone to ignore it.
  drive.files = [bundle(72)];

  const result = await checkBackupFreshness();

  assert.equal(result.state, 'ok', `72h must sit inside the ${STALE_AFTER_HOURS}h threshold`);
  assert.equal(sentMail.length, 0);
});

test('a backup older than the threshold mails the platform admin', async () => {
  drive.files = [bundle(100)];

  const result = await checkBackupFreshness();

  assert.equal(result.state, 'stale');
  assert.equal(result.hours_ago, 100);
  assert.equal(result.notified, 1);
  assert.equal(sentMail.length, 1);
  assert.deepEqual(sentMail[0].to, ['admin@validuresolutions.com']);
  assert.match(sentMail[0].subject, /No backup for 4 days/);
});

test('the mail says to check whether the run happened at all', async () => {
  // The whole point of this watchdog: the likely cause is a run that never
  // started, which looks nothing like a failed run in the Actions tab.
  drive.files = [bundle(100)];

  await checkBackupFreshness();

  assert.match(sentMail[0].body, /never happened/i);
  assert.match(sentMail[0].body, /Actions/);
});

test('an empty Drive folder is reported and mailed, not treated as fresh', async () => {
  drive.files = [];

  const result = await checkBackupFreshness();

  assert.equal(result.state, 'empty');
  assert.equal(sentMail.length, 1);
  assert.match(sentMail[0].subject, /has ever reached Google Drive/i);
});

test('a deployment without Drive credentials is not nagged daily', async () => {
  drive.configured = false;

  const result = await checkBackupFreshness();

  assert.equal(result.state, 'not_configured');
  assert.equal(sentMail.length, 0);
});

test('a Drive outage is reported without throwing and without mailing', async () => {
  // This rides the accrual cron. It must not be able to fail the job it is
  // bolted onto, and a transient blip must not become a daily email.
  drive.throws = 'Google Drive GET /files failed (503): backend error';

  const result = await checkBackupFreshness();

  assert.equal(result.state, 'check_failed');
  assert.match(result.error, /503/);
  assert.equal(sentMail.length, 0);
});

test('an unparseable timestamp is a check failure, not a pass', async () => {
  drive.files = [{ id: 'f1', name: 'vhr-backup-weird.tar.gz', createdTime: 'not-a-date' }];

  const result = await checkBackupFreshness();

  assert.equal(result.state, 'check_failed');
  assert.equal(sentMail.length, 0);
});
