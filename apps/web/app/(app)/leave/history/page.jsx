'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Inbox, Paperclip, Pencil, X } from 'lucide-react';
import { api, fmtDate, fmtDateTime, fmtDay, openProtectedFile } from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast,
} from '@/components/ui';

/* The order the filter pills appear in — the life of an application, not
 * alphabetical. Anything the API sends that is not on this list still gets a
 * pill, appended at the end, so a new status is visible rather than hidden. */
const STATUS_ORDER = ['Pending', 'Approved', 'Rejected', 'Cancelled'];

/* "Pending" reads as though the employee still has something to do, so the
 * badge says who is actually holding it up. Only the label changes — the
 * status value from the API is what everything else compares against. */
const STATUS_LABEL = { Pending: 'Awaiting Approval' };
const STATUS_TONE = { Pending: 'warn', Approved: 'ok', Rejected: 'err', Cancelled: 'neutral' };

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.doc,.docx';

export default function LeaveHistoryPage() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [types, setTypes] = useState([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');

  const [editing, setEditing] = useState(null);   // the application being edited
  const [form, setForm] = useState(null);         // its draft values
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [killing, setKilling] = useState(false);
  const [openingDoc, setOpeningDoc] = useState(null);

  const load = () => {
    setError('');
    /* The type list only feeds the edit dialog's dropdown, so it must not be
     * able to take the history down with it — a failure there falls back to
     * the application's own type. */
    Promise.all([api('/leaves/history'), api('/leaves/types').catch(() => [])])
      .then(([history, leaveTypes]) => { setRows(history); setTypes(leaveTypes); })
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const counts = useMemo(() => {
    const seen = {};
    (rows || []).forEach((l) => { seen[l.status] = (seen[l.status] || 0) + 1; });
    const known = STATUS_ORDER.filter((s) => seen[s]);
    const extra = Object.keys(seen).filter((s) => !STATUS_ORDER.includes(s));
    return { seen, list: [...known, ...extra] };
  }, [rows]);

  const shown = useMemo(
    () => (rows || []).filter((l) => filter === 'All' || l.status === filter),
    [rows, filter],
  );

  /* ------------------------------------------------ actions */

  async function openDoc(l) {
    setOpeningDoc(l.id);
    try {
      /* The attachment sits behind the auth header, so a plain href 404s. */
      await openProtectedFile(`/leaves/${l.id}/attachment`, false, `leave-${l.id}-document`);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setOpeningDoc(null);
    }
  }

  function startEdit(l) {
    setEditing(l);
    setForm({
      leave_type_id: String(l.leave_type_id),
      from_date: l.from_date,
      to_date: l.to_date,
      reason: l.reason || '',
      file: null,
    });
  }

  async function save(e) {
    e.preventDefault();
    if (!editing || !form) return;
    setSaving(true);
    try {
      /* The route is multipart — it shares its handler with the optional
       * replacement document, so even a text-only edit goes as FormData. */
      const fd = new FormData();
      fd.append('leave_type_id', form.leave_type_id);
      fd.append('from_date', form.from_date);
      fd.append('to_date', form.to_date);
      fd.append('reason', form.reason);
      if (form.file) fd.append('document', form.file);

      const res = await api(`/leaves/${editing.id}`, { method: 'PUT', formData: fd });
      toast(
        `${res?.message || 'Leave application updated'}${
          res?.days != null ? ` (${res.days} working day(s))` : ''
        } — the approvers have been notified.`,
        'ok',
      );
      setEditing(null);
      setForm(null);
      load();
    } catch (err) {
      /* The dialog stays open with everything still typed in — the server
       * rejects overlaps and insufficient balance, and both are fixable here. */
      toast(err.message, 'err');
    } finally {
      setSaving(false);
    }
  }

  async function cancelLeave() {
    if (!cancelling) return;
    setKilling(true);
    try {
      const res = await api(`/leaves/${cancelling.id}`, { method: 'DELETE' });
      toast(res?.message || 'Leave application cancelled', 'ok');
      setCancelling(null);
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setKilling(false);
    }
  }

  /* ------------------------------------------------ states */

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!rows) {
    return (
      <div className="page">
        <PageHead eyebrow="Leave" title="Leave History" />
        <div className="card"><Skeleton rows={6} /></div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Leave"
        title="Leave History"
        sub="All leave applications and their status — pending ones can be edited or cancelled"
      />

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Applications
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>Newest applied first</p>
            </div>
            <span className="chip">
              {rows.length} {rows.length === 1 ? 'application' : 'applications'}
            </span>
          </div>

          {/* ------------------------------------------------ status filter */}
          {rows.length > 0 && (
            <div className="tabs" role="tablist" aria-label="Filter applications by status">
              {['All', ...counts.list].map((s) => (
                <button
                  className="tab"
                  key={s}
                  id={`filter-${s}`}
                  role="tab"
                  type="button"
                  aria-selected={filter === s}
                  aria-controls="leave-results"
                  onClick={() => setFilter(s)}
                >
                  {s === 'All' ? 'All' : STATUS_LABEL[s] || s}{' '}
                  <span className="num faint">{s === 'All' ? rows.length : counts.seen[s]}</span>
                </button>
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <Empty
              icon={Inbox}
              title="No leave applications yet"
              body="Every leave you apply for lands here with its approval outcome. Anything still awaiting approval can be edited or cancelled from this table."
              action={<Link className="btn btn--primary btn--sm" href="/leave/apply">Apply for leave</Link>}
            />
          ) : (
            <div id="leave-results" role="tabpanel" aria-labelledby={`filter-${filter}`}>
              {shown.length === 0 ? (
                <Empty
                  icon={Inbox}
                  title={`Nothing ${(STATUS_LABEL[filter] || filter).toLowerCase()}`}
                  body="No application in your history has that status right now."
                  action={
                    <button className="btn btn--ghost btn--sm" onClick={() => setFilter('All')}>
                      Show all applications
                    </button>
                  }
                />
              ) : (
                <div className="card__body card__body--flush">
                  <div className="tablewrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Applied</th>
                          <th>Type</th>
                          <th>Dates</th>
                          <th className="num">Days</th>
                          <th>Document</th>
                          <th>Status</th>
                          <th>Decided by</th>
                          <th>Decision date</th>
                          <th>Rejection reason</th>
                          <th><span className="sr">Row actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((l) => (
                          <tr key={l.id}>
                            <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.applied_at)}</td>
                            <td>
                              {l.leave_type}
                              {l.is_unpaid && (
                                <> <span className="badge badge--warn">Unpaid</span></>
                              )}
                            </td>
                            <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                              {fmtDate(l.from_date)} → {fmtDate(l.to_date)}
                            </td>
                            <td className="num">{l.days}</td>
                            <td>
                              {l.attachment_file ? (
                                <button
                                  className="btn btn--quiet btn--sm"
                                  onClick={() => openDoc(l)}
                                  disabled={openingDoc === l.id}
                                  aria-label={`View the document attached to application ${l.id}`}
                                >
                                  <Paperclip size={13} aria-hidden="true" />
                                  {openingDoc === l.id ? 'Opening…' : 'View'}
                                </button>
                              ) : (
                                <span className="faint">—</span>
                              )}
                            </td>
                            <td>
                              <StatusBadge
                                status={STATUS_LABEL[l.status] || l.status}
                                tone={STATUS_TONE[l.status]}
                              />
                            </td>
                            <td className="muted">{l.decided_by || '—'}</td>
                            <td className="mono muted" style={{ whiteSpace: 'nowrap' }}>
                              {fmtDateTime(l.decided_at)}
                            </td>
                            <td className="muted" style={{ maxWidth: '14rem' }}>
                              {l.rejection_reason || '—'}
                            </td>
                            <td>
                              {/* Only a pending application is still the applicant's
                                  to change — the server refuses the rest anyway. */}
                              {l.status === 'Pending' && (
                                <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--s2)' }}>
                                  <button className="btn btn--quiet btn--sm" onClick={() => startEdit(l)}>
                                    <Pencil size={13} aria-hidden="true" />Edit
                                  </button>
                                  <button
                                    className="btn btn--quiet btn--sm"
                                    style={{ color: 'var(--err-text)' }}
                                    onClick={() => setCancelling(l)}
                                  >
                                    <X size={13} aria-hidden="true" />Cancel
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ------------------------------------------------ edit */}
      {editing && form && (
        <Modal
          title={`Edit leave application #${editing.id}`}
          sub="Saving re-notifies the approvers, and the working-day count is recalculated."
          onClose={() => { if (!saving) { setEditing(null); setForm(null); } }}
          footer={
            <>
              <button
                className="btn btn--ghost"
                onClick={() => { setEditing(null); setForm(null); }}
                disabled={saving}
              >
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="leave-edit" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </>
          }
        >
          <form className="stack" style={{ gap: 'var(--s4)' }} id="leave-edit" onSubmit={save}>
            <Field id="edit-type" label="Leave type" required>
              <select
                className="select"
                id="edit-type"
                required
                value={form.leave_type_id}
                onChange={(e) => setForm({ ...form, leave_type_id: e.target.value })}
              >
                {(types.length
                  ? types
                  : [{ id: editing.leave_type_id, name: editing.leave_type }]
                ).map((t) => (
                  <option value={String(t.id)} key={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>

            <div className="fieldrow">
              <Field id="edit-from" label="From date" required>
                <input
                  className="input"
                  id="edit-from"
                  type="date"
                  required
                  value={form.from_date}
                  aria-describedby="edit-days"
                  onChange={(e) => {
                    const from_date = e.target.value;
                    /* Plain YYYY-MM-DD strings compare correctly as text, so
                       the range never goes through a Date and never shifts. */
                    setForm({
                      ...form,
                      from_date,
                      to_date: form.to_date && form.to_date < from_date ? from_date : form.to_date,
                    });
                  }}
                />
              </Field>
              <Field id="edit-to" label="To date" required>
                <input
                  className="input"
                  id="edit-to"
                  type="date"
                  required
                  min={form.from_date}
                  value={form.to_date}
                  aria-describedby="edit-days"
                  onChange={(e) => setForm({ ...form, to_date: e.target.value })}
                />
              </Field>
            </div>
            <p className="help" id="edit-days">
              Weekends and declared holidays are not counted — the working-day total is
              recalculated on the server when you save.
            </p>

            <Field id="edit-reason" label="Reason" required>
              <textarea
                className="textarea"
                id="edit-reason"
                rows={3}
                required
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </Field>

            <Field
              id="edit-doc"
              label="Replace document (optional)"
              help="Leave empty to keep the current document. The approvers are re-notified after saving."
            >
              <input
                className="input"
                id="edit-doc"
                type="file"
                accept={ACCEPT}
                onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })}
              />
            </Field>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------ cancel */}
      {cancelling && (
        <ConfirmModal
          danger
          busy={killing}
          title="Cancel this leave application?"
          /* Cancel is offered on a Pending application only, and days are
           * deducted at approval — so there is nothing to give back, and
           * DELETE /leaves/:id restores a balance for an Approved leave
           * alone. Promising a restore sent people to Leave Balance to
           * watch for a number that was never going to move. */
          body={`Application #${cancelling.id} — ${cancelling.leave_type}, ${fmtDay(cancelling.from_date)} to ${fmtDay(cancelling.to_date)} (${cancelling.days} working day(s)). Cancelling withdraws it from the approvers' queue. Your balance is untouched either way — days are only deducted once a request is approved. You can apply again at any time.`}
          confirmLabel="Cancel application"
          onConfirm={cancelLeave}
          onClose={() => { if (!killing) setCancelling(null); }}
        />
      )}
    </div>
  );
}
