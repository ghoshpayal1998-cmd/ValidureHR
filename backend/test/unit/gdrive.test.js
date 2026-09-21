/*
 * Google Drive client for the off-site backup.
 *
 * The failure modes that matter are the silent ones: a refresh token that
 * quietly expired (an unpublished OAuth app revokes them after 7 days), and
 * credentials that belong to a service account, which has no Drive quota and
 * so can never store anything. Both produce opaque Google errors, so the
 * client is expected to translate them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const GDRIVE = path.join(__dirname, '..', '..', 'src', 'gdrive.js');

function loadFresh(env = {}) {
  delete require.cache[require.resolve(GDRIVE)];
  const saved = {};
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GDRIVE_FOLDER_NAME']) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  const mod = require(GDRIVE);
  return { mod, restore: () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  } };
}

const FULL_ENV = {
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REFRESH_TOKEN: '1//refresh',
};

test('missing Google credentials name exactly what is absent', () => {
  const { mod, restore } = loadFresh({ GOOGLE_CLIENT_ID: 'id' });
  try {
    assert.throws(() => mod.getConfig(), /GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN/);
  } finally { restore(); }
});

test('the backup folder name is configurable and defaults sensibly', () => {
  let { mod, restore } = loadFresh(FULL_ENV);
  try {
    assert.equal(mod.getConfig().folderName, 'ValidureHR Backups');
  } finally { restore(); }

  ({ mod, restore } = loadFresh({ ...FULL_ENV, GDRIVE_FOLDER_NAME: 'Payroll Archive' }));
  try {
    assert.equal(mod.getConfig().folderName, 'Payroll Archive');
  } finally { restore(); }
});

test('an expired refresh token explains the "Testing" consent-screen trap', async () => {
  const { mod, restore } = loadFresh(FULL_ENV);
  const realFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}',
  });
  try {
    await assert.rejects(() => mod.getAccessToken(), /publish it and generate a new token/);
  } finally { global.fetch = realFetch; restore(); }
});

test('a service-account quota failure on upload says so plainly', async () => {
  const { mod, restore } = loadFresh(FULL_ENV);
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
    }
    return {
      ok: false,
      status: 403,
      text: async () => '{"error":{"errors":[{"reason":"storageQuotaExceeded"}]}}',
    };
  };
  try {
    await assert.rejects(
      () => mod.uploadFile('b.tar.gz', Buffer.from('x'), 'application/gzip', 'folder1'),
      /service account \(which has no Drive quota\)/);
  } finally { global.fetch = realFetch; restore(); }
});

test('retention deletes permanently — trashed files still consume the quota', async () => {
  const { mod, restore } = loadFresh(FULL_ENV);
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
    }
    calls.push({ url: String(url), method: options.method || 'GET' });
    return { ok: true, status: 204, json: async () => null };
  };
  try {
    await mod.deleteFile('file123');
    assert.equal(calls[0].method, 'DELETE');
    // Not ?trashed=true — a trashed file keeps occupying Drive storage for 30
    // days, so retention would free nothing.
    assert.match(calls[0].url, /\/files\/file123$/);
  } finally { global.fetch = realFetch; restore(); }
});

test('uploads are addressed into the backup folder', async () => {
  const { mod, restore } = loadFresh(FULL_ENV);
  const realFetch = global.fetch;
  let uploadBody = null;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
    }
    uploadBody = options.body.toString('utf8');
    return { ok: true, status: 200, json: async () => ({ id: 'f1', name: 'b.tar.gz' }) };
  };
  try {
    await mod.uploadFile('b.tar.gz', Buffer.from('payload'), 'application/gzip', 'folder-abc');
    assert.match(uploadBody, /"parents":\["folder-abc"\]/);
    assert.match(uploadBody, /payload/);
  } finally { global.fetch = realFetch; restore(); }
});
