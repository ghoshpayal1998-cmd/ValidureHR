'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Pencil, Save, Search, Users } from 'lucide-react';
import {
  api, fmtDay, hasPerm, initials, money, openProtectedFile,
} from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, useToast,
} from '@/components/ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

/*
 * The cycle to open on is a business date, and neither clock available here is
 * the one payroll runs against: the server sits ahead of UTC and the browser is
 * wherever the HR user happens to be. Taking "now" as text in Asia/Kolkata and
 * splitting it keeps the run off the wrong month at the turn of one.
 */
function nowIST() {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
    .format(new Date())
    .split('-');
  return { year: Number(y), month: Number(m) };
}

const pad = (n) => String(n).padStart(2, '0');

/* The sheet pays the four fixed earnings; the deduction heads are shown
 * separately on the structures tab and never folded into gross. */
const grossOf = (s) =>
  Number(s.basic || 0) + Number(s.hra || 0) + Number(s.special_allowance || 0) + Number(s.conveyance || 0);

const NO_DAYS = { lop_days: 0, el_days: 0, sl_days: 0, wfh_days: 0 };

/* A zero reads as a plain figure; anything above zero is the reason someone is
 * looking at this row, so it carries weight and a tone as well as the number.
 * The number itself is always there — the colour only seconds it. */
function Days({ value, tone }) {
  const n = Number(value || 0);
  if (!n) return <span className="num">0</span>;
  return <span className="num" style={{ color: `var(--${tone})`, fontWeight: 600 }}>{n}</span>;
}

/* An unsaved structure comes back as 0 across the board, and a box reading 0 is
 * indistinguishable from one somebody deliberately set to zero. The three
 * earnings blank out so a new joiner's form is visibly unfilled; the statutory
 * heads keep their 0, because zero PF is a real answer. */
const earn = (v) => (Number(v || 0) === 0 ? '' : String(v));
const stat = (v) => String(Number(v || 0));

function toForm(s) {
  return {
    basic: earn(s.basic),
    hra: earn(s.hra),
    special_allowance: earn(s.special_allowance),
    conveyance: stat(s.conveyance),
    pf_deduction: stat(s.pf_deduction),
    esic_deduction: stat(s.esic_deduction),
    tax_deduction: stat(s.tax_deduction),
    pan_no: s.pan_no || '',
    bank_name: s.bank_name || '',
    bank_account_no: s.bank_account_no || '',
    bank_ifsc: s.bank_ifsc || '',
  };
}

