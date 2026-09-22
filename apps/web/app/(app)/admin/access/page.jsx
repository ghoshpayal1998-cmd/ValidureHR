'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock, Pencil, Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { api, getUser, initials } from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast,
} from '@/components/ui';

/*
 * The catalogue comes back as a flat list of dotted keys. The prefix before
 * the dot is the only grouping the API actually gives us, so the checklist is
 * built from it rather than from a hand-kept map here — a permission added
 * server-side then appears under its own heading on its own, instead of
 * quietly falling out of the list.
 */
function groupPerms(perms) {
  const groups = [];
  for (const p of perms || []) {
    const area = String(p.key).split('.')[0];
    let g = groups.find((x) => x.area === area);
    if (!g) {
      g = { area, label: area.charAt(0).toUpperCase() + area.slice(1), items: [] };
      groups.push(g);
    }
    g.items.push(p);
  }
  return groups;
}

/*
 * One checklist, two dialogs. `locked` holds the keys a user already gets
 * from their role: those tick themselves and cannot be cleared, because the
 * grant endpoint only stores the *extra* permissions and unticking one here
 * would suggest it takes the role permission away.
 */
function PermissionChecklist({ groups, checked, locked = [], onToggle, idPrefix }) {
  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      {groups.map((g) => (
        <fieldset key={g.area}>
          <legend>{g.label}</legend>
          <div className="fieldrow">
            {g.items.map((p) => {
              const fromRole = locked.includes(p.key);
              const id = `${idPrefix}-${p.key}`;
              return (
                <label
                  className="checkline"
                  htmlFor={id}
                  key={p.key}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-sm)',
                    padding: 'var(--s3)',
                    background: fromRole ? 'var(--surface)' : 'var(--raised)',
                    cursor: fromRole ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={fromRole || checked.includes(p.key)}
                    disabled={fromRole}
                    onChange={() => onToggle(p.key)}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span className="mono" style={{ display: 'block', fontSize: '.8125rem', fontWeight: 600 }}>
                      {p.key}
                    </span>
                    <span className="faint" style={{ fontSize: '.75rem' }}>
                      {p.label}{fromRole ? ' · from role' : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export default function AdminAccessPage() {
  const toast = useToast();
  /*
   * Roles are readable by anyone who can see employees, but every write here
   * — and the whole user list — is platform-admin only. The actions a tenant
   * user cannot take are absent rather than present and failing on click.
   */
  const isAdmin = !!getUser()?.admin;

  const [perms, setPerms] = useState(null);
  const [roles, setRoles] = useState(null);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [usersError, setUsersError] = useState('');

  const [roleForm, setRoleForm] = useState(null);   // { id, name, permissions, error }
  const [grant, setGrant] = useState(null);         // { user, permissions }
  const [confirming, setConfirming] = useState(null); // role being deleted
  const [busy, setBusy] = useState(false);

  /* The user list has its own error slot: a 403 there is the expected answer
   * for a non-admin and must not blank out the roles table beside it. */
  const loadUsers = () => {
    setUsersError('');
    api('/access/users').then(setUsers).catch((e) => setUsersError(e.message));
  };

  const load = () => {
    setError('');
    api('/access/permissions').then(setPerms).catch((e) => setError(e.message));
    api('/access/roles').then(setRoles).catch((e) => setError(e.message));
    if (isAdmin) loadUsers();
  };
  useEffect(load, []);

  const groups = useMemo(() => groupPerms(perms), [perms]);

  /* ------------------------------------------------ mutations */

  async function saveRole(ev) {
    ev.preventDefault();
    const name = roleForm.name.trim();
    if (!name) {
      setRoleForm({ ...roleForm, error: 'Give the role a name.' });
      return;
    }
    setBusy(true);
    try {
      const body = { name, permissions: roleForm.permissions };
      const res = roleForm.id
        ? await api(`/access/roles/${roleForm.id}`, { method: 'PUT', body })
        : await api('/access/roles', { method: 'POST', body });
      toast(res?.message || 'Role saved', 'ok');
      setRoleForm(null);
      /* Changing a role changes what its holders get "from role", so the user
       * table is reloaded alongside it, not just the role list. */
      load();
    } catch (e) {
      toast(e.message, 'err');
      setRoleForm({ ...roleForm, error: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function removeRole() {
    setBusy(true);
    try {
      const res = await api(`/access/roles/${confirming.id}`, { method: 'DELETE' });
      toast(res?.message || 'Role deleted', 'ok');
      setConfirming(null);
      load();
    } catch (e) {
      /* The server still refuses a role somebody holds — that message names
       * the number of users, so it is worth showing verbatim. */
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function saveGrants(ev) {
    ev.preventDefault();
    setBusy(true);
    try {
      const res = await api(`/access/users/${grant.user.id}`, {
        method: 'PUT', body: { permissions: grant.permissions },
      });
      toast(res?.message || 'Access updated', 'ok');
      setGrant(null);
      loadUsers();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------ states */

  if (error && !roles) {
    return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;
  }

  const toggleRolePerm = (key) => setRoleForm((f) => ({
    ...f,
    error: '',
    permissions: f.permissions.includes(key)
      ? f.permissions.filter((k) => k !== key)
      : [...f.permissions, key],
  }));

  const toggleGrant = (key) => setGrant((g) => ({
    ...g,
    permissions: g.permissions.includes(key)
      ? g.permissions.filter((k) => k !== key)
      : [...g.permissions, key],
  }));

  const grantLocked = grant ? (grant.user.role_permissions || []) : [];
  const grantFullyCovered = !!grant
    && groups.length > 0
    && groups.every((g) => g.items.every((p) => grantLocked.includes(p.key)));

  return (
    <div className="page">
      <PageHead
        eyebrow="Management"
        title="Roles & Access"
        sub="Define company roles with permission sets, and grant extra access to individual users"
      >
        {isAdmin && (
          <button
            className="btn btn--primary"
            onClick={() => setRoleForm({ id: null, name: '', permissions: [], error: '' })}
            disabled={!perms}
          >
            <Plus size={16} aria-hidden="true" />New role
          </button>
        )}
      </PageHead>

      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {/* A refetch that fails keeps the rows that did load on screen. */}
        {error && roles && <ErrorNote error={error} onRetry={load} />}

        {/* ------------------------------------------------ roles */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                <span className="row" style={{ gap: 'var(--s2)' }}>
                  <ShieldCheck size={18} aria-hidden="true" style={{ color: 'var(--accent)' }} />
                  Roles
                </span>
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                System roles first, then custom ones. Names are stored in capitals.
              </p>
            </div>
            {roles && (
              <span className="faint" style={{ fontSize: '.75rem' }}>
                {roles.length} {roles.length === 1 ? 'role' : 'roles'}
              </span>
            )}
          </div>

          {!roles ? (
            <Skeleton rows={5} />
          ) : roles.length === 0 ? (
            <Empty
              icon={ShieldCheck}
              title="No roles in this company"
              body="Every company schema is created with OWNER, DIRECTOR, HR and EMPLOYEE. Roles and the permissions they carry appear here once they exist."
            />
          ) : (
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Type</th>
                      <th scope="col">Permissions</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</td>
                        <td>
                          <StatusBadge
                            status={r.is_system ? 'System' : 'Custom'}
                            tone={r.is_system ? 'info' : 'neutral'}
                          />
                        </td>
                        <td>
                          {r.permissions?.length ? (
                            <span
                              className="row row--wrap"
                              style={{ gap: 'var(--s1)', maxWidth: '32rem' }}
                            >
                              {r.permissions.map((k) => (
                                <span className="badge badge--neutral badge--plain mono" key={k}>{k}</span>
                              ))}
                            </span>
                          ) : (
                            <span className="faint" style={{ fontSize: '.75rem' }}>Self-service only</span>
                          )}
                        </td>
                        <td>
                          <span
                            className="row"
                            style={{ gap: 'var(--s1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}
                          >
                            {/* The server refuses to edit or delete a system role, so
                                the buttons are not offered for one — the constraint is
                                stated in the cell instead of arriving as a failed
                                request after the click. */}
                            {r.is_system ? (
                              <span
                                className="row faint"
                                style={{ gap: 'var(--s2)', fontSize: '.75rem', whiteSpace: 'nowrap' }}
                              >
                                <Lock size={13} aria-hidden="true" />Built in
                              </span>
                            ) : isAdmin ? (
                              <>
                                <button
                                  className="iconbtn"
                                  onClick={() => setRoleForm({
                                    id: r.id,
                                    name: r.name,
                                    permissions: [...(r.permissions || [])],
                                    error: '',
                                  })}
                                  aria-label={`Edit role ${r.name}`}
                                  title="Edit"
                                >
                                  <Pencil size={16} aria-hidden="true" />
                                </button>
                                <button
                                  className="iconbtn"
                                  onClick={() => setConfirming(r)}
                                  aria-label={`Delete role ${r.name}`}
                                  title="Delete role"
                                  style={{ color: 'var(--err-text)' }}
                                >
                                  <Trash2 size={16} aria-hidden="true" />
                                </button>
                              </>
                            ) : null}
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

        {/* ------------------------------------------------ per-user grants */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                <span className="row" style={{ gap: 'var(--s2)' }}>
                  <UserCog size={18} aria-hidden="true" style={{ color: 'var(--accent)' }} />
                  Per-user access grants
                </span>
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Extra permissions on top of a user’s role. The matching screens stay hidden until granted here.
              </p>
            </div>
            {users && (
              <span className="faint" style={{ fontSize: '.75rem' }}>
                {users.length} {users.length === 1 ? 'user' : 'users'}
              </span>
            )}
          </div>

          {!isAdmin ? (
            <Empty
              icon={Lock}
              title="Platform admins only"
              body="The list of login accounts and their extra grants is platform-level. Signed in to a company you can see the roles above, but not layer permissions onto individual users."
            />
          ) : usersError ? (
            <div className="card__body"><ErrorNote error={usersError} onRetry={loadUsers} /></div>
          ) : !users ? (
            <Skeleton rows={5} />
          ) : users.length === 0 ? (
            <Empty
              icon={UserCog}
              title="No login accounts yet"
              body="Every employee with a login appears here with their role and any extra permissions granted on top of it."
            />
          ) : (
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col">Role</th>
                      <th scope="col">Extra grants</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      /* A login without a linked employee record has no name,
                         so the username stands in for it everywhere. */
                      const who = u.name || u.username;
                      return (
                        <tr key={u.id}>
                          <td>
                            <span className="person">
                              <span className="avatar">{initials(who)}</span>
                              <span style={{ minWidth: 0 }}>
                                <span className="person__name" style={{ display: 'block' }}>{who}</span>
                                <span className="person__meta" style={{ fontFamily: 'var(--font-body)' }}>
                                  {u.email || u.username}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td>
                            {u.role
                              ? <StatusBadge status={u.role} tone="info" />
                              : <StatusBadge status="No role" tone="neutral" />}
                          </td>
                          <td>
                            {u.extra_permissions?.length ? (
                              <span
                                className="row row--wrap"
                                style={{ gap: 'var(--s1)', maxWidth: '24rem' }}
                              >
                                {u.extra_permissions.map((k) => (
                                  <span className="badge badge--warn badge--plain mono" key={k}>{k}</span>
                                ))}
                              </span>
                            ) : (
                              <span className="faint" style={{ fontSize: '.75rem' }}>None</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn--ghost btn--sm"
                              onClick={() => setGrant({
                                user: u,
                                permissions: [...(u.extra_permissions || [])],
                              })}
                              disabled={!perms}
                            >
                              Edit access
                            </button>
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

      {/* ------------------------------------------------ new / edit role */}
      {roleForm && (
        <Modal
          wide
          title={roleForm.id ? 'Edit role' : 'New role'}
          sub={roleForm.id ? roleForm.name : 'A custom role carries whatever permissions you tick'}
          onClose={() => !busy && setRoleForm(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setRoleForm(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="role-form" disabled={busy}>
                {busy ? 'Saving…' : 'Save role'}
              </button>
            </>
          }
        >
          <form id="role-form" onSubmit={saveRole} className="stack" style={{ gap: 'var(--s5)' }}>
            <Field
              id="role-name"
              label="Role name"
              required
              error={roleForm.error}
              help="Saved in capitals — “team lead” is stored as TEAM LEAD."
            >
              <input
                id="role-name"
                className="input"
                value={roleForm.name}
                onChange={(ev) => setRoleForm({ ...roleForm, name: ev.target.value, error: '' })}
                placeholder="e.g. TEAM LEAD"
                autoComplete="off"
                required
              />
            </Field>

            <div className="stack" style={{ gap: 'var(--s3)' }}>
              <p className="label">Permissions</p>
              {groups.length ? (
                <PermissionChecklist
                  groups={groups}
                  checked={roleForm.permissions}
                  onToggle={toggleRolePerm}
                  idPrefix="role-perm"
                />
              ) : (
                <p className="muted" style={{ fontSize: '.875rem' }}>
                  The permission catalogue has not loaded. Close this, retry the page, and the
                  checklist fills in.
                </p>
              )}
              <p className="faint" style={{ fontSize: '.75rem' }}>
                {roleForm.permissions.length} of {perms?.length ?? 0} selected. A role with none is
                self-service only.
              </p>
            </div>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------ access grants */}
      {grant && (
        <Modal
          wide
          title="Access grants"
          sub={grant.user.name || grant.user.username}
          onClose={() => !busy && setGrant(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setGrant(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" form="grant-form" disabled={busy}>
                {busy ? 'Saving…' : 'Save access'}
              </button>
            </>
          }
        >
          <form id="grant-form" onSubmit={saveGrants} className="stack" style={{ gap: 'var(--s5)' }}>
            <p className="muted" style={{ fontSize: '.875rem' }}>
              Permissions already provided by the{' '}
              {grant.user.role
                ? <StatusBadge status={grant.user.role} tone="info" />
                : <StatusBadge status="No role" tone="neutral" />}{' '}
              role are ticked and locked. Saving replaces this user’s extra grants — it does not
              add to them.
            </p>

            {grantFullyCovered && (
              <p className="muted" style={{ fontSize: '.875rem' }}>
                This role already carries every permission there is, so there is nothing left to
                grant on top of it.
              </p>
            )}

            {groups.length ? (
              <PermissionChecklist
                groups={groups}
                checked={grant.permissions}
                locked={grantLocked}
                onToggle={toggleGrant}
                idPrefix="grant-perm"
              />
            ) : (
              <p className="muted" style={{ fontSize: '.875rem' }}>
                The permission catalogue has not loaded. Close this, retry the page, and the
                checklist fills in.
              </p>
            )}

            <p className="faint" style={{ fontSize: '.75rem' }}>
              {grant.permissions.length} extra{' '}
              {grant.permissions.length === 1 ? 'permission' : 'permissions'} on top of the role.
            </p>
          </form>
        </Modal>
      )}

      {/* ------------------------------------------------ delete role */}
      {confirming && (
        <ConfirmModal
          danger
          title="Delete role"
          body={`Delete the role ${confirming.name}? It disappears from the role list for this company. A role that users still hold cannot be deleted — the server will say how many hold it.`}
          confirmLabel="Delete role"
          busy={busy}
          onConfirm={removeRole}
          onClose={() => !busy && setConfirming(null)}
        />
      )}
    </div>
  );
}
