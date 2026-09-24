# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Employees** are the largest group and the lightest users. They sign in to punch
in and out, check a month of their own attendance, see what leave they have
left, apply for it, and download a payslip, an appointment letter or a company
policy. Many of them work a night shift and open the product outside office
hours, often on a phone.

**HR** runs the company inside the product: the employee directory, marking and
correcting attendance a day at a time or a whole day at once, approving leave,
granting and adjusting leave balances, issuing payslips, and keeping
departments, designations, holidays and announcements current.

**Reporting managers** are employees with direct reports. They are told about
their team's leave but do not approve it — approval sits with HR and the
directors. This is deliberate and future work must not turn the manager's
intimation into an approval queue.

**Owners and directors** hold the company-admin roles. They see everything HR
sees plus company-wide analytics, and they are the only roles that may approve
their own leave.

**Platform administrators** operate the installation rather than any one
company. They sign in against a separate account table, pick a company to work
in, and manage per-user permission grants and the company list.

## Product Purpose

ValidureHR is an HR system covering attendance, leave, payroll and employee
documents for a whole company in one place. Success is a month closing without
anyone reconciling attendance by hand: punches, leave and holidays land in the
right payroll cycle on their own, and the payslip and the salary sheet agree.

It is a product Validure Solutions intends to sell to other companies, not an
internal tool. The marketing surface addresses a company evaluating an HR
system, not a Validure employee looking for a link.

## Positioning

**Many companies, one installation.** Each company gets its own Postgres schema
(`c_<slug>`) inside a single deployment, with a platform console above them for
the operator. Tenants are separated at the schema boundary rather than by a
tenant column that every query has to remember to filter on.

Confirmed with the user on 2026-09-22, and it supersedes an earlier assumption:
the marketing homepage was written to lead on night-shift correctness, which is
a real capability but is **not** the position. Night-shift handling is a proof
point, not the headline.

## Operating Context

- **The working day is not the calendar day.** The reference shift runs
  **19:00–04:00 IST**, so a punch-out lands on the day after the punch-in.
  Attendance is keyed to the shift's **start** date everywhere.
- **The payroll cycle is a per-company setting**, not a fixed month. The seeded
  company runs the 25th to the 24th, so a sheet named for one month is paid
  against the previous month's closing days. A cycle starting on the 1st is a
  plain calendar month. Nothing may hard-code a cycle.
- **The accrual day is derived from the cycle start day** and is never stored
  separately. Two numbers that must agree were once stored apart and drifted.
- **Server time is not IST.** Business dates move as `YYYY-MM-DD` strings and
  are taken apart rather than parsed; `new Date('2026-09-24')` shifts the day.
- **Email may be absent.** Without SMTP configured, mail is recorded in an
  in-app email log instead of sent, and the product says so rather than
  implying delivery.
- **Storage is pluggable** between local disk and Supabase object storage.
  Payslips, policies, offer letters, leave attachments and photos all sit
  behind authentication and cannot be linked to directly.

## Capabilities and Constraints

- Attendance: self-service punch, HR edit per employee-day, whole-day bulk
  marking, a month calendar, CSV export, and an optional biometric-device
  mapping that is a **per-company feature flag** (`has_device_attendance`) —
  the routes answer 404 for a company without it, by design.
- Leave: per-type balances that accrue monthly, applications with an optional
  attachment, approval and rejection with a reason, cancellation, and a
  ledger. Exactly one type is unpaid — the code **`UL`**. Every other type,
  loss of pay included, is drawn against a balance and refused when short.
- Payroll: a per-employee salary structure, generated or uploaded payslips,
  loss-of-pay accounting, and a salary sheet export that includes bank
  details and is written to the audit log.
- Documents: payslips, company policies and appointment letters, each served
  through an authenticated endpoint.
- **Permissions are granted, never assumed.** Twelve keys exist:
  `employees.view` `employees.manage` `attendance.view_all`
  `attendance.manage` `attendance.export` `leaves.view_all` `leaves.approve`
  `balances.manage` `documents.manage` `reports.view` `analytics.view`
  `settings.manage`. There is no `payroll.view`. An ungranted capability is
  **absent** from the interface, not disabled, and the API enforces the same
  rule independently.
- The backend is ported from F1HR, a system running in production for another
  company. The repository is private and must stay private for that reason.
- **Onboarding is done by us, not by the buyer.** `companies.js` is guarded by
  `requireAdmin`: only the platform admin can create a company. Validure's admin
  provisions the schema, configures departments, leave rules, the holiday
  calendar, the payroll cycle and the salary structures, loads the employees,
  and hands over the logins. A customer never creates a company, and the
  marketing must never imply self-serve signup or a free trial someone
  activates alone. Confirmed by the user 2026-09-23.
- **Multi-tenancy is our operational leverage, not a customer-facing feature.**
  One installation serving many companies is why onboarding can be included
  rather than sold as an implementation project. It is sold to a buyer only in
  the narrow case where that buyer runs several entities and wants each one
  provisioned separately — the Group plan.
