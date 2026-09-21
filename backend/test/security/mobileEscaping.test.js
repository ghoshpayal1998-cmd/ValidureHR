/*
 * S-3 — stored XSS in the mobile app.
 *
 * mobile/www/js builds its DOM with template strings and innerHTML, so unlike
 * the React portal it does not escape anything automatically. An employee could
 * apply for leave with a reason containing `<img src=x onerror=…>`; the backend
 * stores the reason verbatim, and it executed in HR's session — with HR's token
 * in localStorage — as soon as HR opened Admin -> Pending Leaves in the Android
 * app. /leaves/pending is one of the endpoints that always worked, so the path
 * was live.
 *
 * The app has no module system, so api.js is loaded into a VM with the browser
 * globals it touches stubbed out, and the real esc()/escJs() are tested.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_JS = path.join(__dirname, '..', '..', '..', 'mobile', 'www', 'js', 'api.js');

/* ValidureHR has no mobile client yet. These tests guard the escaping
 * contract in the mobile API client, so they are kept intact and skip
 * until a mobile app exists rather than being deleted - the day one is
 * added, the guard comes back on by itself. */
const MOBILE_ABSENT = !fs.existsSync(API_JS) && 'no mobile client in this project yet';

function loadApiClient() {
  const source = fs.readFileSync(API_JS, 'utf8');
  const store = new Map();
  const sandbox = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    window: {},
    fetch: async () => { throw new Error('network disabled in tests'); },
    document: {},
    console,
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    setTimeout,
  };
  vm.createContext(sandbox);
  /*
   * api.js declares `const ApiClient = (() => {…})()`. A top-level `const` in a
   * VM script is a script-scoped binding, not a property of the sandbox global,
   * so it is invisible from outside — hand it out explicitly.
   */
  vm.runInContext(`${source}\n;globalThis.__ApiClient = ApiClient;`, sandbox, { filename: 'api.js' });
  if (!sandbox.__ApiClient) throw new Error('mobile api.js did not define ApiClient');
  return sandbox.__ApiClient;
}

const ApiClient = MOBILE_ABSENT ? null : loadApiClient();

test('the escaping helper is actually exported by the mobile API client', { skip: MOBILE_ABSENT }, () => {
  assert.equal(typeof ApiClient.esc, 'function');
  assert.equal(typeof ApiClient.escJs, 'function');
});

