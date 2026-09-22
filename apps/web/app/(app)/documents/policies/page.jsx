'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Download, Eye } from 'lucide-react';
import { api, fmtDate, openProtectedFile } from '@/lib/api';
import { Empty, ErrorNote, PageHead, Skeleton, useToast } from '@/components/ui';

/* A policy is whatever HR uploaded — the API accepts .pdf, .doc, .docx and
 * images, and the row carries the stored file_name. Saving a Word handbook as
 * "<title>.pdf" gives the browser a file it cannot open, so the extension comes
 * off the real file and the title only supplies the readable part of the name. */
const extensionOf = (fileName) => {
  const match = /\.[a-z0-9]+$/i.exec(String(fileName || ''));
  return match ? match[0].toLowerCase() : '.pdf';
};
const downloadNameFor = (policy) => {
  const base = String(policy.title || 'policy').replace(/[\\/:*?"<>|]+/g, '-').trim();
  return `${base || 'policy'}${extensionOf(policy.file_name)}`;
};

export default function PoliciesPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  /* One key at a time — "view-3" or "dl-3" — so a card knows which of its two
   * buttons is mid-fetch and can say so on that button only. */
  const [busy, setBusy] = useState('');

  const load = () => {
    setError('');
    api('/documents/policies').then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  /*
   * Policies sit behind the auth header, so a plain href 404s: fetch the blob
   * with the token attached and hand the browser an object URL. The server
   * writes a POLICY_DOWNLOADED audit entry either way, which is why both the
   * view and the download go through the same route.
   */
  async function openFile(policy, download) {
    const key = `${download ? 'dl' : 'view'}-${policy.id}`;
    setBusy(key);
    try {
      await openProtectedFile(
        `/documents/policies/${policy.id}/file`,
        download,
        downloadNameFor(policy),
      );
      toast(download ? `Downloading ${policy.title}` : 'Opened in a new tab', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  }

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!data) {
    return (
      <div className="page">
        <PageHead
          eyebrow="Documents"
          title="Company Policies"
          sub="Official company policy documents"
        />
        <div className="card"><Skeleton rows={4} height={120} /></div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Documents"
        title="Company Policies"
        sub="Official company policy documents"
      />

      {/* ------------------------------------------------ policy library */}
      {data.length ? (
        /* The API returns them ORDER BY title, so the categories land scattered
         * rather than grouped — the pill is a label, not a section heading. */
        <div className="grid grid--3">
          {data.map((p) => {
            const viewing = busy === `view-${p.id}`;
            const downloading = busy === `dl-${p.id}`;
            const cardBusy = viewing || downloading;
            return (
              <article className="card" key={p.id}>
                {/* The body is a column and the description is the growing
                 * element, so every card in a row ends up the same height with
                 * its date line and buttons aligned along the bottom. */}
                <div
                  className="card__body"
                  style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
                >
                  <div className="row row--between" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
                    <span className="stat__icon" style={{ flex: 'none' }}>
                      <BookOpen size={20} aria-hidden="true" />
                    </span>
                    {/* Category is a free-text field on the admin upload form,
                      * so a long one is allowed to wrap rather than push the
                      * card — and the page — sideways at 320px. */}
                    <span
                      className="badge badge--info"
                      style={{ minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                    >
                      {p.category}
                    </span>
                  </div>

                  <h2
                    style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: '1rem',
                      fontWeight: 600,
                      marginTop: 'var(--s3)',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {p.title}
                  </h2>

                  {/* A policy with no description just leaves the spacer to do
                   * its job — the card gets shorter, the row stays aligned. */}
                  <p
                    className="muted"
                    style={{ fontSize: '.875rem', marginTop: '.25rem', flex: 1, overflowWrap: 'anywhere' }}
                  >
                    {p.description}
                  </p>

                  <p className="faint" style={{ fontSize: '.75rem', marginTop: 'var(--s3)' }}>
                    Updated: {fmtDate(p.uploaded_at)}
                  </p>

                  {/* Every card repeats the same two words, so the button's own
                    * label says nothing about which policy it opens — the
                    * accessible name carries the title. */}
                  <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s4)' }}>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ flex: 1 }}
                      onClick={() => openFile(p, false)}
                      disabled={cardBusy}
                      aria-label={`View ${p.title}`}
                    >
                      <Eye size={15} aria-hidden="true" />
                      {viewing ? 'Opening…' : 'View'}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ flex: 1 }}
                      onClick={() => openFile(p, true)}
                      disabled={cardBusy}
                      aria-label={`Download ${p.title}`}
                    >
                      <Download size={15} aria-hidden="true" />
                      {downloading ? 'Downloading…' : 'Download'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <Empty
            icon={BookOpen}
            title="No policies published yet"
            body="Handbooks, the leave policy, POSH and the rest appear here as soon as HR uploads them from the admin Documents screen."
          />
        </div>
      )}
    </div>
  );
}
