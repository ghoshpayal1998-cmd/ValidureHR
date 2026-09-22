---
name: ValidureHR
description: An HR system built like an engineering notebook — ruled, annotated, and exact.
colors:
  validure-teal: "#0e7e90"
  validure-teal-strong: "#0c6b7a"
  validure-teal-soft: "#0e7e901a"
  validure-teal-ink: "#ffffff"
  filament-cyan: "#38e1ff"
  brand-ink: "#0b1526"
  ink-muted: "#44566b"
  ink-faint: "#5b6e84"
  page: "#f7f9fb"
  raised: "#ffffff"
  surface: "#edf2f7"
  line: "#0b15261a"
  line-strong: "#0b15263d"
  ok: "#0e8a5f"
  ok-soft: "#0e8a5f14"
  warn: "#b7791f"
  warn-soft: "#b7791f14"
  err: "#d6453d"
  err-text: "#b93a32"
  err-soft: "#d6453d14"
  info: "#2b6cb0"
  info-soft: "#2b6cb014"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 2.4vw, 2.25rem)"
    fontWeight: 680
    lineHeight: 1.06
    letterSpacing: "-0.018em"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.35rem, 1.8vw, 1.6rem)"
    fontWeight: 680
    lineHeight: 1.06
    letterSpacing: "-0.018em"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.65
    letterSpacing: "-0.008em"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0.16em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "999px"
spacing:
  s1: "0.25rem"
  s2: "0.5rem"
  s3: "0.75rem"
  s4: "1rem"
  s5: "1.25rem"
  s6: "1.5rem"
  s8: "2rem"
  s10: "2.5rem"
  s12: "3rem"
  s16: "4rem"
components:
  button-primary:
    backgroundColor: "{colors.validure-teal}"
    textColor: "{colors.validure-teal-ink}"
    rounded: "{rounded.md}"
    padding: "0 1.25rem"
    height: "2.5rem"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.validure-teal-strong}"
  button-ghost:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.md}"
    padding: "0 1.25rem"
    height: "2.5rem"
  card:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.75rem"
    height: "2.5rem"
  badge:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.5rem"
---

# Design System: ValidureHR

## Overview

**Creative North Star: "The Engineering Notebook"**

ValidureHR is drawn the way an engineer keeps a notebook: ruled, annotated,
and exact. Hairlines do the work grid lines do on squared paper — they define
every edge, separate every row, and are almost the only decoration the system
allows. Labels are set in mono, uppercase and widely tracked, because they are
annotations on the data rather than part of it. The teal accent is the pen
that gets picked up for one thing at a time.

The density is deliberate and higher than a marketing site's. This is a
product people work inside for a shift, often at night, frequently on a phone;
screens carry tables of 24 rows and six-tile stat grids, and the rhythm is
tuned for scanning rather than strolling. Headings are tight (680 weight,
-0.018em, 1.06 line-height) so a title occupies as little vertical room as it
can while still leading. Body copy is Hanken Grotesk at a generous 1.6 to stay
readable against that compression.

Restraint is the house voice, but not flatness. Surfaces genuinely lift off the
page — a card is an object resting on the sheet, not a region drawn on it —
while the controls on those surfaces stay precise and do not move. The dark
theme is derived from the brand ink rather than inverted from the light theme:
`#0b1526` is the text colour in light and becomes the page itself in dark, so
the two themes are the same material seen at two exposures. A
lightness-inverted dark logo was tried and rejected as washed out; that
approach must not return.

**Key Characteristics:**
- Hairline borders as the primary structural device
- Mono uppercase labels as annotation, never as content
- One accent, used sparingly and never decoratively
- Dense, scannable data rhythm tuned for a working shift
- Lifted surfaces, flat controls
- Dark theme derived from the brand ink, not inverted

## Colors

A cool, near-monochrome field of blue-greys with a single marine teal doing all
the pointing, plus four status hues that only appear when something has a
state worth reporting.

### Primary
- **Validure Teal** (`#0e7e90` light / `#3bbfd4` dark): the only accent. It
  marks the primary action, the active nav item, the dot on an eyebrow, the
  fill of a progress meter, and the focus ring. It is lifted directly from
  validuresolutions.com so the product and the company site read as one brand.
  In dark it lightens to `#3bbfd4` (8.2:1 on the page) rather than staying put.
- **Filament Cyan** (`#38e1ff`): the bright end of the logo's teal-to-navy
  ramp. It belongs to the brand mark and to large-format brand moments. It is
  not a UI colour and must not be used for buttons, links or status.

### Neutral
- **Brand Ink** (`#0b1526`): the text colour in light mode and the page
  background in dark. One value, two jobs — which is why the dark theme feels
  like the same brand rather than a negative of it.
- **Ink Muted** (`#44566b` light / `#a5b7cb` dark): secondary copy, table
  cells that are not the subject, card sub-lines.
