'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarDays, Check, Info, Paperclip, Scale } from 'lucide-react';
import { api, fmtDay, getUser, initials } from '@/lib/api';
import { ConfirmModal, Empty, ErrorNote, Field, PageHead, Skeleton, useToast } from '@/components/ui';

/* The one type that needs no balance. The service returns it as "UL"
 * ("Unpaid Leave") — the code, not the name, is what identifies it. */
const UNPAID = 'UL';

const DAY_MS = 86400000;

/* Dates are plain YYYY-MM-DD strings both ways. They are taken apart and
 * walked in UTC rather than parsed: the server clock is not IST, so a local
 * Date would shift the day underfoot. */
function utcOf(value) {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/* Weekends AND declared holidays come off here, so the count the employee
 * sees is the one the server will charge them — workingDays() in
 * routes/leaves.js subtracts exactly the same two things. Counting weekends
 * alone made this a ceiling, which was fine for the day count but not for the
 * overdrawn banner built on top of it: a range covering a company holiday was
 * told the request would be refused when the server would have accepted it. */
function countDays(from, to, holidays) {
  const end = utcOf(from) <= utcOf(to) ? utcOf(to) : utcOf(from);
  let working = 0;
  let weekend = 0;
  let holiday = 0;
  let guard = 0;
  for (let t = utcOf(from); t <= end && guard < 400; t += DAY_MS, guard += 1) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) { weekend += 1; continue; }
    if (holidays && holidays.has(new Date(t).toISOString().slice(0, 10))) { holiday += 1; continue; }
    working += 1;
  }
  return { working, weekend, holiday };
}

const STEPS = [
  { label: 'You submit the request', note: 'It is filed against your record the moment you press Submit.' },
  { label: 'HR and the Director are emailed', note: 'Both inboxes get the request together, not one after the other.' },
  { label: 'Any ONE of them approves or rejects', note: 'Whoever acts first settles it — the request leaves the other inbox.' },
  { label: 'You and your manager are notified', note: 'Your reporting manager is copied for planning, not for approval.' },
];

