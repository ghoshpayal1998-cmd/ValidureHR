'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  CalendarClock,
  ClipboardCheck,
  History,
  LayoutGrid,
  UserCheck,
  Users,
} from 'lucide-react';
import { api, fmtDate, fmtDateTime, fmtDay, getSelectedCompany, getUser, hasPerm, initials } from '@/lib/api';
import { Empty, ErrorNote, PageHead, Skeleton, StatusBadge } from '@/components/ui';

const TILES = [
  { key: 'employees', label: 'Total employees', icon: Users, tone: 'accent', meta: 'all statuses' },
  { key: 'activeEmployees', label: 'Active employees', icon: UserCheck, tone: 'ok', meta: 'on the rolls today' },
  { key: 'departments', label: 'Departments', icon: Building2, tone: 'info', meta: 'configured in Settings' },
  { key: 'pendingLeaves', label: 'Pending leave', icon: ClipboardCheck, tone: 'warn', meta: 'awaiting a decision' },
];

/* The attendance mix always reads in the same order whatever order the
 * query hands it back, so the eye lands in the same place every day.
 * Anything the server invents beyond this list still renders, at the end. */
const ATT_ORDER = ['Present', 'WFH', 'Half Day', 'Leave', 'Absent', 'Holiday', 'Weekend'];

/* StatusBadge already tones Present / Leave / Absent / Holiday / Weekend.
 * Only the two it has never seen need saying out loud. */
const ATT_TONE = { WFH: 'info', 'Half Day': 'warn' };

const LEAVE_TONE = {
  Pending: 'warn', 'Manager Approved': 'info', 'HR Approved': 'info',
  Approved: 'ok', Rejected: 'err', Cancelled: 'neutral',
};

/* "Pending" is what the table stores; "Awaiting approval" is what it means
 * to the person who has to act on it. */
const leaveLabel = (status) => (status === 'Pending' ? 'Awaiting approval' : status);

const H2 = { fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 };