- **Ink Faint** (`#5b6e84` light / `#8299b2` dark): eyebrows, meta lines,
  timestamps. Still passes AA on a raised surface — it is quiet, not weak.
- **Page** (`#f7f9fb` light / `#0b1526` dark): the sheet everything sits on.
- **Raised** (`#ffffff` light / `#131f33` dark): cards, dialogs, the rail.
- **Surface** (`#edf2f7` light / `#1c2a42` dark): inset areas — table heads,
  meter tracks, neutral badges, the empty state well.
- **Line** (`#0b15261a`) and **Line Strong** (`#0b15263d`): the hairlines. The
  strong variant is reserved for input borders, where an edge has to be found
  before it can be clicked.

### Status
- **OK** (`#0e8a5f`), **Warn** (`#b7791f`), **Error** (`#d6453d` with
  `#b93a32` for text), **Info** (`#2b6cb0`), each with a `-soft` tint at 8%
  for badge and tile backgrounds. Warn and Info are additions the marketing
  site never needed; an HR system has pending and informational states a
  brochure does not.

### Named Rules

**The One Pen Rule.** Validure Teal marks at most one thing per view — the
primary action, or the active location, not both competing. If two elements
are teal, one of them is wrong.

**The Text-Or-It-Didn't-Happen Rule.** No state is ever carried by colour
alone. Every badge, calendar cell and status pill prints its meaning as words;
the tint only groups them. A screenshot in greyscale must still be
unambiguous.

**The Cyan Is Not A UI Colour Rule.** Filament Cyan belongs to the logo and to
brand-scale moments. It never becomes a button, a link, a chip or a chart
series.

## Typography

**Display Font:** Archivo (with `ui-sans-serif`, `system-ui`)
**Body Font:** Hanken Grotesk (with `ui-sans-serif`, `system-ui`)
**Label/Mono Font:** JetBrains Mono (with `ui-monospace`)

**Character:** Archivo at 680 is a compressed, engineered grotesque — it reads
as drawn rather than written, which is what a heading on a payroll screen
should do. Hanken Grotesk underneath is warmer and rounder, and carries the
long-form copy without fighting it. JetBrains Mono appears only as annotation:
eyebrows, employee codes, dates, times and figures, where character width
carrying meaning is the point.

### Hierarchy
- **Display** (680, `clamp(1.75rem, 2.4vw, 2.25rem)`, 1.06): the page `h1`.
  One per screen.
- **Headline** (680, `clamp(1.35rem, 1.8vw, 1.6rem)`, 1.06): section headings
  on marketing surfaces.
- **Title** (600, `1.0625rem`, 1.65): card headings. Set in the body face at
  card scale, because a card title is a label for a region, not a new voice.
- **Body** (400, `16px`, 1.6): prose. `.lede` raises it to `1.0625rem` in
  muted ink and caps at 62ch.
- **Label** (500, `11px`, `0.16em`, uppercase, mono): the signature eyebrow,
  carried over from the company site. A 5px teal dot precedes it unless
  suppressed with `.eyebrow--plain`.

### Named Rules

**The Annotation Rule.** Mono is for things you look up, not things you read:
codes, dates, times, amounts, durations. A sentence never gets set in mono.

**The One H1 Rule.** Every screen has exactly one `h1`, supplied by
`PageHead`. Card titles are `h2`. Nothing skips a level to get a size.

## Layout

The product uses a fixed 16.5rem rail against a fluid content column, with a
sticky top bar of 4.5rem. Below 900px the rail becomes an off-canvas drawer
and the content takes the full width. Marketing surfaces use a centred 80rem
container with a fluid gutter of `clamp(1.25rem, 4vw, 3rem)`.

Spacing runs on a dense 10-step scale from `0.25rem` to `4rem`. Cards are
padded at `s5` (1.25rem); page sections stack at `s5`; tight clusters use
`s2`–`s3`. This is deliberately tighter than the marketing site's
`clamp(4.5rem, 9vw, 8rem)` section rhythm — a dashboard and a landing page
should not breathe at the same rate.

**The 320 Rule.** Nothing overflows the viewport at 320px. Wide tables scroll
inside `.tablewrap`; they never widen the page. Every grid and flex child
carries `min-width: 0`, because the default of `auto` is what silently breaks
this.

## Elevation & Depth

This is a **hybrid, and the hybrid is the point**: hairlines define every edge
and carry the structure, while a genuine two-layer shadow lifts cards off the
sheet so a card reads as an object resting on the page rather than a region
drawn on it. Surfaces lift; the controls on them do not.

In dark mode shadows read as almost nothing against ink, so they are deepened
substantially and the hairlines take over more of the structural load. The
same card is the same object in both themes, lit differently.

### Shadow Vocabulary
- **Card rest** (`box-shadow: 0 1px 2px #0b15260d, 0 10px 30px -8px #0b15261f`):
  every card, at rest. The tight first layer seats the edge; the wide, offset
  second layer is the lift.
