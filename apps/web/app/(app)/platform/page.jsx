'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, ClipboardCheck, LogIn, Pencil, Plus, Search, ShieldCheck, ShieldOff, Trash2, Users,
} from 'lucide-react';
import {
  api, fmtDay, getSelectedCompany, getUser, setSelectedCompany,
} from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast,
} from '@/components/ui';

const BLANK = { name: '', slug: '', has_device_attendance: false, error: '' };

/*
 * The server derives the slug the same way whenever the field is left empty:
 * lower-cased, everything outside a-z0-9 dropped, cut to 24 characters. Doing
 * it here too means the schema name is on screen before the company exists,
 * rather than being a surprise in the card that comes back.
 */
function toSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
}

/* GET /companies returns every tenant in one array, so the portfolio numbers
 * are a sum of what is already on screen — never a second request. */
function totals(rows) {
  return rows.reduce(
    (t, c) => ({
      companies: t.companies + 1,
      suspended: t.suspended + (c.status === 'Active' ? 0 : 1),
      employees: t.employees + (c.employees || 0),
      pending: t.pending + (c.pending_leaves || 0),
    }),
    { companies: 0, suspended: 0, employees: 0, pending: 0 },
  );
}

export default function PlatformCompaniesPage() {
  const router = useRouter();
  const toast = useToast();

  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);

  /* Which company this admin is currently administering. It lives in
   * localStorage, so it is read in the effect rather than during render —
   * the server has no idea which one it is and would disagree. */
  const [working, setWorking] = useState(null);

  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');

  const [form, setForm] = useState(null);             // create: { ...BLANK }
  const [edit, setEdit] = useState(null);             // { company, status }
  const [confirming, setConfirming] = useState(null); // { kind, company }
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError('');
    setWorking(getSelectedCompany());
    api('/companies').then(setRows).catch((e) => setError(e.message));
  };

  /*
   * These routes are platform-level, not tenant-level: GET /companies answers
   * a tenant user with 403 "Platform admin access required". Someone who
   * cannot be here is sent home rather than shown a wall of red about a
   * screen they were never meant to open.
   */
  useEffect(() => {
    if (!getUser()?.admin) { setDenied(true); router.replace('/home'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The endpoint takes no query string, so the filtering is done here over the
   * list already in hand — no debounce, because nothing is being asked. */
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (rows || []).filter((c) => {
      if (status && c.status !== status) return false;
      if (!q) return true;
      return [c.name, c.slug, c.schema_name].join(' ').toLowerCase().includes(q);
    });
  }, [rows, term, status]);

  const filtered = !!term.trim() || !!status;

  /* ------------------------------------------------ mutations */

  async function createCompany(ev) {
    ev.preventDefault();
    const name = form.name.trim();
    const typed = form.slug.trim();
    const slug = toSlug(typed || name);

    /* The server answers 400 on a short slug. It can be said here without
     * spending a round trip on it, and the typed values stay on screen. */
    if (slug.length < 2) {
      setForm({ ...form, error: 'Slug must be at least 2 letters or digits — add one, or give the company a longer name.' });
      return;
    }

    setBusy(true);
    try {
      const res = await api('/companies', {
        method: 'POST',
        body: {
          name,
          /* Undefined drops out of the JSON, which is what lets the server
           * derive the slug from the name itself. */
          slug: typed || undefined,
          has_device_attendance: form.has_device_attendance,
        },
      });
      toast(res?.message || `Company "${name}" created`, 'ok');
      setForm(null);
      load();
    } catch (e) {
      toast(e.message, 'err');
      setForm({ ...form, error: e.message });
    } finally {
      setBusy(false);
    }
  }

  /* PUT /companies/:id accepts exactly { status: 'Active' | 'Suspended' } —
   * the one thing about a company the console can change after it exists. */
  async function changeStatus(company, next) {
    setBusy(true);
    try {
      const res = await api(`/companies/${company.id}`, { method: 'PUT', body: { status: next } });
      toast(res?.message || `Company ${next === 'Active' ? 'activated' : 'suspended'}`, 'ok');
      setConfirming(null);
      setEdit(null);
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function deleteCompany(company) {
    setBusy(true);
    try {
      const res = await api(`/companies/${company.id}`, { method: 'DELETE' });
      toast(res?.message || `Company "${company.name}" and all its data deleted`, 'ok');
      /* The tenant this admin was administering has just stopped existing, so
       * the header every later request rides on has to go with it. */
      if (working?.id === company.id) { setSelectedCompany(null); setWorking(null); }
      setConfirming(null);
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  function saveEdit(ev) {
    ev.preventDefault();
    const { company, status: next } = edit;
    if (next === company.status) { setEdit(null); return; }
    /* Switching a live company off locks its people out, so it goes through
     * the same named confirmation the card's own button uses. */
    if (next === 'Suspended') { setEdit(null); setConfirming({ kind: 'deactivate', company }); return; }
    changeStatus(company, 'Active');
  }

  function openCompany(c) {
    /*
     * Everything behind /admin reads whichever company is stored here — the
     * slug rides along as x-company-slug on every later request. Only the
     * three fields the header and the top bar need are kept: the counts would
     * be stale the moment HR adds an employee.
     *
     * A suspended tenant is deliberately still openable. The API only turns
     * away that company's own users; a platform admin is let in precisely so
     * they can sort out whatever got it suspended.
     */
    setSelectedCompany({ id: c.id, name: c.name, slug: c.slug });
    toast(
      c.status === 'Active'
        ? `Now managing ${c.name}`
        : `Now managing ${c.name} — suspended, so its own users cannot sign in`,
      c.status === 'Active' ? 'ok' : 'err',
    );
    router.push('/admin');
  }

  /* ------------------------------------------------ states */

  if (denied) return null;

  if (error && !rows) {
    return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;
  }

  const t = rows ? totals(rows) : null;
  const TILES = t ? [
    { label: 'Companies', val: t.companies, icon: Building2, tone: 'info', meta: 'tenants provisioned' },
    { label: 'Suspended', val: t.suspended, icon: ShieldOff, tone: 'err', meta: 'logins blocked' },
    { label: 'Employees', val: t.employees, icon: Users, tone: 'accent', meta: 'across every tenant' },
    { label: 'Pending leave', val: t.pending, icon: ClipboardCheck, tone: 'warn', meta: 'awaiting a decision' },
  ] : [];

  return (
    <div className="page">
      <PageHead
        eyebrow="Platform Console"
        title="Companies"
        sub="Each company is fully isolated — its own database schema, files, roles and users"
      >
        <button className="btn btn--primary" onClick={() => setForm({ ...BLANK })}>
          <Plus size={16} aria-hidden="true" />New company
        </button>
      </PageHead>

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {/* A refetch that fails keeps the tenants that did load on screen. */}
        {error && rows && <ErrorNote error={error} onRetry={load} />}

        {/* ------------------------------------------------ portfolio totals */}
        {!!rows?.length && (
          <div className="grid grid--4" style={{ gap: 'var(--s4)' }}>
            {TILES.map(({ label, val, icon: Icon, tone, meta }) => (
              <div className="card" style={{ boxShadow: 'none' }} key={label}>
                <div className="stat">
                  <div className="row row--between">
                    <span className="stat__label">{label}</span>
                    <span
                      className="stat__icon"
                      style={{
                        width: '1.75rem', height: '1.75rem',
                        background: `var(--${tone}-soft)`, color: `var(--${tone})`,
                      }}
                    >
                      <Icon size={14} aria-hidden="true" />
                    </span>
                  </div>
                  <p className="stat__val num">{val}</p>
                  <p className="stat__meta">{meta}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ------------------------------------------------ the grid */}
        <section className="card">
          <h2 className="sr">Companies on the platform</h2>

          <div className="filterbar">
            <span className="search">
              <Search size={16} aria-hidden="true" />
              <label className="sr" htmlFor="co-search">Search companies</label>
              <input
                id="co-search"
                className="input"
                type="search"
                value={term}
                onChange={(ev) => setTerm(ev.target.value)}
                placeholder="Search by name, slug or schema…"
              />
            </span>

            <label className="sr" htmlFor="co-status">Filter by status</label>
            <select
              id="co-status"
              className="select"
              value={status}
              onChange={(ev) => setStatus(ev.target.value)}
            >
              <option value="">All statuses</option>
              <option value="Active">Active</option>
              <option value="Suspended">Suspended</option>
            </select>

            <span className="spacer" />
            {rows && (
              <span className="faint" style={{ fontSize: '.75rem' }}>
                {shown.length} of {rows.length} shown
              </span>
            )}
          </div>

          {!rows ? (
            <Skeleton rows={4} height={148} />
          ) : shown.length === 0 ? (
            /* Two different nothings: a platform that has never had a company,
               and a filter that happens to match none. They do not read the
               same and they do not recover the same way. */
            <Empty
              icon={Building2}
              title={filtered ? 'No companies match' : 'No companies yet'}
              body={
                filtered
                  ? 'Nothing on the platform matches that search and status. Clear them to bring every tenant back.'
                  : 'Create your first company, then open it to add HR, the Director and employees. Each one is provisioned with its own database schema, uploads folder, the four system roles and four leave types seeded at zero accrual.'
              }
              action={
                filtered ? (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => { setTerm(''); setStatus(''); }}
                  >
                    Clear filters
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="card__body">
              <div className="grid grid--3">
                {shown.map((c) => {
                  const active = c.status === 'Active';
                  const isWorking = working?.id === c.id;
                  return (
                    <article
                      className="card"
                      key={c.id}
                      /* The ring marks the working tenant, but a ring is colour
                         on its own, so the card carries a badge saying so too. */
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: isWorking ? '0 0 0 2px var(--accent)' : 'none',
                      }}
                    >
                      <div
                        className="card__body"
                        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)', flex: 1 }}
                      >
                        <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                          <span className="stat__icon">
                            <Building2 size={22} aria-hidden="true" />
                          </span>
                          <span className="row row--wrap" style={{ gap: 'var(--s2)', justifyContent: 'flex-end' }}>
                            {isWorking && <span className="badge badge--neutral">Working tenant</span>}
                            {c.has_device_attendance && <span className="badge badge--info">Biometric</span>}
                            {/* StatusBadge has never met "Suspended", so the
                                tone is named rather than guessed. */}
                            <StatusBadge status={c.status} tone={active ? 'ok' : 'err'} />
                          </span>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: 600 }}>
                            {c.name}
                          </h3>
                          <p
                            className="faint"
                            style={{ fontSize: '.75rem', marginTop: '.15rem', overflowWrap: 'anywhere' }}
                          >
                            slug <span className="mono">{c.slug}</span> · schema{' '}
                            <span className="mono">{c.schema_name}</span>
                          </p>
                          <p className="faint" style={{ fontSize: '.75rem' }}>
                            created {fmtDay(c.created_at)}
                          </p>
                        </div>

                        <p className="muted" style={{ fontSize: '.875rem' }}>
                          <span className="mono num">{c.employees}</span> employee(s) ·{' '}
                          <span className="mono num">{c.pending_leaves}</span> pending leave(s)
                        </p>

                        <div
                          className="row"
                          style={{ gap: 'var(--s2)', marginTop: 'auto', paddingTop: 'var(--s2)' }}
                        >
                          <button
                            className="btn btn--primary"
                            style={{ flex: '1 1 auto' }}
                            onClick={() => openCompany(c)}
                          >
                            <LogIn size={15} aria-hidden="true" />Open
                          </button>
                          <button
                            className="iconbtn"
                            onClick={() => setEdit({ company: c, status: c.status })}
                            aria-label={`Edit ${c.name}`}
                            title="Edit company"
                          >
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                          {active ? (
                            <button
                              className="iconbtn"
                              onClick={() => setConfirming({ kind: 'deactivate', company: c })}
                              aria-label={`Deactivate ${c.name}`}
                              title="Deactivate"
                              style={{ color: 'var(--warn)' }}
                            >
                              <ShieldOff size={16} aria-hidden="true" />
                            </button>
                          ) : (
                            <button
                              className="iconbtn"
                              onClick={() => setConfirming({ kind: 'activate', company: c })}
                              aria-label={`Activate ${c.name}`}
                              title="Activate"
                              style={{ color: 'var(--ok)' }}
                            >
                              <ShieldCheck size={16} aria-hidden="true" />
                            </button>
                          )}
                          <button
                            className="iconbtn"
                            onClick={() => setConfirming({ kind: 'delete', company: c })}
                            aria-label={`Delete ${c.name}`}
                            title="Delete company"
                            style={{ color: 'var(--err-text)' }}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card__foot">
            <p className="faint" style={{ fontSize: '.75rem' }}>
              Opening a company makes it the working tenant. The Management block in the sidebar and
              every screen behind it then read that company’s schema and nothing else.
            </p>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------ create */}
      {form && (
        <Modal
          title="Create company"
          sub="A fully isolated tenant, with its own schema, files and roles"
          onClose={() => !busy && setForm(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="company-form" disabled={busy}>
                {busy ? 'Creating…' : 'Create company'}
              </button>
            </>
          }
        >
          <form id="company-form" className="stack" onSubmit={createCompany}>
            <Field id="f-name" label="Company name" required error={form.error}>
              <input
                id="f-name"
                className="input"
                required
                placeholder="Acme Industries"
                value={form.name}
                onChange={(ev) => setForm({ ...form, name: ev.target.value, error: '' })}
                aria-invalid={form.error ? 'true' : undefined}
              />
            </Field>

            <Field
              id="f-slug"
              label="Slug (optional)"
              help="Letters and digits, 2 to 24 characters. It names the isolated database schema and the uploads folder, and it is fixed once the company exists. Derived from the name if left empty."
            >
              <input
                id="f-slug"
                className="input mono"
                maxLength={24}
                placeholder="acme"
                value={form.slug}
                onChange={(ev) => setForm({ ...form, slug: ev.target.value, error: '' })}
              />
            </Field>

            {(form.name.trim() || form.slug.trim()) && (
              <p className="faint" style={{ fontSize: '.75rem', overflowWrap: 'anywhere' }}>
                Schema will be{' '}
                <span className="mono">c_{toSlug(form.slug.trim() || form.name)}</span>
              </p>
            )}

            <div className="field">
              <div className="checkline">
                <input
                  id="f-bio"
                  type="checkbox"
                  checked={form.has_device_attendance}
                  onChange={(ev) => setForm({ ...form, has_device_attendance: ev.target.checked })}
                />
                <label htmlFor="f-bio">This company uses fingerprint / biometric attendance</label>
              </div>
              <p className="help">
                Enables the device features: attendance sync, entry and exit times for employees and
                HR, and the Device Mapping panel.
              </p>
            </div>

            <p className="faint" style={{ fontSize: '.75rem' }}>
              Creating a company provisions its schema, its uploads folder, the four system roles
              (Owner, Director, HR, Employee) and four leave types seeded at zero accrual — Casual,
              Earned, Sick and Comp Off — so nobody carries a balance HR has not granted.
            </p>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------ edit */}
      {edit && (
        <Modal
          title="Edit company"
          sub={`${edit.company.slug} · ${edit.company.name}`}
          onClose={() => !busy && setEdit(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setEdit(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="edit-form" disabled={busy}>
                {busy ? 'Saving…' : 'Save company'}
              </button>
            </>
          }
        >
          <form id="edit-form" className="stack" onSubmit={saveEdit}>
            {/* Everything above the select is on the record but not editable
                from here, so it is shown rather than offered. */}
            <div className="stack" style={{ gap: 'var(--s2)' }}>
              <p className="muted" style={{ fontSize: '.875rem' }}>
                <b>{edit.company.name}</b>
              </p>
              <p className="faint" style={{ fontSize: '.75rem', overflowWrap: 'anywhere' }}>
                slug <span className="mono">{edit.company.slug}</span> · schema{' '}
                <span className="mono">{edit.company.schema_name}</span> · created{' '}
                {fmtDay(edit.company.created_at)}
              </p>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                <span className="mono num">{edit.company.employees}</span> employee(s) ·{' '}
                <span className="mono num">{edit.company.pending_leaves}</span> pending leave(s) ·{' '}
                {edit.company.has_device_attendance ? 'biometric attendance on' : 'no biometric device'}
              </p>
            </div>

            <Field
              id="f-status"
              label="Status"
              required
              help="Suspending a company turns its own users away at the login screen. Nothing is deleted, and activating it again restores access straight away."
            >
              <select
                id="f-status"
                className="select"
                value={edit.status}
                onChange={(ev) => setEdit({ ...edit, status: ev.target.value })}
              >
                <option value="Active">Active</option>
                <option value="Suspended">Suspended</option>
              </select>
            </Field>

            <p className="faint" style={{ fontSize: '.75rem' }}>
              The status is the only thing the console changes after a company exists. The name and
              slug are fixed, because the slug names the PostgreSQL schema and the uploads folder on
              disk — renaming it would orphan both. Everything else about the company is edited
              inside it, where its own audit trail records who did it.
            </p>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------ deactivate */}
      {confirming?.kind === 'deactivate' && (
        <ConfirmModal
          danger
          title="Deactivate company"
          body={`Deactivate "${confirming.company.name}"? Its users are turned away at the login screen with "Your company account is suspended. Contact the administrator." Nothing is deleted — its ${confirming.company.employees} employee record(s), attendance, leave and documents stay exactly where they are, and activating it again restores access straight away.`}
          confirmLabel="Deactivate company"
          busy={busy}
          onConfirm={() => changeStatus(confirming.company, 'Suspended')}
          onClose={() => !busy && setConfirming(null)}
        />
      )}

      {/* ------------------------------------------------ activate */}
      {confirming?.kind === 'activate' && (
        <ConfirmModal
          title="Activate company"
          body={`Activate "${confirming.company.name}"? Its users can sign in again from the next attempt, and the nightly jobs resume on the same schedule.`}
          confirmLabel="Activate company"
          busy={busy}
          onConfirm={() => changeStatus(confirming.company, 'Active')}
          onClose={() => !busy && setConfirming(null)}
        />
      )}

      {/* ------------------------------------------------ delete, in two steps
          The endpoint drops the whole schema with CASCADE and removes the
          uploads folder from disk. There is no undo behind it, so there are
          two deliberate confirmations in front of it. */}
      {confirming?.kind === 'delete' && (
        <ConfirmModal
          danger
          title="Delete company permanently"
          body={`Delete "${confirming.company.name}" permanently? This erases the company's entire database schema — all ${confirming.company.employees} employee record(s), their attendance, leave and documents — and removes its uploads folder from disk. This CANNOT be undone.`}
          confirmLabel="Continue"
          busy={busy}
          onConfirm={() => setConfirming({ kind: 'delete-final', company: confirming.company })}
          onClose={() => setConfirming(null)}
        />
      )}

      {confirming?.kind === 'delete-final' && (
        <ConfirmModal
          danger
          title="Really sure?"
          body={`Final confirmation. "${confirming.company.name}" and every record inside it is destroyed the moment you confirm.`}
          confirmLabel="Delete permanently"
          busy={busy}
          onConfirm={() => deleteCompany(confirming.company)}
          onClose={() => !busy && setConfirming(null)}
        />
      )}
    </div>
  );
}
