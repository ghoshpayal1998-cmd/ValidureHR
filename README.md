# ValidureHR — interactive mockup

A clickable, static mockup of **ValidureHR**: the F1HR feature set,
rebuilt in the Validure Solutions design language.

There is **no backend and no authentication**. Password fields exist
because the real product needs them, but nothing is checked — any
credentials sign you in, and every screen renders from a fixed sample
dataset. A banner under the top bar says so on every page.

## Running it

Any static file server will do — the pages use relative paths and no
build step:

```bash
python -m http.server 4173
```

Then open <http://localhost:4173>.

Opening `index.html` straight off the disk mostly works too, but a
server is closer to how it will really be served.

## Where things are

```
index.html                  sign-in (the only page without the app shell)
change-password.html
employee/                   the employee's own screens
  index.html                home — punch in/out, who's away, holidays, announcements
  profile.html              profile details + company directory
  attendance.html           month calendar + detail
  leave/                    balance · apply · history · approvals
  documents/                salary slips · offer letter · policies
admin/                      HR and management screens
  index.html                overview
  employees.html  attendance.html  leaves.html  balances.html
  payroll.html              run payroll + salary structures
  documents.html            salary slips + policies + offer letters
  reports.html  analytics.html  settings.html  emails.html  access.html
platform/index.html         multi-company console
assets/
  css/vhr.css               the whole design system — one file
  js/shell.js               sidebar, top bar, notifications, modals, toasts
  js/data.js                every row the mockup shows
  brand/                    logo assets (see Logo below)
CONTRACT.md                 the rules each page was built to
docs/
  audit-harness.html        dev-only checker (see Checking below)
  f1hr-screen-specs.json    the F1HR screen inventory this was built from
```

## Design

The visual language is lifted from
[validuresolutions.com](https://www.validuresolutions.com/) so the
product and the marketing site read as one brand:

| | |
|---|---|
| Accent | `#0e7e90` teal, `#38e1ff` cyan |
| Ink / page | `#0b1526` on `#f7f9fb` |
| Headings | Archivo 680, tight tracking |
| Body | Hanken Grotesk |
| Labels | JetBrains Mono, uppercase, wide tracking |
| Cards | white, 16px radius, hairline border, soft lift |

Everything is a CSS custom property in `assets/css/vhr.css`. Nothing
in a page hard-codes a colour.

### Logo

`assets/brand/` holds four files derived from the master brand SVG
(`validure-logo.svg`, kept as supplied):

| file | what |
|---|---|
| `validure-mark.svg` | the knot alone, cropped to `9832 1337 7924 8013` |
| `validure-mark-dark.svg` | the same, re-ramped for dark backgrounds |
| `validure-lockup.svg` | knot + wordmark, whitespace trimmed |
| `validure-lockup-dark.svg` | the same, re-ramped |

Cropping is done with `viewBox`, never by deleting paths, so the
geometry is identical to the asset you supplied.

The master is auto-traced: 953 paths across an 18-step colour ramp
running from brand teal to near-black navy. The navy half is
invisible on a dark background — the wordmark genuinely disappears —
so the dark variants **invert the ramp's lightness while keeping hue
and saturation**. The darkest navy step becomes the lightest, the
teal end stays teal, and the knot keeps its woven two-tone read
instead of flattening to grey. A CSS filter would have muddied the
teal, and a single fill swap was never an option with 18 steps.

One caveat: at 351 KB the traced mark is heavy, and it turns to mush
below about 24px. It is fine here (cached after first load, used at
28–34px), but a production build wants a hand-drawn mark for small
sizes and a favicon.

### Checking

`docs/audit-harness.html` loads every page in an iframe and inspects
the **rendered** DOM — necessary because most of this app's markup
(labels, table rows, buttons) does not exist until `shell.js` and the
page script have run, so a static scan reports phantom problems. It
checks accessible names, alt text, table headers, heading order,
classes matching no CSS rule, raw colours in inline styles, and
containers that rendered empty. Open it with the server running.

Current state: **25/25 pages clean**, and no horizontal overflow at
320, 390, 768 or 1280px.

**Dark mode** is included. Validure's own site is light-only, so the
dark palette is derived from the brand rather than inverted: the page
background *is* the brand ink `#0b1526`, and the teal is lightened
along the brand's own teal→cyan axis until it clears 4.5:1 as text.
It follows the OS by default; the sun/moon button in the top bar pins
a preference, which persists across pages.

## Trying it out

- The **role picker** in the top bar switches between Employee, HR
  Manager and Platform Admin. The sidebar rebuilds itself — this is
  how the real permission gating will behave, where an item you have
  not been granted is absent rather than greyed out.
- The **bell** has unread notifications and a "mark all read".
- Forms, modals, tab strips, filters, approve/reject and punch in/out
  all respond. Nothing persists past a reload except your theme and
  role choice.

## What this is not

Not wired to anything. No data is saved, no email is sent, no file is
really uploaded, and no password is verified. It exists to agree on
layout and feel before the real thing is built.
