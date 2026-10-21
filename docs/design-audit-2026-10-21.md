# Design audit — the deployed reader surfaces

**Date:** 2026-10-21
**Reviewer:** pixel (design)
**Origin read:** `https://nyuz.grgvishal-gurung17.workers.dev`
**Branch:** `wt/design-audit`
**Evidence:** [docs/screenshots/design-audit-2026-10-21/](screenshots/design-audit-2026-10-21/)

No product code was changed in this slice. This document is guidance for forge and rook.

---

## 1. How this was reviewed

The live product was read in Chromium, signed in as a reader, at three widths — **1280×900,
768×1024 and 360×780** — plus a **320 px** reflow probe. Surfaces:

| Surface       | Route                       | Captured             |
| ------------- | --------------------------- | -------------------- |
| Feed / home   | `/dashboard`                | 360, 768, 1280       |
| My briefing   | `/dashboard/briefing`       | 360, 768, 1280, dark |
| Archive       | `/dashboard/history`        | 360, 768, 1280       |
| Story page    | `/dashboard/story/$id`      | 360, 768, 1280       |
| Alerts        | `/dashboard/alerts`         | 360, 768, 1280       |
| Alert history | `/dashboard/alerts/history` | 360, 768, 1280       |

Every number below is **measured on the deployed origin** — computed styles, element geometry,
line capacities, keyboard tab order — not inferred from the source. Where source is cited it is
because the defect is in the component that renders the measured result.

Two honesty notes:

- The screenshots come from a signed-in account, so they show one reader's real briefing. The
  account name and avatar are **redacted** in every committed image (a flat bar in the page
  background colour). Nothing else was altered; no pixels were retouched.
- Empty and failed states could not be photographed live (this account has data). They are
  assessed from the one shared component that renders them, and marked as such.
- At 360 px, desktop Chrome reserves a 15 px classic scrollbar, so the captured page is 345 px
  wide. Layout and media queries see 360 px (no horizontal overflow at either).

Source line references were re-checked against `origin/main` at `df9de5e` after the branch was
rebased. The deployed origin can lag `main`; where it does, the finding describes what a reader
actually receives, and the re-check confirms the component still has the defect on `main`.

Marketing pages (`/`, `/how-it-works`, `/pricing`, `/auth`, `/blog`) were read only to compare
tokens against the product, and are not ranked here.

---

## 2. The design system as it actually renders

Measured from the live DOM, not from the stylesheet alone.

**Type.** Manrope for UI, Newsreader for editorial display. The page-header pattern is identical
on all five dashboard surfaces: eyebrow 11 px / 600 / uppercase / 0.18 em, then the page title
(44 px at 1280, 34.56 px at 768, 24 px at 360), then a 14.5 px muted sub-line. Body and meta live
between 11 px and 16 px; the story headline is 46.4 px.

**Colour.** Three values, and the DOM agrees: every background and every text colour computed on
the six surfaces is **chroma 0** except `--signal` (hue 240) and its 10–15 % mixes. No fourth
colour was found anywhere.

Measured contrast (WCAG 2.1, actual token values):

| Pair                                  | Ratio    |
| ------------------------------------- | -------- |
| muted text on background (light)      | **5.83** |
| muted text on `--surface-2` (light)   | **5.39** |
| muted text on `--muted` pills (light) | **5.25** |
| signal on background (light)          | **5.20** |
| white on signal (light)               | **5.20** |
| muted text on background (dark)       | **6.53** |
| muted text on surface (dark)          | **6.22** |
| muted text on `--muted` pills (dark)  | **5.43** |
| signal on background (dark)           | **8.11** |

Every 11–13.5 px meta line clears 4.5:1 in both themes. This is not accidental: the small type
has the headroom it needs.

**Shape and surface.** Cards are 26 px radius (`rounded-3xl`), 1 px `--hairline` borders, no
shadow — except the briefing facsimile, which carries `--shadow-float`, deliberately, because it
is a delivered artifact on the page rather than a card in a list. Pills and buttons are full
round. One tag shape (`rounded-md`) exists for topic labels.