- **Pricing, revised 2026-09-23.** Three plans, per person per month,
  exclusive of GST, all from 25 people:
  **Attendance & Leave** ₹71 annual / ₹85 monthly (no payroll);
  **Payroll** ₹99 / ₹119 (the recommended plan);
  **Everything** ₹124 / ₹149 (adds the employee mobile app, plus more than
  one company). Annual billing is roughly two months free and includes setup;
  monthly billing carries a real ₹12,000 setup fee per company. The numbers
  live in one array in `apps/web/app/(site)/pricing/page.jsx`.
  - The top tier is led by **the mobile app**, not by multi-tenancy. Several
    companies is bundled there too, but it is not what the tier is sold on.
  - The **Recommended** flag on Payroll states a first-party reason. No plan may
    carry "Most popular" or any other claim about how other buyers chose, and no
    crossed-out price may appear unless that price is genuinely charged to
    someone. The ₹12,000 setup fee qualifies because monthly customers pay it.
  - Each card names what it withholds, derived from the same feature matrix the
    comparison table renders so the two cannot drift apart.
- **Plans are enforced, as of 2026-09-24.** `companies.plan` holds `basic`,
  `essential` or `advanced`, and `tenant()` intersects a caller's granted
  permissions with that plan's entitlements. A plan is a **ceiling, not a
  grant**: effective = (role ∪ user grants) ∩ plan. Roles are never rewritten
  by a plan change, so a downgrade is reversible and a hand-scoped role
  survives it. Platform admins are exempt — support must reach any company.
  - `payroll.manage` was split out of `documents.manage` for this. Basic sells
    payslips and LOP; Essential sells the cycle, the structures and the export.
    One key could not express that boundary, so before the split nothing
    stopped a Basic company running payroll.
  - Advanced entitles the same keys as Essential. Its extras — the mobile app
    and more than one company — are not permission keys: the app is a client
    that would have to identify itself, and company count is how many we
    provision. **Neither is enforced by the server today.**
- **A plan is a default, not a cage.** `companies.entitlement_overrides` holds
  `{"grant":[],"revoke":[]}`, applied on top of the plan, so one customer can be
  given a capability their plan excludes without being moved to a higher plan
  and billed for it — or have one withheld that their plan includes. Revoke
  beats grant. A malformed value means no override, never a crash. The platform
  console edits this as a matrix and every change is written to the company's
  own audit log.
  - This still cannot hand a user a permission their role was not given: the
    entitlement set is a ceiling that `tenant()` intersects with the caller's
    granted permissions, so an EMPLOYEE at a fully entitled company holds
    nothing.
- **There is still no self-serve purchase.** No signup, checkout, payment
  provider or seat counting exists, and the "from 25 people" minimum is not
  enforced anywhere. Onboarding is `POST /api/companies`, which since
  2026-09-24 optionally creates the first OWNER login in the same call and
  emails the password. That matches the site, which only ever says "talk to us".
- **Still undecided:** licensing, and the hosting model a buyer would get.
  Future work must not invent them.

## Brand Commitments

- The product is **ValidureHR**, from **Validure Solutions Pvt. Ltd.**
- The visual language is taken from the company site,
  <https://www.validuresolutions.com/>, so the product and the marketing site
  read as one brand.
- The logo is an auto-traced SVG in the brand's teal-to-navy ramp. Small marks
  flatten that ramp to a two-tone split on hue; large lockups keep the full
  ramp. A **lightness-inverted dark variant was rejected by the user** as
  washed out — that approach must not return.
- The company site is light-only. The product carries a dark theme derived
  from the brand ink rather than inverted from the light one.

## Evidence on Hand

- **Everything in the database is synthetic.** The seed creates Validure
  Solutions Pvt. Ltd. with 24 invented employees, a month of attendance, leave
  history, three months of payslips, six policies and an appointment letter
  each. Generated PDFs say on their face that they are demo content.
- **There are no customers, no testimonials, no case studies, no press, no
  benchmarks and no uptime record.** None may be fabricated, implied, or
  dressed up as anonymous ("a leading firm", "teams like yours"). A marketing
  surface must earn its credibility from the mechanism and the product itself.
- Real assets: the Validure logo (`apps/web/public/`), the live company site as
  a visual reference, and the running product with its seeded company.
- `docs/api-shapes.md` records every endpoint's real response and the query
  parameters each route reads, scanned from the route source.

## Product Principles

1. **The cycle is the unit of truth, not the month.** Anything that counts days
   or money does it against the company's configured payroll cycle.
2. **Say only what the system will actually do.** A control that the API will
   refuse does not get rendered; a message does not promise an effect the route
   does not perform; a figure does not imply a precision it does not have.
3. **Permission is granted, not assumed** — and absence is the interface, not a
   disabled state.
4. **Multi-tenancy is a boundary, not a column.** Nothing may leak across the
   schema line, and the platform console stays separate from company work.
5. **Demo data is labelled as demo.** The product may ship with a full seeded
   company, and must never let that read as a real customer.

## Accessibility & Inclusion

**WCAG 2.2 AA is binding**, confirmed with the user on 2026-09-22. In practice
for this product: every input has a real associated label; icon-only controls
carry an accessible name; status is never signalled by colour alone (every
badge and calendar cell prints its meaning as text); contrast holds in both
themes; and the whole product is operable from the keyboard, including the
dialogs, which trap focus and restore it on close.

Employees read this on a phone, at night, at the start or end of a shift. Small
viewports and dark mode are ordinary conditions, not edge cases.
