/*
 * Break-glass platform-admin recovery.
 *
 * Restores the platform admin to a known username and a new password when
 * nobody can sign in any more — forgotten credentials, or an account locked by
 * repeated failed attempts.
 *
 * THIS IS DELIBERATELY NOT AN API ROUTE. An endpoint that resets the admin
 * password without authentication would be a total-compromise backdoor — worse
 * than any bug in docs/issues_in_project.md, because it would be reachable from
 * the public tunnel. This script talks to PostgreSQL directly and is meant to
 * be run inside the backend container, so using it requires access to the host
 * machine and to Docker. Run it from admin-reset.bat in the project root.
 *
 * Usage (inside the container):
 *   node src/resetAdmin.js [--username admin] [--password <pw>] [--email <addr>]
 * With no --password, a strong one is generated and printed once.
 */
const bcrypt = require('bcryptjs');
const { q, qOne, pool } = require('./db');
const { generateTempPassword, validatePassword } = require('./passwords');

const DEFAULT_USERNAME = 'admin';
const DEFAULT_EMAIL = 'admin@validuresolutions.com';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = value;
      i++;
    }
  }
  return args;
}

(async () => {
  try {
    const args = parseArgs(process.argv.slice(2));
    const username = String(args.username || DEFAULT_USERNAME).trim();
    const email = String(args.email || DEFAULT_EMAIL).trim();

    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
      throw new Error(`Invalid username "${username}" — use 3-64 letters, digits, dot, underscore or hyphen.`);
    }

    let password;
    let generated = false;
    if (typeof args.password === 'string') {
      const invalid = validatePassword(args.password);
      if (invalid) throw new Error(invalid);
      password = args.password;
    } else {
      password = generateTempPassword(16);
      generated = true;
    }

    const hash = bcrypt.hashSync(password, 10);

    /*
     * Reset the FIRST admin row (by id) rather than inserting a new one, so
     * repeated runs cannot accumulate admin accounts. If the table is empty the
     * account is created.
     */
    const existing = await qOne('SELECT id, username, email FROM admins ORDER BY id LIMIT 1');

    if (existing) {
      // A username or email collision with a *different* admin row would violate
      // the unique constraints — clear the way by reporting it rather than
      // failing on a raw Postgres error.
      const clash = await qOne(
        'SELECT id FROM admins WHERE (LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($2)) AND id<>$3',
        [username, email, existing.id]);
      if (clash) {
        throw new Error(`Another admin account (#${clash.id}) already uses that username or email.`);
      }
      await q(
        `UPDATE admins SET username=$1, email=$2, password_hash=$3, failed_attempts=0, locked_until=NULL
         WHERE id=$4`,
        [username, email, hash, existing.id]);
      console.log(`\n[reset] Platform admin #${existing.id} restored.`);
      if (existing.username !== username) {
        console.log(`[reset] Username changed: "${existing.username}" -> "${username}"`);
      }
    } else {
      await q('INSERT INTO admins (username, email, password_hash) VALUES ($1,$2,$3)', [username, email, hash]);
      console.log('\n[reset] No admin existed — a new platform admin was created.');
    }

    console.log('\n  ─────────────────────────────────────────────');
    console.log(`   Username : ${username}`);
    console.log(`   Email    : ${email}`);
    console.log(`   Password : ${password}`);
    console.log('  ─────────────────────────────────────────────');
    if (generated) {
      console.log('\n  This password is shown once and is not stored anywhere in readable form.');
    }
    console.log('  Sign in and change it from the portal.\n');
    console.log('  Any lockout from failed attempts has been cleared.');
    console.log('  Existing sessions are unaffected — they expire on their own (8h).\n');

    await pool.end();
  } catch (e) {
    console.error(`\n[reset] FAILED: ${e.message}\n`);
    process.exit(1);
  }
})();
