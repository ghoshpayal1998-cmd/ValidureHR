'use client';

import { useEffect, useState } from 'react';
import { Download, Eye, FileText, Inbox, Printer } from 'lucide-react';
import { api, money, openProtectedFile } from '@/lib/api';
import { Empty, ErrorNote, PageHead, Skeleton, useToast } from '@/components/ui';

/* The three card buttons are one action with three endings: open, save, or
 * open-and-let-the-browser-print. Keeping them in a table keeps the labels,
 * the busy wording and the spoken names from drifting apart. */
const ACTIONS = [
  { key: 'view', label: 'View', busyLabel: 'Opening…', icon: Eye, say: 'View the' },
  { key: 'pdf', label: 'PDF', busyLabel: 'Saving…', icon: Download, say: 'Download the PDF of the' },
  { key: 'print', label: 'Print', busyLabel: 'Opening…', icon: Printer, say: 'Print the' },
];

const fileNameFor = (label) => `salary-slip-${String(label).replace(/\s+/g, '-')}.pdf`;

export default function SalarySlipsPage() {
  const toast = useToast();
  const [slips, setSlips] = useState(null);
  const [error, setError] = useState('');
  /* "<slip id>:<action>" while a file is in flight — a card knows it is busy,
     and the button that was pressed knows which word to say. */
  const [busy, setBusy] = useState('');

  const load = () => {
    setError('');
    api('/documents/salary-slips').then(setSlips).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  /*
   * All three actions are the same authenticated fetch of the same PDF. The
   * file sits behind the bearer token, so a plain href 404s — it goes through
   * openProtectedFile, which attaches the header and hands the browser a blob.
   * Print has no route of its own: it opens the slip and leaves printing to
   * the browser, exactly as View does.
   */
  async function openSlip(slip, action) {
    setBusy(`${slip.id}:${action}`);
    const asDownload = action === 'pdf';
    try {
      await openProtectedFile(
        `/documents/salary-slips/${slip.id}/pdf`,
        asDownload,
        fileNameFor(slip.label),
      );
      toast(
        asDownload ? `Saved ${fileNameFor(slip.label)}`
          : action === 'print' ? 'Opened for printing — use your browser’s print option'
          : `Opened the ${slip.label} slip in a new tab`,
        'ok',
      );
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  }

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!slips) {
    return (
      <div className="page">
        <PageHead eyebrow="Documents" title="Salary Slips" />
        {/* Skeleton cards rather than one block, so the grid does not
            reflow under the reader when the slips land. */}
        <div className="grid grid--3">
          {[0, 1, 2].map((i) => (
            <div className="card" key={i}><Skeleton rows={2} height={38} /></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Documents"
        title="Salary Slips"
        sub="View, download or print your month-wise salary slips"
      >
        {/* No right-hand action slot on this screen: no year picker, no
            filter, no export. Deliberately bare. */}
      </PageHead>

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {slips.length ? (
          <>
            {/* ------------------------------------------------ slip grid
                One card per slip, newest first — the API orders them by year
                then month, so the list is never re-sorted here. */}
            <div className="grid grid--3">
              {slips.map((slip) => {
                const cardBusy = busy.startsWith(`${slip.id}:`);
                return (
                  <article className="card" style={{ display: 'flex', flexDirection: 'column' }} key={slip.id}>
                    <div
                      className="card__body"
                      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)', flex: 1 }}
                    >
                      <div className="row" style={{ gap: 'var(--s3)' }}>
                        <span className="stat__icon" style={{ flex: 'none' }}>
                          <FileText size={18} aria-hidden="true" />
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: '.9375rem', fontWeight: 600 }}>
                            {slip.label}
                          </span>
                          {/* Slips uploaded as ready-made PDFs carry no amount,
                              so the sub-line falls back to a plain description. */}
                          <span className="faint" style={{ display: 'block', fontSize: '.75rem' }}>
                            {slip.net_pay === null || slip.net_pay === undefined ? (
                              'Salary slip document'
                            ) : (
                              <>
                                Net Pay:{' '}
                                <span className="mono" style={{ color: 'var(--muted)', fontWeight: 600 }}>
                                  {money(slip.net_pay)}
                                </span>
                              </>
                            )}
                          </span>
                        </span>
                      </div>

                      <div className="row" style={{ gap: 'var(--s2)', marginTop: 'auto' }}>
                        {ACTIONS.map(({ key, label, busyLabel, icon: Icon, say }) => (
                          <button
                            className="btn btn--ghost btn--sm"
                            style={{ flex: 1, padding: '0 var(--s2)' }}
                            key={key}
                            onClick={() => openSlip(slip, key)}
                            disabled={cardBusy}
                            aria-label={`${say} ${slip.label} salary slip`}
                            title={key === 'print' ? 'Opens the slip — use your browser’s print option' : undefined}
                          >
                            <Icon size={15} aria-hidden="true" />
                            {busy === `${slip.id}:${key}` ? busyLabel : label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <p className="faint" style={{ fontSize: '.75rem' }}>
              Slips are issued for the 25th-to-24th payroll cycle and stay available for as long as
              you are on the rolls.
            </p>
          </>
        ) : (
          /* Nothing issued yet — a new joiner in their first month, for
             instance, or an employee whose first payroll run is still open. */
          <Empty
            icon={Inbox}
            title="No salary slips available yet."
            body="Each month’s slip appears here once the payroll run for that cycle has been approved and paid."
          />
        )}
      </div>
    </div>
  );
}
