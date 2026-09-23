import Link from 'next/link';
import { Check, Minus, X, ArrowRight } from 'lucide-react';

export const metadata = {
  title: 'Pricing — ValidureHR',
  description:
    'Per person, per month, with setup included on annual billing. We create the company, load your people and run your first payroll cycle with you.',
};

/* One source of truth for what each plan contains.
 *
 * The cards below show a short highlight list and the table shows all of it.
 * Both read from this array, because a pricing page whose summary and whose
 * comparison table disagree is the fastest way to lose a buyer who checks. */
const FEATURES = [
  ['Attendance, including shifts that cross midnight', 1, 1, 1],
  ['Month calendar, day sheet and bulk corrections', 1, 1, 1],
  ['Leave applications, approvals and balances', 1, 1, 1],
  ['Monthly accrual on your own rates, per leave type', 1, 1, 1],
  ['Holiday calendar and week-off pattern', 1, 1, 1],
  ['Employee records, reporting lines and directory', 1, 1, 1],
  ['Documents and policies, filed per employee', 1, 1, 1],
  ['Roles and permissions, granted not assumed', 1, 1, 1],
  ['Audit log of who changed what', 1, 1, 1],
  ['Biometric reader sync', 1, 1, 1],
  ['Payroll cycle run against real attendance', 0, 1, 1],
  ['Salary structures — basic, HRA, allowances, PF, PT, TDS', 0, 1, 1],
  ['Payslip PDFs, released to the employee', 0, 1, 1],
  ['Loss of pay, priced the same on slip and sheet', 0, 1, 1],
  ['Salary sheet export for your bank and your CA', 0, 1, 1],
  ['Reports and analytics', 0, 1, 1],
  ['The mobile app, for every employee', 0, 0, 1],
  ['Punch in and apply for leave from a phone', 0, 0, 1],
  ['More than one company, each provisioned by us', 0, 0, 1],
  ['A payroll cycle set per company, not one for all', 0, 0, 1],
  ['One invoice across every company you run', 0, 0, 1],
  ['A named contact and priority turnaround', 0, 0, 1],
];

const PLANS = [
  {
    key: 'attendance',
    name: 'Attendance & Leave',
    line: 'For a company that needs the days right before it needs the money right.',
    year: 71,
    month: 85,
    day: '2.40',
    min: 'From 25 people',
    highlights: [
      'Attendance, night shifts included',
      'Leave, approvals and accrual',
      'Employee records and documents',
      'Biometric reader sync',
      'Roles, permissions and audit log',
    ],
  },
  {
    key: 'payroll',
    name: 'Payroll',
    rec: true,
    line: 'Everything above, plus the month actually closing — the only plan that gets you to a payslip.',
    year: 99,
    month: 119,
    day: '3.30',
    min: 'From 25 people',
    inherits: 'Attendance & Leave',
    highlights: [
      'Payroll run against real attendance',
      'Salary structures and payslip PDFs',
      'Loss of pay, priced consistently',
      'Salary sheet export',
      'Reports and analytics',
    ],
  },
  {
    key: 'everything',
    name: 'Everything',
    line: 'The same system in your people’s pockets, and as many companies as you run.',
    year: 124,
    month: 149,
    day: '4.10',
    min: 'From 25 people',
    inherits: 'Payroll',
    highlights: [
      'The mobile app for every employee',
      'Punch in and apply for leave from a phone',
      'As many companies as you run',
      'A payroll cycle set per company',
      'A named contact, priority turnaround',
    ],
  },
];

/* Monthly spend at the annual rate. Published because the per-person number
 * is the one nobody can do arithmetic on in their head. */
const SIZES = [25, 50, 100, 250];

const SETUP = [
  ['Create the company',
    'Its own database schema, departments, designations, the holiday calendar and the week-off pattern.'],
  ['Load your people',
    'Employees, reporting lines, logins, and biometric IDs mapped to the reader if you have one.'],
  ['Build your leave rules',
    'Every leave type you use, its monthly accrual rate, and the opening balance each person carries in.'],
  ['Set your payroll cycle',
    'The 25th to the 24th, the 1st to the 31st, or whatever yours actually is. Payroll and Group.'],
  ['Build the salary structures',
    'Basic, HRA, allowances, PF, professional tax and TDS, per person or per designation. Payroll and Group.'],
  ['Run the first cycle beside you',
    'Against a real month of your own attendance, until the figures agree with what you expected. Payroll and Group.'],
];

