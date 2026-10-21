# Design spec — the should-fix findings

**Date:** 2026-10-21
**Author:** pixel (design)
**Reads:** [design-audit-2026-10-21.md](design-audit-2026-10-21.md) and the committed captures in
screenshots captured locally during the audit (not committed)
**Branch:** `wt/design-spec`
**Status:** guidance only. No product code, no deploy. forge and rook implement; nothing here is
merged until it ships behind its own PR.

---

## 0. How to read this

Each finding below has the five parts the task asked for: **Finding** (with the screenshot path and a
number, not an adjective), **Intended outcome** (what a reader sees instead), **Smallest change** (the
element, the existing token or component it reuses, and what must not move), **Acceptance measure**
(the number a verifier checks), and **Owner** (who does it and what it blocks).

Two honesty notes, because this document is a contract between three people:

- **Nothing was re-measured live in this session.** Every number below is either the audit's own live
  measurement (2026-10-21, signed-in Chromium, origin
  `https://nyuz.grgvishal-gurung17.workers.dev`) or, where marked, read out of the committed capture.
  Where I corrected the audit, I say so and show the arithmetic.
- **The acceptance measures are what the verifier runs after the change**, not what the audit measured
  before it. A finding closed against the wrong number is worse than one left open, so each acceptance
  is a DOM or pixel quantity with a tolerance.

### The count, reconciled

The brief says **nine** should-fix findings. The audit's SHOULD-FIX section carries **ten** numbered
entries, S1–S10. (The audit's own summary paragraph in `docs/context.md` names eight of them, S1–S8 —
S9, the score scales, and S10, the palette comment, were written up after that paragraph and never
added to it. The brief's "nine" is that paragraph plus one; the audit is the source of truth and it has
ten.)

**All ten are specified here.** Dropping S10 would be the one thing this document cannot do: it is a
wrong statement about the product's own colour system, one comment away from being fixed, and the next
designer reads it first.

**Ten findings, eight implementation units, no duplicates.** Only one finding splits: S7 is two
target-size observations of different severity, and its second half is explicitly deferred by the
audit's own language ("if the card's action row is ever touched"). S1 and S2 are the same _class_
(heading semantics) but different elements and different pages, so they stay separate specs and are
one commit by one owner.

| ID  | One line                                                  | Owner         | Unit | Gate                      |
| --- | --------------------------------------------------------- | ------------- | ---- | ------------------------- |
| S1  | Shell page label is a second `<h1>` at ≥1024 px           | forge         | H    | none                      |
| S2  | Briefing outline jumps H1 → H3 and its 25 items are `<p>` | forge         | H    | after B1 (same component) |
| S3  | Archive day card is inert except a 76 × 19 px link        | rook          | A    | none                      |
| S4  | Month strip hides 3 of 13 months behind invisible scroll  | rook          | A    | none                      |
| S5  | Focus is `outline: auto 1px` on 14 keyboard stops         | forge         | F    | none                      |
| S6  | Story body sets 109 characters per line                   | rook          | P    | none                      |
| S7  | Install dismiss control is 46 × 19 px (WCAG minimum 24)   | rook          | T    | none                      |
| S8  | Briefing claims an inbox delivery that does not happen    | arbiter → any | C    | **ruling first**          |
| S9  | Two unexplained score scales (0–100% and 0–10)            | arbiter → any | S    | **ruling first**          |
| S10 | `styles.css` palette comment describes a red product      | forge         | D    | none                      |

Units: **H** heading semantics, **A** archive, **F** focus, **P** prose measure, **T** tap target,
**C** copy, **S** score scale, **D** documentation. One owner per unit; two units never edit one file in
parallel (see the collision map below).

### What must not change — the identity, restated so nobody "improves" it

The audit's §4 is the list; these are the parts a change above could plausibly damage, so they are
repeated as constraints:

1. **Three colours.** Black, white and `--signal` at hue 240; every other token chroma 0. No new
   colour, no gradient except the one already in `--gradient-veil`, and `--destructive` stays
   monochrome. `src/lib/style-tokens.test.ts` is the arbiter of this, not taste.
2. **The contrast floor.** Lowest pair on the product is 5.20:1 (signal on white); muted 11 px meta is
   5.83 light / 6.53 dark. Nothing below may lighten `--muted-foreground` or sit on a tint that
   lowers these.
3. **One page-header pattern.** Eyebrow 11 px / 600 / 0.18 em → title `clamp(1.5rem, 4.5vw, 2.75rem)`
   → 14.5 px muted sub-line, on feed, briefing, archive, alerts and alert history. The story page
   replaces it with the article's own headline, by design.
4. **Card rhythm.** Feed cards 26 px radius, 1 px `--hairline`, no shadow, 16 px gaps; the briefing
   facsimile keeps `--shadow-float` because it is an artifact, not a card in a list.
5. **The serif/sans split.** Newsreader for editorial display only; Manrope for everything a reader
   operates.
6. **Type sizes are settled.** The audit raised the briefing summary in B2 only to bring it in line
   with the feed. No other size moves for a should-fix. In particular: do not "fix" the 109 cpl by
   reducing 14.5 px type.
7. **Empty and failed states stay one `EmptyState` and one `LoadState`.** No per-page variants.
8. **Mobile chrome stays**: bottom strip with safe-area inset, 112 px bottom padding, 16 px inputs.
9. **No new dependency, no new component, no new token** unless an entry below names one and says why
   the existing one cannot carry it. No entry does.

