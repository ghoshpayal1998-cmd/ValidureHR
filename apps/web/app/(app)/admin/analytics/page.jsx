'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  CalendarRange,
  Download,
  LineChart,
  Lock,
  PartyPopper,
  Layers,
} from 'lucide-react';
import { api, hasPerm, openProtectedFile } from '@/lib/api';
import { Empty, ErrorNote, PageHead, Skeleton, StatusBadge, useToast } from '@/components/ui';

const H2 = { fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 };

/* Counts arrive as numbers but SUM() on a numeric column comes back from the
 * driver as a string, so every figure the charts measure goes through one
 * coercion before anything is divided by it. */
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const raw = (v) => String(Math.round(num(v) * 100) / 100);   /* 6.50 → "6.5" */

/* A month here is "2026-04" — not a full date, so fmtDay would hand the raw
 * string back. The labels are built the same way fmtDay builds its own: by
 * taking the string apart, never by parsing it into a Date. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthName(ym) {
  const [y, m] = String(ym).split('-');
  return MONTHS[+m - 1] ? `${MONTHS[+m - 1]} ${y}` : String(ym);
}

/* The x axis has six labels in the width of a card, so it gets the short form. */
function monthAxis(ym) {
  const [y, m] = String(ym).split('-');
  return y && m ? `${m}/${y.slice(2)}` : String(ym);
}

/* A department name can run to "Infrastructure & IT Support"; the label column
 * is fixed, so it is clipped on screen and carried in full in a <title> the
 * browser shows on hover. */
const clip = (s, n = 15) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/* The badge strip always reads in the same order whatever order the GROUP BY
 * hands back, so the eye lands in the same place every day. Anything the
 * server invents beyond this list still renders, at the end. */
const LEAVE_ORDER = ['Approved', 'Pending', 'Manager Approved', 'HR Approved', 'Rejected', 'Cancelled'];

/* StatusBadge already tones Approved / Pending / Rejected. The two mid-flight
 * approval states it has never seen need saying out loud. */
/* The badge label carries the count ("Approved: 41"), and StatusBadge keys its
 * own tone map off the whole status string — so a tone has to be named here
 * for EVERY status, not only the mid-flight approval states. Otherwise the
 * three that matter most all render as the same neutral grey. */
const LEAVE_TONE = {
  Approved: 'ok',
  'Manager Approved': 'info',
  'HR Approved': 'info',
  Pending: 'warn',
  Rejected: 'err',
  Cancelled: 'neutral',
};

/* A 403 from this route is a role fact, not a fault: HR simply does not carry
 * analytics.view. It reads as its own state rather than as a red error card. */
const isDenied = (msg) => /missing permission|forbidden|not allowed/i.test(String(msg));

/* ------------------------------------------------------------------ charts */

/*
 * One horizontal bar chart, hand-drawn. No chart library: a viewBox that
 * scales with the card, every fill from a token, a value axis under the
 * tracks, and each number printed beside its own bar so bar length is never
 * the only thing carrying the figure.
 */
function BarChart({ rows, tone, unit, label }) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const W = 360, ROW = 26, LABEL_W = 108, VALUE_W = 40;
  const trackX = LABEL_W + 10;
  const trackW = W - trackX - VALUE_W - 2;
  const axisY = rows.length * ROW + 5;
  const H = axisY + 18;

  const aria = `${label}. ${rows.map((r) => `${r.name}: ${raw(r.value)}`).join(', ')}.`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={aria}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      <title>{label}</title>
      {rows.map((r, i) => {
        const cy = i * ROW + ROW / 2;
        /* A type with nothing against it still gets a visible stub, so an
         * empty row reads as "zero" rather than as a missing row. */
        const w = Math.max(4, Math.round((r.value / max) * trackW));
        return (
          <g key={r.key}>
            <text x="0" y={cy + 4} fontSize="12" fill="var(--muted)">
              <title>{r.name}</title>
              {clip(r.name)}
            </text>
            <rect x={trackX} y={cy - 7} width={trackW} height="14" rx="7" fill="var(--surface)" />
            <rect x={trackX} y={cy - 7} width={w} height="14" rx="7" fill={`var(--${tone})`} />
            <text x={W} y={cy + 4} textAnchor="end" fontSize="12" fontWeight="600" fill="var(--fg)">
              {raw(r.value)}
            </text>
          </g>
        );
      })}
      <line x1={trackX} x2={trackX + trackW} y1={axisY} y2={axisY} stroke="var(--line)" strokeWidth="1" />
      <text x={trackX} y={axisY + 13} fontSize="10" fill="var(--faint)">0</text>
      <text x={trackX + trackW} y={axisY + 13} textAnchor="end" fontSize="10" fill="var(--faint)">
        {raw(max)} {unit}
      </text>
    </svg>
  );
}

