'use client';

import { useEffect, useState } from 'react';
import { Download, Eye, FileBadge, FileText } from 'lucide-react';
import { api, fmtDate, hasPerm, openProtectedFile } from '@/lib/api';
import { Empty, ErrorNote, PageHead, Skeleton, useToast } from '@/components/ui';

/*
 * The API hands back exactly six fields per letter — id, employee_id,
 * title, file_name, is_revised, uploaded_at — and nothing about the terms
 * inside the document. So this screen does not try to preview the letter:
 * it names it, dates it, says whether it is the original or a revision, and
 * gets out of the way of the file itself.
 *
 * One wrinkle: with documents.manage the same route returns EVERY employee's
 * letters, each row carrying two extra fields (emp_code, employee_name) that
 * are absent from an ordinary employee's own list. So the page asks
 * hasPerm() what it is looking at rather than calling someone else's letter
 * "yours", and names the employee on the rows that carry one.
 *
 * Ordering comes from the server (uploaded_at DESC, grouped by emp_code for
 * the manage view), which is why a revision sits above the original without
 * this page sorting anything.
 */

/* Uploads are accepted as PDF, DOC/DOCX, JPG, PNG or WEBP, so the saved name
 * has to follow the stored file rather than assume a PDF — a .docx letter
 * saved as "….pdf" simply will not open. */
function extOf(fileName) {
  const m = /\.[a-zA-Z0-9]{1,8}$/.exec(String(fileName || ''));
  return m ? m[0].toLowerCase() : '';
}

export default function OfferLetterPage() {
  const toast = useToast();
  const manages = hasPerm('documents.manage');
  const [letters, setLetters] = useState(null);
  const [error, setError] = useState('');
  /* One key, not one flag per button: "12:view" means the View button on
   * letter 12 is in flight, so only that button goes quiet. */
  const [busy, setBusy] = useState('');

  const load = () => {
    setError('');
    api('/documents/offer-letters').then(setLetters).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  /* The file sits behind the auth header, so a plain href 404s — it has to
   * be fetched as a blob. Nothing is being changed here, so there is no
   * refetch afterwards; there would be nothing new to read. */
  async function openFile(letter, download) {
    setBusy(`${letter.id}:${download ? 'dl' : 'view'}`);
    try {
      await openProtectedFile(
        `/documents/offer-letters/${letter.id}/file`,
        download,
        `${letter.title}${extOf(letter.file_name) || '.pdf'}`,
      );
      toast(download ? 'Offer letter downloaded' : 'Opened in a new tab', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  }

  /* documents.manage gets the whole company's letters back, not just their
   * own, so the subtitle must not claim otherwise. */
  const sub = manages
    ? 'Appointment letters across the company'
    : 'Your employment offer letter(s)';

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!letters) {
    return (
      <div className="page">
        <PageHead eyebrow="Documents" title="Offer Letter" sub={sub} />
        <div className="grid grid--2" style={{ maxWidth: '48rem', gap: 'var(--s4)' }}>
          <div className="card"><Skeleton rows={3} /></div>
          <div className="card"><Skeleton rows={3} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead eyebrow="Documents" title="Offer Letter" sub={sub} />

      {/* ------------------------------------------------ the letters
          Deliberately narrow: one column on a phone, two from 640px and
          never more, the whole grid capped at 48rem and left-aligned.
          The space left over to its right is the point, not an accident. */}
      <div className="grid grid--2" style={{ maxWidth: '48rem', gap: 'var(--s4)' }}>
        {letters.length === 0 ? (
          /* Sits in the first cell rather than across the page: an absent
             letter is a small fact, and plenty of people who joined before
             the portal existed will only ever see this. */
          <div className="card">
            <Empty
              icon={FileText}
              title="No offer letter uploaded yet"
              body="Letters signed before the portal went live are often still on paper. Ask the People team and they will add yours — it will appear here, with any later revision above it."
            />
          </div>
        ) : (
          letters.map((l) => {
            const tone = l.is_revised ? 'warn' : 'ok';
            const viewing = busy === `${l.id}:view`;
            const downloading = busy === `${l.id}:dl`;
            return (
              <article className="card" key={l.id}>
                <div className="card__body">
                  <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                    <span
                      className="stat__icon"
                      style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})`, flex: 'none' }}
                    >
                      <FileBadge size={22} aria-hidden="true" />
                    </span>
                    <span className={`badge badge--${tone}`}>{l.is_revised ? 'Revised' : 'Original'}</span>
                  </div>

                  <h2
                    style={{
                      fontFamily: 'var(--font-body)', fontSize: '.9375rem', fontWeight: 600,
                      marginTop: 'var(--s3)', overflowWrap: 'anywhere',
                    }}
                  >
                    {l.title}
                  </h2>

                  {/* With documents.manage the route returns every employee's
                      letters, so without this the whole company's letters look
                      alike and there is no way to tell whose is whose. */}
                  {manages && (l.employee_name || l.emp_code) && (
                    <p className="person__meta" style={{ marginTop: 'var(--s1)' }}>
                      {l.employee_name}
                      {l.employee_name && l.emp_code ? ' · ' : ''}
                      {l.emp_code}
                    </p>
                  )}

                  {/* uploaded_at arrives as "YYYY-MM-DD HH:MM:SS"; fmtDate takes
                      the string apart instead of parsing it, so the day cannot
                      slip on a server whose clock is not IST. */}
                  <p className="faint" style={{ fontSize: '.75rem', marginTop: '.25rem' }}>
                    Uploaded: <span className="mono">{fmtDate(l.uploaded_at)}</span>
                  </p>

                  <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s4)' }}>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ flex: '1 1 0' }}
                      onClick={() => openFile(l, false)}
                      disabled={viewing || downloading}
                    >
                      <Eye size={15} aria-hidden="true" />
                      {viewing ? 'Opening…' : 'View'}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ flex: '1 1 0' }}
                      onClick={() => openFile(l, true)}
                      disabled={viewing || downloading}
                    >
                      <Download size={15} aria-hidden="true" />
                      {downloading ? 'Downloading…' : 'Download PDF'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