---

## S1 — Two `<h1>`s on every desktop dashboard page

**Finding.** At ≥1024 px every dashboard page renders its page title as an `<h1>` (`PageHeader`,
`src/components/dashboard/shell.tsx:403`) **and** the shell's location label as a second `<h1>`
(`shell.tsx:224`, `hidden text-[15px] font-medium lg:block`): **2 h1s** measured on `/dashboard`,
`/dashboard/briefing`, `/dashboard/history`, `/dashboard/alerts` and `/dashboard/alerts/history` at
1280; **1** at 360, where the label is `hidden`.
Evidence: `dashboard-home-1280-fold.png`, `briefing-1280-fold.png`, `history-1280-fold.png`,
`alerts-1280-fold.png`, `alerts-history-1280-fold.png`.

**Intended outcome.** A reader using a screen reader asks "what page is this?" once and gets one
answer — the page's own title. The location label in the header stays exactly where it is and exactly
as loud (15 px, medium, muted), because it is a wayfinding cue for sighted readers, not the document
title. Nothing looks different.

**Smallest change.** In `src/components/dashboard/shell.tsx:224`, change the element from `<h1>` to
`<p>`, keeping the class string byte-identical. No token, no new component. **Do not** add
`aria-hidden` and **do not** remove the label: it must still be read, just not as a heading.

Two things that must not move: the label's `lg`-only visibility (below 1024 it is still absent — see
`PageHeader` in the same file, which keeps its `<h1>`), and the 64 px header row's flex layout.

One edge case decided here rather than left to the implementer: `StaffOnly` (`shell.tsx:314`) renders
`DashboardShell` with a title and **no** `PageHeader` in its loading and "Not your floor" branches, so
those two transient states would have zero h1 after this change. That is acceptable and is not a
defect to repair: both states render a single line of text and no headings at all (their title comes
from `EmptyState`, which prints a `<p>` on every page). Adding a heading to a 200 ms loading state would
be the inconsistent choice.

**Acceptance measure.** At 1280 and at 360, on each of the five surfaces:
`document.querySelectorAll("h1").length === 1`, and `document.querySelectorAll("header h1").length === 0`.
On `/dashboard/briefing` at 1280 the label still renders: its computed `font-size` is `15px`, weight
`500`, and it is present in the accessibility tree as a paragraph with the text "My briefing".
No layout shift: the header's `getBoundingClientRect().height` is `64` before and after.

**Owner.** forge. Unit **H**, together with S2. Blocks nothing; but it touches `shell.tsx`, which S5
also edits — one owner, so sequence them in one branch rather than two.

---

## S2 — The briefing outline skips a level, and its 25 stories are not headings

**Finding.** On `/dashboard/briefing` at 1280 the outline is `H1 44 px` ("Exactly what landed in your
inbox.") → `H3 28 px` ("25 things worth knowing, …"): **zero H2**, one skipped level. Below it the 25
story headlines are `<p>` elements (`src/components/briefing-preview.tsx:61`), so a screen-reader user
has **0 headings to jump between** across 4,236 px of the surface whose job is reading 25 stories.
Evidence: `briefing-card-top-1280.png`, `briefing-1280-fold.png`.

**Intended outcome.** The briefing reads as a document: the page title, then the edition, then one
heading per story. A screen reader's heading list becomes a table of contents for the edition — 25
entries — without a single pixel of type changing size, weight or position. The marketing page keeps
the level it has today (its preview sits under an `<h2>`, so its edition title is correctly an `h3`).

**Smallest change.** In `src/components/briefing-preview.tsx`, add one prop and derive both levels from
it:

- `headingLevel?: 2 | 3`, default `3` — the marketing default, so `hero.tsx:214` and
  `sections.tsx:41` change nothing (both sit inside an `<h2>` section: "Show us what you care about",
  "Same morning. Different briefing.").
- The edition title renders as that level, with the existing class string
  `mt-2 font-serif text-2xl leading-tight sm:text-[28px]` **unchanged**.
- Each item headline renders as `headingLevel + 1`, with the existing class string
  `mt-1.5 text-[16px] font-medium leading-snug` **unchanged**.
- `src/routes/dashboard/briefing.tsx:191` passes `headingLevel={2}`.

This is visually inert by construction: Tailwind preflight already sets `font-size: inherit` and
`font-weight: inherit` on headings and zeroes their margins, so `<p class="…">` → `<h3 class="…">` with
the same classes renders to the same box. Implementers should verify that claim, not assume it (the
acceptance below is exactly that check).

The alternative the audit offered — an sr-only `h2` for the list plus `h3` per item — is rejected here:
it adds a heading that exists only for machines and reads as a duplicate in a heading list. A prop is
one line and is the mechanism B1 needs in the same component anyway.

Target markup after B1 (rook) and S2 (forge) have both landed, so the two do not fight: on the
dashboard each item is `<h3><a href="/dashboard/story/…">headline</a></h3>` — the link inside the
heading, never a link wrapping a heading. Marketing stays `<h4>headline</h4>` with no anchor.

**Must not move:** the card's `px-5 sm:px-7` padding, the `divide-y` rule between items, item vertical
rhythm (`py-5`), the 11 px number and org line, the "Why it matters" and provenance lines, the
`compact` variant, and the marketing page's outline order.

**Acceptance measure.** On `/dashboard/briefing` at 1280: `h1 === 1`, `h2 === 1` (the edition title),
`h3 === 25` (the story headlines), `h4 === 0`, and no adjacent-level jump in document order. Each of the
25 `h3`s has the same bounding box as its `<p>` predecessor in the captured baseline: height within
0.5 px and left edge within 0.5 px. On `/` the preview still renders its edition title as `h3` and its
items as `h4`: `document.querySelectorAll("h3").length` unchanged from the day before, and no visible
change (same 0.5 px box check).

**Owner.** forge. Unit **H** with S1, **one commit**. It must land **after** rook's B1 (same component,
same file) — see the collision map. It blocks nothing else.

