const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const { initSchema } = require('./db');
const { startAccrualScheduler } = require('./accrual');
const { UploadTypeError } = require('./storage');
// Required at boot so a missing or published JWT_SECRET stops the process here,
// with a clear message, rather than on the first request.
require('./config').requireJwtSecret();

const app = express();

/*
 * The API sits behind the Next.js proxy (single-tunnel mode) and/or the Serveo
 * tunnel, so req.ip is the proxy's address unless we opt in. TRUST_PROXY takes
 * the number of proxies in front of this service — a count rather than `true`,
 * because trusting every hop lets a client spoof X-Forwarded-For and choose its
 * own rate-limit bucket. Default 0: trust nothing.
 */
const TRUST_PROXY = parseInt(process.env.TRUST_PROXY || '0', 10);
if (TRUST_PROXY > 0) app.set('trust proxy', TRUST_PROXY);

/*
 * Security headers. This service answers JSON and file downloads only — it
 * serves no HTML of its own — so the CSP is the restrictive "nothing is
 * allowed" policy that matters for the one case where content is rendered
 * directly from this origin: a user-uploaded file. Uploads are additionally
 * sent as attachments with nosniff (see storage.js).
 */
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    },
  },
  // The portal is a separate origin that legitimately reads these responses;
  // CORS above is what governs that, so leave the cross-origin resource policy
  // permissive enough not to break it.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // HSTS only makes sense once TLS terminates in front of this service. The
  // Serveo tunnels are HTTPS, so it is on by default and can be disabled for
  // plain-HTTP LAN deployments.
  hsts: process.env.DISABLE_HSTS === 'true'
    ? false
    : { maxAge: 15552000, includeSubDomains: true, preload: false },
  referrerPolicy: { policy: 'no-referrer' },
}));

/*
 * CORS. The frontend is served from its own public tunnel
 * (https://app.validurehr.example) while the API answers on another
 * (https://api.validurehr.example), so every browser call is
 * cross-origin and the app origin must be allowed explicitly.
 *
 * CORS_ORIGINS is a comma-separated allowlist. Empty (or '*') allows any
 * origin — the previous behaviour, kept so existing deployments don't break.
 * Auth is a Bearer token, never a cookie, so no credentials are involved.
 */
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

// Origins the Capacitor Android shell sends — it talks to the same API.
const NATIVE_ORIGINS = ['capacitor://localhost', 'ionic://localhost', 'http://localhost', 'https://localhost'];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl, native HTTP clients, same-origin
    if (!ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes('*')) return cb(null, true);
    const o = origin.replace(/\/$/, '');
    cb(null, ALLOWED_ORIGINS.includes(o) || NATIVE_ORIGINS.includes(o));
  },
}));
console.log(`[cors] allowed origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : '(any)'}`);

app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'ValidureHR API' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/access', require('./routes/access'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/leaves', require('./routes/leaves'));
app.use('/api/balances', require('./routes/balances'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/admin', require('./routes/admin'));
// Called by an external scheduler, not by the app. See routes/cron.js.
app.use('/api/cron', require('./routes/cron'));
// Called by the office Attendance Manager, not by the app. See routes/integrations.js.
app.use('/api/integrations', require('./routes/integrations'));

// 404 + error handling
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use((err, req, res, next) => {
  // A rejected upload is the caller's mistake, not a server fault — say which
  // rule it broke instead of returning an opaque 500.
  if (err instanceof UploadTypeError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That file is larger than the 10 MB limit'
      : `Upload rejected (${err.code})`;
    return res.status(400).json({ error: message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5050;
/*
 * The in-process scheduler is pointless on a host that sleeps — the timer never
 * survives to fire. Set DISABLE_ACCRUAL_SCHEDULER=true there and drive accrual
 * from POST /api/cron/accrual instead. Left on by default for the self-hosted
 * deployment, where the process stays up.
 */
const SCHEDULER_DISABLED = process.env.DISABLE_ACCRUAL_SCHEDULER === 'true';

initSchema()
  .then(() => {
    if (SCHEDULER_DISABLED) {
      console.log('[accrual] in-process scheduler disabled — expecting POST /api/cron/accrual');
    } else {
      startAccrualScheduler();
    }
    app.listen(PORT, () => console.log(`ValidureHR API running on http://localhost:${PORT}`));
  })
  .catch((e) => {
    console.error('Could not reach PostgreSQL:', e.message);
    process.exit(1);
  });
