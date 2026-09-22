/*
 * S-6 — uploads had no type check and were served back inline. In single-tunnel
 * mode the API shares the portal's origin, so an uploaded .html rendered as a
 * page in that origin: stored XSS against the portal, uploadable by any
 * authenticated employee through a leave attachment.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { fileFilter, UploadTypeError, ALLOWED_EXTENSIONS } =
  require(path.join(__dirname, '..', '..', 'src', 'storage'));

/** Runs the multer fileFilter synchronously and reports what it decided. */
function filter(mimetype, originalname) {
  let outcome;
  fileFilter({}, { mimetype, originalname }, (err, accepted) => {
    outcome = err ? { rejected: true, error: err } : { rejected: !accepted, error: null };
  });
  return outcome;
}

test('accepts the document types the app actually uses', () => {
  const allowed = [
    ['application/pdf', 'policy.pdf'],
    ['image/jpeg', 'scan.jpg'],
    ['image/jpeg', 'scan.jpeg'],
    ['image/png', 'certificate.png'],
    ['image/webp', 'photo.webp'],
    ['application/msword', 'letter.doc'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'letter.docx'],
  ];
  for (const [mime, name] of allowed) {
    assert.equal(filter(mime, name).rejected, false, `${mime} / ${name} should be accepted`);
  }
});

test('rejects HTML — the payload that makes this stored XSS', () => {
  const result = filter('text/html', 'payload.html');
  assert.ok(result.rejected);
  assert.ok(result.error instanceof UploadTypeError);
  assert.equal(result.error.status, 400);
});

test('rejects SVG, which executes script when rendered', () => {
  assert.ok(filter('image/svg+xml', 'logo.svg').rejected);
});

test('rejects scripts and executables', () => {
  const blocked = [
    ['application/javascript', 'x.js'],
    ['text/javascript', 'x.js'],
    ['application/x-msdownload', 'x.exe'],
    ['application/x-sh', 'x.sh'],
    ['text/xml', 'x.xml'],
    ['application/octet-stream', 'x.bin'],
  ];
  for (const [mime, name] of blocked) {
    assert.ok(filter(mime, name).rejected, `${mime} should be rejected`);
  }
});

test('rejects a file whose extension contradicts its declared type', () => {
  // The MIME type is client-supplied; the extension is what sendFile uses to
  // choose the response Content-Type. A mismatch means one of them is a lie.
  const result = filter('application/pdf', 'payload.html');
  assert.ok(result.rejected);
  assert.match(result.error.message, /does not match/);
});

test('rejects a file with no extension at all', () => {
  assert.ok(filter('application/pdf', 'payload').rejected);
});

test('rejects a double extension that ends in an executable one', () => {
  assert.ok(filter('application/pdf', 'invoice.pdf.html').rejected);
  assert.ok(filter('image/png', 'avatar.png.svg').rejected);
});

test('rejects a missing or empty MIME type', () => {
  assert.ok(filter('', 'x.pdf').rejected);
  assert.ok(filter(undefined, 'x.pdf').rejected);
});

test('extension matching is case-insensitive', () => {
  assert.equal(filter('application/pdf', 'POLICY.PDF').rejected, false);
});

test('tolerates a charset parameter on the MIME type', () => {
  assert.equal(filter('application/pdf; charset=binary', 'x.pdf').rejected, false);
});

test('no executable or renderable extension is on the allow list', () => {
  const dangerous = ['.html', '.htm', '.svg', '.js', '.mjs', '.xml', '.exe', '.sh', '.bat', '.php'];
  for (const ext of dangerous) {
    assert.ok(!ALLOWED_EXTENSIONS.has(ext), `${ext} must not be allowed`);
  }
});
