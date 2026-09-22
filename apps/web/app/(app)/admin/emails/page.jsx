'use client';

import { useEffect, useState } from 'react';
import { Info, Mails, Send } from 'lucide-react';
import { api, fmtDateTime, getUser, hasPerm } from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Modal, PageHead, Skeleton, StatusBadge, useToast,
} from '@/components/ui';

const H2 = { fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 };

/*
 * The badge colour is computed from the raw status string, never looked up in
 * a fixed list. The mailer writes its own reason into the column — 'sent',
 * 'skipped (SMTP not configured)', or 'failed: <whatever the relay said>' —
 * so a reason nobody has seen yet still lands somewhere sensible (amber)
 * instead of nowhere.
 */
function tone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'sent' || s === 'delivered') return 'ok';
  if (s.startsWith('failed') || s.startsWith('bounced')) return 'err';
  return 'warn';
}

const delivered = (status) => tone(status) === 'ok';

export default function AdminEmailLogPage() {
  const toast = useToast();
  const canManage = hasPerm('settings.manage');

  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const [open, setOpen] = useState(null);      // the row whose message is on screen
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  /* The server orders by id descending and caps the result itself. There is
   * no filter, no date range and no paging behind this route, so the screen
   * asks for the 200 newest attempts and renders exactly what comes back. */
  const load = () => {
    setError('');
    api('/admin/email-log?limit=200').then(setRows).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  /* ------------------------------------------------ mutations */

  /*
   * The endpoint takes no recipient: it mails the address on the signed-in
   * account, records the attempt in this very log and writes an audit row.
   * A 200 does not mean a mail left the building — with SMTP unset the API
   * answers smtp_configured:false and the row is logged as skipped, so that
   * answer is toasted as a problem rather than a success.
   */
  async function sendTest() {
    setBusy(true);
    try {
      const res = await api('/admin/test-email', { method: 'POST' });
      toast(res?.message || 'Test email queued', res?.smtp_configured === false ? 'err' : 'ok');
      setConfirming(false);
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------ states */

  /* A refetch that fails keeps the rows that did load on screen; only a first
   * load with nothing to show takes the whole page. */
  if (error && !rows) {
    return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;
  }

  const sendButton = canManage && (
    <button className="btn btn--primary" onClick={() => setConfirming(true)} disabled={busy}>
      <Send size={16} aria-hidden="true" />{busy ? 'Sending…' : 'Send test email'}
    </button>
  );

  if (!rows) {
    return (
      <div className="page">
        <PageHead eyebrow="Management" title="Email Log" />
        <div className="card"><Skeleton rows={6} /></div>
      </div>
    );
  }

  const undelivered = rows.filter((m) => !delivered(m.status)).length;

  return (
    <div className="page">
      <PageHead
        eyebrow="Management"
        title="Email Log"
        sub="Every notification the system sent (or would send). Configure SMTP_* environment variables for real delivery."
      >
        {sendButton}
      </PageHead>

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {error && <ErrorNote error={error} onRetry={load} />}

        {/* ------------------------------------------------ what a row means */}
        {/* Said once, plainly: a row is a delivery attempt, not a delivery.
            With SMTP unconfigured the API records the message and stops, so a
            log full of rows can still mean nothing ever left the building. */}
        <div className="card" style={{ borderColor: 'var(--info)' }}>
          <div className="card__body row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
            <Info size={18} aria-hidden="true" style={{ color: 'var(--info)', flex: 'none', marginTop: 2 }} />
            <p style={{ fontSize: '.875rem' }}>
              <b>A row here is an attempt, not an inbox.</b> When SMTP is not configured the API
              writes the message to this log instead of sending it, and the status says
              <span className="mono"> skipped (SMTP not configured)</span>. Those messages never
              left the building. Send a test email to check the relay before trusting a green row.
            </p>
          </div>
        </div>

        {/* ------------------------------------------------ the ledger */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={H2}>Notification log</h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Newest first · the server returns the latest 200 attempts, unfiltered and unpaged
              </p>
            </div>
            {rows.length > 0 && (
              <span className="chip mono">
                {rows.length} {rows.length === 1 ? 'email' : 'emails'} · {undelivered} not delivered
              </span>
            )}
          </div>

          {rows.length === 0 ? (
            <Empty
              icon={Mails}
              title="No emails yet"
              body="Leave applications, approvals, payslip notices and new-employee credentials are recorded here as the mailer writes them — with the full message body kept alongside each attempt."
            />
          ) : (
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">To</th>
                      <th scope="col">Subject</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      /* The whole row is the hit target, and the subject is
                         also a real button so the log is reachable from the
                         keyboard rather than the mouse alone. */
                      <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(m)}>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }} title={m.created_at}>
                          {fmtDateTime(m.created_at)}
                        </td>
                        <td className="mono" style={{ fontSize: '.8125rem' }}>{m.to_email}</td>
                        <td>
                          <button
                            type="button"
                            title={m.subject}
                            aria-label={`Open the message: ${m.subject}`}
                            onClick={() => setOpen(m)}
                            style={{
                              display: 'block', maxWidth: '21rem', textAlign: 'left',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              fontWeight: 600, color: 'var(--fg)',
                            }}
                          >
                            {m.subject}
                          </button>
                        </td>
                        {/* The badge prints the reason verbatim, so a relay
                            failure shows its whole sentence inside the pill
                            and widens this column — the table scrolls inside
                            .tablewrap rather than widening the page. */}
                        <td><StatusBadge status={m.status} tone={tone(m.status)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ------------------------------------------------ the message itself */}
      {open && (
        <Modal wide title={open.subject} footer={null} onClose={() => setOpen(null)}>
          <div className="stack" style={{ gap: 'var(--s4)' }}>
            <div className="row row--between row--wrap" style={{ gap: 'var(--s3)' }}>
              <p className="muted" style={{ fontSize: '.8125rem' }}>
                To <span className="mono" style={{ color: 'var(--fg)', fontWeight: 500 }}>{open.to_email}</span>
                {' · '}
                <span className="mono">{fmtDateTime(open.created_at)}</span>
              </p>
              <StatusBadge status={open.status} tone={tone(open.status)} />
            </div>

            <pre
              style={{
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflowX: 'auto',
                margin: 0, padding: 'var(--s4)',
                background: 'var(--bg)', border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)', color: 'var(--fg)',
                fontFamily: 'var(--font-mono)', fontSize: '.8125rem', lineHeight: 1.7,
              }}
            >
              {open.body || 'The mailer recorded no body for this message.'}
            </pre>

            <p className="help">
              The log keeps the message exactly as the mailer rendered it — nothing here can be
              edited or re-sent.
              {!delivered(open.status) && ' This one was never delivered, so the recipient has not read it.'}
            </p>
          </div>
        </Modal>
      )}

      {/* ------------------------------------------------ smoke test */}
      {confirming && (
        <ConfirmModal
          title="Send test email"
          body={`A test message goes to ${getUser()?.email || 'the address on your own account'} and is recorded at the top of this log. If SMTP is unconfigured the API logs it and sends nothing, and the status will say so.`}
          confirmLabel="Send test email"
          busy={busy}
          onConfirm={sendTest}
          onClose={() => !busy && setConfirming(false)}
        />
      )}
    </div>
  );
}
