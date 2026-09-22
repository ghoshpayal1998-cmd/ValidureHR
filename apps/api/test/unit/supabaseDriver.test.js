/*
 * Supabase Storage driver contract.
 *
 * There is no live Supabase project in the suite, so `fetch` is stubbed and the
 * REQUESTS are asserted: the URL that gets built, the credentials that are
 * attached, and how each response status is interpreted. That is where the
 * mistakes actually live — a mis-encoded key or a swallowed 404 would show up
 * in production as a missing payslip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Readable } = require('stream');

const DRIVER = path.join(__dirname, '..', '..', 'src', 'storageDrivers', 'supabase.js');

/** Loads a fresh copy of the driver with the given env, and a recording fetch. */
function loadDriver(env = {}, responder = () => ({ ok: true, status: 200 })) {
  delete require.cache[require.resolve(DRIVER)];
  const saved = { ...process.env };
  Object.assign(process.env, {
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    SUPABASE_STORAGE_BUCKET: 'documents',
    ...env,
  });
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];

  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const r = responder(String(url), options);
    return {
      ok: r.ok !== undefined ? r.ok : r.status < 400,
      status: r.status,
      body: r.body,
      headers: { get: (h) => (r.headers || {})[h.toLowerCase()] },
      text: async () => r.text || '',
    };
  };

  const driver = require(DRIVER);
  const restore = () => {
    global.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    delete require.cache[require.resolve(DRIVER)];
  };
  return { driver, calls, restore };
}

test('upload targets the right bucket and object path', async () => {
  const { driver, calls, restore } = loadDriver();
  try {
    await driver.put('ftr/slips/1786-payslip.pdf', Buffer.from('%PDF'), 'application/pdf');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://proj.supabase.co/storage/v1/object/documents/ftr/slips/1786-payslip.pdf');
    assert.equal(calls[0].options.method, 'POST');
  } finally { restore(); }
});

test('upload sends the service-role credentials', async () => {
  const { driver, calls, restore } = loadDriver();
  try {
    await driver.put('ftr/slips/a.pdf', Buffer.from('x'), 'application/pdf');
    const headers = calls[0].options.headers;
    assert.equal(headers.Authorization, 'Bearer service-role-secret');
    assert.equal(headers.apikey, 'service-role-secret');
    assert.equal(headers['Content-Type'], 'application/pdf');
  } finally { restore(); }
});

test('upload replaces an existing object rather than erroring', async () => {
  // Matches local-disk behaviour, where writing the same name overwrites.
  const { driver, calls, restore } = loadDriver();
  try {
    await driver.put('ftr/slips/a.pdf', Buffer.from('x'), 'application/pdf');
    assert.equal(calls[0].options.headers['x-upsert'], 'true');
  } finally { restore(); }
});

