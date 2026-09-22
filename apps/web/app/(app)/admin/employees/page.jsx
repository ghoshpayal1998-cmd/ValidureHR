'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Eye, Image as ImageIcon, KeyRound, Pencil, Plus, Search, Trash2, Users,
} from 'lucide-react';
import { api, fmtDate, getUser, hasPerm, initials, openProtectedFile } from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast,
} from '@/components/ui';

/*
 * The probation badge has to know what day it is, and the record it compares
 * against is a plain YYYY-MM-DD string. Taking today in Asia/Kolkata as a
 * string keeps the comparison on strings the whole way: the browser clock can
 * sit in any timezone, and parsing either side into a Date would shift the day
 * across the boundary the same way the server clock does.
 */
function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/* The server refuses anyone under 18, so the picker refuses them first.
 * Year arithmetic on the text, for the same reason as above. */
function minusYears(iso, years) {
  const [y, m, d] = iso.split('-');
  return `${Number(y) - years}-${m}-${d}`;
}

const BLANK = {
  emp_code: '', status: 'Active', first_name: '', last_name: '', email: '', phone: '',
  emergency_contact: '', doj: '', dob: '', department_id: '', designation_id: '',
  reporting_manager_id: '', probation_until: '', pan_no: '', bank_name: '',
  bank_account_no: '', bank_ifsc: '', role_id: '',
};

/* A date column arrives as YYYY-MM-DD; anything longer is trimmed rather than
 * parsed, because <input type="date"> wants exactly those ten characters. */
const day = (v) => (v ? String(v).slice(0, 10) : '');

function toForm(e) {
  return {
    emp_code: e.emp_code || '',
    status: e.status || 'Active',
    first_name: e.first_name || '',
    last_name: e.last_name || '',
    email: e.email || '',
    phone: e.phone || '',
    emergency_contact: e.emergency_contact || '',
    doj: day(e.doj),
    dob: day(e.dob),
    department_id: e.department_id ?? '',
    designation_id: e.designation_id ?? '',
    reporting_manager_id: e.reporting_manager_id ?? '',
    probation_until: day(e.probation_until),
    pan_no: e.pan_no || '',
    bank_name: e.bank_name || '',
    bank_account_no: e.bank_account_no || '',
    bank_ifsc: e.bank_ifsc || '',
    /* GET /employees does not return the linked login's role, so the select
     * starts unset and the role only changes when HR actually picks one —
     * PUT leaves it alone when role_id is absent. */
    role_id: '',
  };
}