---

## S3 — In the archive, the card is inert and only a 76 × 19 text link is clickable

**Finding.** Each archive day is a bordered card holding the day's headline, "and 24 more", and a
12.5 px "Open briefing" link (`src/routes/dashboard/history.tsx:249-261`). Measured target: **76 × 19
px** — about **1 %** of the card's area (1,444 px² of roughly 144,600 px² at 964 × 150). The other 99 %
does nothing on click, and the card carries no hover state, so the reader has to guess that the small
muted text is the only way in. Alerts already solve this: the whole alert card is a `<Link>`
(`src/routes/dashboard/alerts/index.tsx:112`, `block rounded-3xl … hover:border-foreground/20`).
Evidence: `archive-day-1280.png`, `archive-day-360.png`.

**Intended outcome.** The row the reader is looking at is the row they can click: the pointer changes
over the whole card, the border warms on hover exactly as an alert card does, and the label stays as
the visible affordance so nothing has to be discovered. Keyboard users reach one target per day, not a
target hidden inside a bigger one.

**Smallest change.** Turn the card `<div>` into a `Link to="/dashboard/briefing" search={{ digest:
d.digestId }}` and reuse the alert card's own class vocabulary for the parts it shares — `block`,
`rounded-3xl`, `border border-hairline`, `bg-surface`, `transition-colors`, `hover:border-foreground/20`
— keeping the day card's own `mt-3 px-5 py-4`. Demote the inner `<Link>` ("Open briefing") to a
`<span>` with its class string intact plus `group-hover:text-foreground`, and put `group` on the card:
nested anchors are invalid, and a second focus stop inside a card that is itself a link is the defect
this finding is about. The skipped-day card (`d.skipped`, dashed border) stays a `<div>` — there is no
briefing behind it.