- **Popover / dialog** (`box-shadow: 0 2px 6px #0b152612, 0 24px 48px -16px #0b152638`):
  modals, dropdowns, toasts — anything that sits above the page rather than in
  it.
- Dark theme: `0 1px 2px #00000040, 0 10px 30px -8px #00000059` and
  `0 2px 6px #00000047, 0 24px 48px -16px #00000073`.

### Named Rules

**The Objects-Lift-Controls-Don't Rule.** Cards, dialogs and popovers carry
shadow. Buttons, inputs, chips and table rows never do — they change colour,
and that is all.

## Shapes

Three radii, each with a job: **8px** for anything inset or small (inputs,
small buttons, tiles inside a card), **12px** for buttons and standalone
controls, **16px** for cards and dialogs. Pills (`999px`) are reserved for
badges, chips and meter tracks — things that are labels rather than surfaces.

Nothing is sharp-cornered and nothing is fully round except the pills and the
avatars. Borders are always 1px; there is no 2px border anywhere in the system
except the dashed dropzone, which is deliberately different because it is a
target rather than an edge.

**The Radius-Follows-Role Rule.** Radius communicates what a thing is, not how
friendly it wants to look. If a new element needs a radius, decide whether it
is inset (8), a control (12), or a surface (16) — do not pick by eye.

## Components

### Buttons
- **Shape:** gently rounded (12px), 2.5rem tall, `0 1.25rem` padding.
- **Primary:** Validure Teal fill with white ink, weight 600 at `.875rem`.
- **Hover / Focus:** background deepens to `#0c6b7a` over 0.2s. No lift, no
  scale, no shadow. Focus shows a 2px teal outline at 2px offset.
- **Ghost:** raised background with a hairline border. **Quiet:** no border
  until hover. **Danger:** error fill, used only behind a confirmation.
- **Sizes:** `--sm` 2rem / 8px radius, `--lg` 2.875rem. `--block` fills width.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** raised; `card__head` and `card__foot` sit on it separated by
  hairlines, not by tint.
- **Shadow Strategy:** card rest, per Elevation.
- **Border:** 1px hairline, always — the shadow alone is not enough at low
  contrast or in dark.
- **Internal Padding:** `s5`. `card__body--flush` removes it for tables.

### Inputs / Fields
- **Style:** 1px `line-strong` border, 8px radius, field background, 2.5rem
  min-height.
- **Focus:** border becomes teal and a 3px `accent-soft` ring appears — a
  glow, not an outline shift, so nothing reflows.
- **Error:** border and ring both switch to the error hue, and a message is
  printed beneath with `role="alert"`. Never colour alone.
- Every field has a real `<label for>`; `Field` exists so this cannot be
  skipped.

### Navigation
- Fixed rail, raised background, hairline right edge. Links are `.875rem`
  weight 500 in muted ink; the active link fills with `accent-soft` and turns
  teal. Collapsible groups carry a rotating chevron and auto-open on the
  current route.
- Below 900px the rail translates off-canvas behind a scrim and is toggled
  from the top bar.
- **The nav is built from granted permissions.** An item the user cannot use
  is absent, never disabled.

### Badges & Status
- Pill (999px), `.75rem` weight 600, a `-soft` tint background with the full
  hue as text. Six tones: ok, warn, err, info, neutral, plain.
- The label always carries the meaning. The tone only groups.

### Signature: the eyebrow
A mono, uppercase, 0.16em-tracked label preceded by a 5px teal dot. It is the
one element carried verbatim from validuresolutions.com and it is what makes a
ValidureHR screen recognisable at a glance. It labels a section or a page
region; it is never a heading and never wraps to two lines.

## Do's and Don'ts

### Do:
- **Do** use tokens for every colour — `--fg`, `--muted`, `--accent`,
  `--ok`, and the `-soft` variants. The dark theme works only because of this.
- **Do** give every card a hairline border as well as its shadow.
- **Do** print the meaning of every status as text beside its tint.
- **Do** put wide tables in `.tablewrap` and give numeric columns `.num` on
  both the `th` and the `td`.
- **Do** run money through `money()` and dates through `fmtDate`/`fmtDay` —
  never `new Date('YYYY-MM-DD')`, which shifts the day.
- **Do** hide an action the user lacks permission for, rather than disabling it.

### Don't:
- **Don't** introduce a second accent. One pen.
- **Don't** use Filament Cyan anywhere in the UI.
- **Don't** put a shadow or a lift on a button, input, chip or table row.
- **Don't** set a sentence in JetBrains Mono.
- **Don't** add a raw hex, `rgb()` or named colour to a component — if a value
  is missing from the scale, add a token.
- **Don't** reintroduce a lightness-inverted dark logo. It was tried and
  rejected as washed out.
- **Don't** let a grid or flex child keep its default `min-width: auto`; it is
  what breaks 320px.
