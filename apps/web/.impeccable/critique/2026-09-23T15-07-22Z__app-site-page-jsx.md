---
target: the marketing homepage
total_score: 17
max_score: 36
na_heuristics: 7
p0_count: 3
p1_count: 2
target_identity: "file:C:\\d drive\\current work\\projects\\VHR\\apps\\web\\app\\(site)\\page.jsx"
target_fingerprint: "sha256:6867dcacaf256fd6baabb8c1465cccd1f17260ff875a465fcfc253b6f65b26b5"
target_path: "C:\\d drive\\current work\\projects\\VHR\\apps\\web\\app\\(site)\\page.jsx"
timestamp: 2026-09-23T15-07-22Z
slug: app-site-page-jsx
---
# Design Critique — ValidureHR marketing homepage

Method: dual-agent (design review + detector/browser evidence, isolated & parallel).
Mode: Persuade. Target: app/(site)/page.jsx, site.css, layout.jsx.

## Design Health Score — 17/36 (Poor, 47%); H7 n/a

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | No scroll-spy; .step[data-on] implies a current step that never changes |
| 2 | Match System / Real World | 3 | "its own isolated schema" untranslated, and it carries the position |
| 3 | User Control and Freedom | 2 | "See it running" -> bare credentials form, no demo, no way back |
| 4 | Consistency and Standards | 1 | Four h2 sizes; 17 font sizes, 10 in a 7px band; 6 hover-lifting non-clickable cards |
| 5 | Error Prevention | 2 | Conversion path is a mailto: with no form, validation, or fallback |
| 6 | Recognition Rather Than Recall | 3 | Tenancy fact split across 3 sections in 3 vocabularies |
| 7 | Flexibility and Efficiency | n/a | Linear Persuade surface, no repeat task |
| 8 | Aesthetic and Minimalist Design | 2 | Real restraint undone by 5 sections with zero padding |
| 9 | Error Recovery | 1 | mailto has no fallback; "See it running" guarantees a sign-in failure |
| 10 | Help and Documentation | 1 | No pricing, security posture, or implementation material |

## Design Specificity Verdict

Category-interchangeable skeleton (~85%): eyebrow/h1/lede/2-CTA + mock, 4-up stat strip,
3x2 icon-card grid with the default six HR icons, 01-04 steps, alternating splits, CTA band.
Genuinely authored: the two .shot blocks are built from the product's own component classes,
so mock and product cannot drift; the #shifts table (19:02 -> 04:03) is unreusable by anyone else.
But the headline is wrong, so even the authored material argues for the wrong product.

Deterministic scan: 19 advisory findings. The one colour finding is a FALSE POSITIVE
(#000 inside a mask-image gradient, alpha-only). The 18 font-size findings indict DESIGN.md,
which documents only the product type ramp and no marketing display scale.

## Priority Issues

[P0] The page sells the wrong product. Confirmed position is "many companies, one installation";
the page leads on night-shift correctness and states the position only as fragments inside
step 01, a #shifts check, and a #security check. Fix: rewrite the hero around the boundary,
move tenancy into the evidence slot with the four-beat structure night shift has, demote night
shift to the proof point. Update both metadata descriptions.

[P0] --section-y is undefined. Used once at site.css:61, defined nowhere. padding-block falls
back to 0px on #features, #how, #shifts, #security, #contact. Tint bands flush against text;
at 390px two sections read as one paragraph (~4px apart). With no scroll-margin-top, two of
four nav links scroll to a heading hidden behind the 73px sticky header.
Fix: define --section-y: clamp(4.5rem, 9vw, 8rem) and add scroll-margin-top.

[P0] Six claims PRODUCT.md forbids or contradicts: "send us a month of attendance" and
"a live tour of your own data" (tenant onboarding undecided); "Running by the end of the week"
(no implementation record); session-timeout and self-verifying-backup claims (hosting undecided,
carried over from F1HR); "not uploaded by hand" (payslips are generated OR uploaded); device
attendance presented as mandatory (per-company flag, routes 404 by design); "6 leave types"
contradicting "your own rules" two sections later.

[P1] Conversion path is a mailto: and a login wall. No form, no validation, silently fails
without a mail client. Phone is plain text, not tel:. /login has no link back to the site.

[P1] Measured accessibility failures against newly-binding WCAG 2.2 AA:
14 of 18 visible interactive elements under 44x44px; NO navigation at 390px (nav display:none,
no hamburger in the DOM); four AA contrast failures in light (.badge--warn 3.33, .badge--ok 3.94)
and one in dark (skip link 2.19); heading skip h2 -> h4; both .shot panels aria-hidden including
the #shifts table; .step__n at 4.23:1. Plus a product-wide global 0.01ms reduced-motion kill that
freezes the loading spinner and skeleton shimmer.

## Persona Red Flags

Jordan: h1 establishes category only; lede appeals to a reputation he doesn't hold; stat strip
reads as facts then turns out to be wordplay; "See it running" dead-ends.
Riley: six false hover affordances; two of four nav links land on a hidden heading; no answer to
"we don't have a reader"; copy denies the upload capability the product has.
Casey: 7,040px with no navigation at all; 11px tracked mono wrapping to three lines at 4.96:1;
hero mock eats 64% of a viewport and is aria-hidden; theme toggle outranks all navigation.

## Minor Observations

No OpenGraph/Twitter metadata. Hard <br> in the h1 ("HR that runson time."). Focus ring is the
same colour as the button it rings (1.00 contrast, carried by the 2px offset). "ValidureHR v1.0"
in the footer reads as a beta signal. Unused __nextjs-Geist font families. Three identical teal
primaries, two in the first viewport, against DESIGN.md's One Pen Rule.

Eyebrow: the craft floor bans kickers outright, but its preamble defers to a pinned brief. The
mono eyebrow is lifted from validuresolutions.com and was the original brief. KEPT deliberately.

## Questions to Consider

Who is actually buying — the operator or the single company? What is the equivalent of the
04:03 table for schema isolation? What if the page admitted having no customers yet? Why does
the per-company payroll cycle appear nowhere?