**Layout.** Sidebar 240 px, content `max-w-5xl` (1024), gutters 20 px (mobile) / 32 px (desktop),
bottom navigation on mobile with safe-area inset, inputs at 16 px so iOS does not zoom.

---

## 3. Ranked findings

Severity: **blocker** = a reader cannot do the thing the surface exists for, or the surface is
materially below the 10/10 bar; **should-fix** = works, but a reader or an assistive-technology
user pays for it; **polish** = consistency debt.

### BLOCKER

#### B1 — The briefing is a dead end: 25 stories, zero ways into any of them

**Evidence:** `briefing-1280-fold.png`, `briefing-1280.png`, `briefing-item-1280.png`,
`briefing-item-360.png`.

`/dashboard/briefing` is titled **My briefing**, is reached from the feed's own primary CTA
("Read as a briefing →"), and renders the 25 stories of the delivered edition. Measured inside
the list: **0 anchors, 0 tabbable elements, 0 elements with a pointer cursor**. The whole
`<ol>` is inert. A reader can scroll 4,236 px of their briefing and open nothing; the only route
to a story is back to the feed and a second scan for the same headline.

The root cause is reuse without a product variant: `src/components/briefing-preview.tsx` was built
for the marketing page, where the stories are fixtures and must not be links. The dashboard mounts
the same component unchanged (`src/routes/dashboard/briefing.tsx:191`), so it inherited the
marketing card's inertness along with its look.

**Instruction — forge.** Add an opt-in link to `BriefingPreview` rather than forking it. Introduce
`linkToStory?: boolean` (default `false`) in `src/components/briefing-preview.tsx`; when true,
wrap each item's existing headline paragraph (`mt-1.5 text-[16px] font-medium leading-snug`) in a
TanStack `<Link to="/dashboard/story/$id" params={{ id: s.id }} search={{ from: "briefing" }}>`
with the feed card's hover treatment (`group-hover:underline group-hover:underline-offset-4`).
Pass `linkToStory` only from `src/routes/dashboard/briefing.tsx`; leave `hero.tsx` and
`sections.tsx` untouched, because their ids are sample-data ids, not stories. Nothing else moves:
same spacing, same 16 px headline, same rule between items, and the headline is the target, not
the whole row, so text selection and the 25-row rhythm are unchanged. Acceptance: 25 story links
on `/dashboard/briefing`, 0 on `/`, each opens the matching story, and the card's height changes
by zero.

#### B2 — The briefing sets 144 characters on a line; the rest of the product sits at 88–109

**Evidence:** `briefing-item-1280.png`, `briefing-card-top-1280.png`, `briefing-1280-fold.png`.

Measured characters that fit one full line at 1280:

| Surface                   | Font    | Column     | Characters / line |
| ------------------------- | ------- | ---------- | ----------------- |
| **My briefing** (summary) | 13.5 px | **911 px** | **144**           |
| Story body                | 14.5 px | 669 px     | 109               |
| Story deck                | 16 px   | 669 px     | 88                |
| Feed card summary         | 14 px   | 619 px     | 94                |

The briefing is the worst by a wide margin because the marketing card (built for a 548 px column,
where it reads correctly) is mounted in the product's 969 px card with 28 px padding, leaving
911 px of text. A 13.5 px line that runs 911 px is not a briefing; it is a wall. It also breaks the
surface's own hierarchy: the eye cannot step from headline to summary because both fill the same
width and the summary is nearly the same size.

The whole product is above the typographic comfort range (45–75 characters); the briefing is at
almost twice the top of it. Fixing the briefing now is a scoped change; re-tuning the product's
narrative measure is a separate type-scale decision for the arbiter, not this slice.

