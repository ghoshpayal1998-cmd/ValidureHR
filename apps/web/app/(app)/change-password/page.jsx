'use client';

import { useEffect, useState } from 'react';
import { Check, Clock, Eye, EyeOff, KeyRound, Mail, ShieldCheck, UserRound, X } from 'lucide-react';
import { api, initials } from '@/lib/api';
import {
  ConfirmModal, Empty, ErrorNote, Field, Modal, PageHead, Skeleton, StatusBadge, useToast,
} from '@/components/ui';

/*
 * The service refuses these outright, whatever else they satisfy. The list is
 * validatePassword() in the API, mirrored here so the refusal appears as you
 * type rather than after a round trip.
 *
 * Matched exactly as written, because that is what the server does. Blocking
 * case variants as well would be stricter than the service and would refuse a
 * password the API would have accepted -- a client that invents rules is worse
 * than one that enforces none.
 */
const BLOCKED = ['Welcome@123', 'Admin@123', 'password', 'Password1', '12345678', 'changeme'];

const MIN_LEN = 8;
const MAX_LEN = 200;

/*
 * The rules are listed, not merely enforced: a meter on its own says a password
 * is weak without saying what would fix it. The three marked `required` are the
 * ones the API itself refuses; the rest are what separates a password that
 * passes from one worth having.
 */