export default function ApplyLeavePage() {
  const toast = useToast();
  const [types, setTypes] = useState(null);
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState('');
  const [me, setMe] = useState(null);

  /* form */
  const [typeId, setTypeId] = useState('');
  const [singleDay, setSingleDay] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState(null);
  const docRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  /* The real file input is off-screen, so the dropzone has to carry its focus
   * ring or a keyboard user cannot see where they are. */
  const [docFocus, setDocFocus] = useState(false);
  /* The service refuses with copy worth reading in full ("Insufficient
   * balance: 3.00 day(s) available, 5 requested"), so the outcome is kept on
   * the page as well as in the toast that announces it. */
  const [notice, setNotice] = useState(null);

  /* GET /admin/holidays carries no requirePerm, so an ordinary employee can
   * read the company calendar — which is what makes an exact count possible
   * here. A failure is not fatal: the count falls back to the old ceiling. */
  const [holidays, setHolidays] = useState(null);

  const load = () => {
    setError('');
    Promise.all([api('/leaves/types'), api('/leaves/balance')])
      .then(([t, b]) => { setTypes(t || []); setBalance(b || null); })
      .catch((e) => setError(e.message));
    api('/admin/holidays')
      .then((rows) => setHolidays(new Set((rows || []).map((h) => String(h.date).slice(0, 10)))))
      .catch(() => setHolidays(new Set()));
  };
  useEffect(load, []);

  useEffect(() => { setMe(getUser()?.employee || null); }, []);

  const onProbation = !!balance?.on_probation;

  /* On probation only unpaid leave can be taken, so it is chosen for the
   * employee instead of leaving them to discover the refusal on submit. */
  useEffect(() => {
    if (!onProbation || !types?.length || typeId) return;
    const unpaid = types.find((t) => t.code === UNPAID);
    if (unpaid) setTypeId(String(unpaid.id));
  }, [onProbation, types, typeId]);

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!types || !balance) {
    return (
      <div className="page">
        <PageHead eyebrow="Leave" title="Apply Leave" sub="Submit a new leave request for approval" />
        <div className="card"><Skeleton rows={6} /></div>
      </div>
    );
  }

  const byType = {};
  (balance.balances || []).forEach((b) => { byType[b.leave_type_id] = b; });

  const selected = types.find((t) => String(t.id) === typeId) || null;
  const selectedBalance = selected ? byType[selected.id] : null;
  const isUnpaid = selected?.code === UNPAID;

  /* Single-day mode reuses the from-date field, so both ends are the one day. */
  const from = fromDate;
  const to = singleDay ? fromDate : toDate;
  const counted = from && to && to >= from ? countDays(from, to, holidays) : null;

  /* Unpaid leave is not drawn from a balance, and on probation the balance is
   * locked, so neither case can overdraw. */
  const remaining = selectedBalance ? Number(selectedBalance.balance) : null;
  const overdrawn =
    !isUnpaid && !onProbation && counted && remaining !== null && counted.working > remaining;

  function pickType(value) {
    setTypeId(value);
    setNotice(null);
  }

  /* A to-date before the from-date is never a real intention, so it is pushed
   * forward rather than reported back as an error. */
  function pickFrom(value) {
    setFromDate(value);
    if (toDate && value && toDate < value) setToDate(value);
    setNotice(null);
  }

  function toggleSingle(on) {
    setSingleDay(on);
    /* Coming back out of single-day mode, the one date becomes the start of
     * the range instead of being thrown away. */
    if (!on && fromDate && (!toDate || toDate < fromDate)) setToDate(fromDate);
    setNotice(null);
  }

  /* The input element is cleared along with the state: leaving its value in
   * place means re-picking the same file fires no change event at all. */
  function clearFile() {
    setFile(null);
    if (docRef.current) docRef.current.value = '';
  }

  function pickFile(f) {
    if (!f) { clearFile(); return; }
    if (f.size > 10 * 1024 * 1024) {
      toast('That file is over 10 MB — the service will not accept it', 'err');
      clearFile();
      return;
    }
    setFile(f);
    setNotice(null);
  }

  function resetForm() {
    setTypeId('');
    setSingleDay(false);
    setFromDate('');
    setToDate('');
    setReason('');
    clearFile();
    setNotice(null);
  }

  async function submit(e) {
    e.preventDefault();

    if (!typeId || !from || !to || !reason.trim()) {
      const msg = 'Leave type, dates and reason are required';
      setNotice({ kind: 'err', message: msg });
      toast(msg, 'err');
      return;
    }
    if (to < from) {
      const msg = 'To date cannot be before from date';
      setNotice({ kind: 'err', message: msg });
      toast(msg, 'err');
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      /* multipart, because the supporting document rides along with the
       * fields — api() leaves the Content-Type to the browser so the
       * boundary is set correctly. */
      const fd = new FormData();
      fd.append('leave_type_id', typeId);
      fd.append('from_date', from);
      fd.append('to_date', to);
      fd.append('reason', reason.trim());
      if (file) fd.append('document', file);

      const res = await api('/leaves/apply', { method: 'POST', formData: fd });

      const days = Number(res?.days ?? counted?.working ?? 0);
      const head = res?.message || 'Leave application submitted';
      const message = days
        ? `${head} (${days} working ${days === 1 ? 'day' : 'days'}).`
        : `${head}.`;

      toast(message, 'ok');
      setNotice({ kind: 'ok', message, sub: 'HR and the Director have been notified.' });
      resetForm();
      load();
    } catch (err) {
      /* The form keeps everything the employee typed — the refusal is nearly
       * always about one field, not the whole request. */
      setNotice({ kind: 'err', message: err.message });
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  const meName = me ? `${me.first_name} ${me.last_name}` : '';

  return (
    <div className="page">
      <PageHead eyebrow="Leave" title="Apply Leave" sub="Submit a new leave request for approval">
        <Link className="btn btn--ghost" href="/leave/history">My requests</Link>
      </PageHead>

      <div className="grid grid--sidebar">

        {/* ------------------------------------------------ the request */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                New leave request
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>Fields marked * are required</p>
            </div>
            {meName && (
              <span className="person">
                <span className="avatar">{initials(meName)}</span>
                <span>
                  <span className="person__name" style={{ display: 'block' }}>{meName}</span>
                  <span className="person__meta">{me.emp_code}</span>
                </span>
              </span>
            )}
          </div>

          {types.length === 0 ? (
            <Empty
              icon={Scale}
              title="No leave types to apply against"
              body="The leave types your company grants — casual, earned, sick, unpaid — are configured in Settings. Once one exists, this form can be filled in."
            />
          ) : (
            <div className="card__body">
              <div className="stack" style={{ gap: 'var(--s5)' }}>

                {onProbation && (
                  <div
                    className="card"
                    style={{ boxShadow: 'none', borderColor: 'var(--info)', background: 'var(--info-soft)' }}
                  >
                    <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)' }}>
                      <Info size={16} aria-hidden="true" style={{ color: 'var(--info)', flex: 'none', marginTop: '.15rem' }} />
                      <p style={{ fontSize: '.875rem' }}>
                        <b>
                          You are on probation
                          {balance.probation_until ? ` until ${fmtDay(balance.probation_until)}` : ''}.
                        </b>{' '}
                        <span className="muted">
                          Leave you take is <b>unpaid</b> — your leave balance is locked and will not be affected.
                        </span>
                      </p>
                    </div>
                  </div>
                )}

                {/* Replaced on every submit; the toast says the same thing but
                    does not stay long enough to act on. */}
                <div aria-live="polite">
                  {notice && (
                    <div
                      className="card"
                      style={{
                        boxShadow: 'none',
                        borderColor: notice.kind === 'ok' ? 'var(--ok)' : 'var(--err)',
                        background: notice.kind === 'ok' ? 'var(--ok-soft)' : 'var(--err-soft)',
                      }}
                    >
                      <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)' }}>
                        <span style={{ flex: 'none', marginTop: '.15rem', color: notice.kind === 'ok' ? 'var(--ok)' : 'var(--err-text)' }}>
                          {notice.kind === 'ok'
                            ? <Check size={16} aria-hidden="true" />
                            : <AlertTriangle size={16} aria-hidden="true" />}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span
                            style={{
                              display: 'block', fontSize: '.875rem', fontWeight: 600,
                              color: notice.kind === 'ok' ? 'var(--ok)' : 'var(--err-text)',
                            }}
                          >
                            {notice.message}
                          </span>
                          {notice.sub && <span className="muted" style={{ fontSize: '.75rem' }}>{notice.sub}</span>}
                          {notice.kind === 'ok' && (
                            <Link className="btn btn--quiet btn--sm" href="/leave/history" style={{ marginTop: 'var(--s2)' }}>
                              View my requests
                            </Link>
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <form onSubmit={submit} noValidate>
                  <div className="stack" style={{ gap: 'var(--s5)' }}>

                    <Field id="leave-type" label="Leave type" required>
                      <select
                        className="select"
                        id="leave-type"
                        value={typeId}
                        onChange={(e) => pickType(e.target.value)}
                        disabled={busy}
                        required
                      >
                        <option value="">Select leave type…</option>
                        {types.map((t) => {
                          const off = onProbation && t.code !== UNPAID;
                          return (
                            <option value={String(t.id)} key={t.id} disabled={off}>
                              {t.name}{off ? ' — (Disabled during probation)' : ''}
                            </option>
                          );
                        })}
                      </select>

                      {/* One line under the select, three mutually exclusive
                          readings of the same choice. */}
                      {onProbation ? (
                        <p className="row" style={{ gap: 'var(--s2)', fontSize: '.75rem', color: 'var(--warn)', fontWeight: 600 }}>
                          <AlertTriangle size={13} aria-hidden="true" style={{ flex: 'none' }} />
                          During probationary periods, an employee can only take unpaid leaves.
                        </p>
                      ) : isUnpaid ? (
                        <p style={{ fontSize: '.75rem', color: 'var(--accent-strong)', fontWeight: 600 }}>
                          {selected.name} — no balance is required or deducted.
                        </p>
                      ) : selectedBalance ? (
                        <div className="stack" style={{ gap: 'var(--s2)' }}>
                          <p className="faint" style={{ fontSize: '.75rem' }}>
                            Balance:{' '}
                            <span className="num" style={{ color: 'var(--accent-strong)', fontWeight: 600 }}>
                              {Number(selectedBalance.balance).toFixed(2)}
                            </span>{' '}
                            day(s) available
                            {Number(selectedBalance.monthly_accrual) > 0
                              ? ` · accrues ${Number(selectedBalance.monthly_accrual)}/month`
                              : ''}
                          </p>
                          <div className="meter">
                            <div
                              className="meter__fill"
                              style={{
                                width: `${Number(selectedBalance.accrued) > 0
                                  ? Math.min(100, Math.round((Number(selectedBalance.used) / Number(selectedBalance.accrued)) * 100))
                                  : 0}%`,
                                background: overdrawn ? 'var(--err)' : 'var(--accent)',
                              }}
                            />
                          </div>
                          <p className="faint" style={{ fontSize: '.75rem' }}>
                            <span className="num">{Number(selectedBalance.used)}</span> of{' '}
                            <span className="num">{Number(selectedBalance.accrued)}</span> accrued days used
                          </p>
                        </div>
                      ) : null}
                    </Field>

                    <div className="checkline">
                      <input
                        type="checkbox"
                        id="single-day"
                        checked={singleDay}
                        onChange={(e) => toggleSingle(e.target.checked)}
                        disabled={busy}
                      />
                      <label htmlFor="single-day" style={{ fontSize: '.8125rem', fontWeight: 600 }}>
                        Single day leave
                      </label>
                    </div>

                    {/* Two dates by default; the toggle above collapses them
                        into the one field and carries the value over. */}
                    {singleDay ? (
                      <Field id="day" label="Date" required>
                        <input
                          className="input"
                          type="date"
                          id="day"
                          value={fromDate}
                          onChange={(e) => pickFrom(e.target.value)}
                          disabled={busy}
                          required
                        />
                      </Field>
                    ) : (
                      <div className="fieldrow">
                        <Field id="from-date" label="From date" required>
                          <input
                            className="input"
                            type="date"
                            id="from-date"
                            value={fromDate}
                            onChange={(e) => pickFrom(e.target.value)}
                            disabled={busy}
                            required
                          />
                        </Field>
                        <Field id="to-date" label="To date" required>
                          <input
                            className="input"
                            type="date"
                            id="to-date"
                            value={toDate}
                            min={fromDate || undefined}
                            onChange={(e) => { setToDate(e.target.value); setNotice(null); }}
                            disabled={busy}
                            required
                          />
                        </Field>
                      </div>
                    )}

                    {counted && (
                      <div
                        className="row row--wrap"
                        style={{
                          gap: 'var(--s3)', padding: 'var(--s3) var(--s4)',
                          border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', background: 'var(--bg)',
                        }}
                      >
                        <span className={`badge badge--${counted.working ? 'info' : 'warn'}`}>
                          <span className="num">{counted.working}</span>
                          {counted.working === 1 ? ' working day' : ' working days'}
                        </span>
                        <span className="faint" style={{ fontSize: '.75rem' }}>
                          <span className="mono">{fmtDay(from)} → {fmtDay(to)}</span>
                          {counted.weekend
                            ? ` · ${counted.weekend} weekend ${counted.weekend === 1 ? 'day' : 'days'} excluded`
                            : ''}
                          {/* Holidays are now subtracted here rather than only on the
                              server, so this states what was taken off instead of
                              warning that something still will be. */}
                          {counted.holiday
                            ? ` · ${counted.holiday} company ${counted.holiday === 1 ? 'holiday' : 'holidays'} excluded`
                            : ''}
                        </span>
                      </div>
                    )}

                    {overdrawn && (
                      <div
                        className="row"
                        style={{
                          alignItems: 'flex-start', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)',
                          border: '1px solid var(--warn)', borderRadius: 'var(--r-sm)', background: 'var(--warn-soft)',
                        }}
                      >
                        <AlertTriangle size={16} aria-hidden="true" style={{ color: 'var(--warn)', flex: 'none', marginTop: '.15rem' }} />
                        <p style={{ fontSize: '.8125rem' }}>
                          <b>More days than you have.</b>{' '}
                          <span className="muted">
                            {selected.name} has <span className="num">{Number(selectedBalance.balance).toFixed(2)}</span>{' '}
                            day(s) left and this asks for <span className="num">{counted.working}</span>. The service will
                            refuse it — shorten the range, or apply against unpaid leave.
                          </span>
                        </p>
                      </div>
                    )}

                    <Field
                      id="reason"
                      label="Reason"
                      required
                      help="Your approver and your reporting manager both read this line."
                    >
                      <textarea
                        className="textarea"
                        id="reason"
                        rows={3}
                        value={reason}
                        onChange={(e) => { setReason(e.target.value); setNotice(null); }}
                        placeholder="Reason for leave…"
                        disabled={busy}
                        required
                      />
                    </Field>

                    <div className="field">
                      <label
                        className="row"
                        htmlFor="doc"
                        style={{
                          alignItems: 'flex-start', gap: 'var(--s3)', padding: 'var(--s4)', cursor: 'pointer',
                          background: 'var(--bg)', borderRadius: 'var(--r-sm)',
                          border: `2px dashed ${docFocus ? 'var(--accent)' : 'var(--line-strong)'}`,
                          boxShadow: docFocus ? '0 0 0 3px var(--accent-soft)' : 'none',
                        }}
                      >
                        <Paperclip size={18} aria-hidden="true" style={{ color: 'var(--faint)', flex: 'none', marginTop: '.1rem' }} />
                        <span className="stack" style={{ gap: '.15rem', minWidth: 0 }}>
                          <span className="label">
                            Supporting document <span className="faint" style={{ fontWeight: 400 }}>(optional)</span>
                          </span>
                          {file ? (
                            <span style={{ fontSize: '.875rem', color: 'var(--accent-strong)', fontWeight: 600, wordBreak: 'break-all' }}>
                              {file.name}
                            </span>
                          ) : (
                            <span className="muted" style={{ fontSize: '.875rem' }}>
                              Click to attach a file (e.g. medical certificate) — PDF or image, max 10 MB
                            </span>
                          )}
                        </span>
                      </label>
                      <input
                        className="sr"
                        type="file"
                        id="doc"
                        ref={docRef}
                        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                        onChange={(e) => pickFile(e.target.files?.[0] || null)}
                        onFocus={() => setDocFocus(true)}
                        onBlur={() => setDocFocus(false)}
                        disabled={busy}
                      />
                      {file && (
                        <div className="row" style={{ gap: 'var(--s3)' }}>
                          <button
                            className="btn btn--quiet btn--sm"
                            type="button"
                            onClick={() => { clearFile(); docRef.current?.focus(); }}
                            disabled={busy}
                          >
                            Remove file
                          </button>
                        </div>
                      )}
                      <p className="help">One file only. The service refuses anything over 10 MB.</p>
                    </div>

                    <div className="row row--wrap" style={{ gap: 'var(--s3)' }}>
                      <button className="btn btn--primary" type="submit" disabled={busy}>
                        {busy ? 'Submitting…' : 'Submit Request'}
                      </button>
                      <button
                        className="btn btn--ghost"
                        type="button"
                        onClick={() => setDiscarding(true)}
                        disabled={busy}
                      >
                        Discard
                      </button>
                    </div>

                  </div>
                </form>
              </div>
            </div>
          )}
        </section>

        {/* ------------------------------------------------ approval path */}
        <section className="card" style={{ alignSelf: 'start' }}>
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                How approval works
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>Four steps, one decision</p>
            </div>
            <CalendarDays size={18} aria-hidden="true" style={{ color: 'var(--faint)', flex: 'none' }} />
          </div>
          <div className="card__body">
            <ol
              className="stack"
              style={{ gap: 'var(--s5)', listStyle: 'none', padding: 0, marginLeft: 'var(--s4)', borderLeft: '2px solid var(--line)' }}
            >
              {STEPS.map((s, i) => (
                <li style={{ position: 'relative', paddingLeft: 'var(--s6)' }} key={s.label}>
                  <span
                    className="mono"
                    style={{
                      position: 'absolute', left: '-.8125rem', top: 0, width: '1.5rem', height: '1.5rem',
                      borderRadius: 'var(--r-full)', display: 'grid', placeItems: 'center',
                      fontSize: 10, fontWeight: 600, border: '2px solid var(--accent)',
                      background: i === 0 ? 'var(--accent)' : 'var(--raised)',
                      color: i === 0 ? 'var(--accent-ink)' : 'var(--accent)',
                    }}
                  >
                    {i + 1}
                  </span>
                  <p style={{ fontSize: '.875rem', fontWeight: 600 }}>{s.label}</p>
                  <p className="faint" style={{ fontSize: '.75rem', marginTop: '.15rem' }}>{s.note}</p>
                </li>
              ))}
            </ol>

            <p className="faint" style={{ fontSize: '.75rem', marginTop: 'var(--s5)' }}>
              A single approval from HR or the Director fully approves the leave.
              Your reporting manager receives an intimation only.
            </p>

            <hr className="rule" style={{ margin: 'var(--s5) 0' }} />

            <div className="stack" style={{ gap: 'var(--s2)' }}>
              <p className="stat__label">Your balances</p>
              {balance.balances?.length ? (
                balance.balances.map((b) => (
                  <div className="row row--between" style={{ gap: 'var(--s3)' }} key={b.leave_type_id}>
                    <span style={{ fontSize: '.8125rem', minWidth: 0 }}>{b.name}</span>
                    <span className="chip num" style={{ fontSize: '.75rem' }}>
                      {Number(b.balance).toFixed(2)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="faint" style={{ fontSize: '.75rem' }}>
                  No balances are held for you yet — they appear once HR opens your entitlements.
                </p>
              )}
            </div>
          </div>
        </section>

      </div>

      {discarding && (
        <ConfirmModal
          title="Discard this request?"
          body={`Everything typed in goes — the leave type, the dates, the reason${file ? `, and the attached ${file.name}` : ''}. Nothing has been sent to HR, so there is nothing to withdraw.`}
          confirmLabel="Discard"
          danger
          onConfirm={() => { resetForm(); setDiscarding(false); toast('Request discarded', 'ok'); }}
          onClose={() => setDiscarding(false)}
        />
      )}
    </div>
  );
}