export default function AdminPayrollPage() {
  const toast = useToast();
  const canManage = hasPerm('documents.manage');
  const start = nowIST();

  const [tab, setTab] = useState('run');

  const [structures, setStructures] = useState(null);
  const [error, setError] = useState('');

  const [month, setMonth] = useState(start.month);
  const [year, setYear] = useState(start.year);
  const [yearText, setYearText] = useState(String(start.year));

  const [cycle, setCycle] = useState(null);
  const [cycleError, setCycleError] = useState('');
  const [loadingCycle, setLoadingCycle] = useState(true);

  const [term, setTerm] = useState('');

  const [editing, setEditing] = useState(null);   // { id, employee, values }
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);

  /*
   * The structures list is the roster for both tabs: it is the only call that
   * carries names, so the cycle's day counts — which arrive keyed by
   * employee_id and nothing else — are read through it.
   */
  const load = () => {
    setError('');
    api('/payroll/structures').then(setStructures).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const loadCycle = () => {
    setCycleError('');
    /* Cleared before the fetch, not just on failure. Keeping the old cycle on
     * screen meant the period label — and the export confirmation that quotes
     * it — went on naming the month the user had just navigated away from. */
    setCycle(null);
    setLoadingCycle(true);
    api(`/payroll/lop/${year}/${month}`)
      .then(setCycle)
      .catch((e) => { setCycle(null); setCycleError(e.message); })
      .finally(() => setLoadingCycle(false));
  };
  useEffect(loadCycle, [year, month]);

  /* A part-typed year ("20", "202") is not a cycle anyone wants fetched, so the
   * input settles for 300ms and only a four-digit year moves the run. */
  useEffect(() => {
    const t = setTimeout(() => {
      if (/^\d{4}$/.test(yearText.trim())) setYear(Number(yearText.trim()));
    }, 300);
    return () => clearTimeout(t);
  }, [yearText]);

  /*
   * Matching is against first name, last name and code as three separate
   * fields, which is what the server does: "Abhishek" and "Pandey" each find
   * the row, "Abhishek Pandey" finds nothing. Reproduced rather than quietly
   * improved, so a search that works here works in the export too.
   */
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return structures || [];
    return (structures || []).filter((s) =>
      [s.first_name, s.last_name, s.emp_code].some((f) => String(f || '').toLowerCase().includes(q)));
  }, [structures, term]);

  const daysBy = useMemo(() => {
    const m = new Map();
    (cycle?.rows || []).forEach((r) => m.set(r.employee_id, r));
    return m;
  }, [cycle]);

  const period = cycle?.period || null;

  /* One day's pay is the month's gross over the real length of the window —
   * 31 days for a 25 Aug – 24 Sep cycle, not a flat 30. Without the period
   * there is no divisor, and an estimate is not guessed at. */
  const lopDeduction = (s, days) => {
    if (!period?.days) return null;
    return (grossOf(s) / period.days) * Number(days.lop_days || 0);
  };

  const filtered = !!term.trim();
  const csvName = `payroll-${year}-${pad(month)}.csv`;

  /* ------------------------------------------------ mutations */

  async function saveStructure(ev) {
    ev.preventDefault();
    const v = editing.values;
    setBusy(true);
    try {
      /* A blank earnings box means "nothing under this head", so it posts as 0
       * rather than as an empty string the server would have to interpret. */
      const n = (x) => Number(x === '' ? 0 : x);
      const text = (x) => (String(x).trim() ? String(x).trim() : null);
      const res = await api(`/payroll/structures/${editing.id}`, {
        method: 'PUT',
        body: {
          basic: n(v.basic),
          hra: n(v.hra),
          special_allowance: n(v.special_allowance),
          conveyance: n(v.conveyance),
          pf_deduction: n(v.pf_deduction),
          esic_deduction: n(v.esic_deduction),
          tax_deduction: n(v.tax_deduction),
          pan_no: text(v.pan_no),
          bank_name: text(v.bank_name),
          bank_account_no: text(v.bank_account_no),
          bank_ifsc: text(v.bank_ifsc),
        },
      });
      toast(res?.message || 'Salary structure saved', 'ok');
      setEditing(null);
      load();
    } catch (e) {
      /* The dialog stays open with the typed figures in it — retyping a whole
       * salary structure because a request timed out is not acceptable. */
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function runExport() {
    setExporting(true);
    try {
      /* The sheet is behind the auth header, so it cannot be a plain href —
       * it is fetched as a blob and handed to the browser as a download. */
      await openProtectedFile(`/payroll/export/${year}/${month}`, true, csvName);
      toast(`Downloaded ${csvName}`, 'ok');
      setConfirmExport(false);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setExporting(false);
    }
  }

  /* ------------------------------------------------ states */

  if (error && !structures) {
    return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;
  }

  if (!structures) {
    return (
      <div className="page">
        <PageHead eyebrow="Management" title="Payroll" />
        <div className="card"><Skeleton rows={6} /></div>
      </div>
    );
  }

  const nameOf = (s) => `${s.first_name} ${s.last_name}`;

  const searchMiss = (
    <Empty
      icon={Search}
      title="Nobody matches that search"
      body="Name and employee code are matched separately, so “Abhishek” and “Pandey” each find the row but the two together find nothing."
      action={
        <button className="btn btn--ghost btn--sm" onClick={() => setTerm('')}>
          Clear search
        </button>
      }
    />
  );

  const noRoster = (
    <Empty
      icon={Users}
      title="No employees to pay"
      body="Every active employee appears here with their standing monthly figures. Add employees on the Employees screen and their salary structure can be filled in from this table."
    />
  );

  return (
    <div className="page">
      <PageHead
        eyebrow="Management"
        title="Payroll"
        sub="Run a cycle against its loss-of-pay days, and keep the standing salary structures"
      >
        {/* One search box serves both tabs: it filters the same roster, so it
            sits in the page head rather than inside either panel. */}
        <span className="search">
          <Search size={16} aria-hidden="true" />
          <label className="sr" htmlFor="pay-search">Search employees</label>
          <input
            id="pay-search"
            className="input"
            type="search"
            value={term}
            onChange={(ev) => setTerm(ev.target.value)}
            placeholder="Search by name or code…"
          />
        </span>
      </PageHead>

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {/* A refetch that fails keeps the figures that did load on screen. */}
        {error && <ErrorNote error={error} onRetry={load} />}

        {/* ------------------------------------------------ tab strip */}
        {/* Both registers live at one URL: the tab is component state, so
            nothing here navigates or reads a hash. */}
        <div className="tabs" role="tablist" aria-label="Payroll section">
          <button
            className="tab"
            type="button"
            role="tab"
            id="tab-run"
            aria-controls="panel-run"
            aria-selected={tab === 'run'}
            onClick={() => setTab('run')}
          >
            Run Payroll
          </button>
          <button
            className="tab"
            type="button"
            role="tab"
            id="tab-struct"
            aria-controls="panel-struct"
            aria-selected={tab === 'struct'}
            onClick={() => setTab('struct')}
          >
            Salary Structures
          </button>
        </div>

        {/* ================================================ run payroll */}
        <div
          className="stack"
          style={{ gap: 'var(--s5)' }}
          id="panel-run"
          role="tabpanel"
          aria-labelledby="tab-run"
          tabIndex={0}
          hidden={tab !== 'run'}
        >
          <section className="card">
            <h2 className="sr">Payroll cycle</h2>
            <div className="filterbar" style={{ alignItems: 'flex-end' }}>
              <Field id="pay-month" label="Month">
                <select
                  id="pay-month"
                  className="select"
                  value={month}
                  onChange={(ev) => setMonth(Number(ev.target.value))}
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </Field>

              <Field id="pay-year" label="Year">
                <input
                  id="pay-year"
                  className="input num"
                  type="number"
                  inputMode="numeric"
                  value={yearText}
                  onChange={(ev) => setYearText(ev.target.value)}
                />
              </Field>

              {/* Absent until the cycle lands rather than mocked up with a
                  placeholder window nobody is actually being paid for. */}
              {period && (
                <div aria-live="polite" style={{ paddingBottom: '.35rem' }}>
                  <p className="faint" style={{ fontSize: '.75rem', lineHeight: 1.2 }}>Paying for</p>
                  <p style={{ fontSize: '.875rem', fontWeight: 500, lineHeight: 1.3 }}>
                    {period.label} · <span className="num">{period.days}</span> days
                  </p>
                </div>
              )}

              <span className="spacer" />

              {canManage && (
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => setConfirmExport(true)}
                  disabled={exporting}
                >
                  <Download size={16} aria-hidden="true" />
                  {exporting ? 'Preparing…' : 'Export salary sheet'}
                </button>
              )}
            </div>
            <div className="card__foot">
              <p className="faint" style={{ fontSize: '.75rem' }}>
                {/* The cycle is a per-company setting, so it is read off the
                    period the API returns rather than asserted here — this
                    used to claim "the 25th to the 24th" to every tenant. */}
                {period?.label && <>This sheet covers <b>{period.label}</b>, the payroll cycle set in Settings. </>}
                The export downloads <span className="mono">{csvName}</span> — the
                full salary sheet, bank account numbers included, and every export is written to the
                audit log.
              </p>
            </div>
          </section>

          {cycleError ? (
            <ErrorNote error={cycleError} onRetry={loadCycle} />
          ) : (
            <section className="card">
              <div className="card__head">
                <div>
                  <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                    Salary sheet
                  </h2>
                  <p className="faint" style={{ fontSize: '.75rem' }}>
                    {period
                      ? `${fmtDay(period.from)} – ${fmtDay(period.to)}`
                      : `${MONTHS[month - 1]} ${year}`}
                  </p>
                </div>
                {!loadingCycle && (
                  <span className="chip mono" aria-live="polite">
                    {shown.length} {shown.length === 1 ? 'employee' : 'employees'}
                  </span>
                )}
              </div>

              {loadingCycle ? (
                <Skeleton rows={6} />
              ) : structures.length === 0 ? (
                noRoster
              ) : shown.length === 0 ? (
                searchMiss
              ) : (
                <div className="card__body card__body--flush">
                  <div className="tablewrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">Employee</th>
                          <th scope="col" className="num">Monthly salary (gross)</th>
                          <th scope="col" className="num">LOP days</th>
                          <th scope="col" className="num">EL</th>
                          <th scope="col" className="num">SL</th>
                          <th scope="col" className="num">WFH</th>
                          <th scope="col" className="num">Est. LOP deduction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((s) => {
                          const days = daysBy.get(s.employee_id) || NO_DAYS;
                          const ded = lopDeduction(s, days);
                          return (
                            <tr key={s.employee_id}>
                              <td>
                                <span className="person">
                                  <span className="avatar avatar--sm">{initials(nameOf(s))}</span>
                                  <span style={{ minWidth: 0 }}>
                                    <span className="person__name" style={{ display: 'block' }}>
                                      {nameOf(s)}
                                    </span>
                                    <span className="person__meta">
                                      {s.emp_code}{s.designation ? ` · ${s.designation}` : ''}
                                    </span>
                                  </span>
                                </span>
                              </td>
                              <td className="num">{money(grossOf(s))}</td>
                              <td className="num"><Days value={days.lop_days} tone="err-text" /></td>
                              <td className="num"><Days value={days.el_days} tone="warn" /></td>
                              <td className="num"><Days value={days.sl_days} tone="warn" /></td>
                              <td className="num"><Days value={days.wfh_days} tone="info" /></td>
                              <td className="num">
                                {ded === null ? (
                                  <span className="faint">—</span>
                                ) : (
                                  <span style={{ color: Number(days.lop_days || 0) ? 'var(--err-text)' : undefined }}>
                                    {money(ded)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="card__foot">
                <p className="faint" style={{ fontSize: '.75rem' }}>
                  Gross is basic, HRA, special allowance and conveyance. The loss-of-pay deduction is an
                  estimate — one day’s pay
                  {period ? ` is gross ÷ ${period.days}` : ' is gross ÷ the cycle length'} — and the
                  figures on the sheet are only as settled as the cycle’s attendance.
                </p>
              </div>
            </section>
          )}
        </div>

        {/* ================================================ salary structures */}
        <div
          className="stack"
          style={{ gap: 'var(--s5)' }}
          id="panel-struct"
          role="tabpanel"
          aria-labelledby="tab-struct"
          tabIndex={0}
          hidden={tab !== 'struct'}
        >
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                  Salary structures
                </h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>
                  Standing monthly figures — not dated, so no cycle applies to them
                </p>
              </div>
              <span className="chip mono" aria-live="polite">
                {shown.length} {shown.length === 1 ? 'employee' : 'employees'}
              </span>
            </div>

            {structures.length === 0 ? (
              noRoster
            ) : shown.length === 0 ? (
              searchMiss
            ) : (
              <div className="card__body card__body--flush">
                <div className="tablewrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Employee</th>
                        <th scope="col" className="num">Basic</th>
                        <th scope="col" className="num">HRA</th>
                        <th scope="col" className="num">Special</th>
                        <th scope="col" className="num">Conveyance</th>
                        <th scope="col" className="num">PF</th>
                        <th scope="col" className="num">ESIC</th>
                        <th scope="col" className="num">Tax</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((s) => (
                        <tr key={s.employee_id}>
                          <td>
                            <span className="person">
                              <span className="avatar avatar--sm">{initials(nameOf(s))}</span>
                              <span style={{ minWidth: 0 }}>
                                <span className="person__name" style={{ display: 'block' }}>
                                  {nameOf(s)}
                                </span>
                                <span className="person__meta">
                                  {s.emp_code}{s.department ? ` · ${s.department}` : ''}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="num">{money(s.basic)}</td>
                          <td className="num">{money(s.hra)}</td>
                          <td className="num">{money(s.special_allowance)}</td>
                          <td className="num">{money(s.conveyance)}</td>
                          <td className="num">{money(s.pf_deduction)}</td>
                          <td className="num">{money(s.esic_deduction)}</td>
                          <td className="num">{money(s.tax_deduction)}</td>
                          <td>
                            <span className="row" style={{ gap: 'var(--s1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                              {canManage ? (
                                <button
                                  className="btn btn--quiet btn--sm"
                                  onClick={() => setEditing({
                                    id: s.employee_id, employee: s, values: toForm(s),
                                  })}
                                  aria-label={`Edit salary structure for ${nameOf(s)}`}
                                >
                                  <Pencil size={14} aria-hidden="true" />Edit
                                </button>
                              ) : (
                                <span className="faint" style={{ fontSize: '.75rem' }}>View only</span>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="card__foot">
              <p className="faint" style={{ fontSize: '.75rem' }}>
                An employee with nothing saved reads zero across the row except conveyance, which the
                server defaults to {money(1600)}. Saving a structure overwrites the previous figures
                outright — it is the record of what the person is paid and where the money is sent, and
                the change is written to the audit log.
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* ------------------------------------------------ edit structure */}
      {editing && (
        <Modal
          wide
          title="Edit salary structure"
          sub={`${nameOf(editing.employee)} (${editing.employee.emp_code})`}
          onClose={() => !busy && setEditing(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="structure-form" disabled={busy}>
                <Save size={16} aria-hidden="true" />
                {busy ? 'Saving…' : 'Save structure'}
              </button>
            </>
          }
        >
          <StructureForm editing={editing} setEditing={setEditing} onSubmit={saveStructure} />
        </Modal>
      )}

      {/* ------------------------------------------------ export */}
      {/* The file is not reversible once it has left: it carries every active
          employee's pay and bank account in one sheet, so it is named before
          it is handed over. */}
      {confirmExport && (
        <ConfirmModal
          danger
          title="Export the salary sheet"
          body={`Download ${csvName} for ${period ? period.label : `${MONTHS[month - 1]} ${year}`}? The file lists every active employee's salary along with their bank name, account number and IFSC, in plain text. The download is recorded in the audit log against your account.`}
          confirmLabel="Download sheet"
          busy={exporting}
          onConfirm={runExport}
          onClose={() => !exporting && setConfirmExport(false)}
        />
      )}
    </div>
  );
}

/* ============================================================ the form */

function StructureForm({ editing, setEditing, onSubmit }) {
  const v = editing.values;
  const set = (patch) => setEditing({ ...editing, values: { ...v, ...patch } });

  /* The preview is the same arithmetic the sheet uses, minus the cycle: what
   * lands in the account in a month with no loss of pay. It is shown here
   * because the seven boxes on their own do not add up in anyone's head. */
  const gross = Number(v.basic || 0) + Number(v.hra || 0)
    + Number(v.special_allowance || 0) + Number(v.conveyance || 0);
  const deductions = Number(v.pf_deduction || 0) + Number(v.esic_deduction || 0)
    + Number(v.tax_deduction || 0);

  const amount = (id, label, value, key, required) => (
    <Field id={id} label={label} required={required}>
      <input
        id={id}
        className="input num"
        type="number"
        step="0.01"
        min="0"
        required={required}
        value={value}
        onChange={(ev) => set({ [key]: ev.target.value })}
      />
    </Field>
  );

  return (
    <form id="structure-form" onSubmit={onSubmit} className="stack" style={{ gap: 'var(--s5)' }}>
      <fieldset>
        <legend>Earnings</legend>
        <div className="fieldrow">
          {amount('s-basic', 'Basic (₹)', v.basic, 'basic', false)}
          {amount('s-hra', 'HRA (₹)', v.hra, 'hra', false)}
        </div>
        <div className="fieldrow">
          {amount('s-special', 'Special allowance (₹)', v.special_allowance, 'special_allowance', false)}
          {amount('s-conveyance', 'Conveyance (₹)', v.conveyance, 'conveyance', true)}
        </div>
      </fieldset>

      <fieldset>
        <legend>Deductions</legend>
        <div className="fieldrow">
          {amount('s-pf', 'PF deduction (₹)', v.pf_deduction, 'pf_deduction', true)}
          {amount('s-esic', 'ESIC (₹)', v.esic_deduction, 'esic_deduction', true)}
        </div>
        <div className="fieldrow">
          {amount('s-tax', 'Tax — TDS (₹)', v.tax_deduction, 'tax_deduction', true)}
        </div>
      </fieldset>

      <div className="card" style={{ boxShadow: 'none' }}>
        <div className="card__body">
          <div className="row row--between">
            <span>
              <span className="stat__label">Monthly net, before loss of pay</span>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                {money(gross)} gross less {money(deductions)} in deductions
              </p>
            </span>
            <span className="num" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
              {money(gross - deductions)}
            </span>
          </div>
        </div>
      </div>

      <fieldset>
        <legend>Bank &amp; tax details</legend>
        <div className="fieldrow">
          <Field id="s-pan" label="PAN number">
            <input
              id="s-pan"
              className="input mono"
              value={v.pan_no}
              onChange={(ev) => set({ pan_no: ev.target.value })}
            />
          </Field>
          <Field id="s-bank" label="Bank name">
            <input
              id="s-bank"
              className="input"
              value={v.bank_name}
              onChange={(ev) => set({ bank_name: ev.target.value })}
            />
          </Field>
        </div>
        <div className="fieldrow">
          <Field id="s-account" label="Bank account no.">
            <input
              id="s-account"
              className="input mono"
              value={v.bank_account_no}
              onChange={(ev) => set({ bank_account_no: ev.target.value })}
            />
          </Field>
          <Field id="s-ifsc" label="Bank IFSC">
            <input
              id="s-ifsc"
              className="input mono"
              value={v.bank_ifsc}
              onChange={(ev) => set({ bank_ifsc: ev.target.value })}
            />
          </Field>
        </div>
      </fieldset>

      <p className="faint" style={{ fontSize: '.75rem' }}>
        Saving replaces the figures already on file — there is no version history to fall back on, and
        the account details here are where the salary is actually sent.
      </p>
    </form>
  );
}
