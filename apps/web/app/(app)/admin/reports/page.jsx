'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Download, Scale } from 'lucide-react';
import { api, fmtDay, hasPerm, initials, openProtectedFile } from '@/lib/api';
import { Empty, ErrorNote, PageHead, Skeleton, useToast } from '@/components/ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

const H2 = { fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 };

/* The six counters the attendance summary reports, in the order this screen
   fixes them, under the field names the API actually sends. Only three carry
   a tint and the column label always carries the meaning, so nothing here is
   signalled by colour alone. */
const COUNTS = [
  { key: 'present', label: 'Present', tone: 'ok' },
  { key: 'wfh', label: 'WFH' },
  { key: 'half_days', label: 'Half Days' },
  { key: 'absent', label: 'Absent', tone: 'err-text' },
  { key: 'leave', label: 'Leave', tone: 'accent' },
  { key: 'late_marks', label: 'Late Marks' },
];

/* ---------------------------------------------------------------- dates */

const pad = (n) => String(n).padStart(2, '0');

/* The one question a local clock is right about: which month to open on is a
   question about the person reading the screen. It is answered in numbers,
   never by parsing a date string. */
function currentCycle() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1 };
}

/* `period.from` / `period.to` are only worth printing when they really are
   business dates. The capture in docs/api-shapes.md shows this route
   answering `2026-2025-25` when the month reaches it mis-parsed, and fmtDay
   would dutifully render that as "25 undefined 2026". Anything that is not a
   real YYYY-MM-DD is dropped rather than dressed up. */
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function cycleLabel(period) {
  if (!period || !DAY.test(String(period.from)) || !DAY.test(String(period.to))) return '';
  return `${fmtDay(period.from, false)} – ${fmtDay(period.to)}`;
}

/* ---------------------------------------------------------------- shape */

/* Two decimals at most, trailing zeros dropped: 6, 13.5, 6.75 — never 6.00.
   Accrual is a fraction of a day a month, so these columns are the one place
   on the screen where a number is not a whole one. */
function n2(value) {
  const v = Number(value);
  if (value === null || value === undefined || value === '' || Number.isNaN(v)) return '—';
  return String(Math.round(v * 100) / 100);
}

/* The leave summary widens with the tenant: apart from the two fixed fields,
   every key on a row is a leave-type code carrying { accrued, used, balance }.
   Codes arrive in leave_types order and first-seen order is kept, so the
   columns do not reshuffle because one employee is missing a balance row. */
function leaveCodes(rows) {
  const out = [];
  rows.forEach((r) => Object.keys(r).forEach((k) => {
    if (k === 'emp_code' || k === 'name') return;
    if (r[k] && typeof r[k] === 'object' && !out.includes(k)) out.push(k);
  }));
  return out;
}

/* The footer totals are summed from the rows on screen, never sent by the
   server — so they cannot disagree with the column above them. */
function totalsOf(rows) {
  const t = {};
  COUNTS.forEach(({ key }) => {
    t[key] = rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0);
  });
  return t;
}

const plural = (n) => `${n} ${n === 1 ? 'employee' : 'employees'}`;

/* ---------------------------------------------------------------- screen */