Free rider, and said out loud so it is a decision and not a drive-by: this also closes **P2** (the
archive card's `rounded-2xl` → `rounded-3xl`), because the change is literally "use the alert card's
classes", and the hover treatment makes the radius mismatch visible for the first time. If the owner
wants this slice to carry should-fix only, drop the `rounded-3xl` — but then the two card kinds that
now behave the same will still be drawn differently.

**Must not move:** the date/`weekday`/count header row and its 16 px / 12.5 px sizes, the timeline rail
and its 9 px dot (`--signal` when the day has stories, `--border` when not), the stagger
(`transitionDelay: i * 50ms`) and `.reveal`, the "and N more" line, and the skipped-day card's dashed
treatment.

**Acceptance measure.** At 1280 on `/dashboard/history`: each day-with-stories renders exactly **one**
anchor whose rect is the card's (~964 × 150 px in the capture) and `document.querySelectorAll("a
a").length === 0`; the words "Open briefing" are still on screen at 12.5 px inside that anchor, not as a
second link. Clicking the card's centre navigates to `/dashboard/briefing?digest=<that day>` — check the
id in the URL against the day clicked, not just that navigation happened. Skipped days: 0 anchors.
Keyboard: one tab stop per day card, and the focus ring is the authored one after S5 (this card is a nav
target, so it takes `focusRing`).

**Owner.** rook. Unit **A** with S4. No blocking dependency.

---

## S4 — The archive's month selector hides 3 of its 13 months behind an invisible scroll

**Finding, corrected.** The month strip is a single row **1,288 px** wide inside a **977 px**
container at 1280 (`overflow-x: auto` on the nav,
`src/components/dashboard/history-month-selector.tsx:16`). **The audit's text says "four months are
visible; nine require a horizontal scroll", and that is wrong at 1280** — I re-read the committed
capture while writing this: `archive-months-1280.png` is **977 × 57 px** and shows **ten** full labels
(October 2026 → January 2026) plus the clipped leading "D" of December 2025, with **three** months
(December, November, October 2025) entirely off-screen. The "four visible" figure belongs to the 360
capture, which is **313 × 57** — a 313 px window onto the same 1,288 px strip, i.e. about three labels.
The defect stands and is smaller than the audit said at desktop, and larger at mobile; the fix below
is right for both. Evidence: `archive-months-1280.png`, `archive-months-360.png`.

**Intended outcome.** At any width, a reader can see that there is more archive than what is on screen.
On a desktop or a tablet the full list of months is simply there — it is thirteen words, and it may take
two lines. On a phone the strip stays one row, but the label at the edge is visibly cut by a fade rather
than being decapitated by the container, and swiping snaps to a month instead of stopping mid-word. No
label shrinks, truncates or abbreviates.

**Smallest change.** Two utilities on the existing elements, no wrapper and no new component:

1. On the `<nav>` — the scroll container, so the snap and the padding belong here, not on the row: keep
   `mb-6 overflow-x-auto border-b border-hairline`, add `sm:overflow-visible` and the mobile-only
   `max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-2 max-sm:[mask-image:linear-gradient(to_right,black_88%,transparent)]`.
   The mask is alpha only — it introduces no colour — and it is on the scroller itself, which is why no
   extra element is needed (a fade element inside a scroller would scroll away with the content).
2. On the inner row (`flex min-w-max gap-5`): add `sm:min-w-0 sm:flex-wrap`; on each button add
   `max-sm:snap-start`. Below `sm` the row still scrolls and snaps to a month; at `sm` and up it wraps and
   nothing is hidden.

`months.length <= 1` still returns `null`. Do not change `py-3`, the 13 px label size, the 2 px
`border-b-2` active rule, or the `text-signal`/`text-muted-foreground` states.

**Must not move:** the selected-month underline (2 px, `--signal`), the hairline under the strip, the
20 px gaps, and the nav's `aria-label="History month"` with `aria-current="page"` on the active button.

**Acceptance measure.** At 1280 and at 768: `nav.scrollWidth === nav.clientWidth` (0 px hidden), all
13 buttons' rects inside the nav's rect, and the nav grows by rows rather than clipping (≤ 120 px at
1280, ≤ 160 px at 768 — the single-row baseline capture is 57 px). At 360: scrolling is allowed
(`scrollWidth > clientWidth`), computed `mask-image` on the nav is not `none`, computed
`scroll-snap-type` on the **nav** is `x mandatory`, and scrolling the nav fully right reveals the last
button. At 320/360/768/1280:
`document.documentElement.scrollWidth === document.documentElement.clientWidth` (no page-level
overflow). Labels unchanged: 13 px, no `text-overflow` ellipsis anywhere in the strip.

**Owner.** rook. Unit **A** with S3, one branch, adjacent files but no shared file with anyone else.

---

## S5 — Keyboard focus is the browser default on navigation, not the product's ring

**Finding.** The kit's buttons and chips carry the authored ring
(`focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background`, `src/components/kit.tsx:20`).
The navigation does not: keyboard tabbing `/dashboard` at 1280 produced **`outline: auto 1px`** and
**`box-shadow: none`** on **every one of the first 14 consecutive stops** — the logo link
(`shell.tsx:183`), the nine sidebar destinations (`NavItem`, `shell.tsx:58`), the header's Search button
and Notifications link (`shell.tsx:227`, `:234`), the theme toggle (`theme-toggle.tsx`) and the account
trigger (`account-menu.tsx`). The focus is visible, so this is not a WCAG failure; it is a second control
language, and a 1 px default outline on a surface with hairlines and tints is easy to lose.
Evidence: `focus-nav-item-1280.png` plus the 14-stop tab-order measurement.

**Intended outcome.** Every control a keyboard reaches lights up the way the product's buttons already
do — the same 2 px ring in the same blue, the same 2 px offset — so "where am I?" is answered by one
visual language everywhere, and a mouse user sees nothing different.

**Smallest change.** Export the ring once and use it; do not copy the string into seven call sites.

- In `src/components/kit.tsx`, add `export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";`
  and make `buttonClass` use the constant (its output stays byte-identical).
- Append `focusRing` to: the logo `Link`, `NavItem` and `MobileItem` (`shell.tsx`), the header Search
  button and Notifications `Link` (`shell.tsx:227-243`), `ThemeToggle` (`theme-toggle.tsx`), the
  `AccountMenu` trigger button (`account-menu.tsx`), and the dashboard's bare text links — the
  briefing's "Back to the latest briefing", the story's "Back to your nyuz" (`BackToFeed`), and
  `UpgradeNote`'s link. (The archive's "Open briefing" becomes a `<span>` in S3, so it stops being a
  focus stop; the card that replaces it takes the same ring.)

`IconToggle` (`story-card.tsx:239`) takes the same constant. It has no ring today and sits past the
measured fourteen stops, but it is the same defect on a control a reader presses repeatedly — include it
while that file is open. No other card control changes.

No new token: `--ring` already exists and is the signal hue in both themes.

**Must not move:** hover colours, the active nav pill (`bg-muted text-foreground`), icon sizes, the
64 px header, the mobile strip's `min-h-13` and safe-area padding, and the dropdown's `align="end"`.
Ring offset is 2 px against `--background` in both themes; do not switch it to `ring-offset-surface`.

**Acceptance measure.** Keyboard-only from a fresh `/dashboard` at 1280, tab through the fourteen chrome
stops the audit measured (logo, nine sidebar links, four header controls): each focused element has
computed `outline-style: none`, `box-shadow !== "none"`, and the shadow's colour resolves to `--ring`
(light `oklch(0.53 0.12 240)`, dark value unchanged). Mouse-clicking the same controls produces no ring
(`:focus-visible` is false). At 360, the same check on the four `MobileItem`s in the bottom strip.
`buttonClass` output is unchanged: the rendered box and focus ring of a kit `Button` are identical before
and after (same string in, same CSS out).

**Owner.** forge. Unit **F**, separate commit from unit H because it is a different mechanism, though
both touch `shell.tsx` — sequence F after H on the same branch.

---

## S6 — The story's reading column is 109 characters wide

**Finding.** The article column is **669 px** with **14.5 px** body text, which fits **109 characters**
on a full line; the deck above it is 16 px and fits 88. The deck being larger than the body is correct
editorial hierarchy — the defect is the measure. The story page is where the product's promise ends and
it carries the widest prose in the product after the briefing.
Evidence: `story-1280-fold.png`, `story-headline-1280.png`.

