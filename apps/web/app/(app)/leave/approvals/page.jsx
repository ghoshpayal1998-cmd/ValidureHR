'use client';

import { useEffect, useState } from 'react';
import { Check, Inbox, Paperclip, X } from 'lucide-react';
import { api, fmtDate, hasPerm, initials, openProtectedFile } from '@/lib/api';
import { Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast } from '@/components/ui';

const days = (n) => `${n} ${Number(n) === 1 ? 'day' : 'days'}`;

export default function LeaveApprovalsPage() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(0);

  /*
   * The approver needs the applicant's remaining balance to decide, and
   * /leaves/pending does not carry one — the recorded shape has no balance
   * field. /balances does, keyed by employee_id then leave_type_id, but it
   * sits behind balances.manage, which leaves.approve does not imply. So it
   * is a second, optional fetch: if it is denied the cards still render,
   * with the balance line saying so rather than guessing a number.
   */
  const [balances, setBalances] = useState(null);
  const [balancesOff, setBalancesOff] = useState(false);

  /* the reject dialog: the request being rejected, plus its reason */
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setError('');
    api('/leaves/pending').then(setRows).catch((e) => setError(e.message));

    if (!hasPerm('balances.manage')) { setBalancesOff(true); return; }
    api('/balances')
      .then((b) => { setBalances(b); setBalancesOff(false); })
      .catch(() => setBalancesOff(true));
  };
  useEffect(load, []);

  /* null when the balance is not knowable, so the card can say "not visible"
   * instead of printing a zero the API never sent. */
  function balanceOf(l) {
    const emp = balances?.employees?.find((e) => e.employee_id === l.employee_id);
    const b = emp?.balances?.[l.leave_type_id];
    return b && b.balance !== undefined && b.balance !== null ? b.balance : null;
  }

  async function approve(l) {
    setBusyId(l.id);
    try {
      const res = await api(`/leaves/${l.id}/approve`, { method: 'POST' });
      toast(res?.message || 'Leave approved', 'ok');
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusyId(0);
    }
  }

  function openReject(l) {
    setRejecting(l);
    setReason('');
    setReasonErr('');
  }

  function closeReject() {
    if (submitting) return;
    setRejecting(null);
  }

  async function submitReject() {
    /* The API falls back to "Not specified" when the reason is blank, but the
     * employee reads this in their history — make the approver write it. */
    if (!reason.trim()) { setReasonErr('Say why, the employee sees this reason'); return; }
    setSubmitting(true);
    try {
      const res = await api(`/leaves/${rejecting.id}/reject`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast(res?.message || 'Leave application rejected', 'ok');
      setRejecting(null);
      load();
    } catch (e) {
      /* leave the dialog open with the typed reason still in it */
      toast(e.message, 'err');
    } finally {
      setSubmitting(false);
    }
  }

  async function openAttachment(l) {
    try {
      await openProtectedFile(`/leaves/${l.id}/attachment`);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!rows) {
    return (
      <div className="page">
        <PageHead eyebrow="Leave" title="Leave Approvals" />
        <div className="card"><Skeleton rows={3} height={132} /></div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Leave"
        title="Leave Approvals"
        sub="One approval from you fully approves the request — the balance is deducted and the employee and their manager are emailed."
      />

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {rows.length ? (
          /* ------------------------------------------------ the inbox */
          <div className="grid grid--2">
            {rows.map((l) => {
              const bal = balanceOf(l);
              const short = bal !== null && !l.is_unpaid && bal < l.days;
              const busy = busyId === l.id;

              return (
                <article className="card" key={l.id}>
                  <div className="card__body">
                    <div className="stack" style={{ gap: 'var(--s3)' }}>

                      {/* ---------------------------------- who, and when */}
                      <div className="row row--between" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
                        <span className="person" style={{ alignItems: 'flex-start' }}>
                          <span className="avatar" style={{ flex: 'none' }}>{initials(l.employee_name)}</span>
                          <span style={{ minWidth: 0 }}>
                            <span className="person__name" style={{ display: 'block' }}>
                              {l.employee_name}{' '}
                              <span className="faint" style={{ fontWeight: 400 }}>({l.emp_code})</span>
                            </span>
                            <span className="person__meta" style={{ display: 'block', marginTop: '.15rem' }}>
                              {l.leave_type} · {fmtDate(l.from_date)} → {fmtDate(l.to_date)} ·{' '}
                              <b style={{ fontWeight: 600 }}>{days(l.days)}</b>
                            </span>
                          </span>
                        </span>
                        <span
                          className="stack"
                          style={{ gap: 'var(--s1)', justifyItems: 'end', flex: 'none' }}
                        >
                          <StatusBadge status="Awaiting Approval" tone="warn" />
                          {l.is_unpaid && <StatusBadge status="Unpaid (probation)" tone="warn" />}
                        </span>
                      </div>

                      {/* ---------------------------------- their reason */}
                      <p
                        style={{
                          fontSize: '.875rem',
                          color: 'var(--muted)',
                          background: 'var(--bg)',
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--r)',
                          padding: 'var(--s3)',
                        }}
                      >
                        <span className="stat__label">Reason: </span>
                        {l.reason || '—'}
                      </p>

                      {/* ---------------------------------- balance, so the
                          call can be made without opening another screen */}
                      <div
                        className="row row--between row--wrap"
                        style={{
                          gap: 'var(--s2)',
                          padding: 'var(--s2) var(--s3)',
                          border: `1px solid ${short ? 'var(--warn)' : 'var(--line)'}`,
                          borderRadius: 'var(--r)',
                          background: short ? 'var(--warn-soft)' : 'var(--surface)',
                        }}
                      >
                        <span className="stat__label">{l.leave_type} balance</span>
                        {bal === null ? (
                          <span className="faint" style={{ fontSize: '.75rem' }}>
                            {balancesOff ? 'not visible to you' : 'loading…'}
                          </span>
                        ) : (
                          <span className="num mono" style={{ fontSize: '.8125rem' }}>
                            {bal} left · {days(l.days)} requested
                          </span>
                        )}
                      </div>
                      {short && (
                        <p style={{ fontSize: '.75rem', color: 'var(--warn)' }}>
                          Short by {days(Math.round((l.days - bal) * 100) / 100)} — approving will be refused
                          until the balance is adjusted.
                        </p>
                      )}
                      {l.is_unpaid && (
                        <p className="faint" style={{ fontSize: '.75rem' }}>
                          Unpaid: nothing is deducted from the balance.
                        </p>
                      )}

                      {/* ---------------------------------- attachment */}
                      {l.attachment_file && (
                        <p>
                          <button
                            className="btn btn--quiet btn--sm"
                            onClick={() => openAttachment(l)}
                          >
                            <Paperclip size={14} aria-hidden="true" />
                            View attached document
                          </button>
                        </p>
                      )}

                      <p className="faint" style={{ fontSize: '.75rem' }}>
                        Applied {fmtDate(l.applied_at)}
                      </p>

                      {/* ---------------------------------- decide */}
                      <div className="row" style={{ gap: 'var(--s3)', marginTop: 'var(--s1)' }}>
                        <button
                          className="btn btn--primary"
                          style={{ flex: 1 }}
                          onClick={() => approve(l)}
                          disabled={busy || submitting}
                        >
                          <Check size={16} aria-hidden="true" />
                          {busy ? 'Approving…' : 'Approve'}
                        </button>
                        <button
                          className="btn btn--danger"
                          style={{ flex: 1 }}
                          onClick={() => openReject(l)}
                          disabled={busy || submitting}
                        >
                          <X size={16} aria-hidden="true" />
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          /* ------------------------------------------------ empty inbox —
             the normal state on most days, not an error */
          <section className="card">
            <Empty
              icon={Inbox}
              title="Nothing waiting for approval"
              body="New leave applications land here (and in your email) the moment someone applies."
            />
          </section>
        )}
      </div>

      {/* ------------------------------------------------ reject dialog.
          A rejection needs a written reason, and ConfirmModal has no slot for
          a field — so this is a Modal whose submit carries the danger styling
          and names exactly what it is about to do. */}
      {rejecting && (
        <Modal
          title="Reject leave application"
          sub={`${rejecting.employee_name} · ${rejecting.leave_type} · ${fmtDate(rejecting.from_date)} → ${fmtDate(rejecting.to_date)} · ${days(rejecting.days)}`}
          onClose={closeReject}
          footer={
            <>
              <button className="btn btn--ghost" onClick={closeReject} disabled={submitting}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={submitReject} disabled={submitting}>
                {submitting ? 'Rejecting…' : 'Reject application'}
              </button>
            </>
          }
        >
          <div className="stack">
            <p className="muted" style={{ fontSize: '.875rem' }}>
              The request is marked Rejected, and {rejecting.employee_name} and their reporting
              manager are emailed this reason. It also shows on their leave history.
            </p>
            <Field
              id="reject-reason"
              label="Rejection reason"
              required
              error={reasonErr}
              help="The employee reads this word for word."
            >
              <textarea
                id="reject-reason"
                className="textarea"
                rows={3}
                value={reason}
                required
                aria-invalid={reasonErr ? 'true' : undefined}
                aria-describedby={reasonErr ? 'reject-reason-error' : 'reject-reason-help'}
                placeholder="Why is this request being rejected?"
                onChange={(e) => { setReason(e.target.value); setReasonErr(''); }}
                disabled={submitting}
              />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
