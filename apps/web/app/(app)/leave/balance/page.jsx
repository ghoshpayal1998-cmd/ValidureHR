'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, Info, Lock, Scale } from 'lucide-react';
import { api, fmtDate, fmtDateTime } from '@/lib/api';
import { Empty, ErrorNote, PageHead, Skeleton, StatusBadge } from '@/components/ui';

/* The ledger says what moved the balance; the API stores the reason as a
 * short key, so the wording and the tone live here rather than in the data. */
const KINDS = {
  accrual: { label: 'Monthly accrual', tone: 'info' },
  adjustment: { label: 'HR adjustment', tone: 'neutral' },
  leave_taken: { label: 'Leave taken', tone: 'err' },
  leave_cancelled: { label: 'Leave cancelled', tone: 'ok' },
};

/* Balances arrive as numbers but a numeric column can come back as a string
 * from the driver, so every figure goes through one coercion. */
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const d2 = (v) => num(v).toFixed(2);                         /* 9 → "9.00"  */
const raw = (v) => String(Math.round(num(v) * 100) / 100);   /* 6.5 → "6.5" */
const signed = (v) => (num(v) > 0 ? '+' : '') + raw(v);

/* The API treats exactly ONE type as unpaid — the code UL — and draws every
 * other type, Loss of Pay included, against the balance, refusing it when the
 * balance is short. Guessing from the name or from a zero accrual rate made
 * this screen disagree with the server: it showed Loss of Pay as takeable
 * during probation, which the API rejects outright.
 * See the unpaid check in apps/api/src/routes/leaves.js. */
const isUnpaid = (t) => String(t.code || '').toUpperCase() === 'UL';