**Intended outcome.** The article reads as a column, not as a printed page held too close: line length
drops to the same band the feed and the corrected briefing live in, the eye returns to the left margin
without a search, and the headline keeps the authority it has today — it may stay wider than the prose.
The right rail does not move; it is the page's right edge and stays there.

**Smallest change.** One measure constant, applied to the prose blocks only. In
`src/components/dashboard/story-article.tsx`, define `const PROSE_MEASURE = "max-w-[34rem]"` (544 px)
and put it on exactly two elements: the deck paragraph (`mt-6 text-[14.5px] … sm:text-[16px]`) and the
body container (`mt-7 space-y-5 text-[14.5px] leading-relaxed`). The headline and its meta line stay
full width, as they are — the audit's own instruction allows that, and a 46 px headline needs the wider
track. The body container carries the in-article `<h2>` section headings, so they inherit the same
measure for free.

**Number, and why it is not the audit's 36 rem.** The audit proposed ≈36 rem / 576 px. Measured against
the audit's own line (109 characters in 669 px ⇒ **6.14 px per character** at 14.5 px), 36 rem lands at
**94** cpl — the feed's own worst line — and 34 rem lands at **89**, just under it. The deck at 544 px
goes from 88 to **72** cpl: the body lands in the product's 85–94 band, and the deck drops below it into
the audit's 45–75 comfort range, which is the right outcome for 16 px display type. Both are a
narrowing, neither is a re-tune. Going further — a 45–75 cpl body — is a type-scale decision for the
arbiter and is explicitly out of scope here, as it is for B2. Use **34 rem**; if the verifier measures
85–92 cpl for the body and 68–76 for the deck, it passes.

At widths below 544 px + gutters (360, 320) nothing changes: the column is already narrower. At 768 the
grid's `max-w-[40rem]` frame keeps the headline at 640 and the prose sits at 544 inside it — the same
"headline wider than prose" relationship as at 1280, not a new pattern.

**Must not move:** the grid (`mx-auto grid max-w-[40rem] gap-10 lg:max-w-none lg:grid-cols-[1fr_260px]`),
the 260 px rail and its sticky `lg:top-24`, the 46.4 px headline and its `clamp()`, the meta line, the
`mt-10` article offset, paragraph spacing (`space-y-5`), and the retry/queue blocks below the article
which reuse the same grid class.

**Acceptance measure.** At 1280: the longest line box in a body paragraph is **≤ 544 px** and measures
**89 ± 5** characters per line with the probe in the verification recipe; the deck is ≤ 544 px and
**72 ± 4** cpl; the headline's width is unchanged (≤ 669 px); the rail's right edge equals the shell
content's right edge within 1 px and its width is 260 px. At 768 and 360: prose width ≤ 544 px, no
page-level horizontal overflow, and no change to type size, line-height or paragraph gap.

**Owner.** rook. Unit **P**. No blocking dependency. Note for whoever takes S9 later: S9 edits a rail
card in this same file, so it lands after S6 or on top of it — never in parallel.

---

## S7 — One 19 px-tall tap target, and the icon controls at 32 px

**Finding, in two severities.** The install card's dismiss control measures **46 × 19 px** — below the
24 × 24 WCAG 2.2 minimum (2.5.8), and it is a `<button>`, so the inline-text exception does not apply.
Separately, the four card feedback toggles are **32 × 32** px with 4 px gaps: WCAG-clean, but under both
platform guidelines (44 px) and the smallest controls in the product.
Evidence: `install-card-1280.png`, `dashboard-card-360.png`.

**Intended outcome.** A reader on a phone can hit "Not now" without aiming: the target grows to the
minimum in every direction while the word stays exactly where it is and the card's height does not
change. The four icon toggles are left alone — they are a density decision the owner made for a dense
card, they pass WCAG, and resizing them is a visual change nobody asked for.

**Smallest change (a), the one that must land.** In `src/components/dashboard/install-card.tsx`, the
dismiss button gets `inline-flex min-h-6 items-center px-2 -mx-2` added to its existing class string
(`text-[12.5px] text-muted-foreground transition-colors hover:text-foreground`). `min-h-6` is 24 px;
`px-2 -mx-2` widens the hit area by 8 px each side and pulls the box back so the label does not move a
pixel. No colour, no border, no new state.

**Deferred (b), recorded so it is not re-litigated.** The 32 px `IconToggle`s (`story-card.tsx:239`,
`h-8 w-8`, `gap-1`) stay at 32 px. The audit's own words: "if the card's action row is ever touched, 36 px
is the cheap improvement." The trigger is that change, not this slice. Do not resize them here: the
action row is the card's rhythm, and 4 px of extra height per toggle changes the card's folded height on
every feed page.

**Must not move:** the card's `p-5 sm:p-6`, the 40 px phone badge, the "Install Nyuz" button's `h-9`,
the `gap-4` between the button and the dismiss label, and the card's total height (measured 179 px in
`install-card-1280.png`).

**Acceptance measure.** The dismiss control's `getBoundingClientRect()` is **≥ 24 × 24** px in both
themes at 360 and 1280 (target: 62 × 24); its label's top-left corner moves **≤ 1 px** from the
pre-change baseline; the card's height changes by **0** px; the `Install Nyuz` button's box is
unchanged. The four toggles measure **32 × 32** before and after (unchanged, by design).

