'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calculator, CalendarCog, Pencil, Plus, RefreshCw, Save, Scale, ScrollText, Trash2, Users,
} from 'lucide-react';
import { api, fmtDateTime, fmtDay } from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast,
} from '@/components/ui';

/* Nothing on this screen is money — every figure is DAYS, and most of them are
 * fractional. Numeric columns can come back from the driver as strings, so
 * every figure goes through one coercion before it is printed or compared. */
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const raw = (v) => String(Math.round(num(v) * 100) / 100);   /* 6.50 → "6.5" */
const signed = (v) => (num(v) > 0 ? '+' : '') + raw(v);
const days = (v) => `${raw(v)} ${Math.abs(num(v)) === 1 ? 'day' : 'days'}`;

/* The ledger stores why a balance moved as a short key; the wording and the
 * tone belong here rather than in the data. An unrecognised kind still
 * renders — it prints the raw key on a neutral badge. */
const KINDS = {
  accrual: { label: 'Accrual', tone: 'info' },
  adjustment: { label: 'Adjustment', tone: 'neutral' },
  leave_taken: { label: 'Leave taken', tone: 'err' },
  leave_cancelled: { label: 'Leave cancelled', tone: 'ok' },
};

export default function AdminBalancesPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  /* The accrual day is a second, cheap lookup — derived server-side from the
   * payroll cycle start day — so it is held apart from the grid and never
   * blocks it. Read-only here; Settings owns the cycle. */
  const [accrualDay, setAccrualDay] = useState(24);

  /* Rate inputs edit locally — nothing reaches the server until the save icon
   * on that tile is clicked, so a half-typed "1." never becomes a rate. */
  const [rates, setRates] = useState({});
  const [savingRate, setSavingRate] = useState(0);
  const [running, setRunning] = useState(false);

  /* adjust dialog: the employee-and-type pair the clicked cell stands for */
  const [adjusting, setAdjusting] = useState(null);
  const [delta, setDelta] = useState('');
  const [deltaErr, setDeltaErr] = useState('');
  const [note, setNote] = useState('');

  /* ledger dialog: who it is for, and its own load of the trail */
  const [ledgerFor, setLedgerFor] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [ledgerErr, setLedgerErr] = useState('');

  /* leave type dialogs — `typeForm` is shared by add and edit, `mode` says
   * which, so the two never drift apart in wording or validation */
  const [typeForm, setTypeForm] = useState(null);
  const [typeErrs, setTypeErrs] = useState({});
  const [deleting, setDeleting] = useState(null);

  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setError('');
    api('/balances')
      .then((d) => {
        setData(d);
        /* reseed the local rate drafts from whatever the server just sent,
         * so a saved rate and an abandoned edit both end up truthful */
        setRates(Object.fromEntries((d.types || []).map((t) => [t.id, raw(t.monthly_accrual)])));
      })
      .catch((e) => setError(e.message));

    /* A failure here must not take the grid down with it: the strip falls
     * back to the documented default of 24 rather than showing an error for
     * a setting nobody was looking at. */
    api('/balances/accrual-day')
      .then((r) => {
        const d = Number(r?.accrual_day) || 24;
        setAccrualDay(d);
      })
      .catch(() => { /* default stands */ });
  };
  useEffect(load, []);

  /* ---------------------------------------------------------- accrual run */

  async function runAccrual() {
    setRunning(true);
    try {
      const res = await api('/balances/run-accrual', { method: 'POST' });
      toast(res?.message || 'Accrual run complete', 'ok');
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setRunning(false);
    }
  }

  /* ---------------------------------------------------------- rates */

  async function saveRate(t) {
    const v = Number(rates[t.id]);
    if (rates[t.id] === '' || isNaN(v) || v < 0) {
      toast('Monthly accrual must be a non-negative number (decimals allowed)', 'err');
      return;
    }
    setSavingRate(t.id);
    try {
      const res = await api(`/balances/rates/${t.id}`, { method: 'PUT', body: { monthly_accrual: v } });
      toast(res?.message || `${t.name}: ${days(v)} will accrue per month`, 'ok');
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setSavingRate(0);
    }
  }

  /* ---------------------------------------------------------- leave types */

  function openAddType() {
    /* one day a month is the rate HR picks far more often than zero */
    setTypeForm({ mode: 'add', id: null, name: '', code: '', monthly_accrual: '1' });
    setTypeErrs({});
  }

  function openEditType(t) {
    /* the rate is deliberately absent here — it is edited on the tile itself */
    setTypeForm({ mode: 'edit', id: t.id, name: t.name || '', code: t.code || '' });
    setTypeErrs({});
  }

  function closeType() {
    if (submitting) return;
    setTypeForm(null);
  }

  async function submitType() {
    const errs = {};
    if (!typeForm.name.trim()) errs.name = 'Name is required';
    if (!typeForm.code.trim()) errs.code = 'Code is required';
    if (typeForm.mode === 'add') {
      const r = Number(typeForm.monthly_accrual);
      if (typeForm.monthly_accrual === '' || isNaN(r) || r < 0) {
        errs.rate = 'A non-negative number of days (decimals allowed)';
      }
    }
    setTypeErrs(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      const res = typeForm.mode === 'add'
        ? await api('/balances/types', {
            method: 'POST',
            body: {
              name: typeForm.name.trim(),
              code: typeForm.code.trim(),
              monthly_accrual: Number(typeForm.monthly_accrual),
            },
          })
        : await api(`/balances/types/${typeForm.id}`, {
            method: 'PUT',
            body: { name: typeForm.name.trim(), code: typeForm.code.trim() },
          });
      toast(res?.message || 'Leave type saved', 'ok');
      setTypeForm(null);
      load();
    } catch (e) {
      /* a duplicate name or code comes back as a 409 — keep the dialog open
       * with the typed values so the clash can be fixed in place */
      toast(e.message, 'err');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    setSubmitting(true);
    try {
      const res = await api(`/balances/types/${deleting.id}`, { method: 'DELETE' });
      toast(res?.message || 'Leave type deleted', 'ok');
      setDeleting(null);
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------------------------------------- adjustments */

  function openAdjust(emp, t) {
    setAdjusting({ emp, type: t });
    setDelta('');
    setDeltaErr('');
    setNote('');
  }

  function closeAdjust() {
    if (submitting) return;
    setAdjusting(null);
  }

  async function submitAdjust() {
    const d = Number(delta);
    if (delta === '' || isNaN(d) || d === 0) {
      setDeltaErr('Enter a non-zero number of days — negative to deduct');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api('/balances/adjust', {
        method: 'POST',
        body: {
          employee_id: adjusting.emp.employee_id,
          leave_type_id: adjusting.type.id,
          delta: d,
          note: note.trim() || undefined,
        },
      });
      toast(res?.message || `Balance adjusted by ${signed(d)} day(s)`, 'ok');
      setAdjusting(null);
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------------------------------------- ledger */

  function openLedger(emp) {
    setLedgerFor(emp);
    setLedger(null);
    setLedgerErr('');
    loadLedger(emp);
  }

  function loadLedger(emp) {
    setLedgerErr('');
    api(`/balances/ledger/${emp.employee_id}`)
      .then(setLedger)
      .catch((e) => setLedgerErr(e.message));
  }

  /* ---------------------------------------------------------- render */

  /* The accrual run does not depend on the grid, so the button works while
   * the grid is still loading — it is defined before the early returns. */
  const runButton = (
    <button className="btn btn--ghost" onClick={runAccrual} disabled={running}>
      <RefreshCw size={16} aria-hidden="true" />
      {running ? 'Crediting…' : 'Run accrual now'}
    </button>
  );

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!data) {
    return (
      <div className="page">
        <PageHead eyebrow="Leave" title="Leave Balances">{runButton}</PageHead>
        <div className="card"><Skeleton rows={4} /></div>
      </div>
    );
  }

  const types = data.types || [];
  const employees = data.employees || [];

  return (
    <div className="page">
      <PageHead
        eyebrow="Leave"
        title="Leave Balances"
        sub="Monthly accrual rates, accumulated balances and manual corrections — every figure is days, decimals included."
      >
        {runButton}
      </PageHead>

      <div className="stack" style={{ gap: 'var(--s5)' }}>

        {/* ------------------------------------------------ accrual rates */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 className="row" style={{
                gap: 'var(--s2)', fontFamily: 'var(--font-body)',
                fontSize: '1.0625rem', fontWeight: 600,
              }}>
                <Calculator size={18} aria-hidden="true" style={{ color: 'var(--accent)', flex: 'none' }} />
                Monthly accrual rates
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Days credited to every employee each month. Balances accumulate and carry over —
                accrual also runs automatically every day (current period: {data.current_period}).
              </p>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={openAddType} disabled={submitting}>
              <Plus size={15} aria-hidden="true" />
              Add leave type
            </button>
          </div>

          <div className="card__body">
            <div className="stack" style={{ gap: 'var(--s4)' }}>

              {/* ------------------------------ the accrual day, two states:
                  the saved day, or the inline editor that replaces it */}
              <div
                className="row row--wrap"
                style={{
                  gap: 'var(--s3)',
                  padding: 'var(--s3)',
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r)',
                  maxWidth: '38rem',
                }}
              >
                <CalendarCog size={16} aria-hidden="true" style={{ color: 'var(--faint)', flex: 'none' }} />

                {/* Stated, not edited. The accrual day is derived from the
                    payroll cycle start day and is deliberately not stored on
                    its own — see cycle.js. The editor that used to sit here
                    wrote a setting the accrual engine never reads, answered
                    with a success message, and left this screen disagreeing
                    with Settings about the same company. */}
                <span className="stat__label">Monthly accrual day</span>
                <span className="badge badge--info">Day {accrualDay} of the month</span>
                <span className="faint" style={{ fontSize: '.75rem' }}>
                  follows the payroll cycle — set the cycle start day in{' '}
                  <Link href="/admin/settings" style={{ color: 'var(--accent)' }}>Settings</Link>
                </span>
              </div>

              {/* ------------------------------ one tile per leave type */}
              {types.length ? (
                <div className="grid grid--4" style={{ gap: 'var(--s3)' }}>
                  {types.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        padding: 'var(--s3)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r)',
                        background: 'var(--raised)',
                      }}
                    >
                      <div className="row row--between" style={{ gap: 'var(--s2)' }}>
                        <span style={{ fontSize: '.875rem', fontWeight: 600, minWidth: 0 }}>
                          {t.name}{' '}
                          <span className="faint mono" style={{ fontWeight: 400 }}>({t.code})</span>
                        </span>
                        <span className="row" style={{ gap: 'var(--s1)', flex: 'none' }}>
                          <button
                            className="iconbtn"
                            onClick={() => openEditType(t)}
                            aria-label={`Edit ${t.name}`}
                            title="Edit type"
                          >
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                          <button
                            className="iconbtn"
                            onClick={() => setDeleting(t)}
                            aria-label={`Delete ${t.name}`}
                            title="Delete type"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </span>
                      </div>

                      <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
                        <label className="sr" htmlFor={`rate-${t.id}`}>
                          Monthly accrual for {t.name}, in days
                        </label>
                        <input
                          id={`rate-${t.id}`}
                          className="input"
                          type="number"
                          step="0.01"
                          min={0}
                          value={rates[t.id] ?? ''}
                          disabled={savingRate === t.id}
                          onChange={(e) => setRates((r) => ({ ...r, [t.id]: e.target.value }))}
                          style={{ width: '6rem', flex: 'none' }}
                        />
                        <span className="faint" style={{ fontSize: '.75rem' }}>days / month</span>
                        <span className="spacer" />
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => saveRate(t)}
                          disabled={savingRate === t.id}
                          aria-label={`Save monthly accrual for ${t.name}`}
                          title="Save rate"
                          style={{ flex: 'none' }}
                        >
                          <Save size={14} aria-hidden="true" />
                          {savingRate === t.id ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={Scale}
                  title="No leave types configured"
                  body="Add a leave type and every employee gets a balance row for it, opened at zero. The monthly rate you set here is what accrues to them each month."
                  action={
                    <button className="btn btn--primary btn--sm" onClick={openAddType}>
                      <Plus size={15} aria-hidden="true" />
                      Add leave type
                    </button>
                  }
                />
              )}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ the grid */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Balance grid
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                accrued − used = balance · select a cell to correct it by hand · active employees only
              </p>
            </div>
          </div>

          {types.length && employees.length ? (
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Employee</th>
                      {types.map((t) => (
                        <th scope="col" className="num" key={t.id}>
                          {t.code}<span className="sr"> — {t.name}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp.employee_id}>
                        <td>
                          <span className="person__name" style={{ display: 'block' }}>{emp.name}</span>
                          <span className="person__meta" style={{ display: 'block' }}>{emp.emp_code}</span>
                          <button
                            className="btn btn--quiet btn--sm"
                            onClick={() => openLedger(emp)}
                            style={{ marginTop: 'var(--s1)' }}
                          >
                            <ScrollText size={12} aria-hidden="true" />
                            Ledger
                          </button>
                        </td>
                        {types.map((t) => {
                          const b = emp.balances?.[t.id];
                          /* No balance row for this pair — what a freshly
                             added type looks like before accrual reaches an
                             employee. Nothing to adjust, so nothing to click. */
                          if (!b) {
                            return (
                              <td className="num faint" key={t.id}>
                                —<span className="sr">no balance row</span>
                              </td>
                            );
                          }
                          return (
                            <td className="num" key={t.id}>
                              <button
                                className="btn btn--quiet btn--sm"
                                onClick={() => openAdjust(emp, t)}
                                title="Adjust balance"
                                aria-label={`Adjust ${t.name} for ${emp.name} — ${days(b.balance)} left`}
                                style={{ display: 'block', marginLeft: 'auto', textAlign: 'right', height: 'auto', padding: 'var(--s1) var(--s2)' }}
                              >
                                <span className="num mono" style={{
                                  display: 'block', fontWeight: 600,
                                  fontSize: '.9375rem', color: 'var(--accent-strong)',
                                }}>
                                  {raw(b.balance)}
                                </span>
                                <span className="faint num mono" style={{ display: 'block', fontSize: '.6875rem', fontWeight: 400 }}>
                                  {raw(b.accrued)} acc · {raw(b.used)} used
                                </span>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <Empty
              icon={Users}
              title={types.length ? 'No active employees yet' : 'Nothing to show yet'}
              body={
                types.length
                  ? 'Every active employee appears here as a row, with one column per leave type showing what they have accrued, used and have left.'
                  : 'The grid fills in once at least one leave type exists — each type becomes a column, each active employee a row.'
              }
            />
          )}
        </section>
      </div>

      {/* ------------------------------------------------ adjust a balance */}
      {adjusting && (
        <Modal
          title={`Adjust ${adjusting.type.code} — ${adjusting.emp.name}`}
          sub={`${adjusting.emp.emp_code} · ${adjusting.type.name} · ${days(adjusting.emp.balances?.[adjusting.type.id]?.balance)} left`}
          onClose={closeAdjust}
          footer={
            <>
              <button className="btn btn--ghost" onClick={closeAdjust} disabled={submitting}>Cancel</button>
              <button className="btn btn--primary" onClick={submitAdjust} disabled={submitting}>
                {submitting ? 'Applying…' : 'Apply adjustment'}
              </button>
            </>
          }
        >
          <div className="stack">
            <p className="muted" style={{ fontSize: '.875rem' }}>
              The adjustment is added to the <b>accrued</b> figure and written to this
              employee’s ledger under your username, so the correction stays explainable
              long after today.
            </p>
            <Field
              id="adj-delta"
              label="Adjustment in days"
              required
              error={deltaErr}
              help="Decimals allowed. A negative number deducts — that is how days are taken back."
            >
              <input
                id="adj-delta"
                className="input"
                type="number"
                step="0.01"
                required
                value={delta}
                disabled={submitting}
                aria-invalid={deltaErr ? 'true' : undefined}
                aria-describedby={deltaErr ? 'adj-delta-error' : 'adj-delta-help'}
                placeholder="e.g. 2.5 or -1"
                onChange={(e) => { setDelta(e.target.value); setDeltaErr(''); }}
              />
            </Field>
            <Field
              id="adj-note"
              label="Note"
              help="Optional, but it is the only explanation anyone reading the ledger will get."
            >
              <input
                id="adj-note"
                className="input"
                type="text"
                value={note}
                disabled={submitting}
                aria-describedby="adj-note-help"
                placeholder="e.g. comp-off credit for weekend release"
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* ------------------------------------------------ the ledger, wide
          because six columns of trail do not fit a normal dialog */}
      {ledgerFor && (
        <Modal
          wide
          title={`Leave ledger — ${ledgerFor.name}`}
          sub={ledgerFor.emp_code}
          onClose={() => setLedgerFor(null)}
        >
          {ledgerErr ? (
            <ErrorNote error={ledgerErr} onRetry={() => loadLedger(ledgerFor)} />
          ) : !ledger ? (
            <Skeleton rows={4} height={32} />
          ) : (
            <div className="stack" style={{ gap: 'var(--s4)' }}>
              {/* probation is decided against the period the API just sent,
                  never against the browser clock */}
              {ledger.employee?.probation_until
                && ledger.employee.probation_until >= data.current_period && (
                <div
                  className="row"
                  style={{
                    gap: 'var(--s3)', alignItems: 'flex-start', padding: 'var(--s3)',
                    background: 'var(--info-soft)', border: '1px solid var(--info)',
                    borderRadius: 'var(--r)',
                  }}
                >
                  <p style={{ fontSize: '.8125rem' }}>
                    On probation until <b>{fmtDay(ledger.employee.probation_until)}</b> — balance
                    locked: nothing accrues, nothing is deducted, and any leave taken is unpaid.
                  </p>
                </div>
              )}

              {ledger.entries?.length ? (
                <>
                  <div className="tablewrap" style={{ maxHeight: '26rem', overflowY: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">When</th>
                          <th scope="col">Type</th>
                          <th scope="col" className="num">Change</th>
                          <th scope="col">Kind</th>
                          <th scope="col">Note</th>
                          <th scope="col">By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledger.entries.map((l, i) => {
                          const kind = KINDS[l.kind] || { label: l.kind, tone: 'neutral' };
                          return (
                            <tr key={`${l.created_at}-${l.code}-${i}`}>
                              <td className="mono" style={{ fontSize: '.75rem', whiteSpace: 'nowrap' }}>
                                {fmtDateTime(l.created_at)}
                              </td>
                              <td className="mono">
                                {l.code}<span className="sr"> — {l.type_name}</span>
                              </td>
                              <td
                                className="num mono"
                                style={{ fontWeight: 600, color: num(l.delta) < 0 ? 'var(--err-text)' : 'var(--ok)' }}
                              >
                                {signed(l.delta)}
                              </td>
                              <td><StatusBadge status={kind.label} tone={kind.tone} /></td>
                              <td className="muted" style={{ fontSize: '.75rem' }}>{l.note || '—'}</td>
                              <td className="mono" style={{ fontSize: '.75rem' }}>{l.actor || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="faint" style={{ fontSize: '.75rem' }}>
                    The 200 most recent movements, newest first. Older ones still count towards
                    the balance, they just do not appear on this list.
                  </p>
                </>
              ) : (
                <Empty
                  icon={ScrollText}
                  title="No balance changes recorded yet"
                  body="Monthly accrual, approved leave and every manual correction land here with the note that explains them."
                />
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ------------------------------------------------ add / edit a type */}
      {typeForm && (
        <Modal
          title={typeForm.mode === 'add' ? 'Add leave type' : 'Edit leave type'}
          sub={
            typeForm.mode === 'add'
              ? 'Every employee gets a balance row opened at zero — accrual starts from the next month.'
              : 'The monthly rate is not edited here; it is set on the tile itself.'
          }
          onClose={closeType}
          footer={
            <>
              <button className="btn btn--ghost" onClick={closeType} disabled={submitting}>Cancel</button>
              <button className="btn btn--primary" onClick={submitType} disabled={submitting}>
                {submitting
                  ? 'Saving…'
                  : typeForm.mode === 'add' ? 'Add type' : 'Save changes'}
              </button>
            </>
          }
        >
          <div className="stack">
            <Field id="type-name" label="Name" required error={typeErrs.name}>
              <input
                id="type-name"
                className="input"
                type="text"
                required
                value={typeForm.name}
                disabled={submitting}
                aria-invalid={typeErrs.name ? 'true' : undefined}
                aria-describedby={typeErrs.name ? 'type-name-error' : undefined}
                placeholder="Paternity Leave"
                onChange={(e) => {
                  setTypeForm((f) => ({ ...f, name: e.target.value }));
                  setTypeErrs((x) => ({ ...x, name: '' }));
                }}
              />
            </Field>

            <div className="fieldrow">
              <Field
                id="type-code"
                label="Code"
                required
                error={typeErrs.code}
                help="Stored upper-case — it is what the balance grid column is headed with."
              >
                <input
                  id="type-code"
                  className="input"
                  type="text"
                  required
                  value={typeForm.code}
                  disabled={submitting}
                  aria-invalid={typeErrs.code ? 'true' : undefined}
                  aria-describedby={typeErrs.code ? 'type-code-error' : 'type-code-help'}
                  placeholder="PL"
                  onChange={(e) => {
                    setTypeForm((f) => ({ ...f, code: e.target.value }));
                    setTypeErrs((x) => ({ ...x, code: '' }));
                  }}
                />
              </Field>

              {typeForm.mode === 'add' && (
                <Field
                  id="type-rate"
                  label="Monthly accrual"
                  required
                  error={typeErrs.rate}
                  help="Days credited each month. Zero means the type is counted, never accrued."
                >
                  <input
                    id="type-rate"
                    className="input"
                    type="number"
                    step="0.01"
                    min={0}
                    required
                    value={typeForm.monthly_accrual}
                    disabled={submitting}
                    aria-invalid={typeErrs.rate ? 'true' : undefined}
                    aria-describedby={typeErrs.rate ? 'type-rate-error' : 'type-rate-help'}
                    onChange={(e) => {
                      setTypeForm((f) => ({ ...f, monthly_accrual: e.target.value }));
                      setTypeErrs((x) => ({ ...x, rate: '' }));
                    }}
                  />
                </Field>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ------------------------------------------------ delete a type.
          Destructive and wider than it looks — it takes every employee's
          balance row for that type with it, so the dialog says so. */}
      {deleting && (
        <ConfirmModal
          danger
          title={`Delete ${deleting.name}?`}
          body={`“${deleting.name} (${deleting.code})” is removed from the company, and with it the ${deleting.code} balance row of every employee — accrued days, used days and all. This cannot be undone. The server refuses outright if even one leave application has ever used this type.`}
          confirmLabel="Delete leave type"
          busy={submitting}
          onConfirm={confirmDelete}
          onClose={() => { if (!submitting) setDeleting(null); }}
        />
      )}
    </div>
  );
}
