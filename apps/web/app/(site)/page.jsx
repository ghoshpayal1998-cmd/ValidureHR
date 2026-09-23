import Link from 'next/link';
import {
  CalendarCheck, Scale, Wallet, FolderOpen, LineChart, ShieldCheck,
  Check, ArrowRight, Clock, Fingerprint, Building2,
} from 'lucide-react';

export const metadata = {
  title: 'ValidureHR — HR that runs on time',
  description:
    'Attendance, leave, payroll and documents for the whole company. We create it, load your people and hand over the logins. Night-shift aware, biometric-ready, and built for Indian payroll.',
};

const FEATURES = [
  {
    icon: CalendarCheck,
    title: 'Attendance',
    body: 'People punch in and out themselves, and the shift lands on the right day even when it crosses midnight. Month calendar, day sheet, and bulk corrections. Biometric readers sync in too, where a company has them.',
  },
  {
    icon: Scale,
    title: 'Leave',
    body: 'Apply, approve and track against balances that accrue monthly on your own rules. Casual, sick, earned, comp-off, maternity and loss-of-pay, each with its own accrual rate and ledger.',
  },
  {
    icon: Wallet,
    title: 'Payroll',
    body: 'Run a cycle against the attendance it actually depends on. Basic, HRA, allowances, PF, professional tax and TDS, with loss-of-pay priced the same on the payslip as on the salary sheet.',
  },
  {
    icon: FolderOpen,
    title: 'Documents',
    body: 'Payslips, offer letters and company policies, filed per employee and visible only to the person they belong to. Generated as PDFs, or uploaded if you already have them.',
  },
  {
    icon: LineChart,
    title: 'Reports & analytics',
    body: 'Attendance rate over time, leave utilisation by type, headcount by department and late marks this month — with the numbers on screen, not just a chart to squint at.',
  },
  {
    icon: ShieldCheck,
    title: 'Roles & access',
    body: 'Permissions are granted, not assumed. An employee who has not been given a screen does not see it in the menu at all, rather than finding a locked door.',
  },
];

const STEPS = [
  { n: '01', who: 'We', title: 'We create the company', body: 'Its own database schema, with your departments, designations, leave types and holiday calendar already in it. Nothing is shared with anyone else on the platform.' },
  { n: '02', who: 'We', title: 'We bring your people in', body: 'Employees, reporting lines, leave balances and salary structures. Everyone gets a login and their own document shelf.' },
  { n: '03', who: 'We', title: 'We connect your reader', body: 'Optional. Biometric IDs map to employees once and punches sync on a schedule. Without a reader, people punch in from the app instead.' },
  { n: '04', who: 'You', title: 'You run the month', body: 'Approve leave as it comes, then close payroll against the attendance it depends on. Export the salary sheet. This is the only part that was ever your job.' },
];

const PROOF = [
  ['No session at all', '401', 'Authentication required'],
  ['Signed in, but another company', '404', 'Salary slip not found'],
  ['Same company, without documents.manage', '403', 'Not allowed'],
  ['The employee it belongs to', '200', 'application/pdf'],
];

