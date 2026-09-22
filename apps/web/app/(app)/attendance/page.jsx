'use client';

import { useEffect, useState } from 'react';
import {
  CalendarCheck, CalendarClock, CalendarX, ChevronLeft, ChevronRight,
  Clock3, Inbox, Laptop, SunMedium,
} from 'lucide-react';
import { api, fmtDate } from '@/lib/api';
import { Empty, ErrorNote, PageHead, Skeleton } from '@/components/ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* Six counters, in the order the screen fixes them. Leave days are counted
   by none of them, so the day types deliberately do not add up to working
   days in a month that has any — the caption under the grid says so. */
const TILES = [
  { key: 'totalWorkingDays', label: 'Working days', icon: CalendarClock, tone: 'accent' },
  { key: 'presentDays', label: 'Present', icon: CalendarCheck, tone: 'ok' },
  { key: 'absentDays', label: 'Absent', icon: CalendarX, tone: 'err' },
  { key: 'halfDays', label: 'Half days', icon: SunMedium, tone: 'warn' },
  { key: 'wfhDays', label: 'WFH', icon: Laptop, tone: 'info' },
  { key: 'lateMarks', label: 'Late marks', icon: Clock3, tone: 'warn' },
];

/* Ten statuses, five status tokens. The label always carries the meaning and
   the tint only groups them, so nothing here is signalled by colour alone —
   and every cell follows the dark theme. */
const STATUS = {
  'Present':  { code: 'P',   label: 'Present',      tone: 'ok' },
  'WFH':      { code: 'W',   label: 'WFH',          tone: 'info' },
  'Half Day': { code: 'H',   label: 'Half Day',     tone: 'warn' },
  'Absent':   { code: 'A',   label: 'Absent',       tone: 'err' },
  'Leave':    { code: 'L',   label: 'Leave',        tone: 'accent' },
  'EL':       { code: 'EL',  label: 'Earned Leave', tone: 'accent' },
  'SL':       { code: 'SL',  label: 'Sick Leave',   tone: 'warn' },
  'LOP':      { code: 'LOP', label: 'Loss of Pay',  tone: 'err' },
  'Holiday':  { code: 'HO',  label: 'Holiday',      tone: 'info' },
  'Weekend':  { code: '—',   label: 'Weekend',      tone: 'neutral' },
};
/* The legend lists every status the system can produce, not just the ones
   the displayed month happens to contain. */
const LEGEND = ['Present', 'WFH', 'Half Day', 'Absent', 'Leave', 'EL', 'SL', 'LOP', 'Holiday', 'Weekend'];

/* A status the API invents later still renders, in neutral ink with its raw
   string as the label, rather than as a blank cell nobody can explain. */
const fallback = (status) => ({ code: status, label: status, tone: 'neutral' });

function tint(tone) {
  if (tone === 'neutral') return { background: 'var(--surface)', color: 'var(--faint)' };
  return {
    background: `var(--${tone}-soft)`,
    color: `var(--${tone === 'err' ? 'err-text' : tone})`,
  };
}

/* ---------------------------------------------------------------- dates */

/* Business dates arrive as plain YYYY-MM-DD strings and are taken apart into
   numbers here. Handing one to `new Date(str)` would parse it as UTC midnight
   and shift the day for anyone whose clock is not, which on this deployment
   is the server. Date.UTC on numbers is stable, and so is the day arithmetic
   below, because UTC has no daylight saving to step over. */
const pad = (n) => String(n).padStart(2, '0');

function utc(date) {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function keyOf(ms) {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/* The one place a local clock is right: which month to open on, and which
   days have not happened yet, are questions about the person reading the
   screen. Everything the answer touches is a number, never a parsed string. */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function currentCycle() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1 };
}

/* One row per date in the period the API reports, with its record merged in.
   The grid is drawn from that range rather than a hard-coded 1-to-31, so a
   25th-to-24th payroll cycle would span two months without a rewrite. */
