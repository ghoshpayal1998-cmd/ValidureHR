/*
 * Local-disk storage driver.
 *
 * This is the behaviour the app has always had: files under
 *   uploads/<slug>/<kind>/<file>
 * mirroring the per-schema database isolation. In Docker that directory is a
 * bind mount (./data/uploads on the host), so it survives container restarts.
 *
 * Kept as a first-class driver rather than deleted, because it is still the
 * right choice for the self-hosted deployment: no network round-trip per
 * download, no third-party holding payroll documents. The Supabase driver
 * exists for hosts with no persistent disk (Render free, Lambda).
 */
const path = require('path');
const fs = require('fs');

/*
 * Overridable so a deployment can place tenant files on another volume, and so
 * the test suite can point at a temp directory instead of writing fixtures into
 * the real upload tree.
 */
const UPLOADS_ROOT = process.env.UPLOADS_ROOT
  ? path.resolve(process.env.UPLOADS_ROOT)
  : path.join(__dirname, '..', '..', 'uploads');

/**
 * Resolves an object key ("<slug>/<kind>/<file>") to an absolute path, refusing
 * anything that would escape UPLOADS_ROOT. The key is built from a validated
 * slug and kind, but this is the last line before the filesystem, so it checks
 * again rather than trusting the caller.
 */
function resolveKey(key) {
  const full = path.resolve(UPLOADS_ROOT, key);
  const root = path.resolve(UPLOADS_ROOT);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Resolved path escapes the uploads root');
  }
  return full;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Creates the per-company folder tree. No-op if it already exists. */
function ensureCompany(slug, kinds) {
  for (const kind of kinds) ensureDir(path.join(UPLOADS_ROOT, slug, kind));
}

async function put(key, buffer) {
  const full = resolveKey(key);
  ensureDir(path.dirname(full));
  await fs.promises.writeFile(full, buffer);
}

/**
 * Returns a readable stream for the object, or null when it does not exist.
 * Missing files are a normal outcome here — the database can reference a file
 * that was removed from disk — so this reports absence rather than throwing.
 */
async function getStream(key) {
  let full;
  try {
    full = resolveKey(key);
  } catch {
    return null;
  }
  let stat;
  try {
    stat = await fs.promises.stat(full);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  return { stream: fs.createReadStream(full), size: stat.size };
}

/*
 * Synchronous existence check. Only the local driver can answer this without a
 * network call; the facade uses it to preserve the original "File missing on
 * server" 404 that routes expect before they start streaming.
 */
function existsSync(key) {
  try {
    return fs.existsSync(resolveKey(key));
  } catch {
    return false;
  }
}

async function remove(key) {
  try {
    await fs.promises.unlink(resolveKey(key));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

/**
 * Every object key under `prefix`. Used by the backup script, which cannot rely
 * on the database to enumerate files — a backup has to capture orphans too
 * (there are currently 4 files on disk with no matching database row).
 */
async function list(prefix = '') {
  const root = path.resolve(UPLOADS_ROOT);
  const start = prefix ? resolveKey(prefix) : root;
  const keys = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) keys.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }

  await walk(start);
  return keys;
}

module.exports = {
  name: 'local',
  root: UPLOADS_ROOT,
  ensureCompany,
  put,
  getStream,
  existsSync,
  remove,
  list,
};
