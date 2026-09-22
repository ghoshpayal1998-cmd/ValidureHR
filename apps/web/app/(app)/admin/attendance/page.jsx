'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, Clock,
  Download, Fingerprint, Inbox, Laptop, Pencil, Search, Users, X,
} from 'lucide-react';
import { api, fmtDate, fmtDay, getUser, hasPerm, initials, openProtectedFile } from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, useToast,
} from '@/components/ui';

/*
 * The API's own vocabulary, not a prettier one. PUT /attendance/:empId/:date
 * accepts exactly these ten and answers anything else with "Invalid status";
 * POST /attendance/bulk accepts the same list minus Weekend. LOP/SL/EL are
 * stored as codes, so the code is always the VALUE and the spelled-out name
 * is only ever the label.
 */
const EDIT_STATUSES = ['Present', 'Absent', 'Half Day', 'WFH', 'Leave', 'Holiday', 'Weekend', 'LOP', 'SL', 'EL'];
const BULK_STATUSES = ['Present', 'Absent', 'Half Day', 'WFH', 'Leave', 'Holiday', 'LOP', 'SL', 'EL'];

const NAMES = { LOP: 'Loss of Pay', SL: 'Sick Leave', EL: 'Earned Leave' };
const label = (s) => NAMES[s] || s;

/*
 * Ten statuses against a six-hue token set: each hue is shared by two
 * statuses and told apart by a solid vs dashed border — and the full name is
 * printed in every cell, pill and badge, so nothing here rests on colour.
 */
