/*
 * Email delivery. Uses SMTP when configured via env (SMTP_HOST/SMTP_PORT/SMTP_USER/
 * SMTP_PASS/MAIL_FROM); otherwise every mail is recorded in the tenant email_log with
 * status 'skipped (SMTP not configured)' so nothing is silently lost.
 *
 * TWO MODES, deliberately:
 *   sendMail    — fire-and-forget. For notifications (leave applied/approved,
 *                 announcements): a mail problem must never fail the request.
 *   sendMailNow — awaited, returns whether delivery actually succeeded. For the
 *                 few mails that CARRY something the user cannot get elsewhere,
 *                 i.e. credentials. Telling HR "the employee has been emailed"
 *                 when the send timed out is how FTRN018 ended up locked out of
 *                 an account whose password existed only in an unsent email.
 */
const nodemailer = require('nodemailer');
const { tq } = require('./db');

/*
 * Implicit TLS on 465, and on 2465 — the alternate port relays offer for hosts
 * that block the standard ones. Everything else connects in the clear and
 * upgrades with STARTTLS. SMTP_SECURE=true|false overrides, for a relay that
 * does not follow the convention.
 */
const PORT = parseInt(process.env.SMTP_PORT) || 587;
const SECURE = process.env.SMTP_SECURE
  ? process.env.SMTP_SECURE === 'true'
  : PORT === 465 || PORT === 2465;

/*
 * Ports that hosting providers commonly block outbound to stop spam — Render
 * blocks all three on free instances. A connection timeout on one of them is
 * the host, not a bad password, and saying so here is the difference between a
 * one-line fix and reading the email_log to work out why mail stopped.
 */
const OFTEN_BLOCKED = [25, 465, 587];

function explain(err) {
  const timedOut = err.code === 'ETIMEDOUT' || /timeout/i.test(err.message || '');
  if (timedOut && OFTEN_BLOCKED.includes(PORT)) {
    return `cannot reach ${process.env.SMTP_HOST}:${PORT} — the host blocks outbound SMTP on this port. Use a relay on an allowed port (e.g. 2525) or a paid instance.`;
  }
  return err.message;
}

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: PORT,
    secure: SECURE,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    /*
     * Explicit, short timeouts. Nodemailer's defaults let a blocked outbound
     * port hang for minutes; sendMailNow is awaited inside an HTTP request, so
     * a failure has to come back quickly enough to tell HR about it.
     */
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  console.log(`[mail] SMTP configured: ${process.env.SMTP_HOST}:${PORT} (${SECURE ? 'implicit TLS' : 'STARTTLS'})`);
} else {
  console.log('[mail] SMTP not configured — emails will be logged only (see Email Log in the app).');
}

const FROM = process.env.MAIL_FROM || 'ValidureHR <no-reply@validurehr.local>';

async function logMail(schema, to, subject, body, status) {
  try {
    await tq(schema, `INSERT INTO {s}.email_log (to_email, subject, body, status) VALUES ($1,$2,$3,$4)`,
      [to, subject, body, status]);
  } catch (e) {
    console.error('[mail] log failed:', e.message);
  }
}

/** Delivers to one recipient and logs the outcome. Never throws. */
async function deliver(schema, rcpt, subject, body, html, attachments) {
  if (!transport) {
    await logMail(schema, rcpt, subject, body, 'skipped (SMTP not configured)');
    return { ok: false, error: 'SMTP is not configured on this deployment' };
  }
  try {
    await transport.sendMail({ from: FROM, to: rcpt, subject, text: body, html, attachments });
    await logMail(schema, rcpt, subject, body, 'sent');
    return { ok: true };
  } catch (e) {
    const why = explain(e);
    console.error(`[mail] send to ${rcpt} failed:`, why);
    await logMail(schema, rcpt, subject, body, `failed: ${why.slice(0, 200)}`);
    return { ok: false, error: why };
  }
}

/** sendMail(schema, to, subject, body, html = null, attachments = []) — to may be a string or array. Fire-and-forget. */
function sendMail(schema, to, subject, body, html = null, attachments = []) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  for (const rcpt of recipients) {
    deliver(schema, rcpt, subject, body, html, attachments);
  }
}

/**
 * Awaited send for mail the recipient cannot do without (credentials).
 * Resolves to { ok: true } or { ok: false, error } — callers are expected to
 * tell the user the truth about what happened.
 */
async function sendMailNow(schema, to, subject, body, html = null, attachments = []) {
  const rcpt = (Array.isArray(to) ? to : [to]).filter(Boolean)[0];
  if (!rcpt) return { ok: false, error: 'No email address on record' };
  return deliver(schema, rcpt, subject, body, html, attachments);
}

module.exports = { sendMail, sendMailNow };
