const { Pool, types } = require('pg');

// COUNT()/SUM() come back as int8/numeric strings by default — parse to JS numbers.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));   // int8
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));   // numeric

/*
 * Pool size is configurable because it depends on where the database lives.
 * Self-hosted Postgres is happy with 10; a hosted plan with a small connection
 * allowance shared across instances needs fewer. Too many is not a performance
 * win — it just exhausts the server's connection limit and starts refusing
 * everything, including logins.
 */
const POOL_MAX = parseInt(process.env.DB_POOL_MAX || '10', 10);

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://validurehr:validurehr@localhost:5432/validurehr',
  max: Number.isFinite(POOL_MAX) && POOL_MAX > 0 ? POOL_MAX : 10,
  // A managed database behind a pooler will drop idle connections itself;
  // recycling ours first avoids handing a dead socket to a request.
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '10000', 10),
});

/*
 * An idle-client error (network blip, pooler restart) is emitted on the pool,
 * not on any request. Without a listener Node treats it as unhandled and kills
 * the process — which on a hosted platform looks like a random restart.
 */
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

const q = async (text, params) => (await pool.query(text, params)).rows;
const qOne = async (text, params) => (await pool.query(text, params)).rows[0];

/*
 * MULTI-TENANT LAYOUT
 * -------------------
 * public schema  : companies, admins (platform super users), user_directory (login routing)
 * per company    : an isolated PostgreSQL schema "c_<slug>" holding the FULL set of
 *                  HR tables. Tenant queries are written with the {s} placeholder,
 *                  which ts() replaces with the validated schema name.
 */

const PUBLIC_SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  schema_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Suspended')),
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

-- Failed-login tracking (see loginAttempts.js). Idempotent for existing installs.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS locked_until TEXT;