**Owner.** rook. Unit **T**. Small and independent; may land with unit **P** on the same branch.

---

## S8 — The briefing claims an inbox delivery the product does not perform

**Finding.** Email is deliberately dark until launch (`AGENTS.md`: the Resend key is disabled to
preserve the free monthly quota; nothing has been accepted since **2026-08-26**). The briefing page
still frames itself as the email edition: the title **"Exactly what landed in your inbox."**
(`src/routes/dashboard/briefing.tsx:141`), a **`brief@nyuz.app`** sender line and **"Your 7:30 AM
brief"** (`briefing-preview.tsx:36,43`), an **Email** channel chip shown because the reader's preference
is on (`briefing.tsx:167-171`), and **"Delivered at 7:30 AM"** (`briefing-preview.tsx:102`). For this
reader **no email has ever landed**. The chip is honest about the _preference_ and dishonest about the
_delivery_.
Evidence: `briefing-1280-fold.png`, `briefing-1280.png`.

**Intended outcome.** The page does not tell a reader something happened that did not. It still reads
as a briefing that was assembled at a time and is worth opening — the artifact framing (float shadow,
full-width rule, "the edition") is the identity and stays — but "inbox", a sender address and a
delivery stamp are replaced by facts that are true today: the edition's time, and the channels the
reader has _chosen_. When email comes back at launch, the copy can be conditioned on a real send
without touching this page again.

**Smallest change — but the wording is the arbiter's, so this entry is a question, not an instruction.**
Put three numbered options to the arbiter and record the ruling in `docs/decisions/`. The recommendation
is **option 1**. Options 1 and 3 are strings plus one prop; option 2 additionally needs the delivery
state in the payload.

| #   | What changes                                                                                                                                                                                                                                                                                                                                                         | What the reader sees                                                                    | Cost                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | **Channel-neutral framing (recommended).** Title → "Your briefing, as it was assembled."; sub → "Built from today's coverage at 07:30. Nothing here was reordered for the web." Preview chrome → an edition header ("Edition · 07:30") in place of the sender address and footer "Delivered at"; the chips stay but read as preferences ("Email on", "Telegram on"). | A briefing that was built for them, with their chosen channels stated as settings.      | Nine strings; one prop (`variant: "email" \| "edition"`, default `"email"`) so marketing is untouched. |
| 2   | **Condition on an actual send.** Keep the email framing only when a delivery row exists for this digest and channel; otherwise say plainly that email is paused and the briefing is here.                                                                                                                                                                            | The truth in both states, at the cost of a second sentence most readers will never see. | Needs the delivery state in the briefing payload — a data change, not a copy change.                   |
| 3   | **Disable the chip until launch.** Keep the copy; grey the Email chip with "Email paused".                                                                                                                                                                                                                                                                           | The contradiction stays in the title.                                                   | Cheapest, and the least honest of the three.                                                           |

Implementation shape for option 1 (do not start before the ruling): `variant` on `BriefingPreview`
defaulting to `"email"`, so `/` and `/how-it-works` render byte-identically; `briefing.tsx` passes
`edition` and owns the three page-level strings. The Email/Telegram chips become `<span>`s reading
"Email on" / "Telegram on" from the same `prefs.channels` values — the preference is real and must stay
visible.

**Must not move:** the marketing page's copy (it is selling a future product, and it is allowed to show
an inbox), the Today/Saved chips and their tallies, the briefing card's geometry and float shadow, and
the delivery-page preference toggles.

**Acceptance measure (option 1).** On `/dashboard/briefing` at 1280, the rendered text contains no
occurrence of **"inbox"**, **"brief@nyuz.app"**, or **"Delivered at"** (case-insensitive); it contains
"Email on" or "Telegram on" when the corresponding `prefs.channels` value is true, and neither when
false. On `/` the strings "brief@nyuz.app" and "Delivered at" are still present (marketing unchanged).
No other page's copy changes: `git diff --stat` touches only `briefing-preview.tsx` and
`routes/dashboard/briefing.tsx`.

Adjacent claim noticed while writing this, **not** part of S8 and not to be folded into it: the
briefing page's footer says "Every story links to the original reporting" (`briefing.tsx:243`), while
B1 makes each story link to its _story page_, which then lists the sources. That sentence is arguable
in both directions and belongs in the same arbiter question as option 1, not in a separate edit.

**Owner.** unassigned until ruled; then forge (it is the same component as S2/B1) or rook, but not both —
unit **C**. **Blocks:** nothing, and nothing may be implemented before the ruling is recorded.

---

## S9 — Reader-facing scores are two different scales with no explanation

**Finding.** On a story page the rail prints **Relevance 100%**, **Importance 50%**, **Novelty 70%**
(`src/components/dashboard/story-article.tsx:145-165`); on Alerts the reader is told **"Only events
scoring 6 or higher interrupt you"** (`src/routes/dashboard/alerts/index.tsx:61`). Two scales, neither
explained. The underlying data is one scale, and this is checkable in the source rather than inferred:
`score.importance`/`novelty` are `asPercent(event.importance | event.novelty)` and `score.relevance` is
`asPercent(user_events.relevance)` — `asPercent` is `score * 10` (`src/lib/story.ts:73`) — so
"Importance 50%" is importance **5.0 out of 10**, and the alert floor's 6 is the same number
(`IMPORTANT_FLOOR = 6`, and `importanceBand` calls ≥ 6 "High", ≥ 3 "Medium", else "Notable",
`story.ts:66`).
Evidence: `story-sidebar-1280.png`, `alerts-1280-fold.png`.

