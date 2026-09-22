/*
 * Minimal Google Drive client — upload, list and delete, over plain fetch.
 *
 * No googleapis SDK on purpose: that package pulls in a large dependency tree
 * for three REST calls, and this service runs on a 512 MB free instance.
 * Mirrors the approach in storageDrivers/supabase.js.
 *
 * AUTH MODEL
 * ----------
 * A refresh token belonging to the owner's own Google account, not a service
 * account. Service accounts have no Drive storage quota of their own, so
 * uploading to a consumer account's Drive with one fails with
 * "storageQuotaExceeded" unless a Workspace Shared Drive is involved. The
 * refresh-token flow stores the files in the owner's Drive, against the
 * owner's 15 GB, which is what "put the backups in my Drive" actually means.
 *
 * SCOPE: drive.file — access limited to files this app itself created. It
 * cannot read the rest of the owner's Drive, which is the least privilege that
 * still allows writing and pruning backups. It is also a non-sensitive scope,
 * so the OAuth consent screen can be published without Google review (and an
 * unpublished "Testing" app expires its refresh token after 7 days, which
 * would silently stop backups a week after setup).
 *
 * Required env:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 * Optional:
 *   GDRIVE_FOLDER_NAME (default "ValidureHR Backups")
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function getConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const missing = [
    !clientId && 'GOOGLE_CLIENT_ID',
    !clientSecret && 'GOOGLE_CLIENT_SECRET',
    !refreshToken && 'GOOGLE_REFRESH_TOKEN',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Google Drive is not configured — missing ${missing.join(', ')}`);
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    folderName: process.env.GDRIVE_FOLDER_NAME || 'ValidureHR Backups',
  };
}

/*
 * Access tokens last an hour. The backup runs once a day, so caching is only
 * to avoid a second round trip within one run — not worth persisting.
 */
let cached = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (cached.token && Date.now() < cached.expiresAt - 30000) return cached.token;
  const cfg = getConfig();

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    /*
     * invalid_grant here almost always means the refresh token was revoked or
     * expired — the usual cause being an OAuth consent screen left in
     * "Testing", where Google expires refresh tokens after 7 days. Say so,
     * because the raw error does not.
     */
    const hint = text.includes('invalid_grant')
      ? ' — the refresh token is no longer valid. If the OAuth consent screen is still in "Testing", publish it and generate a new token.'
      : '';
    throw new Error(`Google auth failed (${res.status}): ${text.slice(0, 200)}${hint}`);
  }

  const data = JSON.parse(text);
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cached.token;
}

async function api(pathAndQuery, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API}${pathAndQuery}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Drive ${options.method || 'GET'} ${pathAndQuery} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * The backup folder, created on first use. Under drive.file the search only
 * ever returns folders this app created, so this cannot collide with an
 * unrelated folder of the same name in the owner's Drive.
 */
async function ensureFolder() {
  const { folderName } = getConfig();
  const q = encodeURIComponent(
    `mimeType='${FOLDER_MIME}' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`);
  const found = await api(`/files?q=${q}&fields=files(id,name)&pageSize=10`);
  if (found.files && found.files.length) return found.files[0].id;

  const created = await api('/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME }),
  });
  return created.id;
}

/**
 * Uploads a buffer as a new file. Multipart (metadata + bytes in one request)
 * is fine for backups of this size; resumable upload would only matter past
 * ~5 MB of unreliable network, and a failed run simply retries tomorrow.
 */
async function uploadFile(name, buffer, mimeType, folderId) {
  const token = await getAccessToken();
  const boundary = `validurehr${Date.now().toString(16)}`;
  const metadata = JSON.stringify({ name, parents: folderId ? [folderId] : undefined });

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,size`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const hint = text.includes('storageQuotaExceeded')
      ? ' — the Drive account is out of space, or the credentials belong to a service account (which has no Drive quota).'
      : '';
    throw new Error(`Google Drive upload failed (${res.status}): ${text.slice(0, 200)}${hint}`);
  }
  return res.json();
}

/** Backup files in the folder, newest first. */
async function listBackups(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const data = await api(`/files?q=${q}&fields=files(id,name,createdTime,size)&orderBy=createdTime desc&pageSize=200`);
  return data.files || [];
}

/**
 * Permanently deletes. Not "trash": a trashed file still occupies the owner's
 * quota for 30 days, so retention would not actually free anything.
 */
async function deleteFile(id) {
  await api(`/files/${id}`, { method: 'DELETE' });
}

module.exports = { getConfig, getAccessToken, ensureFolder, uploadFile, listBackups, deleteFile };
