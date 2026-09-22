'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Eye, FileText, FileUp, FolderOpen, Plus, RefreshCw, Trash2, Upload, Users,
} from 'lucide-react';
import { api, fmtDate, hasPerm, money, openProtectedFile } from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast,
} from '@/components/ui';

/*
 * Three document types, one screen. The tab is state rather than a route:
 * /admin/documents is the only URL there is, so switching swaps the body in
 * place and nothing in the address bar moves.
 */
const TABS = [
  { key: 'slips', label: 'Salary Slips' },
  { key: 'policies', label: 'Company Policies' },
  { key: 'offers', label: 'Offer Letters' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/*
 * Today, in Asia/Kolkata, as a plain string. A new slip has to default to a
 * month and a year, and reading them off a Date's local getters would land on
 * the previous month for anyone whose clock sits west of IST on the 1st —
 * the same reason fmtDate takes its date apart instead of parsing it.
 */
function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/* An amount arrives as a number or null; a form field is always a string. */
const amount = (v) => (v === null || v === undefined ? '' : String(v));

const empLabel = (e) => `${e.emp_code} — ${e.first_name} ${e.last_name}`;

/* The server names a downloaded slip this way; the browser tab does not care,
 * but the name is what lands on disk if the user saves it from the viewer. */
const slipFileName = (slip, code) =>
  `salary-slip-${code || 'employee'}-${slip.year}-${String(slip.month).padStart(2, '0')}.pdf`;

export default function AdminDocumentsPage() {
  const toast = useToast();
  const canManage = hasPerm('documents.manage');
  /*
   * The employee picker is fed by /employees, which gates on employees.view —
   * a different permission from the one this screen runs on. Someone with
   * documents.manage alone still gets the policies and offer-letter tabs;
   * they just cannot choose whose slips to look at.
   */
  /*
   * BOTH permissions, because the picker is only useful when both hold.
   * /employees needs employees.view to populate it, and GET
   * /documents/salary-slips honours ?employee_id only for documents.manage —
   * it silently scopes the query back to the caller otherwise. Gating on
   * employees.view alone therefore gave a user without documents.manage a
   * working picker that answered every selection with their OWN slips, shown
   * under whichever colleague they had just chosen.
   */
  const canSeeEmployees = hasPerm('employees.view') && hasPerm('documents.manage');
  const [nowYear, nowMonth] = todayIST().split('-');

  const [tab, setTab] = useState(TABS[0].key);

  const [employees, setEmployees] = useState(null);
  const [empError, setEmpError] = useState('');
  const [empId, setEmpId] = useState('');

  const [slips, setSlips] = useState(null);
  const [slipsError, setSlipsError] = useState('');
  const [policies, setPolicies] = useState(null);
  const [policiesError, setPoliciesError] = useState('');
  const [offers, setOffers] = useState(null);
  const [offersError, setOffersError] = useState('');

  const [genForm, setGenForm] = useState(null);       // generate-slip values
  const [upForm, setUpForm] = useState(null);         // { month, year, file }
  const [policyForm, setPolicyForm] = useState(null); // { mode, id, title, category, description, file }
  const [offerForm, setOfferForm] = useState(null);   // { employee_id, title, is_revised, file }
  const [confirming, setConfirming] = useState(null); // { kind, row }
  const [busy, setBusy] = useState(false);
  /* "<kind>:<id>" while a PDF is being fetched, so the row that was clicked
     is the one that goes quiet rather than the whole table. */
  const [opening, setOpening] = useState('');

  /* ------------------------------------------------ loads */

  const loadEmployees = () => {
    if (!canSeeEmployees) return;
    setEmpError('');
    api('/employees')
      .then((rows) => {
        setEmployees(rows);
        setEmpId((cur) => cur || (rows[0] ? String(rows[0].id) : ''));
      })
      .catch((e) => setEmpError(e.message));
  };
  useEffect(loadEmployees, []);

  /*
   * Salary slips are per-employee: the route has no "everybody" listing, it
   * answers with the signed-in user's own slips unless an employee_id is
   * passed. So the fetch waits for the picker to settle on somebody rather
   * than quietly showing the admin their own payslips.
   */
  const loadSlips = () => {
    setSlipsError('');
    setSlips(null);
    if (canSeeEmployees && !empId) return;
    const q = empId ? `?employee_id=${encodeURIComponent(empId)}` : '';
    api(`/documents/salary-slips${q}`).then(setSlips).catch((e) => setSlipsError(e.message));
  };
  useEffect(loadSlips, [empId]);

  const loadPolicies = () => {
    setPoliciesError('');
    setPolicies(null);
    api('/documents/policies').then(setPolicies).catch((e) => setPoliciesError(e.message));
  };
  useEffect(loadPolicies, []);

  const loadOffers = () => {
    setOffersError('');
    setOffers(null);
    api('/documents/offer-letters').then(setOffers).catch((e) => setOffersError(e.message));
  };
  useEffect(loadOffers, []);

  const selectedEmp = useMemo(
    () => (employees || []).find((e) => String(e.id) === String(empId)) || null,
    [employees, empId],
  );

  /* ------------------------------------------------ openers */

  /*
   * The generate form opens populated rather than blank: the amounts come
   * from the employee's most recent slip that actually carries figures (an
   * uploaded-only PDF has none), and the statutory fields from the employee
   * record. Payroll rarely changes month to month, so this is usually a
   * confirmation rather than thirteen fields of typing.
   */
  function openGenerate() {
    const last = (slips || []).find((s) => s.net_pay !== null && s.net_pay !== undefined);
    setGenForm({
      month: String(Number(nowMonth)),
      year: nowYear,
      basic: amount(last?.basic),
      hra: amount(last?.hra),
      special_allowance: amount(last?.special_allowance),
      conveyance: last ? amount(last.conveyance) : '1600',
      pf_deduction: amount(last?.pf_deduction),
      tax_deduction: amount(last?.tax_deduction),
      lop_deduction: last ? amount(last.lop_deduction) : '0',
      pan_no: selectedEmp?.pan_no || '',
      bank_name: selectedEmp?.bank_name || '',
      bank_account_no: selectedEmp?.bank_account_no || '',
      bank_ifsc: selectedEmp?.bank_ifsc || '',
    });
  }

  const openSlipUpload = () =>
    setUpForm({ month: String(Number(nowMonth)), year: nowYear, file: null });

  const openPolicyCreate = () =>
    setPolicyForm({ mode: 'create', id: null, title: '', category: '', description: '', file: null });

  const openPolicyReplace = (p) =>
    setPolicyForm({
      mode: 'replace', id: p.id,
      title: p.title || '', category: p.category || '', description: p.description || '', file: null,
    });

  const openOfferUpload = () =>
    setOfferForm({
      employee_id: empId || (employees?.[0] ? String(employees[0].id) : ''),
      title: '', is_revised: false, file: null,
    });

  /* ------------------------------------------------ mutations */

  async function generateSlip(ev) {
    ev.preventDefault();
    setBusy(true);
    try {
      const v = genForm;
      const res = await api('/documents/salary-slips', {
        method: 'POST',
        body: {
          employee_id: Number(empId),
          month: Number(v.month),
          year: Number(v.year),
          basic: Number(v.basic),
          hra: Number(v.hra),
          special_allowance: Number(v.special_allowance),
          conveyance: Number(v.conveyance),
          pf_deduction: Number(v.pf_deduction),
          tax_deduction: Number(v.tax_deduction),
          lop_deduction: Number(v.lop_deduction || 0),
          /* Blank means "I do not have this", not "clear it" — the server
             keeps whatever is already on the record when these are empty. */
          pan_no: v.pan_no,
          bank_name: v.bank_name,
          bank_account_no: v.bank_account_no,
          bank_ifsc: v.bank_ifsc,
        },
      });
      toast(res?.message || 'Salary slip generated', 'ok');
      setGenForm(null);
      loadSlips();
    } catch (e) {
      /* The form stays open and filled in — a duplicate period only needs the
         month changed, not everything typed again. */
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function uploadSlip(ev) {
    ev.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('employee_id', empId);
      fd.append('month', upForm.month);
      fd.append('year', upForm.year);
      if (upForm.file) fd.append('file', upForm.file);
      const res = await api('/documents/salary-slips/upload', { method: 'POST', formData: fd });
      toast(res?.message || 'Salary slip PDF uploaded', 'ok');
      setUpForm(null);
      loadSlips();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(ev) {
    ev.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('title', policyForm.title);
      fd.append('category', policyForm.category);
      fd.append('description', policyForm.description);
      /* Replace posts to the same route with the id attached; an empty file
         input there means "keep the PDF, edit only the wording". */
      if (policyForm.mode === 'replace') fd.append('replace_id', String(policyForm.id));
      if (policyForm.file) fd.append('file', policyForm.file);
      const res = await api('/documents/policies', { method: 'POST', formData: fd });
      toast(res?.message || 'Policy uploaded', 'ok');
      setPolicyForm(null);
      loadPolicies();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function uploadOffer(ev) {
    ev.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('employee_id', offerForm.employee_id);
      /* Left blank, the server names it "Offer Letter - <code>" and appends
         " (Revised)" itself, so an empty title is sent as an empty string
         rather than being made up here. */
      fd.append('title', offerForm.title);
      fd.append('is_revised', offerForm.is_revised ? 'true' : 'false');
      if (offerForm.file) fd.append('file', offerForm.file);
      const res = await api('/documents/offer-letters', { method: 'POST', formData: fd });
      toast(res?.message || 'Offer letter uploaded', 'ok');
      setOfferForm(null);
      loadOffers();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    const { kind, row } = confirming;
    const path = kind === 'slip' ? `/documents/salary-slips/${row.id}`
      : kind === 'policy' ? `/documents/policies/${row.id}`
        : `/documents/offer-letters/${row.id}`;
    setBusy(true);
    try {
      const res = await api(path, { method: 'DELETE' });
      toast(res?.message || 'Deleted', 'ok');
      setConfirming(null);
      if (kind === 'slip') loadSlips();
      else if (kind === 'policy') loadPolicies();
      else loadOffers();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  /*
   * Every document sits behind the bearer token, so none of them can be a
   * plain href — openProtectedFile fetches the blob with the header attached
   * and hands the browser an object URL.
   */
  async function openFile(kind, id, path, filename) {
    setOpening(`${kind}:${id}`);
    try {
      await openProtectedFile(path, false, filename);
      toast('Opened in a new tab', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setOpening('');
    }
  }

  /* ------------------------------------------------ render */

  const panelProps = (key) => ({
    id: `panel-${key}`,
    role: 'tabpanel',
    'aria-labelledby': `tab-${key}`,
    className: 'stack',
    style: { gap: 'var(--s5)' },
  });

  const h2 = { fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 };
  const rowActions = { gap: 'var(--s1)', justifyContent: 'flex-end', flexWrap: 'nowrap' };

  return (
    <div className="page">
      <PageHead
        eyebrow="Management"
        title="Documents"
        sub="Upload, replace and delete salary slips, policies and offer letters"
      />

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        <div className="tabs" role="tablist" aria-label="Document type">
          {TABS.map((t) => (
            <button
              className="tab"
              key={t.key}
              id={`tab-${t.key}`}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ================================================ salary slips */}
        {tab === 'slips' && (
          <div {...panelProps('slips')}>
            {empError && <ErrorNote error={empError} onRetry={loadEmployees} />}
            {slipsError && <ErrorNote error={slipsError} onRetry={loadSlips} />}

            <section className="card">
              <div className="filterbar">
                {canSeeEmployees ? (
                  <>
                    <label className="sr" htmlFor="slip-emp">Employee</label>
                    <select
                      id="slip-emp"
                      className="select"
                      value={empId}
                      disabled={!employees || employees.length === 0}
                      onChange={(ev) => setEmpId(ev.target.value)}
                    >
                      {!employees && <option value="">Loading employees…</option>}
                      {employees?.length === 0 && <option value="">No employees</option>}
                      {(employees || []).map((e) => (
                        <option key={e.id} value={e.id}>{empLabel(e)}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="faint" style={{ fontSize: '.75rem' }}>
                    Showing your own slips — choosing another employee needs the
                    “view employees” permission.
                  </span>
                )}

                <span className="spacer" />

                {/* A slip cannot be filed without an employee, and the picker
                    needs employees.view. Without it, `canSeeEmployees && !selectedEmp`
                    evaluated to false — so these buttons were ENABLED with nothing
                    selected and posted employee_id 0, which cleared the route's
                    required-field guard and then tripped the employees foreign key. */}
                {canManage && canSeeEmployees && (
                  <>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={openSlipUpload}
                      disabled={!selectedEmp}
                    >
                      <FileUp size={16} aria-hidden="true" />Upload PDF slip
                    </button>
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={openGenerate}
                      disabled={!selectedEmp}
                    >
                      <Plus size={16} aria-hidden="true" />Generate slip
                    </button>
                  </>
                )}
              </div>

              {slipsError ? null
                : canSeeEmployees && employees?.length === 0 ? (
                  <Empty
                    icon={Users}
                    title="Nobody on the roster yet"
                    body="Salary slips are filed against an employee, so this tab has nothing to show until the first employee record exists."
                  />
                ) : !slips ? (
                  <Skeleton rows={5} />
                ) : slips.length === 0 ? (
                  <Empty
                    icon={FileText}
                    title="No salary slips for this employee."
                    body="Every slip issued to them — generated from amounts here, or uploaded as a ready-made PDF — appears in this list, newest first."
                    action={canManage && canSeeEmployees ? (
                      <button className="btn btn--primary btn--sm" onClick={openGenerate}>
                        <Plus size={16} aria-hidden="true" />Generate slip
                      </button>
                    ) : null}
                  />
                ) : (
                  <div className="card__body card__body--flush">
                    <div className="tablewrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">Period</th>
                            <th scope="col" className="num">Net pay</th>
                            <th scope="col">Source</th>
                            <th scope="col">Added</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slips.map((s) => {
                            const uploaded = s.source === 'uploaded';
                            return (
                              <tr key={s.id}>
                                <td>
                                  <span className="row" style={{ gap: 'var(--s2)', flexWrap: 'nowrap' }}>
                                    <FileText
                                      size={15}
                                      aria-hidden="true"
                                      style={{ color: 'var(--accent)', flex: 'none' }}
                                    />
                                    <span style={{ minWidth: 0 }}>
                                      <span style={{ display: 'block', fontWeight: 600 }}>{s.label}</span>
                                      {/* The cycle the slip covers, spelled out: a slip
                                          headed "September" that pays 25 Aug – 24 Sep is
                                          the single most queried thing on a payslip. */}
                                      <span className="faint" style={{ fontSize: '.75rem' }}>{s.period}</span>
                                    </span>
                                  </span>
                                </td>
                                {/* An uploaded-only PDF carries no amounts at all;
                                    money() renders that as an em dash by itself. */}
                                <td className="num mono">{money(s.net_pay)}</td>
                                <td>
                                  <StatusBadge
                                    status={uploaded ? 'Uploaded PDF' : 'Generated'}
                                    tone={uploaded ? 'neutral' : 'info'}
                                  />
                                </td>
                                <td className="muted">{fmtDate(s.generated_at)}</td>
                                <td>
                                  <span className="row" style={rowActions}>
                                    <button
                                      className="iconbtn"
                                      onClick={() => openFile(
                                        'slip', s.id,
                                        `/documents/salary-slips/${s.id}/pdf`,
                                        slipFileName(s, selectedEmp?.emp_code),
                                      )}
                                      disabled={opening === `slip:${s.id}`}
                                      aria-label={`View the ${s.label} salary slip`}
                                      title="View PDF"
                                    >
                                      <Eye size={16} aria-hidden="true" />
                                    </button>
                                    {canManage && (
                                      <button
                                        className="iconbtn"
                                        onClick={() => setConfirming({ kind: 'slip', row: s })}
                                        aria-label={`Delete the ${s.label} salary slip`}
                                        title="Delete"
                                        style={{ color: 'var(--err-text)' }}
                                      >
                                        <Trash2 size={16} aria-hidden="true" />
                                      </button>
                                    )}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
            </section>
          </div>
        )}

        {/* ================================================ policies */}
        {tab === 'policies' && (
          <div {...panelProps('policies')}>
            {policiesError && <ErrorNote error={policiesError} onRetry={loadPolicies} />}

            <section className="card">
              <div className="card__head">
                <div>
                  <h2 style={h2}>Company policies</h2>
                  <p className="faint" style={{ fontSize: '.75rem' }}>
                    Every employee can read these from their own Policies screen
                  </p>
                </div>
                {canManage && (
                  <button className="btn btn--primary btn--sm" onClick={openPolicyCreate}>
                    <Upload size={16} aria-hidden="true" />Upload policy
                  </button>
                )}
              </div>

              {policiesError ? null
                : !policies ? (
                  <Skeleton rows={5} />
                ) : policies.length === 0 ? (
                  <Empty
                    icon={FolderOpen}
                    title="No policies uploaded yet"
                    body="Company-wide policy PDFs — leave, attendance, security, travel — appear here once uploaded, and become readable by every employee."
                    action={canManage ? (
                      <button className="btn btn--primary btn--sm" onClick={openPolicyCreate}>
                        <Upload size={16} aria-hidden="true" />Upload policy
                      </button>
                    ) : null}
                  />
                ) : (
                  <div className="card__body card__body--flush">
                    <div className="tablewrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">Title</th>
                            <th scope="col">Category</th>
                            <th scope="col">Description</th>
                            <th scope="col">Updated</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {policies.map((p) => (
                            <tr key={p.id}>
                              <td style={{ fontWeight: 600 }}>{p.title}</td>
                              <td><span className="chip">{p.category}</span></td>
                              {/* Long descriptions are clipped rather than allowed to
                                  stretch the row; the full text is on the title. */}
                              <td
                                className="muted"
                                title={p.description || undefined}
                                style={{
                                  maxWidth: '18.75rem', overflow: 'hidden',
                                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}
                              >
                                {p.description || '—'}
                              </td>
                              <td className="muted">{fmtDate(p.uploaded_at)}</td>
                              <td>
                                <span className="row" style={rowActions}>
                                  <button
                                    className="iconbtn"
                                    onClick={() => openFile(
                                      'policy', p.id,
                                      `/documents/policies/${p.id}/file`,
                                      `${p.title}.pdf`,
                                    )}
                                    disabled={opening === `policy:${p.id}`}
                                    aria-label={`View ${p.title}`}
                                    title="View"
                                  >
                                    <Eye size={16} aria-hidden="true" />
                                  </button>
                                  {canManage && (
                                    <>
                                      <button
                                        className="iconbtn"
                                        onClick={() => openPolicyReplace(p)}
                                        aria-label={`Replace ${p.title}`}
                                        title="Replace"
                                      >
                                        <RefreshCw size={16} aria-hidden="true" />
                                      </button>
                                      <button
                                        className="iconbtn"
                                        onClick={() => setConfirming({ kind: 'policy', row: p })}
                                        aria-label={`Delete ${p.title}`}
                                        title="Delete"
                                        style={{ color: 'var(--err-text)' }}
                                      >
                                        <Trash2 size={16} aria-hidden="true" />
                                      </button>
                                    </>
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
            </section>
          </div>
        )}

        {/* ================================================ offer letters */}
        {tab === 'offers' && (
          <div {...panelProps('offers')}>
            {offersError && <ErrorNote error={offersError} onRetry={loadOffers} />}

            <section className="card">
              <div className="card__head">
                <div>
                  <h2 style={h2}>Offer letters</h2>
                  <p className="faint" style={{ fontSize: '.75rem' }}>
                    An employee can appear more than once — a revision sits above the original
                  </p>
                </div>
                {canManage && (
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={openOfferUpload}
                    disabled={canSeeEmployees && !employees}
                  >
                    <Upload size={16} aria-hidden="true" />Upload offer letter
                  </button>
                )}
              </div>

              {offersError ? null
                : !offers ? (
                  <Skeleton rows={5} />
                ) : offers.length === 0 ? (
                  <Empty
                    icon={FolderOpen}
                    title="No offer letters on file"
                    body="Each letter filed against an employee appears here, flagged as the original or a revision, and shows on that employee's own Offer Letter screen."
                    action={canManage ? (
                      <button className="btn btn--primary btn--sm" onClick={openOfferUpload}>
                        <Upload size={16} aria-hidden="true" />Upload offer letter
                      </button>
                    ) : null}
                  />
                ) : (
                  <div className="card__body card__body--flush">
                    <div className="tablewrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">Employee</th>
                            <th scope="col">Title</th>
                            <th scope="col">Type</th>
                            <th scope="col">Uploaded</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {offers.map((o) => (
                            <tr key={o.id}>
                              {/* Name and code only come back on the management
                                  listing; without documents.manage the route
                                  answers with the caller's own letters and neither
                                  column is present. */}
                              <td>
                                <span style={{ display: 'block', fontWeight: 600 }}>
                                  {o.employee_name || 'Your record'}
                                </span>
                                {o.emp_code && (
                                  <span className="mono faint" style={{ fontSize: '.75rem' }}>
                                    {o.emp_code}
                                  </span>
                                )}
                              </td>
                              <td>{o.title}</td>
                              <td>
                                <StatusBadge
                                  status={o.is_revised ? 'Revised' : 'Original'}
                                  tone={o.is_revised ? 'warn' : 'ok'}
                                />
                              </td>
                              <td className="muted">{fmtDate(o.uploaded_at)}</td>
                              <td>
                                <span className="row" style={rowActions}>
                                  <button
                                    className="iconbtn"
                                    onClick={() => openFile(
                                      'offer', o.id,
                                      `/documents/offer-letters/${o.id}/file`,
                                      `${o.title}.pdf`,
                                    )}
                                    disabled={opening === `offer:${o.id}`}
                                    aria-label={`View ${o.title}`}
                                    title="View"
                                  >
                                    <Eye size={16} aria-hidden="true" />
                                  </button>
                                  {canManage && (
                                    <button
                                      className="iconbtn"
                                      onClick={() => setConfirming({ kind: 'offer', row: o })}
                                      aria-label={`Delete ${o.title}`}
                                      title="Delete"
                                      style={{ color: 'var(--err-text)' }}
                                    >
                                      <Trash2 size={16} aria-hidden="true" />
                                    </button>
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
            </section>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ generate slip */}
      {genForm && (
        <Modal
          wide
          title="Generate salary slip"
          sub={selectedEmp ? `${selectedEmp.first_name} ${selectedEmp.last_name} (${selectedEmp.emp_code})` : undefined}
          onClose={() => !busy && setGenForm(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setGenForm(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="gen-form" disabled={busy}>
                {busy ? 'Generating…' : 'Generate'}
              </button>
            </>
          }
        >
          <SlipForm
            values={genForm}
            set={(patch) => setGenForm({ ...genForm, ...patch })}
            onSubmit={generateSlip}
          />
        </Modal>
      )}

      {/* ------------------------------------------------ upload slip PDF */}
      {upForm && (
        <Modal
          title="Upload salary slip PDF"
          sub={selectedEmp ? selectedEmp.emp_code : undefined}
          onClose={() => !busy && setUpForm(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setUpForm(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="upload-slip-form" disabled={busy}>
                {busy ? 'Uploading…' : 'Upload'}
              </button>
            </>
          }
        >
          <form id="upload-slip-form" onSubmit={uploadSlip} className="stack">
            <p className="muted" style={{ fontSize: '.875rem' }}>
              Upload a ready-made slip for <b>{selectedEmp?.emp_code || 'this employee'}</b>. It
              replaces the generated one for that month if a slip already exists.
            </p>
            <div className="fieldrow">
              <Field id="up-month" label="Month" required>
                <select
                  id="up-month"
                  className="select"
                  required
                  value={upForm.month}
                  onChange={(ev) => setUpForm({ ...upForm, month: ev.target.value })}
                >
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <Field id="up-year" label="Year" required>
                <input
                  id="up-year"
                  className="input"
                  type="number"
                  required
                  min="2000"
                  max="2100"
                  value={upForm.year}
                  onChange={(ev) => setUpForm({ ...upForm, year: ev.target.value })}
                />
              </Field>
            </div>
            <Field
              id="up-file"
              label="PDF file"
              required
              help="The uploaded file takes precedence over any amounts already on that month's slip."
            >
              <input
                id="up-file"
                className="input"
                type="file"
                required
                accept="application/pdf"
                onChange={(ev) => setUpForm({ ...upForm, file: ev.target.files?.[0] || null })}
              />
            </Field>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------ policy upload / replace */}
      {policyForm && (
        <Modal
          title={policyForm.mode === 'replace' ? 'Replace policy' : 'Upload policy'}
          sub={policyForm.mode === 'replace' ? policyForm.title : 'Readable by every employee once uploaded'}
          onClose={() => !busy && setPolicyForm(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setPolicyForm(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="policy-form" disabled={busy}>
                {busy
                  ? (policyForm.mode === 'replace' ? 'Replacing…' : 'Uploading…')
                  : (policyForm.mode === 'replace' ? 'Replace' : 'Upload')}
              </button>
            </>
          }
        >
          <form id="policy-form" onSubmit={savePolicy} className="stack">
            <Field id="pol-title" label="Title" required>
              <input
                id="pol-title"
                className="input"
                required
                value={policyForm.title}
                onChange={(ev) => setPolicyForm({ ...policyForm, title: ev.target.value })}
              />
            </Field>
            <Field id="pol-category" label="Category" required help="Free text — it becomes the label on the row.">
              <input
                id="pol-category"
                className="input"
                required
                placeholder="e.g. HR, Leave, IT"
                value={policyForm.category}
                onChange={(ev) => setPolicyForm({ ...policyForm, category: ev.target.value })}
              />
            </Field>
            <Field id="pol-description" label="Description">
              <textarea
                id="pol-description"
                className="textarea"
                rows={2}
                value={policyForm.description}
                onChange={(ev) => setPolicyForm({ ...policyForm, description: ev.target.value })}
              />
            </Field>
            <Field
              id="pol-file"
              label={policyForm.mode === 'replace' ? 'PDF file (leave empty to keep current file)' : 'PDF file'}
              required={policyForm.mode !== 'replace'}
              help={policyForm.mode === 'replace'
                ? 'Leaving this empty edits the title, category and description without touching the PDF.'
                : undefined}
            >
              <input
                id="pol-file"
                className="input"
                type="file"
                required={policyForm.mode !== 'replace'}
                accept="application/pdf"
                onChange={(ev) => setPolicyForm({ ...policyForm, file: ev.target.files?.[0] || null })}
              />
            </Field>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------ offer letter upload */}
      {offerForm && (
        <Modal
          title="Upload offer letter"
          sub="Filed against one employee — there is no replace, upload a revision instead"
          onClose={() => !busy && setOfferForm(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setOfferForm(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="offer-form" disabled={busy}>
                {busy ? 'Uploading…' : 'Upload'}
              </button>
            </>
          }
        >
          <form id="offer-form" onSubmit={uploadOffer} className="stack">
            <Field
              id="off-emp"
              label="Employee"
              required
              help={employees ? undefined : 'The employee list did not load, so there is nobody to choose.'}
            >
              <select
                id="off-emp"
                className="select"
                required
                value={offerForm.employee_id}
                onChange={(ev) => setOfferForm({ ...offerForm, employee_id: ev.target.value })}
              >
                <option value="">Select an employee</option>
                {(employees || []).map((e) => (
                  <option key={e.id} value={e.id}>{empLabel(e)}</option>
                ))}
              </select>
            </Field>
            <Field
              id="off-title"
              label="Title"
              help="Left blank, the server names it “Offer Letter - <code>”, with “ (Revised)” added when the box below is ticked."
            >
              <input
                id="off-title"
                className="input"
                placeholder={`Offer Letter - ${
                  (employees || []).find((e) => String(e.id) === String(offerForm.employee_id))?.emp_code || 'code'
                }`}
                value={offerForm.title}
                onChange={(ev) => setOfferForm({ ...offerForm, title: ev.target.value })}
              />
            </Field>
            <label className="checkline" htmlFor="off-revised">
              <input
                id="off-revised"
                type="checkbox"
                checked={offerForm.is_revised}
                onChange={(ev) => setOfferForm({ ...offerForm, is_revised: ev.target.checked })}
              />
              <span>This is a revised offer letter</span>
            </label>
            <Field id="off-file" label="PDF file" required>
              <input
                id="off-file"
                className="input"
                type="file"
                required
                accept="application/pdf"
                onChange={(ev) => setOfferForm({ ...offerForm, file: ev.target.files?.[0] || null })}
              />
            </Field>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------ deletions */}
      {confirming?.kind === 'slip' && (
        <ConfirmModal
          danger
          title="Delete salary slip"
          body={`Delete the ${confirming.row.label} salary slip${
            selectedEmp ? ` for ${selectedEmp.first_name} ${selectedEmp.last_name} (${selectedEmp.emp_code})` : ''
          }? The amounts and any uploaded PDF go with it, and the employee loses it from their own Salary Slips screen. This cannot be undone.`}
          confirmLabel="Delete slip"
          busy={busy}
          onConfirm={runDelete}
          onClose={() => !busy && setConfirming(null)}
        />
      )}
      {confirming?.kind === 'policy' && (
        <ConfirmModal
          danger
          title="Delete policy"
          body={`Delete “${confirming.row.title}”? Every employee loses it from their Policies screen straight away. This cannot be undone.`}
          confirmLabel="Delete policy"
          busy={busy}
          onConfirm={runDelete}
          onClose={() => !busy && setConfirming(null)}
        />
      )}
      {confirming?.kind === 'offer' && (
        <ConfirmModal
          danger
          title="Delete offer letter"
          body={`Delete “${confirming.row.title}”${
            confirming.row.employee_name ? ` filed against ${confirming.row.employee_name} (${confirming.row.emp_code})` : ''
          }? They lose it from their own Offer Letter screen. This cannot be undone.`}
          confirmLabel="Delete offer letter"
          busy={busy}
          onConfirm={runDelete}
          onClose={() => !busy && setConfirming(null)}
        />
      )}
    </div>
  );
}

/* ============================================================ the slip form */

/*
 * Thirteen fields in the order payroll reads them: the period, what is
 * earned, what is taken off, then the statutory identifiers. Net pay is
 * deliberately absent — the server computes it, and a second figure on screen
 * is a second figure that can disagree with the slip.
 */
function SlipForm({ values, set, onSubmit }) {
  const num = (id, label, key, extra = {}) => (
    <Field id={id} label={label} required>
      <input
        id={id}
        className="input"
        type="number"
        required
        min="0"
        step="0.01"
        value={values[key]}
        onChange={(ev) => set({ [key]: ev.target.value })}
        {...extra}
      />
    </Field>
  );

  const text = (id, label, key, help) => (
    <Field id={id} label={label} help={help}>
      <input
        id={id}
        className="input"
        autoComplete="off"
        spellCheck="false"
        value={values[key]}
        onChange={(ev) => set({ [key]: ev.target.value })}
      />
    </Field>
  );

  return (
    <form id="gen-form" onSubmit={onSubmit} className="stack" style={{ gap: 'var(--s5)' }}>
      <fieldset>
        <legend>Period</legend>
        <div className="fieldrow">
          <Field id="gen-month" label="Month" required>
            <select
              id="gen-month"
              className="select"
              required
              value={values.month}
              onChange={(ev) => set({ month: ev.target.value })}
            >
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field
            id="gen-year"
            label="Year"
            required
            help="One slip per employee per month — a repeat is refused."
          >
            <input
              id="gen-year"
              className="input"
              type="number"
              required
              min="2000"
              max="2100"
              value={values.year}
              onChange={(ev) => set({ year: ev.target.value })}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>Earnings</legend>
        <div className="fieldrow">
          {num('gen-basic', 'Basic (₹)', 'basic')}
          {num('gen-hra', 'HRA (₹)', 'hra')}
        </div>
        <div className="fieldrow">
          {num('gen-special', 'Special allowance (₹)', 'special_allowance')}
          {num('gen-conveyance', 'Conveyance (₹)', 'conveyance')}
        </div>
      </fieldset>

      <fieldset>
        <legend>Deductions</legend>
        <div className="fieldrow">
          {num('gen-pf', 'PF deduction (₹)', 'pf_deduction')}
          {num('gen-tax', 'Tax (TDS) (₹)', 'tax_deduction')}
        </div>
        <div className="fieldrow">
          {num('gen-lop', 'LOP deduction (₹)', 'lop_deduction')}
        </div>
        <p className="faint" style={{ fontSize: '.75rem' }}>
          Net pay is worked out on the server — basic + HRA + special allowance + conveyance,
          less PF, TDS and LOP — and printed on the slip itself.
        </p>
      </fieldset>

      <fieldset>
        <legend>Statutory details</legend>
        <div className="fieldrow">
          {text('gen-pan', 'PAN number', 'pan_no', 'Saved back onto the employee record. Left blank, whatever is already stored stays.')}
          {text('gen-bank', 'Bank name', 'bank_name')}
        </div>
        <div className="fieldrow">
          {text('gen-account', 'Bank account no.', 'bank_account_no')}
          {text('gen-ifsc', 'Bank IFSC', 'bank_ifsc')}
        </div>
      </fieldset>
    </form>
  );
}