/*
 * The six-month trend, as columns off a zero baseline. The y axis is pinned
 * to 0–100% rather than to the data, so a good month and a bad one are the
 * same height every time the page loads.
 */
function TrendChart({ trend }) {
  const W = 360, H = 190;
  const PAD = { l: 32, r: 8, t: 20, b: 28 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const base = PAD.t + plotH;
  const slot = plotW / trend.length;
  const barW = Math.min(36, slot * 0.56);

  const aria = `Attendance rate by month, ${monthName(trend[0].month)} to ${monthName(trend[trend.length - 1].month)}. `
    + trend.map((t) => `${monthName(t.month)} ${t.rate} percent`).join(', ') + '.';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={aria}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      <title>Attendance rate over the last six payroll cycles</title>

      {[0, 50, 100].map((tick) => {
        const y = base - (tick / 100) * plotH;
        return (
          <g key={tick}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="var(--line)" strokeWidth="1" />
            <text x={PAD.l - 6} y={y + 3.5} textAnchor="end" fontSize="10" fill="var(--faint)">{tick}%</text>
          </g>
        );
      })}
      <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} stroke="var(--line-strong)" strokeWidth="1" />

      {trend.map((t, i) => {
        /* A 0% month still draws a sliver, so a flat cycle is visibly a
         * reading of zero and not a column that failed to render. */
        const h = Math.max(2, (t.rate / 100) * plotH);
        const x = PAD.l + i * slot + (slot - barW) / 2;
        const y = base - h;
        return (
          <g key={t.month}>
            <rect x={x} y={y} width={barW} height={h} rx={Math.min(3, h / 2)} fill="var(--accent)" />
            <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--fg)">
              {t.rate}%
            </text>
            <text x={x + barW / 2} y={base + 14} textAnchor="middle" fontSize="10" fill="var(--faint)">
              {monthAxis(t.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------- page */

export default function AdminAnalyticsPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = () => {
    setError('');
    setDenied(false);
    setCanExport(hasPerm('attendance.export'));

    /* Asked and refused is a worse first impression than never asked: the
     * permission is checked here too, so a role without it lands on the
     * explanation instead of on a 403. */
    if (!hasPerm('analytics.view')) { setDenied(true); return; }

    api('/admin/analytics')
      .then(setData)
      .catch((e) => (isDenied(e.message) ? setDenied(true) : setError(e.message)));
  };
  useEffect(load, []);

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (denied) {
    return (
      <div className="page">
        <PageHead eyebrow="Management" title="Analytics" />
        <div className="card">
          <Empty
            icon={Lock}
            title="You do not have access to analytics"
            body="Company-wide analytics needs the analytics.view permission, which sits with the Owner and Director roles. HR does not carry it. Ask an owner to grant it if this view is part of your job."
            action={<Link className="btn btn--ghost" href="/admin">Back to overview</Link>}
          />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <PageHead eyebrow="Management" title="Analytics" />
        <div className="card"><Skeleton rows={4} /></div>
      </div>
    );
  }

  const {
    attendanceTrend = [], leaveByType = [], deptHeadcount = [],
    lateTop = [], leaveStatusSplit = [],
  } = data;

  /* Rates are clamped before they are drawn: a column taller than the plot
   * would paint over the value label above it. */
  /* `working` is the month's denominator. A month where nothing was ever
   * marked has none, and drawing it as 0% reads as total absence rather than
   * as no data — so those months are dropped from the chart instead. A real
   * all-absent month still has working > 0 and is still drawn. */
  const trend = attendanceTrend
    .filter((t) => num(t.working) > 0)
    .map((t) => ({
      month: t.month,
      rate: Math.max(0, Math.min(100, Math.round(num(t.rate)))),
    }));
  const trendMonthsDropped = attendanceTrend.length - trend.length;

  const leaveRows = leaveByType.map((l) => ({
    key: l.code || l.name,
    name: l.name,
    value: num(l.days),
    applications: num(l.applications),
  }));

  /* The query already orders by headcount descending; sorting again keeps the
   * chart honest if that ever changes server-side. */
  const deptRows = [...deptHeadcount]
    .map((d) => ({ key: d.name, name: d.name, value: num(d.c), unassigned: !!d.unassigned }))
    .sort((a, b) => b.value - a.value);
  /* Everyone active is counted, but "Unassigned" is a bucket, not a team — so
   * the headcount includes it and the department count does not. */
  const deptPeople = deptRows.reduce((t, d) => t + d.value, 0);
  const deptCount = deptRows.filter((d) => !d.unassigned).length;

  const statuses = [...leaveStatusSplit].sort((a, b) => {
    const ia = LEAVE_ORDER.indexOf(a.status), ib = LEAVE_ORDER.indexOf(b.status);
    return (ia < 0 ? LEAVE_ORDER.length : ia) - (ib < 0 ? LEAVE_ORDER.length : ib);
  });

  /* The trend is built server-side counting back from the server's own month,
   * so its last point names the current cycle. The download is filed under
   * that rather than under whatever month the browser's clock thinks it is. */
  const currentMonth = trend.length ? trend[trend.length - 1].month : '';
  const exportName = `attendance${currentMonth ? `-${currentMonth}` : ''}.csv`;

  const nothingYet =
    !trend.length && !leaveRows.length && !deptRows.length &&
    !lateTop.length && !statuses.length;

  async function downloadReport() {
    setExporting(true);
    try {
      /* The CSV sits behind auth, so a plain href would 404 — it is fetched
       * with the token attached and handed to the browser as a blob. The
       * month is left off the query on purpose: the server defaults to the
       * running cycle, which is the one this page is reporting on. */
      await openProtectedFile('/attendance/export', true, exportName);
      toast('Attendance report downloaded', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setExporting(false);
    }
  }

  if (nothingYet) {
    return (
      <div className="page">
        <PageHead
          eyebrow="Management"
          title="Analytics"
          sub="Company-wide trends across attendance and leave"
        />
        <div className="card">
          <Empty
            icon={LineChart}
            title="Nothing to chart yet"
            body="Once attendance is being marked and leave is being applied for, the six-month attendance trend, leave by type, headcount by department and this cycle’s late marks all report here."
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
        title="Analytics"
        sub="Company-wide trends across attendance and leave"
      >
        {canExport && (
          <button className="btn btn--ghost" onClick={downloadReport} disabled={exporting}>
            <Download size={16} aria-hidden="true" />
            {exporting ? 'Preparing…' : 'Download Attendance Report (this month)'}
          </button>
        )}
      </PageHead>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        {/* ------------------------------------------------ attendance trend */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={H2}>Attendance Rate — last 6 months</h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Oldest to newest, left to right
              </p>
            </div>
          </div>
          {trend.length ? (
            <div className="card__body">
              <TrendChart trend={trend} />

              {/* The chart shrinks with the card; the figures do not. Every
                  rate is repeated here at a readable size. */}
              <div className="row row--wrap" style={{ gap: 'var(--s5)', marginTop: 'var(--s4)' }}>
                {trend.map((t) => (
                  <div key={t.month}>
                    <p className="faint" style={{ fontSize: '.6875rem' }}>{monthName(t.month)}</p>
                    <p className="num" style={{ fontSize: '.9375rem', fontWeight: 600 }}>{t.rate}%</p>
                  </div>
                ))}
              </div>

              <p className="faint" style={{ fontSize: '.75rem', marginTop: 'var(--s4)' }}>
                Present + WFH (half days count 0.5) as a share of working days. The scale runs
                0–100%. Each point covers that month’s payroll cycle, not the calendar month —
                a cycle is named for the month it ends in.
                {trendMonthsDropped > 0 && (
                  <>
                    {' '}{trendMonthsDropped} earlier{' '}
                    {trendMonthsDropped === 1 ? 'cycle has' : 'cycles have'} no attendance marked at
                    all and {trendMonthsDropped === 1 ? 'is' : 'are'} left out rather than drawn as
                    0%.
                  </>
                )}
              </p>
            </div>
          ) : (
            <Empty
              icon={CalendarRange}
              title="No attendance history yet"
              body="Once a full cycle has been marked, its attendance rate joins the trend here."
            />
          )}
        </section>

        {/* ------------------------------------------------ leave by type */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={H2}>Approved Leave by Type (days)</h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Approved days only, in the order the leave types were created
              </p>
            </div>
          </div>
          {leaveRows.length ? (
            <div className="card__body">
              <BarChart
                rows={leaveRows}
                tone="accent"
                unit="days"
                label="Approved leave days by leave type"
              />

              <p className="faint" style={{ fontSize: '.75rem', marginTop: 'var(--s3)' }}>
                {leaveRows.reduce((s, l) => s + l.applications, 0)} approved applications across
                {' '}{leaveRows.length} leave types. Types with nothing approved against them still
                appear, with a stub bar and a zero.
              </p>

              {statuses.length > 0 && (
                <>
                  <hr className="rule" style={{ margin: 'var(--s5) 0 var(--s4)' }} />
                  <h3 className="stat__label" style={{ marginBottom: 'var(--s3)' }}>
                    Every leave application, by status
                  </h3>
                  <div className="row row--wrap" style={{ gap: 'var(--s2)' }}>
                    {statuses.map((s) => (
                      <StatusBadge
                        key={s.status}
                        status={`${s.status}: ${s.c}`}
                        tone={LEAVE_TONE[s.status] || undefined}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <Empty
              icon={Layers}
              title="No leave types configured"
              body="Leave types created in Settings appear here with the approved days booked against each one."
            />
          )}
        </section>

        {/* ------------------------------------------------ headcount */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={H2}>Headcount by Department</h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Active employees only, largest first
              </p>
            </div>
          </div>
          {deptRows.length ? (
            <div className="card__body">
              <BarChart
                rows={deptRows}
                tone="ok"
                unit="people"
                label="Active headcount by department"
              />
              <p className="faint" style={{ fontSize: '.75rem', marginTop: 'var(--s3)' }}>
                {deptPeople} active employees across {deptCount}
                {' '}{deptCount === 1 ? 'department' : 'departments'}. A department with nobody in it
                still appears, so an empty team is visible rather than missing
                {deptRows.some((d) => d.unassigned)
                  ? ', and anyone without a department is counted under Unassigned'
                  : ''}.
              </p>
            </div>
          ) : (
            <Empty
              icon={Building2}
              title="No departments yet"
              body="Departments created in Settings appear here with their active headcount."
            />
          )}
        </section>

        {/* ------------------------------------------------ late marks */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={H2}>Late Marks — this month</h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Top five in the running payroll cycle
              </p>
            </div>
          </div>
          {lateTop.length ? (
            <div className="card__body">
              <ul className="stack" style={{ gap: 'var(--s3)', listStyle: 'none' }}>
                {lateTop.map((e) => (
                  <li className="row row--between" style={{ gap: 'var(--s3)' }} key={e.emp_code}>
                    <span style={{ fontSize: '.875rem', minWidth: 0, overflowWrap: 'anywhere' }}>
                      {e.name}{' '}
                      <span className="faint">({e.emp_code})</span>
                    </span>
                    <StatusBadge status={`${num(e.late_marks)} late`} tone="warn" />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty
              icon={PartyPopper}
              title="No late marks recorded this month"
              body="Anyone picking up a late mark in the running cycle is listed here, worst first, so it can be raised while the cycle is still open."
            />
          )}
        </section>
      </div>
    </div>
  );
}
