# Homepage positioning + Home feed mode — design plan (2026-10-21)

**Status: the "What nyuz covers" section is IMPLEMENTED (Option C).** The rest of this document is
still a proposal. Everything measured below was read out of the code that ships it or measured on the
deployed origin.

## What shipped on 2026-10-21

The owner chose **Option C** (a real section, not a caption or a hero strip) and asked for it to sit
**between the hero artwork and "Show us what you care about."** It is built as a first-class landing
section so the console can toggle and reorder it like every other one.

| file | what it does |
| --- | --- |
| `src/components/landing/coverage.tsx` | the section: eyebrow, two-line headline, intro paragraph, 2×2 hairline grid of four areas |
| `src/lib/site-content.ts` | new `coverage` key in `SECTION_KEYS` + `SECTION_LABELS` ("What nyuz covers") |
| `src/routes/index.tsx` | `coverage` registered in `SECTION_COMPONENTS`, first in the list |
| `supabase/migrations/0121_landing_coverage_section.sql` | moves the stored section list so `coverage` is FIRST |
| `src/lib/landing-coverage-section.test.ts` | 6 PGlite tests proving the migration reorders correctly |

**Why the migration was necessary.** The landing page's section order is not in the code — it is an
ordered list in `site_settings.landing.sections`, because order is an editorial decision. The code's
`normaliseSections` **appends** any key the stored row does not mention, to the end. Shipping the key
alone would have put the new section below the closing call to action. `0121` inserts it at the front
instead, and is written to be safe to run twice.

**Measured after the change** (localhost, 1440px): page height **10,062 → 11,028px** (+966), sections
10 → 11, horizontal overflow **0** at 1440 / 655 / 390px. The grid's four cells measure **identical**
(152px tall, 2-line bodies) — the first draft had a one-line bottom-right cell that left a visible hole,
which was fixed by rewriting that sentence rather than by padding it.

**Copy is checkable, clause by clause.** "Research" = the five seeded arXiv feeds + Berkeley AI Research.
"Open source / releases" = the eleven seeded GitHub release feeds. "Company updates" = the 19 seeded
`company_blog` sources. "Music, film and culture" = the seeded entertainment sources. No numeral is
claimed anywhere in the section — a number is the one thing a stranger can check and find wanting.

**Verification:** `tsc --noEmit` clean · `eslint` clean · `vitest` **3,462 passed / 203 files** ·
measured in-browser at 1440 / 655 / 390px with zero horizontal overflow · visually reviewed and
approved at both widths.

---

## The measurements this plan is built on

Read as a stranger at `https://nyuz.grgvishal-gurung17.workers.dev` (2026-10-21, 1440×900 and 655×906):

| measurement | value |
| --- | --- |
| sections on `/` (hero + 10) | **10 `<h2>`**, 10 content sections |
| page height @1440px | **10,062 px** (≈11 screens) |
| page height @655px | **12,511 px** |
| images inside `<main>` | **0** — the page is type and layout only |
| restatements of the same pipeline (merge → match → short briefing) | **5** (hero graphic, interest demo, noise paragraph, five-step rail, under-the-surface rail + infrastructure table) |
| total topics a reader can pick | **36** (`src/lib/topics-pool.ts`) |
| SEO description | *"…delivers a personalized **news** briefing without the noise"* (`src/lib/site-content.ts:301`) |

## The verdict in one paragraph

ChatGPT's diagnosis is half right and its remedy is wrong for this product. The homepage is **not** a
"how it works" page — it is already benefits-first ("Stop searching. Start knowing.", the briefing demo,
"Less noise. More context."). What is actually wrong is narrower and more fixable: **breadth is claimed in
exactly one card whose body then talks about something else**, and the page **explains its own mechanism
five times**. So: fix the one card, state the breadth once beside the topic demo that already demonstrates
it, and cut the third restatement of the pipeline. **No eleventh section.** The proposed four-up image-tile
category grid would put the first photographs on a page that has none, in a pattern that exists nowhere in
this design system — that is the one change that would make nyuz look like a different product.

## What nyuz is (the line I would hold)

Nyuz is not "information sharing" — nothing moves between readers. It is a **briefing**: it watches sources
on the reader's behalf, merges duplicate coverage into one event, matches events to what the reader follows,
and delivers a short list at a chosen time. The category is news-and-more; the product is the watch/merge/
match/deliver loop. Marketing should therefore claim **breadth of the sources and topics it watches**, never
"we are a platform" — the loop is the identity, and it is already on the page.

## Changes on `/`, smallest first

### 1. Fix the card that promises breadth and delivers context (one file, four lines)

`src/components/landing/sections.tsx:60-63`

- **Before** — title *"More than just the news"*, body *"Nyuz doesn't stop at what happened — it gives you
  the context around a story: what changed, the numbers that matter…"*. The title is about **scope**, the
  body is about **depth**. A reader who notices gets neither.
- **After** — keep the title, make the body earn it, in the site's existing voice (declarative, no
  exclamation, no numerals):

  > **More than just the news** — World events, technology and open source, releases, research feeds, music
  > and games. The updates that never reach a front page still reach you, as long as they come from a source
  > you follow.

