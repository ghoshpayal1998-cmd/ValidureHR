'use client';

import { useEffect, useState } from 'react';
import {
  Building2, CalendarDays, IdCard, Lock, Megaphone, Plus, ScrollText, Settings2, Trash2,
} from 'lucide-react';
import { api, fmtDateTime, fmtDay, hasPerm } from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, PageHead, Skeleton, useToast,
} from '@/components/ui';

/*
 * 1st, 2nd, 3rd … with the 11th/12th/13th exceptions. Written out rather than
 * localised because these numbers read as prose in the cycle sentences, not as
 * data in a column.
 */
function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  const teens = v % 100;
  if (teens >= 11 && teens <= 13) return `${v}th`;
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`;
}

/* The server accepts 0–120; these are the only values worth offering. */
const PROBATION_OPTIONS = [
  { value: 0, label: 'No Probation (Disabled)' },
  { value: 1, label: '1 Month' },
  { value: 2, label: '2 Months' },
  { value: 3, label: '3 Months' },
  { value: 6, label: '6 Months' },
  { value: 9, label: '9 Months' },
  { value: 12, label: '1 Year (12 Months)' },
];

/*
 * One number decides where every month starts. Day 1 is a plain calendar
 * month; any other day names the cycle for the month it ends in. Past 28 the
 * start day does not exist in February, so the cycle ends on the last day
 * instead and the label says so.
 */
const CYCLE_OPTIONS = Array.from({ length: 31 }, (_, i) => {
  const d = i + 1;
  if (d === 1) return { value: 1, label: 'Calendar month (1st to the end of the month)' };
  return {
    value: d,
    label: `${ordinal(d)} of the previous month to the ${ordinal(d - 1)} of the current month`
      + (d > 28 ? ' (short months end on their last day)' : ''),
  };
});

const H2 = { fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 };
const ROW = { padding: 'var(--s3) 0', borderTop: '1px solid var(--line)', alignItems: 'flex-start' };

export default function AdminSettingsPage() {
  const toast = useToast();
  /* Reading the lists only needs employees.view, so a user can land here with
   * the lists populated and no right to change them. The write controls are
   * absent in that case rather than present and failing. */
  const canManage = hasPerm('settings.manage');

  const [settings, setSettings] = useState(null);
  const [departments, setDepartments] = useState(null);
  const [designations, setDesignations] = useState(null);
  const [holidays, setHolidays] = useState(null);
  const [announcements, setAnnouncements] = useState(null);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState('');

  const [deptName, setDeptName] = useState('');
  const [desgTitle, setDesgTitle] = useState('');
  const [holiday, setHoliday] = useState({ date: '', name: '' });
  const [post, setPost] = useState({ title: '', body: '' });

  const [confirming, setConfirming] = useState(null); // { path, title, body }
  const [busy, setBusy] = useState('');               // which write is in flight

  /*
   * Six independent reads sharing one error slot: announcements, org-settings
   * and the audit log need settings.manage while the other three do not, so a
   * user without it sees the lists that are theirs and one banner for the rest.
   * "Try again" re-runs all six.
   */
  const load = () => {
    setError('');
    const fail = (e) => setError(e.message);
    api('/admin/departments').then(setDepartments).catch(fail);
    api('/admin/designations').then(setDesignations).catch(fail);
    api('/admin/holidays').then(setHolidays).catch(fail);
    /* The other three need settings.manage. Firing them anyway turned a
     * missing permission into three 403s sharing one banner, and left the
     * three cards on a skeleton that never resolved — the screen looked like
     * it was still loading, permanently. */
    if (!canManage) return;
    api('/admin/org-settings').then(setSettings).catch(fail);
    api('/admin/announcements').then(setAnnouncements).catch(fail);
    api('/admin/audit-logs?limit=50').then(setLogs).catch(fail);
  };
  useEffect(load, []);

  /* ------------------------------------------------ mutations */

  /*
   * Every write reports both ways and, on success, re-reads all six sets: a
   * setting change writes an audit row, and a new department is immediately
   * assignable. On failure the form keeps what was typed.
   */
  async function run(key, request, onDone) {
    setBusy(key);
    try {
      const res = await request();
      toast(res?.message || 'Saved', 'ok');
      onDone?.();
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  }

  const saveProbation = (months) => run('probation', () => api('/admin/org-settings', {
    method: 'PUT', body: { default_probation_months: Number(months) },
  }));

  const saveCycle = (day) => run('cycle', () => api('/admin/org-settings', {
    method: 'PUT', body: { cycle_start_day: Number(day) },
  }));

  function addDepartment(ev) {
    ev.preventDefault();
    run('dept', () => api('/admin/departments', { method: 'POST', body: { name: deptName.trim() } }),
      () => setDeptName(''));
  }

  function addDesignation(ev) {
    ev.preventDefault();
    run('desg', () => api('/admin/designations', { method: 'POST', body: { title: desgTitle.trim() } }),
      () => setDesgTitle(''));
  }

  function addHoliday(ev) {
    ev.preventDefault();
    run('holiday', () => api('/admin/holidays', {
      method: 'POST', body: { date: holiday.date, name: holiday.name.trim() },
    }), () => setHoliday({ date: '', name: '' }));
  }

  function postAnnouncement(ev) {
    ev.preventDefault();
    run('post', () => api('/admin/announcements', {
      method: 'POST', body: { title: post.title.trim(), body: post.body.trim() },
    }), () => setPost({ title: '', body: '' }));
  }

  /* The dialog names the row and says what the removal costs, so nobody has to
   * remember which "Engineering" they clicked. */
  function askRemove(kind, item) {
    const dialogs = {
      department: {
        path: `/admin/departments/${item.id}`,
        title: `Remove department “${item.name}”?`,
        body: `“${item.name}” leaves the department list and the filters built from it. `
          + 'The server refuses while employees are still assigned to it.',
      },
      designation: {
        path: `/admin/designations/${item.id}`,
        title: `Remove designation “${item.title}”?`,
        body: `“${item.title}” stops being offered when adding or editing an employee. `
          + 'The server refuses while employees still hold it.',
      },
      holiday: {
        path: `/admin/holidays/${item.id}`,
        title: `Remove holiday “${item.name}”?`,
        body: `${fmtDay(item.date)} goes back to being a working day: it starts counting `
          + 'towards leave days and stops appearing on everyone’s dashboard.',
      },
      announcement: {
        path: `/admin/announcements/${item.id}`,
        title: `Remove announcement “${item.title}”?`,
        body: 'It disappears from every employee’s home screen. The notification already '
          + 'delivered to them is not recalled.',
      },
    };
    setConfirming(dialogs[kind]);
  }

  const remove = () => run('delete', () => api(confirming.path, { method: 'DELETE' }),
    () => setConfirming(null));

  /* ------------------------------------------------ states */

  const anyLoaded = settings || departments || designations || holidays || announcements || logs;
  if (error && !anyLoaded) {
    return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;
  }

  const cycleEnd = settings?.cycle_end_day;
  const calendarMode = settings && (cycleEnd === null || cycleEnd === undefined);

  return (
    <div className="page">
      <PageHead
        eyebrow="Management"
        title="Settings"
        sub="Company-wide policy, the lists the rest of the app picks from, and the audit trail"
      />

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {/* One endpoint failing does not take the cards that did load off screen. */}
        {error && anyLoaded && <ErrorNote error={error} onRetry={load} />}

        {/* ------------------------------------------------ policy */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={H2}>
                <Settings2
                  size={17}
                  aria-hidden="true"
                  style={{ color: 'var(--accent)', verticalAlign: '-2px', marginRight: '.4rem' }}
                />
                Company policy
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Probation default and the month every other screen counts by
              </p>
            </div>
          </div>

          {!canManage ? (
            <Empty
              icon={Lock}
              title="Restricted"
              body="The payroll cycle and probation defaults need the settings.manage permission."
            />
          ) : !settings ? (
            <Skeleton rows={3} />
          ) : (
            <div className="card__body">
              <div className="fieldrow">
                <div className="stack" style={{ gap: 'var(--s2)' }}>
                  <Field id="probation" label="Default probation period">
                    <select
                      id="probation"
                      className="select"
                      value={settings.default_probation_months ?? 0}
                      disabled={!canManage || busy === 'probation'}
                      onChange={(ev) => saveProbation(ev.target.value)}
                    >
                      {PROBATION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <p className="help">
                    New employees will have their probation end date calculated automatically
                    from their joining date.
                  </p>
                  {/* No Save button: the change itself is the save, so the control
                      goes quiet and says so while the PUT is in flight. */}
                  {busy === 'probation' && (
                    <p className="help" role="status">Saving probation default…</p>
                  )}
                </div>

                <div className="stack" style={{ gap: 'var(--s2)' }}>
                  <Field id="cycle" label="Payslip and attendance cycle">
                    <select
                      id="cycle"
                      className="select"
                      value={settings.cycle_start_day ?? 1}
                      disabled={!canManage || busy === 'cycle'}
                      onChange={(ev) => saveCycle(ev.target.value)}
                    >
                      {CYCLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <p className="help">
                    Sets what “a month” means everywhere: attendance grids and summaries, the
                    attendance export, dashboard counters, payslip periods and leave accrual.
                    A cycle is named for the month it <strong>ends</strong> in.
                    {settings.cycle_example && <> This month is <strong>{settings.cycle_example}</strong>.</>}
                  </p>
                  <p className="help">
                    {calendarMode ? (
                      <>Leave accrues on the {ordinal(settings.accrual_day)}.</>
                    ) : (
                      <>
                        Leave accrues on the <strong>{ordinal(cycleEnd)}</strong>, the last day
                        of each cycle
                        {settings.cycle_start_day > 28
                          && ' — a day earlier in months that are too short, so no day is ever counted in two cycles'}
                        .
                      </>
                    )}
                  </p>
                  <p className="help" style={{ color: 'var(--warn)' }}>
                    Changing this re-groups past months too, so previously reviewed attendance
                    totals will shift. No attendance record is altered.
                  </p>
                  {busy === 'cycle' && <p className="help" role="status">Saving cycle…</p>}
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="grid grid--2">
          {/* ------------------------------------------------ departments */}
          <section className="card">
            <div className="card__head">
              <h2 style={H2}>Departments</h2>
            </div>
            <div className="card__body">
              {canManage && (
                <form className="row row--wrap" style={{ gap: 'var(--s2)' }} onSubmit={addDepartment}>
                  <label className="sr" htmlFor="dept-name">New department name</label>
                  <input
                    id="dept-name"
                    className="input"
                    style={{ flex: '1 1 9rem' }}
                    value={deptName}
                    onChange={(ev) => setDeptName(ev.target.value)}
                    placeholder="e.g. Engineering"
                    required
                  />
                  <button className="btn btn--primary" disabled={busy === 'dept'}>
                    <Plus size={16} aria-hidden="true" />{busy === 'dept' ? 'Adding…' : 'Add'}
                  </button>
                </form>
              )}

              {!departments ? (
                <Skeleton rows={4} height={32} />
              ) : departments.length === 0 ? (
                <Empty
                  icon={Building2}
                  title="No departments yet"
                  body="Departments group the roster and drive the employee filters. The list appears here once the first one exists."
                />
              ) : (
                <ul className="stack" style={{ gap: 0, marginTop: canManage ? 'var(--s4)' : 0 }}>
                  {departments.map((d) => (
                    <li className="row row--between" style={ROW} key={d.id}>
                      <span style={{ fontSize: '.875rem', fontWeight: 500, minWidth: 0 }}>{d.name}</span>
                      {canManage && (
                        <button
                          className="iconbtn"
                          style={{ color: 'var(--err-text)', flex: 'none' }}
                          aria-label={`Remove department ${d.name}`}
                          onClick={() => askRemove('department', d)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ------------------------------------------------ designations */}
          <section className="card">
            <div className="card__head">
              <h2 style={H2}>Designations</h2>
            </div>
            <div className="card__body">
              {canManage && (
                <form className="row row--wrap" style={{ gap: 'var(--s2)' }} onSubmit={addDesignation}>
                  <label className="sr" htmlFor="desg-title">New designation title</label>
                  <input
                    id="desg-title"
                    className="input"
                    style={{ flex: '1 1 9rem' }}
                    value={desgTitle}
                    onChange={(ev) => setDesgTitle(ev.target.value)}
                    placeholder="e.g. Software Engineer"
                    required
                  />
                  <button className="btn btn--primary" disabled={busy === 'desg'}>
                    <Plus size={16} aria-hidden="true" />{busy === 'desg' ? 'Adding…' : 'Add'}
                  </button>
                </form>
              )}

              {!designations ? (
                <Skeleton rows={4} height={32} />
              ) : designations.length === 0 ? (
                <Empty
                  icon={IdCard}
                  title="No designations yet"
                  body="Designations are the job titles offered when adding an employee. The list appears here once the first one exists."
                />
              ) : (
                <ul className="stack" style={{ gap: 0, marginTop: canManage ? 'var(--s4)' : 0 }}>
                  {designations.map((d) => (
                    <li className="row row--between" style={ROW} key={d.id}>
                      <span style={{ fontSize: '.875rem', fontWeight: 500, minWidth: 0 }}>{d.title}</span>
                      {canManage && (
                        <button
                          className="iconbtn"
                          style={{ color: 'var(--err-text)', flex: 'none' }}
                          aria-label={`Remove designation ${d.title}`}
                          onClick={() => askRemove('designation', d)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ------------------------------------------------ holidays */}
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={H2}>Holiday calendar</h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>
                  Excluded from leave-day counts · adding one notifies everyone
                </p>
              </div>
            </div>
            <div className="card__body">
              {canManage && (
                <form className="row row--wrap" style={{ gap: 'var(--s2)' }} onSubmit={addHoliday}>
                  <label className="sr" htmlFor="holiday-date">Holiday date</label>
                  <input
                    id="holiday-date"
                    className="input"
                    type="date"
                    style={{ flex: '0 1 10.5rem' }}
                    value={holiday.date}
                    onChange={(ev) => setHoliday({ ...holiday, date: ev.target.value })}
                    required
                  />
                  <label className="sr" htmlFor="holiday-name">Holiday name</label>
                  <input
                    id="holiday-name"
                    className="input"
                    style={{ flex: '1 1 9rem' }}
                    value={holiday.name}
                    onChange={(ev) => setHoliday({ ...holiday, name: ev.target.value })}
                    placeholder="Holiday name"
                    required
                  />
                  <button className="btn btn--primary" disabled={busy === 'holiday'}>
                    <Plus size={16} aria-hidden="true" />{busy === 'holiday' ? 'Adding…' : 'Add'}
                  </button>
                </form>
              )}

              {!holidays ? (
                <Skeleton rows={4} height={32} />
              ) : holidays.length === 0 ? (
                <Empty
                  icon={CalendarDays}
                  title="No holidays configured"
                  body="Holidays are excluded from leave-day counts and appear on every dashboard. The year’s list appears here once the first one exists."
                />
              ) : (
                <ul className="stack" style={{ gap: 0, marginTop: canManage ? 'var(--s4)' : 0 }}>
                  {holidays.map((h) => (
                    <li className="row row--between" style={ROW} key={h.id}>
                      <span style={{ fontSize: '.875rem', fontWeight: 500, minWidth: 0 }}>{h.name}</span>
                      <span className="row" style={{ gap: 'var(--s2)', flex: 'none' }}>
                        <span className="chip">{fmtDay(h.date)}</span>
                        {canManage && (
                          <button
                            className="iconbtn"
                            style={{ color: 'var(--err-text)' }}
                            aria-label={`Remove holiday ${h.name}`}
                            onClick={() => askRemove('holiday', h)}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ------------------------------------------------ announcements */}
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={H2}>Company announcements</h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>
                  Posted to every home screen · the server stamps today’s date
                </p>
              </div>
            </div>
            <div className="card__body">
              {canManage && (
                <form className="stack" style={{ gap: 'var(--s3)' }} onSubmit={postAnnouncement}>
                  <Field id="ann-title" label="Title" required>
                    <input
                      id="ann-title"
                      className="input"
                      value={post.title}
                      onChange={(ev) => setPost({ ...post, title: ev.target.value })}
                      placeholder="Title"
                      required
                    />
                  </Field>
                  <Field id="ann-body" label="Announcement" required>
                    <textarea
                      id="ann-body"
                      className="textarea"
                      rows={2}
                      value={post.body}
                      onChange={(ev) => setPost({ ...post, body: ev.target.value })}
                      placeholder="Announcement text…"
                      required
                    />
                  </Field>
                  <div className="row">
                    <button className="btn btn--primary" disabled={busy === 'post'}>
                      <Plus size={16} aria-hidden="true" />
                      {busy === 'post' ? 'Posting…' : 'Post announcement'}
                    </button>
                  </div>
                </form>
              )}

              {!canManage ? (
                <Empty
                  icon={Lock}
                  title="Restricted"
                  body="Announcements need the settings.manage permission. They still reach you on the home page."
                />
              ) : !announcements ? (
                <Skeleton rows={3} height={52} />
              ) : announcements.length === 0 ? (
                <Empty
                  icon={Megaphone}
                  title="Nothing announced yet"
                  body="Announcements posted here appear on every employee’s home screen and push an in-app notification, newest first."
                />
              ) : (
                <ul className="stack" style={{ gap: 0, marginTop: canManage ? 'var(--s4)' : 0 }}>
                  {announcements.map((a) => (
                    <li className="row row--between" style={ROW} key={a.id}>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: '.875rem', fontWeight: 600, display: 'block' }}>
                          {a.title}
                        </span>
                        <span className="muted" style={{ fontSize: '.8125rem', display: 'block' }}>
                          {a.body}
                        </span>
                        <span className="faint" style={{ fontSize: '.75rem', display: 'block', marginTop: '.15rem' }}>
                          {fmtDay(a.date)}
                        </span>
                      </span>
                      {canManage && (
                        <button
                          className="iconbtn"
                          style={{ color: 'var(--err-text)', flex: 'none' }}
                          aria-label={`Remove announcement ${a.title}`}
                          onClick={() => askRemove('announcement', a)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* ------------------------------------------------ audit log */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={H2}>
                <ScrollText
                  size={17}
                  aria-hidden="true"
                  style={{ color: 'var(--accent)', verticalAlign: '-2px', marginRight: '.4rem' }}
                />
                Audit log
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                The latest 50 entries, newest first · read-only
              </p>
            </div>
          </div>

          {!canManage ? (
            <Empty
              icon={Lock}
              title="Restricted"
              body="The audit log needs the settings.manage permission."
            />
          ) : !logs ? (
            <Skeleton rows={6} />
          ) : logs.length === 0 ? (
            <Empty
              icon={ScrollText}
              title="Nothing logged yet"
              body="Every setting change, approval, upload and export writes a row here with who did it and when."
            />
          ) : (
            <div className="card__body card__body--flush">
              {/* The pane scrolls, not the page — and the table scrolls sideways
                  inside it rather than widening the card on a phone. */}
              <div className="tablewrap" style={{ maxHeight: '26rem', overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Details</th>
                      <th scope="col">Actor</th>
                      <th scope="col">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id}>
                        {/* The action is the stored constant, never prettified:
                            it is what you would grep the server logs for. */}
                        <td className="mono" style={{ fontSize: '.75rem', whiteSpace: 'nowrap' }}>
                          {l.action}
                        </td>
                        <td className="muted">{l.details || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{l.actor || 'system'}</td>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                          {fmtDateTime(l.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {confirming && (
        <ConfirmModal
          title={confirming.title}
          body={confirming.body}
          confirmLabel="Remove"
          danger
          busy={busy === 'delete'}
          onConfirm={remove}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
