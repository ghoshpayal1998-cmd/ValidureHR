'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, ClipboardCheck, LogIn, Pencil, Plus, Search, ShieldCheck, ShieldOff, SlidersHorizontal, Trash2, Users,
} from 'lucide-react';
import {
  api, fmtDay, getSelectedCompany, getUser, setSelectedCompany,
} from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast,
} from '@/components/ui';

const BLANK = {
  name: '', slug: '', plan: 'essential', has_device_attendance: false,
  owner_email: '', owner_first: '', owner_last: '', owner_code: '',
  owner_dob: '', owner_doj: '',
  error: '',
};

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
  /* The one and only copy of a generated password, held until it is dismissed.
   * Losing it means resetting the account, so it does not vanish on a toast. */
  const [handover, setHandover] = useState(null);
  /* { company, plan, grant:Set, revoke:Set } — the whole intended state of one
   * company's access, edited as a matrix and saved in one call. */
  const [access, setAccess] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
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
          plan: form.plan,
          has_device_attendance: form.has_device_attendance,
          owner: form.owner_email.trim()
            ? {
              email: form.owner_email.trim(),
              first_name: form.owner_first.trim() || undefined,
              last_name: form.owner_last.trim() || undefined,
              emp_code: form.owner_code.trim() || undefined,
              dob: form.owner_dob || undefined,
              doj: form.owner_doj || undefined,
            }
            : undefined,
        },
      });

      /* The generated password is in this response and nowhere else once the
       * toast fades, so say plainly whether the mail carrying it actually left
       * — and show it either way. */
      if (res?.warning) {
        toast(res.warning, 'warn');
      } else if (res?.owner) {
        setHandover(res.owner);
        toast(res.owner.emailed
          ? `Company created. Credentials emailed to ${res.owner.email}.`
          : `Company created, but the email did not send — copy the password below.`,
        res.owner.emailed ? 'ok' : 'warn');
      } else {
        toast(res?.message || `Company "${name}" created`, 'ok');
      }
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

  /*
   * Open the access matrix for a company. The catalogue (every permission key,
   * and what each plan includes by default) is fetched once and reused: it is
   * the same for every company and does not change between page loads.
   */
  async function openAccess(company) {
    try {
      const cat = catalogue || await api('/companies/entitlements');
      if (!catalogue) setCatalogue(cat);
      const ov = company.overrides || { grant: [], revoke: [] };
      setAccess({
        company,
        plan: company.plan || 'essential',
        grant: new Set(ov.grant || []),
        revoke: new Set(ov.revoke || []),
      });
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  /* One switch per key. A key the plan already includes is turned off by
   * revoking it; one it does not is turned on by granting it. Storing the
   * intent rather than the result is what lets a later plan change re-evaluate
   * without silently keeping an override nobody remembers setting. */
  function toggleKey(key, wanted) {
    const planHas = (catalogue?.plans?.[access.plan] || []).includes(key);
    const grant = new Set(access.grant);
    const revoke = new Set(access.revoke);
    grant.delete(key); revoke.delete(key);
    if (wanted && !planHas) grant.add(key);
    if (!wanted && planHas) revoke.add(key);
    setAccess({ ...access, grant, revoke });
  }

  async function saveAccess() {
    setBusy(true);
    try {
      const res = await api(`/companies/${access.company.id}`, {
        method: 'PUT',
        body: {
          plan: access.plan,
          grant: [...access.grant],
          revoke: [...access.revoke],
        },
      });
      toast(res?.message || 'Access updated', 'ok');
      setAccess(null);
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
                            onClick={() => openAccess(c)}
                            aria-label={`Access and plan for ${c.name}`}
                            title="Access & plan"
                          >
                            <SlidersHorizontal size={16} aria-hidden="true" />
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

      {/* ------------------------------------------------ access matrix */}
      {access && catalogue && (
        <Modal
          title="Access"
          sub={`What ${access.company.name} can reach — the plan, and anything set by hand on top of it`}
          onClose={() => !busy && setAccess(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setAccess(null)} disabled={busy}>Cancel</button>
              <button className="btn btn--primary" onClick={saveAccess} disabled={busy}>
                {busy ? 'Saving…' : 'Save access'}
              </button>
            </>
          }
        >
          <div className="stack" style={{ gap: 'var(--s5)' }}>
            <Field id="a-plan" label="Plan" help="Sets the defaults below. Changing it does not discard anything you have set by hand.">
              <select
                id="a-plan"
                className="input"
                value={access.plan}
                onChange={(ev) => setAccess({ ...access, plan: ev.target.value })}
              >
                <option value="basic">Basic</option>
                <option value="essential">Essential</option>
                <option value="advanced">Advanced</option>
              </select>
            </Field>

            <div className="tablewrap">
              <table className="table">
                <caption className="sr">
                  Every permission key, whether this company&rsquo;s plan includes it, and whether it
                  has been granted or withheld by hand.
                </caption>
                <thead>
                  <tr><th scope="col">Capability</th><th scope="col">On the plan</th><th scope="col">Allowed</th></tr>
                </thead>
                <tbody>
                  {catalogue.permissions.map((perm) => {
                    const planHas = (catalogue.plans[access.plan] || []).includes(perm.key);
                    const granted = access.grant.has(perm.key);
                    const revoked = access.revoke.has(perm.key);
                    const on = revoked ? false : (granted || planHas);
                    return (
                      <tr key={perm.key}>
                        <th scope="row" style={{ fontWeight: 400 }}>
                          <span style={{ display: 'block' }}>{perm.label}</span>
                          <span className="faint mono" style={{ fontSize: '11px' }}>{perm.key}</span>
                        </th>
                        <td>
                          <span className={`badge ${planHas ? 'badge--ok' : ''}`}>
                            {planHas ? 'included' : 'not included'}
                          </span>
                        </td>
                        <td>
                          <span className="checkline">
                            <input
                              id={`ent-${perm.key}`}
                              type="checkbox"
                              checked={on}
                              onChange={(ev) => toggleKey(perm.key, ev.target.checked)}
                            />
                            <label htmlFor={`ent-${perm.key}`}>
                              {granted && <span className="badge badge--warn">granted by hand</span>}
                              {revoked && <span className="badge badge--err">withheld by hand</span>}
                              {!granted && !revoked && <span className="faint" style={{ fontSize: '.75rem' }}>from the plan</span>}
                            </label>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="faint" style={{ fontSize: '.75rem' }}>
              A capability switched on that the plan does not include is recorded as a deliberate
              grant, and one switched off that the plan does include is recorded as deliberately
              withheld. Both are written to the company&rsquo;s audit log. This caps what anyone in the
              company can reach — it never hands a user a permission their role was not given.
            </p>
          </div>
        </Modal>
      )}

      {/* ------------------------------------------ credential handover */}
      {handover && (
        <Modal
          title="Hand these over"
          sub="The password is shown once. It is not stored anywhere in readable form."
          onClose={() => setHandover(null)}
          footer={
            <button className="btn btn--primary" onClick={() => setHandover(null)}>Done</button>
          }
        >
          <div className="stack" style={{ gap: 'var(--s4)' }}>
            {!handover.emailed && (
              <p className="badge badge--warn" style={{ alignSelf: 'start' }}>
                The email did not send — copy this before closing
              </p>
            )}
            <table className="table">
              <tbody>
                <tr><th scope="row">Username</th><td className="mono">{handover.username}</td></tr>
                <tr><th scope="row">Email</th><td className="mono">{handover.email}</td></tr>
                <tr><th scope="row">Password</th><td className="mono">{handover.password}</td></tr>
              </tbody>
            </table>
            <p className="faint" style={{ fontSize: '.8125rem' }}>
              They must change it at first sign-in. If this window closes before you copy it, use
              Reset password on the company&rsquo;s Employees screen — the password cannot be read back.
            </p>
          </div>
        </Modal>
      )}

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

            <Field
              id="f-plan"
              label="Plan"
              help="What the company has bought. It caps what anyone in the company can reach: Basic stops short of the payroll cycle and the reporting, whatever a role says. Changeable later."
            >
              <select
                id="f-plan"
                className="input"
                value={form.plan}
                onChange={(ev) => setForm({ ...form, plan: ev.target.value })}
              >
                <option value="basic">Basic — attendance, leave, documents, payslips</option>
                <option value="essential">Essential — adds the payroll cycle and reporting</option>
                <option value="advanced">Advanced — adds the mobile app and more than one company</option>
              </select>
            </Field>

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

            <hr className="rule" />

            <p className="eyebrow">The first login</p>
            <p className="faint" style={{ fontSize: '.75rem', marginTop: 'calc(var(--s3) * -1)' }}>
              Optional, but a company with no users cannot be handed to anyone. Fill this in and the
              owner account is created with the company and emailed its password.
            </p>

            <Field id="f-oemail" label="Owner email">
              <input
                id="f-oemail"
                className="input"
                type="email"
                placeholder="owner@acme.com"
                value={form.owner_email}
                onChange={(ev) => setForm({ ...form, owner_email: ev.target.value })}
              />
            </Field>

            <div className="grid grid--2" style={{ gap: 'var(--s4)' }}>
              <Field id="f-ofirst" label="First name">
                <input id="f-ofirst" className="input" placeholder="Priya"
                  value={form.owner_first}
                  onChange={(ev) => setForm({ ...form, owner_first: ev.target.value })} />
              </Field>
              <Field id="f-olast" label="Last name">
                <input id="f-olast" className="input" placeholder="Sharma"
                  value={form.owner_last}
                  onChange={(ev) => setForm({ ...form, owner_last: ev.target.value })} />
              </Field>
            </div>

            <div className="grid grid--2" style={{ gap: 'var(--s4)' }}>
              <Field id="f-odob" label="Date of birth" help="Required — the employee record will not accept a blank.">
                <input id="f-odob" className="input" type="date"
                  value={form.owner_dob}
                  onChange={(ev) => setForm({ ...form, owner_dob: ev.target.value })} />
              </Field>
              <Field id="f-odoj" label="Date of joining" help="Defaults to today.">
                <input id="f-odoj" className="input" type="date"
                  value={form.owner_doj}
                  onChange={(ev) => setForm({ ...form, owner_doj: ev.target.value })} />
              </Field>
            </div>

            <Field id="f-ocode" label="Employee code" help="Their username. Defaults to ADMIN-001.">
              <input id="f-ocode" className="input mono" placeholder="ADMIN-001"
                value={form.owner_code}
                onChange={(ev) => setForm({ ...form, owner_code: ev.target.value })} />
            </Field>

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