const FAQ = [
  ['Who does the setting up?',
    'We do. You do not get a blank system and a checklist. Our admin creates the company, configures it against your rules, loads your people and hands over the logins. The first time you sign in, the company is already working.'],
  ['How do we add another company later?',
    'You tell us and we provision it — its own schema, its own roles, its own calendar, separate from the first. Creating a company is a platform-admin action on our side by design, so a company can never be spun up by accident, and nothing is shared between them afterwards.'],
  ['What if our headcount changes?',
    'You are billed on the people actually on the system. Annual plans are trued up at renewal; monthly plans follow the headcount each month. The plan minimum is the floor, not a commitment to hire.'],
  ['Are the prices inclusive of GST?',
    'No. Every figure on this page is exclusive of GST, which is charged at the prevailing rate. There is nothing else added later — no per-module fee, no charge per payslip, no charge per export.'],
  ['What is the commitment?',
    'Annual means a year, paid up front, and setup is included in it. Monthly means a month: give us thirty days and it stops, and setup is ₹12,000 per company because someone here does that work whether you stay or not.'],
  ['Where does the data live, and who can see it?',
    'In one installation we operate, with your company in its own PostgreSQL schema rather than a shared table behind a filter. Permissions are granted rather than assumed, and the server enforces them independently of what the screen shows.'],
  ['If we leave, do we get our data?',
    'Yes. You get the salary sheets, the attendance and the documents out before the schema is dropped. Ask for it and it is yours — it is your payroll record, not our leverage.'],
];

/* What a plan does NOT include, taken straight from FEATURES so the card and
 * the comparison table can never disagree. Four is enough to make the gap felt;
 * the rest is one anchor away. */
const SHOWN = 4;
function missingFor(index) {
  const all = FEATURES.filter((f) => !f[index + 1]).map((f) => f[0]);
  return { shown: all.slice(0, SHOWN), rest: Math.max(0, all.length - SHOWN) };
}

function Tick({ on, label }) {
  return on
    ? <Check size={16} className="cmp__yes" aria-label={`${label}: included`} />
    : <Minus size={16} className="cmp__no" aria-label={`${label}: not included`} />;
}

