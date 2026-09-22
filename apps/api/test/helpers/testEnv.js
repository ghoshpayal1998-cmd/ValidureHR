/*
 * Test environment bootstrap.
 *
 * Must be required BEFORE anything that pulls in src/config.js or src/db.js:
 *  - config.js validates JWT_SECRET at require() time and throws without one;
 *  - db.js opens a pg Pool at require() time, which we replace with a fake so
 *    the suite never touches a real database (least of all the production one
 *    this project runs against).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

/*
 * Uploads that get past the fileFilter are written to disk by multer before the
 * route handler ever runs. Without this the suite drops fixture PDFs into the
 * application's real uploads tree on every run. Must be set before storage.js
 * is required, since it resolves the root at load time.
 */
const TEST_UPLOADS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'vhr-uploads-'));
process.env.UPLOADS_ROOT = TEST_UPLOADS_ROOT;
process.on('exit', () => {
  try { fs.rmSync(TEST_UPLOADS_ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

// A valid secret that is not on the published-secrets list.
const TEST_JWT_SECRET = 'test-secret-do-not-use-in-production-0123456789abcdef';
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password-123';
process.env.NODE_ENV = 'test';
// Keep the login limiter out of the way unless a test opts in.
process.env.LOGIN_RATE_MAX = process.env.LOGIN_RATE_MAX || '1000';

const SRC = path.join(__dirname, '..', '..', 'src');
const DB_PATH = require.resolve(path.join(SRC, 'db.js'));
const MAILER_PATH = require.resolve(path.join(SRC, 'mailer.js'));
const NOTIFICATIONS_PATH = require.resolve(path.join(SRC, 'notifications.js'));

/**
 * Installs a module into require.cache so every later `require()` of that path
 * resolves to the stub instead of the real file.
 */
function stubModule(resolvedPath, exports) {
  const stub = new Module(resolvedPath, null);
  stub.filename = resolvedPath;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[resolvedPath] = stub;
  return exports;
}

/*
 * A tiny query router. Handlers are [matcher, responder] pairs; the first
 * matcher whose RegExp (or predicate) matches the SQL wins, and the responder
 * returns the rows. Matching on SQL text is crude, but it keeps the tests
 * honest about which query a route actually issues.
 */
function createFakeDb() {
  const handlers = [];
  const calls = [];

  function on(matcher, responder) {
    handlers.push([matcher, responder]);
    return api;
  }

  function resolve(sql, params) {
    calls.push({ sql, params });
    for (const [matcher, responder] of handlers) {
      const hit = typeof matcher === 'function' ? matcher(sql, params) : matcher.test(sql);
      if (hit) {
        const rows = typeof responder === 'function' ? responder(sql, params) : responder;
        return Promise.resolve(Array.isArray(rows) ? rows : rows === undefined ? [] : [rows]);
      }
    }
    return Promise.reject(new Error(`No fake DB handler for query: ${String(sql).trim().slice(0, 160)}`));
  }

  const assertSchema = (schema) => {
    if (!/^c_[a-z0-9]{2,24}$/.test(schema)) throw new Error(`Invalid tenant schema: ${schema}`);
    return schema;
  };
  const ts = (schema, sql) => sql.replaceAll('{s}', assertSchema(schema));

  const q = (sql, params) => resolve(sql, params);
  const qOne = async (sql, params) => (await resolve(sql, params))[0];
  const tq = (schema, sql, params) => resolve(ts(schema, sql), params);
  const tqOne = async (schema, sql, params) => (await resolve(ts(schema, sql), params))[0];

  const api = {
    on,
    calls,
    reset() { handlers.length = 0; calls.length = 0; },
    exports: {
      pool: { query: (sql, params) => resolve(sql, params).then((rows) => ({ rows })), connect: async () => ({ query: async () => ({ rows: [] }), release() {} }), end: async () => {} },
      q, qOne, tq, tqOne, ts, assertSchema,
      initSchema: async () => {},
      createTenantSchema: async () => {},
      syncSystemRoles: async () => {},
    },
  };
  return api;
}

const fakeDb = createFakeDb();
stubModule(DB_PATH, fakeDb.exports);

// Mail and in-app notifications are side effects on a live SMTP account and a
// real table — never exercised by the suite.
const sentMail = [];
stubModule(MAILER_PATH, {
  sendMail: (schema, to, subject, body) => { sentMail.push({ schema, to, subject, body }); },
});
const notifications = [];
stubModule(NOTIFICATIONS_PATH, {
  addNotification: async (schema, employeeId, title, body, link) => {
    notifications.push({ schema, employeeId, title, body, link });
  },
});

module.exports = { fakeDb, sentMail, notifications, TEST_JWT_SECRET, SRC, stubModule };