function buildDays(data, ym) {
  const byDate = {};
  (data.records || []).forEach((r) => { byDate[r.date] = r; });

  const from = data.period?.from || `${ym.y}-${pad(ym.m)}-01`;
  const to = data.period?.to || `${ym.y}-${pad(ym.m)}-${pad(daysIn(ym.y, ym.m))}`;
  const now = today();

  const out = [];
  for (let ms = utc(from); ms <= utc(to); ms += 864e5) {
    const date = keyOf(ms);
    const w = new Date(ms).getUTCDay();
    const r = byDate[date];
    const weekend = w === 0 || w === 6;
    out.push({
      date,
      day: Number(date.slice(8)),
      dow: w,
      /* A Saturday or Sunday the API sent no record for is still a weekend —
         that is the calendar speaking, not a status HR forgot to set. */
      status: r?.status || (weekend ? 'Weekend' : null),
      checkIn: r?.check_in || null,
      checkOut: r?.check_out || null,
      late: !!r?.late_mark,
      remarks: r?.remarks || null,
      holiday: r?.holiday_name || null,
      locked: !r && !weekend && date > now,
    });
  }
  return out;
}

export default function AttendancePage() {
  const [ym, setYm] = useState(currentCycle);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  /* Below 640px a cell only has room for the short code, and the holiday name
     and the "Locked" line drop out altogether. The grid is seven columns at
     every width, so this is a content decision, not a layout one. */
  const [narrow, setNarrow] = useState(false);

  const month = `${ym.y}-${pad(ym.m)}`;

  /* Cleared before every fetch, so stepping a month drops the whole content
     area to skeletons rather than leaving last month's numbers on screen
     under the new month's name. */
  /* The API takes year and month as two separate integers, NOT a YYYY-MM
   * string: it reads them with parseInt, so `month=2026-09` arrives as month
   * 2026 and the whole response comes back describing a period that does not
   * exist. `month` below is only the effect key. */
  const load = () => {
    setError('');
    setData(null);
    api(`/attendance/me?year=${ym.y}&month=${ym.m}`)
      .then(setData)
      .catch((e) => setError(e.message));
  };
  useEffect(load, [month]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const step = (delta) => setYm(({ y, m }) => {
    const next = m + delta;
    if (next < 1) return { y: y - 1, m: 12 };
    if (next > 12) return { y: y + 1, m: 1 };
    return { y, m: next };
  });

  const monthName = `${MONTHS[ym.m - 1]} ${ym.y}`;
  const periodLabel = data?.period?.label;

  const picker = (
    <div className="row" style={{ gap: 'var(--s3)', flexWrap: 'nowrap' }}>
      <button className="btn btn--ghost btn--sm" onClick={() => step(-1)} aria-label="Previous month">
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <span style={{ minWidth: '8.5rem', textAlign: 'center' }} aria-live="polite">
        <span style={{ display: 'block', fontSize: '.875rem', fontWeight: 600 }}>{monthName}</span>
        {/* The payroll-period sub-line is drawn only when it differs from the
            month name. The grid is a plain calendar month today, so it stays
            suppressed — it is here for the 25th-to-24th cycle. */}
        {periodLabel && periodLabel !== monthName && (
          <span className="faint" style={{ display: 'block', fontSize: '.6875rem', lineHeight: 1.2 }}>
            {periodLabel}
          </span>
        )}
      </span>
      <button className="btn btn--ghost btn--sm" onClick={() => step(1)} aria-label="Next month">
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </div>
  );

  const head = (
    <PageHead
      eyebrow="Attendance & Leave"
      title="My Attendance"
      sub="Daily and monthly attendance overview"
    >
      {picker}
    </PageHead>
  );

  /* The month picker survives both of these: a month that fails to load, or
     one still in flight, is not a reason to strand someone on it. */
  if (error) {
    return (
      <div className="page">
        {head}
        <ErrorNote error={error} onRetry={load} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        {head}
        <div className="card"><Skeleton rows={4} /></div>
      </div>
    );
  }

  const summary = data.summary || {};
  const days = buildDays(data, ym);
  const leaveDays = summary.leaveDays || 0;
  /* Loss of pay is a working day too, and it is the one that costs a day's
   * pay — so it is named separately rather than folded into "leave". */
  const lopDays = summary.lopDays || 0;
  const offDays = leaveDays + lopDays;

  /* Weekends and holidays are on the calendar, not in the table — this list
     is the working-day record, in date order. A day the reader has not lived
     through yet is not a missing record, so it stays out too. */
  const rows = days.filter((c) => !c.locked && c.status !== 'Weekend' && c.status !== 'Holiday');

  const cols = {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 'clamp(.25rem, 1vw, .5rem)',
  };
  const dash = <span className="faint">—</span>;

  return (
    <div className="page">
      {head}

      <div className="stack" style={{ gap: 'var(--s5)' }}>

        {/* ------------------------------------------------ six counters */}
        <div>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))', gap: 'var(--s4)' }}
          >
            {TILES.map(({ key, label, icon: Icon, tone }) => (
              <div className="card" style={{ boxShadow: 'none' }} key={key}>
                {/* Six tiles fit two to a row on a 320px screen only if the
                    padding gives way first — otherwise the label wraps under
                    its own icon. */}
                <div className="stat" style={{ padding: 'clamp(.75rem, 3vw, 1.25rem)' }}>
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
                  <p className="stat__val">{summary[key] ?? 0}</p>
                </div>
              </div>
            ))}
          </div>
          {offDays > 0 && (
            <p className="faint" style={{ fontSize: '.75rem', marginTop: 'var(--s3)' }}>
              {leaveDays > 0 && (
                <>{leaveDays} approved leave {leaveDays === 1 ? 'day' : 'days'}</>
              )}
              {leaveDays > 0 && lopDays > 0 ? ' and ' : ''}
              {lopDays > 0 && (
                <>{lopDays} loss-of-pay {lopDays === 1 ? 'day' : 'days'}</>
              )}
              {' '}this period {offDays === 1 ? 'is' : 'are'} drawn on the calendar and listed below,
              but counted by none of these six tiles — so the day types will not add up to working
              days.
            </p>
          )}
        </div>

        {/* ------------------------------------------------ month grid */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Attendance calendar
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                {periodLabel || monthName} · {summary.totalWorkingDays ?? 0} working days ·
                night shift 19:00 – 04:00 IST
              </p>
            </div>
          </div>
          <div className="card__body">
            <div style={{ ...cols, marginBottom: 'var(--s2)' }}>
              {DOW.map((d) => (
                <p className="eyebrow eyebrow--plain" style={{ justifyContent: 'center', fontSize: 9 }} key={d}>
                  {d}
                </p>
              ))}
            </div>

            <div style={cols}>
              {/* Leading blanks so the first date lands under its own weekday. */}
              {Array.from({ length: days[0]?.dow || 0 }, (_, i) => (
                <div aria-hidden="true" key={`pad-${i}`} />
              ))}

              {days.map((c) => {
                const st = c.status ? (STATUS[c.status] || fallback(c.status)) : null;
                const box = {
                  minHeight: 'clamp(3.25rem, 6.5vw, 4rem)',
                  padding: 'clamp(.25rem, 1.5vw, .5rem)',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--line)',
                  overflow: 'hidden',
                  ...(st
                    ? tint(st.tone)
                    : c.locked
                      ? { background: 'var(--bg)', color: 'var(--faint)', opacity: .8 }
                      : { background: 'var(--raised)', color: 'var(--muted)' }),
                };
                const tip = c.holiday || (st ? st.label : c.locked
                  ? 'Future date (locked)'
                  : 'Punches recorded, not yet marked by HR');

                return (
                  <div style={box} key={c.date} title={`${fmtDate(c.date)} · ${tip}`}>
                    <p className="mono" style={{ fontSize: '.6875rem', fontWeight: 700, lineHeight: 1.3 }}>
                      {c.day}
                      {/* A month tag on the 1st, so a period spanning two
                          calendar months never reads as one long month. */}
                      {c.day === 1 && (
                        <span style={{ fontWeight: 600, opacity: .7 }}>
                          {' '}{MONTHS[Number(c.date.slice(5, 7)) - 1].slice(0, 3)}
                        </span>
                      )}
                    </p>

                    {st && (
                      <p style={{ fontSize: '.75rem', fontWeight: 500, marginTop: '.1rem' }}>
                        {narrow ? st.code : st.label}
                      </p>
                    )}
                    {!st && c.locked && !narrow && (
                      <p style={{ fontSize: '.6875rem', fontStyle: 'italic', marginTop: '.1rem' }}>Locked</p>
                    )}
                    {!st && !c.locked && (
                      <p style={{ fontSize: '.75rem', fontWeight: 500, marginTop: '.1rem' }}>
                        {narrow ? '—' : 'Not marked'}
                      </p>
                    )}

                    {c.holiday && !narrow && (
                      <p style={{
                        fontSize: '.625rem', opacity: .85,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {c.holiday}
                      </p>
                    )}
                    {c.checkIn && (
                      <p className="mono" style={{
                        fontSize: '.625rem', opacity: .85,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {c.checkIn}{c.checkOut && c.checkOut !== c.checkIn ? ` – ${c.checkOut}` : ''}
                      </p>
                    )}
                    {c.late && (
                      <p style={{ fontSize: '.625rem', color: 'var(--err-text)' }}>Late</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ---------------------------------------------- legend */}
            <div className="row row--wrap" style={{ gap: 'var(--s2)', marginTop: 'var(--s5)' }}>
              {LEGEND.map((k) => {
                const s = STATUS[k];
                return (
                  <span className="chip" style={{ ...tint(s.tone), borderColor: 'var(--line)' }} key={k}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 7, height: 7, borderRadius: 'var(--r-full)',
                        background: 'currentColor', flex: 'none',
                      }}
                    />
                    {s.label}
                  </span>
                );
              })}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ day by day */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                Day by day
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Working days only — weekends and holidays stay on the calendar
              </p>
            </div>
            {rows.length > 0 && (
              <span className="faint mono" style={{ fontSize: '.75rem' }}>
                {rows.length} {rows.length === 1 ? 'record' : 'records'}
              </span>
            )}
          </div>
          {rows.length ? (
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <caption className="sr">
                    Day by day attendance for {periodLabel || monthName}. The shift starts at 19:00 IST
                    and ends at 04:00, so the exit time on a row is a punch-out that lands on the
                    following calendar date.
                  </caption>
                  <thead>
                    <tr>
                      <th>Date</th><th>Status</th><th>Entry time</th><th>Exit time</th><th>Late</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.date}>
                        <td className="mono" style={{ fontWeight: 600 }}>{fmtDate(c.date)}</td>
                        <td>
                          {c.status || dash}
                          {/* HR's note on the day, when there is one — it explains
                              a status far better than the status does. */}
                          {c.remarks && (
                            <span className="faint" style={{ display: 'block', fontSize: '.75rem' }}>
                              {c.remarks}
                            </span>
                          )}
                        </td>
                        <td className="mono">{c.checkIn || dash}</td>
                        <td className="mono">{c.checkOut || dash}</td>
                        <td>
                          {c.late
                            ? <span style={{ color: 'var(--err-text)', fontWeight: 600 }}>Yes</span>
                            : <span className="muted">No</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="faint" style={{ fontSize: '.75rem', padding: 'var(--s4) var(--s5)' }}>
                The shift runs 19:00 – 04:00 IST. Entry and exit sit on the same row because they are
                one shift — the exit time is a punch-out on the <b>following</b> calendar date.
              </p>
            </div>
          ) : (
            <Empty
              icon={Inbox}
              title="Nothing recorded for this month"
              body="Each shift lands here the morning after it closes, once the biometric reader syncs. Future days stay locked until then."
            />
          )}
        </section>

      </div>
    </div>
  );
}