export default function AdminEmployeesPage() {
  const toast = useToast();
  const canManage = hasPerm('employees.manage');
  /* GET /employees/:id/photo allows employees.manage or the employee
   * themselves. The session carries emp_code but no employee id, and the
   * roster rows carry emp_code too, so that is what the two are matched on. */
  const selfCode = getUser()?.employee?.emp_code || null;
  const today = todayIST();

  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');

  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');

  const [form, setForm] = useState(null);          // { mode, id, values }
  const [pw, setPw] = useState(null);              // { employee, value, error }
  const [photo, setPhoto] = useState(null);        // { employee, file }
  const [confirming, setConfirming] = useState(null); // { kind, employee }
  const [busy, setBusy] = useState(false);

  /*
   * The list and the dropdown data are fetched side by side and share one
   * error slot, so a single "Try again" recovers the screen. Meta is refetched
   * with the list on purpose: a new employee immediately becomes a possible
   * reporting manager, and a stale meta would leave them out of the select.
   */
  const load = () => {
    setError('');
    api(`/employees${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      .then(setRows)
      .catch((e) => setError(e.message));
    api('/employees/meta').then(setMeta).catch((e) => setError(e.message));
  };

  /* The server does the matching (code, name, email, department), so typing
   * settles for 250ms before it is asked. */
  useEffect(() => {
    const t = setTimeout(() => setQuery(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(load, [query]);

  const shown = useMemo(
    () => (rows || []).filter((e) => !dept || e.department === dept),
    [rows, dept],
  );

  const filtered = !!query || !!dept;

  /* ------------------------------------------------ mutations */

  async function saveEmployee(ev) {
    ev.preventDefault();
    const v = form.values;
    setBusy(true);
    try {
      const body = {
        ...v,
        phone: v.phone || null,
        emergency_contact: v.emergency_contact || null,
        department_id: v.department_id ? Number(v.department_id) : null,
        designation_id: v.designation_id ? Number(v.designation_id) : null,
        reporting_manager_id: v.reporting_manager_id ? Number(v.reporting_manager_id) : null,
        probation_until: v.probation_until || null,
        pan_no: v.pan_no || null,
        bank_name: v.bank_name || null,
        bank_account_no: v.bank_account_no || null,
        bank_ifsc: v.bank_ifsc || null,
        /* Undefined drops out of the JSON entirely, which is what leaves an
         * existing role untouched on edit and picks EMPLOYEE on add. */
        role_id: v.role_id ? Number(v.role_id) : undefined,
      };
      const res = form.mode === 'edit'
        ? await api(`/employees/${form.id}`, { method: 'PUT', body })
        : await api('/employees', { method: 'POST', body });
      /*
       * Creation answers 200 even when the welcome email bounced, and that
       * message is the only warning HR gets that the credentials never left
       * the building. It is surfaced as an error toast in its own words.
       */
      toast(res?.message || 'Employee saved', res?.emailed === false ? 'err' : 'ok');
      setForm(null);
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(ev) {
    ev.preventDefault();
    if (pw.value.length < 8) {
      setPw({ ...pw, error: 'Password must be at least 8 characters.' });
      return;
    }
    setBusy(true);
    try {
      const res = await api(`/employees/${pw.employee.id}/reset-password`, {
        method: 'POST', body: { newPassword: pw.value },
      });
      if (res?.emailed === false) {
        /* The mail carried the only copy and it did not go. The dialog stays
         * open so the typed password is still on screen to hand over. */
        toast(res.message, 'err');
        setPw({ ...pw, error: res.message });
      } else {
        toast(res?.message || 'Password reset', 'ok');
        setPw(null);
      }
      load();
    } catch (e) {
      toast(e.message, 'err');
      setPw({ ...pw, error: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(ev) {
    ev.preventDefault();
    if (!photo.file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', photo.file);
      const res = await api(`/employees/${photo.employee.id}/photo`, { method: 'POST', formData: fd });
      toast(res?.message || 'Photo uploaded', 'ok');
      setPhoto(null);
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmed() {
    const { kind, employee } = confirming;
    setBusy(true);
    try {
      const res = kind === 'delete'
        ? await api(`/employees/${employee.id}`, { method: 'DELETE' })
        : await api(`/employees/${employee.id}/end-probation`, { method: 'POST' });
      toast(res?.message || 'Done', 'ok');
      setConfirming(null);
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function viewPhoto(e) {
    try {
      await openProtectedFile(`/employees/${e.id}/photo`, false, `photo-${e.emp_code}`);
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  /* ------------------------------------------------ states */

  if (error && !rows) {
    return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;
  }

  const name = (e) => `${e.first_name} ${e.last_name}`;

  return (
    <div className="page">
      <PageHead
        eyebrow="Management"
        title="Employees"
        sub="Add, edit, search and manage employee accounts"
      >
        {canManage && (
          <button
            className="btn btn--primary"
            onClick={() => setForm({ mode: 'add', id: null, values: { ...BLANK } })}
          >
            <Plus size={16} aria-hidden="true" />Add employee
          </button>
        )}
      </PageHead>

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {/* A refetch that fails keeps the rows that did load on screen. */}
        {error && rows && <ErrorNote error={error} onRetry={load} />}

        <section className="card">
          <div className="filterbar">
            <span className="search">
              <Search size={16} aria-hidden="true" />
              <label className="sr" htmlFor="emp-search">Search employees</label>
              <input
                id="emp-search"
                className="input"
                type="search"
                value={term}
                onChange={(ev) => setTerm(ev.target.value)}
                placeholder="Search by name, code, email or department…"
              />
            </span>

            <label className="sr" htmlFor="emp-dept">Filter by department</label>
            <select
              id="emp-dept"
              className="select"
              value={dept}
              onChange={(ev) => setDept(ev.target.value)}
            >
              <option value="">All departments</option>
              {(meta?.departments || []).map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>

            <span className="spacer" />
            {rows && (
              <span className="faint" style={{ fontSize: '.75rem' }}>
                {shown.length} of {rows.length} shown
              </span>
            )}
          </div>

          {!rows ? (
            <Skeleton rows={6} />
          ) : shown.length === 0 ? (
            <Empty
              icon={Users}
              title={filtered ? 'No employees found' : 'Nobody on the roster yet'}
              body={
                filtered
                  ? 'Nothing matches that search or department. Every employee record in the company appears here, ordered by employee code.'
                  : 'Employees added here get a login account, a leave balance and a directory entry. The list appears once the first one exists.'
              }
              action={
                filtered ? (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => { setTerm(''); setDept(''); }}
                  >
                    Clear filters
                  </button>
                ) : canManage ? (
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={() => setForm({ mode: 'add', id: null, values: { ...BLANK } })}
                  >
                    <Plus size={16} aria-hidden="true" />Add employee
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Code</th>
                      <th scope="col">Name</th>
                      <th scope="col">Department</th>
                      <th scope="col">Designation</th>
                      <th scope="col">Manager</th>
                      <th scope="col">Status</th>
                      <th scope="col">Login</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => {
                      const full = name(e);
                      const onProbation = e.probation_until && day(e.probation_until) >= today;
                      return (
                        <tr key={e.id}>
                          <td className="mono" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {e.emp_code}
                          </td>
                          <td>
                            <span className="person">
                              <span className="avatar">{initials(full)}</span>
                              <span style={{ minWidth: 0 }}>
                                <span className="person__name" style={{ display: 'block' }}>{full}</span>
                                <span className="person__meta" style={{ fontFamily: 'var(--font-body)' }}>
                                  {e.email}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="muted">{e.department || '—'}</td>
                          <td className="muted">{e.designation || '—'}</td>
                          <td className="muted">{e.reporting_manager || '—'}</td>
                          <td>
                            <StatusBadge status={e.status} />
                            {onProbation && (
                              <span
                                className="row"
                                style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}
                              >
                                <span className="badge badge--warn">
                                  Probation → {fmtDate(e.probation_until)}
                                </span>
                                {canManage && (
                                  <button
                                    className="btn btn--quiet btn--sm"
                                    onClick={() => setConfirming({ kind: 'probation', employee: e })}
                                    title="End probation period immediately"
                                  >
                                    End
                                  </button>
                                )}
                              </span>
                            )}
                          </td>
                          <td>
                            {!e.user_id ? (
                              <StatusBadge status="No login" tone="neutral" />
                            ) : e.is_active ? (
                              <StatusBadge status="Enabled" tone="ok" />
                            ) : (
                              <StatusBadge status="Disabled" tone="neutral" />
                            )}
                          </td>
                          <td>
                            <span
                              className="row"
                              style={{ gap: 'var(--s1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}
                            >
                              {/* Offered only to someone the photo route will
                                  actually serve — otherwise the eye opened a blank
                                  tab, took a 403 and read as broken rather than
                                  unavailable. */}
                              {e.photo_file && (canManage || e.emp_code === selfCode) && (
                                <button
                                  className="iconbtn"
                                  onClick={() => viewPhoto(e)}
                                  aria-label={`View photo of ${full}`}
                                  title="View photo"
                                >
                                  <Eye size={16} aria-hidden="true" />
                                </button>
                              )}
                              {canManage && (
                                <>
                                  <button
                                    className="iconbtn"
                                    onClick={() => setPhoto({ employee: e, file: null })}
                                    aria-label={`Upload photo for ${full}`}
                                    title="Upload photo"
                                  >
                                    <ImageIcon size={16} aria-hidden="true" />
                                  </button>
                                  <button
                                    className="iconbtn"
                                    onClick={() => setForm({ mode: 'edit', id: e.id, values: toForm(e) })}
                                    aria-label={`Edit ${full}`}
                                    title="Edit"
                                  >
                                    <Pencil size={16} aria-hidden="true" />
                                  </button>
                                  <button
                                    className="iconbtn"
                                    onClick={() => setPw({ employee: e, value: '', error: '' })}
                                    aria-label={`Reset password for ${full}`}
                                    title="Reset password"
                                  >
                                    <KeyRound size={16} aria-hidden="true" />
                                  </button>
                                  <button
                                    className="iconbtn"
                                    onClick={() => setConfirming({ kind: 'delete', employee: e })}
                                    aria-label={`Delete ${full}`}
                                    title="Delete employee"
                                    style={{ color: 'var(--err-text)' }}
                                  >
                                    <Trash2 size={16} aria-hidden="true" />
                                  </button>
                                </>
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

      {/* ------------------------------------------------ add / edit */}
      {form && (
        <Modal
          wide
          title={form.mode === 'edit' ? 'Edit employee' : 'Add employee'}
          sub={form.mode === 'edit' ? form.values.emp_code : 'Creates the record and the login account'}
          onClose={() => !busy && setForm(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="employee-form" disabled={busy}>
                {busy ? 'Saving…' : 'Save employee'}
              </button>
            </>
          }
        >
          <EmployeeForm
            form={form}
            setForm={setForm}
            meta={meta}
            today={today}
            onSubmit={saveEmployee}
          />
        </Modal>
      )}

      {/* ------------------------------------------------ reset password */}
      {pw && (
        <Modal
          title="Reset password"
          sub={`${name(pw.employee)} (${pw.employee.emp_code})`}
          onClose={() => !busy && setPw(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setPw(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="reset-form" disabled={busy}>
                {busy ? 'Resetting…' : 'Reset password'}
              </button>
            </>
          }
        >
          <form id="reset-form" onSubmit={resetPassword} className="stack">
            <p className="muted" style={{ fontSize: '.875rem' }}>
              Set a new password for <b>{name(pw.employee)}</b> ({pw.employee.emp_code}).
            </p>
            <Field
              id="new-password"
              label="New password"
              required
              error={pw.error}
              help="The new password is emailed to the employee automatically. It is shown here in plain text as well, so you can pass it on if the email does not arrive — you will be told either way."
            >
              {/* Deliberately not masked: HR has to be able to read it back out
                  to the employee when the mail does not arrive. */}
              <input
                id="new-password"
                className="input"
                type="text"
                autoComplete="off"
                spellCheck="false"
                placeholder="At least 8 characters"
                value={pw.value}
                onChange={(ev) => setPw({ ...pw, value: ev.target.value, error: '' })}
                aria-invalid={pw.error ? 'true' : undefined}
              />
            </Field>
            <p className="faint" style={{ fontSize: '.75rem' }}>
              Common defaults such as <span className="mono">Welcome@123</span> are rejected. The
              employee must change it at first login, and any account lockout is cleared.
            </p>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------ photo */}
      {photo && (
        <Modal
          title="Upload employee photo"
          sub={`${name(photo.employee)} (${photo.employee.emp_code})`}
          onClose={() => !busy && setPhoto(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setPhoto(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="photo-form" disabled={busy}>
                {busy ? 'Uploading…' : 'Upload photo'}
              </button>
            </>
          }
        >
          <form id="photo-form" onSubmit={uploadPhoto} className="stack">
            <p className="muted" style={{ fontSize: '.875rem' }}>
              Upload a profile photo for <b>{name(photo.employee)}</b>.
            </p>
            <Field
              id="photo-file"
              label="Photo file"
              required
              help="JPEG, PNG, WebP or HEIC. It replaces any photo already on the record."
            >
              <input
                id="photo-file"
                className="input"
                type="file"
                required
                accept="image/jpeg,image/png,image/webp,image/heic"
                onChange={(ev) => setPhoto({ ...photo, file: ev.target.files?.[0] || null })}
              />
            </Field>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------ confirmations */}
      {confirming?.kind === 'delete' && (
        <ConfirmModal
          danger
          title="Delete employee"
          body={`Delete ${confirming.employee.emp_code} (${name(confirming.employee)}) and all their records? This removes their attendance, leave applications, leave balances, leave ledger, salary slips, offer letters and login account, and clears them as anyone else's reporting manager. This cannot be undone.`}
          confirmLabel="Delete employee"
          busy={busy}
          onConfirm={runConfirmed}
          onClose={() => !busy && setConfirming(null)}
        />
      )}
      {confirming?.kind === 'probation' && (
        <ConfirmModal
          title="End probation"
          body={`Confirm ending probation for ${name(confirming.employee)}? Their probation date is cleared straight away, which unlocks the leave balance and lifts the unpaid-leave-only restriction.`}
          confirmLabel="End probation"
          busy={busy}
          onConfirm={runConfirmed}
          onClose={() => !busy && setConfirming(null)}
        />
      )}
    </div>
  );
}

