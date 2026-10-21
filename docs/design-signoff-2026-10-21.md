# Design sign-off — the briefing blockers (B1, B2)

**Date:** 2026-10-21
**Reviewer:** pixel (design)
**Verdict:** **B1 PASS · B2 PASS** on the deployed origin; one should-fix introduced by the path B1 opens.
**What was reviewed:** PR #40 (`wt/briefing-blockers`, head `6cbe02f`) — **merged** as `f77e448`
(2026-10-21 06:37 UTC) and **deployed** by run
[39556590513](https://github.com/g0GobliN/nyuz/actions/runs/39556590513) ("Deploy to Cloudflare Workers",
success, 06:41 UTC). Every number below is from the **live origin**
`https://nyuz.grgvishal-gurung17.workers.dev`, signed in as a reader — not from a PR preview, not from
a dev server.
**Evidence:** screenshots captured locally during the sign-off, not committed (available on request)
**Diff under sign-off:** 5 files — `src/components/briefing-preview.tsx` (the shared card),
`src/routes/dashboard/briefing.tsx` (passes `variant="reader"`), `src/lib/briefing-measure.ts`,
`src/components/briefing-preview.test.ts`, `docs/context.md`. No other route was touched.

---

## 1. Method

Chromium (Playwright's 1243 build) against the deployed Worker, set to **1280×900**, **768×1024** and
**360×780** with device-metrics emulation, Manrope loaded (`document.fonts.status === "loaded"`).
Characters per line were **measured**, not estimated: a `Range` is walked character by character over
each summary paragraph and the characters are grouped by `getClientRects()[0].top`, so every figure
below is the number of glyphs that actually rendered on each line. The last line of each paragraph is
dropped (it is partial by definition), which is why the counts say "full lines".

Keyboard order was read from the browser's own focus events (`focusin`) while `Tab` was dispatched as
a real key event, not from DOM order. Focus styling is `getComputedStyle` on whatever `Tab` landed on.

Two honesty notes:

- The screenshots are one real reader's briefing. The account name is covered by a **flat opaque grey
  block** and the avatar by the same block; nothing else is retouched, cropped or re-ordered. The grey
  is an annotation, not a product colour.
- At 360 px, desktop Chrome reserves a 15 px classic scrollbar, so `scrollWidth − innerWidth` reads
  −15 at every width. That is the scrollbar, not a short page: there is **no horizontal overflow**
  (a 1 px overhang would read −14 or higher).

---

## 2. B1 — "the briefing is a dead end" — **PASS**

| What the audit found (deployed, before) | What the deployed origin does now |
| --- | --- |
| 0 anchors, 0 tabbable elements, 0 pointer cursors inside the list | **25 anchors for 25 stories**, 25 unique hrefs, **0 `tabindex` attributes**, `cursor: pointer` on all 25 |

- **Every card opens its own story.** All 25 links were followed individually: 25/25 landed on
  `/dashboard/story/<id>` and the page's `<h1>` matched the card's headline (25/25 exact on the first
  55 characters). No dead id, no empty page.
- **Keyboard tab order is reading order.** From a blurred page, `Tab` walked the sidebar (11 stops),
  the header controls, the `Today · 25` / `Saved · 1` chips, then the **25 story links in document
  order**, then wrapped to the nav. Recorded stops 12–36 were, in order, stories 01–25.
- **Focus is visible and it is the product's ring, not the browser's.** On a tab-focused card link:
  `:focus-visible === true`, `outline: none`, and
  `box-shadow: oklch(1 0 0) 0 0 0 2px, oklch(0.53 0.12 240) 0 0 0 4px` — the white offset plus the
  2 px `--ring` signal blue. Checked on three different cards; all three render the same single class
  string, so the treatment is not per-card.
- **A reader can get back.** Opened from the briefing, `Back to your nyuz` returns to
  `/dashboard/briefing`; opened from the feed, it returns to `/dashboard`; the `Briefing` breadcrumb
  goes to `/dashboard/briefing` from both.
- No horizontal overflow at 1280 / 768 / 360.

**Screenshots:** `briefing-1280-fold.png` (the fold), `briefing-1280-item.png` (a card mid-list),
`briefing-1280-focus.png` (keyboard focus ring on story 01), `briefing-768.png`, `briefing-360.png`.

---

## 3. B2 — "144 characters on a line" — **PASS**

Measured characters per full rendered line of the card's summary paragraph:

| Width | Card | Summary column | Type | Full lines | min | median | max | was |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1280** | 512 px | **454 px** | 14.5 px Manrope | 59 | 58 | **66** | **72** | **144** |
| **768** | 512 px | 454 px | 14.5 px Manrope | 59 | 58 | **66** | **72** | 144 |
| **360** | 305 px | 263 px | 14.5 px Manrope | 115 | 28 | 37 | 45 | — |

- At the bar's widths (1280 and 768) the measure is **median 66 / max 72** — inside 65–75, where
  before the fix the same paragraph set 144. The `min 58` lines are ragged-right lines carrying one
  long word (the type is left-aligned, not justified), not a narrower column.
- At 360 px the column is physically 263 px, so 37 characters is the width, not a regression: the
  card is entirely on-screen (305 px inside a 360 px viewport), the same 25 links are present, the
  headline still wraps in the card, and nothing overflows.
- The card is centred (x = 497 in the content area at 1280; x = 121 at 768) while the page header,
  the chips and the footer note stay full width — the reading column is the card, not the page.

**Screenshots:** `briefing-1280-fold.png`, `briefing-1280-item.png`, `briefing-768.png`,
`briefing-360.png`.

---

## 4. Regression sweep — the fix did not restyle anything else

The fix touches one shared component, so the marketing card on `/` is the only place it could leak.
Everything else was compared against the audit's own baseline numbers (`docs/design-audit-2026-10-21.md`
§2, §3) on the live product:

