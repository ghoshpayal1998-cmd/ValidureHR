# ValidureHR web — screen build contract

Binding. Every screen follows this.

## Where things go

Authenticated screens live under `app/(app)/`. That route group's layout
already renders `AppShell` (sidebar, top bar, notifications, idle
logout) and `ToastProvider`, so **a page renders only its own content**.
Never render a sidebar or top bar in a page.

```jsx
'use client';

import { useEffect, useState } from 'react';
import { api, fmtDay, money } from '@/lib/api';
import { ErrorNote, PageHead, Skeleton, StatusBadge, useToast } from '@/components/ui';

export default function ThingPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api('/endpoint').then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  if (error) return <div className="page"><ErrorNote error={error} onRetry={load} /></div>;
  if (!data) return <div className="page"><PageHead title="Thing" /><div className="card"><Skeleton /></div></div>;

  return (
    <div className="page">
      <PageHead eyebrow="Section" title="Thing" sub="One line">
        {/* page actions */}
      </PageHead>
      <div className="stack" style={{ gap: 'var(--s5)' }}>
        {/* content */}
      </div>
    </div>
  );
}
```

`<div className="page">` is required — it supplies the page gutter.

## The API is the source of truth

**`docs/api-shapes.md` records the real response of every endpoint,
captured live against the seeded database.** Render those fields. Do not
invent field names, and do not assume a route returns what its name
suggests.

Permissions the API actually enforces are exactly:
`employees.view` `employees.manage` `attendance.view_all`
`attendance.manage` `attendance.export` `leaves.view_all`
`leaves.approve` `balances.manage` `documents.manage` `reports.view`
`analytics.view` `settings.manage`.
There is no `payroll.view` — payroll gates on `documents.manage`.
Use `hasPerm(key)` from `@/lib/api` to hide actions a user cannot take.

## Styling

`app/globals.css` is the whole design system and is already loaded.

- **No Tailwind. No CSS modules. No new stylesheet.**
- **No raw colour anywhere** — not `#hex`, not `rgb()`. Only tokens:
  `--fg --muted --faint --bg --raised --surface --line --line-strong
  --accent --accent-strong --accent-soft --accent-ink --ok --warn --err
  --err-text --info` and their `*-soft` variants. The dark theme works
  only because of this.
- Spacing is `var(--s1)`…`var(--s16)`; radii `--r-sm --r --r-lg --r-full`.
- Inline `style={{}}` is fine for layout; it must use tokens for colour.

**Classes available** (all defined in globals.css — use these, invent none):

`page` `page__head` `stack` `row` `row--between` `row--wrap` `spacer`
`grid` `grid--2` `grid--3` `grid--4` `grid--sidebar`
`card` `card__head` `card__body` `card__body--flush` `card__foot`
`stat` `stat__label` `stat__val` `stat__meta` `stat__icon`
`eyebrow` `eyebrow--plain` `lede` `muted` `faint` `mono` `num`
`btn` `btn--primary` `btn--ghost` `btn--quiet` `btn--danger` `btn--sm` `btn--lg` `btn--block`
`iconbtn` `badge` `badge--ok|warn|err|info|neutral` `chip`
`tablewrap` `table` `person` `person__name` `person__meta` `avatar` `avatar--sm` `avatar--lg`
`field` `label` `req` `help` `err` `input` `select` `textarea` `pwwrap`
`checkline` `fieldrow` `filterbar` `search`
`tabs` `tab` `empty` `empty__icon` `skel` `meter` `meter__fill` `rule` `sr`

A wide table goes in `<div className="tablewrap"><table className="table">`.
Numeric columns get `className="num"` on both `th` and `td`.

## Components and helpers

From `@/components/ui`:
`useToast()` `Modal` `ConfirmModal` `Field` `Empty` `Skeleton`
`ErrorNote` `PageHead` `StatusBadge`

From `@/lib/api`:
`api(path, {method, body, formData})` `openProtectedFile(path, download, filename)`
`hasPerm(key)` `getUser()` `fmtDate` `fmtDateTime` `fmtDay` `money` `initials`

- **Money always through `money()`** — Indian grouping, never a bare number.
- **Dates always through `fmtDate`/`fmtDay`** — they take the string
  apart rather than parsing it. The server clock is not IST, so
  `new Date('2026-09-24')` shifts the day.
- **Every dialog is `Modal`/`ConfirmModal`.** Never `confirm()` or `alert()`.
- **Icons come from `lucide-react`.** Never an emoji.

## Rules that are not negotiable

1. **Four states per screen.** Loading (`Skeleton`), error (`ErrorNote`
   with retry), empty (`Empty`, saying what would appear there), and
   loaded. A screen that only handles the happy path is not finished.
2. **Accessibility.** Every input has a real `<label htmlFor>` (use
   `Field`). Icon-only buttons get `aria-label`. Tables get
   `<thead>` with `<th>`. One `h1` per page (`PageHead` provides it);
   card titles are `h2`.
3. **Mutations report.** On success `toast(msg, 'ok')` and refetch; on
   failure `toast(e.message, 'err')` and leave the form filled in.
4. **Disable while submitting** and say so on the button
   (`{busy ? 'Saving…' : 'Save'}`).
5. **Destructive actions** use `ConfirmModal` with `danger` and name
   what is about to happen.
6. **Never hard-code rows.** Everything renders from the API response.
7. **No horizontal overflow at 320px.** Wide tables scroll inside
   `.tablewrap`, they do not widen the page.
8. **Protected files** (payslips, policies, offer letters) open through
   `openProtectedFile` — they need the auth header, so a plain `href`
   404s.

## Charts

No chart library. Hand-write inline SVG with a `viewBox`, strokes and
fills from tokens, axis labels, an accessible `<title>` and `aria-label`
summarising the insight, and **the underlying numbers also present as
text** — never colour alone. If an axis does not start at zero, say so
in a caption.
