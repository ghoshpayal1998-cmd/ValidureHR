/*
 * Server-side backup: database + every stored document, compressed into one
 * bundle and uploaded to Google Drive.
 *
 * WHY THIS RUNS ON THE SERVER
 * ---------------------------
 * The original backup.bat runs on the office PC, which means backups only
 * happen when that machine is on, awake and has Docker running. This version
 * depends on nothing but the API host, so it keeps working if that PC is off,
 * replaced or gone.
 *
 * WHY THE COPY GOES TO GOOGLE DRIVE
 * ---------------------------------
 * Supabase Free has no automated database backups, and Storage objects are not
 * backed up on ANY Supabase plan — their docs are explicit that database
 * backups exclude objects stored via the Storage API. A copy held by the same
 * provider as the original is not a backup either. Drive is a different
 * provider and a different account.
 *
 * NOT ENCRYPTED — the owner asked for a plain compressed bundle (2026-08-11).
 * The archive therefore contains every employee's PAN, bank account, salary and
 * bcrypt password hash in readable form. Whoever can read that Drive folder can
 * read all of it, so the Drive account needs 2FA and must not be shared. Adding
 * encryption later is a small change: compress with a passphrase and hand the
 * passphrase to whoever would restore it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pipeline } = require('stream/promises');

const { q } = require('./db');
const gdrive = require('./gdrive');

const KEEP_REMOTE = parseInt(process.env.BACKUP_REMOTE_KEEP || '30', 10);

const log = (m) => console.log(`[backup] ${m}`);

/*
 * node-postgres understands sslmode=no-verify; libpq (which pg_dump uses) does
 * not and refuses the URL outright. "require" is libpq's equivalent posture:
 * encrypted, without CA verification.
 */
function dumpUrl() {
  const url = process.env.DATABASE_URL || '';
  return url.replace('sslmode=no-verify', 'sslmode=require');
}

function dumpDatabase(outFile) {
  const url = dumpUrl();
  if (!url) return { ok: false, error: 'DATABASE_URL is not set' };

  const result = spawnSync('pg_dump', ['--no-owner', '--no-privileges', url], {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 512,
  });

  if (result.error) {
    // ENOENT means the image has no postgresql-client — a deployment problem,
    // not a transient one, so say exactly that.
    const why = result.error.code === 'ENOENT'
      ? 'pg_dump is not installed in this image'
      : result.error.message;
    return { ok: false, error: why };
  }
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || Buffer.alloc(0)).toString().trim().slice(0, 300) || `pg_dump exited ${result.status}` };
  }
  if (!result.stdout || result.stdout.length === 0) {
    return { ok: false, error: 'pg_dump produced an empty dump' };
  }

  fs.writeFileSync(outFile, result.stdout);
  return { ok: true, bytes: result.stdout.length };
}

/** Copies every object out of the active storage driver into outDir. */
async function copyFiles(outDir) {
  const { driver, DRIVER_NAME } = require('./storage');
  if (typeof driver.list !== 'function') {
    return { count: 0, bytes: 0, keys: [], note: `driver "${DRIVER_NAME}" cannot enumerate objects` };
  }

  // Enumerated from STORAGE, not from the database: a backup should also keep
  // orphans, and must not miss a row some query forgot to join.
  const keys = await driver.list('');
  let bytes = 0;

  /*
   * Fetched a few at a time rather than one after another: each object is a
   * separate HTTPS round trip to Supabase, and sequentially they dominated the
   * run time. Bounded at 5 because the whole job runs on a 512 MB instance and
   * every stream in flight holds a buffer.
   */
  const CONCURRENCY = 5;
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (key) => {
      const object = await driver.getStream(key);
      if (!object) {
        log(`WARNING: listed but unreadable, skipped: ${key}`);
        return;
      }
      const target = path.join(outDir, ...key.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await pipeline(object.stream, fs.createWriteStream(target));
      bytes += fs.statSync(target).size;
    }));
  }
  return { count: keys.length, bytes, keys };
}

/*
 * Cross-checks the copied files against what the database references.
 *
 * This check exists because an early version of the office-PC script pointed at
 * the wrong directory, copied zero files and reported success. A backup that
 * silently captures nothing is worse than none, because it is trusted.
 */
