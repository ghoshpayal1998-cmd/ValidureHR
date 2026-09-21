/*
 * Full backup: PostgreSQL + every stored document.
 *
 * WHY THIS EXISTS
 * ---------------
 * Supabase's Free plan has NO automated database backups, and — on every plan,
 * including paid ones — Storage objects are not backed up at all:
 *
 *   "Database backups do not include objects you store via the Storage API,
 *    as the database only includes metadata about these objects."
 *
 * So a payslip, offer letter or leave attachment exists in exactly one place
 * unless something like this runs. These are statutory payroll records holding
 * PAN numbers and bank details; losing them is not a recoverable situation.
 *
 * Backups are written to the LOCAL disk of whatever machine runs this, which is
 * deliberate: a copy held by the same provider that holds the primary is not a
 * backup. Run it from the office PC on a schedule (see backup.bat).
 *
 * Usage:
 *   node src/scripts/backup.js [--out <dir>] [--keep <n>] [--db-only|--files-only]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pipeline } = require('stream/promises');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

/*
 * Resolve the uploads directory to an ABSOLUTE path before anything requires
 * ../storage, which reads UPLOADS_ROOT once at load time. A relative value in
 * .env would otherwise resolve against the current working directory — which is
 * backend/ when launched from backup.bat, silently pointing the backup at an
 * empty folder.
 */
const filesRoot = option('files-root', process.env.UPLOADS_ROOT);
if (filesRoot) process.env.UPLOADS_ROOT = path.resolve(PROJECT_ROOT, filesRoot);

const OUT_ROOT = path.resolve(option('out', process.env.BACKUP_DIR || path.join(PROJECT_ROOT, 'backups')));
const KEEP = parseInt(option('keep', process.env.BACKUP_KEEP || '14'), 10);
const DB_URL = process.env.DATABASE_URL || 'postgres://validurehr:validurehr@localhost:5432/validurehr';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(OUT_ROOT, `validurehr-${stamp}`);

const log = (msg) => console.log(`[backup] ${msg}`);

/*
 * pg_dump, wherever it can be found. Tried in order:
 *   1. pg_dump on PATH             — a normal Postgres client install
 *   2. docker exec validurehr-db       — the self-hosted stack on this machine
 *   3. docker run postgres:16      — anything reachable by URL, incl. Supabase
 * Returning the strategy rather than hardcoding one keeps the same script
 * working before and after the migration.
 */
function dumpDatabase(outFile) {
  // The container fallback dumps the LOCAL stack's database. It must never be
  // tried when DATABASE_URL targets a remote server (Supabase): with the
  // container still present it would silently back up the wrong database.
  const isLocalTarget = /localhost|127\.0\.0\.1/.test(DB_URL);
  // node-postgres understands sslmode=no-verify; libpq (pg_dump) does not.
  // "require" is libpq's equivalent posture: encrypted, no CA verification.
  const dumpUrl = DB_URL.replace('sslmode=no-verify', 'sslmode=require');
  const attempts = [
    { label: 'pg_dump on PATH', cmd: 'pg_dump', args: ['--no-owner', '--no-privileges', dumpUrl] },
    ...(isLocalTarget ? [{
      label: 'docker exec validurehr-db',
      cmd: 'docker',
      args: ['exec', '-i', 'validurehr-db', 'pg_dump', '--no-owner', '--no-privileges', '-U', 'validurehr', '-d', 'validurehr'],
    }] : []),
    {
      /*
       * postgres:17, not 16: pg_dump refuses to dump a server NEWER than
       * itself ("server version mismatch"). Supabase runs Postgres 17 while
       * the self-hosted stack runs 16, and pg_dump 17 handles both — a v16
       * client would start failing silently the moment the database moved.
       */
      label: 'docker run postgres:17-alpine',
      cmd: 'docker',
      args: ['run', '--rm', '-i', '--network', 'host', 'postgres:17-alpine',
        'pg_dump', '--no-owner', '--no-privileges', dumpUrl],
    },
  ];

  for (const attempt of attempts) {
    const result = spawnSync(attempt.cmd, attempt.args, {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * 512,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) continue;
    if (!result.stdout || result.stdout.length === 0) continue;

    fs.writeFileSync(outFile, result.stdout);
    log(`database dumped via ${attempt.label} (${(result.stdout.length / 1024).toFixed(0)} KB)`);
    return true;
  }
  return false;
}

/** Copies every stored object out of the active storage driver. */
async function backupFiles(outDir) {
  const { driver, DRIVER_NAME } = require('../storage');
  if (typeof driver.list !== 'function') {
    log(`driver "${DRIVER_NAME}" cannot enumerate objects — skipping files`);
    return { count: 0, bytes: 0 };
  }

  // Enumerated from STORAGE, not from the database: a backup must capture
  // orphaned files too, and must not miss a row the query forgot to join.
  const keys = await driver.list('');
  let bytes = 0;

  for (const key of keys) {
    const object = await driver.getStream(key);
    if (!object) {
      log(`WARNING: listed but unreadable, skipped: ${key}`);
      continue;
    }
    const target = path.join(outDir, ...key.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await pipeline(object.stream, fs.createWriteStream(target));
    bytes += fs.statSync(target).size;
  }

  log(`${keys.length} file(s) copied (${(bytes / 1048576).toFixed(1)} MB) from driver "${DRIVER_NAME}"`);
  return { count: keys.length, bytes, keys };
}

/*
 * Cross-checks what we copied against what the database says exists.
 *
 * This caught a real failure: pointed at the wrong UPLOADS_ROOT, the backup
 * found an empty directory, copied nothing, and reported success. A backup that
 * silently captures no files is worse than none, because it is trusted. Every
 * file_name referenced by a tenant schema must appear in the copied set.
 */
/**
 * Runs a query and returns rows as arrays of strings, using whichever route to
 * the database works — a direct connection (Supabase, or any published port),
 * or psql inside the local container. The self-hosted stack does NOT publish
 * 5432, so from the host the container route is the only one available.
 */
function makeQueryRunner() {
  const direct = async (sql) => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      const { rows } = await client.query(sql);
      return rows.map((r) => Object.values(r).map((v) => (v === null ? '' : String(v))));
    } finally {
      await client.end().catch(() => {});
    }
  };

  const viaDocker = async (sql) => {
    const r = spawnSync('docker',
      ['exec', '-i', 'validurehr-db', 'psql', '-U', 'validurehr', '-d', 'validurehr', '-t', '-A', '-F', '\t', '-c', sql],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 * 64 });
    if (r.error || r.status !== 0) throw new Error((r.stderr || 'psql failed').trim().slice(0, 200));
    return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('\t'));
  };

  return async (sql) => {
    try {
      return await direct(sql);
    } catch {
      return viaDocker(sql);
    }
  };
}