**Intended outcome.** One scale, in the reader's language. A reader who sees a story's importance and
then reads the alert rule does not have to divide by ten; the number that makes an alert "High" is the
same number on both surfaces, and it is named. The rail keeps its bars — they are a good glance — and
the card keeps its size.

**Smallest change — arbiter's call, recorded as options.** Recommendation is **option A**, which is
smaller than it looks because the vocabulary already exists.

| #   | What changes                                                                                                                                                                                                                                                                       | Reader sees                                                       | Cost                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A   | **One scale: 0–10, one decimal (recommended).** The three rows print `10.0 / 10`, `5.0 / 10`, `7.0 / 10`; the Alerts sentence names the same scale ("Only events scoring 6.0 or higher out of 10 interrupt you"). Bars keep their `width: {value}%`, so their lengths do not move. | Importance 5.0/10 on a story, and 6.0 as the bar that interrupts. | Three value spans and one sentence. No new component, no data change.                            |
| B   | **Words, not numbers.** The rail stops printing percentages: "Matched on your topics · High importance · new to you", reusing `importanceBand`. Alerts copy unchanged.                                                                                                             | Plain language, no rubric.                                        | Bigger: the three bars go too, and relevance has no band word — it is a match score, not a band. |
| C   | **Legend, no scale change.** Keep 0–100% and add one line: "Scores run 0–10; 6 or higher is High."                                                                                                                                                                                 | Two representations and a footnote.                               | Cheapest, and it teaches the reader a conversion they should never have needed.                  |

Option A is recommended because it is the only one where the two surfaces agree _by construction_ — the
rail and the alert rule then print the same number for the same fact. Option B is the bolder design and
would be my second choice; it is also the one that needs a decision about what "Relevance" means to a
reader who never asked for a match score.

Implementation shape for option A (do not start before the ruling): in `story-article.tsx` change the
value span only (`<span className="tabular-nums">{value}%</span>` → `{(value / 10).toFixed(1)} / 10`),
keep the label, bar and card geometry; in `alerts/index.tsx` change the one template literal. Do not
touch `asPercent`, `importanceBand` or the stored scores.

**Must not move:** the bar heights (1 px), the `bg-muted` track and `bg-signal` fill, the card's
`rounded-2xl border-hairline p-5` chrome, the 12.5 px label size, `CARD_LABEL`'s 11 px uppercase, and
the alert page's chip row.

**Acceptance measure (option A).** On a story page at 1280, the Scoring card's text contains no `%`
character and prints three values matching `^\d{1,2}\.\d / 10$`; for a story whose stored importance is
5.0 the row reads `5.0 / 10` (the live capture showed `50%`); bar widths are unchanged (`width:
{value}%` on a 0–100 value). On `/dashboard/alerts`, the sentence prints the same scale and its
threshold equals `IMPORTANT_FLOOR` (6). Cross-check: the number on Alerts equals the smallest value the
rail would print for a story the reader was alerted on.