**Instruction — rook.** Constrain the facsimile to a reading column and lift the summary one step.
In `src/routes/dashboard/briefing.tsx`, pass `mx-auto w-full max-w-[37rem]` to the `BriefingPreview`
(592 px at every width above 37 rem), and in `src/components/briefing-preview.tsx` change the item
summary from `text-[13.5px]` to `text-[14.5px]` (still below the 16 px headline; the "Why you're
seeing this" line stays at 12 px so provenance remains third in the order). That lands the summary
around 85 characters per full line — in line with the feed (94) — and cuts the row length by about
40 %.
Keep the page header, the Today/Saved chips and the footer note full width; keep the card's
padding, 26 px radius and shadow. Below 37 rem nothing changes: 360 and 768 are already narrower
than the cap. Acceptance at 1280: card 592 px, summary ≈ 85 cpl, headline 16 px, no horizontal
overflow, and the `animate-rise` entrance unchanged.

### SHOULD-FIX

#### S1 — Two `<h1>`s on every desktop dashboard page

**Evidence:** `dashboard-home-1280-fold.png`, `briefing-1280-fold.png`, `history-1280-fold.png`,
`alerts-1280-fold.png`, `alerts-history-1280-fold.png`.

At ≥1024 px the shell's page label is an `h1` (`src/components/dashboard/shell.tsx:224`,
`hidden text-[15px] lg:block`) and the page's own title is a second `h1`. Measured: **2 h1s** on
the feed, briefing, archive, alerts and alert history at 1280; 1 at 360 because the shell label is
hidden. The visible label is a location marker, not the document title — it should be a `<p>`
(or keep the `h1` only on pages without a PageHeader). One-line change in `shell.tsx`; it affects
every dashboard page at once. Do not add `aria-hidden` — the label should still be read, just not
as a heading.

#### S2 — The briefing's heading outline skips a level, and 25 stories have no heading at all

**Evidence:** `briefing-card-top-1280.png`, `briefing-1280-fold.png`.

At 1280 the outline is `H1 44 px` ("Exactly what landed in your inbox.") → `H3 28 px`
("25 things worth knowing"). No `H2`. Below it, the 25 story headlines are `<p>` elements — a
screen-reader user gets a 25-item wall with no way to jump between stories, on the surface whose
job is reading 25 stories. The marketing use is correct (`H3` inside an `H2` section), so this is
the same missing product variant as B1: give `BriefingPreview` a heading level, defaulting to 3,
and pass 2 from the dashboard; give each item headline an `h3` (or add an sr-only `h2` for the list
plus `h3` per item). Do not change visual sizes — only the level.

#### S3 — In the archive, the card is inert and only a 76×19 text link is clickable

**Evidence:** `archive-day-1280.png`, `archive-day-360.png`.

Each day is a bordered card with the headline, "and 24 more", and a 12.5 px "Open briefing" link
(`src/routes/dashboard/history.tsx:254-260`). Measured link target: **76 × 19 px**. The rest of the
card — the whole visual row — does nothing on click. Alerts already solve this correctly: the
entire alert card is a `<Link>`. Make the archive day card a link too (same `digest` search param),
keep "Open briefing" as the visible affordance, and put the hover treatment on the card.

#### S4 — The archive's month selector hides 9 of its 13 months behind an invisible horizontal scroll

**Evidence:** `archive-months-1280.png`, `archive-months-360.png`.

The month strip is **1,288 px** wide inside a **969 px** container at 1280 (`overflow-x: auto`,
`src/components/dashboard/history-month-selector.tsx:17`). Four months are visible; nine require a
horizontal scroll with no arrows, no fade and no wrap. On a desktop with a mouse that is close to
undiscoverable; at 360 the same strip is a 313 px window onto 13 buttons. Smallest good fix: let the
strip wrap at ≥`sm` (it is a row of 13 words, it can take two lines), and at mobile add a
right-edge fade plus `scroll-snap` so the cut-off is visible. Do not reduce the month labels or
the 13 px size.

#### S5 — Keyboard focus is the browser default on navigation, not the product's ring

**Evidence:** `focus-nav-item-1280.png` plus the tab-order measurement (14 consecutive stops).