Every clause is backed: `TOPIC_POOL` holds all 36 of those topics, and custom sources are a shipped feature
(`/pricing`: 8/20 custom sources). Nothing here adds a number, which matters — a numeral is the one thing a
stranger can check.

### 2. Put the scope statement beside the demo that demonstrates it — as a caption, not a section

Section 1 on the page is already the topic picker (Music, Sports, Politics, World, Gaming, Film, Climate,
Economy, Health, AI, Anthropic, Claude, OpenAI, Cursor). It *shows* scope but is capped at 14 of 36 topics
and skews news+AI. Two edits, no new component:

- widen the visible chips to a representative spread (add `Open source`, `Robotics`, `Chips`, `Startups`,
  `Developer tools`, `Linux` — all real entries in `TOPIC_POOL`);
- one caption line under the demo, in `text-[12.5px] text-muted-foreground` (the caption size the page
  already uses for media and footnotes):

  > **36 topics and the sources you add — news, technology, research, culture. Not just what made the front page.**

This is the whole of ChatGPT's "add a section after the hero", at the cost of a caption instead of ~900px.

### 3. Stop explaining the pipeline a third time

`src/components/landing/sections.tsx:182-256` — `Infrastructure` renders a seven-row table (Sources …
Your briefing) directly after `AiTrust`'s eight-stage rail (`:126-180`) and a five-step rail earlier
(`how-it-works.tsx:20-50`). Same facts, third telling.

- **Cut** the seven-row table (`rows`, `:187-195`).
- **Keep** the two cards beside it: the delivery chips (Email/Telegram/Notifications) and the
  "understood once, shared by everyone" cost comparison (`ArchRow`) — that is the one genuinely
  differentiating technical claim on the page (it is the unit-economics argument, not the pipeline).
- The row-by-row pipeline already lives at `/how-it-works` (`pipeline-explainer.tsx`), which is the page
  written for the visitor who wants it. Link to it from the section's footnote.

### 4. Trim the differentiator grid from seven cards to five

`src/components/landing/sections.tsx:55-84` (`DIFFS`). Drop two that are already said elsewhere on the page:

| card | why it can go |
| --- | --- |
| *Sources stay attached* | `SourceTransparency` is the very next section and says it with the actual source row |
| *You decide how much reaches you* | the interest demo + density control already demonstrate it; the card only promises it |

Keep *One event, not thirty articles*, *More than just the news* (fixed), *Important beats endless*,
*It gets more relevant over time*, *Follow beyond the mainstream*. Five cards = three rows, the last
spanning (the grid already handles odd counts, `:100-104`).

**Verified true, do not soften:** *"It gets more relevant over time"* — `weightsFromSignals` writes
`user_topics.weight`, `match.ts:664` multiplies relevance by it, and impressions/opens/dwell are recorded
(`use-engagement.ts`, `server/feedback.ts:322`). This claim survives scrutiny; ChatGPT flagged it as
possibly false and it is not.

### Deliberately not changed

- **Hero.** "Stop searching. / Start knowing." + "What matters to you, reports to you." is the strongest
  copy on the page. ChatGPT's replacement ("Stay informed about what matters to you") is flatter and
  describes any newsletter.
- **Noise section and the old-way/nyuz comparison.** They repeat each other a little, but the comparison is
  the only place the tagline gets proved in list form, and it is cheap. Cutting it would be tidying for its
  own sake.
- **Brand case.** Lowercase wordmark, capitalised prose — the convention 32 shipped strings already use
  (`docs/decisions/public-site-copy-audit.md`, item 5).
- **SEO description** still says *personalized **news** briefing*. Worth changing to *personalized
  briefing*, but that is a positioning decision, not a typo — it is the machine-readable version of the
  paragraph above, so it moves only with your sign-off.

## Home → global feed: yes, as a mode, never as the default

The instinct is right — a reader who has picked three topics currently has no way to see what else exists,
and "Follow beyond the mainstream" promises discovery the product does not offer on any surface. But
**replacing Home with a global feed would falsify the product's central claim**, and the code says so in
`loadMatches` (`src/lib/server/briefing.ts:97`): *"Sorting by arrival time would be a feed, which is the
thing being replaced."* Home also carries the quiet-day honesty — "A quiet day is a real answer, not a
failure" (`src/routes/dashboard/index.tsx:173-186`), which is the same promise the homepage makes in
"Occasionally it's none, and we tell you that rather than padding it out." A global feed is never quiet, so
that promise would never be visible again.

### The spec

**Control.** A two-state segmented control inside Home's header, built from the existing `Chip`
(`src/components/kit.tsx:58`) — the pattern already used on Briefing, Delivery, Alerts and Pipeline
(`role="tablist"` semantics, `aria-selected`, 44px targets). Do **not** adopt `src/components/ui/tabs.tsx`:
nothing imports it today, and this is not the surface to introduce a second control language on.

**Labels.** `For you` | `All stories`. Not "Global" (internal vocabulary) and not "Explore" (promises a
recommendation engine we do not have on that surface).

