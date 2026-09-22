'use client';

/*
 * API client.
 *
 * Relative by default: Next rewrites /api/* to the backend (next.config.mjs
 * in dev, netlify.toml in production), so the browser always calls its own
 * origin and there is no CORS surface to get wrong.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

const TOKEN_KEY = 'vhr_token';
const USER_KEY = 'vhr_user';
const COMPANY_KEY = 'vhr_company';

/* localStorage throws in private mode and in some embedded webviews, and an
 * HR portal that white-screens there is worse than one that just asks you to
 * sign in again. Every access is guarded. */
function read(key) {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function drop(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
function readJson(key) {
  const raw = read(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function getToken() { return read(TOKEN_KEY); }
export function getUser() { return readJson(USER_KEY); }

export function setSession(token, user) {
  write(TOKEN_KEY, token);
  write(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  drop(TOKEN_KEY);
  drop(USER_KEY);
  drop(COMPANY_KEY);
}

/* Platform admins work "inside" a company they pick; tenant users are bound to
 * their own and never send this header. */
export function getSelectedCompany() { return readJson(COMPANY_KEY); }

export function setSelectedCompany(company) {
  if (company) write(COMPANY_KEY, JSON.stringify(company));
  else drop(COMPANY_KEY);
}

/* Permissions are granted, never assumed: anything not in the list is absent
 * from the UI rather than present and locked. */
export function hasPerm(key) {
  const user = getUser();
  if (!user) return false;
  if (user.admin) return true;
  return (user.permissions || []).includes(key);
}

function authHeaders() {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const user = getUser();
  if (user?.admin) {
    const company = getSelectedCompany();
    if (company?.slug) headers['x-company-slug'] = company.slug;
  }
  return headers;
}

export async function api(path, options = {}) {
  const { method = 'GET', body, formData } = options;
  const headers = authHeaders();
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    cache: 'no-store',
    body: formData || (body ? JSON.stringify(body) : undefined),
  });

  /* A 401 anywhere but the login call means the session died under us --
   * expired, or revoked. Clear it and start over rather than leaving a
   * half-authenticated page rendering stale data. */
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    clearSession();
    window.location.href = '/login?expired=1';
    throw new Error('Session expired');
  }

  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

/* Documents sit behind auth, so they cannot be a plain href. Fetch as a blob
 * with the token attached, then hand the browser an object URL. */
export async function openProtectedFile(path, download = false, filename = 'document.pdf') {
  /* A tab opened *after* the await has lost the click that authorised it, and
   * Safari and Firefox then swallow it with no error at all — the button just
   * appears dead. Claim the tab synchronously, while the gesture still counts,
   * and point it at the blob once that arrives. */
  const tab = download ? null : window.open('', '_blank');
  if (tab) {
    tab.document.write(
      '<!doctype html><meta charset="utf-8"><title>Opening…</title>'
      + '<p style="font:14px/1.5 system-ui,sans-serif;padding:2rem">Opening document…</p>',
    );
    tab.document.close();
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), cache: 'no-store' });
  } catch (e) {
    if (tab) tab.close();
    throw e;
  }
  if (!res.ok) {
    if (tab) tab.close();
    let msg = 'Could not open that document';
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }

  const url = URL.createObjectURL(await res.blob());
  const save = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (download) save();
  else if (tab) tab.location.replace(url);
  /* Blocked despite the gesture. Save the file rather than leave the click
   * with nothing to show for it. */
  else save();

  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---------------------------------------------------------------- format */

/* The server clock is not IST, so dates arrive as plain YYYY-MM-DD strings and
 * are formatted as text. Parsing them into a Date would shift the day. */
export function fmtDate(value) {
  if (!value) return '—';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : String(value);
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const s = String(value);
  const [y, m, d] = s.slice(0, 10).split('-');
  const time = s.slice(11).trim();
  if (!d) return s;
  return time ? `${d}/${m}/${y} ${time}` : `${d}/${m}/${y}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-09-24 → "24 Sep 2026" */
export function fmtDay(value, withYear = true) {
  if (!value) return '—';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  if (!d) return String(value);
  return `${d} ${MONTHS[+m - 1]}${withYear ? ' ' + y : ''}`;
}

/** Indian digit grouping: 1234567 → ₹12,34,567 */
export function money(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (Number.isNaN(v)) return '—';
  const s = Math.round(Math.abs(v)).toString();
  let last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  if (rest) last3 = ',' + last3;
  return (v < 0 ? '-' : '') + '₹' + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + last3;
}

export function initials(name = '') {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}
