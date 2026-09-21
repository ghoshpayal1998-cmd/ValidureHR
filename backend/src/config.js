/*
 * Boot-time configuration.
 *
 * Anything security-critical is validated here so the process refuses to start
 * rather than silently running on a value an attacker can look up. The old code
 * fell back to a hardcoded secret when JWT_SECRET was unset, which meant a
 * misconfigured deployment was indistinguishable from a correct one.
 */

/*
 * Secrets that have appeared in this repository, its README or its
 * docker-compose defaults. They are long enough to pass a length check, so they
 * have to be rejected by value.
 */
const PUBLISHED_SECRETS = new Set([
  'validurehr-change-this-secret-to-a-long-random-string',
  'validurehr-dev-secret-change-in-production',
  'put-a-long-random-string-here',
  'change-this-secret',
  'changeme',
  'secret',
]);

const MIN_SECRET_LENGTH = 32;

const HOWTO = 'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';

function requireJwtSecret(env = process.env) {
  const secret = env.JWT_SECRET;
  if (!secret) {
    throw new Error(`JWT_SECRET is not set. The API will not start without it. ${HOWTO}`);
  }
  /*
   * Known-bad value first. Several of the published secrets are also shorter
   * than the minimum, and reporting "too short" for those would invite someone
   * to pad the published value to 32 characters instead of replacing it — which
   * would leave it just as guessable.
   */
  if (PUBLISHED_SECRETS.has(secret)) {
    throw new Error(
      `JWT_SECRET is set to a value published in this repository — anyone can forge admin tokens with it. ${HOWTO}`
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length}). ${HOWTO}`
    );
  }
  return secret;
}

/*
 * The admin bootstrap password (init.js, first run only). Rejected if it is the
 * documented default, for the same reason as the JWT secret.
 */
const PUBLISHED_PASSWORDS = new Set(['Admin@123', 'Welcome@123', 'admin', 'password', 'changeme']);

function requireAdminPassword(env = process.env) {
  const password = env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error('ADMIN_PASSWORD is not set — refusing to create the platform admin with a default password.');
  }
  // Value check first: 'Admin@123' is also too short, and being told "too
  // short" would send someone off to pad the documented default rather than
  // replace it.
  if (PUBLISHED_PASSWORDS.has(password)) {
    throw new Error('ADMIN_PASSWORD is set to a documented default — choose a different password.');
  }
  if (password.length < 12) {
    throw new Error(`ADMIN_PASSWORD must be at least 12 characters (got ${password.length}).`);
  }
  return password;
}

module.exports = {
  requireJwtSecret,
  requireAdminPassword,
  PUBLISHED_SECRETS,
  PUBLISHED_PASSWORDS,
  MIN_SECRET_LENGTH,
};
