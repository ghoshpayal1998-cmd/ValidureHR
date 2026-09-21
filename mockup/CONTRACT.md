# ValidureHR mockup — build contract

Every page must follow this exactly. The design system is already
written; **do not add new CSS files, do not use Tailwind, do not
invent new colour values.** If you need a colour, it is a token.

## Page skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PAGE NAME — ValidureHR</title>
<link rel="icon" href="...">                      <!-- copy verbatim from employee/index.html -->
<link rel="stylesheet" href="REL/assets/css/vhr.css">
<script>try{var t=localStorage.getItem('vhr.theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>
</head>
<body data-root="REL">
  <main class="page" data-page>
    <div class="page__head">
      <div>
        <p class="eyebrow">SECTION</p>
        <h1 style="margin-top:var(--s2)">Page title</h1>
        <p class="muted" style="font-size:.875rem;margin-top:.25rem">One-line description</p>
      </div>
      <div class="row" style="gap:var(--s3)"><!-- page actions --></div>
    </div>
    <div class="stack" style="gap:var(--s5)"><!-- content --></div>
  </main>
<script src="REL/assets/js/data.js"></script>
<script src="REL/assets/js/shell.js"></script>
<script>/* page script, IIFE, 'use strict' */</script>
</body>
</html>
```

`REL` is the path back to the site root: `../` for `employee/*.html`
and `admin/*.html`, `../../` for `employee/leave/*.html` and
`employee/documents/*.html`, `` (empty) for root-level pages.

The shell (sidebar, top bar, notification bell, theme toggle, role
picker, mock banner) is injected by `shell.js` — **never write it
into a page.** `shell.js` moves your `<main data-page>` into place.

## Available classes — use these, invent nothing

- **Layout** `.stack` `.row` `.row--between` `.row--wrap` `.spacer`
  `.grid` + `.grid--2` `.grid--3` `.grid--4` `.grid--sidebar`
- **Card** `.card` `.card__head` `.card__body` `.card__body--flush` `.card__foot`
- **Stat** `.stat` `.stat__label` `.stat__val` `.stat__meta` `.stat__meta--up/--down` `.stat__icon`
- **Type** `.eyebrow` (`.eyebrow--plain` drops the dot) `.lede` `.muted` `.faint` `.mono` `.num`
- **Button** `.btn` + `.btn--primary` `.btn--ghost` `.btn--quiet` `.btn--danger` `.btn--sm` `.btn--lg` `.btn--block`; `.iconbtn`
- **Badge** `.badge` + `.badge--ok` `.badge--warn` `.badge--err` `.badge--info` `.badge--neutral` `.badge--plain`; `.chip`
- **Table** `.tablewrap` > `.table`; `.person` `.person__name` `.person__meta`; `.avatar` `.avatar--sm` `.avatar--lg`; `th.num`/`td.num` right-align
- **Form** `.field` `.label` (`.req` for the asterisk) `.help` `.err` `.input` `.select` `.textarea` `.pwwrap` `.checkline` `.fieldrow` `fieldset`/`legend` `.filterbar` `.search`
- **Tabs** `.tabs` > `.tab` with `aria-selected`
- **Feedback** `.empty` `.empty__icon` `.skel` `.meter` `.meter__fill` (`--warn`/`--err`)
- **Misc** `.rule` `.sr`

## Spacing & colour

Use the token scale only: `var(--s1)` … `var(--s16)`,
`var(--r-sm)` `var(--r)` `var(--r-lg)` `var(--r-full)`.
Colours: `--fg --muted --faint --bg --raised --surface --line
--line-strong --accent --accent-strong --accent-soft --accent-ink
--ok --warn --err --err-text --info` and the `*-soft` variants.

**Never** write a raw hex, `rgb()`, or a Tailwind class. Everything
must respond to the dark theme automatically, which it does only if
you use tokens.

## JS helpers (global `VHR`, from shell.js)

- `VHR.icon(name, size)` → inline SVG string. Names available:
  `home grid calendarCheck scale filePlus history clipboardCheck folder
  fileText badge book users calendarClock calculator wallet barChart
  lineChart settings mail shield building key logout bell menu x chevron
  search sun moon download plus check alert inbox eye eyeOff upload filter clock`
  **If you need an icon that is not on this list, pick the nearest one
  that is.** Do not paste new SVG paths and never use an emoji.
- `VHR.money(n)` → `₹12,34,567` (Indian grouping)
- `VHR.toast(msg, 'ok'|'err')`
- `VHR.modal({title, sub, body, foot, wide, onOk})` → returns `close()`.
  Focus-trapped, Escape closes, `[data-close]` closes, `[data-ok]` confirms.
- `VHR.fakeSubmit(formEl, 'Saved message')` — intercepts submit, shows a
  spinner on the submit button, then toasts. **Every form must use this**;
  nothing in this mockup posts anywhere.
- `VHR.role()` → `'employee' | 'hr' | 'platform'`

## Data

Everything comes from `window.VHR_DATA` (see `assets/js/data.js`).
Keys: `me employees leaveTypes leaveRequests attendance holidays
payslips payslipDetail payrollRuns documents policies notifications
emails companies roles allPerms departments designations teamLeave
birthdays announcements devices deviceMap salaryStructures audit
todayAttendance attendanceTrend leaveByType`.

**Render from this data — do not hard-code rows in HTML.** If your
screen needs a field that does not exist, derive it in your page
script; do not edit `data.js` (other pages depend on it).

## Rules that are not negotiable

1. **Accessibility.** Every input has a real `<label>`. Icon-only
   buttons get `aria-label`. Decorative SVG gets `aria-hidden="true"`
   (`VHR.icon` already does). Tables get `<thead>` with `<th>`.
   Status is never colour alone — `.badge` already carries a dot.
2. **Tabular numbers.** Any column of figures gets `.num` or `.mono`.
3. **Money** is always `VHR.money()`, never a bare number.
4. **Empty states.** If a list can be empty, include the `.empty`
   block and a short line saying what would appear there.
5. **Modals** come from `VHR.modal` — never a bare `confirm()`.
6. **No dead links.** Anything not built yet gets
   `href="#"` plus `onclick="event.preventDefault();VHR.toast('Not in this mockup')"`.
7. **Dark mode must work.** After writing, mentally check: did I use
   any raw colour? If yes, replace it with a token.
8. **Passwords** appear as fields (the brief asks for the spaces) but
   nothing authenticates. Use `type="password"` and an eye toggle.

## Charts

No chart library. Draw bar/line charts as inline SVG sized with a
`viewBox`, strokes/fills using `var(--accent)` etc., with a visible
legend, axis labels, and a `<title>`/`aria-label` summarising the
insight. Keep them simple and readable in both themes. Always pair a
chart with the underlying numbers in a small table or labelled values.