The kit's buttons and chips carry the authored ring
(`focus-visible:ring-2 ring-ring ring-offset-2`). The sidebar nav items, the header icon buttons
(Search, Notifications, Account), the theme toggle and text links do not: keyboard tabbing produced
**`outline: auto 1px`** and **`box-shadow: none`** on every one of the first 14 stops. The focus is
visible — so this is not a WCAG failure — but it is a different control language from the rest of
the product, and a 1 px default outline on a busy surface is easy to lose. Add the same
`focus-visible` ring used by `buttonClass` to `NavItem`/`MobileItem` (`shell.tsx`), `IconToggle`
(`story-card.tsx:239`), the header icon buttons and text links. One utility class, no new token.

#### S6 — The story's reading column is 109 characters wide

**Evidence:** `story-1280-fold.png`, `story-headline-1280.png`.

The article column is 669 px with 14.5 px body text, which fits **109 characters**; the deck above it
is 16 px and fits 88. The deck being larger than the body is correct editorial hierarchy — the
problem is the width, not the order. Cap the reading column (≈36 rem / 576 px, or `max-w-[65ch]`
on the body paragraphs) and let the side rail keep its 260 px; the headline may stay full width.
This is the surface the product's whole promise ends on, and it is currently the widest prose in
the product after the briefing.

#### S7 — One 19 px-tall tap target, and the icon controls at 32 px

**Evidence:** `install-card-1280.png`, `dashboard-card-360.png`.

The install card's dismiss control measures **46 × 19 px** — below the 24 × 24 WCAG 2.2 minimum
(it is a button, not an inline link, so the inline exception does not apply). Give it `min-h-6`
with vertical padding, or restyle it as a text link with enough line-height. The four card
feedback toggles are **32 × 32** with 4 px gaps: WCAG-clean, but under both platform guidelines
(44 px) and the smallest controls on the product. This is a polish-level tension between density
and thumbs; if the card's action row is ever touched, 36 px is the cheap improvement. The 34 px
chips and 33 px Read/Save buttons are fine as they are.

#### S8 — The briefing claims an inbox delivery the product does not perform

**Evidence:** `briefing-1280-fold.png` (email chip, `brief@nyuz.app`, "Delivered at 7:30 AM"),
`briefing-1280.png` (sub-line "Exactly what landed in your inbox").

