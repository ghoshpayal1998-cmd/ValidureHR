'use client';

import './login.css';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Clock, Eye, EyeOff } from 'lucide-react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import { api, clearSession, setSession } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /* Landing here means whatever session existed is finished with. Clearing it
   * on arrival stops a half-valid token following the next person in. */
  useEffect(() => { clearSession(); }, []);

  const timedOut = params.get('timeout') === '1';
  const expired = params.get('expired') === '1';

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { token, user } = await api('/auth/login', {
        method: 'POST',
        body: { identifier: identifier.trim(), password },
      });
      setSession(token, user);
      /* A platform admin has no company of their own and must pick one first. */
      router.replace(user.admin ? '/platform' : '/home');
    } catch (err) {
      setError(err.message || 'Could not sign in');
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="auth__brand">
        <div><Logo size={34} /></div>

        <div className="auth__hero">
          <p className="eyebrow">Human Resource Platform</p>
          <h1>Your People.<br />Our&nbsp;<span className="tint">Technology.</span></h1>
          <p>
            Attendance, leave, payroll and documents for the whole company —
            in one place, engineered to the same standard as everything else
            Validure builds.
          </p>
          <div className="auth__facts">
            <span className="auth__fact">
              <b className="num">9h</b><span className="eyebrow eyebrow--plain">Shift aware</span>
            </span>
            <span className="auth__fact">
              <b className="num">6</b><span className="eyebrow eyebrow--plain">Leave types</span>
            </span>
            <span className="auth__fact">
              <b className="num">1</b><span className="eyebrow eyebrow--plain">Source of truth</span>
            </span>
          </div>
        </div>

        <p className="faint" style={{ fontSize: '.75rem' }}>
          ValidureHR v1.0 · © 2026 Validure Solutions Pvt. Ltd.
        </p>
      </section>

      <section className="auth__form">
        <div className="auth__card">
          <div className="row row--between" style={{ marginBottom: 'var(--s6)' }}>
            <div>
              <h1 style={{ fontSize: '1.5rem' }}>Sign in</h1>
              <p className="muted" style={{ fontSize: '.875rem', marginTop: '.15rem' }}>
                Use your employee ID, email or username.
              </p>
            </div>
            <ThemeToggle />
          </div>

          <div className="card">
            <div className="card__body">
              {(timedOut || expired) && (
                <div
                  className="chip"
                  style={{
                    width: '100%', background: 'var(--info-soft)', borderColor: 'transparent',
                    color: 'var(--info)', marginBottom: 'var(--s4)',
                  }}
                >
                  <Clock size={15} aria-hidden="true" />
                  {timedOut
                    ? 'You were signed out after 15 minutes of inactivity.'
                    : 'Your session ended. Please sign in again.'}
                </div>
              )}

              {error && (
                <div
                  className="chip"
                  role="alert"
                  style={{
                    width: '100%', background: 'var(--err-soft)', borderColor: 'transparent',
                    color: 'var(--err-text)', marginBottom: 'var(--s4)',
                  }}
                >
                  <AlertTriangle size={15} aria-hidden="true" />{error}
                </div>
              )}

              <form onSubmit={submit}>
                <div className="stack">
                  <div className="field">
                    <label className="label" htmlFor="identifier">
                      Employee ID, email or username <span className="req" aria-hidden="true">*</span>
                    </label>
                    <input
                      className="input"
                      id="identifier"
                      name="identifier"
                      type="text"
                      required
                      autoFocus
                      autoComplete="username"
                      placeholder="e.g. VS-0113 or you@validuresolutions.com"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      aria-invalid={error ? 'true' : undefined}
                    />
                  </div>

                  <div className="field">
                    <label className="label" htmlFor="password">
                      Password <span className="req" aria-hidden="true">*</span>
                    </label>
                    <div className="pwwrap">
                      <input
                        className="input"
                        id="password"
                        name="password"
                        type={show ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        aria-invalid={error ? 'true' : undefined}
                      />
                      <button
                        className="iconbtn"
                        type="button"
                        onClick={() => setShow(!show)}
                        aria-label={show ? 'Hide password' : 'Show password'}
                        aria-pressed={show}
                      >
                        {show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                      </button>
                    </div>
                  </div>

                  <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
                    {busy ? 'Signing in…' : 'Sign in'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <p className="faint" style={{ fontSize: '.75rem', textAlign: 'center', marginTop: 'var(--s5)' }}>
            Trouble signing in? Ask your HR administrator to reset your password.
          </p>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  /* useSearchParams needs a Suspense boundary or the whole route opts out of
   * static rendering at build time. */
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