-- Whether the company runs biometric (fingerprint) attendance. Gates every
-- device-time feature per tenant: the sync ingest, the day-view columns, the
-- employee self-view and the Device Mapping panel. Asked at company creation.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS has_device_attendance BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS user_directory (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tenant_user_id INTEGER NOT NULL
);
`;

// All date columns are ISO TEXT on purpose: sorts correctly, LIKE 'YYYY-MM%' month
// filters work, and the API returns plain strings without timezone surprises.
const TENANT_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS {s};

CREATE TABLE IF NOT EXISTS {s}.roles (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  permissions TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS {s}.departments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS {s}.designations (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS {s}.employees (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  emp_code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  email TEXT NOT NULL UNIQUE,
  doj TEXT NOT NULL,
  dob TEXT NOT NULL,
  department_id INTEGER REFERENCES {s}.departments(id),
  designation_id INTEGER REFERENCES {s}.designations(id),
  reporting_manager_id INTEGER REFERENCES {s}.employees(id),
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  pan_no TEXT,
  bank_name TEXT,
  bank_account_no TEXT,
  bank_ifsc TEXT,
  emergency_contact TEXT
);

CREATE TABLE IF NOT EXISTS {s}.users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role_id INTEGER REFERENCES {s}.roles(id),
  employee_id INTEGER REFERENCES {s}.employees(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS {s}.user_permissions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES {s}.users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  UNIQUE (user_id, permission)
);

CREATE TABLE IF NOT EXISTS {s}.holidays (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {s}.attendance (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES {s}.employees(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Present','Absent','Half Day','WFH','Leave','Holiday','Weekend','LOP','SL','EL')),
  check_in TEXT,
  check_out TEXT,
  late_mark BOOLEAN NOT NULL DEFAULT FALSE,
  remarks TEXT,
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS {s}.leave_types (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  monthly_accrual DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS {s}.leave_balances (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES {s}.employees(id),
  leave_type_id INTEGER NOT NULL REFERENCES {s}.leave_types(id),
  accrued DOUBLE PRECISION NOT NULL DEFAULT 0,
  used DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_accrued TEXT NOT NULL,
  UNIQUE (employee_id, leave_type_id)
);

CREATE TABLE IF NOT EXISTS {s}.leave_applications (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES {s}.employees(id),
  leave_type_id INTEGER NOT NULL REFERENCES {s}.leave_types(id),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  days DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  attachment_file TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
  decided_by TEXT,
  decided_at TEXT,
  rejection_reason TEXT,
  applied_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS {s}.salary_slips (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES {s}.employees(id),
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  basic DOUBLE PRECISION,
  hra DOUBLE PRECISION,
  special_allowance DOUBLE PRECISION,
  conveyance DOUBLE PRECISION,
  pf_deduction DOUBLE PRECISION,
  tax_deduction DOUBLE PRECISION,
  lop_deduction DOUBLE PRECISION,
  net_pay DOUBLE PRECISION,
  file_name TEXT,
  generated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (employee_id, month, year)
);

/*
 * One row per employee: the standing monthly figures payroll is computed from.
 * Distinct from salary_slips, which is the frozen output for one month.
 *
 * This table existed in production before it existed here — it was created
 * directly against the live database while the payroll screens were being
 * built. A tenant created from this file alone would not have had it, and
 * every /api/payroll route would 500 for that company.
 */
CREATE TABLE IF NOT EXISTS {s}.salary_structures (
  employee_id INTEGER PRIMARY KEY REFERENCES {s}.employees(id),
  basic DOUBLE PRECISION DEFAULT 0,
  hra DOUBLE PRECISION DEFAULT 0,
  special_allowance DOUBLE PRECISION DEFAULT 0,
  -- The statutory conveyance allowance, which is a flat figure here.
  conveyance DOUBLE PRECISION DEFAULT 1600,
  pf_deduction DOUBLE PRECISION DEFAULT 0,
  tax_deduction DOUBLE PRECISION DEFAULT 0,
  esic_deduction NUMERIC(10, 2) DEFAULT 0,
  bank_name TEXT,
  bank_account_no TEXT,
  bank_ifsc TEXT,
  pan_no TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {s}.policies (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  file_name TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS {s}.offer_letters (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES {s}.employees(id),
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  is_revised BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS {s}.announcements (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {s}.settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {s}.email_log (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS {s}.audit_logs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER,
  actor TEXT,
  action TEXT NOT NULL,
  details TEXT,
  timestamp TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Every change to a leave balance, so the calculation is fully traceable:
-- kind: accrual | adjustment | leave_taken | leave_cancelled
CREATE TABLE IF NOT EXISTS {s}.leave_ledger (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES {s}.employees(id),
  leave_type_id INTEGER NOT NULL REFERENCES {s}.leave_types(id),
  delta DOUBLE PRECISION NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('accrual','adjustment','leave_taken','leave_cancelled')),
  note TEXT,
  actor TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS {s}.notifications (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id INTEGER REFERENCES {s}.employees(id) ON DELETE CASCADE, -- null means for everyone (e.g. general announcements)
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Day-wise entry/exit times pushed by the office biometric Attendance Manager
-- (see routes/integrations.js). Deliberately separate from {s}.attendance:
-- status there is NOT NULL and fully HR-managed, so raw device times get their
-- own table and never interfere with marking, leave flows or employee summaries.
CREATE TABLE IF NOT EXISTS {s}.device_attendance (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES {s}.employees(id),
  date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  synced_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (employee_id, date)
);

-- Which biometric machine user is which employee. The sync pushes the device
-- roster (machine id + the name stored on the device); platform admins link
-- machines to employees in the portal. employee_id NULL = not mapped yet, and
-- punches from that machine are held back (reported, not stored) until mapped.
CREATE TABLE IF NOT EXISTS {s}.device_employee_map (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  machine_id TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL DEFAULT '',
  employee_id INTEGER REFERENCES {s}.employees(id),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- idempotent column upgrades for existing tenants
ALTER TABLE {s}.employees ADD COLUMN IF NOT EXISTS probation_until TEXT;
ALTER TABLE {s}.employees ADD COLUMN IF NOT EXISTS pan_no TEXT;
ALTER TABLE {s}.employees ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE {s}.employees ADD COLUMN IF NOT EXISTS bank_account_no TEXT;
ALTER TABLE {s}.employees ADD COLUMN IF NOT EXISTS bank_ifsc TEXT;
ALTER TABLE {s}.employees ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE {s}.leave_applications ADD COLUMN IF NOT EXISTS is_unpaid BOOLEAN NOT NULL DEFAULT FALSE;
-- Failed-login tracking + forced password change on a temporary credential.
ALTER TABLE {s}.users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE {s}.users ADD COLUMN IF NOT EXISTS locked_until TEXT;
ALTER TABLE {s}.users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE {s}.employees ADD COLUMN IF NOT EXISTS photo_file TEXT;
INSERT INTO {s}.leave_types (name, code, monthly_accrual) VALUES ('Unpaid Leave', 'UL', 0) ON CONFLICT (code) DO NOTHING;
ALTER TABLE {s}.salary_slips ADD COLUMN IF NOT EXISTS lop_deduction DOUBLE PRECISION;
-- ESIC: added to the live database by a one-off script during the payroll
-- work. Recorded here so it survives a rebuild and reaches every tenant.
ALTER TABLE {s}.salary_structures ADD COLUMN IF NOT EXISTS esic_deduction NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE {s}.salary_slips ADD COLUMN IF NOT EXISTS esic_deduction NUMERIC(10, 2) DEFAULT 0;
`;

