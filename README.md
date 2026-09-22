# ValidureHR

HR software from Validure Solutions: attendance, leave, payroll and
documents for the whole company, in one place.

```
Validure-HR/
  apps/
    web/       the marketing site + product UI (Next.js 15, app router)
    api/       the REST API (Express + Postgres), ported from F1HR
  mockup/      the clickable design reference — 25 static pages, no backend
  package.json npm workspaces root
```

An npm workspaces monorepo: one `npm install` at the root installs
both apps and hoists their dependencies, and the root scripts below
drive either one.

## Running it

Needs Node 20.6+ (for `--env-file`) and a Postgres. Verified end to end
on Node 24 with Postgres 16.

### 1. A database

```bash
npm run db:up
```

Starts a Postgres 16 container, or restarts the existing one — the
data survives. `npm run db:down` stops it. Any Postgres will do:
point `DATABASE_URL` at it instead.

### 2. The API

Install once, from the root:

```bash
npm install
```

The API reads `apps/api/.env`, which is gitignored and already generated on
this machine. On a fresh checkout, copy `.env.example` and set at
least these — the API refuses to boot otherwise, on purpose:

| | |
|---|---|
| `JWT_SECRET` | 32+ chars, and not one of the values published in this repo |
| `ADMIN_PASSWORD` | 12+ chars, not a documented default |
| `DATABASE_URL` | defaults to the docker line above |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Then create the schema and fill it:

```bash
npm run init && npm run seed && npm run dev:api
```

`init` creates the platform schema and the `admin` account from
`ADMIN_PASSWORD`. `seed:validure` creates Validure Solutions Pvt. Ltd.
with the same 24 people, leave types, shift pattern and September
attendance the mockup shows, so nothing renders empty. It is safe to
re-run — it drops and recreates only that one company.

The API listens on <http://localhost:5050>.

**Logins** — any employee code with the password the seeder prints
(`Validure@123`):

| | | |
|---|---|---|
| `VS-0101` | Vikram Rao | OWNER |
| `VS-0104` | Sneha Nair | HR |
| `VS-0113` | Ananya Iyer | EMPLOYEE |

Platform admin is `admin` with your `ADMIN_PASSWORD`.

### 3. The web app

```bash
npm run dev
```

<http://localhost:3000> — the marketing homepage. `/api/*` proxies to
port 5050 (`API_PROXY_URL` to change that).

**The product screens are not built yet.** Only the marketing site
exists so far; the API and its data are ready for them.

### The mockup

```bash
npm run mockup
```

Worth keeping running: it is the design reference the app is built
against, and it answers "what should this screen look like" faster
than the app does.

## Design

The visual language is lifted from
[validuresolutions.com](https://www.validuresolutions.com/) so the
product and the marketing site read as one brand.

| | |
|---|---|
| Accent | `#0e7e90` teal, `#38e1ff` cyan |
| Ink / page | `#0b1526` on `#f7f9fb` |
| Headings | Archivo 680, tight tracking |
| Body | Hanken Grotesk |
| Labels | JetBrains Mono, uppercase, wide tracking |
| Cards | 16px radius, hairline border, soft lift |

One stylesheet — `apps/web/app/globals.css`, carried over from the
mockup — holds every token. Nothing hard-codes a colour, which is
what makes the dark theme work at all.

**Dark mode** is derived from the brand rather than inverted:
Validure's own site is light-only, so the page background *is* the
brand ink `#0b1526`, and the teal is lightened along the brand's own
teal→cyan axis until it clears 4.5:1 as text.

### Logo

`mockup/assets/brand/` (and `apps/web/public/brand/`) hold variants derived
from the master `validure-logo.svg`, which is kept as supplied.

The master is auto-traced: 953 paths across an 18-step ramp from brand
teal to near-black navy. The small marks **flatten** that ramp to a
flat two-tone, split on hue rather than lightness — hue is what
actually divides the two strands (185°→233°), and 18 mid-tones turn to
mush at 28px. The large lockups keep the full traced colour, where the
gradient still resolves.

Cropping uses `viewBox`, never path deletion, so the geometry matches
the supplied asset exactly.

## Checking

- `mockup/docs/audit-harness.html` — loads every mockup page in an
  iframe and inspects the **rendered** DOM (accessible names, alt
  text, table headers, heading order, classes matching no CSS rule,
  raw colours, empty containers). A static scan of these pages reports
  mostly phantoms, because the markup is built in JS.
- `npm test` — 287 tests covering authorization, JWT
  handling, data access, uploads, cron auth, the payroll cycle and the
  storage drivers.

The mobile suites guard the contract between a Cordova client and this
API. ValidureHR has no mobile client yet, so they skip on a
missing-source check and switch themselves back on the day one exists.

## Relationship to F1HR

The backend is F1HR's, ported rather than rewritten: payroll, leave
accrual, the night-shift attendance cycle and the biometric device
sync are logic that already works, and the security suite is what
proves it keeps working.

Rebranding was not cosmetic. Database name, storage-bucket prefixes,
session keys and package names all changed together, so the two
systems cannot reach each other's data. Real employee addresses and
live production hosts from F1HR were replaced and the port was checked
for leaks rather than assumed clean.

**F1HR remains in production and untouched.**
