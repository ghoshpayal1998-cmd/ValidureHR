/*
 * Builds an Express app wired to the real routers and the real middleware, but
 * against the fake database from testEnv.js. This is what lets the security
 * tests assert on genuine authorisation behaviour rather than a re-description
 * of it.
 */
require('./testEnv');

const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const { UploadTypeError } = require(path.join(SRC, 'storage'));
const { JWT_SECRET } = require(path.join(SRC, 'middleware', 'auth'));

/**
 * Mirrors server.js: same helmet policy, same JSON parsing, same routers, same
 * 404 and error handlers. Kept in one place so a test can never pass because
 * the harness happened to omit a middleware the real server has.
 */
function buildApp({ routes = null } = {}) {
  const app = express();

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
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: { maxAge: 15552000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: 'no-referrer' },
  }));

  app.use(express.json());
  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'ValidureHR API' }));

  const mount = routes || {
    '/api/auth': 'auth',
    '/api/companies': 'companies',
    '/api/access': 'access',
    '/api/dashboard': 'dashboard',
    '/api/attendance': 'attendance',
    '/api/leaves': 'leaves',
    '/api/employees': 'employees',
    '/api/documents': 'documents',
    '/api/admin': 'admin',
  };
  for (const [mountPath, routeFile] of Object.entries(mount)) {
    app.use(mountPath, require(path.join(SRC, 'routes', routeFile)));
  }

  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use((err, req, res, next) => {
    if (err instanceof UploadTypeError) return res.status(400).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'That file is larger than the 10 MB limit'
        : `Upload rejected (${err.code})`;
      return res.status(400).json({ error: message });
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

/** Token for a platform admin. */
function adminToken({ id = 1, username = 'admin' } = {}) {
  return jwt.sign({ adm: true, id, username }, JWT_SECRET, { expiresIn: '1h' });
}

/** Token for a tenant user. */
function userToken({ id = 10, username = 'FTRN001', companyId = 1, slug = 'ftr', employeeId = 5, role = 'EMPLOYEE' } = {}) {
  return jwt.sign({ id, username, companyId, slug, employeeId, role }, JWT_SECRET, { expiresIn: '1h' });
}

/** A token signed with some OTHER key — what an attacker with the old public secret has. */
function forgedToken(secret, payload = { adm: true, id: 1, username: 'admin' }) {
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

const COMPANY = {
  id: 1, name: 'Validure', slug: 'ftr', schema_name: 'c_vs', status: 'Active',
  has_device_attendance: true,
};

module.exports = { buildApp, adminToken, userToken, forgedToken, COMPANY, JWT_SECRET };