| Surface | Audited baseline | Measured after the fix | Verdict |
| --- | --- | --- | --- |
| Feed card summary `/dashboard` | 14 px, 619 px column, 94 chars | **14 px, 619 px column, median 96** (23 paragraphs) | unchanged |
| Story body `/dashboard/story/$id` | 14.5 px, 669 px column, 109 chars | **14.5 px, 669 px column, median 101** of 4 full lines | unchanged geometry |
| Archive `/dashboard/history` | — | 2 253 px tall, 0 story links, 0 article cards, two `h1`s (`History` / `Everything your nyuz has sent.`) | unchanged (S1/S3 still open) |
| Alerts `/dashboard/alerts` | — | 3 746 px tall, same header pattern, two `h1`s | unchanged (S1 still open) |
| Marketing card `/` | 13.5 px summary, 548 px card, 0 anchors | **548 px card, 0 anchors, summary now 14.5 px, column 490 px, full lines 73 / 72** | see below |
| Marketing card `/` at 360 | — | 305 px card, 263 px column, **0 anchors**, no overflow | picture, not a link list |

**The one marketing-pixel change is the size step, and it improves the measure.** Rook flagged that
`13.5 → 14.5 px` sits on the shared component, so it moved the landing page's demo card too. Measured:
that card's summary was setting ~80 characters on a 490 px column at 13.5 px and now sets **72–73**,
inside the 65–75 bar; the card is still 548 px wide (the 32 rem cap is reader-only), still has
**zero anchors**, and the layout around it is intact at 1280 and 360. No fourth colour, no new
component, no new spacing token anywhere in the diff.

**Screenshots:** `feed-1280.png`, `feed-768.png`, `feed-360.png`, `archive-1280.png`,
`story-1280.png`, `alerts-1280.png`, `home-1280.png`.

---

## 5. What the fix introduced — new defects, ranked

**should-fix — a story opened from the briefing says it is in a different list, with a different
number.** Open any briefing card and the story page prints **`1 of 24 in your nyuz`** under the
article, while the briefing the reader just left says **25 things worth knowing**. The feed holds 24
stories and the briefing 25, so the lists are not the same one, and the `←` / `→` keys and the pager
cards walk the feed from there. The briefing passes no `from` (the story route only knows `home` and
`alerts`), which `docs/context.md` records as a known boundary on the grounds that "for today's
briefing [it] is the same list" — the live numbers contradict that: **25 vs 24**. Two honest fixes,
neither of them large: add `briefing` to the queue sources, or suppress the position line when the
entry context is unknown. Not a blocker: the reader lands on the right story and can get back; the
defect is the number and the implied list.

**polish — the same missing context is what makes ← / → feel wrong.** From a briefing card, the arrow
keys move to the feed's neighbours rather than the briefing's. Same root cause as above, listed
separately because it is an interaction, not copy.

**No new blocker.** Nothing in the fix's own surfaces (link, ring, column, card width, mobile reflow)
fails; the marketing ripple improves the measure it touches.

### The nine deferred should-fix findings are still deferred, and still there

The audit's S1–S10 were not expanded into this PR, and the fix silently changed none of them.
Spot-checked on the live product for this sign-off: **S1** (two `h1`s) is still present on the
briefing, feed, archive and alerts; **S3** (the archive's inert card) is unchanged, 0 links inside
the rows. The rest were not touched by a diff that only edits the briefing card, and their surfaces
measured identical geometry to the audit.

---

## 6. Verdict

- **B1 — PASS.** 25 stories → 25 links, 25/25 open the right story, keyboard order is reading order,
  the product's ring is visible, back returns to the briefing. A stranger can open a story from their
  briefing in **one click**, and get back in one.
- **B2 — PASS.** 1280: **median 66 / max 72** characters per line (was 144), card 512 px, column
  454 px; 768 identical; 360 reflows with no overflow.
- **Regression sweep — clean**, with the one shared-component ripple on `/` measured and inside the
  bar.
- **Open, ranked:** one should-fix (story pager states "1 of 24 in your nyuz" from a 25-story
  briefing) and one polish (the same missing context in the ← / → keys). No third blocker.