test('path separators survive encoding but unsafe characters do not', async () => {
  const { driver, calls, restore } = loadDriver();
  try {
    await driver.put('ftr/leave-docs/my file #1.pdf', Buffer.from('x'), 'application/pdf');
    const url = calls[0].url;
    // The three prefix separators must remain real separators...
    assert.match(url, /\/documents\/ftr\/leave-docs\//);
    // ...while the space and hash inside the name are escaped.
    assert.match(url, /my%20file%20%231\.pdf$/);
  } finally { restore(); }
});

test('a failed upload throws with the status attached', async () => {
  const { driver, restore } = loadDriver({}, () => ({ status: 403, text: 'Forbidden' }));
  try {
    await assert.rejects(
      () => driver.put('ftr/slips/a.pdf', Buffer.from('x'), 'application/pdf'),
      /upload failed \(403\)/,
    );
  } finally { restore(); }
});

test('download returns a stream for an object that exists', async () => {
  const { driver, restore } = loadDriver({}, () => ({
    status: 200,
    body: Readable.toWeb(Readable.from([Buffer.from('%PDF-1.4')])),
    headers: { 'content-length': '8', 'content-type': 'application/pdf' },
  }));
  try {
    const object = await driver.getStream('ftr/slips/a.pdf');
    assert.ok(object, 'expected an object');
    assert.equal(object.size, 8);
    const chunks = [];
    for await (const c of object.stream) chunks.push(c);
    assert.equal(Buffer.concat(chunks).toString(), '%PDF-1.4');
  } finally { restore(); }
});

test('a missing object reports absence instead of throwing', async () => {
  // The database can reference a file that was deleted from the bucket; that is
  // a 404 to the user, not a 500.
  for (const status of [404, 400]) {
    const { driver, restore } = loadDriver({}, () => ({ status }));
    try {
      assert.equal(await driver.getStream('ftr/slips/gone.pdf'), null);
    } finally { restore(); }
  }
});

test('a server error on download does throw', async () => {
  const { driver, restore } = loadDriver({}, () => ({ status: 500, text: 'boom' }));
  try {
    await assert.rejects(() => driver.getStream('ftr/slips/a.pdf'), /download failed \(500\)/);
  } finally { restore(); }
});

test('delete tolerates an already-absent object', async () => {
  const { driver, restore } = loadDriver({}, () => ({ status: 404 }));
  try {
    await driver.remove('ftr/slips/gone.pdf');
  } finally { restore(); }
});

/* ---- configuration is validated, and fails closed ---- */

test('missing SUPABASE_URL is a clear error, not an obscure fetch failure', async () => {
  const { driver, restore } = loadDriver({ SUPABASE_URL: undefined });
  try {
    await assert.rejects(() => driver.put('ftr/slips/a.pdf', Buffer.from('x')), /SUPABASE_URL is not set/);
  } finally { restore(); }
});

test('missing service-role key is a clear error', async () => {
  const { driver, restore } = loadDriver({ SUPABASE_SERVICE_ROLE_KEY: undefined });
  try {
    await assert.rejects(() => driver.put('ftr/slips/a.pdf', Buffer.from('x')), /SERVICE_ROLE_KEY is not set/);
  } finally { restore(); }
});

test('the legacy anon key is rejected — it cannot write to a private bucket', async () => {
  // Easy mix-up in the dashboard, and the failure it causes otherwise is an
  // opaque 403 at upload time rather than at boot.
  const { driver, restore } = loadDriver({ SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOi.anon.key' });
  try {
    await assert.rejects(() => driver.put('ftr/slips/a.pdf', Buffer.from('x')), /PUBLISHABLE\/anon key/);
  } finally { restore(); }
});

test('the newer sb_publishable_ key is rejected too', async () => {
  // Supabase renamed the pair to sb_publishable_ / sb_secret_. The publishable
  // key contains no "anon" substring, so the original guard would have waved it
  // straight through and failed with a 403 on the first upload instead.
  const { driver, restore } = loadDriver({
    SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_n2_qMJztCsFaHV_kpK2mcw_fwTXx7GP',
  });
  try {
    await assert.rejects(() => driver.put('ftr/slips/a.pdf', Buffer.from('x')), /PUBLISHABLE\/anon key/);
  } finally { restore(); }
});

test('an sb_secret_ key is accepted', async () => {
  // The guard must recognise the SAFE value, not try to pattern-match secrets —
  // otherwise a future key format would be rejected as invalid.
  const { driver, calls, restore } = loadDriver({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_examplekeyvalue123' });
  try {
    await driver.put('ftr/slips/a.pdf', Buffer.from('x'), 'application/pdf');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer sb_secret_examplekeyvalue123');
  } finally { restore(); }
});

test('a trailing slash on SUPABASE_URL does not produce a double slash', async () => {
  const { driver, calls, restore } = loadDriver({ SUPABASE_URL: 'https://proj.supabase.co/' });
  try {
    await driver.put('ftr/slips/a.pdf', Buffer.from('x'), 'application/pdf');
    assert.doesNotMatch(calls[0].url.replace('https://', ''), /\/\//);
  } finally { restore(); }
});

test('the bucket name is configurable', async () => {
  const { driver, calls, restore } = loadDriver({ SUPABASE_STORAGE_BUCKET: 'hr-files' });
  try {
    await driver.put('ftr/slips/a.pdf', Buffer.from('x'), 'application/pdf');
    assert.match(calls[0].url, /\/object\/hr-files\//);
  } finally { restore(); }
});
