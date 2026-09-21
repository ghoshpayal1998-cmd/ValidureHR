/*
 * Per-company file storage.
 *
 * Files are addressed by an OBJECT KEY of the form
 *   <slug>/<kind>/<file>            e.g. ftr/slips/1786033099423-payslip.pdf
 * which is a path on disk for the local driver and an object name in a private
 * bucket for the Supabase driver. Same layout either way, so moving between
 * them is a straight copy.
 *
 * Choose with STORAGE_DRIVER=local|supabase (default: local, i.e. the existing
 * self-hosted behaviour). The public surface below — uploader, filePath,
 * sendUserFile, ensureCompanyDirs — is unchanged from the disk-only version, so
 * routes/documents.js, routes/leaves.js and routes/companies.js do not care
 * which driver is active.
 */
const path = require('path');
const multer = require('multer');

const KINDS = ['policies', 'offers', 'slips', 'leave-docs', 'photos'];

const DRIVER_NAME = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
const driver = DRIVER_NAME === 'supabase'
  ? require('./storageDrivers/supabase')
  : require('./storageDrivers/local');

if (!['local', 'supabase'].includes(DRIVER_NAME)) {
  throw new Error(`Unknown STORAGE_DRIVER "${DRIVER_NAME}" — expected "local" or "supabase".`);
}

/*
 * Accepted upload types. Everything here is a document or an image — nothing
 * the browser will execute. An .html or .svg upload served back from the API
 * origin would run as script in the portal's own origin (single-tunnel mode
 * puts the API and the app on one host), which is stored XSS against every
 * user who opens the attachment.
 *
 * Both the declared MIME type and the file extension must match: the MIME type
 * is client-supplied, and the extension is what decides the Content-Type on the
 * way back out.
 */
const ALLOWED_TYPES = new Map([
  ['application/pdf', ['.pdf']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/webp', ['.webp']],
  ['image/heic', ['.heic']],
  ['application/msword', ['.doc']],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['.docx']],
]);

const ALLOWED_EXTENSIONS = new Set([...ALLOWED_TYPES.values()].flat());

// Extension -> MIME, for setting Content-Type when streaming a file back.
const TYPE_BY_EXTENSION = new Map();
for (const [mime, extensions] of ALLOWED_TYPES) {
  for (const ext of extensions) if (!TYPE_BY_EXTENSION.has(ext)) TYPE_BY_EXTENSION.set(ext, mime);
}

/** Rejected-upload errors carry a 400, not the generic 500 from the error handler. */
class UploadTypeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadTypeError';
    this.status = 400;
  }
}

function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function fileFilter(req, file, cb) {
  const mime = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
  const ext = extensionOf(file.originalname);
  const allowedExts = ALLOWED_TYPES.get(mime);
  if (!allowedExts) {
    return cb(new UploadTypeError(`Files of type "${mime || 'unknown'}" are not accepted. Allowed: PDF, JPG, PNG, WEBP, DOC, DOCX.`));
  }
  if (!allowedExts.includes(ext)) {
    return cb(new UploadTypeError(`The file extension "${ext || '(none)'}" does not match its type "${mime}".`));
  }
  cb(null, true);
}

function assertSlug(slug) {
  if (!/^[a-z0-9]{2,24}$/.test(String(slug || ''))) throw new Error('Invalid company slug');
  return slug;
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) throw new Error('Invalid storage kind');
  return kind;
}

/** "<slug>/<kind>/<basename>" — the address of one stored file. */
function objectKey(slug, kind, fileName) {
  assertSlug(slug);
  assertKind(kind);
  // basename() strips any directory component, so "../../etc/passwd" cannot
  // escape the company prefix through a stored file name.
  return `${slug}/${kind}/${path.basename(String(fileName))}`;
}

/** Provisions storage for a new company. A no-op for object storage. */
function ensureCompanyDirs(slug) {
  assertSlug(slug);
  driver.ensureCompany(slug, KINDS);
}

/**
 * Generates the stored name for an upload: a timestamp plus a sanitised version
 * of what the user called it, so two people uploading "certificate.pdf" do not
 * collide and nothing unexpected reaches the filesystem or the bucket.
 */
function storedName(originalName) {
  const base = path.basename(String(originalName || 'upload'));
  const safe = base.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 100) || 'upload';
  return `${Date.now()}-${safe}`;
}

/*
 * Upload middleware. Returns an object with the same .single(field) call shape
 * multer has, so the routes are untouched — but .single() yields a PAIR of
 * middleware: multer buffers the upload in memory, then persist() hands it to
 * the active driver and sets req.file.filename to the stored name, which is the
 * value the routes write to the database.
 *
 * Memory buffering is safe here because the limit below is 10 MB and only one
 * file is accepted per request.
 */
function uploader(kind) {
  assertKind(kind);
  const mw = multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  const persist = (field) => async (req, res, next) => {
    try {
      if (!req.file) return next(); // optional attachment — nothing to store
      const name = storedName(req.file.originalname);
      const key = objectKey(req.company.slug, kind, name);
      await driver.put(key, req.file.buffer, req.file.mimetype);
      req.file.filename = name;
      req.file.key = key;
      // The buffer is no longer needed; drop the reference so it can be freed
      // rather than held for the life of the request.
      delete req.file.buffer;
      next();
    } catch (e) { next(e); }
  };

  return {
    single(field) {
      return [mw.single(field), persist(field)];
    },
  };
}

/**
 * Resolves a stored file name to its object key, or null when there is nothing
 * to resolve. The local driver can check existence synchronously and does, to
 * preserve the "File missing on server" 404 the routes expect; remote drivers
 * defer that to sendUserFile, which reports the same 404 one round-trip later.
 */
function filePath(slug, kind, fileName) {
  if (!fileName) return null;
  let key;
  try {
    key = objectKey(slug, kind, fileName);
  } catch {
    return null;
  }
  return driver.existsSync(key) ? key : null;
}

/*
 * Sends a stored file as a download, never as a page.
 *
 * `attachment` stops the browser rendering it in the API's origin, and nosniff
 * stops it second-guessing the Content-Type. Both matter because the bytes came
 * from an ordinary employee. The Content-Type is derived from the extension
 * validated at upload time, not from anything the storage backend echoes back.
 *
 * Never rejects: callers invoke it without awaiting, so it reports its own
 * failures on the response rather than surfacing an unhandled rejection.
 */
async function sendUserFile(res, key, downloadName, inline = false) {
  const safeName = String(downloadName || path.basename(String(key)))
    .replace(/[^a-zA-Z0-9 .\-_]/g, '_');
  try {
    const object = await driver.getStream(key);
    if (!object) {
      if (!res.headersSent) res.status(404).json({ error: 'File missing on server' });
      return;
    }

    const type = TYPE_BY_EXTENSION.get(extensionOf(key)) || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (object.size !== undefined) res.setHeader('Content-Length', object.size);

    // A read failure part-way through cannot be turned into a clean error
    // response — the headers are already out — so tear the connection down.
    object.stream.on('error', () => res.destroy());
    object.stream.pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Could not read the stored file' });
    else res.destroy();
  }
}

module.exports = {
  uploader, filePath, ensureCompanyDirs, sendUserFile, fileFilter, objectKey,
  UploadTypeError, ALLOWED_TYPES, ALLOWED_EXTENSIONS, KINDS,
  driver, DRIVER_NAME,
  // Retained for compatibility with code and tests that referenced the
  // disk-only layout; meaningful for the local driver only.
  UPLOADS_ROOT: driver.root,
};
