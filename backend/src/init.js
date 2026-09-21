/*
 * Production initializer — idempotent, safe to run on every start.
 * Creates the public (platform) schema and the default platform admin.
 * Companies (each with its own schema, roles and leave types) are created by the
 * admin from the UI. No dummy/demo data. Demo data: npm run seed:demo
 */
const bcrypt = require('bcryptjs');
const { q, qOne, pool, initSchema } = require('./db');
const { requireAdminPassword, requireJwtSecret } = require('./config');

(async () => {
  try {
    // Same gate as the API. A deployment that would boot the server with a
    // forgeable secret should fail here, before any data is touched.
    requireJwtSecret();

    await initSchema();

    const admin = await qOne(`SELECT id FROM admins LIMIT 1`);
    if (!admin) {
      // Only enforced when the account is actually being created, so an
      // existing deployment that has since changed its admin password in the UI
      // is not forced to keep ADMIN_PASSWORD set.
      const password = requireAdminPassword();
      await q(`INSERT INTO admins (username, email, password_hash) VALUES ('admin','admin@validuresolutions.com',$1)`,
        [bcrypt.hashSync(password, 10)]);
      console.log('[init] Platform admin created (username: admin) with the password from ADMIN_PASSWORD.');
    } else {
      console.log('[init] Platform admin already exists — skipping.');
    }

    console.log('[init] Database ready.');
    await pool.end();
  } catch (e) {
    console.error('[init] FAILED:', e.message);
    process.exit(1);
  }
})();