export default function Home() {
  return (
    <>
      {/* ------------------------------------------------ hero */}
      <section className="hero">
        <div className="wrap hero__in">
          <div>
            <p className="eyebrow">Human Resource Platform</p>
            <h1>HR that runs<br />on <span className="tint">time.</span></h1>
            <p className="hero__lede">
              Attendance, leave, payroll and documents for the whole company.
              We create it, configure it to your rules and load your people —
              so the first time you sign in, it already works.
            </p>
            <div className="hero__cta">
              <a className="btn btn--primary btn--lg" href="#contact">
                Book a walkthrough <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link className="btn btn--ghost btn--lg" href="/login">See it running</Link>
            </div>
            <p className="hero__note">
              No card, no commitment — a conversation, and a seeded company you can open and poke at.
            </p>
          </div>

          {/* A real slice of the product, not a stock photograph. */}
          {/* A picture of the product, so it is described rather than hidden —
              role=img gives it one accessible name and stops a screen reader
              walking mock data as though it were the reader's own. */}
          <div
            className="shot"
            role="img"
            aria-label="The ValidureHR dashboard: 19 of 24 people present, the shift live, and three leave requests awaiting approval."
          >
            <div className="shot__bar" aria-hidden="true">
              <span className="shot__dot" /><span className="shot__dot" /><span className="shot__dot" />
              <span className="faint mono" style={{ fontSize: '.6875rem', marginLeft: 'var(--s2)' }}>
                Today · 21 Sep 2026
              </span>
            </div>
            <div className="shot__body">
              <div className="row row--between">
                <div>
                  <p className="stat__label">Present</p>
                  <p className="stat__val">19<span className="faint" style={{ fontSize: '1rem', fontWeight: 400 }}> / 24</span></p>
                </div>
                <span className="badge badge--ok">Shift live</span>
              </div>
              <div className="meter"><div className="meter__fill" style={{ width: '79%' }} /></div>

              <div className="grid grid--3" style={{ gap: 'var(--s3)' }}>
                {[['On leave', '2'], ['WFH', '2'], ['Late', '3']].map(([l, v]) => (
                  <div key={l}>
                    <p className="stat__label">{l}</p>
                    <p className="num" style={{ fontFamily: 'var(--font-head)', fontWeight: 680, fontSize: '1.25rem' }}>{v}</p>
                  </div>
                ))}
              </div>

              <hr className="rule" />

              <div className="stack" style={{ gap: 'var(--s3)' }}>
                {[
                  ['AK', 'Arjun Kulkarni', 'Casual leave · 24–25 Sep', 'warn', 'Pending'],
                  ['KR', 'Kavya Reddy', 'Sick leave · 22 Sep', 'warn', 'Pending'],
                  ['AI', 'Ananya Iyer', 'Casual leave · 11 Sep', 'ok', 'Approved'],
                ].map(([ini, name, meta, tone, label]) => (
                  <div className="row row--between" key={name}>
                    <span className="person">
                      <span className="avatar avatar--sm">{ini}</span>
                      <span>
                        <span className="person__name" style={{ display: 'block' }}>{name}</span>
                        <span className="faint" style={{ fontSize: '.75rem' }}>{meta}</span>
                      </span>
                    </span>
                    <span className={`badge badge--${tone}`}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ stats */}
      <section className="section--tight">
        <div className="wrap">
          <div className="statstrip">
            {[
              ['0', 'Setup work on your side'],
              ['1', 'Schema per company, never shared'],
              ['19:00', 'Shift start the payroll cycle respects'],
              ['25th', 'Or the 1st — the cycle is yours to set'],
            ].map(([n, label]) => (
              <div key={label}>
                <b>{n}</b>
                {/* Body face, not the mono eyebrow: DESIGN.md's Annotation Rule
                    keeps mono for things you look up, and at 11px with 0.16em
                    tracking these wrapped to three lines on a phone. */}
                <span className="statstrip__label">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ features */}
      <section className="section" id="features">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">What it does</p>
            <h2>Everything HR touches, in one place.</h2>
            <p className="lede">
              Six things a growing company stops being able to do in a
              spreadsheet — each built properly rather than bolted on.
            </p>
          </div>

          <div className="features">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <article className="feature" key={title}>
                <span className="feature__icon"><Icon size={20} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ how */}
      <section className="section section--surface" id="how">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">How it works</p>
            <h2>Four steps to a working company.</h2>
            <p className="lede">
              Three of them are ours. You arrive at the fourth, and the company
              is already set up, populated and running.
            </p>
          </div>

          <div className="steps">
            {STEPS.map(({ n, who, title, body }) => (
              <div className="step" key={n} data-on={who === 'You' ? 'true' : 'false'}>
                <span className="step__n">{n} · {who}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ shifts */}
      <section className="section" id="shifts">
        <div className="wrap split">
          <div>
            <p className="eyebrow">Built for shifts</p>
            <h2>Midnight is not the end of the day.</h2>
            <p className="lede" style={{ marginTop: 'var(--s5)' }}>
              Most HR software assumes everyone starts in the morning. If your
              team works 19:00 to 04:00, that assumption quietly breaks
              attendance, leave and payroll at the same time — a punch-out at
              04:03 gets filed against the wrong day, and the month closes
              short.
            </p>

            <div className="checks">
              {[
                [Clock, 'Attendance is keyed to the shift, not the clock',
                  'A punch recorded at 04:03 belongs to the shift that began at 19:00 the day before, and the calendar shows it there.'],
                [Fingerprint, 'Biometric readers, mapped once',
                  'Device IDs map to employees once and then sync on a schedule. If a reader goes quiet, someone is told rather than finding out on payday.'],
                [Building2, 'More than one company? Each one is separate',
                  'Run three entities and you get three companies, each provisioned by us with its own schema. Switching between them is deliberate, and nothing leaks across.'],
              ].map(([Icon, title, body]) => (
                <div className="check" key={title}>
                  <Icon size={18} aria-hidden="true" />
                  <span><b>{title}</b><br /><span>{body}</span></span>
                </div>
              ))}
            </div>
          </div>

          {/* NOT aria-hidden: this table and its caption are the strongest
              argument on the page, and hiding them put the evidence out of
              reach of exactly the readers most likely to need the product. */}
          <div className="shot">
            <div className="shot__bar">
              <span className="faint mono" style={{ fontSize: '.6875rem' }}>
                Attendance · September 2026 · BIOMAX-BLR-01
              </span>
            </div>
            <div className="shot__body">
              <table className="table">
                <caption className="sr">
                  Example attendance for four night shifts. Each row is entered against
                  the date the shift started, even though the punch-out falls after
                  midnight on the following calendar date.
                </caption>
                <thead>
                  <tr><th>Date</th><th>In</th><th>Out</th><th className="num">Hrs</th></tr>
                </thead>
                <tbody>
                  {[
                    ['Mon 14 Sep', '19:02', '04:03', '9.0'],
                    ['Tue 15 Sep', '19:02', '04:03', '9.0'],
                    ['Wed 16 Sep', '19:12', '04:12', '9.0'],
                    ['Thu 17 Sep', '19:00', '04:03', '9.1'],
                  ].map(([d, i, o, h]) => (
                    <tr key={d}>
                      <td>{d}</td>
                      <td className="mono">{i}</td>
                      <td className="mono">{o}</td>
                      <td className="num">{h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                Every row above ends on the following calendar date. The month
                still totals correctly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ security */}
      <section className="section section--surface" id="security">
        <div className="wrap split">
          <div>
            <p className="eyebrow">Security</p>
            <h2>Payroll data, treated like payroll data.</h2>
            <p className="lede" style={{ marginTop: 'var(--s5)' }}>
              This is salary, bank details and identity documents for everyone
              you employ. The boring safeguards are the point.
            </p>

            <div className="checks">
              {[
                ['Per-company isolation', 'Every company sits in its own database schema, not a shared table with a filter someone can forget.'],
                ['Permissions are granted', 'Nothing is visible by default. A screen a person has not been given does not appear in their menu.'],
                ['Documents sit behind auth', 'A payslip is served through an authenticated endpoint. There is no link you can forward that works without signing in.'],
                ['The API enforces it too', 'Hiding a screen is not the control. The server checks the same permission independently, so a guessed URL answers with a refusal, not data.'],
              ].map(([title, body]) => (
                <div className="check" key={title}>
                  <Check size={18} aria-hidden="true" />
                  <span><b>{title}</b><br /><span>{body}</span></span>
                </div>
              ))}
            </div>
          </div>

          {/* The claim above is worth nothing without the thing itself. One
              request, four callers, and what the server actually answers each
              of them. */}
          <div className="shot">
            <div className="shot__bar">
              <span className="faint mono" style={{ fontSize: '.6875rem' }}>
                GET /api/documents/salary-slips/3119/pdf
              </span>
            </div>
            <div className="shot__body">
              <table className="table evid">
                <caption className="sr">
                  One payslip request made by four different callers, and the
                  status and body the server answers each of them.
                </caption>
                <thead>
                  <tr><th scope="col">Who is asking</th><th scope="col">What comes back</th></tr>
                </thead>
                <tbody>
                  {PROOF.map(([who, code, body]) => (
                    <tr key={who}>
                      <td>{who}</td>
                      <td>
                        <span className={`evid__code evid__code--${code === '200' ? 'ok' : 'no'}`}>{code}</span>
                        <span className="evid__body">{body}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: '.75rem' }}>
                The second row is the one that matters. Another company&rsquo;s payslip
                is not refused — it is <b>absent</b>. The schema is read from your
                session, so no id, parameter or header can name a company you are
                not in.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ cta */}
      <section className="section" id="contact">
        <div className="wrap">
          <div className="ctaband">
            <p className="eyebrow">Get started</p>
            <h2>See it with your own numbers.</h2>
            <p>
              Open the seeded company and run a payroll cycle against a month of
              night-shift attendance — every figure end to end, clearly labelled as
              demo data. The prices are published too, so you can work out what it
              costs before you speak to anyone.
            </p>
            <div className="row row--wrap" style={{ gap: 'var(--s3)', justifyContent: 'center' }}>
              <a className="btn btn--primary btn--lg" href="mailto:info@validuresolutions.com?subject=ValidureHR%20walkthrough">
                Book a walkthrough <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link className="btn btn--ghost btn--lg" href="/pricing">See pricing</Link>
            </div>
            <p className="faint" style={{ fontSize: '.8125rem' }}>
              info@validuresolutions.com · +91 86177 89675
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
