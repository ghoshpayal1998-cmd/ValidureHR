# Deploying ValidureHR

Supabase (Postgres + Storage) → Render (API) → Netlify (web), in that
order: each step needs a value the one before it produces.

Nothing here is destructive, but two warnings first.

> **`www.validuresolutions.com` is already live on this Netlify account.**
> The company website is the `validure` project. ValidureHR must be a
> **new, separate** Netlify project. Do not point it at the existing one
> and do not attach the apex domain to it.

> **The Render workspace is registered to `supriyopachal772.sp@gmail.com`**,
> not to the account the rest of this project uses. Confirm that is the
> intended owner before putting an HR system's API on it — whoever owns
> that account controls the deploy and can read every environment
> variable, including the database URL and the JWT secret.

---

## 1. Supabase — database and storage

1. **New project.** Name `validurehr`, region **Mumbai (ap-south-1)**.
   Save the database password when it is shown; it is not shown twice.
2. **Connection string.** Project Settings → Database → Connection
   string → **Session pooler**.
   - Session pooler, *not* the transaction pooler on 6543 — that one is
     for serverless and breaks prepared statements.
   - Not the direct connection either; it resolves to IPv6, which Render
     free cannot reach.
3. **Storage bucket.** Storage → New bucket, name `vhr-uploads`,
   **private**. Payslips and identity documents live here.
4. **Service role key.** Project Settings → API → `service_role`.
   Server-side only; it must never reach a frontend build.
5. **Row Level Security.** Enable RLS on every table in `public`.
   On F1HR the anon key exposed admin password hashes until this was
   done. This one matters.

Keep: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

> Supabase Free has no automated database backups, and Supabase never
> backs up Storage objects on **any** plan. Whatever backup job you run
> is the only copy.

---

## 2. Render — the API

`render.yaml` in the repo root declares the service. Either use it as a
Blueprint, or create a Web Service by hand with the same values:

| | |
|---|---|
| Repository | `rahul6373paul/Validure-HR` |
| Root directory | `apps/api` |
| Build command | `cd ../.. && npm ci` |
| Start command | `npm run start` |
| Health check | `/api/health` |
| Region | Singapore |
| Plan | Free |

Root directory is `apps/api` but the build installs from the repo root:
npm workspaces hoist dependencies there, so installing inside `apps/api`
alone leaves it without them.

**Environment variables** — set in the dashboard, not in the file:

| Key | Value |
|---|---|
| `DATABASE_URL` | the session-pooler string from step 1 |
| `JWT_SECRET` | 32+ chars — `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ADMIN_PASSWORD` | 12+ chars, not a documented default |
| `TRUST_PROXY` | `1` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
| `SUPABASE_BUCKET` | `vhr-uploads` |
| `CORS_ORIGINS` / `FRONTEND_URL` | the Netlify URL from step 3 — come back for these |
| `SMTP_*` | see below |
| `CRON_SECRET` | any long random string |

The API **refuses to boot** without `JWT_SECRET` and `ADMIN_PASSWORD`,
and rejects a secret that is too short or that appears in this
repository. That is deliberate — a forgeable token on an HR system is
worse than a failed deploy.

**Free-tier constraints that actually bite:**

- Free is only free while **no payment method is on file**. With one,
  overage bills; without one, it suspends instead. Leave it off.
- **750 instance-hours/month against 744 hours in a month** — one
  always-on service eats the entire quota. Any keep-alive must be
  business-hours only.
- **Outbound SMTP is blocked on 25, 465 and 587.** This silently killed
  every email on F1HR after its cutover. Use a provider offering
  **port 2525** (Brevo works).
- Render Cron Jobs cost $1/month minimum. Use an external free cron
  (cron-job.org, UptimeRobot) against these, with `CRON_SECRET`:
  - `POST /api/cron/accrual` — monthly leave accrual
  - `POST /api/cron/backup` — database backup
  - `POST /api/cron/keepalive` — anti-sleep ping

  Schedule them against the **19:00–04:00 IST shift**, not office hours.

**First boot.** The service runs `init` before `server` and creates the
schema and the platform admin automatically. To load the demo company,
run once from a shell with the same `DATABASE_URL`, from the repo root:

```bash
npm run seed
```

That is `seed:validure` in `apps/api` — there is no plain `seed` script
inside the workspace, so `npm run seed --workspace @validurehr/api`
fails. It creates Validure Solutions Pvt. Ltd. with 24 employees, a
month of attendance, 18 leave applications, three months of payslips,
six policies and an appointment letter per employee.

**Re-running the seed drops and recreates that one company**, which
changes its id and invalidates every token already issued for it.
Anyone signed in gets "Company not found" until they sign in again.
That is fine on a demo, and worth knowing before you do it on anything
someone is using.

---

## 3. Netlify — the web app

**Create a new project.** Not the existing `validure` one.

| | |
|---|---|
| Repository | `rahul6373paul/Validure-HR` |
| Base directory | *(empty — the repo root)* |
| Build command | `npm run build --workspace @validurehr/web` |
| Publish directory | `apps/web/.next` |

`netlify.toml` in the repo root already sets all of this, plus the
Next.js runtime plugin. Declare the plugin explicitly — relying on
auto-detection published a raw `.next` folder statically on F1HR and
every route 404'd.

**Before the first deploy**, edit the `/api/*` redirect in
`netlify.toml` to point at the Render URL from step 2. The browser then
calls `/api/*` on its own origin and there is no CORS surface at all.

**Then go back to Render** and set `CORS_ORIGINS` and `FRONTEND_URL` to
the Netlify URL.

---

## 4. Check it

```bash
curl https://<render-url>/api/health
# {"status":"ok","service":"ValidureHR API"}
```

Then open the Netlify URL and sign in. The seed prints the accounts; the
password is `Validure@123` for all of them:

| Code | Who | Sees |
|---|---|---|
| `VS-0101` | Vikram Rao, Owner | everything, including Analytics |
| `VS-0104` | Sneha Nair, HR | all management screens except Analytics |
| `VS-0113` | Ananya Iyer, Employee | own attendance, leave and documents only |

Worth checking all three, because the nav is built from granted
permissions: an employee should see **no MANAGEMENT section at all**,
not a greyed-out one, and typing `/admin/employees` directly should
answer "Missing permission: employees.view" rather than render anything.

Change `Validure@123` before anyone real uses this, and change
`ADMIN_PASSWORD` from whatever you first set.

---

## State of the three accounts

Checked 22 September 2026, read-only:

| | |
|---|---|
| Supabase | **no projects** — step 1 creates the first |
| Render | workspace `supriyopachal772.sp@gmail.com`, **no services** |
| Netlify | team `6a85e4f280349a4758260650`, two projects: `msworkliva` and `validure` |

`validure` is serving **www.validuresolutions.com** right now. ValidureHR
is not among them and must be created as a third, separate project.

## What is deployable

All of it. `apps/web` has the marketing homepage, sign-in and 24 product
screens; `apps/api` has the full backend with 266 passing tests. The
production build compiles all 27 routes.
