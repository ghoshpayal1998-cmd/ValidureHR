/*
 * Supabase Storage driver.
 *
 * For hosts with no persistent disk — Render's free instances wipe the
 * filesystem on every spin-down and redeploy, so an uploaded payslip written to
 * local disk there is simply gone. Objects live in one private bucket, keyed
 * "<slug>/<kind>/<file>", which is the same layout the local driver uses on
 * disk, so the two are interchangeable and a migration is a straight copy.
 *
 * Talks to the Storage REST API with the built-in fetch (Node 18+) rather than
 * @supabase/supabase-js: the four operations below are all this needs, and it
 * avoids pulling a large dependency — and its transitive tree — into a service
 * that handles PAN numbers and bank details.
 *
 * THE BUCKET MUST BE PRIVATE. Downloads are streamed back through Express so
 * that the ownership checks in documents.js and leaves.js still run — an
 * employee may fetch only their own payslip, offer letter and leave attachment.
 * A public bucket, or a signed URL handed to the browser, would route around
 * those checks entirely.
 */
const { Readable } = require('stream');

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'documents';

/*
 * Validated lazily, on first use rather than at require() time, so that a
 * deployment running the local driver never needs Supabase configured — and so
 * the test suite can load this module without credentials.
 */
let config = null;

function getConfig() {
  if (config) return config;

  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url) {
    throw new Error('SUPABASE_URL is not set — required when STORAGE_DRIVER=supabase.');
  }
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — required when STORAGE_DRIVER=supabase.');
  }
  /*
   * This key bypasses row-level security by design. It belongs on the server
   * only; if it ever reaches a browser bundle, every tenant's files are
   * readable. The public key is not a substitute — it cannot write to a private
   * bucket — so catch the likely mix-up here rather than failing later with an
   * opaque 403.
   *
   * Two naming generations are in play: the legacy `anon` / `service_role`
   * pair, and the newer `sb_publishable_` / `sb_secret_` prefixes. Only the
   * public half of either generation is rejected — matching on the SAFE value
   * rather than trying to recognise the secret one, since a new secret format
   * would otherwise be silently accepted as valid.
   */
  if (/^sb_publishable_/.test(key) || /anon/i.test(key)) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is set to a PUBLISHABLE/anon key. Use the secret key '
      + '(sb_secret_… or the legacy service_role key) — server-side only, never in a frontend build.'
    );
  }

  config = { url, key, bucket: BUCKET };
  return config;
}

function objectUrl(key) {
  const { url, bucket } = getConfig();
  // Each path segment is encoded separately so the "/" separators survive.
  const encoded = String(key).split('/').map(encodeURIComponent).join('/');
  return `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`;
}

function authHeaders() {
  const { key } = getConfig();
  return { Authorization: `Bearer ${key}`, apikey: key };
}

/** Buckets have no directories, so there is nothing to create per company. */
function ensureCompany() { /* no-op */ }

async function put(key, buffer, contentType) {
  const res = await fetch(objectUrl(key), {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': contentType || 'application/octet-stream',
      // Re-uploading the same key replaces it, matching local-disk behaviour.
      'x-upsert': 'true',
      'Content-Length': Buffer.byteLength(buffer).toString(),
    },
    body: buffer,
    duplex: 'half', // Sometimes required by Node's fetch for bodies
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase Storage upload failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

/**
 * Returns a Node readable stream for the object, or null when it is absent.
 * A 404 is a normal outcome — the database can reference a file that was
 * deleted from the bucket — so it reports absence instead of throwing.
 */
async function getStream(key) {
  const res = await fetch(objectUrl(key), { headers: authHeaders() });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase Storage download failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  if (!res.body) return null;

  const length = Number(res.headers.get('content-length'));
  return {
    stream: Readable.fromWeb(res.body),
    size: Number.isFinite(length) ? length : undefined,
    // Deliberately NOT used to set the response Content-Type: it is echoed from
    // whatever was uploaded. The facade derives the type from the extension it
    // validated at upload time instead.
    remoteContentType: res.headers.get('content-type') || undefined,
  };
}

/*
 * There is no cheap synchronous existence check against a remote bucket. The
 * facade treats "unknown" as present and lets sendUserFile issue the 404 once
 * the fetch comes back, which costs one round-trip instead of two.
 */
function existsSync() {
  return true;
}

/**
 * Every object key under `prefix`, paging until the bucket is exhausted.
 *
 * Supabase's list endpoint is directory-shaped: it returns immediate children,
 * with folders marked by a null `id`, so this recurses. Used by the backup
 * script — which matters more here than usual, because Supabase does not back
 * up Storage objects on ANY plan.
 */
async function list(prefix = '') {
  const { url, bucket } = getConfig();
  const endpoint = `${url}/storage/v1/object/list/${encodeURIComponent(bucket)}`;
  const PAGE = 100;
  const keys = [];

  async function page(folder) {
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: folder, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Supabase Storage list failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) return;

      for (const item of items) {
        const child = folder ? `${folder}/${item.name}` : item.name;
        // A null id marks a folder rather than an object.
        if (item.id === null || item.id === undefined) await page(child);
        else keys.push(child);
      }
      if (items.length < PAGE) return;
    }
  }

  await page(prefix.replace(/\/+$/, ''));
  return keys;
}

async function remove(key) {
  const res = await fetch(objectUrl(key), { method: 'DELETE', headers: authHeaders() });
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase Storage delete failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

module.exports = {
  name: 'supabase',
  bucket: BUCKET,
  ensureCompany,
  put,
  getStream,
  existsSync,
  remove,
  list,
  // Exposed for the migration script and for a startup self-check.
  getConfig,
  objectUrl,
};
