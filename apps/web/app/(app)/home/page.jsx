'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, CalendarCheck, Check, Clock } from 'lucide-react';
import { api, fmtDay, getUser, initials } from '@/lib/api';
import { Empty, ErrorNote, PageHead, Skeleton, StatusBadge, useToast } from '@/components/ui';

const TILES = [
  { key: 'presentDays', label: 'Present', icon: Check, tone: 'ok' },
  { key: 'absentDays', label: 'Absent', icon: CalendarCheck, tone: 'err' },
  { key: 'wfhDays', label: 'Work from home', icon: BadgeCheck, tone: 'info' },
  { key: 'lateDays', label: 'Late marks', icon: Clock, tone: 'warn' },
];

export default function HomePage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [punching, setPunching] = useState(false);

  const load = () => {
    setError('');
    api('/dashboard').then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  async function punch() {
    /* The route requires an explicit action and answers 400 "Invalid action"
     * without one, so sending no body made this button fail every time.
     * Derive it exactly the way the button labels itself — a shift that has a
     * check-in punches out, anything else punches in — so the label and the
     * request can never disagree about what pressing it does. */
    const action = data?.widgets?.todayPunch?.checkIn ? 'out' : 'in';
    setPunching(true);
    try {
      const res = await api('/attendance/punch', { method: 'POST', body: { action } });
      toast(res?.message || 'Attendance recorded', 'ok');
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setPunching(false);
    }
  }

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!data) {
    return (
      <div className="page">
        <PageHead eyebrow="Home" title="Welcome back" />
        <div className="card"><Skeleton rows={4} /></div>
      </div>
    );
  }

  const { profile, widgets, upcomingHolidays, upcomingBirthdays, announcements, teamLeaves } = data;
  const punch_ = widgets.todayPunch || {};
  const onProbation = profile.probation_until && profile.probation_until >= widgets.month;

  return (
    <div className="page">
      <PageHead
        eyebrow="Home"
        title={`Welcome back, ${profile.first_name}!`}
        sub={`${profile.designation} · ${profile.department}`}
      >
        <Link className="btn btn--ghost" href="/leave/apply">Apply leave</Link>
        <Link className="btn btn--primary" href="/attendance">My attendance</Link>
      </PageHead>

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {onProbation && (
          <div className="card" style={{ borderColor: 'var(--warn)' }}>
            <div className="card__body row" style={{ gap: 'var(--s3)' }}>
              <Clock size={18} aria-hidden="true" style={{ color: 'var(--warn)', flex: 'none' }} />
              <p style={{ fontSize: '.875rem' }}>
                <b>Probation period active</b> — until {fmtDay(profile.probation_until)}.
                Some leave types may not be available to you yet.
              </p>
            </div>
          </div>
        )}

        {/* ------------------------------------------------ today */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Today’s attendance
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Shift 19:00 – 04:00 IST · the punch-out lands on the next calendar day
              </p>
            </div>
            <StatusBadge status={punch_.checkIn ? (punch_.checkOut ? 'Present' : 'Pending') : 'Absent'} />
          </div>
          <div className="card__body">
            <div className="grid grid--4" style={{ gap: 'var(--s4)' }}>
              <div>
                <p className="stat__label">Check in</p>
                <p className="stat__val mono" style={{ fontSize: '1.5rem', marginTop: 'var(--s2)' }}>
                  {punch_.checkIn || '—'}
                </p>
              </div>
              <div>
                <p className="stat__label">Check out</p>
                <p className="stat__val mono" style={{ fontSize: '1.5rem', marginTop: 'var(--s2)' }}>
                  {punch_.checkOut || '—'}
                </p>
                {!punch_.checkOut && punch_.checkIn && (
                  <p className="faint" style={{ fontSize: '.75rem' }}>shift in progress</p>
                )}
              </div>
              <div>
                <p className="stat__label">Leave balance</p>
                <p className="stat__val num" style={{ fontSize: '1.5rem', marginTop: 'var(--s2)' }}>
                  {widgets.leaveBalance}
                </p>
                <p className="faint" style={{ fontSize: '.75rem' }}>days across all types</p>
              </div>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <button className="btn btn--primary btn--block" onClick={punch} disabled={punching}>
                  {punching ? 'Recording…' : punch_.checkIn ? 'Punch out' : 'Punch in'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ month */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Attendance overview
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>{widgets.periodLabel}</p>
            </div>
            <Link className="btn btn--quiet btn--sm" href="/attendance">View calendar →</Link>
          </div>
          <div className="card__body">
            <div className="grid grid--4" style={{ gap: 'var(--s4)' }}>
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
                    <p className="stat__val">{widgets[key] ?? 0}</p>
                    <p className="stat__meta">days this cycle</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ who's away */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Leave in your team
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                {/* The route filters on reporting manager, not on status, so
                    this is every recent request from a direct report — the
                    intimation a manager gets, not an approval queue. */}
                Recent requests from the people who report to you
              </p>
            </div>
          </div>
          {teamLeaves?.length ? (
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {teamLeaves.map((l) => {
                      /* The route returns a single concatenated employee_name
                       * and a leave_code — not first_name/last_name/leave_type,
                       * which would render "undefined undefined" and a blank
                       * type for every row a manager actually has. */
                      const name = l.employee_name || 'Unnamed employee';
                      return (
                        <tr key={l.id}>
                          <td>
                            <span className="person">
                              <span className="avatar avatar--sm">{initials(name)}</span>
                              <span>
                                <span className="person__name" style={{ display: 'block' }}>{name}</span>
                                <span className="person__meta">{l.emp_code}</span>
                              </span>
                            </span>
                          </td>
                          <td className="muted">{l.leave_code}</td>
                          <td className="mono">{fmtDay(l.from_date, false)}</td>
                          <td className="mono">{fmtDay(l.to_date, false)}</td>
                          <td><StatusBadge status={l.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <Empty
              icon={CalendarCheck}
              title="Nothing from your team"
              body="Leave requests from the people who report to you appear here, so you see them without having to be the one who approves them."
            />
          )}
        </section>

        {/* ------------------------------------------------ holidays + birthdays */}
        <div className="grid grid--2">
          <section className="card">
            <div className="card__head">
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Upcoming holidays
              </h2>
            </div>
            {upcomingHolidays?.length ? (
              <div className="card__body">
                <div className="stack" style={{ gap: 'var(--s4)' }}>
                  {upcomingHolidays.map((h) => {
                    const [, m, d] = h.date.split('-');
                    const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][+m - 1];
                    return (
                      <div className="row" style={{ gap: 'var(--s4)' }} key={h.date + h.name}>
                        <div style={{
                          textAlign: 'center', flex: 'none', width: '3rem', padding: '.4rem 0',
                          border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', background: 'var(--bg)',
                        }}>
                          <p className="mono" style={{ fontSize: '1.125rem', fontWeight: 600, lineHeight: 1 }}>{d}</p>
                          <p className="eyebrow eyebrow--plain" style={{ fontSize: 9, justifyContent: 'center' }}>{mon}</p>
                        </div>
                        <p style={{ fontSize: '.875rem', fontWeight: 600 }}>{h.name}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <Empty title="No holidays coming up" body="The company holiday calendar is set in Settings." />
            )}
          </section>

          <section className="card">
            <div className="card__head">
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Birthdays
              </h2>
            </div>
            {upcomingBirthdays?.length ? (
              <div className="card__body">
                <div className="stack" style={{ gap: 'var(--s4)' }}>
                  {upcomingBirthdays.map((b) => {
                    const name = `${b.first_name} ${b.last_name}`;
                    return (
                      <div className="row row--between" key={b.id}>
                        <span className="person">
                          <span className="avatar">{initials(name)}</span>
                          <span>
                            <span className="person__name" style={{ display: 'block' }}>{name}</span>
                            <span className="person__meta">{b.emp_code}</span>
                          </span>
                        </span>
                        {b.dob && <span className="chip">{fmtDay(b.dob, false)}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <Empty title="No birthdays this month" />
            )}
          </section>
        </div>

        {/* ------------------------------------------------ announcements */}
        <section className="card">
          <div className="card__head">
            <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
              Company announcements
            </h2>
          </div>
          {announcements?.length ? (
            <div className="card__body">
              <div className="stack" style={{ gap: 'var(--s5)' }}>
                {announcements.map((a, i) => (
                  <article
                    key={a.id ?? i}
                    style={{ paddingLeft: 'var(--s4)', borderLeft: `2px solid ${i === 0 ? 'var(--accent)' : 'var(--line)'}` }}
                  >
                    <h3 style={{ fontSize: '.9375rem' }}>{a.title}</h3>
                    <p className="muted" style={{ fontSize: '.875rem', marginTop: '.25rem' }}>{a.body}</p>
                    <p className="faint" style={{ fontSize: '.75rem', marginTop: 'var(--s2)' }}>{fmtDay(a.date)}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <Empty title="Nothing announced yet" body="Announcements posted from Settings appear here." />
          )}
        </section>
      </div>
    </div>
  );
}
