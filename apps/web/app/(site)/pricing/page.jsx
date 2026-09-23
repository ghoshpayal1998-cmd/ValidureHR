import Link from 'next/link';
import { Check, Minus, ArrowRight } from 'lucide-react';
import { FEATURES, PLANS, SIZES } from './plans';
import PlanCards from './PlanCards';

export const metadata = {
  title: 'Pricing — ValidureHR',
  description:
    'Per person, per month, with setup included on annual billing. We create the company, load your people and run your first payroll cycle with you.',
};

const SETUP = [
  ['Create the company',
    'Its own database schema, departments, designations, the holiday calendar and the week-off pattern.'],
  ['Load your people',
    'Employees, reporting lines, logins, and biometric IDs mapped to the reader if you have one.'],
  ['Build your leave rules',
    'Every leave type you use, its monthly accrual rate, and the opening balance each person carries in.'],
  ['Set your payroll cycle',
    'The 25th to the 24th, the 1st to the 31st, or whatever yours actually is. Payroll and Everything.'],
  ['Build the salary structures',
    'Basic, HRA, allowances, PF, professional tax and TDS, per person or per designation. Payroll and Everything.'],
  ['Run the first cycle beside you',
    'Against a real month of your own attendance, until the figures agree with what you expected. Payroll and Everything.'],
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

          <PlanCards />

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