// A schema name is only ever derived from a validated slug — enforce it anyway.
function assertSchema(schema) {
  if (!/^c_[a-z0-9]{2,24}$/.test(schema)) throw new Error(`Invalid tenant schema: ${schema}`);
  return schema;
}

// ts(schema, sql) — substitute the {s} placeholder with the tenant schema.
function ts(schema, sql) {
  return sql.replaceAll('{s}', assertSchema(schema));
}

// Tenant-scoped helpers
const tq = (schema, sql, params) => q(ts(schema, sql), params);
const tqOne = (schema, sql, params) => qOne(ts(schema, sql), params);

async function createTenantSchema(schema) {
  await pool.query(ts(schema, TENANT_SCHEMA));
  await syncSystemRoles(schema);
}

/*
 * Brings the built-in roles in one tenant into line with permissions.js.
 *
 * System roles are created once, at company provisioning, with ON CONFLICT DO
 * NOTHING — so a company created before a role definition changed keeps the old
 * permission list forever. That is how the live DIRECTOR role ended up holding
 * seven permissions while the middleware quietly granted it all twelve; the
 * stored list was never the thing being enforced.
 *
 * Now that the stored list IS what gets enforced, it has to be kept current, or
 * existing directors would silently lose access on deploy. Custom roles are
 * never touched — only rows flagged is_system.
 */
async function syncSystemRoles(schema) {
  const { SYSTEM_ROLES } = require('./permissions');
  for (const [roleName, perms] of Object.entries(SYSTEM_ROLES)) {
    await tq(schema, `
      INSERT INTO {s}.roles (name, is_system, permissions) VALUES ($1, TRUE, $2)
      ON CONFLICT (name) DO UPDATE SET permissions = EXCLUDED.permissions, is_system = TRUE
      WHERE {s}.roles.is_system = TRUE`,
      [roleName, JSON.stringify(perms)]);
  }
}

async function initSchema(retries = 15) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query(PUBLIC_SCHEMA);
      // ensure tenant schemas exist for all registered companies (idempotent)
      const companies = await q('SELECT schema_name FROM companies');
      for (const c of companies) await createTenantSchema(c.schema_name);
      return;
    } catch (e) {
      if (i === retries) throw e;
      console.log(`[db] Waiting for PostgreSQL (${i}/${retries})… ${e.code || e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

module.exports = {
  pool, q, qOne, tq, tqOne, ts, initSchema, createTenantSchema, syncSystemRoles, assertSchema,
};