export default function Pricing() {
  return (
    <>
      {/* ------------------------------------------------ head */}
      <section className="section section--tight">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">Pricing</p>
            <h1>Priced per person.<br />Set up by <span className="tint">us.</span></h1>
            <p className="lede">
              Three plans, one per-person rate, and no implementation project.
              Pay annually and the setup is included — we create the company,
              load your people and run your first payroll cycle beside you.
            </p>
          </div>

          {/* ---------------------------------------------- plans */}
          <div className="plans">
            {PLANS.map((p, i) => (
              <article className={`plan${p.rec ? ' plan--rec' : ''}`} key={p.key}>
                {/* Reserved on every card, so the flag does not push one
                    column's price 40px below the other two — comparing them
                    is the only reason this table exists.
                    "Recommended" and not "Most popular": we have no customers
                    yet, and will not imply we do. */}
                <p className="plan__flag" aria-hidden={p.rec ? undefined : 'true'}>
                  {p.rec ? 'Recommended' : ' '}
                </p>

                <h2 className="plan__name">{p.name}</h2>
                <p className="plan__line">{p.line}</p>

                <p className="plan__price">
                  <span className="plan__amt">₹{p.year}</span>
                  <span className="plan__unit">per person<br />per month</span>
                </p>
                <p className="plan__terms">
                  Billed annually. <b>₹{p.month}</b> if you pay monthly —
                  about ₹{p.day} a day per person.
                </p>
                <p className="plan__min">{p.min}</p>

                <Link className={`btn btn--lg ${p.rec ? 'btn--primary' : 'btn--ghost'} plan__cta`} href="/#contact">
                  Talk to us <ArrowRight size={16} aria-hidden="true" />
                </Link>

                <ul className="plan__list">
                  {p.inherits && (
                    <li className="plan__inherit">
                      Everything in {p.inherits}, plus
                    </li>
                  )}
                  {p.highlights.map((h) => (
                    <li key={h}>
                      <Check size={15} aria-hidden="true" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                {(() => {
                  const { shown, rest } = missingFor(i);
                  if (!shown.length) {
                    return (
                      <div className="plan__not plan__not--none">
                        <p className="plan__notlabel">Not included</p>
                        <p className="plan__nothing">Nothing. This plan is everything we make.</p>
                      </div>
                    );
                  }
                  return (
                    <div className="plan__not">
                      <p className="plan__notlabel">Not included</p>
                      <ul>
                        {shown.map((m) => (
                          <li key={m}>
                            <X size={14} aria-hidden="true" />
                            <span>{m}</span>
                          </li>
                        ))}
                      </ul>
                      {rest > 0 && (
                        <a className="plan__more" href="#compare">
                          and {rest} more — see the full table
                        </a>
                      )}
                    </div>
                  );
                })()}
              </article>
            ))}
          </div>

          <p className="plans__foot">
            Every figure on this page is per person, per month, exclusive of GST.
            Setup is included on annual billing and ₹12,000 per company on monthly.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ what it costs */}
      <section className="section section--surface" id="estimate">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">What that comes to</p>
            <h2>The arithmetic, done for you.</h2>
            <p className="lede">
              A per-person rate is hard to feel. These are monthly totals at the
              annual rate, before GST.
            </p>
          </div>

          <div className="tablewrap" tabIndex={0} role="region" aria-label="Monthly cost by company size">
            <table className="table cmp cmp--money">
              <caption className="sr">
                Monthly cost at the annual rate for four company sizes, in each plan.
                Group requires at least 100 people across your companies, so smaller
                sizes show no figure.
              </caption>
              <thead>
                <tr>
                  <th scope="col">People</th>
                  {PLANS.map((p) => <th scope="col" className="num" key={p.key}>{p.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {SIZES.map((n) => (
                  <tr key={n}>
                    <th scope="row">{n}</th>
                    {PLANS.map((p) => (
                      <td className="num mono" key={p.key}>
                        {`₹${(n * p.year).toLocaleString('en-IN')}`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: '.8125rem', marginTop: 'var(--s4)' }}>
            Pay monthly instead and each figure rises by about a fifth, plus ₹12,000
            once per company for the setup.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ setup */}
      <section className="section" id="setup">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">Onboarding</p>
            <h2>You do not implement anything.</h2>
            <p className="lede">
              This is the part that usually kills an HR rollout: the software
              arrives empty, nobody has a spare fortnight to fill it, and it
              quietly goes unused. So we fill it. Here is the work, and it is
              ours.
            </p>
          </div>

          <ol className="setup">
            {SETUP.map(([title, body], i) => (
              <li className="setup__item" key={title}>
                <span className="setup__n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </li>
            ))}
          </ol>

          <p className="setup__foot">
            The first time your HR lead signs in, the departments exist, the
            people are in, the leave balances are right and the cycle dates are
            yours. What is left is the month — which is the only part that was
            ever your job.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ comparison */}
      <section className="section section--surface" id="compare">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">Side by side</p>
            <h2>All of it, in one table.</h2>
          </div>

          <div className="tablewrap" tabIndex={0} role="region" aria-label="Feature comparison across the three plans">
            <table className="table cmp">
              <caption className="sr">
                Every feature, and which of the three plans includes it.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  {PLANS.map((p) => <th scope="col" className="cmp__h" key={p.key}>{p.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {FEATURES.map(([label, a, b, c]) => (
                  <tr key={label}>
                    <th scope="row" className="cmp__f">{label}</th>
                    <td className="cmp__c"><Tick on={a} label={label} /></td>
                    <td className="cmp__c"><Tick on={b} label={label} /></td>
                    <td className="cmp__c"><Tick on={c} label={label} /></td>
                  </tr>
                ))}
                {/* Not a bare "Included": it is included on annual billing and
                    charged on monthly, and saying otherwise here would
                    contradict the FAQ two sections down. */}
                <tr>
                  <th scope="row" className="cmp__f">Setup, done by us</th>
                  {PLANS.map((p) => (
                    <td className="cmp__c" key={p.key} style={{ fontSize: '.8125rem' }}>
                      Included on annual<br />
                      <span className="faint">₹12,000 on monthly</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ faq */}
      <section className="section" id="faq">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">Before you ask</p>
            <h2>The questions that decide it.</h2>
          </div>

          <div className="faq">
            {FAQ.map(([q, a]) => (
              <details className="faq__item" key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ cta */}
      <section className="section section--tight">
        <div className="wrap">
          <div className="ctaband">
            <p className="eyebrow">Get started</p>
            <h2>Tell us about the company.</h2>
            <p>
              Headcount, shift pattern and when your payroll cycle runs. That is
              enough for us to tell you the plan, the monthly figure and the date
              we can hand it over.
            </p>
            <div className="row row--wrap" style={{ gap: 'var(--s3)', justifyContent: 'center' }}>
              <a
                className="btn btn--primary btn--lg"
                href="mailto:info@validuresolutions.com?subject=ValidureHR%20pricing"
              >
                Talk to us <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link className="btn btn--ghost btn--lg" href="/login">See it running</Link>
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
