'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarX, Check, Clock, ExternalLink, Search, Upload, UserRound } from 'lucide-react';
import { api, fmtDate, hasPerm, initials, isOnProbation, openProtectedFile } from '@/lib/api';
import { ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast } from '@/components/ui';

/* Present counts a Half Day as 0.5, so both tiles can be fractional. */
const TILES = [
  { key: 'presentDays', label: 'Present', icon: Check, tone: 'ok' },
  { key: 'absentDays', label: 'Absent', icon: CalendarX, tone: 'err' },
];

/* A row of the definition lists. dt/dd inside a div is valid inside a dl, and
 * it lets the label and value sit on one line without a grid. */
function Detail({ label, children, first }) {
  return (
    <div
      className="row row--between"
      style={{
        gap: 'var(--s4)', alignItems: 'baseline', padding: 'var(--s3) 0',
        borderTop: first ? '0' : '1px solid var(--line)',
      }}
    >
      <dt className="muted" style={{ fontSize: '.8125rem' }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: '.875rem', fontWeight: 500, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>
        {children}
      </dd>
    </div>
  );
}

const fullName = (p) => `${p.first_name} ${p.last_name}`;
const dash = (v) => v || '—';

export default function ProfilePage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const fileRef = useRef(null);

  const load = () => {
    setError('');
    api('/dashboard').then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  async function upload() {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await api(`/employees/${data.profile.id}/photo`, { method: 'POST', formData: body });
      toast(res?.message || 'Photo uploaded', 'ok');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e) {
      /* The picked file stays selected, so a retry does not mean browsing again. */
      toast(e.message, 'err');
    } finally {
      setUploading(false);
      setReplacing(false);
    }
  }

  /* The photo sits behind the auth header, so it cannot be an <img src>. It
   * opens as a blob in a new tab the same way payslips and policies do. */
  async function viewPhoto() {
    setOpening(true);
    try {
      await openProtectedFile(`/employees/${data.profile.id}/photo`);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setOpening(false);
    }
  }

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!data) {
    return (
      <div className="page">
        <PageHead eyebrow="Profile" title="My Profile" />
        <div className="card"><Skeleton rows={6} /></div>
      </div>
    );
  }

  const { profile, widgets, leaveBalances, activeEmployees } = data;

  /* An account can exist without an employee record behind it. */
  if (!profile) {
    return (
      <div className="page">
        <PageHead eyebrow="Profile" title="My Profile" />
        <div className="card">
          <Empty
            icon={UserRound}
            title="No profile linked to this account"
            body="Your master data, photo, leave balances and the colleague directory appear here once HR links an employee record to your login."
          />
        </div>
      </div>
    );
  }

  const me = fullName(profile);
  const onProbation = isOnProbation(profile.probation_until);
  const canUpload = hasPerm('employees.manage');

  /* Unpaid Leave is a bookkeeping type, not an entitlement — it never has a
   * balance worth showing, so it is filtered out rather than shown at zero. */
  const balances = (leaveBalances || []).filter((b) => b.code !== 'UL');

  /* The API already returns only Active employees, ordered by first name. */
  const colleagues = (activeEmployees || []).filter((e) => e.id !== profile.id);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? colleagues.filter((e) =>
        [e.first_name, e.last_name, e.designation].some((v) => (v || '').toLowerCase().includes(needle)))
    : colleagues;

  const rows = [
    ['Employee Name', me],
    ['Employee ID', <span className="mono" key="code">{profile.emp_code}</span>],
    ['Phone Number', dash(profile.phone)],
    ['Emergency Contact', dash(profile.emergency_contact)],
    ['Email ID', dash(profile.email)],
    ['Date of Joining', fmtDate(profile.doj)],
    ['Date of Birth', fmtDate(profile.dob)],
    ['Designation', dash(profile.designation)],
    ['Department', dash(profile.department)],
    ['Reporting Manager', dash(profile.reporting_manager)],
    ['Employment Status', <StatusBadge status={profile.status} key="status" />],
    ...(onProbation
      ? [['Probation Period',
          <span style={{ color: 'var(--warn)', fontWeight: 600 }} key="prob">
            Active (ends {fmtDate(profile.probation_until)})
          </span>]]
      : []),
  ];

  return (
    <div className="page">
      <PageHead
        eyebrow="Profile"
        title="My Profile"
        sub={`${me} · ${dash(profile.designation)}`}
      />

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {onProbation && (
          <div className="card" style={{ borderColor: 'var(--warn)' }}>
            <div className="card__body row" style={{ gap: 'var(--s3)' }}>
              <Clock size={18} aria-hidden="true" style={{ color: 'var(--warn)', flex: 'none' }} />
              <p style={{ fontSize: '.875rem' }}>
                <b>Probation period active</b> — until {fmtDate(profile.probation_until)}.
                During this time you can only apply for unpaid leave.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid--3">
          {/* ------------------------------------------------ master data */}
          <section className="card" style={{ alignSelf: 'start' }}>
            <div className="card__head">
              <div>
                <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                  {me}
                </h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>
                  {dash(profile.designation)} · {dash(profile.department)}
                </p>
              </div>
            </div>
            <div className="card__body">
              <dl>
                {rows.map(([label, value], i) => (
                  <Detail label={label} first={i === 0} key={label}>{value}</Detail>
                ))}
              </dl>
            </div>
          </section>

          {/* ------------------------------------------------ photo + cycle */}
          <div className="stack" style={{ gap: 'var(--s5)', alignContent: 'start' }}>
            <section className="card">
              <div className="card__head">
                <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                  Profile photo
                </h2>
              </div>
              <div className="card__body">
                <div className="stack" style={{ gap: 'var(--s4)', justifyItems: 'center' }}>
                  <div
                    style={{
                      width: '10rem', height: '13rem', display: 'grid', placeItems: 'center',
                      gap: 'var(--s2)', borderRadius: 'var(--r)', border: '1px solid var(--line)',
                      background: 'var(--bg)', color: 'var(--faint)', overflow: 'hidden',
                    }}
                  >
                    <p style={{ fontFamily: 'var(--font-head)', fontSize: '2.25rem', fontWeight: 700 }}>
                      {initials(me)}
                    </p>
                    <p className="eyebrow eyebrow--plain" style={{ fontSize: 10 }}>
                      {profile.photo_file ? 'Photo on file' : 'No photo'}
                    </p>
                  </div>

                  {profile.photo_file ? (
                    <button className="btn btn--ghost btn--sm" onClick={viewPhoto} disabled={opening}>
                      <ExternalLink size={14} aria-hidden="true" />
                      {opening ? 'Opening…' : 'View photo'}
                    </button>
                  ) : (
                    <p className="faint" style={{ fontSize: '.75rem', textAlign: 'center', maxWidth: '12rem' }}>
                      A passport size photo appears here once one is uploaded.
                    </p>
                  )}
                </div>

                {/* Uploading is an HR action; an employee without the
                    permission sees no control at all rather than a dead one. */}
                {canUpload && (
                  <form
                    className="stack"
                    style={{ gap: 'var(--s3)', marginTop: 'var(--s5)' }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!file) return;
                      /* Replacing overwrites the stored file, so it is confirmed. */
                      if (profile.photo_file) setReplacing(true);
                      else upload();
                    }}
                  >
                    <Field
                      id="photo"
                      label={profile.photo_file ? 'Replace photo' : 'Upload photo'}
                      help="JPG, PNG, WEBP or HEIC. Passport size works best."
                    >
                      <input
                        id="photo"
                        ref={fileRef}
                        className="input"
                        style={{ height: 'auto', padding: 'var(--s2)' }}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        disabled={uploading}
                      />
                    </Field>
                    <button className="btn btn--primary btn--block" type="submit" disabled={!file || uploading}>
                      <Upload size={15} aria-hidden="true" />
                      {uploading ? 'Uploading…' : profile.photo_file ? 'Replace photo' : 'Upload photo'}
                    </button>
                  </form>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <div>
                  <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                    Current month overview
                  </h2>
                  <p className="faint" style={{ fontSize: '.75rem' }}>{widgets.periodLabel}</p>
                </div>
              </div>
              <div className="card__body">
                <div className="grid grid--2" style={{ gap: 'var(--s4)' }}>
                  {TILES.map(({ key, label, icon: Icon, tone }) => (
                    <div className="card" style={{ boxShadow: 'none' }} key={key}>
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
                        <p className="stat__val num">{widgets[key] ?? 0}</p>
                        <p className="stat__meta">days this cycle</p>
                      </div>
                    </div>
                  ))}
                </div>

                <h3 style={{ fontSize: '.875rem', marginTop: 'var(--s6)' }}>Available leaves</h3>
                {balances.length ? (
                  <div className="stack" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
                    {balances.map((b) => (
                      <div
                        className="row row--between"
                        key={b.code}
                        style={{
                          gap: 'var(--s3)', padding: 'var(--s3)', borderRadius: 'var(--r-sm)',
                          border: '1px solid var(--line)', background: 'var(--bg)',
                        }}
                      >
                        <span className="muted" style={{ fontSize: '.75rem', fontWeight: 500 }}>{b.name}</span>
                        <span className="num" style={{ fontSize: '.875rem', fontWeight: 700, color: 'var(--accent-strong)' }}>
                          {b.balance}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="No leave balances"
                    body="Each leave type you accrue appears here with the days left to take. HR opens balances from Settings."
                  />
                )}
              </div>
            </section>
          </div>

          {/* ------------------------------------------------ directory */}
          <section className="card" style={{ alignSelf: 'start' }}>
            <div className="card__head">
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Active employees
              </h2>
              {/* The class ships a 15rem floor that would push this card wider
                  than its column on a narrow laptop; it shrinks instead. */}
              <div className="search" style={{ minWidth: 0, flex: '1 1 9rem', maxWidth: '14rem' }}>
                <Search size={16} aria-hidden="true" />
                <label className="sr" htmlFor="dirsearch">Search employees</label>
                <input
                  id="dirsearch"
                  className="input"
                  style={{ minWidth: 0, width: '100%' }}
                  type="search"
                  placeholder="Search employees…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

            {shown.length ? (
              <div className="card__body" style={{ maxHeight: '32rem', overflowY: 'auto' }}>
                <ul className="stack" style={{ gap: 'var(--s1)', listStyle: 'none' }}>
                  {shown.map((e) => {
                    const name = fullName(e);
                    return (
                      <li key={e.id}>
                        <button
                          className="btn btn--quiet"
                          onClick={() => setPicked(e)}
                          style={{
                            width: '100%', height: 'auto', justifyContent: 'flex-start',
                            textAlign: 'left', whiteSpace: 'normal', fontWeight: 400,
                            padding: 'var(--s2)', borderRadius: 'var(--r)',
                          }}
                        >
                          <span className="person" style={{ width: '100%' }}>
                            <span className="avatar">{initials(name)}</span>
                            <span style={{ minWidth: 0 }}>
                              <span
                                className="person__name"
                                style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg)' }}
                              >
                                {name}
                              </span>
                              <span
                                className="muted"
                                style={{ display: 'block', fontSize: '.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              >
                                {e.designation || 'Employee'}
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : needle ? (
              <Empty
                icon={Search}
                title="No employees match your search"
                body="The directory matches a first name, last name or designation. Clear the box to see everyone again."
              />
            ) : (
              <Empty
                icon={UserRound}
                title="No other active employees"
                body="Your colleagues appear here once HR adds them, so you can look up a desk number or a reporting line."
              />
            )}
          </section>
        </div>
      </div>

      {/* ------------------------------------------------ colleague details */}
      {picked && (
        <Modal title="Employee details" onClose={() => setPicked(null)} footer={null}>
          <div className="row" style={{ gap: 'var(--s4)' }}>
            <span className="avatar avatar--lg">{initials(fullName(picked))}</span>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: '1.125rem' }}>{fullName(picked)}</h3>
              <p className="muted" style={{ fontSize: '.875rem' }}>{picked.designation || 'Employee'}</p>
            </div>
          </div>

          <dl
            style={{
              border: '1px solid var(--line)', borderRadius: 'var(--r)',
              background: 'var(--bg)', padding: '0 var(--s4)',
            }}
          >
            <Detail label="Employee ID" first><span className="mono">{picked.emp_code}</span></Detail>
            <Detail label="Mail ID">
              {picked.email
                ? <a href={`mailto:${picked.email}`} style={{ color: 'var(--accent-strong)' }}>{picked.email}</a>
                : '—'}
            </Detail>
            <Detail label="Contact No.">{dash(picked.phone)}</Detail>
            <Detail label="Emergency Contact">{dash(picked.emergency_contact)}</Detail>
            <Detail label="Date of Joining">{fmtDate(picked.doj)}</Detail>
            <Detail label="Department">{dash(picked.department)}</Detail>
            <Detail label="Designation">{dash(picked.designation)}</Detail>
            <Detail label="Reporting Manager">{dash(picked.reporting_manager)}</Detail>
          </dl>
        </Modal>
      )}

      {replacing && (
        <ConfirmModal
          title="Replace your profile photo?"
          body={`The photo currently on file for ${profile.emp_code} will be overwritten by “${file?.name}”. The old one is not kept.`}
          confirmLabel="Replace photo"
          danger
          busy={uploading}
          onConfirm={upload}
          onClose={() => setReplacing(false)}
        />
      )}
    </div>
  );
}
