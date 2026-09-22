'use client';

import { useEffect, useState } from 'react';
import { Ban, CalendarOff, Check, ChevronLeft, ChevronRight, Inbox, Paperclip, X } from 'lucide-react';
import { api, fmtDate, fmtDay, hasPerm, initials, openProtectedFile } from '@/lib/api';
import { ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast } from '@/components/ui';

/* The five filters, in the order HR works through them: the approval inbox
 * first, because that is the only one with anything to do in it. The value is
 * what GET /leaves?status= takes; 'All' is passed through and the API treats
 * it as "no filter". */
const FILTERS = [
  { value: 'Pending', label: 'Awaiting Approval' },
  { value: 'All', label: 'All' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'Cancelled', label: 'Cancelled' },
];

/* 'Pending' is the database word; HR reads it as a question they owe an answer
 * to, so the badge says so. The tone is carried separately because
 * StatusBadge's own map keys off the raw status. */
const STATUS_LABEL = { Pending: 'Awaiting Approval' };
const STATUS_TONE = { Pending: 'warn', Approved: 'ok', Rejected: 'err', Cancelled: 'neutral' };

/* The calendar stepper counts in numbers, not date strings, so there is
 * nothing here to parse. Spelling the months out beats building a
 * YYYY-MM-01 string only to format it back. */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