/*
 * Cross-checks what we copied against what the database says exists.
 *
 * This caught a real failure: pointed at the wrong UPLOADS_ROOT, the backup
 * found an empty directory, copied nothing, and reported success. A backup that
 * silently captures no files is worse than none, because it is trusted. Every
 * file_name referenced by a tenant schema must appear in the copied set.
 */
async function verifyAgainstDatabase(copiedKeys) {
  const query = makeQueryRunner();
  const copied = new Set(copiedKeys.map((k) => k.split('/').pop()));
  const missing = [];

  let companies;
  try {
    companies = await query('SELECT slug, schema_name FROM companies');
  } catch (e) {
    log(`WARNING: could not reach the database to verify the file list (${e.message})`);
    return { checked: false, missing };
  }

  const sources = [
    ['policies', 'file_name', 'policies'],
    ['offer_letters', 'file_name', 'offers'],
    ['salary_slips', 'file_name', 'slips'],
    ['leave_applications', 'attachment_file', 'leave-docs'],
  ];

  try {
    for (const [slug, schema] of companies) {
      if (!/^c_[a-z0-9]{2,24}$/.test(schema)) continue;
      for (const [table, column, kind] of sources) {
        const rows = await query(
          `SELECT ${column} FROM ${schema}.${table} WHERE ${column} IS NOT NULL`);
        for (const [name] of rows) {
          if (name && !copied.has(name)) missing.push(`${slug}/${kind}/${name}`);
        }
      }
    }
  } catch (e) {
    log(`WARNING: verification query failed (${e.message})`);
    return { checked: false, missing };
  }

  return { checked: true, missing };
}

/** Removes the oldest backups, keeping the newest `keep`. */
function prune(keep) {
  if (!Number.isFinite(keep) || keep <= 0) return;
  const entries = fs.readdirSync(OUT_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^validurehr-\d{4}-\d{2}-\d{2}T/.test(e.name))
    .map((e) => e.name)
    .sort();
  const excess = entries.slice(0, Math.max(0, entries.length - keep));
  for (const name of excess) {
    fs.rmSync(path.join(OUT_ROOT, name), { recursive: true, force: true });
    log(`pruned old backup ${name}`);
  }
}

(async () => {
  try {
    fs.mkdirSync(dest, { recursive: true });
    log(`writing to ${dest}`);

    let dbOk = true;
    if (!flag('files-only')) {
      dbOk = dumpDatabase(path.join(dest, 'database.sql'));
      if (!dbOk) log('ERROR: could not dump the database by any method');
    }

    let files = { count: 0, keys: [] };
    let verification = { checked: false, missing: [] };
    if (!flag('db-only')) {
      files = await backupFiles(path.join(dest, 'files'));
      verification = await verifyAgainstDatabase(files.keys || []);
      if (verification.checked) {
        if (verification.missing.length) {
          log(`ERROR: ${verification.missing.length} file(s) referenced by the database were NOT backed up:`);
          for (const m of verification.missing.slice(0, 20)) log(`   missing: ${m}`);
          if (verification.missing.length > 20) log(`   ...and ${verification.missing.length - 20} more`);
        } else {
          log(`verified: every file referenced by the database was captured`);
        }
      }
    }

    fs.writeFileSync(path.join(dest, 'MANIFEST.txt'),
      [
        `ValidureHR backup`,
        `taken:    ${new Date().toISOString()}`,
        `database: ${dbOk ? 'database.sql' : 'FAILED'}`,
        `files:    ${files.count} object(s) under files/`,
        `verified: ${verification.checked
          ? (verification.missing.length ? `NO - ${verification.missing.length} referenced file(s) missing` : 'yes')
          : 'not checked (database unreachable)'}`,
        ``,
        `Restore the database with:`,
        `  psql "<target-connection-string>" < database.sql`,
        ``,
        `Restore files by copying files/<slug>/<kind>/... back into the active`,
        `storage backend (data/uploads for local, or the bucket for Supabase —`,
        `see src/scripts/migrateFilesToSupabase.js).`,
      ].join('\n'));

    prune(KEEP);

    if (!dbOk && !flag('files-only')) {
      log('FINISHED WITH ERRORS — the database was not backed up.');
      process.exit(1);
    }
    // A backup missing files it was supposed to hold must not look successful.
    if (verification.checked && verification.missing.length) {
      log('FINISHED WITH ERRORS — this backup is INCOMPLETE. Check STORAGE_DRIVER / UPLOADS_ROOT.');
      process.exit(2);
    }
    log('done.');
  } catch (e) {
    console.error(`[backup] FAILED: ${e.message}`);
    process.exit(1);
  }
})();