**Default.** `For you`, always. Deep-linkable as `?view=all` via TanStack `validateSearch` so back/forward
and notifications land on the right tab.

**Header sub-line, per mode — never reuse one sentence for both:**

| mode | sub-line |
| --- | --- |
| For you | unchanged: *"Your nyuz found N things worth knowing."* |
| All stories | *"Everything collected in the last N hours, newest first."* — an admission statement, not a ranking claim |

**Gating.** `All stories` must pass through `gateHomeFeed` exactly as the other paths do. Rulings #9
(deal card) and #14 (coupon publishing frames, 24 corpus titles refused) are enforced there, and a second
surface that skips the gate would quietly re-admit every class those rulings refused. This is the one
non-negotiable in the whole plan.

**Sidebar.** Topic counts are personal: hide that card in `All stories` (it would draw every topic as "—"),
keep the next-briefing card (mode-independent), keep the learning card but only when there are signals.

**Empty state.** *"Nothing collected yet today."* — and **not** the personal-mode sentence, which is a
verdict about the reader's topics and would be false about the corpus.

**Feedback.** Dismiss and mute keep working in both modes (they are preferences, not ranking). Votes cast in
`All stories` must not move topic weights — `weightsFromSignals` only walks topics present in
`user_topics`, so this should already hold; pin it with a test rather than assuming it.

**Performance.** A separate `loadAllStories` server function with its own `PAGE` limit. Do not widen
`loadHomeFeed`: the free plan's 10 ms CPU budget and the ~710 ms Worker grace are conditions of the product,
not obstacles (`docs/reader-quality-10-of-10.md`, "What must not be broken").

**Instrumentation.** Add the surface to the audit that already measures the feed (`audit:surfaces` currently
reads `feed 57/57 · archive 14/14`). A surface that is not measured is a surface where the same class of
defect can be reported twice before anyone notices.

## Order of work

1. Homepage copy + section trimming (independent of anything else; one file plus two constants).
2. `loadAllStories` + gate + a test that a refused class cannot appear there.
3. The switch, the per-mode sub-lines, the sidebar rule.
4. `audit:surfaces` gains the new surface; re-measure both page heights and record them here.

## Acceptance

- `/` gains no new section, no images, no new numerals; page height falls (it was 10,062 px @1440).
- Every claim on `/` is backed by a code path or a shipped feature; the two flagged by ChatGPT are checked
  in this file, one of them (learning) confirmed true.
- `npm run ci` green; the phone-overflow e2e (`e2e/smoke.spec.ts:184`) still passes with the new control.
- `audit:surfaces` reads green **with the new surface included**, and a coupon/refused title is proven
  absent from `All stories` by a test, not by inspection.
- Home still defaults to `For you`, and the quiet-day empty state is still reachable.

## The open question — RULED 2026-10-21: "a personalized information briefing"

The owner ruled **"a personalized information briefing"** over **"a personalized news briefing"**. The
recommendation was followed, and the reason it is true rather than aspirational: the topic taxonomy
is 35 labels wide (`src/lib/topics-pool.ts`) and the seeded sources include arXiv, GitHub release
feeds, vendor blogs and product changelogs, so "news" undersells what nyuz actually watches.

**Where the wording shipped:**

| place | file |
| --- | --- |
| `SEO_DEFAULT.description` (the landing page's meta + og:description) | `src/lib/site-content.ts` |
| root meta description (every page without its own) | `src/routes/__root.tsx` |
| root `og:description` (the share card) | `src/routes/__root.tsx` |
| the installed-app manifest description | `public/manifest.webmanifest` |
| "What nyuz is" in the project memory | `docs/context.md` §1 |

**Also swept:** the manifest's `categories` hint went from `["news"]` to `["news", "magazines"]` —
both are W3C-registered categories (verified against the W3C `manifest-app-info` list), and the second
one is the closest registration for a periodical-style briefing that covers research, releases and
culture as well as news. The manifest category is a **store-discovery hint** and is invisible in the
browser and the installed app, so it does not contradict the "news" that legitimately remains in the
product's own voice ("Not just what's in the news", the "News and world events" cell).

**What deliberately did not change:**

- The `README.md` opener — *"You don't read the news. It reports to you."* — because that is a claim
  about the **reader's** behaviour, not about the product's category.
- The hero sub, *"What matters to you, reports to you."* — it never said "news" and it is the
  strongest line on the page.
- The landing page's own "news" uses, because they are accurate: "Not just what's in the news", the
  "News and world events" cell, "the bigger news apps might never watch".
- The `IGNORE_POOL` label "Celebrity news" — an ignore-topic label, not a positioning claim.
- `legal/$doc.tsx`'s "shared news content remains read-only" — a factual statement about a security
  boundary.

**One thing that made this safe to ship in one commit:** the live `site_settings` table holds only
three rows (`site.access` and two AI caps). There is **no stored `site.seo` row**, so the live
description is the bundled fallback in `SEO_DEFAULT` and a code change alone ships it — the console
has no stored override to fight. Had a row existed, the change would have needed a migration too.