export default function LeaveBalancePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api('/leaves/balance').then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;

  if (!data) {
    return (
      <div className="page">
        <PageHead eyebrow="Attendance & leave" title="Leave Balance" />
        <div className="card"><Skeleton rows={4} /></div>
      </div>
    );
  }

  const balances = data.balances || [];
  const ledger = data.ledger || [];
  const onProbation = !!data.on_probation;

  /* Everything the screen needs per type, derived once so the cards and the
   * summary table can never disagree with each other. */
  const types = balances.map((b) => {
    const accrued = num(b.accrued);
    const used = num(b.used);
    const unpaid = isUnpaid(b);
    return {
      ...b,
      accrued,
      used,
      balance: num(b.balance),
      rate: num(b.monthly_accrual),
      /* no accrued days means there is nothing to draw a meter against */
      entitled: accrued > 0,
      unpaid,
      locked: onProbation && !unpaid,
      /* the meter reads used against accrued, so a full bar means spent */
      pct: accrued > 0 ? Math.min(100, Math.round((used / accrued) * 100)) : 0,
    };
  });

  return (
    <div className="page">
      <PageHead
        eyebrow="Attendance & leave"
        title="Leave Balance"
        sub="Balances accrue monthly and carry over — decimals included."
      >
        <Link className="btn btn--primary" href="/leave/apply">Apply leave</Link>
      </PageHead>

      {!types.length ? (
        <Empty
          icon={Scale}
          title="No leave types configured"
          body="Once HR sets up the leave types for your company, each one appears here with what you have accrued, what you have used and what is left."
        />
      ) : (
        <div className="stack" style={{ gap: 'var(--s5)' }}>
          {/* ------------------------------------------------ probation */}
          {onProbation && (
            <div className="card" style={{ borderColor: 'var(--info)' }}>
              <div className="card__body row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
                <Info size={18} aria-hidden="true" style={{ color: 'var(--info)', flex: 'none', marginTop: 2 }} />
                <p style={{ fontSize: '.875rem' }}>
                  You are on probation
                  {data.probation_until ? <> until <b>{fmtDate(data.probation_until)}</b></> : null}.
                  Your leave balance is <b>locked</b> — nothing accrues and nothing is deducted;
                  any leave you take is unpaid.
                </p>
              </div>
            </div>
          )}

          {/* ------------------------------------------------ per-type cards */}
          <div className="grid grid--3">
            {types.map((t) => (
              <div
                className="card"
                key={t.leave_type_id}
                style={t.locked ? { background: 'var(--bg)', opacity: .6, userSelect: 'none' } : undefined}
              >
                <div className="stat">
                  <span className="stat__label row" style={{ gap: 'var(--s2)' }}>
                    {t.name} · {t.code}
                    {t.locked && (
                      <>
                        <Lock size={13} aria-hidden="true" />
                        <span className="sr">Locked during probation</span>
                      </>
                    )}
                  </span>

                  <p
                    className="stat__val"
                    style={t.locked ? { color: 'var(--faint)', textDecoration: 'line-through' } : undefined}
                  >
                    {d2(t.balance)}{' '}
                    <span style={{
                      fontSize: '1rem', fontWeight: 500,
                      color: t.locked ? undefined : 'var(--faint)',
                    }}>
                      days
                    </span>
                  </p>

                  {t.locked ? (
                    <p style={{ fontSize: '.6875rem', fontWeight: 600, color: 'var(--warn)' }}>
                      Locked during probation
                    </p>
                  ) : t.entitled ? (
                    <div
                      className="meter"
                      role="img"
                      aria-label={`${raw(t.used)} of ${d2(t.accrued)} accrued days used`}
                    >
                      <div
                        className={`meter__fill${t.pct >= 80 ? ' meter__fill--err' : t.pct >= 60 ? ' meter__fill--warn' : ''}`}
                        style={{ width: `${t.pct}%` }}
                      />
                    </div>
                  ) : (
                    /* Nothing accrued yet, so a meter would read as a spent
                       bar against nothing. These types are still deducted
                       when granted — saying "no entitlement" would read as
                       "you may not take this", which is wrong for maternity
                       leave in particular. */
                    <p className="faint" style={{ fontSize: '.6875rem', fontWeight: 600 }}>
                      {t.unpaid ? 'Unpaid · balance not deducted' : 'Granted by HR, not accrued'}
                    </p>
                  )}

                  <p className="faint" style={{ fontSize: '.75rem' }}>
                    {t.locked
                      ? 'Balance inactive'
                      : t.entitled
                        ? `accrued ${d2(t.accrued)} · used ${raw(t.used)} · ${t.rate ? `+${raw(t.rate)}/month` : 'no accrual'}`
                        : t.unpaid
                          ? `${raw(t.used)} day${num(t.used) === 1 ? '' : 's'} taken · never deducted`
                          : 'ask HR to grant days before applying'}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* ------------------------------------------------ summary */}
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                  Balance summary
                </h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>
                  Every type configured for your company, accrual rate included
                </p>
              </div>
            </div>
            <div className="card__body card__body--flush">
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Leave type</th>
                      <th scope="col" className="num">Monthly accrual</th>
                      <th scope="col" className="num">Accrued (total)</th>
                      <th scope="col" className="num">Used</th>
                      <th scope="col" className="num">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {types.map((t) => (
                      <tr key={t.leave_type_id} style={t.locked ? { opacity: .5, userSelect: 'none' } : undefined}>
                        <td>
                          <span style={{ fontWeight: 600 }}>{t.name}</span>{' '}
                          <span className="faint mono" style={{ fontSize: '.75rem' }}>({t.code})</span>
                          {t.locked && <> <span className="badge badge--warn">Locked</span></>}
                        </td>
                        <td className="num mono">
                          {t.rate
                            ? `${raw(t.rate)} ${num(t.rate) === 1 ? 'day' : 'days'}/month`
                            : <span className="faint">0 days/month</span>}
                        </td>
                        <td className="num mono">{d2(t.accrued)}</td>
                        <td className="num mono">{raw(t.used)}</td>
                        <td className="num mono">
                          {t.locked ? (
                            <span className="faint" style={{ textDecoration: 'line-through' }}>{d2(t.balance)}</span>
                          ) : (
                            <span style={{ fontWeight: 600, color: 'var(--accent-strong)' }}>{d2(t.balance)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------ ledger */}
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', fontWeight: 600 }}>
                  How your balance was calculated
                </h2>
                <p className="faint" style={{ fontSize: '.75rem' }}>
                  Every credit and deduction, most recent first.
                </p>
              </div>
            </div>
            {ledger.length ? (
              <>
                <div className="card__body card__body--flush">
                  <div className="tablewrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">When</th>
                          <th scope="col">Type</th>
                          <th scope="col" className="num">Change</th>
                          <th scope="col">What</th>
                          <th scope="col">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledger.map((l, i) => {
                          const kind = KINDS[l.kind] || { label: l.kind, tone: 'neutral' };
                          return (
                            <tr key={`${l.created_at}-${l.code}-${i}`}>
                              <td className="mono" style={{ fontSize: '.75rem', whiteSpace: 'nowrap' }}>
                                {fmtDateTime(l.created_at)}
                              </td>
                              <td className="mono">{l.code}</td>
                              <td
                                className="num mono"
                                style={{ fontWeight: 600, color: num(l.delta) < 0 ? 'var(--err-text)' : 'var(--ok)' }}
                              >
                                {signed(l.delta)}
                              </td>
                              <td><StatusBadge status={kind.label} tone={kind.tone} /></td>
                              <td className="muted" style={{ fontSize: '.75rem' }}>{l.note || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card__foot">
                  <p className="faint" style={{ fontSize: '.75rem' }}>
                    The 15 most recent entries. Older movements stay on the balance but not on this list.
                  </p>
                </div>
              </>
            ) : (
              <Empty
                icon={CalendarPlus}
                title="No balance activity yet"
                body="HR grants leave via monthly accrual or manual credits — each credit and each approved request lands here with the note that explains it."
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