const ST = {
  'Present': { bg: 'var(--ok-soft)', fg: 'var(--ok)', line: 'solid' },
  'WFH': { bg: 'var(--accent-soft)', fg: 'var(--accent-strong)', line: 'solid' },
  'Half Day': { bg: 'var(--warn-soft)', fg: 'var(--warn)', line: 'solid' },
  'Absent': { bg: 'var(--err-soft)', fg: 'var(--err-text)', line: 'solid' },
  'Leave': { bg: 'var(--info-soft)', fg: 'var(--info)', line: 'solid' },
  'Earned Leave': { bg: 'var(--info-soft)', fg: 'var(--info)', line: 'dashed' },
  'Sick Leave': { bg: 'var(--warn-soft)', fg: 'var(--warn)', line: 'dashed' },
  'Loss of Pay': { bg: 'var(--err-soft)', fg: 'var(--err-text)', line: 'dashed' },
  'Holiday': { bg: 'var(--accent-soft)', fg: 'var(--accent-strong)', line: 'dashed' },
  'Weekend': { bg: 'var(--surface)', fg: 'var(--faint)', line: 'solid' },
  'Not marked': { bg: 'var(--surface)', fg: 'var(--muted)', line: 'dashed' },
};
const LEGEND = ['Present', 'WFH', 'Half Day', 'Absent', 'Leave', 'Earned Leave',
                'Sick Leave', 'Loss of Pay', 'Holiday', 'Weekend', 'Not marked'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TILES = [
  { key: 'totalWorkingDays', label: 'Working days', meta: 'excl. weekends & holidays', icon: CalendarClock, bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  { key: 'presentDays', label: 'Present', meta: 'full shifts logged', icon: Check, bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  { key: 'absentDays', label: 'Absent', meta: 'no punch, no leave', icon: X, bg: 'var(--err-soft)', fg: 'var(--err-text)' },
  { key: 'halfDays', label: 'Half days', meta: 'part shift worked', icon: Clock, bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  { key: 'wfhDays', label: 'WFH', meta: 'worked off site', icon: Laptop, bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  { key: 'lateMarks', label: 'Late marks', meta: 'in after shift start', icon: AlertTriangle, bg: 'var(--warn-soft)', fg: 'var(--warn)' },
];

/* ---------------------------------------------------------------- dates */

/*
 * Every date on this screen is a plain YYYY-MM-DD string. Weekday and month
 * length come off UTC getters built from the string's PARTS — never
 * new Date('2026-09-01'), which the contract forbids for exactly the reason
 * it bites here: the server clock is not IST and the day slides.
 */
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function weekday(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(date, n) {
  const [y, m, d] = String(date).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/* The BROWSER's clock, and only after mount — see the boot effect. */
function todayIso() {
  const now = new Date();
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* One badge for every status, wherever a status is printed. */
function Status({ status }) {
  const s = ST[status] || ST['Not marked'];
  return (
    <span className="badge" style={{ background: s.bg, color: s.fg, border: `1px ${s.line} currentColor` }}>
      {status}
    </span>
  );
}

function statusOptions(list) {
  return list.map((s) => <option value={s} key={s}>{label(s)}</option>);
}

export default function AdminAttendancePage() {
  const toast = useToast();

  /* session facts live in state: getUser()/hasPerm() read localStorage, which
   * is empty during the server render and would disagree with it. */
  const [session, setSession] = useState(null);
  const [today, setToday] = useState('');

  const [roster, setRoster] = useState(null);
  const [rosterError, setRosterError] = useState('');

  const [empId, setEmpId] = useState('');
  const [year, setYear] = useState(0);
  const [month, setMonth] = useState(0);
  const [monthData, setMonthData] = useState(null);
  const [monthError, setMonthError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [day, setDay] = useState('');
  const [dayData, setDayData] = useState(null);
  const [dayError, setDayError] = useState('');

  const [devices, setDevices] = useState(null);
  const [deviceNote, setDeviceNote] = useState('');
  const [savingMachine, setSavingMachine] = useState('');
  const [unlinking, setUnlinking] = useState(null);

  /* the edit dialog: one employee, one date */
  const [editing, setEditing] = useState(null);
  const [editBusy, setEditBusy] = useState(false);

  /* the bulk dialog: the whole active roster, one date */
  const [bulkDate, setBulkDate] = useState('');
  const [bulkRows, setBulkRows] = useState(null);
  const [bulkError, setBulkError] = useState('');
  const [bulkLocked, setBulkLocked] = useState(null);
  const [bulkHoliday, setBulkHoliday] = useState('');
  const [bulkQuery, setBulkQuery] = useState('');
  const [bulkDept, setBulkDept] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  const canManage = !!session?.canManage;

  /* ------------------------------------------------ loaders */

  const loadRoster = useCallback(() => {
    setRosterError('');
    api('/employees')
      .then((list) => {
        const sorted = [...list].sort((a, b) => (a.emp_code < b.emp_code ? -1 : 1));
        setRoster(sorted);
        setEmpId((cur) => cur || (sorted[0] ? String(sorted[0].id) : ''));
      })
      .catch((e) => setRosterError(e.message));
  }, []);

  useEffect(() => {
    const t = todayIso();
    const [y, m] = t.split('-').map(Number);
    setToday(t);
    setDay(t);
    setYear(y);
    setMonth(m);
    setSession({
      user: getUser(),
      canManage: hasPerm('attendance.manage'),
      canExport: hasPerm('attendance.export'),
    });
    loadRoster();
  }, [loadRoster]);

  /*
   * The month grid is per employee. /attendance/overview is the DAY view —
   * one date across everybody — whatever query string it is handed, so the
   * calendar and the tiles come from /attendance/employee/:id instead, whose
   * response is the shape recorded for /attendance/me.
   */
  const loadMonth = useCallback(() => {
    if (!empId || !year) return;
    setMonthError('');
    setMonthData(null);
    api(`/attendance/employee/${empId}?year=${year}&month=${month}`)
      .then(setMonthData)
      .catch((e) => setMonthError(e.message));
  }, [empId, year, month]);
  useEffect(loadMonth, [loadMonth]);

  const loadDay = useCallback(() => {
    if (!day) return;
    setDayError('');
    setDayData(null);
    api(`/attendance/overview?date=${day}`)
      .then(setDayData)
      .catch((e) => setDayError(e.message));
  }, [day]);
  useEffect(loadDay, [loadDay]);

  /*
   * Device mapping is a platform-admin preview and 404s for a company without
   * biometric attendance — which is most of them. It is asked for only when
   * the caller is a platform admin, and a refusal becomes a one-line note
   * rather than an error that takes the screen down with it.
   */
  const loadDevices = useCallback(() => {
    if (!session?.user?.admin) return;
    setDeviceNote('');
    api('/attendance/device-map')
      .then((rows) => setDevices(Array.isArray(rows) ? rows : []))
      .catch((e) => { setDevices(null); setDeviceNote(e.message); });
  }, [session]);
  useEffect(loadDevices, [loadDevices]);

  /* ------------------------------------------------ month + export */

  function stepMonth(n) {
    const i = year * 12 + (month - 1) + n;
    setYear(Math.floor(i / 12));
    setMonth((i % 12) + 1);
  }

  async function exportCsv() {
    setExporting(true);
    try {
      /* Behind the auth header, so it cannot be a plain href. */
      await openProtectedFile(
        `/attendance/export?year=${year}&month=${month}`,
        true,
        `attendance-${year}-${pad(month)}.csv`,
      );
      toast('Attendance CSV downloaded', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setExporting(false);
    }
  }

  /* ------------------------------------------------ single edit */

  function openEdit(row) {
    setEditing({
      employee_id: row.employee_id,
      emp_code: row.emp_code,
      name: row.name,
      department: row.department,
      date: day,
      status: EDIT_STATUSES.includes(row.status) ? row.status : 'Present',
      late_mark: !!row.late_mark,
    });
  }

  function closeEdit() {
    if (editBusy) return;
    setEditing(null);
  }

  async function saveEdit() {
    setEditBusy(true);
    try {
      const res = await api(`/attendance/${editing.employee_id}/${editing.date}`, {
        method: 'PUT',
        body: { status: editing.status, late_mark: editing.late_mark },
      });
      toast(res?.message || 'Attendance updated', 'ok');
      setEditing(null);
      loadDay();
      loadMonth();
    } catch (e) {
      /* leave the dialog open with the chosen status still in it */
      toast(e.message, 'err');
    } finally {
      setEditBusy(false);
    }
  }

  /* ------------------------------------------------ bulk day */

  const openBulk = useCallback((date) => {
    setBulkDate(date);
    setBulkRows(null);
    setBulkError('');
    setBulkQuery('');
    setBulkDept('');
    setAskDiscard(false);
    api(`/attendance/overview?date=${date}`)
      .then((data) => {
        const locked = data.holiday_name
          ? 'Holiday'
          : (weekday(date) === 0 || weekday(date) === 6) ? 'Weekend' : null;
        setBulkLocked(locked);
        setBulkHoliday(data.holiday_name || '');
        const rows = (data.rows || []).map((r) => {
          /* An unmarked working day starts at Present — the baseline HR is
           * confirming. But it is not an unchanged Present: nothing is stored
           * yet, and writing it is the whole point of this dialog, so the
           * row has to remember that there was no record. */
          const stored = BULK_STATUSES.includes(r.status) ? r.status : null;
          const start = locked || stored || 'Present';
          return {
            employee_id: r.employee_id,
            emp_code: r.emp_code,
            name: r.name,
            dept: r.department || 'Unassigned',
            existed: !!stored,
            was: start,
            now: start,
          };
        });
        rows.sort((a, b) => (a.dept !== b.dept
          ? (a.dept < b.dept ? -1 : 1)
          : (a.emp_code < b.emp_code ? -1 : 1)));
        setBulkRows(rows);
      })
      .catch((e) => setBulkError(e.message));
  }, []);

  const bulkDepts = useMemo(() => {
    const seen = [];
    (bulkRows || []).forEach((r) => { if (!seen.includes(r.dept)) seen.push(r.dept); });
    return seen;
  }, [bulkRows]);

  const bulkVisible = useMemo(() => {
    const q = bulkQuery.trim().toLowerCase();
    const seen = {};
    return (bulkRows || [])
      .filter((r) => {
        if (bulkDept && r.dept !== bulkDept) return false;
        if (!q) return true;
        return r.name.toLowerCase().includes(q) || r.emp_code.toLowerCase().includes(q);
      })
      .map((r) => {
        const first = !seen[r.dept];
        seen[r.dept] = true;
        return { ...r, first };
      });
  }, [bulkRows, bulkQuery, bulkDept]);

  /* Two different questions, and collapsing them into one made Save All
   * impossible on exactly the day this dialog exists for. A day nobody has
   * marked returns status null on every row, which the dialog shows as
   * Present — so "differs from what is on screen" is false for all of them
   * while nothing at all is stored. Mark All Present then set Present over
   * Present, and the save button stayed disabled at (0). */

  /* What the user has altered — drives the discard prompt and the row tint. */
  const bulkTouched = useMemo(
    () => (bulkLocked ? [] : (bulkRows || []).filter((r) => r.now !== r.was)),
    [bulkRows, bulkLocked],
  );

  /* What has to be written — every row with no stored record, plus every
   * stored row the user changed. */
  const bulkDirty = useMemo(
    () => (bulkLocked ? [] : (bulkRows || []).filter((r) => !r.existed || r.now !== r.was)),
    [bulkRows, bulkLocked],
  );

  function setRowStatus(employeeId, status) {
    setBulkRows((rows) => rows.map((r) => (r.employee_id === employeeId ? { ...r, now: status } : r)));
  }

  function markAllPresent() {
    const ids = new Set(bulkVisible.map((r) => r.employee_id));
    setBulkRows((rows) => rows.map((r) => (ids.has(r.employee_id) ? { ...r, now: 'Present' } : r)));
    toast(`${plural(ids.size, 'visible row')} set to Present`, 'ok');
  }

  function requestCloseBulk() {
    if (bulkBusy) return;
    /* Only ask about work the user actually did. An untouched unrecorded day
     * is pending a write, but closing it discards nothing they typed. */
    if (bulkTouched.length) { setAskDiscard(true); return; }
    closeBulk();
  }

  function closeBulk() {
    setBulkDate('');
    setBulkRows(null);
    setBulkLocked(null);
    setBulkHoliday('');
    setAskDiscard(false);
  }

  async function saveBulk() {
    setBulkBusy(true);
    try {
      const res = await api('/attendance/bulk', {
        method: 'POST',
        body: {
          date: bulkDate,
          /* only the rows that changed — the server writes every entry it is
           * sent, so an unchanged row would be a pointless overwrite */
          entries: bulkDirty.map((r) => ({ employee_id: r.employee_id, status: r.now })),
        },
      });
      toast(
        `${res?.message || 'Bulk attendance saved'} (${plural(res?.count ?? bulkDirty.length, 'employee')})`,
        'ok',
      );
      closeBulk();
      loadDay();
      loadMonth();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBulkBusy(false);
    }
  }

  /* ------------------------------------------------ device mapping */

  async function saveMapping(machineId, value) {
    setSavingMachine(machineId);
    try {
      const res = await api(`/attendance/device-map/${encodeURIComponent(machineId)}`, {
        method: 'PUT',
        body: { employee_id: value ? Number(value) : null },
      });
      toast(res?.message || 'Mapping saved', 'ok');
      setUnlinking(null);
      loadDevices();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setSavingMachine('');
    }
  }

  /* ------------------------------------------------ page states */

  if (rosterError) {
    return <div className="page"><ErrorNote error={rosterError} onRetry={loadRoster} /></div>;
  }

  if (!roster) {
    return (
      <div className="page">
        <PageHead eyebrow="Management" title="Attendance Management" />
        <div className="card"><Skeleton rows={4} /></div>
      </div>
    );
  }

  const emp = roster.find((e) => String(e.id) === empId);
  const empName = emp ? `${emp.first_name} ${emp.last_name}` : '';
  const summary = monthData?.summary;

  /* The window the API handed back, drawn day by day. The grid is a calendar
   * month, so records for unmarked working days are simply absent. */
  const cells = [];
  if (monthData?.period) {
    const byDate = Object.fromEntries((monthData.records || []).map((r) => [r.date, r]));
    for (let d = monthData.period.from; d <= monthData.period.to; d = addDays(d, 1)) {
      cells.push({ date: d, rec: byDate[d] || null });
    }
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Management"
        title="Attendance Management"
        sub="View, edit, regularise and export employee attendance"
      >
        {session?.canExport && (
          <button className="btn btn--ghost" onClick={exportCsv} disabled={exporting || !year}>
            <Download size={16} aria-hidden="true" />
            {exporting ? 'Exporting…' : `Export CSV (${month}/${year})`}
          </button>
        )}
      </PageHead>

      {roster.length === 0 ? (
        /* ------------------------------------------------ nobody to show —
           the roster is empty, so there is no month and no day to draw */
        <section className="card">
          <Empty
            icon={Users}
            title="No employees on the roster yet"
            body="Add employees first: each one then appears in this picker with a month calendar, and in the day overview with that day's status."
          />
        </section>
      ) : (
        <div className="stack" style={{ gap: 'var(--s5)' }}>

          {/* ------------------------------------------------ employee + month */}
          <section className="card">
            <div className="card__body">
              <div className="row row--wrap" style={{ gap: 'var(--s6)', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
                  <Field id="emp" label="Employee">
                    <select
                      id="emp"
                      className="select"
                      value={empId}
                      onChange={(e) => setEmpId(e.target.value)}
                    >
                      {roster.map((e) => (
                        <option value={String(e.id)} key={e.id}>
                          {e.emp_code} — {e.first_name} {e.last_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="field" style={{ flex: 'none' }}>
                  <span className="label" id="monthlbl">Month</span>
                  <div className="row" role="group" aria-labelledby="monthlbl" style={{ gap: 'var(--s2)' }}>
                    <button className="btn btn--ghost btn--sm" onClick={() => stepMonth(-1)} aria-label="Previous month">
                      <ChevronLeft size={15} aria-hidden="true" />
                    </button>
                    <span
                      className="mono"
                      aria-live="polite"
                      style={{ minWidth: '8.5rem', textAlign: 'center', fontSize: '.875rem', fontWeight: 600 }}
                    >
                      {month ? `${MONTHS[month - 1]} ${year}` : '—'}
                    </span>
                    <button className="btn btn--ghost btn--sm" onClick={() => stepMonth(1)} aria-label="Next month">
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <span className="spacer" />

                <p className="faint" style={{ fontSize: '.75rem', maxWidth: '26ch' }}>
                  The calendar shows the calendar month. The CSV export follows the payroll
                  cycle, so its dates will not match.
                </p>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------ month summary */}
          {monthError ? (
            <ErrorNote error={monthError} onRetry={loadMonth} />
          ) : (
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: 'var(--s4)' }}
            >
              {TILES.map(({ key, label: text, meta, icon: Icon, bg, fg }) => (
                <div className="card" style={{ boxShadow: 'none' }} key={key}>
                  <div className="stat">
                    <div className="row row--between">
                      <span className="stat__label">{text}</span>
                      <span className="stat__icon" style={{ width: '1.75rem', height: '1.75rem', background: bg, color: fg }}>
                        <Icon size={14} aria-hidden="true" />
                      </span>
                    </div>
                    {summary
                      ? <p className="stat__val num">{summary[key] ?? 0}</p>
                      : <div className="skel" style={{ height: '2rem', marginTop: 'var(--s1)' }} />}
                    <p className="stat__meta">{meta}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {summary && (
            <p className="faint" style={{ fontSize: '.75rem', marginTop: 'calc(var(--s3) * -1)' }}>
              {plural(summary.leaveDays ?? 0, 'day')} of approved leave this month. Leave, LOP,
              SL and EL have no tile of their own, so the six numbers above do not add up to
              working days once leave is taken.
            </p>
          )}

          {/* ------------------------------------------------ month calendar */}
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                  {emp ? `Calendar — ${empName} (${emp.emp_code})` : 'Calendar'}
                </h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>
                  {canManage
                    ? 'Click any past day to bulk-mark attendance for every employee on that date.'
                    : 'Read only — marking attendance needs the attendance.manage permission.'}
                  {' '}Shift 19:00 – 04:00 IST, so a punch-out after midnight belongs to the day it started.
                </p>
              </div>
              {monthData?.period && <span className="chip">{monthData.period.label}</span>}
            </div>
            <div className="card__body">
              {monthError ? (
                <ErrorNote error={monthError} onRetry={loadMonth} />
              ) : !monthData ? (
                <div className="skel" style={{ height: '22rem' }} />
              ) : (
                <>
                  <div
                    style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 'var(--s2)', marginBottom: 'var(--s2)' }}
                  >
                    {DOW.map((d) => (
                      <p className="eyebrow eyebrow--plain" style={{ justifyContent: 'center', fontSize: 10 }} key={d}>{d}</p>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 'var(--s2)' }}>
                    {Array.from({ length: cells.length ? weekday(cells[0].date) : 0 }, (_, i) => (
                      <div key={`pad-${i}`} />
                    ))}
                    {cells.map(({ date, rec }) => {
                      const future = !!today && date > today;
                      const name = rec?.status ? label(rec.status) : null;
                      const tone = future
                        ? { bg: 'var(--bg)', fg: 'var(--faint)', line: 'dashed', bd: 'var(--line)' }
                        : name
                          ? { bg: ST[name]?.bg || ST['Not marked'].bg, fg: ST[name]?.fg || ST['Not marked'].fg, line: ST[name]?.line || 'solid', bd: 'currentColor' }
                          : { bg: 'var(--raised)', fg: 'var(--muted)', line: 'solid', bd: 'var(--line-strong)' };
                      const dnum = Number(date.slice(8));
                      const mnum = Number(date.slice(5, 7));
                      const title = rec?.holiday_name || (future ? 'Future date (locked)' : name || 'Not marked');
                      const clickable = canManage && !future;

                      return (
                        <button
                          type="button"
                          key={date}
                          disabled={!clickable}
                          title={title}
                          onClick={() => openBulk(date)}
                          aria-label={`${fmtDay(date)} — ${title}${clickable ? '. Bulk-mark attendance for this date' : ''}`}
                          style={{
                            display: 'grid', alignContent: 'start', gap: 1, textAlign: 'left',
                            minHeight: '4.5rem', padding: 'var(--s2)', overflow: 'hidden',
                            borderRadius: 'var(--r-sm)',
                            border: `1px ${tone.line} ${tone.bd}`,
                            background: tone.bg,
                            color: tone.fg,
                            cursor: clickable ? 'pointer' : 'default',
                            opacity: future ? .85 : 1,
                          }}
                        >
                          <span
                            className="mono"
                            style={{ fontSize: '.75rem', fontWeight: 700, color: future ? 'var(--faint)' : 'var(--fg)' }}
                          >
                            {dnum}
                            {dnum === 1 && <span className="faint" style={{ fontWeight: 400 }}> {SHORT[mnum - 1]}</span>}
                          </span>

                          {future ? (
                            <span style={{ fontSize: '.6875rem', fontStyle: 'italic' }}>Locked</span>
                          ) : name ? (
                            <span style={{ fontSize: '.6875rem', fontWeight: 600 }}>{name}</span>
                          ) : (
                            <span className="faint" style={{ fontSize: '.6875rem' }}>Not marked</span>
                          )}

                          {rec?.holiday_name && (
                            <span className="faint" style={{ fontSize: '.625rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {rec.holiday_name}
                            </span>
                          )}
                          {rec?.check_in && (
                            <span className="mono" style={{ fontSize: '.625rem', opacity: .85 }}>
                              {rec.check_in}{rec.check_out && rec.check_out !== rec.check_in ? ` – ${rec.check_out}` : ''}
                            </span>
                          )}
                          {rec?.late_mark && (
                            <span style={{ fontSize: '.625rem', color: 'var(--err-text)', fontWeight: 600 }}>Late</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="row row--wrap" style={{ gap: 'var(--s2)', marginTop: 'var(--s5)' }}>
                    {LEGEND.map((k) => <Status status={k} key={k} />)}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ------------------------------------------------ one date, everybody */}
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                  Day Overview — {fmtDate(day)}
                </h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>
                  Every active employee&rsquo;s state for a single shift date.
                  {dayData?.holiday_name && ` Company holiday: ${dayData.holiday_name}.`}
                </p>
              </div>
              <div style={{ flex: 'none' }}>
                <Field id="day-date" label="Date">
                  <input
                    id="day-date"
                    className="input"
                    type="date"
                    value={day}
                    max={today || undefined}
                    style={{ width: 'auto' }}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      if (today && v > today) { toast('Cannot mark attendance for a future date', 'err'); return; }
                      setDay(v);
                    }}
                  />
                </Field>
              </div>
            </div>

            {dayError ? (
              <div className="card__body"><ErrorNote error={dayError} onRetry={loadDay} /></div>
            ) : !dayData ? (
              <Skeleton rows={5} />
            ) : !dayData.rows?.length ? (
              <Empty
                icon={Users}
                title="Nobody on the roster for this date"
                body="Active employees appear here with the status stored for the day, and with the company holiday or weekend applied automatically when nothing was marked."
              />
            ) : (
              <div className="card__body card__body--flush">
                <div className="tablewrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Name</th>
                        <th>Department</th>
                        <th>Status</th>
                        <th>Entry Time</th>
                        <th>Exit Time</th>
                        <th>Late</th>
                        {canManage && <th className="num"><span className="sr">Actions</span></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {dayData.rows.map((r) => (
                        <tr key={r.employee_id}>
                          <td className="mono" style={{ fontWeight: 600 }}>{r.emp_code}</td>
                          <td>
                            <span className="person">
                              <span className="avatar avatar--sm">{initials(r.name)}</span>
                              <span className="person__name">{r.name}</span>
                            </span>
                          </td>
                          <td className="muted">{r.department || '—'}</td>
                          <td><Status status={r.status ? label(r.status) : 'Not marked'} /></td>
                          {/* the stored time, else the biometric device's, else nothing */}
                          <td className="mono">{r.check_in || r.device_check_in || '—'}</td>
                          <td className="mono">{r.check_out || r.device_check_out || '—'}</td>
                          <td>
                            {r.late_mark
                              ? <span className="badge badge--err">Yes</span>
                              : <span className="faint">—</span>}
                          </td>
                          {canManage && (
                            <td className="num">
                              <button
                                className="iconbtn"
                                onClick={() => openEdit(r)}
                                aria-label={`Edit attendance for ${r.name} on ${fmtDate(day)}`}
                              >
                                <Pencil size={16} aria-hidden="true" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ------------------------------------------------ biometric device mapping.
              Platform admins only, and it 404s for a company without biometric
              attendance — so this whole card is allowed to say nothing useful
              without taking the rest of the screen with it. */}
          {session?.user?.admin && (
            <section className="card">
              <div className="card__head">
                <div>
                  <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                    Device Mapping — biometric machine → employee
                  </h2>
                  <p className="faint" style={{ fontSize: '.75rem', maxWidth: '62ch' }}>
                    Names come from the device itself. Punches from unmapped machines are held
                    back — never stored under the wrong person — and delivered on the sync after
                    you map them.
                  </p>
                </div>
                <span className="badge badge--info">Platform admin only</span>
              </div>

              {deviceNote ? (
                <div className="card__body">
                  <p className="row" style={{ gap: 'var(--s3)', fontSize: '.875rem', color: 'var(--muted)' }}>
                    <Fingerprint size={16} aria-hidden="true" style={{ flex: 'none', color: 'var(--faint)' }} />
                    <span>Device mapping is unavailable here — {deviceNote}.</span>
                  </p>
                </div>
              ) : !devices ? (
                <Skeleton rows={3} />
              ) : !devices.length ? (
                <Empty
                  icon={Inbox}
                  title="No device roster yet"
                  body="The machine list appears here after the first sync from a biometric reader."
                />
              ) : (
                <>
                  <div className="card__body card__body--flush">
                    <div className="tablewrap">
                      <table className="table">
                        <thead>
                          <tr><th>Machine ID</th><th>Name on Device</th><th>Mapped Employee</th></tr>
                        </thead>
                        <tbody>
                          {devices.map((m) => (
                            <tr key={m.machine_id}>
                              <td className="mono" style={{ fontWeight: 600 }}>{m.machine_id}</td>
                              <td className="mono">{m.device_name || '—'}</td>
                              <td>
                                <label className="sr" htmlFor={`map-${m.machine_id}`}>
                                  Mapped employee for machine {m.machine_id}
                                </label>
                                <select
                                  id={`map-${m.machine_id}`}
                                  className="select"
                                  style={{ width: 'auto', minWidth: '13rem', height: '2rem', minHeight: '2rem', fontSize: '.8125rem' }}
                                  value={m.employee_id ? String(m.employee_id) : ''}
                                  disabled={savingMachine === m.machine_id}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    /* unlinking strands the machine's punches, so it is named
                                       and confirmed; linking saves straight away */
                                    if (!v && m.employee_id) {
                                      setUnlinking({ machine_id: m.machine_id, employee_name: m.employee_name, emp_code: m.emp_code });
                                      return;
                                    }
                                    saveMapping(m.machine_id, v);
                                  }}
                                >
                                  <option value="">— not mapped —</option>
                                  {roster.map((e) => (
                                    <option value={String(e.id)} key={e.id}>
                                      {e.emp_code} — {e.first_name} {e.last_name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="card__foot">
                    <p className="faint" style={{ fontSize: '.75rem' }}>
                      {(() => {
                        const mapped = new Set(devices.map((m) => m.employee_id).filter(Boolean));
                        const loose = roster.filter((e) => !mapped.has(e.id));
                        return loose.length
                          ? `Employees with no device link: ${loose.map((e) => `${e.first_name} ${e.last_name} (${e.emp_code})`).join(', ')}`
                          : 'Every employee is linked to a machine.';
                      })()}
                    </p>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      )}

      {/* ------------------------------------------------ edit one day */}
      {editing && (
        <Modal
          title={`Edit Attendance — ${fmtDate(editing.date)}`}
          sub={`${editing.name} · ${editing.emp_code} · ${editing.department || 'Unassigned'}`}
          onClose={closeEdit}
          footer={
            /* the buttons wrap rather than run off a 320px footer */
            <div className="row row--wrap" style={{ gap: 'var(--s3)', justifyContent: 'flex-end', width: '100%' }}>
              <button className="btn btn--ghost" onClick={closeEdit} disabled={editBusy}>Cancel</button>
              <button className="btn btn--primary" onClick={saveEdit} disabled={editBusy}>
                {editBusy ? 'Saving…' : 'Save / Regularize'}
              </button>
            </div>
          }
        >
          <div className="stack">
            <Field
              id="edit-status"
              label="Status"
              required
              help="Saving stamps the record with the remark “Regularized”. LOP is loss of pay, SL sick leave, EL earned leave."
            >
              <select
                id="edit-status"
                className="select"
                value={editing.status}
                disabled={editBusy}
                aria-describedby="edit-status-help"
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
              >
                {statusOptions(EDIT_STATUSES)}
              </select>
            </Field>

            <label className="checkline" htmlFor="edit-late">
              <input
                id="edit-late"
                type="checkbox"
                checked={editing.late_mark}
                disabled={editBusy}
                onChange={(e) => setEditing({ ...editing, late_mark: e.target.checked })}
              />
              <span>
                Late mark
                <span className="help" style={{ display: 'block' }}>
                  The shift starts at 19:00 IST; a punch after the grace window counts as late.
                </span>
              </span>
            </label>
          </div>
        </Modal>
      )}

      {/* ------------------------------------------------ bulk-mark one date.
          The discard confirmation replaces this dialog rather than stacking on
          top of it — two focus traps on one screen fight over the keyboard. */}
      {bulkDate && !askDiscard && (
        <Modal
          wide
          title={`Bulk Attendance — ${fmtDate(bulkDate)}`}
          sub={`${DOW[weekday(bulkDate)]}, ${fmtDay(bulkDate)}${bulkLocked ? ` · ${bulkHoliday || 'weekend'} — every row is locked` : ''}`}
          onClose={requestCloseBulk}
          footer={
            /* the buttons wrap rather than run off a 320px footer, so the
               running count of pending edits sits under the table instead */
            <div className="row row--wrap" style={{ gap: 'var(--s3)', justifyContent: 'flex-end', width: '100%' }}>
              <button className="btn btn--ghost" onClick={requestCloseBulk} disabled={bulkBusy}>Cancel</button>
              <button
                className="btn btn--primary"
                onClick={saveBulk}
                disabled={bulkBusy || !bulkDirty.length}
              >
                {bulkBusy ? 'Saving…' : `Save All (${bulkDirty.length})`}
              </button>
            </div>
          }
        >
          {bulkError ? (
            <ErrorNote error={bulkError} onRetry={() => openBulk(bulkDate)} />
          ) : !bulkRows ? (
            <Skeleton rows={4} />
          ) : !bulkRows.length ? (
            <Empty
              icon={Users}
              title="No active employees on this date"
              body="The roster for the chosen day comes back empty, so there is nothing to mark."
            />
          ) : (
            <>
              <div className="row row--wrap" style={{ gap: 'var(--s3)', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 13rem', minWidth: 0 }}>
                  <Field id="bulk-search" label="Search employee">
                    <span className="search">
                      <Search size={16} aria-hidden="true" />
                      <input
                        id="bulk-search"
                        className="input"
                        type="search"
                        autoComplete="off"
                        placeholder="Name or code…"
                        value={bulkQuery}
                        onChange={(e) => setBulkQuery(e.target.value)}
                      />
                    </span>
                  </Field>
                </div>
                <div style={{ flex: '1 1 11rem', minWidth: 0 }}>
                  <Field id="bulk-dept" label="Department">
                    <select
                      id="bulk-dept"
                      className="select"
                      value={bulkDept}
                      onChange={(e) => setBulkDept(e.target.value)}
                    >
                      <option value="">All Departments</option>
                      {bulkDepts.map((d) => <option value={d} key={d}>{d}</option>)}
                    </select>
                  </Field>
                </div>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={markAllPresent}
                  disabled={bulkBusy || !!bulkLocked || !bulkVisible.length}
                >
                  <Check size={14} aria-hidden="true" />
                  Mark All Present
                </button>
              </div>

              <div className="row row--wrap" style={{ gap: 'var(--s4)', fontSize: '.75rem' }}>
                <span className="faint row" style={{ gap: 'var(--s2)' }}>
                  <Users size={14} aria-hidden="true" />
                  <span>Showing <b>{bulkVisible.length}</b> of {bulkRows.length} employees</span>
                </span>
                {bulkDirty.length > 0 && (
                  <span style={{ color: 'var(--warn)', fontWeight: 600 }}>
                    {plural(bulkDirty.length, 'change')} pending
                  </span>
                )}
              </div>

              <div style={{ maxHeight: '50vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
                <div className="tablewrap">
                  <table className="table">
                    <thead>
                      <tr><th>Code</th><th>Employee Name</th><th>Department</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {bulkVisible.map((r) => {
                        const dirty = !bulkLocked && r.now !== r.was;
                        return (
                          <tr
                            key={r.employee_id}
                            style={{ background: dirty ? 'var(--warn-soft)' : undefined, opacity: bulkLocked ? .6 : 1 }}
                          >
                            <td className="mono" style={{ fontWeight: 600, fontSize: '.8125rem' }}>{r.emp_code}</td>
                            <td>{r.name}</td>
                            <td>
                              {/* each department group opens with a chip and carries on
                                  in plain text, so the grouping reads without a header row */}
                              {r.first
                                ? <span className="chip">{r.dept}</span>
                                : <span className="faint" style={{ fontSize: '.75rem' }}>{r.dept}</span>}
                            </td>
                            <td>
                              {bulkLocked ? (
                                <Status status={bulkLocked} />
                              ) : (
                                <>
                                  <label className="sr" htmlFor={`bulk-${r.employee_id}`}>
                                    Status for {r.name}
                                  </label>
                                  <select
                                    id={`bulk-${r.employee_id}`}
                                    className="select"
                                    value={r.now}
                                    disabled={bulkBusy}
                                    style={{
                                      width: 'auto', minWidth: '8.5rem', height: '2rem',
                                      minHeight: '2rem', fontSize: '.8125rem',
                                      borderColor: dirty ? 'var(--warn)' : undefined,
                                      boxShadow: dirty ? '0 0 0 2px var(--warn-soft)' : undefined,
                                    }}
                                    onChange={(e) => setRowStatus(r.employee_id, e.target.value)}
                                  >
                                    {statusOptions(BULK_STATUSES)}
                                  </select>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!bulkVisible.length && (
                  <Empty
                    icon={Search}
                    title="No employees match the current filter"
                    body="Clear the search box or pick All Departments to bring the roster back."
                  />
                )}
              </div>

              <p className="faint" style={{ fontSize: '.75rem' }}>
                {bulkLocked
                  ? `Nothing can be changed on a ${(bulkHoliday ? 'holiday' : 'weekend')} — every row is locked and none of them is sent.`
                  : bulkDirty.length
                    ? `${plural(bulkDirty.length, 'change')} will be saved. Rows you did not touch are not sent.`
                    : 'No changes made yet. Only the rows you change are sent.'}
              </p>
            </>
          )}
        </Modal>
      )}

      {bulkDate && askDiscard && (
        <ConfirmModal
          danger
          title="Discard unsaved attendance?"
          body={`${plural(bulkDirty.length, 'change')} to ${fmtDay(bulkDate)} has not been saved. Closing now throws it away — nothing is written to the attendance record.`}
          confirmLabel="Discard edits"
          onConfirm={closeBulk}
          onClose={() => setAskDiscard(false)}
        />
      )}

      {unlinking && (
        <ConfirmModal
          danger
          title="Unlink this machine?"
          body={`Machine ${unlinking.machine_id} is mapped to ${unlinking.employee_name || 'an employee'}${unlinking.emp_code ? ` (${unlinking.emp_code})` : ''}. Unlinking it holds every punch from that machine back until it is mapped again.`}
          confirmLabel="Unlink machine"
          busy={savingMachine === unlinking.machine_id}
          onConfirm={() => saveMapping(unlinking.machine_id, '')}
          onClose={() => { if (!savingMachine) setUnlinking(null); }}
        />
      )}
    </div>
  );
}