Email is deliberately dark until launch (`AGENTS.md`: the Resend key is disabled to preserve the
free quota; nothing has been accepted since 2026-08-26). The briefing page still frames itself as
the email edition: "Exactly what landed in your inbox", a `brief@nyuz.app` sender line, an
**Email** channel chip (shown because the reader's preference is on), and "Delivered at 7:30 AM".
For this reader, no email ever landed. The channel chip is honest about the preference and
dishonest about the delivery.

This is copy, so it is the arbiter's call, not a unilateral forge edit. The design recommendation:
make the framing channel-neutral ("the briefing as it was assembled"), or condition the email
sentences on an actual send. Do not simply delete the Email chip — the preference is real and the
reader set it.

#### S9 — Reader-facing scores are two different scales with no explanation

**Evidence:** `story-sidebar-1280.png` (Relevance 100 %, Importance 50 %, Novelty 70 %),
`alerts-1280-fold.png` ("Only events scoring 6 or higher interrupt you").

On a story page the reader sees a **0–100 %** rubric in the rail; on Alerts they are told the
threshold is **6** — an unexplained 0–10 scale. Two numbers, two scales, neither with a legend, on
surfaces that are otherwise plain-spoken. "Importance 50 %" directly undercuts the briefing's
claim that this is worth knowing. Either express the rail in words ("matched on your topics;
medium importance") or add one line of explanation; the alert copy should name the same scale the
reader just saw. Copy decision → arbiter first.

#### S10 — The palette comment in `styles.css` describes a red product, not this one

**Evidence:** `src/styles.css:47` — "Three colours only: black, white, and one red… Red sits at
hue 27… Measured: 5.58:1 both ways." The tokens are blue at hue 240, and the measured ratios are
5.20 light / 8.11 dark. The comment's numbers are real, but they belong to the colour the product
stopped using. This is not reader-facing, but it is the first thing the next designer reads, and it
is wrong. Replace it with the current palette and the measured pair above. No visual change.

### POLISH

| #   | Finding                                                                                                                                          | Evidence                                            | Change                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P1  | The story route's document title is literally `"nyuz"` (`$id.tsx:33`); every other surface names itself ("My briefing — nyuz", "Alerts — nyuz"). | source + browser tab                                | Set the title from the story headline once it is loaded, or at minimum "Story — nyuz".                                           |
| P2  | Radius drift between cards of the same kind: feed and alerts 26 px, archive day card 22 px (`rounded-2xl`).                                      | `archive-day-1280.png` vs `dashboard-card-1280.png` | One class on the archive card: `rounded-2xl` → `rounded-3xl`.                                                                    |
| P3  | Alert-history day labels are `h2` at 11 px uppercase ("TODAY · 6").                                                                              | `alerts-history-group-1280.png`                     | Use `h3` (or a `p` with `aria-label`) — they are group labels, not sections.                                                     |
| P4  | On a 360 screen the card action row breaks into two rows (90 px): Read + Save, then four icons alone on the next row.                            | `dashboard-card-360.png`                            | Not broken — the math does not fit in 255 px. If it is ever touched, move the vote toggles behind one overflow control on `<sm`. |
| P5  | Four similar control heights coexist: 32 (icon toggle), 33 (Read/Save), 34 (chip), 36 (header icons), 44 (primary).                              | measured                                            | Not worth a change now; note it before adding a sixth button style.                                                              |

---

## 4. What is already good — do not change it

These were checked specifically, and they are working. Nobody should "improve" them in a pass on
the findings above.

1. **The three-colour palette holds in the DOM.** Every background and text colour on six live
   surfaces is neutral except `--signal` and its tints. There is no fourth colour, no stray hex, no
   gradient. The identity is intact and distinctive.
2. **Contrast is measured and safe in both themes.** Lowest pair on the product: 5.20 (signal on
   white); muted meta text is 5.83 light / 6.53 dark, including 11 px labels on tinted pills
   (5.25 / 5.43). Do not lower `--muted-foreground` to "soften" anything.
3. **No horizontal overflow at 320, 360, 768 or 1280** on any of the six surfaces. Reflow is clean.
4. **One page-header pattern, used everywhere.** Eyebrow → title → sub-line is identical on feed,
   briefing, archive, alerts and alert history; the story page correctly replaces it with the
   article's own headline. That consistency is why the product feels like one product.
5. **The feed card rhythm is honest.** 25 cards, 677 px wide, 26 px radius, 28 px padding, 16 px
   gaps, headline 21 px → summary 14 px → provenance 12 px → meta 12 px. The scan order is obvious
   and the density is deliberate; it is denser than marketing cards and that is correct.
6. **The serif/sans split does real work.** Newsreader only for editorial display (briefing
   headline, story paragraphs headings, empty-state titles); Manrope for everything a reader
   operates. It reads as a briefing, not a dashboard.
7. **The briefing card is allowed to be an artifact.** Its float shadow and full-width rule
   separate "the edition as delivered" from the feed's cards. Keep that distinction even while
   fixing B1/B2 — the answer is a reading column, not turning it into another feed.
8. **Dark mode is designed, not inverted.** Background 0.145, surface 0.178 lifted, hairlines
   instead of borders, signal lifted to 0.72 so it carries on black. Measured foreground 18.0,
   muted 6.53.
9. **Mobile chrome is right.** Bottom strip with safe-area inset, 112 px bottom padding on `main`,
   no content trapped under the bar; inputs are 16 px so iOS does not zoom.
10. **Empty/loading/failed states share one `EmptyState` and one `LoadState`** across eight routes,
    and the copy keeps the product's voice ("A quiet day is a real answer, not a failure"). Do not
    introduce per-page empty states.

---

## 5. Suggested order

1. **B1** (forge) — the briefing must open stories. Smallest change, largest reader payoff.
2. **B2** (rook) — the briefing must be readable at 1280. Same surface, one class + one size.
3. **S1 + S2** (forge) — heading semantics, one shell change + one component prop.
4. **S3 + S4** (rook) — archive: make the row the target, make the months discoverable.
5. **S5** (forge) — focus ring utility, applied to nav, icon buttons, text links.
6. **S6, S7** (rook) — story measure, install-card target.
7. **S8, S9** — to the arbiter first (copy/scale decisions), then implement.
8. **S10, P1–P5** — cheap polish, any owner.

Do not batch 1–2 with the rest: the briefing is the surface under review, and both changes should
land and be re-photographed on their own.

---

## 6. Evidence index

All images are in `docs/screenshots/design-audit-2026-10-21/`. Full-page captures are named
`<surface>-<width>.png`; the first 900 px of each is also saved as `<surface>-<width>-fold.png`.
Screenshots were palette-compressed (128 colours, mean channel difference ≤ 0.09 on UI surfaces)
so the audit adds **3.6 MB** rather than the 13 MB the raw captures weighed.

| Finding                       | Images                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 briefing dead end          | `briefing-1280.png`, `briefing-1280-fold.png`, `briefing-item-1280.png`, `briefing-item-360.png`                                                                                               |
| B2 briefing measure           | `briefing-card-top-1280.png`, `briefing-item-1280.png`, `briefing-1280-fold.png`                                                                                                               |
| S1 duplicate h1               | `dashboard-home-1280-fold.png`, `briefing-1280-fold.png`, `history-1280-fold.png`, `alerts-1280-fold.png`                                                                                      |
| S2 heading outline            | `briefing-card-top-1280.png`                                                                                                                                                                   |
| S3 archive row                | `archive-day-1280.png`, `archive-day-360.png`                                                                                                                                                  |
| S4 month strip                | `archive-months-1280.png`, `archive-months-360.png`                                                                                                                                            |
| S5 focus                      | `focus-nav-item-1280.png`                                                                                                                                                                      |
| S6 story measure              | `story-1280-fold.png`, `story-headline-1280.png`                                                                                                                                               |
| S7 tap targets                | `install-card-1280.png`, `dashboard-card-360.png`                                                                                                                                              |
| S8 email framing              | `briefing-1280-fold.png`                                                                                                                                                                       |
| S9 scores                     | `story-sidebar-1280.png`, `alerts-1280-fold.png`                                                                                                                                               |
| P2 archive radius             | `archive-day-1280.png`                                                                                                                                                                         |
| P3 alert-history labels       | `alerts-history-group-1280.png`                                                                                                                                                                |
| P4 mobile action row          | `dashboard-card-360.png`                                                                                                                                                                       |
| Whole-surface context         | `dashboard-home-{360,768,1280}.png`, `briefing-{360,768,1280}.png`, `history-{360,768,1280}.png`, `story-{360,768,1280}.png`, `alerts-{360,768,1280}.png`, `alerts-history-{360,768,1280}.png` |
| Dark theme                    | `briefing-1280-dark.png`                                                                                                                                                                       |
| Marketing card for comparison | `home-1280-fold.png`, `home-768-fold.png`, `home-360-fold.png`                                                                                                                                 |

---

## 7. What was not reviewed

- **Empty, failed and offline states** — this account has data and a working connection. They were
  read in source only (one `EmptyState`, one `LoadState`) and are not ranked.
- **iOS Safari / Android Chrome** — emulated Chromium only; the safe-area and 16 px input work is in
  the source but was not exercised on a device.
- **Onboarding, topics, sources, delivery, settings, billing** — outside the reader-surface brief.
- **Anything behind a mutation** — no vote, save, dismiss, mute, alert toggle or preference was
  changed during this audit. Only navigation, focus and measurement were performed.