export default function AdminOverviewPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [noCompany, setNoCompany] = useState(false);

  /* A platform admin works inside a company they have opened; with none
   * opened there is no tenant to summarise and the request would 400.
   * Ask for the company instead of showing an error that blames the server. */
  const load = () => {
    if (getUser()?.admin && !getSelectedCompany()) { setNoCompany(true); return; }
    setNoCompany(false);
    setError('');
    api('/admin/overview').then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (noCompany) {
    return (
      <div className="page">
        <PageHead eyebrow="Management" title="Overview" />
        <div className="card">
          <Empty
            icon={Building2}
            title="No company selected"
            body="Open a company from the platform console and its headcount, attendance and approval queue appear here."
            action={<Link className="btn btn--primary" href="/platform">Go to companies</Link>}
          />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <PageHead eyebrow="Management" title="Overview" />
        <div className="card"><Skeleton rows={4} /></div>
      </div>
    );
  }

  /* A destructuring default only fires when the key is absent. An aggregate
   * that found nothing can serialise as null instead, and `[...null]` or
   * `null.employees` takes the whole screen down — so coerce by type. */
  const list = (v) => (Array.isArray(v) ? v : []);
  const totals = data.totals && typeof data.totals === 'object' ? data.totals : {};
  const todayAttendance = list(data.todayAttendance);
  const deptStrength = list(data.deptStrength);
  const recentLeaves = list(data.recentLeaves);
  const recentAudit = list(data.recentAudit);
  const { today } = data;

  const attendance = [...todayAttendance].sort((a, b) => {
    const ia = ATT_ORDER.indexOf(a.status), ib = ATT_ORDER.indexOf(b.status);
    return (ia < 0 ? ATT_ORDER.length : ia) - (ib < 0 ? ATT_ORDER.length : ib);
  });

  const deptMax = deptStrength.reduce((m, d) => Math.max(m, d.c || 0), 0);
  const deptTotal = deptStrength.reduce((s, d) => s + (d.c || 0), 0);

  /* /admin/leaves is gated on leaves.view_all, but this overview opens on
   * employees.view — so the shortcut has to be hidden from anyone who would
   * only land on a 403. */
  const canSeeLeaves = hasPerm('leaves.view_all');

  const nothingYet =
    !totals.employees && !attendance.length && !deptStrength.length &&
    !recentLeaves.length && !recentAudit.length;

  if (nothingYet) {
    return (
      <div className="page">
        <PageHead eyebrow="Management" title="Overview" sub={`Company snapshot for ${fmtDay(today)}`} />
        <div className="card">
          <Empty
            icon={LayoutGrid}
            title="Nothing to summarise yet"
            body="Once employees are added, headcount, today’s attendance mix, department strength and the approval queue all report here."
            action={<Link className="btn btn--primary" href="/admin/employees">Add employees</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Management"
        title="Overview"
        sub={`Company snapshot for ${fmtDay(today)}`}
      />

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {/* ------------------------------------------------ headline counters */}
        <div className="grid grid--4">
          {TILES.map(({ key, label, icon: Icon, tone, meta }) => (
            <div className="card" key={key}>
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
                <p className="stat__val num">{totals[key] ?? 0}</p>
                <p className="stat__meta">{meta}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid--3">
          {/* -------------------------------------- attendance + departments */}
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={H2}>Today’s attendance</h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>{fmtDay(today)}</p>
              </div>
            </div>
            {attendance.length ? (
              <div className="card__body">
                <ul className="stack" role="list" style={{ gap: 'var(--s3)', listStyle: 'none', padding: 0 }}>
                  {attendance.map((row) => (
                    <li className="row row--between" key={row.status}>
                      <StatusBadge status={row.status} tone={ATT_TONE[row.status]} />
                      <span className="num" style={{ fontSize: '.875rem', fontWeight: 600 }}>{row.c ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Empty
                icon={CalendarClock}
                title="No attendance yet today"
                body="Each status with somebody in it — present, on leave, working from home — is counted here as the day is marked."
              />
            )}

            <hr className="rule" />

            <div className="card__body">
              <h2 style={{ ...H2, marginBottom: 'var(--s4)' }}>Department strength</h2>
              {deptStrength.length ? (
                <>
                  <ul className="stack" role="list" style={{ gap: 'var(--s3)', listStyle: 'none', padding: 0 }}>
                    {deptStrength.map((d) => {
                      /* Employees with no department are bucketed rather than
                       * dropped — a headcount that quietly omits people is
                       * worse than one that points at the gap. */
                      const orphan = d.name === 'Unassigned';
                      return (
                        <li key={d.name}>
                          <div className="row row--between" style={{ gap: 'var(--s3)' }}>
                            <span
                              style={{
                                fontSize: '.875rem', minWidth: 0, overflowWrap: 'anywhere',
                                color: orphan ? 'var(--warn)' : 'var(--muted)',
                                fontStyle: orphan ? 'italic' : 'normal',
                              }}
                            >
                              {d.name}
                              {orphan && (
                                <span className="faint" style={{ fontSize: '.75rem', fontStyle: 'normal' }}>
                                  {' '}(no department set)
                                </span>
                              )}
                            </span>
                            <span className="num" style={{ fontSize: '.875rem', fontWeight: 600, flex: 'none' }}>
                              {d.c ?? 0}
                            </span>
                          </div>
                          <div className="meter" style={{ marginTop: 'var(--s2)' }} aria-hidden="true">
                            <div
                              className={`meter__fill${orphan ? ' meter__fill--warn' : ''}`}
                              style={{ width: `${deptMax ? Math.round((d.c / deptMax) * 100) : 0}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div
                    className="row row--between"
                    style={{ marginTop: 'var(--s4)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--line)' }}
                  >
                    <span style={{ fontSize: '.875rem', fontWeight: 600 }}>Total</span>
                    <span className="num" style={{ fontSize: '.875rem', fontWeight: 700 }}>{deptTotal}</span>
                  </div>
                </>
              ) : (
                <Empty
                  icon={Building2}
                  title="No departments yet"
                  body="Departments created in Settings appear here with their headcount."
                />
              )}
            </div>
          </section>

          {/* -------------------------------------- recent leave -------------
           * recentLeaves is the latest leave of ANY status, not the pending
           * queue — the payload carries `status` and this card tones six of
           * them. The pending count has its own tile above. It also carries no
           * applied_at, so the card claims no ordering it cannot show. */}
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={H2}>Recent leave requests</h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>The latest requests across the company</p>
              </div>
              {canSeeLeaves && (
                <Link className="btn btn--quiet btn--sm" href="/admin/leaves">View all →</Link>
              )}
            </div>
            {recentLeaves.length ? (
              <div className="card__body">
                <ul className="stack" role="list" style={{ gap: 'var(--s3)', listStyle: 'none', padding: 0 }}>
                  {recentLeaves.map((l) => (
                    <li
                      key={l.id}
                      style={{
                        border: '1px solid var(--line)', borderRadius: 'var(--r)',
                        padding: 'var(--s3)',
                      }}
                    >
                      <div className="row row--between" style={{ gap: 'var(--s3)' }}>
                        <span className="person">
                          {/* initials() defaults only on undefined — a null
                            * name would throw inside .trim() and take the
                            * page down with it. */}
                          <span className="avatar avatar--sm">{initials(l.employee_name || '')}</span>
                          <span style={{ minWidth: 0 }}>
                            <span className="person__name" style={{ display: 'block' }}>
                              {l.employee_name || 'Unnamed employee'}
                            </span>
                            <span className="person__meta">{l.emp_code || '—'}</span>
                          </span>
                        </span>
                        <StatusBadge status={leaveLabel(l.status)} tone={LEAVE_TONE[l.status]} />
                      </div>
                      <p className="faint" style={{ fontSize: '.75rem', marginTop: 'var(--s2)' }}>
                        <span className="mono">{l.leave_code}</span>
                        {' · '}
                        <span className="mono">{fmtDate(l.from_date)} → {fmtDate(l.to_date)}</span>
                        {' '}({l.days ?? 0}d)
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Empty
                icon={ClipboardCheck}
                title="No leave requests yet"
                body="Leave applied for anywhere in the company shows up here with its dates and where it has got to."
              />
            )}
          </section>

          {/* -------------------------------------- audit feed */}
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={H2}>Recent activity</h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>From the audit log</p>
              </div>
            </div>
            {recentAudit.length ? (
              <div className="card__body">
                <ul className="stack" role="list" style={{ gap: 'var(--s4)', listStyle: 'none', padding: 0 }}>
                  {recentAudit.map((a, i) => (
                    <li
                      key={`${a.timestamp}-${a.action}-${i}`}
                      style={{ paddingLeft: 'var(--s4)', borderLeft: '2px solid var(--line)' }}
                    >
                      <p className="mono" style={{ fontSize: '.8125rem', fontWeight: 600 }}>{a.action}</p>
                      {a.details && (
                        <p className="muted" style={{ fontSize: '.75rem', marginTop: '.15rem' }}>{a.details}</p>
                      )}
                      <p className="faint" style={{ fontSize: '.6875rem', marginTop: '.25rem' }}>
                        {a.actor || 'System'} · {fmtDateTime(a.timestamp)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Empty
                icon={History}
                title="Nothing logged yet"
                body="Employee edits, approvals, exports and password resets are recorded here as they happen."
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