export default function AdminReportsPage() {
  const toast = useToast();
  /* The export is a separate permission from reading the reports: someone can
     hold reports.view and still not be allowed the raw sheet, so the button is
     absent rather than present and answering 403. */
  const canExport = hasPerm('attendance.export');

  const [ym, setYm] = useState(currentCycle);
  const [att, setAtt] = useState(null);
  const [attErr, setAttErr] = useState('');
  const [leave, setLeave] = useState(null);
  const [leaveErr, setLeaveErr] = useState('');
  const [exporting, setExporting] = useState(false);

  const month = `${ym.y}-${pad(ym.m)}`;
  const monthName = `${MONTHS[ym.m - 1]} ${ym.y}`;

  /*
   * The year and the month go over as separate integers because that is what
   * the route parses. Handing it `?month=2026-09` is what produced the
   * nonsense period recorded in docs/api-shapes.md — parseInt stops at the
   * hyphen, the month becomes 2026, and the payroll cycle comes back as
   * `2026-2025-25`. The response shape is the same either way; only these
   * two numbers decide whether its contents mean anything.
   *
   * Cleared before every fetch, so stepping a month drops the table to
   * skeletons rather than leaving August's totals under September's name.
   */
  const loadAtt = () => {
    setAttErr('');
    setAtt(null);
    api(`/admin/reports/attendance-summary?year=${ym.y}&month=${ym.m}`)
      .then(setAtt)
      .catch((e) => setAttErr(e.message));
  };
  useEffect(loadAtt, [month]);

  /* Balances are a leave-year figure, not a monthly one, and the route takes
     no month at all — so this card loads once and the arrows leave it alone.
     Re-fetching it on every arrow press would only redraw the same numbers. */
  const loadLeave = () => {
    setLeaveErr('');
    setLeave(null);
    api('/admin/reports/leave-summary').then(setLeave).catch((e) => setLeaveErr(e.message));
  };
  useEffect(loadLeave, []);

  const step = (delta) => setYm(({ y, m }) => {
    const next = m + delta;
    if (next < 1) return { y: y - 1, m: 12 };
    if (next > 12) return { y: y + 1, m: 1 };
    return { y, m: next };
  });

  /*
   * One click, no dropdown and no confirmation. The sheet sits behind the
   * bearer token, so a plain href 404s — it goes through openProtectedFile,
   * which attaches the header and hands the browser a blob to save. It is a
   * read, not a mutation: nothing on this screen changes as a result, so it
   * reports either way and stops, rather than flashing both tables back to
   * skeletons to re-fetch numbers that cannot have moved.
   */
  async function exportCsv() {
    const file = `attendance-${month}.csv`;
    setExporting(true);
    try {
      await openProtectedFile(`/attendance/export?year=${ym.y}&month=${ym.m}`, true, file);
      toast(`Saved ${file}`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setExporting(false);
    }
  }

  const head = (
    <PageHead
      eyebrow="Management"
      title="Reports"
      sub="Attendance and leave utilization summaries"
    >
      {/* Wraps inside the head's own row, so at 320px the export button drops
          under the navigator instead of widening the page. */}
      <div className="row row--wrap" style={{ gap: 'var(--s3)', justifyContent: 'flex-end' }}>
        <div className="row" style={{ gap: 'var(--s2)', flexWrap: 'nowrap' }}>
          <button className="iconbtn" onClick={() => step(-1)} aria-label="Previous month">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span
            className="mono"
            aria-live="polite"
            style={{ minWidth: '9.5rem', textAlign: 'center', fontSize: '.875rem', fontWeight: 600 }}
          >
            {monthName}
          </span>
          <button className="iconbtn" onClick={() => step(1)} aria-label="Next month">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        {canExport && (
          <button className="btn btn--ghost" onClick={exportCsv} disabled={exporting}>
            <Download size={16} aria-hidden="true" />
            {exporting ? 'Exporting…' : 'Export Attendance CSV'}
          </button>
        )}
      </div>
    </PageHead>
  );

  /* Both reports failing at once is the session, the permission or the network
     talking — not one card. That reads as one page-level failure with one
     retry. A single card that fails keeps the other one on screen and carries
     its own error and its own retry inside its own body. */
  if (attErr && leaveErr) {
    return (
      <div className="page">
        {head}
        <ErrorNote error={attErr} onRetry={() => { loadAtt(); loadLeave(); }} />
      </div>
    );
  }

  const attRows = att?.rows || [];
  const leaveRows = leave?.rows || [];
  const codes = leaveCodes(leaveRows);
  const totals = totalsOf(attRows);
  const cycle = cycleLabel(att?.period);

  return (
    <div className="page">
      {head}

      <div className="stack" style={{ gap: 'var(--s5)' }}>

        {/* ------------------------------------------------ attendance summary */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={H2}>Monthly Attendance Summary</h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                {cycle ? `Payroll cycle ${cycle}` : `The payroll cycle for ${monthName}`}
              </p>
            </div>
            {att && <span className="chip mono" aria-live="polite">{plural(attRows.length)}</span>}
          </div>

          {attErr ? (
            <div className="card__body"><ErrorNote error={attErr} onRetry={loadAtt} /></div>
          ) : !att ? (
            <Skeleton rows={6} />
          ) : attRows.length ? (
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Code</th>
                      <th scope="col">Name</th>
                      <th scope="col">Department</th>
                      {COUNTS.map(({ key, label }) => (
                        <th className="num" scope="col" key={key}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {attRows.map((r) => (
                      <tr key={r.emp_code}>
                        <td className="mono" style={{ fontWeight: 600 }}>{r.emp_code}</td>
                        <td>
                          <span className="person">
                            <span className="avatar avatar--sm">{initials(r.name)}</span>
                            <span className="person__name">{r.name}</span>
                          </span>
                        </td>
                        {/* An employee with no department is an em-dash, not a
                            blank cell somebody has to interpret. */}
                        <td className="muted">
                          {r.department || <span className="faint">—</span>}
                        </td>
                        {COUNTS.map(({ key, tone }) => {
                          const v = Number(r[key]) || 0;
                          return (
                            <td
                              className="num"
                              key={key}
                              style={v && tone ? { color: `var(--${tone})`, fontWeight: 600 } : undefined}
                            >
                              {v ? v : <span className="faint">0</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={3} style={{ textAlign: 'left' }}>
                        Total · {plural(attRows.length)}
                      </th>
                      {COUNTS.map(({ key }) => (
                        <td className="num mono" key={key}>{totals[key]}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <Empty
              icon={CalendarClock}
              title={`Nothing recorded for ${monthName}`}
              body="Every active employee's present, WFH, half, absent and leave days for this payroll cycle appear here once attendance is recorded against it."
            />
          )}

          <div className="card__foot">
            <p className="help">
              Counts follow the payroll cycle{cycle ? ` — ${cycle}` : ''} rather than the calendar
              month, so they match the attendance calendar and the exported sheet. Days after today
              are not yet recorded.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------ leave utilisation */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={H2}>Leave Utilization — used / accrued (balance)</h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Accrued to date · balances are a leave-year figure, so the month navigator
                does not change them
              </p>
            </div>
            {leave && <span className="chip mono">{plural(leaveRows.length)}</span>}
          </div>

          {leaveErr ? (
            <div className="card__body"><ErrorNote error={leaveErr} onRetry={loadLeave} /></div>
          ) : !leave ? (
            <Skeleton rows={6} />
          ) : leaveRows.length ? (
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Code</th>
                      <th scope="col">Name</th>
                      {/* One column per leave-type code the tenant actually
                          has — nothing here is a fixed CL/EL/SL list. */}
                      {codes.map((code) => (
                        <th className="num" scope="col" key={code}>{code}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leaveRows.map((r) => (
                      <tr key={r.emp_code}>
                        <td className="mono" style={{ fontWeight: 600 }}>{r.emp_code}</td>
                        <td>
                          <span className="person">
                            <span className="avatar avatar--sm">{initials(r.name)}</span>
                            <span className="person__name">{r.name}</span>
                          </span>
                        </td>
                        {codes.map((code) => {
                          const b = r[code];
                          /* No balance row for that type at all — an em-dash,
                             which is a different fact from a balance of zero. */
                          if (!b) return <td className="num faint" key={code}>—</td>;
                          const negative = Number(b.balance) < 0;
                          return (
                            <td className="num" key={code}>
                              <span className="mono">
                                <span style={{ fontWeight: 600 }}>{n2(b.used)}</span> / {n2(b.accrued)}
                              </span>
                              <span
                                className="mono"
                                style={{
                                  display: 'block',
                                  fontSize: 11,
                                  color: negative ? 'var(--err-text)' : 'var(--accent-strong)',
                                }}
                              >
                                bal {n2(b.balance)}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <Empty
              icon={Scale}
              title="No employees yet"
              body="Every active employee is listed here with their used, accrued and remaining days for each leave type."
            />
          )}

          <div className="card__foot">
            <p className="help">
              Each cell reads used / accrued, with the remaining balance underneath. Accrued
              figures are pro-rated to the completed months of the leave year, Loss of Pay does not
              accrue — so an LOP day reads as a negative balance — and an em-dash means no balance
              row exists for that leave type.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