test('esc neutralises the classic image-onerror payload', { skip: MOBILE_ABSENT }, () => {
  const payload = '<img src=x onerror="alert(document.cookie)">';
  const escaped = ApiClient.esc(payload);
  assert.doesNotMatch(escaped, /<img/);
  assert.doesNotMatch(escaped, /"/);
  assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(document.cookie)&quot;&gt;');
});

test('esc neutralises a script tag', { skip: MOBILE_ABSENT }, () => {
  assert.equal(
    ApiClient.esc('<script>fetch("/steal?t="+localStorage.vhr_token)</script>'),
    '&lt;script&gt;fetch(&quot;/steal?t=&quot;+localStorage.vhr_token)&lt;/script&gt;',
  );
});

test('esc escapes every character that can break out of markup', { skip: MOBILE_ABSENT }, () => {
  // & first, or the other replacements get double-escaped incorrectly.
  assert.equal(ApiClient.esc('&'), '&amp;');
  assert.equal(ApiClient.esc('<'), '&lt;');
  assert.equal(ApiClient.esc('>'), '&gt;');
  assert.equal(ApiClient.esc('"'), '&quot;');
  assert.equal(ApiClient.esc("'"), '&#39;');
});

test('esc escapes ampersands before the other entities', { skip: MOBILE_ABSENT }, () => {
  // If & were escaped last, "&lt;" would come back as "&lt;" and render as "<".
  assert.equal(ApiClient.esc('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
});

test('esc closes the quoted-attribute break-out', { skip: MOBILE_ABSENT }, () => {
  // The helper is used inside title="${...}" as well as in element text, so a
  // quote has to be escaped or the payload escapes the attribute.
  const payload = '" onmouseover="alert(1)';
  const escaped = ApiClient.esc(payload);
  assert.doesNotMatch(escaped, /(?<!&quot;)"/);
  assert.equal(escaped, '&quot; onmouseover=&quot;alert(1)');
});

test('esc handles a single-quoted attribute break-out', { skip: MOBILE_ABSENT }, () => {
  assert.equal(ApiClient.esc("' onfocus='alert(1)"), '&#39; onfocus=&#39;alert(1)');
});

test('esc renders null and undefined as empty, not as the words', { skip: MOBILE_ABSENT }, () => {
  assert.equal(ApiClient.esc(null), '');
  assert.equal(ApiClient.esc(undefined), '');
});

test('esc coerces non-strings safely', { skip: MOBILE_ABSENT }, () => {
  assert.equal(ApiClient.esc(42), '42');
  assert.equal(ApiClient.esc(0), '0');
  assert.equal(ApiClient.esc(false), 'false');
  // An object whose toString carries a payload must still be escaped.
  assert.equal(ApiClient.esc({ toString: () => '<b>' }), '&lt;b&gt;');
});

test('esc is idempotent-safe on already-escaped text', { skip: MOBILE_ABSENT }, () => {
  // Double-escaping is ugly but never dangerous; losing the escape would be.
  const once = ApiClient.esc('<b>');
  assert.doesNotMatch(ApiClient.esc(once), /<b>/);
});

test('escJs prevents breaking out of a single-quoted inline handler', { skip: MOBILE_ABSENT }, () => {
  // Used as onclick="Foo._open('${escJs(name)}')".
  const payload = "'); alert(1); ('";
  const escaped = ApiClient.escJs(payload);
  assert.doesNotMatch(escaped, /(?<!\\)'/, 'no unescaped single quote may survive');
});

test('escJs escapes backslashes so the quote escape cannot be cancelled', { skip: MOBILE_ABSENT }, () => {
  // "\\'" would otherwise end the string: the backslash escapes itself and the
  // quote goes through raw.
  const escaped = ApiClient.escJs("\\'");
  assert.equal(escaped, "\\\\\\'");
});

test('escJs neutralises a closing script tag', { skip: MOBILE_ABSENT }, () => {
  assert.doesNotMatch(ApiClient.escJs('</script>'), /<\/script>/);
});

test('escJs strips newlines that would terminate a statement', { skip: MOBILE_ABSENT }, () => {
  const escaped = ApiClient.escJs('a\nb\rc');
  assert.doesNotMatch(escaped, /\n/);
  assert.doesNotMatch(escaped, /\r/);
});

/*
 * A source-level check: the pages that render server-authored text must route
 * it through esc(). This is coarse, but it catches the specific regression of
 * someone reintroducing a bare `${l.reason}` in the approvals list.
 */
/**
 * Returns the contents of every backtick template literal in `source` that
 * contains an HTML tag. Only those reach innerHTML — a plain message template
 * (a toast, which the app sets via textContent) is not an injection sink, and
 * flagging it would train people to ignore this test.
 */
function htmlTemplates(source) {
  const templates = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '`') continue;
    // Skip an escaped backtick.
    if (i > 0 && source[i - 1] === '\\') continue;
    let depth = 0;
    let j = i + 1;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === '\\') { j++; continue; }
      if (c === '$' && source[j + 1] === '{') { depth++; j++; continue; }
      if (c === '}' && depth > 0) { depth--; continue; }
      if (c === '`' && depth === 0) break;
    }
    const body = source.slice(i + 1, j);
    if (/<[a-zA-Z/]/.test(body)) templates.push(body);
    i = j;
  }
  return templates;
}

test('the mobile pages do not interpolate known server fields unescaped into HTML', { skip: MOBILE_ABSENT }, () => {
  const jsDir = path.join(__dirname, '..', '..', '..', 'mobile', 'www', 'js');
  const files = [
    ...fs.readdirSync(path.join(jsDir, 'pages')).filter((f) => f.endsWith('.js')).map((f) => path.join('pages', f)),
    'app.js',
  ];
  // Fields holding text an employee can author, or that the server controls.
  const dangerous = [
    'reason', 'rejection_reason', 'employee_name', 'first_name', 'last_name',
    'title', 'body', 'name', 'holiday_name', 'remarks', 'description', 'message',
    'department', 'designation', 'email', 'emp_code', 'username', 'status',
  ];
  const offenders = [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(jsDir, file), 'utf8');
    for (const template of htmlTemplates(source)) {
      for (const field of dangerous) {
        // ${x.reason} / ${ l.reason } — but not ${esc(l.reason)}.
        const bare = new RegExp(`\\$\\{\\s*[a-zA-Z_$][\\w$]*\\.${field}\\b[^}]*\\}`, 'g');
        for (const match of template.match(bare) || []) {
          if (/\besc\(|\bescJs\(|fmtDate\(|fmtDateTime\(|Number\(/.test(match)) continue;
          /*
           * A comparison whose branches are both string literals cannot emit
           * the server value at all — e.g. ${e.status === 'Active' ? 'success'
           * : 'muted'} picks a CSS class. The field is only read, never
           * rendered.
           */
          if (/[=!]==?[^?]*\?\s*'[^']*'\s*:\s*'[^']*'\s*\}$/.test(match)) continue;
          offenders.push(`${file}: ${match.trim()}`);
        }
      }
    }
  }

  assert.deepEqual(offenders, [], `unescaped server data in mobile HTML templates:\n${offenders.join('\n')}`);
});

test('the escaping scanner actually detects a planted vulnerability', { skip: MOBILE_ABSENT }, () => {
  // A guard against the test above passing because the scanner is broken.
  const vulnerable = 'el.innerHTML = `<div class="x">${l.reason}</div>`;';
  const templates = htmlTemplates(vulnerable);
  assert.equal(templates.length, 1);
  assert.match(templates[0], /\$\{l\.reason\}/);

  const safe = 'el.innerHTML = `<div class="x">${esc(l.reason)}</div>`;';
  assert.doesNotMatch(htmlTemplates(safe)[0].match(/\$\{[^}]*reason[^}]*\}/)[0], /^\$\{l\.reason\}$/);

  // A non-HTML template must not be collected at all.
  assert.deepEqual(htmlTemplates('showToast(`Working in ${company.name}`);'), []);
});