export default function AdminLeavesPage() {
  const toast = useToast();
  const canApprove = hasPerm('leaves.approve');

  const [status, setStatus] = useState('Pending');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  /* The calendar is a second, independent fetch: stepping its month must not
   * blank the table, and a table refetch must not reset the month. */
  const [cal, setCal] = useState(null);
  const [calError, setCalError] = useState('');
  const [ym, setYm] = useState(null);

  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState('');
  const [cancelling, setCancelling] = useState(null);

  const load = () => {
    setRows(null);
    setError('');
    api(`/leaves?status=${encodeURIComponent(status)}`).then(setRows).catch((e) => setError(e.message));
  };
  useEffect(load, [status]);

  /*
   * The month is the company's payroll cycle, and the cycle start day lives on
   * the server. Called with no target, the endpoint answers for the cycle the
   * server is currently in — so the first load asks it rather than guessing
   * from the browser clock, and the stepper works from the year/month it
   * answers with.
   */
  const loadCalendar = (target) => {
    setCal(null);
    setCalError('');
    const q = target ? `?year=${target.year}&month=${target.month}` : '';
    api(`/leaves/calendar${q}`)
      .then((res) => { setCal(res); setYm({ year: res.year, month: res.month }); })
      .catch((e) => setCalError(e.message));
  };
  useEffect(() => { loadCalendar(); }, []);

  function stepMonth(delta) {
    if (!ym) return;
    let { year, month } = ym;
    month += delta;
    if (month < 1) { month = 12; year -= 1; }
    if (month > 12) { month = 1; year += 1; }
    setYm({ year, month });          /* label moves at once; the fetch confirms it */
    loadCalendar({ year, month });
  }

  /* ------------------------------------------------ mutations */

  /* Single step: one approval deducts the balance, overwrites those days as
   * Leave and mails the employee and their manager — so the calendar below is
   * stale the moment this returns. */
  async function approve(l) {
    setBusy(`approve-${l.id}`);
    try {
      const res = await api(`/leaves/${l.id}/approve`, { method: 'POST' });
      toast(res?.message || 'Leave approved', 'ok');
      load();
      loadCalendar(ym);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  }

  async function submitReject() {
    if (!reason.trim()) {
      setReasonErr('Give a reason — the employee is emailed this text.');
      return;
    }
    setBusy('reject');
    try {
      const res = await api(`/leaves/${rejecting.id}/reject`, { method: 'POST', body: { reason: reason.trim() } });
      toast(res?.message || 'Leave application rejected', 'ok');
      closeReject();
      /* Only a Pending row can be rejected, so nothing approved moved and the
       * calendar is still correct. */
      load();
    } catch (e) {
      toast(e.message, 'err');      /* modal stays open, typed reason intact */
    } finally {
      setBusy('');
    }
  }

  async function confirmCancel() {
    setBusy('cancel');
    try {
      const res = await api(`/leaves/${cancelling.id}`, { method: 'DELETE' });
      toast(res?.message || 'Leave application cancelled', 'ok');
      setCancelling(null);
      load();
      loadCalendar(ym);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  }

  /* The attachment sits behind the auth header, so a plain href 404s. */
  async function openDoc(l) {
    try {
      await openProtectedFile(`/leaves/${l.id}/attachment`);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function closeReject() {
    setRejecting(null);
    setReason('');
    setReasonErr('');
  }

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  const monthLabel = ym ? `${MONTH_NAMES[ym.month - 1]} ${ym.year}` : '—';

  return (
    <div className="page">
      <PageHead
        eyebrow="Management"
        title="Leave Management"
        sub="A single approval from HR or the Director fully approves a request"
      />

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {/* ------------------------------------------------ applications */}
        <section className="card">
          {/* The pills stay live while the table reloads, so a mis-clicked
              filter can be corrected without waiting for the wrong one. */}
          <div className="filterbar" role="group" aria-label="Filter leave applications by status">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                className={`btn btn--sm ${status === f.value ? 'btn--primary' : 'btn--ghost'}`}
                aria-pressed={status === f.value}
                onClick={() => setStatus(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {!rows ? (
            <Skeleton rows={6} />
          ) : rows.length === 0 ? (
            <Empty
              icon={Inbox}
              title="No leave applications match this filter"
              body={status === 'Pending'
                ? 'Nothing is waiting on you. Requests land here the moment an employee applies.'
                : 'Every application in the company is listed here — switch the filter to see another status.'}
            />
          ) : (
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Employee</th>
                      <th>Type</th>
                      <th>Dates</th>
                      <th className="num">Days</th>
                      <th>Reason</th>
                      <th>Doc</th>
                      <th>Status</th>
                      <th>Decided By</th>
                      <th className="num">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => {
                      const approving = busy === `approve-${l.id}`;
                      const canCancel = l.status !== 'Cancelled' && l.status !== 'Rejected';
                      return (
                        <tr key={l.id}>
                          <td className="faint mono">#{l.id}</td>
                          <td>
                            <span className="person">
                              <span className="avatar avatar--sm">{initials(l.employee_name)}</span>
                              <span>
                                <span className="person__name" style={{ display: 'block' }}>{l.employee_name}</span>
                                <span className="person__meta">{l.emp_code}</span>
                              </span>
                            </span>
                          </td>
                          <td>
                            {/* The column is too narrow for "Casual Leave", so the
                                code carries the full name for anyone who needs it. */}
                            <span className="mono" style={{ fontWeight: 600 }} title={l.leave_type}>
                              {l.leave_code}
                            </span>
                            <span className="sr"> — {l.leave_type}</span>
                            {l.is_unpaid && (
                              <span style={{ display: 'block', marginTop: 'var(--s1)' }}>
                                <StatusBadge status="Unpaid" tone="warn" />
                              </span>
                            )}
                          </td>
                          <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                            {fmtDate(l.from_date)} → {fmtDate(l.to_date)}
                          </td>
                          <td className="num">{l.days}</td>
                          <td>
                            {/* Reasons run long; the cell clips and the full text
                                is one hover away rather than three lines tall. */}
                            <span
                              title={l.reason || ''}
                              style={{
                                display: 'block', maxWidth: '12.5rem',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}
                            >
                              {l.reason || <span className="faint">—</span>}
                            </span>
                          </td>
                          <td>
                            {l.attachment_file ? (
                              <button
                                className="iconbtn"
                                style={{ width: '2rem', height: '2rem', color: 'var(--accent)' }}
                                onClick={() => openDoc(l)}
                                title={l.attachment_file}
                                aria-label={`Open the document attached to leave #${l.id}`}
                              >
                                <Paperclip size={16} aria-hidden="true" />
                              </button>
                            ) : (
                              <span className="faint">—</span>
                            )}
                          </td>
                          <td>
                            <span title={l.status === 'Rejected' ? l.rejection_reason || '' : undefined}>
                              <StatusBadge
                                status={STATUS_LABEL[l.status] || l.status}
                                tone={STATUS_TONE[l.status]}
                              />
                            </span>
                            {l.status === 'Rejected' && l.rejection_reason && (
                              <span className="sr"> — reason: {l.rejection_reason}</span>
                            )}
                          </td>
                          <td className="muted" style={{ fontSize: '.8125rem' }}>
                            {l.decided_by || <span className="faint">—</span>}
                          </td>
                          {/* Without leaves.approve the column stays, empty: a
                              read-only audit view rather than a row of dead buttons. */}
                          <td className="num">
                            {canApprove && (
                              <div className="row" style={{ gap: 'var(--s1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                                {l.status === 'Pending' && (
                                  <>
                                    <button
                                      className="iconbtn"
                                      style={{ width: '2rem', height: '2rem', color: 'var(--ok)', opacity: busy ? .45 : 1 }}
                                      onClick={() => approve(l)}
                                      disabled={!!busy}
                                      title={approving ? 'Approving…' : 'Approve'}
                                      aria-label={approving
                                        ? `Approving leave #${l.id}…`
                                        : `Approve leave #${l.id} for ${l.employee_name}`}
                                    >
                                      <Check size={17} aria-hidden="true" />
                                    </button>
                                    <button
                                      className="iconbtn"
                                      style={{ width: '2rem', height: '2rem', color: 'var(--err-text)', opacity: busy ? .45 : 1 }}
                                      onClick={() => { setRejecting(l); setReason(''); setReasonErr(''); }}
                                      disabled={!!busy}
                                      title="Reject"
                                      aria-label={`Reject leave #${l.id} for ${l.employee_name}`}
                                    >
                                      <X size={17} aria-hidden="true" />
                                    </button>
                                  </>
                                )}
                                {canCancel && (
                                  <button
                                    className="iconbtn"
                                    style={{ width: '2rem', height: '2rem', opacity: busy ? .45 : 1 }}
                                    onClick={() => setCancelling(l)}
                                    disabled={!!busy}
                                    title="Cancel leave"
                                    aria-label={`Cancel leave #${l.id} for ${l.employee_name}`}
                                  >
                                    <Ban size={16} aria-hidden="true" />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* ------------------------------------------------ approved-leave calendar */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Leave Calendar (approved leaves)
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                {cal?.period
                  ? `Payroll cycle ${fmtDay(cal.period.from)} – ${fmtDay(cal.period.to)} · a leave spanning the boundary shows in both months`
                  : 'Approved leave overlapping the payroll cycle'}
              </p>
            </div>
            <div className="row" style={{ gap: 'var(--s2)', flexWrap: 'nowrap' }}>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => stepMonth(-1)}
                disabled={!ym || (!cal && !calError)}
                aria-label="Previous month"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <span
                aria-live="polite"
                style={{ minWidth: '9.375rem', textAlign: 'center', fontSize: '.875rem', fontWeight: 600 }}
              >
                {monthLabel}
              </span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => stepMonth(1)}
                disabled={!ym || (!cal && !calError)}
                aria-label="Next month"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          {calError ? (
            <div className="card__body">
              <ErrorNote error={calError} onRetry={() => loadCalendar(ym)} />
            </div>
          ) : !cal ? (
            <Skeleton rows={3} height={62} />
          ) : !cal.leaves?.length ? (
            <Empty
              icon={CalendarOff}
              title="No approved leaves in this month"
              body="Once an application is approved it appears here for the cycle it falls in, so you can see the month's cover at a glance."
            />
          ) : (
            <div className="card__body">
              {/* The payload carries no id — an employee can hold two approved
                  leaves in one cycle, so the key is the pair of dates. */}
              <ul className="grid grid--3" style={{ gap: 'var(--s3)', listStyle: 'none' }}>
                {cal.leaves.map((l, i) => (
                  <li
                    key={`${l.emp_code}-${l.from_date}-${l.to_date}-${i}`}
                    style={{
                      padding: 'var(--s3)',
                      border: '1px solid var(--line)',
                      borderLeft: '2px solid var(--accent)',
                      borderRadius: 'var(--r-sm)',
                      background: 'var(--bg)',
                    }}
                  >
                    <p style={{ fontSize: '.875rem', fontWeight: 600 }}>
                      {l.employee_name}{' '}
                      <span className="faint mono" style={{ fontWeight: 400 }}>({l.emp_code})</span>
                    </p>
                    <p className="muted" style={{ fontSize: '.75rem', marginTop: '.15rem' }}>
                      <span className="mono">{l.leave_code}</span> · {fmtDate(l.from_date)} → {fmtDate(l.to_date)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* ------------------------------------------------ reject */}
      {rejecting && (
        <Modal
          title="Reject Leave Application"
          sub={`#${rejecting.id} · ${rejecting.employee_name} · ${fmtDay(rejecting.from_date, false)} → ${fmtDay(rejecting.to_date)}`}
          onClose={closeReject}
          footer={
            <>
              <button className="btn btn--ghost" onClick={closeReject} disabled={busy === 'reject'}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={submitReject} disabled={busy === 'reject'}>
                {busy === 'reject' ? 'Rejecting…' : 'Reject Application'}
              </button>
            </>
          }
        >
          <Field
            id="reject-reason"
            label="Rejection reason"
            required
            help="The employee and their reporting manager are emailed this text."
            error={reasonErr}
          >
            <textarea
              id="reject-reason"
              className="textarea"
              rows={3}
              value={reason}
              onChange={(e) => { setReason(e.target.value); if (reasonErr) setReasonErr(''); }}
              placeholder="Why is this request being rejected?"
              aria-invalid={reasonErr ? 'true' : undefined}
              aria-describedby={reasonErr ? 'reject-reason-error' : 'reject-reason-help'}
            />
          </Field>
        </Modal>
      )}

      {/* ------------------------------------------------ cancel */}
      {cancelling && (
        <ConfirmModal
          title="Cancel this leave application?"
          body={
            `Leave #${cancelling.id} for ${cancelling.employee_name} (${fmtDay(cancelling.from_date, false)} → ${fmtDay(cancelling.to_date)}) ` +
            `will be marked Cancelled.` +
            (cancelling.status === 'Approved'
              ? cancelling.is_unpaid
                ? ' The attendance days marked Leave are cleared; the balance was never deducted, so nothing goes back.'
                : ' The deducted balance goes back and the attendance days marked Leave are cleared.'
              : '')
          }
          confirmLabel="Cancel the leave"
          danger
          busy={busy === 'cancel'}
          onConfirm={confirmCancel}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}