async function verifyFiles(copiedKeys) {
  const copied = new Set(copiedKeys.map((k) => k.split('/').pop()));
  const missing = [];

  const companies = await q('SELECT slug, schema_name FROM companies');
  const sources = [
    ['policies', 'file_name'],
    ['offer_letters', 'file_name'],
    ['salary_slips', 'file_name'],
    ['leave_applications', 'attachment_file'],
  ];

  for (const { slug, schema_name: schema } of companies) {
    if (!/^c_[a-z0-9]{2,24}$/.test(schema)) continue;
    for (const [table, column] of sources) {
      const rows = await q(`SELECT ${column} AS name FROM ${schema}.${table} WHERE ${column} IS NOT NULL`);
      for (const row of rows) {
        if (row.name && !copied.has(row.name)) missing.push(`${slug}/${row.name}`);
      }
    }
  }
  return missing;
}

/** tar + gzip the staging directory into a single bundle. */
function compress(stageDir, bundlePath) {
  const result = spawnSync('tar', ['-czf', bundlePath, '-C', path.dirname(stageDir), path.basename(stageDir)], {
    encoding: 'utf8',
  });
  if (result.error) {
    return { ok: false, error: result.error.code === 'ENOENT' ? 'tar is not installed in this image' : result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || '').trim().slice(0, 300) || `tar exited ${result.status}` };
  }
  return { ok: true, bytes: fs.statSync(bundlePath).size };
}

/** Deletes the oldest remote bundles beyond KEEP_REMOTE. */
async function pruneRemote(folderId) {
  if (!Number.isFinite(KEEP_REMOTE) || KEEP_REMOTE <= 0) return 0;
  const files = await gdrive.listBackups(folderId); // newest first
  const excess = files.slice(KEEP_REMOTE);
  for (const f of excess) {
    await gdrive.deleteFile(f.id);
    log(`pruned old bundle ${f.name}`);
  }
  return excess.length;
}

/**
 * Runs the whole thing. Never throws: returns a result the caller can report,
 * because a backup failure has to be visible, not swallowed.
 */
async function runCloudBackup() {
  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const stageDir = path.join(os.tmpdir(), `validurehr-${stamp}`);
  const bundlePath = path.join(os.tmpdir(), `validurehr-${stamp}.tar.gz`);

  try {
    fs.mkdirSync(stageDir, { recursive: true });

    // --- database ---
    const db = dumpDatabase(path.join(stageDir, 'database.sql'));
    if (!db.ok) return { ok: false, stage: 'database', error: db.error };
    log(`database dumped (${(db.bytes / 1024).toFixed(0)} KB)`);

    // --- files ---
    const files = await copyFiles(path.join(stageDir, 'files'));
    log(`${files.count} file(s) copied (${(files.bytes / 1048576).toFixed(1)} MB)`);

    const missing = await verifyFiles(files.keys || []);
    if (missing.length) {
      return {
        ok: false,
        stage: 'verify',
        error: `${missing.length} file(s) referenced by the database were not captured: ${missing.slice(0, 5).join(', ')}`,
      };
    }

    fs.writeFileSync(path.join(stageDir, 'MANIFEST.txt'), [
      'ValidureHR backup',
      `taken:    ${new Date().toISOString()}`,
      `database: database.sql (${(db.bytes / 1024).toFixed(0)} KB)`,
      `files:    ${files.count} object(s) under files/`,
      `verified: yes — every file referenced by the database is present`,
      '',
      'NOT ENCRYPTED. Contains employee PII (PAN, bank details, salary) and',
      'bcrypt password hashes. Keep the Drive account locked down.',
      '',
      'Restore:',
      '  tar -xzf <this bundle>',
      '  psql "<target-connection-string>" < database.sql',
      '  upload files/ back into the storage bucket',
      '  (see backend/src/scripts/migrateFilesToSupabase.js)',
    ].join('\n'));

    // --- one bundle ---
    const bundle = compress(stageDir, bundlePath);
    if (!bundle.ok) return { ok: false, stage: 'compress', error: bundle.error };
    log(`bundled (${(bundle.bytes / 1048576).toFixed(1)} MB)`);

    // --- upload ---
    const folderId = await gdrive.ensureFolder();
    const uploaded = await gdrive.uploadFile(
      `vhr-backup-${stamp}.tar.gz`,
      fs.readFileSync(bundlePath),
      'application/gzip',
      folderId,
    );
    log(`uploaded to Google Drive as ${uploaded.name}`);

    const pruned = await pruneRemote(folderId);

    return {
      ok: true,
      bundle: uploaded.name,
      bytes: bundle.bytes,
      database_kb: Math.round(db.bytes / 1024),
      files: files.count,
      pruned,
      duration_ms: Date.now() - startedAt,
    };
  } catch (e) {
    return { ok: false, stage: 'upload', error: e.message };
  } finally {
    // The instance's disk is ephemeral but small — never leave the staging copy
    // of everyone's payroll data lying in /tmp.
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.rmSync(bundlePath, { force: true });
  }
}

module.exports = { runCloudBackup };
