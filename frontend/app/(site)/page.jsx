import Link from 'next/link';
import {
  CalendarCheck, Scale, Wallet, FolderOpen, LineChart, ShieldCheck,
  Check, ArrowRight, Clock, Fingerprint, Building2,
} from 'lucide-react';

export const metadata = {
  title: 'ValidureHR — HR that runs on time',
  description:
    'Attendance, leave, payroll and documents for the whole company, in one place. Night-shift aware, biometric-ready, and built for Indian payroll.',
};

const FEATURES = [
  {
    icon: CalendarCheck,
    title: 'Attendance',
    body: 'Punches arrive from the biometric reader on the floor and land on the right day — even when the shift crosses midnight. Month calendar, day sheet, and bulk corrections when the device misses someone.',
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
    body: 'Payslips, offer letters, appraisal letters and company policies, filed per employee and visible to the person they belong to. Generated as PDFs, not uploaded by hand.',
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
  { n: '01', title: 'Add the company', body: 'Departments, designations, leave types and the holiday calendar. Each company gets its own isolated schema.' },
  { n: '02', title: 'Bring people in', body: 'Employees, reporting lines and salary structures. Everyone gets a login and their own document shelf.' },
  { n: '03', title: 'Connect the device', body: 'Map biometric IDs to employees once. Punches sync on a schedule and alert you when a reader goes quiet.' },
  { n: '04', title: 'Run the month', body: 'Approve leave as it comes, then close payroll against the attendance it depends on. Export the salary sheet.' },
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
              Attendance, leave, payroll and documents for the whole company —
              in one place, engineered to the same standard as everything else
              Validure builds.
            </p>
            <div className="hero__cta">
              <a className="btn btn--primary btn--lg" href="#contact">
                Book a walkthrough <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link className="btn btn--ghost btn--lg" href="/login">See it running</Link>
            </div>
            <p className="hero__note">
              No card, no commitment — a conversation and a live tour of your own data.
            </p>
          </div>

          {/* A real slice of the product, not a stock photograph. */}
          <div className="shot" aria-hidden="true">
            <div className="shot__bar">
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
              ['6', 'Leave types, each with its own accrual'],
              ['9h', 'Shifts that cross midnight, handled'],
              ['1', 'Place your payslips actually live'],
              ['0', 'Spreadsheets in the loop'],
            ].map(([n, label]) => (
              <div key={label}>
                <b>{n}</b>
                <span className="eyebrow eyebrow--plain">{label}</span>
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
            <h2>Running by the end of the week.</h2>
            <p className="lede">
              Four steps, in this order. We do the first three with you.
            </p>
          </div>

          <div className="steps">
            {STEPS.map(({ n, title, body }, i) => (
              <div className="step" key={n} data-on={i === 0 ? 'true' : 'false'}>
                <span className="step__n">{n}</span>
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
                [Building2, 'Several companies, properly separated',
                  'Each company gets its own database schema. Switching between them is deliberate, and nothing leaks across.'],
              ].map(([Icon, title, body]) => (
                <div className="check" key={title}>
                  <Icon size={18} aria-hidden="true" />
                  <span><b>{title}</b><br /><span>{body}</span></span>
                </div>
              ))}
            </div>
          </div>

          <div className="shot" aria-hidden="true">
            <div className="shot__bar">
              <span className="faint mono" style={{ fontSize: '.6875rem' }}>
                Attendance · September 2026 · BIOMAX-BLR-01
              </span>
            </div>
            <div className="shot__body">
              <table className="table">
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
          </div>

          <div className="checks" style={{ marginTop: 0 }}>
            {[
              ['Per-company isolation', 'Every company sits in its own database schema, not a shared table with a filter someone can forget.'],
              ['Permissions are granted', 'Nothing is visible by default. A screen a person has not been given does not appear in their menu.'],
              ['Sessions expire', 'Fifteen minutes of inactivity signs you out, because HR screens get left open on shared desks.'],
              ['Backed up, and checked', 'Backups verify themselves rather than reporting success and writing nothing.'],
            ].map(([title, body]) => (
              <div className="check" key={title}>
                <Check size={18} aria-hidden="true" />
                <span><b>{title}</b><br /><span>{body}</span></span>
              </div>
            ))}
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
              Send us a month of attendance and we will show you the payroll it
              produces. If it does not hold up, you have lost an afternoon.
            </p>
            <div className="row row--wrap" style={{ gap: 'var(--s3)', justifyContent: 'center' }}>
              <a className="btn btn--primary btn--lg" href="mailto:info@validuresolutions.com?subject=ValidureHR%20walkthrough">
                Book a walkthrough <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link className="btn btn--ghost btn--lg" href="/login">Sign in</Link>
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
