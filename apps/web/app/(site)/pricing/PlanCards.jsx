'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { Check, X, ArrowRight } from 'lucide-react';
import { PLANS, missingFor } from './plans';

/*
 * The three plan cards and the billing switch.
 *
 * Annual is selected by default because it is the better deal and the one we
 * would recommend, but the monthly figure is never hidden: it stays on the
 * card underneath whichever price is showing. A toggle that conceals the
 * higher number is the drip-pricing trick this page refuses elsewhere, and a
 * buyer who finds the real monthly rate at checkout stops believing the rest
 * of the page.
 *
 * It is a radiogroup rather than a checkbox: there are two named billing
 * terms, not one thing being turned on and off, and that is what a screen
 * reader should hear.
 */
export default function PlanCards() {
  const [annual, setAnnual] = useState(true);
  const groupId = useId();

  return (
    <>
      <div className="billing" role="radiogroup" aria-labelledby={groupId}>
        <span className="sr" id={groupId}>Billing period</span>
        <button
          type="button"
          role="radio"
          aria-checked={annual}
          className={`billing__opt${annual ? ' is-on' : ''}`}
          onClick={() => setAnnual(true)}
        >
          Annual
          <span className="billing__save">2 months free</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!annual}
          className={`billing__opt${annual ? '' : ' is-on'}`}
          onClick={() => setAnnual(false)}
        >
          Monthly
        </button>
      </div>

      <div className="plans">
        {PLANS.map((p, i) => {
          const price = annual ? p.year : p.month;
          const other = annual ? p.month : p.year;
          const { shown, rest } = missingFor(i);
          return (
            <article className={`plan${p.rec ? ' plan--rec' : ''}`} key={p.key}>
              {/* Reserved on every card so the flag does not push one column's
                  price below the other two. "Recommended" and not "Most
                  popular": we have no customers yet, and will not imply we do. */}
              <p className="plan__flag" aria-hidden={p.rec ? undefined : 'true'}>
                {p.rec ? 'Recommended' : ' '}
              </p>

              <h2 className="plan__name">{p.name}</h2>
              <p className="plan__line">{p.line}</p>

              <p className="plan__price">
                <span className="plan__amt">₹{price}</span>
                <span className="plan__unit">per person<br />per month</span>
              </p>
              <p className="plan__terms">
                {annual
                  ? <>Billed annually. <b>₹{other}</b> if you pay monthly — about ₹{p.day} a day per person.</>
                  : <>Billed monthly. <b>₹{other}</b> on an annual plan, which also includes the setup.</>}
              </p>
              <p className="plan__min">{p.min}</p>

              <Link
                className={`btn btn--lg ${p.rec ? 'btn--primary' : 'btn--ghost'} plan__cta`}
                href="/#contact"
              >
                Talk to us <ArrowRight size={16} aria-hidden="true" />
              </Link>

              <ul className="plan__list">
                {p.inherits && (
                  <li className="plan__inherit">Everything in {p.inherits}, plus</li>
                )}
                {p.highlights.map((h) => (
                  <li key={h}>
                    <Check size={15} aria-hidden="true" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              {shown.length ? (
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
              ) : (
                <div className="plan__not plan__not--none">
                  <p className="plan__notlabel">Not included</p>
                  <p className="plan__nothing">Nothing. This plan is everything we make.</p>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