/* ============================================================ the form */

function EmployeeForm({ form, setForm, meta, today, onSubmit }) {
  const v = form.values;
  const edit = form.mode === 'edit';
  const set = (patch) => setForm({ ...form, values: { ...v, ...patch } });

  /* Nobody under 18 — the same rule the server enforces, applied to the
   * picker so the form cannot be submitted into a rejection. */
  const dobMax = minusYears(today, 18);

  const managers = (meta?.managers || []).filter((m) => m.id !== form.id);

  return (
    <form id="employee-form" onSubmit={onSubmit} className="stack" style={{ gap: 'var(--s5)' }}>
      <fieldset>
        <legend>Record</legend>
        <div className="fieldrow">
          <Field
            id="f-emp_code"
            label="Employee code"
            required
            help={edit ? 'The code is the login username and cannot be changed.' : 'Becomes the login username.'}
          >
            <input
              id="f-emp_code"
              className="input"
              required
              disabled={edit}
              placeholder="VS-0125"
              value={v.emp_code}
              onChange={(ev) => set({ emp_code: ev.target.value })}
            />
          </Field>
          {/* Status is offered only when editing. POST /employees hard-codes
              'Active' on insert, so a picker here would take HR's choice,
              discard it, and hand the new joiner a working login under a
              help line promising the opposite. */}
          {edit ? (
            <Field id="f-status" label="Status" required help="Inactive also disables the login.">
              <select
                id="f-status"
                className="select"
                value={v.status}
                onChange={(ev) => set({ status: ev.target.value })}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </Field>
          ) : (
            <div className="field">
              <span className="label">Status</span>
              <p className="help" style={{ marginTop: 'var(--s2)' }}>
                A new employee is created <b>Active</b> and is sent a one-time
                password. Deactivate them from this form afterwards if you need to.
              </p>
            </div>
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend>Contact</legend>
        <div className="fieldrow">
          <Field id="f-first_name" label="First name" required>
            <input
              id="f-first_name"
              className="input"
              required
              value={v.first_name}
              onChange={(ev) => set({ first_name: ev.target.value })}
            />
          </Field>
          <Field id="f-last_name" label="Last name" required>
            <input
              id="f-last_name"
              className="input"
              required
              value={v.last_name}
              onChange={(ev) => set({ last_name: ev.target.value })}
            />
          </Field>
        </div>
        <div className="fieldrow">
          <Field
            id="f-email"
            label="Email"
            required
            help="Must be unused across the whole platform, not just this company."
          >
            <input
              id="f-email"
              className="input"
              type="email"
              required
              value={v.email}
              onChange={(ev) => set({ email: ev.target.value })}
            />
          </Field>
          <Field id="f-phone" label="Phone">
            <input
              id="f-phone"
              className="input"
              value={v.phone}
              onChange={(ev) => set({ phone: ev.target.value })}
            />
          </Field>
        </div>
        <Field id="f-emergency_contact" label="Emergency contact">
          <input
            id="f-emergency_contact"
            className="input"
            placeholder="e.g. 9876543210"
            value={v.emergency_contact}
            onChange={(ev) => set({ emergency_contact: ev.target.value })}
          />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Placement</legend>
        <div className="fieldrow">
          <Field
            id="f-doj"
            label="Date of joining"
            required
            help="Months already worked are credited as an opening leave balance."
          >
            <input
              id="f-doj"
              className="input"
              type="date"
              required
              value={v.doj}
              onChange={(ev) => set({ doj: ev.target.value })}
            />
          </Field>
          <Field id="f-dob" label="Date of birth" required help="Must be 18 or older.">
            <input
              id="f-dob"
              className="input"
              type="date"
              required
              max={dobMax}
              value={v.dob}
              onChange={(ev) => set({ dob: ev.target.value })}
            />
          </Field>
        </div>
        <div className="fieldrow">
          <Field id="f-department_id" label="Department">
            <select
              id="f-department_id"
              className="select"
              value={v.department_id}
              onChange={(ev) => set({ department_id: ev.target.value })}
            >
              <option value="">None / select department</option>
              {(meta?.departments || []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field id="f-designation_id" label="Designation">
            <select
              id="f-designation_id"
              className="select"
              value={v.designation_id}
              onChange={(ev) => set({ designation_id: ev.target.value })}
            >
              <option value="">None / select designation</option>
              {(meta?.designations || []).map((d) => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          id="f-reporting_manager_id"
          label="Reporting manager"
          help="Any employee can be a manager — add the manager as an employee first, then select them here."
        >
          <select
            id="f-reporting_manager_id"
            className="select"
            value={v.reporting_manager_id}
            onChange={(ev) => set({ reporting_manager_id: ev.target.value })}
          >
            <option value="">{managers.length ? '—' : 'No employees yet'}</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>{m.emp_code} — {m.name}</option>
            ))}
          </select>
        </Field>
        <Field
          id="f-probation_until"
          label="Probation until"
          help="While on probation: unpaid leave only, leave balance locked (no accrual, no deduction)."
        >
          <span className="row" style={{ gap: 'var(--s3)' }}>
            <input
              id="f-probation_until"
              className="input"
              type="date"
              style={{ flex: '1 1 auto' }}
              value={v.probation_until}
              onChange={(ev) => set({ probation_until: ev.target.value })}
            />
            {v.probation_until && (
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => set({ probation_until: '' })}
                title="Remove probation"
              >
                Clear
              </button>
            )}
          </span>
        </Field>
      </fieldset>

      <fieldset>
        <legend>Payroll details</legend>
        <div className="fieldrow">
          <Field id="f-pan_no" label="PAN number">
            <input
              id="f-pan_no"
              className="input mono"
              value={v.pan_no}
              onChange={(ev) => set({ pan_no: ev.target.value })}
            />
          </Field>
          <Field id="f-bank_name" label="Bank name">
            <input
              id="f-bank_name"
              className="input"
              value={v.bank_name}
              onChange={(ev) => set({ bank_name: ev.target.value })}
            />
          </Field>
        </div>
        <div className="fieldrow">
          <Field id="f-bank_account_no" label="Bank account no.">
            <input
              id="f-bank_account_no"
              className="input mono"
              value={v.bank_account_no}
              onChange={(ev) => set({ bank_account_no: ev.target.value })}
            />
          </Field>
          <Field id="f-bank_ifsc" label="Bank IFSC">
            <input
              id="f-bank_ifsc"
              className="input mono"
              value={v.bank_ifsc}
              onChange={(ev) => set({ bank_ifsc: ev.target.value })}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>Access</legend>
        <Field
          id="f-role_id"
          label="User role"
          help={
            edit
              ? 'HR and DIRECTOR can approve leave. Leave this unset to keep the role the account already has.'
              : 'HR and DIRECTOR can approve leave. Custom roles are defined by the admin in Roles & Access.'
          }
        >
          <select
            id="f-role_id"
            className="select"
            value={v.role_id}
            onChange={(ev) => set({ role_id: ev.target.value })}
          >
            <option value="">EMPLOYEE (default)</option>
            {(meta?.roles || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{r.is_system ? '' : ' (custom)'}
              </option>
            ))}
          </select>
        </Field>
        {!edit && (
          <p className="faint" style={{ fontSize: '.75rem' }}>
            A login account is created automatically (username = employee code) with a randomly
            generated temporary password, which is emailed to the employee along with the employee
            manual. They are required to change it at first login.
          </p>
        )}
      </fieldset>
    </form>
  );
}
