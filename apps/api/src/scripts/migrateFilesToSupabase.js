/*
 * One-off migration: copy every stored document from local disk into the
 * Supabase Storage bucket.
 *
 * Safe to re-run. Uploads overwrite by key, and the script verifies afterwards
 * that every file the database references is readable from the bucket — so a
 * partial run followed by a second run converges rather than leaving a gap.
 *
 * NOTHING IS DELETED from local disk. Keep it until you have watched the app
 * serve documents from Supabase for a while; reverting is then just flipping
 * STORAGE_DRIVER back to "local".
 *
 * Usage:
 *   node src/scripts/migrateFilesToSupabase.js --from ../data/uploads [--dry-run]
 *
 * Required env (see .env.example):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET
 */
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const FROM = path.resolve(PROJECT_ROOT, option('from', process.env.UPLOADS_ROOT || './data/uploads'));
const DRY = flag('dry-run');

const log = (m) => console.log(`[migrate] ${m}`);

// The source is always the local driver, loaded with an explicit root so it
// reads the host-side uploads directory regardless of STORAGE_DRIVER.
process.env.UPLOADS_ROOT = FROM;
const source = require('../storageDrivers/local');
const target = require('../storageDrivers/supabase');

const CONTENT_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'], ['.webp', 'image/webp'], ['.heic', 'image/heic'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
]);

/** Reads a stream fully into a buffer. Files are capped at 10 MB by the uploader. */
async function toBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/*
 * Every file_name the database references, as "<slug>/<kind>/<name>" keys.
 * Assembled per company because the tables live in per-company schemas, and
 * queried through the container since the self-hosted stack does not publish
 * Postgres on the host.
 */
function referencedKeys() {
  const run = (q) => {
    const r = spawnSync('docker',
      ['exec', '-i', 'validurehr-db', 'psql', '-U', 'validurehr', '-d', 'validurehr', '-t', '-A', '-F', '\t', '-c', q],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 * 64 });
    if (r.error || r.status !== 0) return null;
    return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('\t'));
  };

  const companies = run('SELECT slug, schema_name FROM companies');
  if (!companies) return null;

  const keys = [];
  const sources = [
    ['policies', 'file_name', 'policies'],
    ['offer_letters', 'file_name', 'offers'],
    ['salary_slips', 'file_name', 'slips'],
    ['leave_applications', 'attachment_file', 'leave-docs'],
  ];
  for (const [slug, schema] of companies) {
    if (!/^c_[a-z0-9]{2,24}$/.test(schema)) continue;
    for (const [table, column, kind] of sources) {
      const rows = run(`SELECT ${column} FROM ${schema}.${table} WHERE ${column} IS NOT NULL`);
      if (!rows) continue;
      for (const [name] of rows) if (name) keys.push(`${slug}/${kind}/${name}`);
    }
  }
  return keys;
}

(async () => {
  try {
    // Fails fast with a clear message if the credentials are missing or wrong.
    const cfg = target.getConfig();
    log(`source : ${FROM}`);
    log(`target : ${cfg.url} bucket "${cfg.bucket}"`);
    if (DRY) log('DRY RUN — nothing will be uploaded');

    const keys = await source.list('');
    if (keys.length === 0) {
      log('ERROR: no files found at the source. Check --from / UPLOADS_ROOT.');
      process.exit(1);
    }
    log(`${keys.length} file(s) to copy`);

    let copied = 0;
    let bytes = 0;
    const failures = [];

    for (const key of keys) {
      const object = await source.getStream(key);
      if (!object) { failures.push(`${key} (unreadable at source)`); continue; }
      const buffer = await toBuffer(object.stream);
      const type = CONTENT_TYPES.get(path.extname(key).toLowerCase()) || 'application/octet-stream';

      if (DRY) {
        log(`would upload ${key} (${(buffer.length / 1024).toFixed(0)} KB, ${type})`);
      } else {
        try {
          await target.put(key, buffer, type);
          copied++;
          bytes += buffer.length;
          log(`uploaded ${key} (${(buffer.length / 1024).toFixed(0)} KB)`);
        } catch (e) {
          failures.push(`${key} (${e.message})`);
        }
      }
    }

    if (DRY) { log('dry run complete.'); return; }

    log(`copied ${copied}/${keys.length} file(s), ${(bytes / 1048576).toFixed(1)} MB`);

    /*
     * Verify against the DATABASE, not against the source listing: the point of
     * the migration is that the app can still serve every document it has a row
     * for. An orphan left behind on disk is untidy; a missing payslip is not.
     */
    const referenced = referencedKeys();
    if (referenced === null) {
      log('WARNING: could not reach the database to verify — check manually before switching over.');
    } else {
      const missing = [];
      for (const key of referenced) {
        const found = await target.getStream(key).catch(() => null);
        if (!found) missing.push(key);
        else if (found.stream.destroy) found.stream.destroy();
      }
      if (missing.length) {
        log(`ERROR: ${missing.length} referenced file(s) are NOT readable from the bucket:`);
        for (const m of missing.slice(0, 20)) log(`   missing: ${m}`);
        failures.push(...missing.map((m) => `${m} (not in bucket)`));
      } else {
        log(`verified: all ${referenced.length} database-referenced file(s) readable from Supabase`);
      }
    }

    if (failures.length) {
      log(`FINISHED WITH ${failures.length} PROBLEM(S) — do not switch STORAGE_DRIVER yet.`);
      process.exit(1);
    }

    log('done. Set STORAGE_DRIVER=supabase to serve from the bucket.');
    log('Local files were left in place — keep them until you are confident.');
  } catch (e) {
    console.error(`[migrate] FAILED: ${e.message}`);
    process.exit(1);
  }
})();
