/*
 * Rate limiting for the authentication endpoints.
 *
 * Deployment note: in single-tunnel mode the browser talks to the Next.js
 * frontend, which proxies /api/* to this service. Every request therefore
 * arrives from the frontend container's address. A limiter keyed on IP alone
 * would put the whole company in one bucket — one attacker could lock everyone
 * out of login. So the login limiter is keyed on (identifier, ip): an attacker
 * grinding one account is throttled without affecting anyone else, and the key
 * still separates clients when the API is reached directly on :5050.
 *
 * The per-account lockout in loginAttempts.js is the durable half of this
 * control; this is the cheap in-memory half that stops a burst before it ever
 * reaches bcrypt.
 */
const rateLimit = require('express-rate-limit');

const WINDOW_MS = parseInt(process.env.LOGIN_RATE_WINDOW_MS || `${15 * 60 * 1000}`, 10);
const MAX_PER_WINDOW = parseInt(process.env.LOGIN_RATE_MAX || '10', 10);

const normalize = (v) => String(v || '').trim().toLowerCase().slice(0, 128);

const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_PER_WINDOW,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Only failed logins should count towards the limit — a busy office signing
  // in normally must never be throttled.
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${normalize(req.body?.identifier)}|${req.ip}`,
  // The default handler would use the generic message; ours matches the shape
  // the clients already parse ({ error }).
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many sign-in attempts. Please wait a few minutes and try again.',
    });
  },
});

const changePasswordLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: parseInt(process.env.CHANGE_PASSWORD_RATE_MAX || '20', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Authenticated endpoint — the token subject is the natural key.
  keyGenerator: (req) => `${req.user?.adm ? 'adm' : 'usr'}:${req.user?.id}|${req.ip}`,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  },
});

module.exports = { loginLimiter, changePasswordLimiter, WINDOW_MS, MAX_PER_WINDOW };