**Owner.** unassigned until ruled; then rook (its rail file is S6's) sequenced **after** S6 — unit **S**.
**Blocks:** nothing; no code before the ruling.

---

## S10 — The palette comment in `styles.css` describes a red product, not this one

**Finding.** `src/styles.css:46-60` says **"Three colours only: black, white, and one red"**, that
**"Red sits at hue 27"**, and that it measures **"5.58:1 both ways"**. The tokens are `--signal:
oklch(0.53 0.12 240)` — blue, hue 240 — and the measured pairs are **5.20:1** (signal on white and
white on signal) light and **8.11:1** dark. The comment's numbers are real; they belong to the colour
the product stopped using. Not reader-facing, and it is the first thing the next designer reads.
Evidence: `src/styles.css:46-60`; the current values are `--signal` at `:82` (light, hue 240) and `:135`
(dark, lightness lifted to 0.72), and the palette rule is enforced by `src/lib/style-tokens.test.ts`.

**Intended outcome.** A designer opening the stylesheet reads a true description of the palette they
are looking at: blue at hue 240, why it is blue and not the red the product used before, the real
contrast pair, and the real reason `--destructive` is monochrome. No visual change of any kind.

**Smallest change.** Rewrite the comment block only. Keep its structure (colour count → neutrality →
why this accent suits a briefing → lightness and the measured pair → `--destructive`). Correct the
`--destructive` sentence's reasoning: it currently reads "Now that the accent is red, a red error state
would be indistinguishable from an ordinary highlight"; with a blue accent the true statement is that a
second hue in an error state would compete with the accent, which is why destructive leans on
iconography and weight. **Do not touch a single token value.**

One rule to respect while writing it: the comment must not introduce a number that is not measured.
Quote the pairs from the audit's table (5.20 light both ways, 8.11 dark), not from memory.

**Acceptance measure.** `grep -nE "hue 27|5\.58" src/styles.css` returns **no hit**; the palette comment
contains the strings `hue 240`, `5.20` and `8.11`. A mention of the retired red is allowed only as
history ("the accent this replaced"), never as the current palette. `git diff -- src/styles.css` contains
only comment lines (every changed line begins with `*` or is the `/*`/`*/` pair).
`npx vitest run src/lib/style-tokens.test.ts` passes, and `git diff` shows no change to any `--token:`
value.

**Owner.** forge. Unit **D**, independent of everything; can land first, and is a good warm-up while
waiting on the arbiter.

---

## Collision map — who touches what, and in what order

Two cards editing one file in parallel is how a clean slice turns into a conflict. These are the shared
files, and the order that avoids them:

| File                                         | Touched by                                      | Rule                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/components/briefing-preview.tsx`        | rook **B1** and **B2**, forge **S2**            | **B1/B2 land first** (blockers, and B1 is the bigger change). S2 rebases onto them; the markup after both is `h3 > a`. |
| `src/routes/dashboard/briefing.tsx`          | rook **B2**, forge **S2**, **S8**               | Same order; S8 only after its ruling.                                                                                  |
| `src/components/dashboard/shell.tsx`         | forge **S1** and **S5**                         | One owner, one branch; S1 → S5.                                                                                        |
| `src/components/dashboard/story-article.tsx` | rook **S6**, later **S9**                       | S6 first; S9 after its ruling, on top.                                                                                 |
| `src/routes/dashboard/history.tsx`           | rook **S3**, plus the archive heading fix below | One owner, one commit — see the note under S3.                                                                         |
| `src/styles.css`                             | forge **S10**                                   | Alone; nobody else edits tokens.                                                                                       |

**Also carried, found while writing this (not in the audit, same defect class as S2):** the archive's
day labels are `<h3>` directly under the page's `<h1>` (`src/routes/dashboard/history.tsx:234`) — an
`H1 → H3` skip on the archive, exactly the finding S2 names on the briefing. It is one class change
(`h3` → `h2`) and it belongs in **rook's S3 commit**, because `history.tsx` is already open in that
branch; opening a second card for it would put two agents on one file for one attribute.

**P3 is withdrawn, and this is deliberate.** The audit's polish item P3 ("alert-history day labels are
`h2` at 11 px → use `h3`") is not a defect by the product's own convention: `delivery.tsx:420`,
`settings.tsx:482`, `install-section.tsx:59` and `pipeline.tsx` all use `h2` as a small uppercase group
label under the page `h1`. Changing only the alert history would create the inconsistency the item was
raised to prevent. Leave it; if the convention is ever revisited, it is one decision across five files,
not a polish edit on one.

---

## Verification recipe

The acceptance measures above are DOM quantities. This probe answers most of them; paste it in the
console of the deployed page (signed in) at the width being checked.

```js
// line measure: characters per line, from the font itself
function cpl(el) {
  const cs = getComputedStyle(el);
  const probe = document.createElement("span");
  probe.textContent = "x".repeat(500);
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily};letter-spacing:${cs.letterSpacing}`;
  document.body.append(probe);
  const w = probe.getBoundingClientRect().width / 500;
  probe.remove();
  return Math.round(el.getBoundingClientRect().width / w);
}

// the numbers a verifier reads off each surface
const rows = (sel, name) =>
  [...document.querySelectorAll(sel)].map((el) => ({
    name,
    w: Math.round(el.getBoundingClientRect().width),
    cpl: cpl(el),
  }));
```

Checks, one line each:

```js
document.querySelectorAll("h1").length; // S1, S2: 1
document.querySelectorAll("header h1").length; // S1: 0
document.querySelectorAll("h2").length; // S2: 1 on the briefing
document.querySelectorAll("h3").length; // S2: 25 on the briefing
document.querySelectorAll("a a").length; // S3: 0
document.querySelectorAll("nav[aria-label='History month'] button").length; // S4: 13
const n = document.querySelector("nav[aria-label='History month']");
[n.scrollWidth, n.clientWidth, getComputedStyle(n).maskImage]; // S4
document.activeElement; // S5: Tab through the chrome and read its computed outlineStyle/boxShadow
```

For tap targets and the measures that are pixel facts about a box, use `getBoundingClientRect()` on the
named element (S7: the install card's "Not now" button; S6: the deck paragraph and the body container),
and screenshot at 360, 768 and 1280 afterwards — the audit's own evidence set is the naming convention
to extend.

---

## Order and ownership

1. **S10** (forge) — independent, no risk, can land immediately.
2. **S1 + S2** (forge) — heading semantics; S2 waits for B1/B2.
3. **S3 + S4** (rook) — archive; S3 also fixes P2 and the archive's `H1 → H3` skip.
4. **S5** (forge) — focus ring; touches `shell.tsx` after S1.
5. **S6 + S7** (rook) — story measure and the one tap target.
6. **S8, S9** — arbiter first, then the owner named by the ruling's answer.

Nothing in this list is a redesign, and nothing in it moves a type size, a colour, a radius, a shadow or
a breakpoint except where the acceptance measure says so.

---

## What this spec does not cover

- **B1 and B2** — the two blockers, already with rook, are named here only where they collide with a
  should-fix (S2, S6, S8). Their acceptance numbers are the audit's, not mine to restate.
- **P1, P4, P5** — polish items, unchanged from the audit. P2 is carried by S3 because it is free there;
  P3 is withdrawn (see the collision map).
- **The product-wide narrative measure** — 85–94 cpl is still long by typographic standards. Tightening
  the whole product's prose is a type-scale decision for the arbiter, not four should-fix slices.
- **Live re-measurement** — this document did not open the deployed product in this session. The
  verifier should, and should re-capture the six surfaces at 1280 / 768 / 360 afterwards, because the
  acceptance measures here are about what a reader gets, not what the diff says.

— pixel
