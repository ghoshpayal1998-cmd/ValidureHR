'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, X } from 'lucide-react';

/* ============================================================ toasts */

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const toast = useCallback((message, kind) => {
    const id = ++seq.current;
    setItems((t) => [...t, { id, message, kind }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {/* polite, not assertive: a save confirmation should not interrupt
          whatever a screen reader is already reading out. */}
      <div className="toasts" aria-live="polite">
        {items.map(({ id, message, kind }) => (
          <div className={`toast${kind ? ' toast--' + kind : ''}`} key={id}>
            {kind === 'ok' && <Check size={16} aria-hidden="true" />}
            {kind === 'err' && <AlertTriangle size={16} aria-hidden="true" />}
            <span>{message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ============================================================ modal */

/*
 * Focus-trapped dialog. Escape closes, Tab cycles inside, focus returns to
 * whatever opened it. Rendered through a portal so a modal opened from deep
 * inside a table is not clipped by its scroll container.
 */
export function Modal({ title, sub, children, footer, wide, onClose, labelledBy = 'modal-title' }) {
  const scrim = useRef(null);
  const opener = useRef(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    opener.current = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !scrim.current) return;
      const f = scrim.current.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      );
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);

    /* The page behind must not scroll while a dialog is open. */
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const t = setTimeout(() => {
      const target = scrim.current?.querySelector(
        'input:not([type=hidden]),select,textarea,[data-autofocus]'
      ) || scrim.current?.querySelector('button');
      target?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="scrim"
      ref={scrim}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <div className="modal__head">
          <div>
            <h2 id={labelledBy} style={{ fontSize: '1.125rem' }}>{title}</h2>
            {sub && <p className="muted" style={{ fontSize: '.8125rem', marginTop: '.15rem' }}>{sub}</p>}
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer !== null && (
          <div className="modal__foot">
            {footer || <button className="btn btn--ghost" onClick={onClose}>Close</button>}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/* Destructive actions get a named confirmation rather than a bare "Are you
 * sure?", so the dialog says what is about to happen. */
export function ConfirmModal({ title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
            disabled={busy}
            data-autofocus
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: '.9375rem' }}>{body}</p>
    </Modal>
  );
}

/* ============================================================ states */

export function Field({ id, label, required, help, error, children }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}{required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {children}
      {help && !error && <p className="help" id={`${id}-help`}>{help}</p>}
      {error && (
        <p className="err" id={`${id}-error`} role="alert">
          <AlertTriangle size={13} aria-hidden="true" />{error}
        </p>
      )}
    </div>
  );
}

export function Empty({ icon: Icon, title, body, action }) {
  return (
    <div className="empty">
      {Icon && <span className="empty__icon"><Icon size={22} aria-hidden="true" /></span>}
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

/* A shimmering block the same height as the content it stands in for, so the
 * page does not jump when the data lands. */
export function Skeleton({ rows = 5, height = 44 }) {
  return (
    <div className="stack" style={{ gap: 'var(--s2)', padding: 'var(--s5)' }} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel" key={i} style={{ height }} />
      ))}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="card" style={{ borderColor: 'var(--err)' }}>
      <div className="card__body">
        <div className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
          <AlertTriangle size={18} aria-hidden="true" style={{ color: 'var(--err-text)', flex: 'none', marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '.9375rem', fontWeight: 600 }}>
              That did not load
            </h2>
            <p className="muted" style={{ fontSize: '.875rem', marginTop: '.15rem' }}>{String(error)}</p>
            {onRetry && (
              <button className="btn btn--ghost btn--sm" onClick={onRetry} style={{ marginTop: 'var(--s3)' }}>
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PageHead({ eyebrow, title, sub, children }) {
  return (
    <div className="page__head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 style={{ marginTop: 'var(--s2)' }}>{title}</h1>
        {sub && <p className="muted" style={{ fontSize: '.875rem', marginTop: '.25rem' }}>{sub}</p>}
      </div>
      {children && <div className="row" style={{ gap: 'var(--s3)' }}>{children}</div>}
    </div>
  );
}

const TONES = { Approved: 'ok', Paid: 'ok', Present: 'ok', Active: 'ok', Delivered: 'ok',
                Pending: 'warn', Draft: 'warn', Probation: 'warn', Leave: 'warn',
                Rejected: 'err', Absent: 'err', Bounced: 'err', Inactive: 'err',
                Holiday: 'info', Weekend: 'neutral' };

export function StatusBadge({ status, tone }) {
  return <span className={`badge badge--${tone || TONES[status] || 'neutral'}`}>{status}</span>;
}
