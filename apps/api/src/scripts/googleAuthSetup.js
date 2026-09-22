/*
 * One-time helper: turn a Google OAuth client into a refresh token for the
 * server-side backup.
 *
 * Run this ONCE, on a machine with a browser. It prints a refresh token which
 * goes into the API host's environment (Render → Environment). The token does
 * not expire as long as the OAuth consent screen is PUBLISHED — an app left in
 * "Testing" has its refresh tokens revoked after 7 days, which would stop
 * backups a week later with no obvious cause.
 *
 * Google removed the copy-paste ("oob") flow in 2022, so this runs a tiny local
 * web server to catch the redirect. Nothing is sent anywhere except Google.
 *
 * Usage:
 *   cd backend
 *   node src/scripts/googleAuthSetup.js --id <client-id> --secret <client-secret>
 */
const http = require('http');
const { URL } = require('url');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const CLIENT_ID = option('id') || process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = option('secret') || process.env.GOOGLE_CLIENT_SECRET;
const PORT = parseInt(option('port') || '53682', 10);
const REDIRECT = `http://localhost:${PORT}`;
// Only files this app creates — it cannot see the rest of your Drive.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
Missing credentials.

  node src/scripts/googleAuthSetup.js --id <client-id> --secret <client-secret>

Create them at https://console.cloud.google.com/apis/credentials :
  1. Create a project (any name).
  2. APIs & Services -> Library -> enable "Google Drive API".
  3. OAuth consent screen -> External -> fill the required fields ->
     add the scope ${SCOPE} -> then PUBLISH the app
     ("Publish app" / "In production"). This scope is not sensitive, so no
     Google review is required, and publishing is what stops the refresh
     token expiring after 7 days.
  4. Credentials -> Create credentials -> OAuth client ID ->
     Application type "Web application" ->
     Authorised redirect URI: ${REDIRECT}
`);
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',    // ask for a refresh token
  prompt: 'consent',         // force one even if previously granted
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  const reply = (msg) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:system-ui;padding:40px"><h2>${msg}</h2>
      <p>You can close this tab and go back to the terminal.</p></body></html>`);
  };

  if (error) { reply(`Authorisation failed: ${error}`); server.close(); process.exit(1); }
  if (!code) { res.writeHead(404); res.end(); return; }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      reply('Could not get a refresh token — see the terminal.');
      console.error('\nGoogle returned:\n', JSON.stringify(data, null, 2));
      console.error('\nIf refresh_token is missing, revoke the app at');
      console.error('https://myaccount.google.com/permissions and run this again.\n');
      server.close();
      process.exit(1);
    }

    reply('Done — ValidureHR can now write backups to your Drive.');
    console.log(`
==================================================================
  Set these on the API host (Render -> Environment):

  GOOGLE_CLIENT_ID=${CLIENT_ID}
  GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}
  GOOGLE_REFRESH_TOKEN=${data.refresh_token}

  Treat the refresh token like a password: it grants write access to
  the ValidureHR backup folder in this Google account.
==================================================================
`);
    server.close();
    process.exit(0);
  } catch (e) {
    reply('Something went wrong — see the terminal.');
    console.error(e);
    server.close();
    process.exit(1);
  }
});

/*
 * Opening the URL is fiddly on Windows: `start <url>` goes through cmd, which
 * treats the & between query parameters as a command separator and silently
 * truncates the link — Google then rejects it with "Required parameter is
 * missing: response_type". PowerShell's Start-Process with a single-quoted
 * argument passes the whole URL through intact.
 */
function openBrowser(url) {
  if (process.platform === 'win32') {
    return spawn('powershell', ['-NoProfile', '-Command', `Start-Process '${url.replace(/'/g, "''")}'`],
      { stdio: 'ignore', detached: true });
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  return spawn(opener, [url], { stdio: 'ignore', detached: true });
}

server.listen(PORT, () => {
  console.log(`\nOpening your browser to authorise ValidureHR…`);
  console.log(`If it does not open, paste this WHOLE line into a browser:\n\n${authUrl}\n`);
  try {
    openBrowser(authUrl).unref();
  } catch { /* the printed URL is the fallback */ }
});