const RULES = [
  { text: `At least ${MIN_LEN} characters`, required: true, test: (v) => v.length >= MIN_LEN },
  { text: 'An upper and a lower case letter', test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { text: 'At least one number', test: (v) => /\d/.test(v) },
  { text: 'At least one symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
  { text: 'Not one of the blocked common passwords', required: true, test: (v) => !!v && !BLOCKED.includes(v) },
  { text: 'Different from your current password', required: true, test: (v, cur) => !!v && v !== cur },
];

/* Share of the rules met, with a bonus for length -- a long passphrase is
 * stronger than a short string that happens to tick every box. */
function strengthOf(next, current) {
  if (!next) return { pct: 0, label: '—', tone: '' };
  const met = RULES.filter((r) => r.test(next, current)).length;
  const bonus = next.length >= 14 ? 15 : next.length >= 11 ? 8 : 0;
  const pct = Math.min(Math.round((met / RULES.length) * 85) + bonus, 100);
  return {
    pct,
    label: pct < 45 ? 'Weak' : pct < 75 ? 'Fair' : pct < 95 ? 'Good' : 'Strong',
    tone: pct < 45 ? 'err' : pct < 75 ? 'warn' : '',
  };
}

/* One reveal button per field, so the three fields uncover independently. */
function Reveal({ shown, label, onToggle }) {
  const Icon = shown ? EyeOff : Eye;
  return (
    <button
      className="iconbtn"
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={`${shown ? 'Hide' : 'Show'} ${label}`}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

export default function ChangePasswordPage() {
  const toast = useToast();
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState({ current: false, next: false, confirm: false });

  const [notice, setNotice] = useState(null);   // { kind: 'ok' | 'err', text }
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);

  /* The form itself has nothing to fetch, but the account it belongs to does:
   * /auth/me is the live record, so the screen names whoever is actually signed
   * in and knows whether they are still on a temporary password. Changing the
   * password clears that flag server-side, which is what the refetch picks up. */
  const load = () => {
    setError('');
    api('/auth/me').then(setMe).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const reveal = (key) => setShown((s) => ({ ...s, [key]: !s[key] }));

  /* Mismatch is a client-side fact: it never needs the network to be known, and
   * it is shown under the field as you type, not only on submit. */
  const mismatch = confirm.length > 0 && confirm !== next;
  const meter = strengthOf(next, current);

  /* Every refusal below is copy the API would have returned, checked in the
   * same order, so the message does not change once the request is real. */
  function refusal() {
    if (!current || !next) return 'Both current and new password are required';
    if (next !== confirm) return 'New password and confirmation do not match';
    if (next.length < MIN_LEN) return `Password must be at least ${MIN_LEN} characters`;
    if (next.length > MAX_LEN) return 'Password is too long';
    if (BLOCKED.includes(next)) return 'That password is too common — please choose another';
    if (next === current) return 'The new password must be different from the current one';
    return '';
  }

  function onSubmit(e) {
    e.preventDefault();
    const bad = refusal();
    if (bad) {
      /* Refused here, so nothing is posted -- a mismatch must never cost a
       * round trip, and the rate limiter on this route counts attempts. */
      setNotice({ kind: 'err', text: bad });
      return;
    }
    setNotice(null);
    setConfirming(true);
  }

  async function change() {
    setBusy(true);
    try {
      const res = await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      const message = res?.message || 'Password changed successfully';
      toast(message, 'ok');
      setNotice({ kind: 'ok', text: message });
      setCurrent('');
      setNext('');
      setConfirm('');
      setShown({ current: false, next: false, confirm: false });
      setConfirming(false);
      load();
    } catch (e) {
      /* The fields keep their values: retyping a long password because the
       * current one was mistyped is its own small punishment. */
      toast(e.message, 'err');
      setNotice({ kind: 'err', text: e.message });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!me) {
    return (
      <div className="page">
        <PageHead eyebrow="Account" title="Change Password" />
        <div className="card" style={{ width: 'min(32rem, 100%)', marginInline: 'auto' }}>
          <Skeleton rows={4} />
        </div>
      </div>
    );
  }

  const employee = me.employee || null;
  const name = employee ? `${employee.first_name} ${employee.last_name}` : me.username;
  const notifyEmail = employee?.email || me.email;

  return (
    <div className="page">
      {/* The form is the only thing on this screen, so the head sits over the
          column rather than stretching across an otherwise empty page. */}
      <div style={{ width: 'min(32rem, 100%)', marginInline: 'auto' }}>
        <PageHead eyebrow="Account" title="Change Password" sub="Update your account password" />
      </div>

      <div className="stack" style={{ gap: 'var(--s5)', width: 'min(32rem, 100%)', marginInline: 'auto' }}>
        {me.must_change_password && (
          <div className="card" style={{ borderColor: 'var(--warn)' }}>
            <div className="card__body row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
              <KeyRound size={18} aria-hidden="true" style={{ color: 'var(--warn)', flex: 'none', marginTop: 2 }} />
              <p style={{ fontSize: '.875rem' }}>
                <b>You are signed in with a temporary password</b> — the one HR issued when this
                account was created or reset. Changing it here is what ends that window.
              </p>
            </div>
          </div>
        )}

        {/* ------------------------------------------------ the form */}
        <section className="card">
          <div className="card__head">
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                New password
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>Confirm the current one first</p>
            </div>
            <span className="person">
              <span className="avatar">{initials(name)}</span>
              <span style={{ minWidth: 0 }}>
                <span className="person__name" style={{ display: 'block' }}>{name}</span>
                <span className="person__meta">{employee?.emp_code || me.username}</span>
              </span>
            </span>
          </div>

          <div className="card__body">
            {/* One alert at a time: submitting clears whatever was there. */}
            {notice && (
              <div
                className="chip"
                role={notice.kind === 'ok' ? 'status' : 'alert'}
                style={{
                  width: '100%', alignItems: 'flex-start', gap: 'var(--s2)',
                  borderColor: 'transparent', marginBottom: 'var(--s4)',
                  background: notice.kind === 'ok' ? 'var(--ok-soft)' : 'var(--err-soft)',
                  color: notice.kind === 'ok' ? 'var(--ok)' : 'var(--err-text)',
                }}
              >
                {notice.kind === 'ok'
                  ? <Check size={15} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
                  : <X size={15} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />}
                <span>{notice.text}</span>
              </div>
            )}

            {/* noValidate: the screen paints the service's own copy rather than
                letting the browser bubble a different wording over it. */}
            {/* method="post" matters for the path where React has not
                hydrated yet — a bad chunk, a script error, or simply a
                person pressing Enter on a slow connection before the
                handler is attached. Without it the browser falls back to
                its default GET and puts the password in the URL, the
                history, the Referer header and any proxy log on the way.
                submit() calls preventDefault first, so this never fires
                once the page is live. */}
            <form method="post" onSubmit={onSubmit} noValidate>
              <div className="stack" style={{ gap: 'var(--s5)' }}>
                <Field id="cur-pw" label="Current password" required>
                  <div className="pwwrap">
                    <input
                      className="input"
                      id="cur-pw"
                      type={shown.current ? 'text' : 'password'}
                      value={current}
                      onChange={(e) => setCurrent(e.target.value)}
                      autoComplete="current-password"
                      spellCheck="false"
                    />
                    <Reveal shown={shown.current} label="current password" onToggle={() => reveal('current')} />
                  </div>
                </Field>

                <div className="stack" style={{ gap: 'var(--s3)' }}>
                  <Field id="new-pw" label="New password" required help={`Minimum ${MIN_LEN} characters.`}>
                    <div className="pwwrap">
                      <input
                        className="input"
                        id="new-pw"
                        type={shown.next ? 'text' : 'password'}
                        value={next}
                        onChange={(e) => setNext(e.target.value)}
                        autoComplete="new-password"
                        spellCheck="false"
                      />
                      <Reveal shown={shown.next} label="new password" onToggle={() => reveal('next')} />
                    </div>
                  </Field>

                  <div className="stack" style={{ gap: 'var(--s2)' }}>
                    <div className="row row--between">
                      <span className="faint" style={{ fontSize: '.75rem' }}>Strength</span>
                      {/* Polite, and only the word changes -- a percentage read
                          out on every keystroke is noise. */}
                      <span className="faint mono" style={{ fontSize: '.75rem' }} aria-live="polite">
                        {meter.label}
                      </span>
                    </div>
                    <div className="meter">
                      <div
                        className={`meter__fill${meter.tone ? ' meter__fill--' + meter.tone : ''}`}
                        style={{ width: `${meter.pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Not a live region: it would announce on every keystroke.
                      Each rule carries its state as text instead, so the tick's
                      colour is never the only thing saying whether it is met. */}
                  <ul className="stack" style={{ gap: 'var(--s2)', listStyle: 'none', padding: 0 }}>
                    {RULES.map((r) => {
                      const pass = r.test(next, current);
                      return (
                        <li className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }} key={r.text}>
                          <span
                            className="stat__icon"
                            style={{
                              width: '1.25rem', height: '1.25rem', flex: 'none',
                              borderRadius: 'var(--r-full)', marginTop: '.1rem',
                              background: pass ? 'var(--ok-soft)' : 'var(--surface)',
                              color: pass ? 'var(--ok)' : 'var(--faint)',
                            }}
                          >
                            {pass
                              ? <Check size={11} aria-hidden="true" />
                              : <X size={11} aria-hidden="true" />}
                          </span>
                          <span style={{ fontSize: '.8125rem', color: pass ? 'var(--fg)' : 'var(--muted)' }}>
                            {r.text}
                            {r.required && (
                              <span className="faint" style={{ fontSize: '.6875rem' }}> · required</span>
                            )}
                            <span className="sr"> — {pass ? 'met' : 'not met yet'}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="row">
                    <button className="btn btn--quiet btn--sm" type="button" onClick={() => setBlockedOpen(true)}>
                      See the blocked list
                    </button>
                  </div>
                </div>

                <Field
                  id="confirm-pw"
                  label="Confirm new password"
                  required
                  error={mismatch ? 'New password and confirmation do not match' : ''}
                >
                  <div className="pwwrap">
                    <input
                      className="input"
                      id="confirm-pw"
                      type={shown.confirm ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      spellCheck="false"
                      aria-invalid={mismatch}
                      {...(mismatch ? { 'aria-describedby': 'confirm-pw-error' } : {})}
                    />
                    <Reveal shown={shown.confirm} label="confirmed password" onToggle={() => reveal('confirm')} />
                  </div>
                </Field>

                <div className="row" style={{ gap: 'var(--s4)' }}>
                  <button className="btn btn--primary" type="submit" disabled={busy}>
                    {busy ? 'Updating…' : 'Update Password'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>

        {/* ------------------------------------------------ the account */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                The account this changes
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>Signed in as {me.username}</p>
            </div>
            {me.must_change_password
              ? <StatusBadge status="Temporary password" tone="warn" />
              : <StatusBadge status={me.role} />}
          </div>
          {employee ? (
            <div className="card__body">
              <div className="stack" style={{ gap: 'var(--s4)' }}>
                <div className="row row--between row--wrap" style={{ gap: 'var(--s3)' }}>
                  <span className="stat__label">Employee code</span>
                  <span className="mono" style={{ fontSize: '.8125rem' }}>{employee.emp_code}</span>
                </div>
                <div className="row row--between row--wrap" style={{ gap: 'var(--s3)' }}>
                  <span className="stat__label">Work email</span>
                  <span className="mono" style={{ fontSize: '.8125rem' }}>{employee.email || '—'}</span>
                </div>
                <div className="row row--between row--wrap" style={{ gap: 'var(--s3)' }}>
                  <span className="stat__label">Role</span>
                  <span style={{ fontSize: '.8125rem' }}>{me.role}</span>
                </div>
                {me.company && (
                  <div className="row row--between row--wrap" style={{ gap: 'var(--s3)' }}>
                    <span className="stat__label">Company</span>
                    <span style={{ fontSize: '.8125rem' }}>{me.company.name}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <Empty
              icon={UserRound}
              title="No employee record on this sign-in"
              body="Your name, employee code and work email would sit here. Platform administrator accounts are not linked to an employee, so there is nothing to show — the password below still belongs to this account."
            />
          )}
        </section>

        {/* ------------------------------------------------ after the change */}
        <section className="card">
          <div className="card__head">
            <div>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                After you change it
              </h2>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                What the system does, and who to tell if it wasn’t you
              </p>
            </div>
          </div>
          <div className="card__body">
            <div className="stack" style={{ gap: 'var(--s4)' }}>
              <div className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
                <span className="stat__icon" style={{ width: '1.75rem', height: '1.75rem', flex: 'none' }}>
                  <Mail size={14} aria-hidden="true" />
                </span>
                <p className="muted" style={{ fontSize: '.8125rem' }}>
                  {notifyEmail && !me.admin ? (
                    <>A security notice is emailed to <span className="mono">{notifyEmail}</span> the moment
                    the password changes. It never carries the new password.</>
                  ) : (
                    <>No security notice is emailed for this account — every send is recorded against a
                    company’s mailbox, and a platform administrator belongs to none.</>
                  )}
                </p>
              </div>
              <div className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
                <span className="stat__icon" style={{ width: '1.75rem', height: '1.75rem', flex: 'none' }}>
                  <ShieldCheck size={14} aria-hidden="true" />
                </span>
                <p className="muted" style={{ fontSize: '.8125rem' }}>
                  If that change was not yours, tell HR straight away — do not wait for the shift to end.
                </p>
              </div>
              <div className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
                <span className="stat__icon" style={{ width: '1.75rem', height: '1.75rem', flex: 'none' }}>
                  <Clock size={14} aria-hidden="true" />
                </span>
                <p className="muted" style={{ fontSize: '.8125rem' }}>
                  A session left idle for fifteen minutes is signed out on its own. That covers the long
                  quiet stretches of a night shift, when a screen is likeliest to be left unattended.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------ dialogs */}
      {blockedOpen && (
        <Modal
          title="Blocked passwords"
          sub="Refused outright, whatever else they satisfy"
          onClose={() => setBlockedOpen(false)}
          footer={<button className="btn btn--ghost" onClick={() => setBlockedOpen(false)}>Close</button>}
        >
          <ul className="stack" style={{ gap: 'var(--s2)', listStyle: 'none', padding: 0 }}>
            {BLOCKED.map((p) => (
              <li className="row" style={{ gap: 'var(--s3)' }} key={p}>
                <span
                  className="stat__icon"
                  style={{
                    width: '1.25rem', height: '1.25rem', flex: 'none', borderRadius: 'var(--r-full)',
                    background: 'var(--err-soft)', color: 'var(--err-text)',
                  }}
                >
                  <X size={11} aria-hidden="true" />
                </span>
                <span className="mono" style={{ fontSize: '.8125rem' }}>{p}</span>
              </li>
            ))}
          </ul>
          <p className="help" style={{ marginTop: 'var(--s4)' }}>
            Matched exactly as written. A password that differs only in case is accepted by the
            service — it is still a poor choice.
          </p>
        </Modal>
      )}

      {confirming && (
        <ConfirmModal
          title="Replace your password?"
          body={
            `The password for ${me.username} is replaced straight away and the old one stops working` +
            (notifyEmail && !me.admin ? `, and a security notice goes to ${notifyEmail}.` : '.') +
            ' Sessions already signed in elsewhere keep running until they expire or idle out.'
          }
          confirmLabel="Update Password"
          danger
          busy={busy}
          onConfirm={change}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
