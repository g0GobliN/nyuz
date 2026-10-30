# nyuz — project context

**Read this first.** This is the one file that says what nyuz is, what it does today, what
has been done to it, and what is next — written so an agent (or a person) starting cold
does not have to guess, and cannot quietly invent a version of the product that does not
exist.

**Rules for this file.**

- It is updated **in the same commit as the change it describes**. A change that is not in
  the work log did not happen as far as the next session is concerned.
- Every number carries its provenance: the date it was measured and the command that
  produced it. A number without provenance is an anecdote, not a fact.
- It states what is _verified_ separately from what is _planned_. Where the two could be
  confused, the plan says "plan".
- It is tracked by git, like `AGENTS.md`. Neither file is ever gitignored, and both are
  pushed with the work. The repository root `.gitignore` deliberately does not mention
  them.

---

## 1. What nyuz is

nyuz is a daily information briefing product. Each reader gets one briefing a day, built from
coverage the system has already collected and clustered, delivered by **email**, **browser
push** and **Telegram**. Every story in it opens into a **Read** page: a headline, a deck,
and an article assembled deterministically from the coverage itself — never from model
prose. The product's promise is that a story is _told_ to the reader rather than handed to
them as links.

**The positioning line, ruled 2026-10-21: "a personalized information briefing", not
"a personalized news briefing".** News is one major category, not the whole identity —
the topic taxonomy is 35 labels wide (`src/lib/topics-pool.ts`) and the seeded sources
include arXiv, GitHub release feeds, vendor blogs and product changelogs, so calling the
product a news briefing undersells what it actually watches. The wording that shipped is
in `SEO_DEFAULT` (`src/lib/site-content.ts`) and the root meta
(`src/routes/__root.tsx`), and it is the first clause of the "What nyuz covers" section
on the landing page. The same phrase was swept across the bundled defaults — the
root meta description and `og:description` (which every route without its own
description inherits) and the PWA manifest description. **A stored `site.seo` row
overrides the bundled default**, and a seeded environment has one: `0003_admin.sql`
inserts it and `0004_landing_copy.sql` rewrites its description. So the sweep also
needs a migration, `0122_site_seo_information_briefing.sql`, which updates the
stored description only where it still holds one of the two values this repository
has ever written — an operator's own edit in `/admin/content` does not match
either and is left alone. Measured on the live project on 2026-10-21: there is no
`site.seo` row there (the table holds `site.access` and two AI budget keys), so the
live page serves the bundled default and reaches production from the code change
alone; the migration is for the seeded path.
What it does **not** claim: that nyuz is a platform where readers share information with
one another, or that it covers every category comprehensively. The loop — watch, merge,
match, deliver — is the product; the breadth is what it watches.

It is **in development and not accepting customers** (state as of 2026-09-26,
[status.md](status.md)). No paying customer exists.

Operator: an **unregistered individual in Japan** (city + postcode, no building). The legal
pages state that, and incorporating later means changing `ENTITY` in
[legal/$doc.tsx](../src/routes/legal/$doc.tsx). Legal text is deliberately **not** editable
from the console — it is a legal commitment and should require a deploy and a code review.

Plans (display figures, which live in [launch-plans.ts](../src/lib/launch-plans.ts) and
[plans.ts](../src/lib/plans.ts)):

| tier    | monthly | annual  | shape                                           |
| ------- | ------- | ------- | ----------------------------------------------- |
| `uno`   | $0      | —       | free: fewer briefings, 1 important alert/day    |
| `plura` | $14.99  | $149.90 | Personal                                        |
| `omni`  | $29.99  | $299.90 | Pro; larger briefings, own sources, more alerts |

**The charge is the Stripe Price object, not this table.** Repricing is new Price objects
in Stripe plus the display figures here; Stripe prices are immutable.

## 2. How it works

```
feeds (87 sources)  →  articles  →  clustering  →  events
                                                      │
                                       analysis (DeepSeek) → event intelligence
                                                      │
                                              matching → user_events
                                                      │
                                     briefing assembly → digest_items
                                                      │
                        delivery: email (Resend) · web push (VAPID) · Telegram
                                                      │
                     reader opens a story → Read page → composer → article
```

- **Stack.** TanStack Start (React 19, TypeScript, Tailwind v4), Supabase (Postgres, auth,
  storage), Stripe (billing), Resend (email), DeepSeek (the only AI provider), Cloudflare
  Workers (deploy). `npm run dev` serves on port 8080; `npm run build` produces a nitro
  server bundle.
- **Routes** are file-based under `src/routes/`; `src/routeTree.gen.ts` is generated and
  must never be edited by hand.
- **Admin console** at `/admin`, separate from the customer dashboard, with roles, bans,
  the blog, site settings, AI routing, feature flags and an audit log
  ([admin-console.md](admin-console.md)).
- **Editable site content** lives in one zod schema plus a matching default per key in
  [site-content.ts](../src/lib/site-content.ts): the public site, the console form and the
  server-side write validation all use the same schema, and an empty `site_settings` table
  renders exactly what ships.

## 3. The reader's article — the part under active work

The **Read** page's article is composed by a deterministic composer
([editorial.ts](../src/lib/editorial.ts)) from evidence already stored for the event. No
model writes it. The pipeline that feeds it:

1. **Evidence selection** (`selectReaderEvidence`, [reader-evidence.ts](../src/lib/reader-evidence.ts))
   turns each source's text into candidate facts and refuses the units that are furniture,
   metadata, headings, marketing, or unresolvable.
2. **Merge** dedupes the same claim written twice, keeping the cleaner variant.
3. **Deck** is the story's opening sentence. It is the one block with nothing before it, so
   it must stand on its own.
4. **Body** is either the document's own order (one source, all facts from it) or the
   relevance ranking.
5. **Quality gate** judges every sentence as prose — metadata, entity leaks, headings,
   seams, unresolvable anaphora, stacked quotes — and judges the deck separately.
6. **The fact ledger** accounts for every selected fact: `rendered + explained + unexplained
= selected`, with the rule named for each explained absence.

**The bar for this path is zero reader-visible errors**, not "few". The audit's
must-be-zero lines are the acceptance test.

## 4. Current state

| area                                         | state                                                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketing site, pricing, how-it-works, legal | Built                                                                                                                                                                                                               |
| Accounts, sign-in (email + Google + GitHub)  | Built                                                                                                                                                                                                               |
| Admin console, roles, audit log              | Built — the security boundary is `adminOnly`/`superadminOnly`                                                                                                                                                       |
| Blog, site content, feature flags            | Built                                                                                                                                                                                                               |
| Billing (Stripe checkout, portal, webhook)   | Built; no live customer                                                                                                                                                                                             |
| **Deploy path (GitHub Actions)**             | Working — it was **blocked for about twenty minutes on 2026-10-16** (hosted runners stopped starting: `"recent account payments have failed or your spending limit needs to be increased"`, run `38853848933`, every job failed in ~3 s and the deploy showed *skipped*; the run before it, same day, deployed `17d1b36`). Making the repository public restored its free runner minutes, the run was re-queued, and it deployed `6e88b8d` at **05:20Z** with every job green and the origin contract 23/23; the 40 digest ticks after it all ran `healthy`, read on the live Worker. `main` is level with production again. The shape recurs while the repository is private, so it is a stage condition, not a code defect — [deployment.md](deployment.md#deploying). |
| Ingestion, clustering, analysis, matching    | Built                                                                                                                                                                                                               |
| Briefing assembly and delivery               | Built — email, push, Telegram; quiet days skip honestly; generation spans Cron ticks when a pool is large (0119), so a free-plan CPU kill costs a stage, not the briefing; the gate's own CPU repaired 2026-10-16 (5.7x, output proved identical on 200 stories) and one brief is gated per tick. **Two briefings a day per reader — 09:30 and 16:30 in the reader's own zone, seven days a week, on every plan** (owner ruling 2026-10-30; `scheduleUpcoming` writes one row per slot, `src/lib/briefing-slots.ts` is the only place a day is built, `0124_briefing_slots.sql` moved the DB's one-per-day trigger to one-per-slot) — [decisions/briefing-times-0930-1630.md](decisions/briefing-times-0930-1630.md) |
| Breaking alerts                              | Built; gated like a briefing story (D8), floor ruled (R1) and extended one measured class at a time (2026-10-17)                                                                                                    |
| **Briefing email actually delivered**        | **Off on purpose until launch (owner, 2026-10-16)** — the Resend key is deliberately disabled to keep the free send quota for launch, so every email row fails `Resend 401 API key is invalid` by design and nothing has been accepted since 2026-08-26T22:59. The earlier `Missing EMAIL_UNSUBSCRIBE_SECRET` run (26 Aug → 11 Sep) is fixed. Pre-launch channels are push and the dashboard; re-enabling email is a launch-time owner action, not a defect — [AGENTS.md](../AGENTS.md) |
| Reader article (deterministic composer)      | Built, under active quality work (see §5)                                                                                                                                                                           |
| Story Ask                                    | Dormant — endpoint disabled, zero allowance on every plan                                                                                                                                                           |
| Every side, measured                         | [product-readiness.md](product-readiness.md) via `npm run audit:posture`; rated built 8.5 / exercised live 5 / sellable 3, ruled in [decisions/product-readiness.md](decisions/product-readiness.md)                |

## 5. The reader-quality loop (what "the work" means right now)

Quality on the reader's article is decided by a named arbiter, not by taste.

**The arbiter is asked first and may be cross-examined.** A question goes to the arbiter before
it goes to the owner, and before deciding it does not need asking. Re-ask with better evidence,
name the part that looks wrong, check the ruling against the code and the frozen corpus, and
escalate to the owner only when the arbiter is unreachable or when evidence you can show
contradicts it and it will not revise. Never invent either answer.

The workflow, which is a hard rule in [AGENTS.md](../AGENTS.md):

1. Measure the current behaviour on a **frozen corpus** — the same 200 stories for every
   run, so a before/after is a comparison of rules, not of populations.
2. Put the case to the arbiter (the owner's ChatGPT `nyuz` project) with evidence and
   numbered options.
3. Record the ruling, its date and its reason in [decisions/reader-delivery.md](decisions/reader-delivery.md).
4. Implement the smallest slice that matches the ruling.
5. Re-measure on the same frozen corpus and record the before/after numbers in the decision
   log entry.

**The measurement.**

```bash
# freeze the corpus once, then audit the same file every time
node --env-file=.env scripts/tsrun.mjs scripts/reader-corpus-freeze.ts --out tmp/corpus-after.json
npm run audit:reader -- --corpus tmp/corpus-after.json
```

`tmp/` is gitignored scratch: the frozen corpora, the audit dumps and the one-off probes
live there and never enter a commit. The numbers below are what the audit printed on
`tmp/corpus-after.json` (200 stories).

### The must-be-zero lines

| line                                           | meaning                                                      |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `delivered with no body`                       | a card reached the reader with a headline and no article     |
| `Facts lost, with no rule accounting for them` | a selected fact with no named rule explaining its absence    |
| `refused then published by another path`       | a fact a rule refused that a later path published anyway     |
| `stories with a reader-visible defect`         | a published block with a real defect (measured on the prose) |

## 6. Work log (append-only, newest last)

Every entry is a landed change with its evidence. Slices referenced as `D1…D5` are the
arbiter's queue for the reader-delivery path.

- **2026-10-09 — the briefing checkpoint became one command** (`57c677c`), and the briefing
  was checked end to end for the first time.
- **2026-10-10 — evidence boundary repairs.** A text run now ends at a structural tag, so a
  standfirst stops fusing into the sentence after it (`3742402`).
- **2026-10-10 — the fact ledger (`c47e981`).** `selected = rendered + explained +
unexplained` per story, with the rule named for every explained absence; the ranked
  priority hoist stopped republishing a fact another pass had refused.
- **2026-10-10 — readability decided from the story's own coverage** (`ec1ec70`), not from
  the summariser's output: 26 stories with a body and no summary were invisible misses.
- **2026-10-10 — D1, the readiness seam (`83258f5`, `e01deab`).** Readiness now asks the
  composer's own question — "does this story publish at least one paragraph?" — once per
  candidate from the same inputs the delivery path uses. Ruled and recorded in
  [decisions/reader-delivery.md](decisions/reader-delivery.md). `delivered with no body`
  1 → 0.
- **2026-10-10 — D2, the deck rule (`2aaa826`).** A deck may not open on a reference the
  page never establishes: walk the ranked facts, take the first that composes a
  self-sufficient deck, and if none qualifies the story is withheld rather than shown an
  opening the page never establishes. Reader-visible defects 1 → 0; a document's own
  self-reference (`This report presents …`) stays published.
- **2026-10-11 — D3, refusal-finality.** A refused fact may not be republished by another
  path. Two causes found and fixed, and the counter made checkable:
  - The **entity-context splice** republished refused sentences. It inserted a source
    sentence naming an entity the article had not introduced — and the usual reason the
    entity was unintroduced was that the sentence naming it had been _refused_. It also
    published _after_ the quality gate, so no rule had ever read the sentence. It now
    refuses to reinsert a charged fact and is judged by the gate like every other block.
  - A paragraph that **restated the deck** was refused under a sentence rule, charging the
    _deck's_ fact with a rule the deck itself passed. A duplicate of published prose is a
    merge, not a defect, and is now decided as one.
  - The counter now reports **two classes**: `sentence` (a published sentence carries the
    fact's own text — a real republication, and a bypass) and `resemblance` (only the
    token-overlap comparison matched — the counter being generous). Previously the worst
    case was filed as the benign one.
  - **Measured on the same frozen 200** (`tmp/corpus-after.json`, 2026-10-11,
    `npm run audit:reader -- --corpus tmp/corpus-after.json`):

    | line                                             | before (D2)           | after (D3)            |
    | ------------------------------------------------ | --------------------- | --------------------- |
    | `refused then published by another path`         | 7                     | **0**                 |
    | of those, resemblance only (diagnostic)          | —                     | 3                     |
    | `selected = rendered + explained + unexplained`  | 1572 = 1421 + 151 + 0 | 1572 = 1418 + 154 + 0 |
    | `Facts lost, with no rule accounting for them`   | 0                     | **0**                 |
    | context-dependent openings on the published page | 5                     | **3**                 |
    | `delivered with no body`                         | 0                     | **0**                 |
    | readable stories withheld                        | 19                    | 19                    |
    | stories publishing no paragraphs (splits)        | 59 (31/26/2)          | 59 (31/26/2)          |
    | stories with a reader-visible defect             | 0                     | **0**                 |

    Three facts that used to be published are now refused instead — the three sentences the
    splice had been re-inserting — and no story was newly emptied. Fail-before proof: with the
    new refusal-finality predicate disabled, the regression test publishes
    `These price increases have been caused by the boom in AI data centers, Counterpoint
Research said.` — the corpus defect, reproduced.
- **2026-10-11 — D2 closure, one definition of "unresolved context"** (`dc232a3`). The deck rule had exempted
  a demonstrative whose head is the document the reader is holding (`This report presents …`) since
  D2; the audit's ruler never learned it, so it counted decks the rule would publish. The arbiter
  approved option (a): one shared definition. The exemption now lives in
  [reader-evidence.ts](../src/lib/reader-evidence.ts) with the other opening patterns,
  `unresolvedContextOpening` applies it, and the deck rule delegates. Controls pinned as tests
  (arXiv `This report…` and `This paper investigates…` as negatives, the PC-shipments sentence as the
  positive). Re-baselined on the same frozen 200: **3**, and the row now prints the blocks behind it —
  all three are the adjacency-resolved paragraph openings D2 named, so the exemption's effect on this
  corpus's published page is zero and the ruler no longer counts a class the rule cannot produce.
- **2026-10-11 — this file, and the two rules that keep it true.** `docs/context.md` exists as
  the first thing a session reads, and [AGENTS.md](../AGENTS.md) now requires it to be updated in
  the same commit as the change it describes. The rules come with the skills that carry them:
  `arbitrate-first` (extended: the arbiter is asked **first** and may be questioned as much as the
  evidence warrants, with the owner as the escalation) and `keep-context-current` (new), both in
  `docs/skills/` and installed account-wide, so every project gets them.
- **2026-10-11 — D5, the 19 readable-but-withheld stories were split by what the gate matched**
  (`withheldFamily` in [../scripts/lib/defects.ts](../scripts/lib/defects.ts), read off the gate's own
  reason strings). The single line `readable stories withheld 19` is three quantities: **11
  `not-a-headline`** (9 build numbers, 1 commit message, 1 quotation announcement — nothing to read),
  **3 `promotion`** (the shop's own offer), and **5 `first-party-shape`** — the one family judged from
  the title alone. Within that family, **3 are newsroom stories refused by a title shape**: the
  `Nord Stream trial: How German police followed the evidence` feature (BBC World, 253 words), a
  `Growing pains: how distributed AI training …` analysis (The Register, 338 words) and
  `Meet India's feisty Gen Z protester` (BBC World, 377 words) — 968 words of composed reporting a
  reader did not receive. The report now prints each withheld story with its family, the rule's
  reason, the body it would have delivered and its source. Controls:
  [reader-withheld.test.ts](../src/lib/reader-withheld.test.ts).
- **2026-10-11 — D5 implemented: a vendor shape needs a first-party source.** The arbiter accepted
  option (a) and rejected narrowing the patterns. `FIRST_PARTY_SOURCE_KINDS` is `company_blog` alone;
  the two marketing call sites gained that precondition and the patterns and reason strings are
  untouched. Unknown, empty and missing kinds are all _no_ — a generic `rss` feed is not the
  publisher speaking for itself — so the rung is skipped rather than guessed at, which is why the
  corpus loader and the gate both have to see the kinds. Evidence: **fail-before demonstrated** (with
  the precondition removed, the three newsroom stories are refused and the `rss` case is refused too),
  49 tests pass after; one regression test per case (3 newsroom, 2 vendor, the generic-feed control);
  the **frozen 200 reads 19 → 14 with `coverage kinds carried: no`**, which is a sensitivity result
  and not acceptance evidence — the corpus has no `kind`, so it releases the two Cloudflare posts as
  well; and the **labelled live-window run** (`coverage kinds carried: yes`) shows 4 shapes, 1 refused
  (`company_blog`, the Cloudflare launch) and 3 released (`news`: a Halloween feature, a Windows 7
  performance test, the Nord Stream trial) — 12 paragraphs of newsroom reporting, must-be-zero lines
  unchanged, ledger `1777 = 1575 + 202 + 0`. The `rss` risk was **not exercised** by that window, and
  the report keeps the section so the next run measures it again. The runner's gate on `bce35c1`
  finished green after the report went out — including `Browser smoke on the built Worker` and the
  deploy — which is the browser result the arbiter asked to be recorded rather than left pending.
- **2026-10-11 — D4, the quote openings were classified instead of queued** (`f3d0cd0`). The audit counted 29
  blocks opening on a quotation and 9 carrying two, and the queue read "29, then 9". The arbiter
  ruled (option (a)) that the defect had to be _defined_ before either number was a work queue, and
  that the competing reader costs be measured in the same run. `quoteOpeningEvidence` — in
  [../scripts/lib/defects.ts](../scripts/lib/defects.ts), where the audit's other rulers live —
  classifies each opening as **duplicate** (a sentence already published above it, by
  `sentenceKey` identity), **attribution-refused** (the page names nobody and the ledger charged a
  fact that named a speaker), **unresolved** (nobody named, nothing charged: a list to read, not a
  defect) or **valid** (the page names the speaker, in the block or elsewhere). On the frozen 200:
  **29 openings, 0 confirmed defects, 29 valid leads, 0 unresolved, 26 stories, 0 overlap with the
  9 two-quote blocks**. Nothing was fixed because nothing was a defect, and the new field is purely
  additive — the two runs differ only in the printed sentences — so the ledger still reconciles at
  `1572 = 1418 + 154 + 0`. The ruler claims only "an entity sits in an attribution seam", never
  "this is the speaker's name": in 7 of the 29 the matched string is an employer, a publication, a
  role or a truncated name, and each one prints the sentence that shows the person speaking. The
  controls are [reader-quote-opening.test.ts](../src/lib/reader-quote-opening.test.ts), including
  the case the tests caught while being written — a quotation glued to its attribution is one
  sentence to the splitter, so the repeat check reads the quoted sentence too.
- **2026-10-11 — D6, the 59 silent stories accounted for one by one** (`7a05c8f`). The ruling asked for every one
  of the 59 individually, with its evidence and decision-time context, and forbade a broad release
  rule before they were understood. The classification is
  [decisions/d6-silence-classification.md](decisions/d6-silence-classification.md), and **it changes
  no publication behaviour**: **0 false refusals, 0 evidence-selection defects, 0 unresolved** across
  all 59 — 26 justified deck-only, 2 justified deck-only charged to a name, 7 justified silence
  charged to a name, 24 justified silence with **no coverage body** (the added class: one stored
  headline plus a photo credit, 2–9 words, so nothing was refused because nothing was offered).
  `npm run audit:reader` now prints a per-story **D6 ledger** and its coverage, and
  `scripts/lib/corpus.ts` reports each source's `enrichment` state — read-only additions, with the
  composer's input untouched: the frozen 200 is unchanged at `59 (31/26/2)`, ledger
  `1572 = 1418 + 154 + 0`, `delivered with no body 0`, and the per-story ledger byte-identical before
  and after. **The dominant family is not the composer's to fix**: on the live window 41 of 50 (82%)
  silent stories had no usable evidence (30 no `article_evidence` row, 11 blocked/unavailable), and
  `audit:enrichment` plus `scripts/reader-enrichment-cause.ts` (30-day window) attribute it —
  `extraction_empty` 180, `never_attempted` 285 of which **`never_matched` 267 is the deliberate cost
  boundary**, `priority_arm` 9, `blocked` 82. Two items go to the arbiter for a narrow ruling:
  `priority_arm` 9 (a matched, in-arm article no tick reached) and `extraction_empty` 180 (fetched,
  enough words, zero units). Also reported: the census's `fixable families 465` counts the 267
  `never_matched` boundary as fixable, so the honest figure is nearer 198.
- **2026-10-11 — D6 accepted, and the cost boundary recorded as behaviour.** The arbiter accepted the
  classification and ruled the `never_matched` 267 to be **intentional cost-gate behaviour**: not lost
  stories, outside both enrich dispatch arms by design, and not recoverable by running more ticks.
  `audit:enrichment`'s headline line is therefore `families worth attributing` rather than `fixable
families`, with a printed note that it is not a count of recoverable stories and that the family
  must be attributed with `npm run audit:enrichment:cause` — a script that existed but was unreachable
  by `npm run` until now. ~198 stays an **estimate** of the dispatchable remainder, not a verified
  count. No enrichment eligibility was widened. The two cross-references in the classification are
  live for the later queues: `Quoting Matthew Green` belongs to the quote-opening family (D4) and the
  Microsoft story to the stacked-quotes family (D7).
- **2026-10-11 — D8, the alert path gets the gate every briefing story already had** (`9cbde00`
  instrument, then the gate). The owner's report from their own account: alerts do not feel like
  breaking news, and the page behind one sometimes has nothing to read. The alert path had **no
  instrument at all**, so the claim was measured rather than argued — `npm run audit:alerts` reads
  the funnel (in-window events, refused, already alerted, per-day volume, sent) and puts every
  candidate through the **same `assessReadiness` a briefing story passes**, with a gate verdict on
  each alert it prints. On the live database: **108 of the 205 alerts ever sent would have been
  refused by that gate** — 69 `unbriefable` (no publishable body), 31 `primary-source`, 5
  `newsletter`, 2 `commit-message`, 1 `build-number`; the four most recent refusals are two
  `The Download` containers (importance 8 and 6) and two single-source arXiv items. Separately,
  importance does not separate the two populations: **at floor 8, 7 of the 8 recent non-news
  interrupts go and 7 genuine ones go with them.** `fireAlerts` now runs the gate **before**
  `paceAlerts` (a refused hit must not spend a burst slot) and reports `withheld`/`withheldKinds`
  instead of folding refusals into `skipped`. Nothing is claimed or deleted: a withheld event stays
  in `user_events` and leads the reader's next briefing. Six tests in
  [alerts-readiness.test.ts](../src/lib/pipeline/alerts-readiness.test.ts); five fail with the gate
  disabled. **The floor is left alone** — that is the open policy question (options (a)–(d) in
  [decisions/reader-delivery.md](decisions/reader-delivery.md#d8--what-an-alert-is-allowed-to-be-2026-10-11)),
  and the arbiter was unreachable from the session, so the ruling recorded is the owner's, not the
  arbiter's.
- **2026-10-11 — D9 opened: the inside of an alerted story, read by hand.** Verifying D8 meant
  reading the page behind an alert, not just deciding which alerts fire. Three of the most recent
  alerted stories were read through `npm run audit:reader -- --find "<title>" --show 1`. **The audit
  reports 0 reader-visible defects on all three; a person reading them finds five** — two blocks whose
  first sentence is truncated at a clipping boundary ("… the Loews Philadelphia Hotel between Oct.",
  "sentenced on Sept."), one block opening on a bare "2,", one raw URL with forum comment text
  published as reporting ("Investors.boeing.com/… Am wondering what ransomware negotiations he was
  involved in."), and a deck opening on "One standout feature …" before the page has a feature. The
  rulers count none of these classes, which is the D2/D3 failure shape again: a count that cannot see
  the thing being judged. **Next slice is the ruler, not a rule** — measure a fragment/truncation and
  a raw-URL class on the frozen 200, then take it to the arbiter. Full evidence and the exact strings:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#d9--the-block-that-opens-on-a-truncated-sentence-2026-10-11-open).

- **2026-10-12 — every side measured, one instrument, and the ruling that follows (R1).**
  `npm run audit:posture` ([product-posture.ts](../scripts/product-posture.ts)) prints one line of
  truth per side against the live project — accounts and money, every delivery channel, alerts,
  briefings, pipeline intake against drain, cost, flags, and the health rows the app writes about
  itself. It is an instrument, not a gate (it exits 0 with a channel dead since August), and it exists
  because "how done is the product?" had been answered from memory. The measured state, the scorecard
  and the per-side acceptance lines are [product-readiness.md](product-readiness.md); the rating is
  **built 8.5/10, exercised live 5/10, sellable 3/10** — three different questions with three
  different answers.
  Four things this read found that no document said:
  1. **Email has two causes in sequence.** The first failure after the last accepted send is
     `Missing EMAIL_UNSUBSCRIBE_SECRET` on 2026-08-26T23:55, and it runs to 2026-09-11T05:45 (125
     failures); the Resend 401 takes over at 2026-09-11T06:14 and runs to today (128 failures).
     Nothing has been accepted since 2026-08-26T22:59, and push (110 accepted in 30 days) is the only
     channel carrying anything. Telegram has never delivered once. The unsubscribe secret is still
     absent from this environment's `.env`, so a laptop run fails differently from the Worker.
  2. **The 22:30 briefing slot fails systematically** — 16 of 17 failed briefings are that slot, and in
     10 of them a briefing had already been built and **336 items were discarded**.
  3. **`billing:check` exits 1**: the `PLURA`/`OMNI` price variables are unset while the pre-rename
     `PERSONAL`/`PRO` names are still configured, so checkout resolves no price in this environment.
  4. **Two support answers were untrue** — a language control that is deliberately hidden, and a claim
     about alerts that did not match the plans.
     **The arbiter was reached from this session** (the owner's ChatGPT `nyuz` project, "Readiness review
     summary", 2026-10-12) — earlier slices recorded the owner's ruling because the arbiter was
     unreachable; that is no longer the case. Rulings, verbatim and with their reasons, in
     [decisions/product-readiness.md](decisions/product-readiness.md): **the blocking set comes first**
     (email's two secrets, Stripe configuration plus a test payment, the 22:30 investigation, stranger
     sign-in, Telegram exercised or declared inactive); **the alert floor stays as it is, provisionally**
     (D8 closes as a policy question and re-opens as an evidence one — does the gate separate news from
     announcements?); **Uno keeps one alert a day** and the documents change instead; **the support copy
     is corrected**; **the 19 anon-executable `SECURITY DEFINER` functions are classified before any
     grant change** (no blanket revocations, and the RLS/search-path/leaked-password findings classified
     separately); **the 22:30 lateness is investigated rather than normalised in copy**; **every side gets
     an acceptance line** while the reader path keeps its must-be-zero gates; **the 69 alerts at
     `ready` are a status-semantics defect**; and **a recorded failure is not a monitored service** —
     critical failures must reach a responsible person inside a defined time. Landed here: the instrument
     and the readiness document, the two support answers ([support.tsx](../src/routes/support.tsx)), the
     Uno-alert correction in this file and [status.md](status.md), and the acceptance lines. Not landed,
     by the ruling's own order: email/Stripe configuration (owner), the 22:30 investigation, and the
     security classification.

- **2026-10-12 — R1 items 3 and 6: the 22:30 slot investigated, and the security findings classified.**
  Both are read-only: no behaviour changed, and nothing was revoked. Evidence and provenance in
  [decisions/briefing-slot-failures.md](decisions/briefing-slot-failures.md) and
  [decisions/security-classification.md](decisions/security-classification.md).
  **The 22:30 slot is not a scheduling defect.** 19 failed digests, 18 of them at 22:30Z — which is
  07:30 JST, one reader's chosen `send_at`. At the _same_ slot 23 briefings were **sent** and 5
  skipped, so the cron never stopped; a whole-reader outage would not look like that. Two distinct
  shapes: **(A) 12 built-then-discarded** — 25–50 items assembled, every leg failed or one succeeded
  and nothing settled the digest, so it sat `ready` and `expire_stale_work` (0091) failed it two hours
  later as `briefing slot expired`, **413 built items discarded**; four of those rows carried
  **`push:sent`**, meaning the reader got the briefing on their phone while the database called it a
  failure. **(B) 5 never built** — 0 items, no delivery rows, `missed slot by 120–126 minutes`, stamped
  at 00:30. **Diagnosed on a second pass the same day** (see §7 item 3): they are the days whose
  claim crossed the 120-minute ceiling, for two different reasons — killed invocations that nothing
  reaps (1,936 `status: running` receipts) and, on three of the five days, a digest stage that was
  not running regularly. The dominant cause
  underneath is R1 item 1: email legs are 4 sent / **253 failed** (125 missing secret, 128 Resend 401),
  push is 208 sent / 12 failed. This is what justifies `reconcileDigestAfterTerminal`
  ([digest.ts](../src/lib/pipeline/digest.ts)): it settles a digest the moment its last leg resolves, so
  a partly-delivered briefing is `sent` (which the four `push:sent` rows were) and a wholly
  undeliverable one is `failed` at send time with the cause named, instead of silently expiring with
  built items attached. Also re-measured: the `ready` backlog is **70 rows and every one is an alert**
  — zero briefings, so the briefing sweeper has nothing to do, and 48 of the 70 are `email:failed ·
push:sent`, the same status defect in the alert path that the second R1 ruling asks to model.
  **Security classification, no revocations:** all **32** RLS-enabled-no-policy tables (the advisor
  says 31) are reachable only from service-role code, scripts, or pipeline modules that take `db` as an
  injected parameter — the browser's anon-key client is constructed in one module and imported by
  exactly four files, and its only `public` table read is `subscriptions`, which has a policy. Nothing
  is missing; deny-all is correct for internal tables. The mutable-`search_path` finding is the
  migrated chain being clean (0 definers, now locked by a test) against 10 live names outside it —
  owner-side. Blocked, not fixed: the 10 names, the 31-vs-32 reconciliation, and email/Stripe.

- **2026-10-12 — D9's ruler landed, and both first drafts were wrong.** The two classes D9 asked for —
  a **fragment/truncation** class and a **raw-URL** class — now exist as measurement in
  [scripts/lib/defects.ts](../scripts/lib/defects.ts), with 12 tests in
  [reader-truncation.test.ts](../src/lib/reader-truncation.test.ts) (`12 passed`, EXIT:0; both
  `tsc --noEmit` runs clean; eslint clean). **Nothing the reader receives changed** — no rule, no
  refusal, no gate. Measured on the frozen 200 through the real composer: **702 published blocks,
  truncated lead 0, raw URL 6**, against 22 of 207 _input_ excerpts carrying an address, so the
  composer already strips most of them. Of the 6, only two are the shape D9 was opened on (a bare
  Boeing press-release URL — the exact block — and `bun.sh/install.ps1` in a shell snippet); the other
  four are a domain used as an ordinary noun ("visit Orkut.com", "the WordPress.com parent company").
  **The first draft of each ruler produced a number and the number was wrong**: the truncation ruler
  fired on four idiomatic published leads ("while OpenAI moves on.", "most passionate about.", "have
  quickly signed on.", "was scheduled on."), and the URL ruler called `llama.cpp`, `Node.js`,
  `GLM-5.3-Flash` and `pi:llama.cpp/Qwen3.8-Flash-Next` web addresses. Both are now pinned as negative
  controls, and the URL ruler decides on a named set of web TLDs — one recorded miss, zero false
  positives measured. **And the instrument question:** the frozen 200 contains neither D9 sample, so it
  reports 0 on a class the same ruler catches on the live window D9 came from — the live window is the
  instrument for this class, not the corpus. Full record:
  [reader-delivery.md](decisions/reader-delivery.md#d9--the-ruler-landed-and-was-measured-2026-10-12-still-no-rule).

- **2026-10-12 — the briefings have been shipping without their shared explanations, and the cause
  is the AI provider balance.** Found while investigating the 22:30 failures; a different failure on
  the same path, and worse for the reader than a late briefing. Measured: of **1,145** published
  briefing items, **69 carry an empty `why_it_matters`** and **67 of them have no `event_impacts` row
  at all** — and they are not spread out. **2026-09-30 shipped all 25 of its stories with no line**,
  2026-10-01 24 of 25, 2026-10-08 12 of 16, 2026-10-09 8 of 9. The newest `event_impacts` row with
  real text is **2026-09-13**; everything after is absent or a row recording `status: "failed"` /
  `"pending"` with `text: null`. The cause is recorded in the app's own health row and it is money:
  `ops_status.impact:writer` has been **`warning` since 2026-10-01 with `402 Insufficient
Balance`**, and `ai:settle:error` has been **`error` since 2026-09-12 — 30 days** — neither of
  which reached a human (R1 item 7, now measured at 30 days instead of 29.6). What kept the
  briefings readable is the **derived inclusion line** (`reasonFor` in `inclusion.ts`), which builds
  a sentence from the event's own stored fields: it covered 1,076 of 1,145 items and is why the
  digest row says "N storys using a derived inclusion line" from 09-13 to 10-07. It is a fallback,
  not a replacement — when a story has no stored impact _and_ no field for any rung to stand on, the
  item ships empty, and 09-30 is the day it had nothing left to stand on. **No code changed for
  this**; widening the ladder would be a rule change and needs a ruling. The blocking action is
  owner-side: **the AI provider account is out of balance**, the third independent account-level
  blocker beside the two email secrets and the Stripe price names. Full record:
  [briefing-explanations.md](decisions/briefing-explanations.md).

- **2026-10-12 — the pipeline loses 37% of its scheduled invocations to Cloudflare, and no monitor
  can see it** (open, needs a ruling). This is the resolution of the 22:30 investigation's last
  open thread, read off Cloudflare's own record rather than inferred from our tables. Full evidence
  and the ruling it needs: [decisions/cpu-killed-invocations.md](decisions/cpu-killed-invocations.md).

  **The trigger is not at fault.** Cloudflare's `workersInvocationsScheduled` dataset — one row per
  scheduled invocation, with the cron expression and the `scheduledDatetime` it fired for — shows the
  every-minute trigger producing **1,443 invocations across 1,443 distinct slots on 2026-10-11** and
  **1,435 across 1,435 on 2026-10-05**. Every minute fired. The deployed Worker's schedules were also
  read back and match `triggers.crons` exactly.

  **What is happening instead: the invocations are killed.** **354 of 1,443 (24.5%)** every-minute
  invocations ended `exceededResources` on 10-11 and **768 of 1,435 (53.5%)** on 10-05; whole-day kills
  are **604** and **1,047**. Across 09-19…10-12 the account-wide dataset reports **21,909
  `exceededResources` against 37,142 `success` — 37% killed.** `exceededResources` is the metrics name
  for `exceededCpu`, error 1102. The kill line sits at **~10 ms of CPU** (453 of 604 kills on 10-11 land
  in the 9.5–10 ms bucket), and it is a **soft** budget: 767 invocations the same day succeeded having
  used more than 10 ms, up to 0.71 s, matching Cloudflare's documented per-isolate grace. **Which limit
  is configured could not be read from the token available here** — a custom `cpu_ms`, the Free plan's
  10 ms Cron Trigger budget and a legacy Bundled 50 ms limit all sit in that range — and it is stated
  as open rather than assumed.

  **These kills are the 6,258 "missing minutes" and the 1,936 unclosed rows, and they are one thing.**
  Before Audit 47 (deployed 10-07T04:04Z) the receipt was written _after_ the work, so a kill left no
  row and the minute looked skipped: **6,258 minutes** to 10-07, in 1–29 minute groups, never a blocked
  window. After the deploy the same death leaves a `running` row: **1,936 rows**, 493/97/559/531/251
  across 10-07…10-11 and **zero before 10-07**. The rates agree — ~357/day before, ~387/day after — so
  this census's "two distinct mechanisms" was an artifact of which side of that deploy a row landed on.
  Ruled out with measurements: run duration (median 1.6 s, p90 2.1 s, only 3 of 25,433 over 60 s, 0.0%
  overlap), the subrequest budget (kills carry 3–20 subrequests, successes up to 59), retention (0092
  keeps 90 days; the table simply starts at 2026-09-19T13:12Z, twelve minutes after 0092 deployed), and
  the audit's own arithmetic (dividing by `--days` while the table holds fewer days).

  **Why this matters more than a count: the kills land on the ticks that have work.** A tick that finds
  nothing is cheap and survives; a tick that must build, deliver and record a briefing is the expensive
  one. So the reader-visible outcome is a briefing that was never built — not a pipeline that ran less
  often — and the 22:30 failures are a symptom of it rather than a separate bug.

  **The monitoring defect it exposes, which is the part that should worry an operator most.** A killed
  invocation never runs `recordOps(db, "cron:heartbeat", …)` — but the next surviving no-op tick one
  minute later rewrites that row `healthy`, because it is a latest-state upsert written by _every_
  invocation. `/api/health` then tolerates a **45-minute** stale heartbeat and
  `deriveOperationsState` tolerates **2 hours**, and **nothing reads `pipeline_runs` for health at all**
  — the 1,936 abandoned rows are read only by an operator script someone has to remember to run. **The
  pipeline can lose more than a third of its scheduled work and still answer `/api/health` `200 ok`.**
  That is R1 item 7's theme again — a recorded failure is not a monitored service — except here the
  failure is not even recorded, and the monitor is _structurally_ incapable of seeing it because it
  polls a value that survives the failure.

  **Not changed, and why:** no schedule, batch size, limit or health threshold was touched. Option A
  (raise the budget — a billing/config change and the only one that leaves behaviour alone), B (split
  generation from delivery so one tick does one thing), C (reap abandoned run rows and surface them)
  and D (profile per-tick CPU and shrink it) are put to the arbiter with their costs in
  [decisions/cpu-killed-invocations.md](decisions/cpu-killed-invocations.md). `docs/deployment.md`
  already carried the relevant gate unchecked: _"Workers Paid enabled, or production traces prove SSR
  and every cron stay within Free CPU limits"_ — production traces now exist and they prove the
  opposite.

- **2026-10-12 — the owner set the stage and the priority, and both are now rules.** Free plans
  (Cloudflare, Supabase, the AI provider, anything else) are **intentional while the product is
  develop-stage**: a free-tier limit is a condition to design inside, not a defect to close by
  paying, so the 37% kill rate below is **accepted** and Option A in
  [decisions/cpu-killed-invocations.md](decisions/cpu-killed-invocations.md) is settled as **not
  authorised, not to be re-proposed**. The bar that decides every other piece of work is **what the
  reader reads, at 10/10, with no rubbish ever sent to a reader** — judged by opening the live
  product and reading it as a stranger would, not from a passing suite, a green build, or a snapshot.
  Alerts are for something **breaking, important and recent**; silence is the correct default and an
  alert a reader did not need is a defect in the same class as a bad paragraph. The order is build →
  verify against the reader's own output → confirm → push to `main`. The loop is continuous and never
  hands back a status report in place of progress. Written into [AGENTS.md](../AGENTS.md) under
  **Stage and priority** and **The loop does not stop**, and packaged as the `reader-quality-loop`
  skill ([skills/reader-quality-loop.md](skills/reader-quality-loop.md) plus the installed copy in
  the account's global skill set) — the one rule the owner had to state twice, which is why it is a
  skill now rather than a note. **Nothing shipped to a reader before this belongs to the 10/10 bar**, including the 69 briefed
  items with no `why_it_matters` and the 413 built-then-discarded items: those are the backlog this
  priority is aimed at.

- **2026-10-12 — the live product was read as a stranger, and the first reader-facing defect is that
  its own address does not exist.** `AGENTS.md` now requires opening the live product; doing it found
  that the site serves at `https://nyuz.grgvishal-gurung17.workers.dev` while it publishes
  `https://nyuz.app` — a host that **does not resolve** (`getaddrinfo ENOTFOUND`) and has **no zone
  on the Cloudflare account at all** (only `autocasters.xyz`, `launchreadyy.xyz` and `v1.monster`;
  the only Worker custom domains belong to a different Worker, `portfoliiov1`). Three independent
  readings agree. **The first statement of this finding was too broad, and the measured version is in
  the entry below:** the runtime surface (briefing email links, the unsubscribe link, the Stripe
  returns, `sitemap.xml`) reads `VITE_SITE_URL` from the Worker and was already right; it is the
  build-time surface — the canonical link, the OpenGraph images and `public/robots.txt` — that named
  the dead host, from literals in source plus a `Sitemap:` line no setting could reach. Options (A
  register `nyuz.app`, B adopt a domain the account already holds, C ship the workers.dev origin as an
  interim) are in [decisions/reader-facing-origin.md](decisions/reader-facing-origin.md). Owner-side:
  no domain, DNS, `VITE_SITE_URL` binding or test fixture was touched.

- **2026-10-12 — both open findings went to the arbiter and came back ruled, with an execution
  order.** The owner's two further rulings are now in [AGENTS.md](../AGENTS.md): **all plans stay
  free while develop-stage**, and **no domain has been bought** — the product's origin is the
  Cloudflare-provided `https://nyuz.grgvishal-gurung17.workers.dev`, so an unbought domain is a stage
  condition, not a defect to close by paying. The findings and the owner's rulings were then put to
  the ChatGPT `nyuz` project **through the browser** (there is no ChatGPT connector in this
  environment — `supabase` and `cloudflare` are the only MCP servers — so the project has to stay
  open, which is exactly why `AGENTS.md` now requires it). Ruling, recorded in full with its register
  in [decisions/arbitration-2026-10-12.md](decisions/arbitration-2026-10-12.md): **Q1 approved** —
  set `VITE_SITE_URL` to the verified workers.dev origin now, do not wait for a purchased domain, and
  **verify the complete email and checkout flows on that origin** plus add a **deployment-origin
  assertion** so the next misconfiguration is caught by a test; **Q2 — C approved** (bounded,
  auditable abandoned-run reconciliation and a durable kill signal independent of the heartbeat,
  provisional threshold **>5% over 15 minutes with at least 10 observed invocations**, plus degraded
  states in health and detailed evidence in `/admin`), **B deferred pending the CPU evidence**, A
  stays refused; **Q3 — reader quality remains the release bar**, the 69 and the 413 to be
  **attributed individually and not merged into one count**, with confirmed violations blocked. The
  authorised order is: origin first → audit the 69 and 413 → implement C → investigate the CPU
  workload → then decide on B, and _"broad implementation work must not displace immediate,
  confirmed reader-facing corrections."_ **Push ruling unchanged: do not push red, and "worker
  starvation" must be demonstrated by separating environment-dependent failures from real
  regressions rather than asserted.** Nothing is pushed; steps 1–3 are authorised and not yet
  implemented.

- **2026-10-12 — the origin is fixed, single-sourced and asserted (the code half of the ruling's step
  1).** Measured before touching anything: the Worker's own `/sitemap.xml` already listed
  `https://nyuz.grgvishal-gurung17.workers.dev/…`, so the runtime variable was right, and the
  repository variable `VITE_SITE_URL` held the literal placeholder
  `https://<the origin production answers on>` — set 2026-08-26, never changed, and passing the
  deploy job's own non-empty check. The wrong origin came from source literals in `src/lib/seo.ts`,
  `src/routes/index.tsx` and `src/routes/__root.tsx`, plus `public/robots.txt`, a static asset
  pointing crawlers at a sitemap they could never fetch. **Landed:** `src/lib/site-origin.ts` is now
  the one origin — a configured value must be an absolute https origin and nothing else, and a
  placeholder, a `localhost` or a path falls back to the deployed origin instead of publishing an
  address that cannot be reached; `robots.txt` is generated from the same runtime variable as the
  sitemap; the repository variable is now the workers.dev origin. **The assertion the ruling required
  by name** is `scripts/origin-check.mjs`: it takes the deployment's own sitemap as the corpus, then
  requires the pages, `robots.txt` and the sitemap to name **one** origin and that origin to serve
  the site. It has a self-test that breaks eight things (`npm run origin:self-test`, inside
  `npm run ci`) and runs live in the deploy job after the route walk. **Verified:** against the
  pre-fix deployment it fails and names both origins —
  `…workers.dev (sitemap.xml)  |  https://nyuz.app (robots.txt, canonical, og:image, twitter:image,
og:url)` — and against the built Worker served locally under wrangler/workerd, `/robots.txt` reads
  `Sitemap: https://nyuz.grgvishal-gurung17.workers.dev/sitemap.xml` and `/` carries
  `<link rel="canonical" href="https://nyuz.grgvishal-gurung17.workers.dev/"/>` with matching
  `og:image` and `twitter:image`, and `/pricing` canonicalises to the same origin through `seo.ts`.
  **Still owner-side and not met:** the ruling's acceptance for step 1 also requires the email and
  checkout flows **verified on that origin**, and both are blocked by the same missing credentials
  (the provider key is refused; the Stripe price names are unset), so step 1 is landed in code and
  unfinished in proof.

- **2026-10-12 — a push went red on an account quota, not on code, and the artifact upload was
  demoted so it can never skip a deploy again.** The first push of the origin work failed CI with
  every check green: the four test shards, typecheck/lint/build, the browser suite and the commit
  message check all passed, and the single failing step was `Keep the measurement` in the Coverage
  floor job — `Failed to CreateArtifact: Artifact storage quota has been hit`. Because the deploy
  job needs the coverage job, the deploy was skipped and the reader-facing fix sat unbuilt for
  readers. Measured cause: **account-level** quota on GitHub's free plan ("usage is recalculated
  every 6-12 hours"), and this repository is not the owner of it — all 48 of its artifacts total
  **248,359 bytes**. So this is a free-tier condition to design inside, not a defect and not
  something to pay for. **Landed:** `continue-on-error: true` on both evidence uploads
  (coverage-summary and the Playwright failure bundle), with the evidence written into the
  workflow comment. The gate is the Ratchet step — it compares the floor and passes or fails the
  job; the upload is only the archival copy used by the recorded recipe
  (`gh run download <run-id> -n coverage-summary`) when the floor is re-recorded from the runner.
  **Consequence, recorded:** if a floor update is ever needed while the quota is full, the artifact
  must come from a run where the upload succeeded — the measurement itself never depended on it.

- **2026-10-12 — the 69 and the 413 are attributed individually, as the ruling required, and the
  ruler that judged them misfiled 155 items on its first run.** `npm run audit:backlog`
  (`scripts/backlog-attribution.ts`, read-only) reproduces both published counts exactly — 69 items
  over 69 events, 413 items over 12 digests — and prints one disposition per digest with its
  delivery legs and recorded errors. **The 69: all 69 took the same
  rung — and they are not violations.** No explanation was produced (67 `event_impacts` rows never
  written, 2 written with empty text), zero composer drops, so every one fell to the inclusion
  ladder's rung 6: silence, which the rules allow (ruled 2026-10-08 — filler is the defect, honest
  silence is not) and which the templates render around (`email/templates.ts:392` drops the line
  when empty). The first draft of the record called them confirmed violations by reading the
  landing page's sample instead of the rules; corrected in
  [decisions/backlog-attribution.md](decisions/backlog-attribution.md). **The question went to the
  arbiter the same day and came back ruled (Q4): rung-6 silence withholds the item** — no rung-6
  item reaches a reader, no explanation is invented to rescue one ("the remedy is withholding, not
  filler"), and every withheld item is recorded as `skipped` with a canonical reason and its
  identifiers. Implementation is the next slice; until it lands, rung-6 items still ship. **The 413: 168 items / 6 digests were never lost** — an accepted
  leg (5× push, 1× email) means the reader received the briefing while expiry marked it failed,
  the status defect `reconcileDigestAfterTerminal` removes; **245 items / 6 digests were lost to
  execution failures** — 5 digests / 220 items on the missing `EMAIL_UNSUBSCRIBE_SECRET`, 1 digest /
  25 items on a rejected Resend key **and** `public.registered_devices` missing from the live
  schema (schema drift, a finding of its own); 0 policy refusals, 0 expiry-only, 0 other. The first
  classifier filed any digest whose legs failed for _different_ reasons under "other" — 155 items
  misfiled — and the per-leg cause decides now, with every live error string pinned in
  `src/lib/backlog-disposition.test.ts`. Tables and evidence:
  [decisions/backlog-attribution.md](decisions/backlog-attribution.md).

- **2026-10-12 — Q4 implemented: a briefing item with no story-specific line no longer ships.** At
  the admission seam in `digest.ts`, after the inclusion ladder runs, an item whose `why_it_matters`
  resolves to empty is withheld exactly like a readiness-gate item — no `digest_items` row, stamped
  beside the rest so it cannot loop — and the digest row's note records the disposition as
  `skipped missing_story_specific_why_it_matters: <event id> …`, the auditable record the ruling
  demands. Withholding runs **before** the cap, so a withheld slot is filled by an explained item;
  if withholding empties a briefing it takes the quiet-morning path. Rung 6 stays honest silence —
  no explanation is generated to rescue an item. Twelve tests pinning the old "ships without one"
  behaviour now assert the ruled behaviour: fixtures meant to ship a story carry `changeLine`-grade
  state pairs (two-word states are refused by rung 2, which is why the old fixtures produced empty
  lines), and the two tests whose stories genuinely have nothing to say assert the item is withheld
  with its disposition recorded. Caught in verification: `withheldNote` was first computed before
  the gate ran, so the record came out empty — recomputed after the gate, which is exactly what the
  disposition tests proved.

- **2026-10-13 — the home feed runs the same gate as the briefing.** Read live
  as a stranger (`/dashboard`, 23 cards): a podcast episode carried show notes
  as its summary ("Brandon (00:29) So Jess, let's start with…"), a "This week
  on … Premium" recap shelf and four "The Download" containers reached the
  reader as cards. The briefing path was safe (the newsletter rung already
  refuses those titles); the feed was not, because `loadMatchedStories` never
  asked the gate — verified with the gate's own code on the exact live strings
  (`tmp/gate-probe.ts`, since removed): 4 of 5 ship, 1 refused. Two narrow
  rungs added to `readiness.ts`: `transcript` (a summary opening on a speaker
  name plus a parenthesised media timestamp; a clock time mentioned later in
  the text keeps shipping, pinned as a negative control) and a `this week on`
  shape on the newsletter rung (same kind and reason, so the audit needs no
  change). `loadHomeFeed`'s matches branch filters through the same
  `assessReadiness` on title plus summary only — coverage-dependent rungs skip
  without loaded coverage, so the 2026-10-08 decision stands: single-source
  preprints keep their feed place. Search stays ungated (it is the archive).
  Fail-before proof: both rung tests and the feed test failed on the
  unpatched tree (feed served all 3 junk shapes alongside the real story) and
  pass after. Measured: `readiness.test.ts` 52/52, `story-flow.test.ts`
  13/13, seven affected suites 135/135. Authority: the owner in-session — the
  arbiter was unreachable from the session, which is AGENTS.md's first
  escalation condition (same basis as the D8 owner ruling, 2026-10-11) — plus
  the standing order that nothing but 10/10 reader output is next.

- **2026-10-13 — GOB-6, Guardian newsletter sidebar boundary.** Board interaction
  `20825b29-4359-4c90-8d18-a27ef7ab5e66` approved an exact heading boundary before changing
  reader-visible output. `extractMainText` now stops at a `<h1>`–`<h6>` heading whose text is
  exactly "What else we're reading about" (case-insensitive, optional trailing punctuation), so
  the unrelated visa-policy and water-restriction snippets that followed the heading in the
  Guardian story cannot enter evidence or the composed article. The boundary lives in the
  structural extraction layer (`src/lib/pipeline/html-text.ts`) because that is where publisher
  structure becomes text runs; it is not a broad relevance filter. Controls:
  [html-text.test.ts](../src/lib/pipeline/html-text.test.ts) and
  [reader-fixture-regression.test.ts](../src/lib/reader-fixture-regression.test.ts). Fail-before
  demonstration: removing the heading causes the same snippets to be selected as evidence.
  Validated: focused tests pass, `npx tsc --noEmit` clean. The frozen corpus was not available in
  this workspace, so the existing-corpus audit could not be re-run; the fixture exercises the
  captured Guardian case directly. Decision recorded in
  [decisions/reader-delivery.md](decisions/reader-delivery.md#gob-6--guardian-newsletter-sidebar-boundary-2026-10-13).

- **2026-10-14 — envValue stops leaking ambient config past an explicit bag.** The two
  `prices.test.ts` grandfathering tests were red on `main` (pre-existing, reproduced by stashing
  all worktree changes): a fixture that configured only legacy prices reported the catalogue as
  configured, and an env with no annual price still resolved one. Root cause was not the price
  table but `envValue` in [runtime-env.ts](../src/lib/runtime-env.ts) — `explicit?.[key] ??
  ambientEnv()[key]` fell back to `process.env` for any name missing from an explicitly passed
  bag, so under vitest a partial `PriceEnv` was silently completed from the developer's `.env`
  (which sets all four `STRIPE_PRICE_*` names). That is exactly the failure the function's own
  docstring forbids: "a scheduled handler that was given bindings should not silently fall back
  to a different source for one missing name, because that hides a misconfigured secret behind a
  stale value from another context". Now an explicit bag is authoritative — missing means missing
  — and ambient is consulted only when the caller had no bag to thread. Consequence: a missing
  price name refuses the sale (`priceIdFor` returns null) instead of charging from another
  context's configuration. Controls: new case in
  [runtime-env.test.ts](../src/lib/runtime-env.test.ts) pinning no-ambient-fill for an explicit
  bag, and the two previously red `prices.test.ts` cases now pass unchanged. Full suite
  3165/3165 (2026-10-14, `npx vitest run`), `npx tsc --noEmit` clean, lint 0 errors.

- **2026-10-14 — GOB-10 verification: reproduced, judged, and added a price-layer regression
  test.** The pre-fix failure was reproduced in a scratch worktree by reverting only the
  `envValue` one-liner; the two `prices.test.ts` cases and the new `runtime-env.test.ts` case
  failed exactly as described. The committed fix was judged minimal and correct: an explicit bag
  is authoritative, ambient is read only when the caller had no bag, and every audited explicit-bag
  call site either passes a full env or intentionally treats a missing name as unconfigured. A new
  test in [prices.test.ts](../src/lib/server/stripe/prices.test.ts) stubs ambient
  `STRIPE_PRICE_PLURA_ANNUAL` and asserts `priceIdFor("plura", "year", partial)` returns `null`
  instead of charging from another context. Re-run: full suite **3166/3166**, `npx tsc --noEmit`
  clean, lint 0 errors.

- **2026-10-14 — GOB-15: the alert shape floor and the alert status model (stream C).** Two
  reader-facing defects from the GOB-13 triage, both in the alert surface.

  **T2 — non-news alerts still reach phones.** After the D8 gate, five development-free shapes
  passed: a vendor roadmap advertorial (importance 7), a product newsletter (7), a hobby hack (6), a
  personal blog post (6), a memory-kit price piece (6). The CEO ruled (in this issue, binding) that
  alerts are reserved for breaking, important developments and these five classes are refused at the
  alert floor. Landed the narrowest floor extension — `assessAlertFloor` in
  [alert-floor.ts](../src/lib/pipeline/alert-floor.ts), one rule per class, run after `assessReadiness`
  in `fireAlerts` — with fail-before tests pinning each recorded sample and guard cases keeping the
  important developments (KillSec, US disrupts, Nvidia guides, Super Micro, FBI arrest, etc.). The
  ruling is recorded in [reader-delivery.md](decisions/reader-delivery.md) §D8. Measured 2026-10-14
  (`npm run audit:alerts`, now printing the shape floor): **5 of 101 gate-ok alerts refused**, one per
  class (hobby-hack, personal-blog, price-piece, product-newsletter, roadmap-advertorial), 0 genuine
  alerts lost.

  **T3 — the 69 alerts stuck at `ready`.** `digests.status` conflated whole-alert completion with
  per-channel delivery, and `server/alerts.ts:74` read it. The honest model separates the two:
  `alertDeliveryOutcome` in [alerts-recent.ts](../src/lib/alerts-recent.ts) derives the whole-alert
  state — success / partial / failed / pending — from the per-channel `deliveries` rows, and the
  reader query no longer filters on `digests.status`. On 2026-10-14 the live table held 70
  `kind='alert'` digests stuck at `ready`, every one terminal: 39 with a sent delivery (the reader
  was reached) and 31 with only failed deliveries. Migration
  [0117_alert_delivery_reconcile.sql](../supabase/migrations/0117_alert_delivery_reconcile.sql)
  reconciles them additively — UPDATE only, no rows added or removed — mapping `ready`+sent → `sent`
  and `ready`+all-failed → `failed`, with the full mapping and rollback note in the file. No
  external reader of the old alert statuses broke: `reader-alert-audit.ts` reads `kind='alert'`
  without a status filter, and the operator-facing `operations.ts` / `analytics.ts` counts only get
  more honest after the reconciliation. Full suite **3219/3219**, `npx tsc --noEmit` clean (both
  configs), lint clean.

- **2026-10-14 — the live product read as a stranger, the biggest reader-visible defect in the
  sample fixed, and the arbiter's ruling on it.** Five stories were read at the deployed origin
  (`https://nyuz.grgvishal-gurung17.workers.dev`, 2026-10-14) and three carried defects; the
  largest was **source furniture welded into published prose**. Four verbatim examples are in
  [decisions/reader-delivery.md](decisions/reader-delivery.md): a section label and a dateline fused
  to the sentence under it (`The full chain:…September 18, 2026 Operating as hackers under …`), two
  sentence-cased subheads welded to their paragraphs (`Model selection Some frontier models …`,
  `The architecture in one minute Before …`), and one more of the same class found by the
  live-window scan. The class is already **Critical and never-ship** in the GOB-12 quality contract
  (§2 criterion 6, §3 row 3); nothing on the GOB-13 triage owned it, and the T1 ruler provably could
  not see it. `sourceSeam` in [reader-evidence.ts](../src/lib/reader-evidence.ts) now calls
  `sourceFurnitureHead` — a verbless label ending in `:`/`…` before a month-name date, and a
  sentence-cased verbless head before a capitalised subordinator/preposition/quantifier — refused as
  `invalid_sentence` through the one shared predicate, so the evidence pass, the composer's entity
  path and the fallback deck agree; no new reason string, no counter change, nothing else in the
  diff. **Measured narrowness:** 1 match in 7,926 live-window units (1,000 articles, 14 days), and it
  is a true positive; the first draft's 11 prose false positives (`According to The Register`, `The
  other day I`, `with the A19 chip`, …) are pinned as negative controls in
  [reader-furniture-seam.test.ts](../src/lib/reader-furniture-seam.test.ts). Verified: full suite
  **3203/3203** across 188 files, `npx tsc --noEmit` clean, and the local app (127.0.0.1:8080)
  renders both affected stories with the welds gone and the real facts kept. **The arbiter accepted
  the slice as landed and narrow** (ChatGPT `nyuz` project, 2026-10-14) and ruled two further
  defects of the same sample into **separate categories**: an **incomplete explanatory deck** (a
  relative-clause fragment with no main clause) and an **unestablished first-person voice** (`gave us
  access` with no antecedent). It explicitly did **not** declare reader quality 10/10 — the gate
  stays open until those categories are handled and the broader path is re-read.

- **2026-10-14 — the deck the arbiter tracked separately, traced to its cause, ruled, and landed as
  a second slice.** The deck of story `7af726e6` — `A set of taskflow YAMLs, one per stage, which are
  essentially the prompts that tell the LLM agent what to do at each step.` — is not a damaged
  sentence: it is **one item of the source's own bulleted list**, flattened into a paragraph by the
  provider and published as the story's opening line (the two siblings stay in the body, held up by
  the lead-in "There are three layers:"). Three rulers were measured over the live window before any
  rule, and the numbers killed two: "no predicate before the relativizer" matched 82 of 7,870 units
  and **every one was ordinary prose** ("Today's epic patch batch dwarfs September's record …, which
  was already …" — "dwarfs" is invisible to the closed verb lists); adding verb morphology made it 91
  of 7,870 with the same problem ("We present ToFu, a tool-aware framework that …"); requiring the
  relativizer to be **set off by a comma**, with determiner-plus-verb-shaped noun heads masked ("A set
  of …" — `IRREGULAR_PREDICATE` carries `set`) and code tokens skipped (or `fuzzing` in
  `(run_fuzzing.sh)` reads as a verb), gave **12 of 7,842, 11 of them prose**. Landed: `noMainClause`
  in [reader-evidence.ts](../src/lib/reader-evidence.ts), refused at `judgeFallbackDeck` as the
  **existing** `malformed_sentence`, deck boundary only — **not** folded into `sourceFurnitureHead`,
  as the arbiter required, and with the note where the unit-level hook would go explaining why it is
  absent (11 of 12 hits are prose). **Narrowness with the shipped predicate:** 200 completed events,
  192 published decks, 57 carrying a comma-set relative clause, **0 refused**; the production deck is
  withheld (`deck.text === ""`, `deckReasons={"malformed_sentence":1}`) and the article opens on its
  real first sentence; the non-comma shapes that share its grammar are complete sentences and are kept
  ("A Ukrainian company that got rich … now outfits drones …", "A Silicon Valley startup that uses
  weather balloons … won a US military contract …"). **A false positive the repo's own suite caught**
  — `The photographer told Reuters that the image was taken on Monday.`, whose main verb `told` no
  closed list carries — is what moved the rule to the comma-set form, and it is a negative control
  now. **The arbiter accepted it** (ChatGPT `nyuz` project, 2026-10-14): accept as a separate
  deck-boundary rule; **do not promote the next-ranked fact automatically** (a valid fact is not
  necessarily a valid deck, and automatic fallback can hide the original failure); record the
  non-comma limitation and do not widen on current evidence; an empty deck is acceptable here as
  containment, not as proof that an empty deck is always best. Verified: `npx tsc --noEmit` clean,
  12 new tests, 214 focused tests, the full suite at 189 files / 3,215 tests, the deploy gate, and the
  rendered page (no empty-deck artifact). Full record with the ruled limits:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-incomplete-deck-a-published-list-item--ruled-and-landed-2026-10-14).

- **2026-10-15 — the commit-record class refused at the shared reader-content boundary (ruled, landed).**
  The arbiter's first intervention of that day's ruling, chosen over the punctuation seam because the
  delivered lines are development records on cards whose own headline is the commit sha. Scope, all
  measured on the live window (newest 1,000 complete events): **35 cards print a summary line on a
  sha/version headline, 15 of them carry development metadata, and none of the 15 was refused by any
  existing path**; the text is the stored event summary, not an extracted unit (4 of 15 openings appear
  in the excerpt, **0 in `article_evidence`**). Landed: `developmentRecord` in
  [reader-evidence.ts](../src/lib/reader-evidence.ts), carried by the existing `editorial_noise` family
  through `admissibleReaderSentence` -- no new reason string and no new counter, so the established
  remedy applies unchanged (the card recovers validated published content or withholds the line).
  **The controls are what keep it narrow:** the trailer is anchored, because
  "Currently there is a policy requirement for Linux kernel patches where AI tools contributed, they
  should be documented with an Assisted-by: tag, the maintainers said." is reporting and stays
  eligible (that sentence is the measured false positive a loose test refuses); a single `#NNNNN` is
  not a record, so a dump needs two; and the measured vocabulary ("Models", "Vulkan", "Ggml",
  "Meta") is never matched on its own. Anchoring cost nothing on the 676-line control set. Verified:
  `npx tsc --noEmit` clean, 245 focused tests green, `npm run ci` green before the push.

- **2026-10-15 — the ruling's withhold clause landed on the delivery path, and the measurement is now
  reproducible.** `deliveredSummary` in [reader-summary.ts](../src/lib/reader-summary.ts) is asked at
  the join every reader surface reads through ([briefing.ts](../src/lib/server/briefing.ts)
  `hydrateEvents`, `loadMatches`, `relatedEventsFor`): a stored summary the reader-content boundaries
  refuse is **withheld rather than printed**, which is the arbiter's contract for a line that fails
  validation. It asks exactly the checks the ruling names -- sentence admissibility, publisher
  furniture, context recoverability -- and **not** `noMainClause`, which stays deck-scoped as ruled.
  **Re-measured on the delivered surface** (`digests` + `digest_items` + `deliveries`, 21 days, three
  runs, now by [the audit](../scripts/reader-delivered-summary-audit.ts) -- a scratch file was used the
  first time and its predicate set could not be reproduced, which is why this one names the predicate
  behind every refusal): **20 briefings delivered, 297 items delivered, 289 carrying a line, 10 of
  those withheld by the guard, 8 of the 20 briefings (40%) affected**; a wider union including the
  deck-scoped rule reaches 11 of 297. Cost stated plainly: items showing no line rise from 8 to **18 of
  297 (6.06%)** -- an explained increase, which the acceptance criteria require be reported rather
  than hidden. Two delivered lines are **recorded true negatives** in the suite (a single-pull-request
  commit line, a flattened list item); widening either is an arbiter decision on a fresh measurement,
  not a silent change. The other half of the ruling — **compose the valid line at briefing build time
  and store it with provenance**, so a withheld item is delivered with a good line instead of none —
  landed the same day; see the next entry.

- **2026-10-15 — the composed half of the ruling landed: the item's own validated line is stored, and read.**
  The withhold half stopped a refused stored line reaching a reader; this half gives the item the line it
  should have had. At briefing build time (`generateOne` in [digest.ts](../src/lib/pipeline/digest.ts)) an
  item whose stored line the delivery boundary refuses is **composed through the existing path** —
  `composedSummaryArtifact` → `recoveredSummaryFromSources` in
  [reader-summary.ts](../src/lib/reader-summary.ts) → [editorial.ts](../src/lib/editorial.ts), which is
  `recoverCardSummary`'s own extraction and validation, **not a second composer** — validated by the same
  three checks the guard asks, and stored in `digest_items.summary` (migration
  `0118_digest_item_summary.sql`) in the same statement as `delivered_revision`, which is the provenance:
  the revision the line was composed from. Read at the joins the reader surfaces go through
  (`storiesFromDigest` → `hydrateEvents` in [briefing.ts](../src/lib/server/briefing.ts) for the home
  feed, the briefing page and the archive; `loadMailItems` for the email). **Scope, exactly:** only a
  refused (or empty) stored line composes; an admissible line is stored unchanged, so no line a reader
  could already read was altered; where the composition publishes nothing acceptable the artifact is
  `null` and the item ships with no line — the raw description is never substituted. **Measured on the
  delivered surface** (`npm run audit:delivered-summary`, 21 days, 2026-10-15, migration applied and
  **before any briefing was built by the new code**): 34 briefings built / **20 delivered**, **297 items**,
  279 carrying a line, **10 stored lines refused (3.37%; 3.58% of the 279 carrying one)**, **0 replaced by
  a composed line and 10 still with none**, **0 valid artifacts delivered** (nothing built yet), 8 items
  with no stored line at all, **18 of 297 (6.06%) delivered with no line**, **8 of the 13 briefings that
  reached a reader (61.5%) carrying one**, and **raw fallbacks 0 — the gate holds**. **The briefing
  denominator was corrected in the same slice**: the 20/297 baseline was recorded as "a `deliveries`
  row exists", and 7 of those 20 briefings have **only failed** deliveries (13 sent, 20 failed rows), so
  the reader-facing denominator is 13 briefings and the affected rate is 61.5%, not 40% — the audit now
  headlines the reader-facing number and prints the earlier one beside it, labelled, so nothing is
  silently swapped. The item-level numbers are unchanged (all 297 items sit in the 13 sent briefings).
  The audit's recompute over those 18 (labelled
  as a recomputation, not the delivered surface) found **16 are stories today's readiness gate would not
  ship at all** (12 `unbriefable`, 2 `build-number`, 2 `primary-source`) and the 2 it still ships **both
  get a valid composed line, none left empty** — which is why no backfill of delivered history is
  proposed. Fail-before proof: with the composition removed the build-side test fails exactly as the
  defect describes (`expected null to be 'OpenAI released a reasoning model thi…'`). The translated email
  path — the one join the boundaries cannot judge themselves, because they ask English grammar — was
  measured too: 60 days, **694 delivered items, 106 carrying a refused English line, and 0 of those on
  a digest whose reader is not on English; `event_translations` holds 0 rows** (three readers, all `en`),
  so nothing reached a reader that way; the rule (`deliveredTranslatedLine`) prints the artifact first,
  prints a translation only for a line the boundary admits, and withholds a refused line in every
  language — the class closed by construction rather than repaired. **The same audit now reports the one
  delivered surface the withhold half did not reach — a breaking alert — and it was measured rather
  than assumed:** an alert's reader-facing text is `digest_items.why_it_matters`,
  written by `create_alert_delivery` as `p_why: event.whatHappened || event.title`, and it is both the
  alert email's body paragraph and the Alerts page's explanation. Over 60 days: **184 alerts delivered,
  26 of their lines (14.13%) refused by the sentence boundary, 0 carrying an artifact** — but **20 of
  those 26 refuse only because an alert's line is not one sentence** (a paragraph, not a line: the
  alert's text is admitted by the fire gate, not by the sentence boundary), and **every line that is a
  defect in any class (5) sits on an event today's fire gate refuses**, so **0 are deliverable by any
  current path** (21-day window: 44 delivered, 3 refused, 0 live). The alert surface therefore has no
  live violation to repair, and it has no composed half either; whether it should get one (a new
  `create_alert_delivery` parameter), be read through the delivery boundary (which would withhold the
  alert's own explanation), or stay as the fire-gate-admitted body class is an **open question for the
  arbiter**, recorded with the numbers in
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-other-delivered-surface-measured-the-same-day-a-breaking-alert).
  Verified: `npm run ci` green on the final tree — typecheck (app and scripts), eslint, **3,294 tests in
  193 files** with the coverage floor held, the production build, the PWA install self-test, the
  route-walk self-test, the origin self-test and **e2e 30/30** — plus the focused files for this slice
  (`reader-summary`, `digest-summary-artifact`, `digest`, `digest-delivery`, `digest-cost-safety`,
  `briefing-timing`, `story-flow`) and the live audit re-run. The email join is pinned too, not only in
  the resolver: `digest-delivery.test.ts` flushes an email delivery for an item whose stored line is
  refused and asserts the message carries the artifact and not the refused line (text and HTML), with the
  fail-before proof recorded in the decision log. **Landed and deployed:** `a82a8c0`, CI run
  `38693464587` green end to end on the runner (all four test shards, coverage floor, browser smoke on
  the built Worker) and the **deploy job completed 2026-10-15T06:42:45Z**; the post-deploy window the
  ruling allows runs to **2026-10-16T06:42:45Z**, and `npm run audit:delivered-summary -- --deploy-at
  2026-10-15T06:42:45Z` now reports the two cohorts (post-deploy cohort: 0 rows, recorded at deploy
  time so the next measurement can only move it). **Ruled 2026-10-15 (recorded
  in the decision log): Q1 = A** — an alert's explanation stays a paragraph under the alert's own contract
  (`assessReadiness` + `assessAlertFloor`), no code change; **Q2 = A first** — wait up to 24 hours after
  the deploy for a natural briefing build, with the controlled build for a reader whose channels are
  empty approved only as the labelled fallback; **historical backfill and universal summary composition
  are not authorized**; overall reader-quality gate **open**. Full record with the two questions this
  leaves for the arbiter (repair-scope vs full coverage; backfill vs age out):
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-composed-half-of-the-ruling-landed-2026-10-15).

- **2026-10-15 — the root cause ruled, and the measurement that had never been taken.** The owner
  asked why reader quality is not rising after a month of slices, rather than accepting another
  refusal rule; the arbiter was asked the same question and agreed with the answer. **Measured on the
  delivered surface** (`digests` + `digest_items` + `deliveries`, last 21 days): **57 briefings built,
  341 items handed to a reader, 12 items (3.5%) carrying a line a boundary refuses, 14 more with no
  line, and 14 of 57 briefings (25%) containing at least one refused item.** The cause: **the summary
  line a reader receives in a briefing is the feed's own description, not composed prose** — of 15
  commit-record lines on the delivered surface, **0** opened `article_evidence` and 4 came from the
  excerpt — so the story page (which composes and validates) and the briefing, dashboard and email
  (which do not) enforce different standards, and an item the story page had **withheld** was delivered
  in a briefing anyway. Every past slice closed one shape at one surface while the delivery input
  stayed unvalidated, which is why the class supply kept refilling (1/686 → 13/679 → 24/679 → 18 → 15 on
  consecutive days). **Ruled (ChatGPT `nyuz` project): option 1 with a contract — the summary must be a
  validated artifact built at briefing time through the existing composition path, stored with
  provenance, and withheld rather than falling back to raw feed text — and option 4 as the primary
  acceptance criterion: delivery-level metrics, with the release gate that the count of raw fallbacks
  is zero.** The provenance hook already exists (`events.material_revision`,
  `digest_items.delivered_revision`, migration 0099). **Next: implement the validated-summary artifact; nothing else is next until the delivered surface is
  measured clean.** The trace that preceded it is finished and it changed the design: **`digest_items`
  stores no summary at all** — its only generated text is `why_it_matters` — so every surface the reader
  sees reaches **the same raw column through a read-time join** (`digest_items.event_id →
  events.what_happened`: [briefing.ts](../src/lib/server/briefing.ts) lines 105-126, 522-544, 1259-1302,
  [digest.ts](../src/lib/pipeline/digest.ts) 2094-2179, [alerts.ts](../src/lib/pipeline/alerts.ts)
  538-580, [history.ts](../src/lib/server/history.ts) 184). There is nothing per-surface to reconcile, so **one validated artifact read at that
  join fixes the dashboard, the briefing, the email and alerts together**, and the digest build path is
  where it is produced. Slice, withhold semantics, baseline to beat and gate:
  [reader-summary-artifact-handoff.md](reader-summary-artifact-handoff.md). Full record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-root-cause-ruled-an-enforcement-gap-between-ingestion-and-delivery-2026-10-15).

- **2026-10-16 — a critical advisory in the framework blocked every deploy, and a patch-level bump closed it.**
  The runner's `Dependencies and secret names` job began failing at 2026-10-16T00:25Z with **5 critical**
  advisories against `@tanstack/*`: **GHSA-qx66-fv34-fjm8**, *“Unauthenticated reflected XSS in TanStack
  Start server-function responses”* — an attacker-crafted URL to a server function makes the app answer
  with attacker-controlled HTML from its own origin, so their script runs with the visitor's authority;
  the victim only has to open the link. The doubled cost: **the deploy job is skipped while any check is
  red, so nothing could reach production.** Fixed by moving the three pinned packages to the release that
  carries the patch — `@tanstack/react-start` 1.168.32 → **1.168.60** (the advisory's fix for that
  package; it pins `start-server-core` **1.169.39**, which is the advisory's fix for that one, plus
  `react-start-server` 1.167.46 and `react-start-rsc` 0.1.59), `@tanstack/react-router` 1.170.18 →
  **1.170.41**, `@tanstack/router-plugin` 1.168.23 → **1.168.42** — one copy of each resolves
  (`npm ls` shows every one deduped). The job's own command, `npm audit --omit=dev --audit-level=high`,
  is **0 vulnerabilities**. One source change was unavoidable: the router widened
  `ErrorRouteComponent`'s `error` prop to `unknown`, so `ErrorComponent`'s signature in
  [__root.tsx](../src/routes/__root.tsx) widened to match (`humanError` already read `unknown`) — no
  behaviour change. The findings left in the full audit are dev/build tooling only (vitest/tinypool,
  sharp via nitro, undici), which the job's `--omit=dev` scope excludes on purpose.

- **2026-10-16 — the post-deploy checkpoint: the natural attempt failed its sixth night, the controlled
  build was blocked by a product guard, and the read-only diagnostic is what ran instead. Recorded as
  overdue.** The 22:30Z slot ended `failed`, 0 items, *“missed slot by 123 minutes; not sent”* (last claim
  00:26:40Z, generated 00:32:40Z) — the same CPU-condition shape as 10-10…10-14, so it produced no
  qualifying evidence. The approved controlled build (`npm run pipeline -- digest --user <id> --now
  --skip-send`) then could not create its slot: **`enforce_daily_briefing` (0082) drops a second briefing
  for the same account-local date** when the day's earlier row failed *after* starting, and the
  10-15T22:30Z row is JST 2026-10-16 with `generation_started_at` set. Measured twice (runs at 00:34:46Z
  and 00:38:44Z): the CLI reports “slots created 1” — it counts planned rows — while **no row is
  written**. Every reader is blocked until 15:00Z (JST midnight). **Ruled: B now, A after 15:00Z, the
  checkpoint recorded as overdue (~8h17m), no bypass of the guard, no rewrite of the failed row, no
  repeated attempts.** **B, the read-only composition diagnostic**
  ([scripts/reader-composition-diagnostic.ts](../scripts/reader-composition-diagnostic.ts)) found: the
  reader's pool is **1000 live matches → 128 eligible → 37 considered → 13 ship, 23 withheld by the
  readiness gate**, and **all 13 shipping items carry a stored line the boundary admits**, so **0
  artifacts would be stored by a build today**. In the 200 most relevant matches, **16 items are ones the
  build would compose for** (5 refused lines, 11 with no stored line); **14 are withheld** (newsletter 5,
  primary-source 4, unbriefable 4, …) and **2 are shippable but rank outside today's eligible set** — and
  the composer produces a valid line for each (*“The activity, which brings together commodity offensive
  tools like Cobalt Strike with an AI orchestration layer powered by Anthropic's Claude Code, has been
  attributed.”*; *“The AI takeover of mathematics has begun.”*). So the composer provably acts on today's
  real pool; the repair path is *needed* by 2 shippable items today and simply does not rank into a
  briefing today. **Next for the checkpoint:** run A at/after 15:00Z (verify the slot row exists after
  `scheduleUpcoming`, not the reported count) and expect it to show composition not attempted unless the
  pool shifts — a finding about the pool, not a defect. Then the ruled next slice: **a build that
  completes inside the free-plan CPU budget for a large pool** (reproduce → locate → reduce without
  bypassing readiness, duplication or composition → demonstrate completion → verify selection,
  artifacts and delivery). Full record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-daily-guard-blocks-the-controlled-build-a-and-b-read-only-runs-instead-2026-10-16).

  **2026-10-16 — the ruled CPU-budget slice: a briefing is built across Cron ticks (0119).** The
  arbiter ruled Option C as the target architecture and Option A as the slice to land first, with the
  reader's backlog briefable only under the existing selection and shipping rules (no sweep, no
  higher cap, no special recovery rule), a briefing arriving minutes late acceptable if reliable and
  complete, precomputed per-event verdicts deferred to after tomorrow's release decision, and the cap
  at 25. Landed: `digests.generation_progress` carries the build's cursor, the build is cut at its own
  stage boundaries (`select` → `screen` → `gate` → `write`), `loadDue` resumes a row that carries
  progress on the next tick instead of waiting out `GENERATION_LEASE_MINUTES`, the readiness gate
  takes `GATE_BRIEFS_PER_INVOCATION` (2) briefs an invocation, and a stage whose set exceeded
  `TICK_SET_LIMIT` (12) gets a tick of its own. The snapshot is frozen (the instant it was ranked at
  plus each candidate's `material_revision` are persisted, so nothing re-ranks between ticks); a story
  materially revised between ticks is dropped from this briefing, recorded as
  `revised_since_generation_started` and left unbriefed so it leads the next one; `briefed_at` is
  written only in the write stage and only for stories this build took a verdict on; a stage that
  throws keeps the cursor; and items are written, `finish`ed and delivered in that order, so the
  briefing becomes visible only when complete. **Why it was needed:** one invocation built the whole
  briefing, and on the reader whose 22:30Z slot was killed six nights running (1,000 unbriefed
  matches) that build costs ~17.7 s of CPU against an observed Workers-free success ceiling of
  ~710 ms (`cpuTimeUs`, 2026-10-11) — the gate alone is 15.5 s, a median 338 ms per brief. **Why a
  count and not a clock:** a wall-clock budget would make "did this finish in one invocation" a
  property of the machine, and every reader whose build already fitted in one tick still finishes in
  one. **Verified:** 10 new tests in `src/lib/pipeline/digest-resume.test.ts` (fail-before), including
  the arbiter's equivalence — the same five stories built from a small pool in one invocation, a large
  pool in two and a large candidate set across eleven ship item for item the same briefing — and the
  eight digest-related suites at 97 passing. **Not verified:** the Worker's own per-tick `cpuTimeUs`,
  and the residual that `select` (~0.93 s) and `screen` (~1.19 s) are each still above the ~710 ms
  ceiling on that reader's pool, which is what option B (deferred to after the release decision) is
  for. Full record: [decisions/reader-delivery.md](decisions/reader-delivery.md#the-ruled-slice-a-briefing-built-across-cron-ticks-2026-10-16-ruled-and-landed).

- **2026-10-16 — the second measurement named the spend, and the gate itself was repaired without
  moving a verdict.** The arbiter moved the CPU-budget failure into Day 2 (*"Move the CPU-budget
  failure into today's active work"*, decision `B` with a narrower definition of what closes the
  checkpoint) while keeping the controlled build at 15:00Z and recording the checkpoint as
  **overdue**, not as an on-time pass. The first measurement had said the gate's cost "tracks excerpt
  size"; a CPU profile of `assessReadiness` over the 22:30Z reader's live pool named the mechanism
  instead: `repetitionBomb` (4,330 ms, 22.2%) rebuilt every phrase window and compared it to every
  other window for what is a three-occurrence count, and `contains` (3,216 ms, 16.5%) compiled a
  fresh `iu`-flag lookbehind `RegExp` **on every call** -- per name, per sentence, per source -- with
  two inline patterns in `rankEntities` doing the same. **Repaired:** the repetition predicate counts
  in one pass per phrase length; `contains` memoises its compiled pattern behind a bounded cache and
  answers with `indexOf` plus a check on the two characters touching the match when the name and the
  text are both ASCII -- guarded so that anything wider keeps the exact regex semantics, because the
  case fold is not one-to-one (long s, final sigma, Kelvin sign). **Measured after, same harness and
  same pool:** the gate **15,113 -> 2,634 ms of CPU (5.7x)**, median per brief **125 -> 18 ms**, worst
  **1,826 -> 435 ms**; the whole read path **17.7 -> 6.4 s**, with `select` ~250 ms, `screen` ~200 ms
  and the write ~52 ms -- each now inside the ~710 ms grace the kills were measured against, and none
  of them was before. **Equivalence proved, not argued:** 200 stories frozen once and composed on a
  clean worktree at `17d1b36` and again on this tree, diffed with `scripts/reader-composer-diff.ts` --
  **0 stories rewritten, 0 that lost or gained 25+ words, every reader-visible defect counter
  identical** (wall clock 22.5 -> 8.6 s for the same run). Eleven tests in
  `src/lib/reader-evidence-equivalence.test.ts` pin the shapes a counting rewrite can get wrong; they
  also pass on the previous tree, which is stated rather than dressed up, because the evidence that
  nothing moved is the corpus diff. **`GATE_BRIEFS_PER_INVOCATION` is now 1**: the worst *pair* of
  briefs is still ~670 ms against a ~710 ms grace, and a killed tick persists nothing, so an
  over-budget pair would be retried forever. **Not verified:** the Worker's own `cpuTimeUs` for these
  ticks; the natural attempt at 22:20Z is what tests the claim. Full record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-gates-own-cost-repaired-2026-10-16-ruled-then-measured-and-landed)
  and
  [decisions/cpu-killed-invocations.md](decisions/cpu-killed-invocations.md#2026-10-16--the-second-measurement-the-profile-names-the-spend-and-the-repair-is-proved-equivalent).

- **2026-10-17 — the briefing arrived, and it was one story: the checkpoint's evidence exists and it
  exposes a collapse that outranks the rest of the queue.** Read off the live project, not inferred.
  The reader whose slot failed six nights running **received a briefing on the first natural attempt
  after the repaired gate shipped** — digest `cbaac7f5`, `ready`, **1 item**, generated
  **2026-10-16T22:59:35Z** (30 minutes after the slot, inside `MAX_LATENESS_MINUTES`, where the six
  failures sat at +113 to +123) and **push accepted 22:59:39.808Z**; the email leg failed `Resend 401`,
  which is the ruled intentional state. Controlled build **A ran** at **2026-10-16T14:59:08Z**, 1 item,
  push accepted 15:01:35Z. The ruling's must-be-zero gate holds: `npm run audit:delivered-summary`
  reports **raw fallbacks 0 of 248** over 21 days, 9 stored lines refused and all 9 delivered with no
  line, post-deploy cohort 1 digest / 1 item / 0 composed artifacts / 0 refusals — the composed half has
  simply never had an occasion live. **The defect is the size.** The same build withheld **36 of 37**
  candidates, 15 of them by Q4, and the reader's `item_count` history is a collapse, not a thin day:
  **16–25 stories** from 2026-09-13 to 10-03 (25 on 17 of those days), then 23, 24, **16 on 10-08**, **9
  on 10-09**, the CPU zeros, **1 on 10-16**, and **0 previewed for tonight** (`ready then Q4-gated: 5 →
  0 ship`). **Why**, measured over the reader's 1,000 unbriefed matches: every rung that needs stored
  analysis text is empty — stored impact **0/1000** (the writer is off by policy; no `event_impacts` row
  has text since 2026-09-13, and `ops_status["impact:writer"]` has been `warning` with **402
  Insufficient Balance** since 2026-10-01), change/after-state **0/1000** (`events.after_state` is empty
  on all 1,000 events of the last 14 days), consequence **7/1000** — while 837 of the 1,000 hold stored
  evidence, so the rung is money-specific and not evidence-starved — coverage **27/1000 (2.7%)** — and `publisher_count` is *accurate*, 199 of 200 agree with the distinct outlets, so the
  pool genuinely is single-source. So **Q4 withholds ~97% of the pool**, and **two rulings collide**: Q4
  (2026-10-12) was ruled assuming the ladder could speak, and the code-first policy switched off the rung
  described as the one that carries the load. Recorded in
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-briefing-collapsed-from-25-stories-to-1-and-every-rung-that-could-speak-is-switched-off-2026-10-17-open)
  with five numbered options for the arbiter and what each rests on. **Fixed in the same slice, because
  it made the evidence wrong rather than merely thin:** three read-only instruments answered *"would this
  ship?"* **before Q4** — the composition diagnostic said 13, the preview 5, the build 1, and tonight 0 —
  so the numbers were evidence about the instruments, including the recorded conclusion that *"A may
  legitimately report composition not attempted"*. There is now **one definition**
  (`hasStorySpecificLine`, [inclusion.ts](../src/lib/pipeline/inclusion.ts)) called by the build and by
  the instruments, `GATED_KIND` is exported so the reason has one spelling, the preview prints
  `Ships (0)` plus a `Withheld by the Q4 quality gate (5)` section naming the stories a reader would
  otherwise have received, and `briefing-checkpoint.ts` no longer loses its **per-channel delivery
  section** when its replay throws (`TypeError: fetch failed`, twice today, unreproduced from a probe —
  recorded as unexplained). 2 new tests in `src/lib/pipeline/inclusion.test.ts` (28 passing). **Not done
  at that point, deliberately:** nothing that changes what a reader receives, because every option in
  that list is a product decision and none of them lands on a recommendation — **superseded the same day
  by the owner's ruling** (*"this saas is no ai product, its should be pure code"*), recorded in
  §7 and in [AGENTS.md](../AGENTS.md): the Q4 gate is reversed, the reader's next briefing goes from 0
  ships to 7, and every one of them renders with no explanation rather than a generic one.

- **2026-10-17 — the deploy blocker was cleared in two of the three places that carried it, and the
  third is corrected here.** `a1d6d2c` says *"the stale blocker is corrected in both places that
  carry it"* and it is right about §7 and [deployment.md](deployment.md#deploying), but the **§4
  Current-state row still read `BLOCKED 2026-10-16`** with "`main` is ahead of production" — the row a
  cold session reads before the prose — so the file contradicted itself about the one thing that
  decides whether tonight's attempt exercises the repaired gate. Both stale statements are now
  `Working`, with the twenty-minute block, its billing annotation, the unblock and the 23/23 origin
  contract kept as the shape that recurs while the repository is private. The same pass marked the
  **briefing email** entry in the owner-blocked list as the ruled intentional state rather than a
  blocker, so a session cannot re-open it as a defect to repair. Docs only; no code, no behaviour,
  and nothing measured here — the numbers cited are the ones already recorded above.

- **2026-10-17 — the ranked body path restores source adjacency (arbiter ruling #4).** Read in the
  browser on the live origin, the reader's only story of the day opened its fourth paragraph on
  *"However, they also rely on several smaller manufacturers…"* with nothing above it naming who
  `they` was, while the source's own naming sentence (*"Major Taiwanese companies are more than
  capable…"*) published *after* it in the same block. Cause: `ordering=relevance` for that story
  (enriched + rss facts), so the single-source path's adjacency rule never ran; and `contextDependent`
  read position zero, so a pronoun behind `However,` was invisible to the gate as well. Put to the
  arbiter with the frozen measurement — 104 anaphoric facts, 77 with a selected source-adjacent
  predecessor, 66 of those refused — it ruled option 1 with conditions: repair the ranked body path,
  refuse when the predecessor is missing or fails its gate, do not touch the deck, and report every
  repair by name. Landed: the composer publishes the predecessor directly in front of the sentence
  that needs it (or splices it in when the predecessor is already published), the pair is never split
  by the block budget, the gate refuses a dependent whose predecessor it refused, and
  `antecedentSupplied` (`reader-evidence.ts`) refuses to call proximity proof — a plural reference
  needs a plural noun phrase, a demonstrative needs its noun, and animate references keep their
  refusal. The first guard's frozen numbers — 1,399 → 1,405 rendered, `unresolved_context` 92 → 85,
  +8 sentences — were **withdrawn the same day**: reading its output found it had published dangling
  references (next entry). Eight new tests; with the repair disabled two of them fail and the refusal
  controls pass. Not verified on a rendered page: the live briefing predates the change, so the
  verification is the composer output on that event's own data, the frozen before/after and the
  audit window.

- **2026-10-17 — the source-adjacency guard was tightened after it published two dangling
  references.** The first `antecedentSupplied` accepted any word ending in `s` anywhere in the
  predecessor, so verbs counted as groups. Reading the live audit (`npm run audit:reader`, 1,991
  selected facts) found two published defects it had created: *"They then debate the merits of
  returning to X…"* behind *"What gives here?"* (the `s` was `gives`), and *"Their listing for the
  WhatsApp impostor…"* behind *"Android Authority points out that…"* (`points`, `reviews`, `users` —
  none of them the referent). The frozen replay added a quotation (*"The morphology of these 13
  tools…"*) as the antecedent of *"They found spears…"* and *"France saw … in years"* as the
  antecedent of *"They used an angle-grinder…"*. The guard now requires the group in the
  predecessor's **own subject**: it stops at the first recognisable finite verb, refuses a sentence
  that opens on a quotation, refuses when no verb can be found, and accepts a `They`-opening
  predecessor as an explicit chain. Re-measured: frozen **3 repairs** (surfers, AI coding agents,
  batteries), live **2** (Taiwan, the SI-practices paper), every one read in place; frozen facts
  rendered 1,399 → **1,401**, `unresolved_context` 92 → **90**, `article_limit` back to 10, facts
  lost 0, both must-be-zero lines 0; live rendered **1,794**, refused 197, facts lost 0. The cost is
  recall, named in [decisions/source-adjacency.md](decisions/source-adjacency.md): six sentences
  that happened to read correctly can no longer be proven. One new test (the two measured false
  pairs plus both controls).

- **2026-10-17 — publisher furniture: the ruled byline shape's own gaps closed, and a programme's
  own episode intro refused.** The 2026-10-14 ruling put the copular masthead byline into
  `publisherFurniture`, but three measured sentences were still the same shape and still passed: a
  three-word role phrase (*"Stewart Bendle is a deals and coupon writer at Tom's Hardware."*, the
  pattern allowed two words), a role the closed set had not collected (*"Theresa Loconsolo is an
  audio producer at TechCrunch."*), and a programme describing its own episode (*"On this episode of
  The Vergecast, David and Nilay try to make sense of…"*), which was published as the **deck** of a
  story whose only paragraph was the hosts' banter. Measured over 2,108 stored units from 250 live
  events: 2 programme intros, both a podcast's own episode page, and 2 byline units, both the same
  masthead — **0 reporting sentences**, which is the precision the ruling asked for. The role set
  gains `producer`, the role phrase allows three words, and the programme intro is an anchored
  `On/In this episode/edition of` rule. With the intro refused, that story's deck becomes a real
  fact (*"The device has plenty of computing oomph…"*) and its body is the hosts' back-announce
  (*"Relying on CarPlay, slinking back to X…"*) — the story itself is still published, which is the
  next open question, not a claim of repair. Live audit after the change: facts selected 1,978,
  rendered 1,783, refused 195, **facts lost 0**, both must-be-zero lines 0, no story withheld by
  this rule. Tests 224/224 in the two touched files (a new furniture test with four controls).

- **2026-10-17 — a sourcing note with no fact in it no longer reaches the page.** Reading the
  composed Combs story (`npm run audit:reader`'s corpus, the same composer the page uses) showed a
  paragraph ending on *"The person was not authorized to speak publicly and did so on condition of
  anonymity."* — a sentence about how the article was obtained, and one whose `The person` nothing
  on the page introduces. Measured the same day over 3,856 stored and 2,208 published sentences:
  **3 anonymity notes, exactly one factless** (this one); the other two carry facts (*"One person
  familiar, who asked not to be named, said the partnership was still in place."*, *"…according to
  a White House official not authorized to speak publicly"*) and are kept. `sourcingNote` refuses
  the factless shape at both boundaries (`unitTextRejection` charges `editorial_noise`, and
  `editorialNoise` covers the composer's gate), with four controls in `reader-prose-rules.test.ts`
  (178 passing in that file). Verified against the reader's own output: the Combs story's fourth
  paragraph now ends on Engelmayer's second quote, `rendered=10 refused=1`. The neighbouring defect
  in the same read — the OpenAI story's paragraph opening on *"Easier to beg for forgiveness than ask
  permission."*, a verbless maxim — is **measured and not fixed**: a general "must contain a finite
  verb" rule needs a verb lexicon the closed lists do not carry, and the probe that tried found the
  shape in 2 sentences of 2,208 with the rest false positives from the lexicon's own gaps.

- **2026-10-17 — a source's own typo no longer reaches the reader.** Reading the live product after the
  programme-page slice (the Taiwan industrial-park story on the dashboard) turned up a sentence no
  grammar rule could see: *"… Jensen Huang has even recognized some of these companies in a keynote in
  Taipei earlier in 2026, nothing the crucial part that these smaller companies play in the global AI
  supply chain."* The word is `noting`, and Tom's Hardware's own page says `nothing` too (fetched the
  same day), so it is the **source's typo published verbatim** — a sentence with no true reading, which
  is the same class of defect as a truncated one. Measured first, on the frozen live corpus through the
  production composer: 3,871 stored sentences → 2 matches (that sentence twice), 2,219 published → 1.
  **Ruled the same day (arbiter ruling #6, option 1): refuse the sentence as `editorial_noise`, do not
  repair it, do not generalise the pattern.** The first draft (`nothing` + determiner) was rejected by
  the ruling's own control — *"There is nothing the company can do about the export controls."* is
  grammatical and matched — so the shipped pattern carries the `… that` tail the malformed sentence has
  and the grammatical one does not: 1 match, 0 false positives. Landed as `sourceTypo`, wired into
  `editorialNoise` and charged by `unitTextRejection`; release evidence replayed on the 250-event corpus:
  the sentence is now absent from published output (was 1), the story still publishes all five of its
  other paragraphs, 196 of 250 stories keep a body, 179 tests pass in the rules file. Recorded in
  [decisions/source-typo-verbs.md](decisions/source-typo-verbs.md).

- **2026-10-17 — a programme's own page no longer reaches the reader, and the alert floor took its two
  measured classes.** The two questions the last loop recorded instead of fixing went to the arbiter in
  the owner's ChatGPT `nyuz` project (chat *"ARBITER REQUEST 2026-10-17 #5"*), on the owner's
  instruction (*"discuss with chatgpt dnt ask me until both get conclusion"*). **Ruling, both Option 1:**
  withhold a story whose published body is *only* publisher-owned material, as a readiness reason, with
  nothing invented and the deck never substituted for the body; and add the shelf/deal and commentary
  alert classes as two independent narrow rules with regression tests. Recorded verbatim in
  [decisions/programme-pages-and-alert-floor.md](decisions/programme-pages-and-alert-floor.md).

  Landed the same day. Four furniture entries in `src/lib/reader-evidence.ts` (the masthead byline that
  keeps going with a *beat*, the two bio continuations behind it, the conference promo fragment, the
  programme intro), one of which exposed a real trap: those regexes compile with `i` and **without** `u`,
  where `\p{Lu}` is the literal text `p{Lu}` — the first version of two entries was dead code. The
  controls the ruling kept now say so in the test: *"Maya Chen is the reporter at The Verge who broke the
  story on Friday."* stays eligible, a *beat* continuation does not. Verified on the reader's own output,
  `npm run audit:reader`, live 200-story window: *A Nvidia insider-turned-VC…* and *Apple's HomeView has
  an app problem* both read `emptied-after-selection (charged to a rule)` and fail the existing
  `unbriefable` rung, so neither is published; `delivered with no body 0`, `refused then published 0`.
  Both were also **never delivered** — no `digest_items` row names either event — so the release
  criterion was met before a reader could have met them, with no retroactive unpublishing.

  The floor's two classes, each pinned to the one measured title and measured against every other title
  stored: over **21,908 event titles**, `shelf-deal` (urgency frame **and** acquisition verb) matches 1
  and `commentary` (a negated modal about an audience) matches 1 — the two sends. The candidates a wider
  rule would have used match **0** titles at importance >= 6, so they were left out. The ruling's four
  controls stay eligible and are pinned in `alert-floor.test.ts`. `npm run audit:alerts` after: the two
  sends read `floor shelf-deal` and `floor commentary`, every other alert unchanged.

- **2026-10-17 — the alert instrument stopped claiming the alert path is ungated.**
  `npm run audit:alerts` printed *"refused by the gate <- the alert path never asks"*, which stopped
  being true on 2026-10-11: `fireAlerts` asks `assessReadiness` before it paces or sends, so the
  number is what will be *withheld*, and the historical *"113 of 218"* is overwhelmingly sends from
  before that date. Both labels now say so, and each row of the sent list carries its own verdict.
  Read while checking the alerts after the reader work: **the path is gated and recent sends are
  clean** — the newest 12 alerts all read `gate ok`. Two post-gate sends a reader did not need, both
  recorded rather than fixed because widening the ruled alert floor is a decision: *"This could be
  your last chance to grab an RTX 5090"* (a deals post; measured over all 218 alerts, 4 deal-shaped
  titles and 3 are real news — acquisitions and a bill) and *"It won't kill you, or humanity, to get
  off the AI upgrade treadmill"* (a commentary column; 2 opinion-shaped titles of 218, the other an
  analysis piece). The floor's own design is one measured narrow class at a time, so these are a
  question for the arbiter/owner, not a patch to slip in.

- **2026-10-17 — ruling #7: paid-content pages, page openings, and a welded subhead.** Three reader
  defects went to the arbiter together, each measured first. **Q1, paid content:** *"NTT Global Data
  Centers weighs the price tag of not building fast enough"* was the worst case — every word of it a
  vendor's sponsored page under a title that reads like reporting. Measured over all stored coverage
  (2026-10-18): **48,151 articles**, **36** in a publisher's paid lane, **29 events of 21,863** whose
  every coverage URL is paid, and **five of those 29 already in a digest** — three briefings (two sent)
  and **two alerts, both sent**. Ruling: refuse at readiness as `paid-content`, all-or-nothing on the
  URLs. **Q2, page openings:** **8 of 1,049** published blocks opened on a reference the page never
  established (`That maneuver needed specialized hardware …`, `Those in need get financial aid …`, `The
  report models three growth trajectories …`). Ruling: judge each block against title, deck and the
  paragraphs above; withhold the sentence, not the story. **Q3, welded subhead:** *"The misconceptions
  that stall projects Two objections come up …"* — the seam guard now strips a relative clause before
  its verb test. **Landed** in `paid-content.ts`, `readiness.ts`, `reader-evidence.ts`,
  `editorial.ts`, with the URL threaded through `ReaderSource`, `loadBriefs` and the alert `loadEvents`.
  **Measured after** (`npm run audit:reader`, 250 live events, 2026-10-18): body openings **14 asked, 8
  kept, 6 refused**; `context-dependent openings 0`; **`delivered with no body` 0** and **`refused then
  published` 0** (was **1**); cost **one** story withheld (5 → 6) while stories publishing a body rose
  43 → 40 publishing nothing (i.e. three more publish). The first run of the page rule refused **five
  readable singular-pronoun openings** (`He created celld …`, `However, it also stated, …`); the judged
  kinds were narrowed to plural / demonstrative / document and the case is pinned in a test.
  `npm run audit:alerts`: **2 of 218** alerts now read **`gate paid-content`**, the two advertorials, and
  no other alert changes class. Full record:
  [decisions/paid-content-and-page-openings.md](decisions/paid-content-and-page-openings.md).

- **2026-10-18 — ruling #8: the briefing gate takes the alert floor's first class.** Reading tonight's
  briefing the way a stranger would (`scripts/briefing-preview.ts`, live pool, read-only) found one of
  its six cards was *"2026.42: Home At Last"* with `what_happened: "What is Apple Doing?"` — a
  personal-subscription newsletter's edition number and an internal heading presented as a development,
  importance 0, one source. It is the class the **alert** floor has refused since 2026-10-14
  (`personal-blog`, *"2026.41: It's Not You, It's Me"*), and the briefing gate had no rung for it.
  **Ruling (option 1):** extend the measured alert-floor classes to readiness one at a time, starting
  with the edition shape; the other four await their own briefing-pool measurement. **Landed:**
  `PERSONAL_EDITION_TITLE` (`/^\d{4}\.\d{1,2}:\s/`) in `readiness.ts`, kind `personal-blog`, the alert
  floor's own reason string. **Measured after:** ships **6 → 5**, withheld **27 → 28**, the one added
  entry is `[personal-blog] 2026.42: Home At Last`, the other five ships unchanged; 6 of 22,002 events
  carry the shape; the ruling's three precision controls stay eligible; 57 readiness tests pass. Full
  record: [decisions/briefing-floor-personal-editions.md](decisions/briefing-floor-personal-editions.md).

- **2026-10-18 — the backlog lane had zero slots, and that is why 25,323 articles were invisible.**
  Following the 2026-10-17 finding that **25,340 of 47,418 articles had no event at all**, the queue
  itself was read: `priority_articles_to_cluster` splits each batch into a live lane and a background
  lane, and the background lane gets `batch - live_slots`. `cluster.ts` passed `p_live_share: 1`, so
  `live_slots` was the whole batch and the background lane received **zero rows** — and since the live
  lane is also a demand lane (it joins `source_reader_routes`), an article from a source no reader
  follows had no lane that could ever select it. **Measured live before:** with the share at 1 the
  function returned **0 rows** while **405 unclustered articles sat inside its own 7-day window**; with
  the queue's own default (`5/6`) it returned **17**. **Landed:** `LIVE_LANE_SHARE = 5 / 6` in
  [cluster.ts](../src/lib/pipeline/cluster.ts), batch unchanged at 100, so the stage's cost per run is
  unchanged. **Verified in production:** `npm run pipeline -- cluster --limit 100` considered the 17,
  **1 joined an existing event**, 16 became events of one, `model calls 0`, 9 seconds; the queue offered
  the next 17 immediately and the in-window unclustered count fell **405 → 388**. A test pins the share
  below 1 and the batch at 100. Record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-backlog-lane-was-given-zero-slots--landed-2026-10-18).

- **2026-10-18 — ruling #9: the dashboard feed took its first floor class, and it is a deal.** Opening
  the live dashboard signed in, as a stranger, was the step that found this: *"Your nyuz found 13 things
  worth knowing"*, and four of the 13 cards were not developments — worst, *"Grab an RTX 5090 for a
  discounted $5,300 as part of an MSI Infinite ZS prebuilt gaming PC …"* (what happened: *"Best Buy has an
  MSI Infinite ZS in stock … for $7,599"*). All 13 titles pass `assessReadiness` **and** `assessAlertFloor`:
  the dashboard is gated only by the title/summary rungs, so a deal the alert path refuses was the reader's
  front page. **Ruling (option 1):** apply the alert-floor classes to the dashboard, one measured class at
  a time, keep the dashboard wider than the briefing, keep every story accessible, and require measured
  evidence per class. **Landed:** `isReaderDealTitle` in `alert-floor.ts`, used by `gateHomeFeed` — an
  explicit discount marker **and** a verb that asks the reader to obtain the object. The naive draft
  (acquisition verb + a price) matched **47 of 22,018** titles including three real news stories, and was
  rejected on that measurement; one instrument trap is recorded (a leading `\b` can never match before
  `$`, so `\b\$40 off` is dead code — the first version matched `% off` and missed `$40 off`).
  **Measured with the landed rule:** the dashboard's 13 cards → **1 refused** (the deal card); this
  reader's 1,000 matched titles → **2 refused**, both deals; all 22,018 stored event titles → **17
  matches**, every one a deal page. The Lego kit, the review and the mod card are untouched on purpose —
  that class ships separately, on its own measurement, as the ruling requires. **Second class, landed
  separately:** `isReaderModTitle` — an enthusiast modification (`modder`/`modded`/`modding`, or a bare
  `mod` followed by a verb of capability) — measured first at **11 of 22,020** stored titles, every one an
  enthusiast mod, **3 of this reader's 1,000** matched titles, and the live dashboard's card. The Lego-kit
  card and the flight-sim review stay: the ruling names two classes, and a review is not one of them.
  Record: [decisions/dashboard-feed-first-class.md](decisions/dashboard-feed-first-class.md). **One branch
  was missed and then fixed the same hour:** the first version gated only the `matches` path of
  `loadHomeFeed`, and the live read after deploy still showed the deal card — the dashboard renders
  `digest_items` whenever a briefing exists, so the ready/sent branch returned stored digest stories
  ungated. Both branches now run the same gate, pinned by a `story-flow.test.ts` case, and the deployed
  dashboard reads **11 things worth knowing** instead of 13.

- **2026-10-18 — the refusal counter had a second seam, and it was charged by the thin-evidence cap.**
  `audit:reader` read `refused then published 1` on the live window after ruling #9, and the row could
  only be one of two things: a real bypass in the composer, or a counter that was not measuring one run
  honestly. Reading the story settled it — **neither, in the sense that mattered: no gate was bypassed,
  and a fact that had already been published was charged as if a rule had withheld it.** The event
  (`129dba9a`, one usable fact, so the deck is the whole story) composed the deck correctly and the body
  assembly produced **four identical paragraphs**, one per entity the context pass wanted to introduce,
  every one of them the deck's own sentence; the thin-evidence cap (two blocks for a one-fact story)
  dropped two and charged the fact behind them — the fact the **deck had already published**. The gate
  already treats a deck restatement as a merge rather than a defect (that was D3's fix), but the cap runs
  **before** the gate, so it charged first and nothing could uncharge it. **Landed:** the cap charges one
  sentence at a time and only a sentence the surviving page (deck plus the blocks under the cap, read with
  the same `sentenceKey` identity) does not carry; a block that repeats the deck *and* adds a sentence
  still charges the new one, and the cap's refusal counts are unchanged. **Test red first:**
  `editorial.test.ts`, *"does not charge the deck's own fact to a duplicate block the cap drops"*, built
  from the live event's two sources — `expected 1 to be +0` on `renderedAfterRefusal` before the fix.
  **Measured on a frozen 200-event corpus** (`tmp/corpus-2026-10-18b.json`, `HEAD` vs this change): the
  whole report diff is **11 lines** — `refused then published` 1 → **0**, `refused then published by
  another path` 1 → **0**, and the fact listing behind them gone; everything else byte-identical
  (`selected = rendered + explained + unexplained` **1748 = 1600 + 148 + 0** both sides, `facts lost` 0,
  `sentences refused` 157, resemblance diagnostic 3). Live window after: **0**, ledger reconciling. Record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#d3s-second-seam--the-cap-charged-a-fact-the-deck-had-already-published-landed-2026-10-18).
  **Found and deliberately not fixed here:** the body assembly repeats one source sentence once per entity
  with no check that it is already on the page — machinery no reader saw (the gate merges the duplicate
  and the cap drops the rest), recorded so it is not mistaken for a prose defect. **Closed at the producer
  the same day**, in the entry below.

- **2026-10-18 — the duplicate-block producer is closed at the producer, not hidden by the rules that hid it.** The body assembly emitted one paragraph per entity the context pass wanted to introduce, all of them the same source sentence — four identical blocks on the live rugby story, hidden only because the gate merges a deck duplicate and the thin-evidence cap drops the rest, which is the same hiding that made the cap charge a published fact in the entry above. The pass is now `contextSplice` in [editorial.ts](../src/lib/editorial.ts), exported so a test can ask it directly, and it asks its question of **the page** (deck first, then the body) and refuses a candidate the page already carries by `nearDuplicate` — the gate's own identity for "the same text" — including what it has already spliced, so one sentence introducing two entities introduces them once. Its other rules are unchanged: a refused fact is final, the candidate is judged by the gate before publication, eight-block ceiling. **Red first, from the live event's two sources:** with the old producer restored the compose test fails at `expect(diagnostics.paragraphs.assembled).toBe(0)` with **`expected 2 to be +0`** (two duplicate blocks handed to the gate), and the direct-pass test fails with `expected [ { … }, { … } ] to have a length of 1 but got 2`; both pass with the change. **Measured on the frozen 200** (`tmp/corpus-2026-10-18b.json`, before = `HEAD`, after = this change): `sentences refused` **157 → 155**, `thin_evidence_cap` refusals **2 → 0**, `1748 = 1600 + 148 + 0` both sides, `facts lost` **0**, `stories publishing nothing` **58 (44 / 14)** both sides, `refused then published` **0**, `delivered with no body` **0**, reader-visible defects **0**. The 46-line diff was read line by line; the only reader-visible shape it moved is one Meta terms story whose quote-led block now stands alone (`the company said in a statement`) under a deck and a block that name Meta — `block opening with a quote 31 → 32`, `unresolved 0 → 1`, `confirmed defects` still **0** — recorded rather than argued away. Live window after: `refused then published 0`, `delivered with no body 0`, `facts lost 0`, ledger reconciling. Record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-producer-emitted-duplicate-blocks-closed-at-the-producer-landed-2026-10-18). **What this does not claim:** the 22 of 25 cards with no why-line are a corpus fact, not a rule gap, and nothing here adds a significance source.

- **2026-10-18 — the ladder gained one rung, and it is the only shape that measured precise: what a change binds, and when it starts.** The reader's briefing shipped **5 cards with 0 significance lines**; the rungs that could explain them are written by `analyse` (0/33 stored impact, 0/33 after-state), so the ladder had to be fed by code or the cards ship silent. Four shapes were measured over the whole enriched corpus (3,570 `article_evidence` rows, 3,455 events, every hit read by hand): any change-of-state verb, entity-guarded → **432 hits, ~1 in 5 defensible**; an effective-date sentence alone → **39, ~3 in 5**; an effective start **and** a verb that changes what a party may do → **15, ~1 in 2**; that tightened into the shipped rule → **5 hits, 5 of 5 defensible**. **Landed:** `bindingLine` in [inclusion.ts](../src/lib/pipeline/inclusion.ts), between the money consequence and the coverage count (the figure rungs it once sat above were removed on 2026-10-18, ruling #10) — it prints the story's own evidence sentence unchanged when it is an effective change (*"The ban, which went into effect on Thursday, restricts ads …"*, *"Kicking in on October 30, the TOS update won’t allow businesses to opt out …"*) or the story's own instrument imposing a duty (*"CERT-In's directions also require organizations to report cyber incidents to the agency within 6 hours."*). No model call, no new schema, no new caller input: it reads the evidence and title the ladder already receives and derives the event's names with `rankEntities`, the composer's own ranker. The guards are the rejected hits themselves — a change inside a relative clause (a definition, not a change), a dated reporting frame (when the story was told), a launch date (availability), a retrospective, first-person source voice, furniture, and a spec sheet or price. **Measured after:** `npm run briefing-preview` reads **`ships with no why-line 5/5 → 3/5`**, `rungs: none 3, binding 2`, `distinct why-lines 3/5` — the Meta terms card and the CERT-In advisory carry lines; **the preview now names the reason per remainder** ("no stored impact; no after-state; one publisher; 12 evidence units, none stating what a change binds or when it starts" for both RTX Spark cards). Commit census `scripts/reader-binding-census.ts` runs `reasonFor`, not the predicate, so instrument and production cannot drift. **Tests:** 33 in `inclusion.test.ts`, including the two live shapes, the ordering (money at stake still wins), the three near-misses refused, and **a card that must keep shipping unlined** (the RTX cards' real evidence asserted to `{ text: "", source: "none" }`); with the rung's candidate removed the round-trip test fails (`1 failed | 32 skipped`) and passes restored. Record:
  [decisions/significance-without-a-model.md](decisions/significance-without-a-model.md#the-binding-change-the-one-shape-that-measured-precise-landed-2026-10-18). **What this does not claim:** the dashboard card still renders no significance block (the 2026-10-17 ruling stands — this rung cannot explain most cards), and the yield is 5 events because every wider shape printed filler.

- **2026-10-19 — the session-start gap was the one process nobody had a skill for, and it has one now:**
  **`resume-session`**. Local `main` was **62 commits behind** `origin/main` and one commit ahead — `ce5b355`,
  whose upstream twin `372e184` had landed the corrected `src/lib/editorial.ts`; the local tree carried a
  duplicated `briefingText` import and a malformed `recoverCardSummary` body, so it was the pre-fix draft of a
  change that had already landed, not work to keep. The branch now sits on `origin/main` (`faa14b9`), with the
  old sha recorded here (it is in the reflog; the `backup/local-main-before-pull` ref used during the move was
  deleted after `HEAD == origin/main` was confirmed). **What the gap cost is the point:** everything the next
  session is told to read was on the far side of it —
  [handoff-2026-10-18-night.md](handoff-2026-10-18-night.md) (where the work stopped, and ruling **#12c**:
  reactivate eight sources for a bounded 30-day experiment through per-source exemptions, judged by three
  acceptance conditions; the exemption itself is **not** built),
  [reader-quality-10-of-10.md](reader-quality-10-of-10.md) (the four acceptance lines and the four commands
  whose exit status is the check) and the newest §6 entries. **Landed:** the skill in both required places —
  install fields and body in [skills/resume-session.md](skills/resume-session.md), installed copy at
  `~/.agents/skills/resume-session/SKILL.md` (frontmatter `name` + 479-character `description` + 5,208
  characters of instructions, inside the app's own limits) — plus the rule it encodes in
  [AGENTS.md](../AGENTS.md): **a session begins by syncing and reading, in that order**, and the install is
  checkable because it is a file. **Drift measured and recorded, not repaired by assertion:** three skills
  this repository describes as installed account-wide — `arbitrate-first`, `keep-context-current`,
  `reader-quality-loop` — are **absent from the account snapshot**: `current.json` under the account's
  `account-skills` directory held 39 skills on that date and none of the three. The repository half exists and
  the installed half does not; account (cloud) copies are a Settings → Skills action, the global file install
  is `~/.agents/skills/<name>/SKILL.md`. Nothing else changed, and nothing in the reader path was touched.

- **2026-10-19 — the first briefing built under ruling #11 still opened three cards on the wrong
  sentence, and the cause was two producers reading different material.** `npm run audit:delivered-line`
  read **FAIL 10 / 13** on the briefing delivered 2026-10-18T22:41:37Z — the only reader-facing line red
  at the start of the session (the other three acceptance lines read: `briefing:checkpoint` exit 0 with
  `ladder now: none 13`, `audit:surfaces` PASS, `audit:alerts-gate` PASS). The three survivors were
  bisected against their producers before any code was touched: **10 rows carried the composer's deck**
  (ruling #11 working), **2 the stored line**, **1 a recovered composition with an attribution frame** —
  and none was data drift, because all three events' `last_updated_at` (17:47, 14:02, 17:17Z) precede the
  build. `loadBriefs` in [digest.ts](../src/lib/pipeline/digest.ts) handed the gate each source as the
  article's `excerpt` alone, while the reader's page
  ([briefing.ts](../src/lib/server/briefing.ts) `articlesFor` → `enrichedEvidenceFor`) passes the excerpt
  **and** the article's `article_evidence` units, and the composer reads `enrichedEvidence`. Measured on
  the delivered rows before the change: gate opening equals page opening **10 / 13** excerpt-only,
  **13 / 13** with the evidence attached — the miss is exactly the three defects. **Landed:** the gate's
  source rows now carry `enrichedEvidence`, read in the same pass that already loads the unit texts for
  the inclusion ladder (no extra query). **Fail-before demonstrated:** with only that attachment removed,
  [digest-gate-material.test.ts](../src/lib/pipeline/digest-gate-material.test.ts) fails — *"the story the
  page can open was withheld"* — a story whose excerpt composes no deck and whose own evidence opens on a
  sentence that stands on its own is withheld as `unbriefable`; with the attachment it ships and its
  stored line is the page's opening, asserted against the page's own composition rather than a literal.
  8 affected suites / 150 tests green, typecheck and lint clean. **Not claimed:** the delivered briefing
  stays as delivered (archives are immutable) and the next build is the first under this fix; item 2 of
  the checklist (`ladder now` non-zero) is unchanged and its route is ruling #12c's source experiment.
  Full record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-gate-composed-from-a-different-input-than-the-page-2026-10-19-measured-and-landed).

- **2026-10-19 — ruling #12c's exemption is built, tested, and deliberately off; the migration that
  creates it cannot be applied from this checkout.** The slice had four required parts and three landed:
  **schema** — [0120_source_experiment_exemptions.sql](../supabase/migrations/0120_source_experiment_exemptions.sql)
  adds `source_exemptions` (one row per source: `experiment`, `reason`, `enabled`, `starts_at`, `ends_at`),
  service-role only (RLS on, no policies); a check constraint makes an open-ended window impossible
  (`starts_at` and `ends_at` are both null or both set with `ends_at > starts_at`), and the eight rows are
  seeded `enabled = false` so applying it changes no answer. **The gate** — `sources_to_collect` (same
  signature, same columns) now joins the table and answers `exempt: 12c-30d` for a released source instead
  of `no demand for N days`; ingest needed **no** change because it has always printed the gate's reason
  verbatim, so the experiment is visible in the selection surface without a second implementation of "who
  may be collected". **The test** —
  [source-exemptions-db.test.ts](../src/lib/pipeline/source-exemptions-db.test.ts) runs the migration on a
  real PostgreSQL (PGlite) holding the live gate's 26 withholds: applying it withholds all 26; starting the
  window releases **exactly the eight** with the other 18 still `no demand for 50 days` and the core source
  still `core`; past `ends_at`, or `enabled` with no window written, all 26 are withheld again. Fail-before
  was demonstrated by deleting only `e.experiment is not null` from the eligible expression — the middle
  block fails, the other two still pass. `npm run baseline:sources` gained a block printing every granted
  row with its window and the gate's answer, and reports `not applied on this database` instead of
  throwing when the table is absent; `npm run experiment:sources` (`--on` / `--off` / status) is the one
  command that starts or stops the bounded clock and prints the gate's answer afterwards.
  **Not done, and not a code gap:** there is no DDL credential here — no `supabase/config.toml`, no
  database password, no CLI access token, and the service-role key writes rows through PostgREST but cannot
  `create table`. Migrations in this repository have always been applied by hand in the SQL editor, so
  **0120 waits for that paste**; until then the tree is the contingency the request described — exemption
  present and off, `npm run experiment:sources` refusing with `Migration 0120 is not applied on this
  database`, and no feed moving. Baseline re-measured this morning, read-only: **79 active sources, 26
  withheld, all eight present and active**, **12,620 complete events / 161 with ≥2 publishers** (the
  2026-10-18 record was 153; the number grows on its own, so the comparison must be against a run taken the
  same day the experiment starts), ladder over the newest 60 live events: none 59 · consequence 1. The
  superseded 45-day window change is still unapplied and no archive was touched. **Landed:** the slice was
  committed as `2edb2b7` and pushed after a full local `npm run ci` on the frozen tree; the runner's jobs —
  including **Deploy to Cloudflare Workers** — all read success, so `main` is level with production again.

- **2026-10-19 — the wrong reason line is pure code: a weak keyword in a headline is enough to label a
  story, and it labelled a command prompt "AI".** The dashboard read recorded a topic-attribution smell —
  a Windows command-prompt story whose card reasoned *"You follow AI."* The checklist asked for its own
  measurement before any rule, and it now has one: `npm run audit:topic-attribution`
  ([reader-topic-attribution.ts](../scripts/reader-topic-attribution.ts)), which prints each card's
  reader-visible reason, the labels the event carries, and what the shipped pure function produces with and
  without the headline in the haystack. **Mechanism, no model anywhere in it:** `assignTopics` lists
  `"prompt"` among the AI topic's *weak* terms, the title rule labels on a single weak term in a headline
  (built so a real travel headline labels with no body mention), and the Register's headline is *"Windows
  command **prompt** puts in a surprise appearance"*. On the event's own rows the haystack has **no strong
  AI term at all**, and recomputing with the headline removed returns **nothing** — the label, and so the
  sentence the reader reads, rests on one ambiguous word. **Population** on the newest delivered briefing
  (`e9e485a5`, 2026-10-18T22:30Z, 13 cards): **4 reasons name a topic whose only evidence is one weak
  headline term** — #3 `Claude` via "Anthropic", #7 `AI` via "prompt", #11 `Chips` via "AMD", #12 `World`
  via "Global". **Widened to the delivered corpus the same day: the newest 20 briefings, 427 cards, 43
  flagged (10.1%)** — carried mostly by `Claude` (10) and `World` (7), with the AI case that started it 3 of
  43. The four are not equally wrong (#3 is arguably right), which is why the fix is a ruling and
  not a patch: four numbered options are recorded in
  [decisions/topic-attribution-reason-lines.md](decisions/topic-attribution-reason-lines.md), and **no rule
  was changed.** **Blocked on the arbiter, not on code:** the ChatGPT `nyuz` project could not be reached
  from this session — `chatgpt.com` is held at a Cloudflare interstitial in the browser panel's clean
  profile, and real-profile browsing (the route earlier sessions used) needs a Chromium-family default
  browser, which this machine did not have (LibreWolf was the default). **The route was then restored:**
  Chromium was set as the default browser and `browser.use_real_profile` / `browser.headed` re-enabled
  (headed is what gets past the interstitial), and `chatgpt.com` came up **logged out** — the profile's
  session had expired on 2026-09-21 — so the arbiter was still unreachable and the owner was asked to log
  in or relay. Those two settings and the default browser are the owner's to revert.

- **2026-10-19 — the dashboard's remaining classes were counted, and the tempting widening is not a
  class.** `npm run audit:dashboard-classes` ([dashboard-class-census.ts](../scripts/dashboard-class-census.ts))
  reads all 22,569 stored event titles and prints each count with the predicate that produced it. The two
  landed rules refuse 21 (deal: marker AND acquisition verb) and 12 (mod) titles. Price/discount-shaped
  titles are **122**, of which **105 carry no acquisition verb** — the population the two observed cards
  come from — and cutting those 105 by shape gives **40 that are price movement as the news** (*"Hyundai's
  all-electric hot hatch goes on sale in the UK"*, *"Anthropic's new Fable release is cheaper, less
  restrictive"*), **25 explicit discount deals** (the observed card, mixed with affiliate listings), **5
  coupon/promo-code pages** (the one clean shape), 1 review and 34 unclassified. The vendor-owned-blog
  shape is 12 sources and **175 events**, including engineering and research posts. **So the ruling has to
  cut a class out of that population, not take it whole** — a rule keyed on price alone would refuse a
  product launch, the same lesson the first draft of the deal rule learned (47 of 22,018 titles, real news
  included). Recorded in [decisions/dashboard-feed-first-class.md](decisions/dashboard-feed-first-class.md);
  **no rule changed.**

- **2026-10-19 — rulings #13 and #14 both landed: the headline's bar, and the coupon publishing frame.**
  #13 (got the arbiter from the owner's Chrome session): `assignTopics` now needs **two distinct weak terms
  in the headline** before a topic is assigned from weak evidence — the rule that read "Windows command
  prompt" as AI. Fail-before: with only the source change stashed, exactly the two new negative cases fail;
  with it, 45/45. Measured: the digest went **4 flagged → 0** (plus 2 cap-order, see below) and the newest
  **20 briefings / 427 cards went 43 → 0 flagged**. #14: `isCouponPageTitle` in `alert-floor.ts`, wired into
  `gateHomeFeed` and `audit:surfaces` — the publishing format, never the commercial subject — refuses
  **24 corpus titles, every one a coupon/promo-code page**; its first draft refused a product deal and was
  tightened, with that title pinned as a control. **Instrument correction, recorded because it changed a
  number:** the reason-line counterfactual can hit `assignTopics`' five-label cap, so labels that differ
  only by a tie-break are now excluded and counted (`capOrder`, 49 on the corpus) — the earlier "43 of
  427" was inflated by that flaw.

- **2026-10-19 — the owner pasted migration 0120, and ruling #12c's experiment is running.** The status
  read confirmed 8 granted rows, 0 honoured, before anything moved. The before-record was taken with the
  clock stopped (`npm run baseline:sources`): **12,733 complete events, 169 with ≥2 publishers**, ladder
  over the newest 60 live events `none 56 · coverage 3 · consequence 1`. Then
  `npm run experiment:sources -- --on` set `enabled = true` with a window
  **2026-10-19T06:46Z → 2026-11-18T06:46Z**, and the gate answers `exempt: 12c-30d` for all eight
  released sources while the other 18 still read `no demand for 50 days`. **Item 2's acceptance is items
  delivered after the first covering window**; until then the ladder is unchanged (`none 13` on the
  delivered set) and nothing else in that item is code.

- **2026-10-19 — ruling #15: the public pages now say what the product does.** A read of every route in
  `sitemap.xml`, taken as a stranger, found eleven defects; five were promise-level and went to the
  arbiter. **Languages** (terms promised "you can choose a reading language"; support says there is no
  language setting; how-it-works said preferences are stored) — ruled *change the pages*, and the sweep
  found the same promise twice more in the privacy policy and once in the providers table. **Telegram**
  (pricing gates it to Plura/Omni while the landing page, About and the commercial disclosure offered it
  to everyone) — ruled *plan-dependent*, pages changed, the plan matrix untouched. **Custom delivery
  time** — support no longer instructs Uno readers to operate a control only Plura and Omni have.
  **Team seats** — the acceptable-use page no longer advertises an entitlement that does not exist.
  **The operator's name** — `Vishal "goblin" Gurung` is now `Vishal Gurung` in the four pages that name
  the operator. **Deliberately not touched:** the privacy claim that providers process data in China,
  which the ruling put on its own footing pending a reading of the provider configuration — *"do not
  reconcile them by guessing"* — and the mechanical set (two names for one page, "At least 2 months
  back", "six stories" against a five-story cap, the noise labels, brand case), ruled a separate cleanup
  pass. Record: [decisions/public-site-copy-audit.md](decisions/public-site-copy-audit.md).

- **2026-10-19 — ruling #16: the provider table now names DeepSeek and China.** The item #15 left on its
  own footing needed the configuration read first, and the read inverted it: the AI provider **is**
  DeepSeek (`api.deepseek.com`), so the privacy policy's "including … China" is defensible and the
  *table* was the vague half. Also measured, and deliberately **not** turned into copy: `ai_usage_ledger`
  has no rows in the last seven days (newest 2026-10-01T06:24Z), so no reader data reaches the provider
  today — the ruling accepted that as operational evidence and explicitly refused to make it a legal
  disclosure that would go stale the moment a flag is flipped. The row now reads "DeepSeek (the default
  AI provider)" with the region "China for the default configuration. Routing can be pointed at another
  provider, in which case the region follows that provider." — the routing caveat is the ruling's own
  qualification, because the endpoint is database configuration.

- **2026-10-19 — the experiment was started and inert; the cadence was the second mechanism.** An hour
  after `--on`, none of the eight exempted sources had been fetched while ingest was demonstrably alive
  (other sources fetched at `08:00:10Z`, new events at `07:53Z`). Cause: all eight sit on the **`paused`**
  polling tier (**10080 minutes**), last fetched `2026-10-17T02:45Z`, so the cadence would not have offered
  them again until **2026-10-24** — while the gate answered `exempt: 12c-30d` for every one. Two mechanisms
  deciding one thing, and invisible from the operator's side: the experiment command printed eight released
  sources as designed. **Fixed** in `ingest.ts` by one exported pure function, `dueCadence`: a source whose
  gate reason starts `exempt` is due on the ordinary interval (60 minutes), everything else keeps its tier,
  and the tier row is left alone so the window closing restores the old behaviour by itself. Six regression
  cases in `ingest.test.ts`. **It cost the experiment five days of its thirty**, and it is why item 2's
  window now actually starts with the next ingest tick.

- **2026-10-19 — the mechanical copy pass the #15 ruling kept separate.** Five cosmetic defects, each
  corrected to make the page true: **one page had two names** (footer link *Subprocessors*, page headed
  *Service providers*, privacy using both) → **Service providers** everywhere, slug unchanged;
  `/pricing`'s *"At least 2 months back on an annual plan."* read as a date → **"At least 2 months free on
  an annual plan."**, keeping the figure `annualCaption()` derives and the repository's own wording
  (`plans.ts`: *"exactly two months free"*); the landing page's *"Most mornings that's six stories"*
  claimed one more than the free plan's **5** → *"five stories or fewer"*; the density dial labelled only
  two of its four bands under the track → **one label per band, over the track each band owns**, from
  `LEVELS`; and the brand case was **measured and reversed** — the landing page's five *Nyuz* were made
  lowercase, then the rest of the product was measured (**32 capitalised occurrences** in reader-facing
  strings), and the five were restored: the convention is a lowercase wordmark with capitalised prose. No
  price, plan limit or predicate moved. Recorded in
  [decisions/public-site-copy-audit.md](decisions/public-site-copy-audit.md).

- **2026-10-20 (the 22:30Z build) — item 1's instrument went green and the briefing was not readable.** The
  first build after ruling #11's fix, `4a6b2ad2` (25 cards, `sent`), reads **PASS 25/25** on
  `audit:delivered-line` — card line equals page opening — and **eight of its twenty-five cards carry a
  defect of a class the bar names**: four open on a reference the card never establishes ("None of them…",
  "The EBU…", "The authors…"), one story is delivered twice (Tom's Hardware and The Verge on the same
  AI-agents hack), two cards carry garbled text ("ot", "Character. AI"), three are thin, one title is
  truncated mid-word, one is a shopping deal. The duplicate's mechanism is measured: `sameStory()`'s figure
  guard rejects a pair when *either* headline carries a number the other omits, so a paraphrase can never
  pair — and that is also why the ladder reads `none`, since its `coverage` rung needs two publishers on one
  event. Catalogue, counts and two drafted rulings (#17 opening, #18 duplicate):
  [decisions/delivered-briefing-prose-defects.md](decisions/delivered-briefing-prose-defects.md).

- **2026-10-20 — the push rule, written after three red pushes with a green local gate.** Every slice had
  passed `npm run ci` locally and the runner failed all three at **`Coverage floor`**
  (`src/components: lines 29.15 -> 28.90`, 0.25pp): `scripts/coverage-ratchet.mjs` applies its 0.35pp
  portability band only when `GITHUB_ACTIONS` is not `true`, so the local comparison is lenient and CI's is
  exact. The owner's words: *"i got a ci fail so i dont want that happen next time"*. The rule now lives as
  the `publish-branch` skill ([docs/skills/publish-branch.md](docs/skills/publish-branch.md), installed at
  `~/.agents/skills/publish-branch/SKILL.md`) and in AGENTS.md's Git delivery section: gate with
  `GITHUB_ACTIONS=true`, on a **quiet tree** (a subagent editing mid-run produced a false red), never push
  on a red gate, and verify the run for the pushed sha afterwards. The coverage drop itself was fixed by
  code: the dial's label rule moved into `bandSpans()` in `src/lib/density.ts`, where it is tested.

**Rulings #17, #18 and #19 landed (2026-10-20).** The delivered briefing's prose defects were
implemented as deterministic rules, no model in any of them, and each has a test that is red on
`main`:

- **#17, the opening must stand alone.** `contextDependent` / `unresolvedContextOpening` gained the
  two ruled classes — a bare definite or quantified reference whose head the card's title does not
  establish (`None of them`, `The authors`), and a subject acronym neither the title nor the opening
  expands (`The EBU`). The deck walk passes `story.title`, so the repair is the decomposition's
  existing advance to the next qualifying candidate; a story with no candidate is withheld. The
  quote-carrying opening is now `quotationCarriesOpening` (the #10a class, widened to a long
  quotation handed over by a speech verb), which is what moves the Huntress card.
- **#18, one story must not arrive twice.** A new `security-access` marker group
  (`hack|hacker|hacking|break in|break into|broke into`), headline-only after the corpus showed a
  summary-only hit fuses the ShinyHunters arrest with the FBI message, lives in the **delivery**
  twin pass only; `sameStory`/`cluster.ts` are untouched. The delivered pair keeps **1 of 2** (the
  Verge card at position 03 suppressed).
- **#19, hygiene.** `sourceTypo` refuses the `ot` sentence; the sentence splitter no longer cuts a
  dotted product name and `readerSentences(text, names)` restores `Character. AI` to `Character.AI`
  only when the card's own entity list holds that name; the notification clamp backs off to a space;
  `thinStateOpening` withholds a copular/locative deck; and the briefing gate refuses the purchase
  shape (price + purchase frame + no event) through `isReaderDealTitle`.
- **The delivery boundary asks with the card's title.** Threading #17 through exposed a rule
  disagreeing with itself: composition asked `unresolvedContextOpening(text, title)` and the delivery
  boundary asked it with no title, so 4 of 200 live cards had a composed deck the boundary then
  refused (`ITV`, `USB`, `AWS` — abbreviations the title carries). `deliveredSummary`, `deliveredLine`,
  `deliveredTranslatedLine`, `opensAsReport` and `reportingLeadOf` now take the card's title, and the
  three briefing call sites and the digest call site pass it. Measured after: the window reads
  183 / 183 with 0 defects.

Measured 2026-10-20, on the delivered briefing `4a6b2ad2` (25 cards, Node 22), and the live corpus:

```
npm run audit:delivered-rulings   suppressStoryTwins -> 24 kept of 25 (the Verge card at #3)
                                  suppressStoryTwins(03,04) -> 1 kept of 2
                                  unresolvedContextOpening REFUSED on #00 (EBU) #01 (None of them)
                                    #15 (The authors); ruling #19 classes: #02 source-typo,
                                    #05 #14 #18 thin-state, #19 quote-opening
                                  a rebuild keeps 20 (twin 1, thin-state 3, deal 1 = #21), and
                                  20 / 20 kept cards keep line === page opening
                                  as delivered vs built now: 18 / 25 equal
                                    (#00 #01 #02 #08 #14 #15 #19 differ)
npm run audit:twin-corpus         30 days, 16,715 events, 119 headlines carrying the new vocabulary,
                                  272 pairs newly fused, 48 fused before it as well,
                                  0 new fusions below the ruled floor -> PASS
                                  1 pre-existing fusion below it (FBI / Dutch-police ShinyHunters
                                  pair, fused by the PRIMARY-entity + shared-figure branch, not by
                                  this widening) — reported as a finding, not tuned here
npm run audit:delivered-line      the ARCHIVE reads 16 / 22 as delivered, 22 of 25 if built now:
                                  FAIL, and expected — its 25 stored lines were composed by the old
                                  rules, so the 6 cards the rulings change (#00 #01 #02 #08 #15 #19)
                                  now disagree with it (CEO note on the card, 2026-10-20)
npm run audit:delivered-line:window
                                  200 live events, 183 decks, before ruling 106 / 183,
                                  after ruling 183 / 183 -> PASS, 0 defects
```

The card count in a rebuilt briefing is 20 of the 25 archived items, not 24: the ruling's own #19
removes three thin cards and the deal gate one more, and a real build fills the freed slots from the
live pool. That is reported as a finding, not tuned. The archived briefing's 22-of-25 is a read of
rows written before the rules existed; it is not the acceptance, and a build after this change is
the population the acceptance is taken on (the window read above).

- **2026-10-20 — the fourth dashboard class is measured, cut, and wired into the gate.** The first-party
  celebration (the live dashboard's *"RTX Spark Ignites Global Celebration as New Windows PCs Arrive"*)
  cannot be cut by its title: measured over **23,539** stored titles the celebration lexeme alone refuses
  **29**, and **26 of them are news** — including *"Grace Hopper Celebration canceled two weeks out as
  AnitaB.org runs short of funds"*, a development a reader needs. Nor by its source: **20 `company_blog`
  sources carry 354 events** and the same population holds **49 launches** and **46 engineering/research**
  posts. The class is both arms — celebration frame **and** every carrier a `company_blog` — which measures
  **3 refusals**, all first-party celebrations, **0** of the 49 launches, **0** of the 46 engineering posts,
  **0** of the 26 celebration-shaped news titles, and **2** of this reader's 5,841 matched cards. Two
  measured causes explained why the card rendered: `gateHomeFeed` passed no coverage to `assessReadiness`
  (so every first-party rung failed open on the dashboard), and `CELEBRATION_TITLE` only sees
  `celebrating … our` community posts, not the noun.
  **Wired 2026-10-20 on `wt/wire-celebration`** as the fourth clause of the one `gateHomeFeed` chain:
  `articlesFor` now selects `sources ( name, kind )`, `Story.sourceList` gained an optional `kind`,
  `hydrateEvents` carries it, and `sourceKindsOf(story)` fails open on unknown carriage. The gate pin in
  [story-flow.test.ts](src/lib/server/story-flow.test.ts) reads **both** dashboard branches and keeps every
  control (launch, repricing, partnership, engineering, celebration-shaped news), and the story page still
  opens the refused card. The census re-run after the wiring is unchanged — 3 refused, 0 in each control
  column — because a gate clause does not move a predicate. Predicate, 13 tests and the replay
  (`scripts/vendor-celebration-census.ts`) came from PR #26 (marked *do not merge*, conflicting after #27);
  `readiness.ts`'s `isFirstPartySource`/`CELEBRATION_TITLE` still want converging, and that is forge's file.
  [decisions/vendor-celebration-class.md](decisions/vendor-celebration-class.md)

**The twin floor was clearing pairs on capitals that select nothing (2026-10-20).** Ruling #18's
acceptance floor — "a suppressed pair must also share a capitalised entity and three content words" —
was measured against the rows it exists to judge, and both legs were accepting evidence that is not
evidence. `src/lib/pipeline/twin-floor.ts` now holds the floor (the census reads it, the suite asserts
it): a capitalisation counts only where it **discriminates** (mid-title, in a headline that is not Title
Case, and not a function word), with the other side's capitalisation as corroboration; and the
content-word leg carries its own `FUNCTION_WORDS` on top of the shortlist's `STOPWORDS`, so `and`, `the`,
`for`, `but` and their siblings are not content. It is *not* added to `STOPWORDS`, which
`duplicates.ts` and `titleTokens` also read — that would narrow the delivery pass, and a ruling is not
this branch's to make. The delivery pass, `sameStory`, `sameIncident`, `cluster.ts` and every #17/#19 rule
are untouched; `npm run audit:delivered-line` reads identically to `main` (`15 / 22` as delivered, `22`
of 25 built now), which is the evidence for that.

The card's premise did not survive the rows: `suppressStoryTwins` on the stored Plex2Shell /
BeyondTrust pair (summaries included) keeps **1 of 2** — it fuses them — so F18-1 was the instrument *and*
the pass, not only the instrument. The 2-of-2 in the earlier note came from a probe with invented
summaries. Measured after the tightening:

```
npm run audit:twin-corpus  30 days, 16,828 events, 119 headlines carrying the vocabulary
                           272 pairs newly fused, 48 fused before it as well
                           164 newly fused pairs below the floor -> FAIL
                             (entity leg only 56, content words only 75, both 33)
                           19 pre-existing fusions below it (was 1 under the lenient legs)
```

Every one of the 164 is listed with the anchors it was fused on in
[decisions/twin-floor-below-floor.md](decisions/twin-floor-below-floor.md); the reading and the four
numbered options are in [decisions/delivered-twin-floor.md](decisions/delivered-twin-floor.md). **No
floor was loosened, no vocabulary narrowed, and the census is red on purpose** — whether the delivery
pass narrows to the bar, or the floor becomes a report rather than a gate, is an arbiter question. The
pair is pinned in both directions so neither side can be "fixed" by moving the other: the floor refuses
it (`twin-floor.test.ts`) and the pass still fuses it (`it.fails` in `duplicates.test.ts`).

**The three rules did not spend the read path's budget; the gate's cost moved a day earlier (measured
2026-10-20, re-measured and corrected 2026-10-21).** Rulings #17/#18/#19 (PR #27), the twin floor (#28)
and the celebration wiring (#29) run on
every card, and the question was whether they spent the ~710 ms grace the build's stages are measured
against. A new read-only instrument answers it with numbers: `npm run timing:read-path`
(`scripts/reader-read-path-timing.ts`) times `selectStage` / `screenStage` / `gateStage` / `writeStage`
with `process.cpuUsage()` per phase and for every brief inside the gate, and `--freeze` writes the
screen/gate/write inputs so two worktrees read the identical corpus (`--replay` needs no database).

Measured on `640a69b6` — the 22:30Z reader that carried the CPU work: **1,000 live matches → 133
eligible → 37 considered → 33 after twins → 25 shipped**, cap 25 — Node 22, one frozen pool, **six
matched alternating cold processes per tree** (a tick is a cold invocation), medians:

```
phase                                    before #27 (3e6c5f6)   main 3ee81ae   delta   ±spread
screen · suppressStoryTwins                            459.2ms        450.8ms   -1.8%    15.9%
screen · suppressDeliveredTwins                        445.5ms        443.2ms   -0.5%    14.4%
gate · assessReadiness                                9621.9ms       9318.7ms   -3.2%    16.1%
  one selectReaderEvidence pass (the gate runs two)   1673.2ms       1678.2ms   +0.3%     9.4%
write · payload                                        217.4ms        179.1ms  -17.6%    40.1%
total, every row                                      12457.1ms      12046.2ms   -3.3%    13.1%
per-brief gate median                                   193.1ms        192.9ms   -0.1%
per-brief gate p95                                       795.7ms        815.9ms   +2.5%
paired per-brief ratio, median of 6 pairs, 33 briefs each     0.998  (0.969 – 1.018)
```

Every phase sits inside its own run-to-run spread, and the paired ratio — the same brief timed on both
trees in the same minute, which cancels machine noise — is **0.998**. The new predicates' own self
time in a `--cpu-prof` of the same replay is single-digit milliseconds each — `unexpandedAcronymOpening`
12.1 ms, `restoreDottedNames` 8.4, `thinStateOpening` 6.5, `bareReferenceOpening` 3.4, `markersOf` 2.0
of a 10,219 ms profile — and the dashboard's per-request predicates are **0.27 µs**
(`isVendorCelebrationTitle`) and **0.64 µs** (`isReaderDealTitle`) per title. **No rule from
#17/#18/#19 spent the budget; nothing was weakened, and no production code changed.** The one
behavioural difference on the corpus is the intended one: the widened twin vocabulary drops one more
pair (34 → 33 briefs).

**The instrument's first version was wrong, and the fix moved a row by 3×.** The first run of this
script dropped the gate's own `opening` on the way to the payload (`gate()` returned `ready`/`cpu`/
`perBrief` but not `openings`, so `writePayload` received `undefined`), which made every shipped brief
re-compose its opening from scratch inside the write — work production does not do, because
`writeStage` reads the gate's opening back from `progress.verdicts` (digest.ts:1487-1491). Both trees
were measured with that bug, so the comparison stayed fair but the row was inflated (**647 ms → 217 ms**
once fixed, and the payload 2,340 → 5,851 bytes, because the recovered compositions were shorter than
the gate's own sentences). The lesson recorded for the next reader: a phase that re-does work an
earlier phase already did is a defect in the *instrument*, and it is invisible on a relative comparison
because both sides carry it.

**What the measurement did find is an older move, and it changes the budget reading.** A cold live
build now costs **8.2–12.4 s of CPU** across runs — select 1.26 s (`loadMatches` 164 ms,
`alreadyBriefed` 28, `selectItems` 35, `suppressDeliveredDuplicates` 968), screen 1.29 s, gate
5.5–9.8 s, write payload 0.18–0.22 s — with the gate's per-brief median **123–210 ms**, p95
**487–816 ms**, worst **1,021 ms**, against the recorded 6.4 s / median 18 ms / worst 435 ms. The
cause is not #17–#19: commit `449f979` (2026-10-19, *"Compose the gate's opening from the same
material the page reads"*, ruling #11) attached `article_evidence` to the gate's sources. Replayed
with the evidence stripped, the same 33 briefs gate in **2,863–4,719 ms at a 7–16 ms median** — the
recorded shape — and with it attached, **~9.3 s at ~193 ms**. The gate also runs `selectReaderEvidence`
**twice** per brief (readiness.ts:641 for the fact count, then the composer at editorial.ts:3031 after
normalization); one pass is **1.67–1.68 s** of the gate, which is where a bounded optimization would
go if the spend is to come back. Nothing was changed here: the attachment is a reader-facing quality
fix (it took the delivered page/card match from 10 of 13 to 13 of 13), weakening it is a ruling, and
deduping the selection needs the normalization shared before it can be proved identical. **Budget
reading now:** one gate brief per tick (`GATE_BRIEFS_PER_INVOCATION` 1) at a 123–199 ms median fits
the ~710 ms grace, but the p95 and the ~1 s worst do not, so the largest stories can still cost a gate
tick. Replay:

```
nvm use 22
npm run timing:read-path -- --user 640a69b6 --runs 3
npm run timing:read-path -- --user 640a69b6 --freeze pool.json
npm run timing:read-path -- --replay pool.json --runs 6 --json after.json
```

**2026-10-21 — the delivery-time decision: there is no single 22:30Z build, and the lateness is the
clock.** A decision task asked whether the briefing should be built once, in timezone bands, per
reader, or at read time. Measured read-only against the live project and written up in
[decisions/briefing-delivery-time.md](decisions/briefing-delivery-time.md): the scheduler already
writes one digest per reader per day at `send_at` resolved in their own zone (`digest.ts:587-601`,
`schedule.ts:39`). The live rows are 3 readers, `07:30` on every one, zones `UTC ×2` and
`Asia/Tokyo ×1`, so **2 instants** — `07:30Z` and `22:30Z` — and every reader's slot reads 07:30 on
their own clock; a 07:30-local briefing has **35** distinct UTC clock times per day across 418 IANA
zones (37 offsets; measured with `Intl`, same day), so a three-band design would coarsen what already
runs. The cited
build `3fcbb21c` (2026-10-20T22:30Z) ran 22:20:33→22:55:38 (**35m05s**), wrote 1 digest, 25 items and
2 deliveries (push sent; email 401 by owner ruling), and landed **1,543 s late**; the three builds
before it read 1,722 / 702 / 1,789 s. `npm run timing:read-path` on the same pool measures
**8,690 ms of CPU per build** — gate 5,832 ms (67%), per-brief median 131.6 ms, p95 498.7 ms, worst
508.3 ms. **The lateness is arithmetic, not scheduling:** 33 briefs ÷ `GATE_BRIEFS_PER_INVOCATION` 1 =
~35 ticks from T−10. `BATCH = 8` builds on one instant would cost 1,053 ms against the ~710 ms grace,
so a shared instant carries 5 readers at the median and 1 at the p95 — the launch ceiling, and one
bands cannot raise because the 37 instants already exist. Recommendation: keep B (already shipped), fix
the signup `timezone` default (`0001_init.sql:38/55/263` inserts `'UTC'`; only onboarding overwrites
it, `prefs-store.ts:76-85`), and make `lateness_seconds ≤ 600` (today 1,543) with gate p95 ≤ 140 ms
(today 498.7) the acceptance numbers before any band is built. **No product code, migration or deploy
was changed.**

**2026-10-21 — the design audit's should-fix findings are specified for the two implementers.** The
audit's ten numbered should-fix entries (S1–S10) are now
[design-spec-2026-10-21.md](design-spec-2026-10-21.md), each with the measured defect and its capture,
the intended reader outcome, the smallest change (element, reused token or component, what must not
move), an acceptance number a verifier can run, and an owner. All ten are specified although the brief
said nine: the audit carries S1–S10 and the CEO's summary paragraph had named only S1–S8. Ten findings
collapse to eight implementation units — S7 is the only one that splits (the WCAG-failing 46 × 19
dismiss control must land; the 32 × 32 feedback toggles are deferred with the audit's own trigger) — and
two units (S8, S9) are arbiter-gated with numbered options and a recommendation. **No product code, no
deploy, no merge.** Docs only.

Three corrections to the audit, made while writing it and stated here rather than silently:

- **S4's "four months visible, nine hidden" is the 360 case.** The committed 1280 capture
  (`archive-months-1280.png`) is **977 × 57 px** and shows ten full labels plus the clipped eleventh, so
  **three** months are hidden at 1280, not nine; the 360 capture (`313 × 57`) is the ~three-label window
  the audit's sentence describes. The defect stands; the desktop figure in the audit and in the entry
  above overstates it.
- **S6's ≈36 rem would land the story body at ~94 cpl** — the feed's own worst line. The spec uses
  **34 rem / 544 px** (~89 cpl body, ~72 deck) so the article sits inside the product's 85–94 band rather
  than at its edge; the arithmetic is in the spec, from the audit's own 109-characters-in-669-px measure.
- **P3 is withdrawn.** Small-uppercase `h2` group labels are the product-wide convention
  (`delivery.tsx:420`, `settings.tsx:482`, `install-section.tsx:59`, `pipeline.tsx`), so changing only the
  alert history would create the drift the polish item was raised to prevent.

Two things the spec adds that the audit did not have: the archive's day labels skip `H1 → H3` as well
(`history.tsx:234`, one class, carried by rook's archive slice because that file is already open in it),
and a **collision map** — `src/components/briefing-preview.tsx` is edited by B1/B2 (rook) *and* by S2
(forge), so the blockers land first and S2 rebases. S8 (the briefing claiming an inbox delivery email
does not perform) and S9 (two unexplained score scales) may not be implemented before the arbiter's
ruling is recorded in `docs/decisions/`.

**2026-10-21: the landing page says what nyuz covers, and the positioning line became
"a personalized information briefing" (owner-ruled).** Two changes, both measured.

*The new section.* "What nyuz covers" — eyebrow, the two-line headline *"Not just what's in the news.
What matters in your world."*, an intro paragraph, and a 2×2 hairline grid of the four areas nyuz
watches: news and world events / technology and projects / research and ideas / music, film and culture.
It sits **between the hero artwork and the topic demo** (the owner's placement), because the demo is
the proof of the breadth claim and the visitor should know the breadth before being asked to pick from
it. `src/components/landing/coverage.tsx`, registered as the `coverage` key in `SECTION_KEYS` /
`SECTION_LABELS` / `SECTION_COMPONENTS`.

*The position is the fourth edit, and it is the one that fails silently.* The landing page's section
order is not in the code — it is an ordered list in `site_settings.landing.sections`, because order is
an editorial decision. `normaliseSections` **appends** any key the stored row does not mention, so
shipping the key alone would have put the new section below the closing call to action, with no error
anywhere. `supabase/migrations/0121_landing_coverage_section.sql` rewrites the stored list to insert
`coverage` first, preserving every other section's order and its `enabled` flag, and is safe to re-run.
`src/lib/landing-coverage-section.test.ts` proves that against real Postgres (PGlite): the new key
first, the rest in their prior order, a hidden section still hidden, an operator's own reordering
preserved, and a second run not duplicating the key.

*Measured.* Page height 10,062 → 11,028px at 1440; sections 10 → 11; horizontal overflow **0** at
1440 / 655 / 390px. The grid's four cells measure identical (152px, two-line bodies) — the first draft
had a one-line bottom-right cell that left a visible hole in the equal-height grid, fixed by rewriting
that sentence rather than by padding it. The copy carries no numeral, and every clause is checkable
against the seeded sources: research = the five arXiv feeds + Berkeley AI Research, open source and
releases = the eleven GitHub release feeds, company updates = the 19 `company_blog` sources, music and
film = the seeded entertainment sources.

*The positioning line.* The owner ruled **"a personalized information briefing"** over **"a
personalized news briefing"** (the question left open in
[homepage-and-home-feed-design-plan.md](homepage-and-home-feed-design-plan.md)). The reason it is true
rather than aspirational: the topic taxonomy is 35 labels wide (`src/lib/topics-pool.ts`) and the
seeded sources include arXiv, GitHub release feeds, vendor blogs and product changelogs, so "news"
undersells what nyuz watches. The wording shipped in `SEO_DEFAULT` (`src/lib/site-content.ts`), in the
root meta description and og:description (`src/routes/__root.tsx`), and in §1 of this file. **The live
`site_settings` table holds only three rows (`site.access` and two AI caps) — there is no stored
`site.seo` row**, so the bundled fallback is what the live site serves and a code change alone ships
this; the console has no stored override to fight. What it does not claim: that nyuz is a platform
where readers share information with one another, or that it covers every category comprehensively.
The loop — watch, merge, match, deliver — is the product; the breadth is what it watches.

**2026-10-21, later: the route-walk e2e test was over its timeout budget. The cause was a duplicate
page load, and the fix is at the cause.** The 2026-10-21 landing work left `npm run ci` red, because
`e2e/smoke.spec.ts` ("a route walk never serves a broken asset") timed out at 30s. **It was not
caused by the landing work**: the same test fails at baseline on a *different* route each run, which
is the signature of a shared budget expiring rather than one slow page.

**The real cause, found by independent measurement after this entry was first written wrong.**
`blogIsAdvertised` opened `/` with its own `page.goto(..., networkidle)` to read the nav link, and the
walk then opened `/` **again** as `PUBLIC_ROUTES[0]`. Two full cold landing-page loads, one of them
redundant — instrumenting 21 navigations across three walks showed those two were **33–52% of the
walk's total in every run**. The fix is to read the link during the walk's own visit to `/`, with
`watch()` attached *before* the first navigation so the landing page stays inside the asset check.
`test.setTimeout(120_000)` stays as margin, not as the fix.

**Two claims in this entry's first version were false and are corrected here.** (1) `/manifest.webmanifest`
is **never fetched during the walk** — zero requests across three walks and two fresh contexts; the
4,092 ms cold figure belongs to the *installability* test elsewhere in the suite. (2) There is only
**one** cold start, not seven: only the first navigation pays workerd's first-request cost (~2.2 s).
The "40.5 s here vs 45.6 s at baseline" comparison was also noise — interleaved three-round runs gave
baseline 43.5/47.6/72.9 s and this tree 49.7/65.6/67.2 s, sign flipped, same-tree spread 48.5–65.8 s
on a box at load average 22–43 on 4 cores. A single duration on a loaded machine is not a measurement.
What is measurable: both builds have an identical chunk-name set, 38 preloads, 139 asset files and
**zero new requests** — +1,866 bytes JS (+0.24%), +2,290 bytes HTML. The section cannot account for
seconds. Full record, including the false mechanisms, in
[decisions/e2e-route-walk-timeout.md](decisions/e2e-route-walk-timeout.md).

**`networkidle` was not weakened.** `watch()` counts a `requestfailed`, which fires on an **aborted**
request, so ending a navigation early aborts the next page's own requests and reports them as broken
assets — turning a slow test into a false one.

**And the gate was proven still to bite.** Moving `public/nyuz-readers.png` away (so the build no
longer emits it and the request 404s) makes the test **fail** with
`404 http://127.0.0.1:8788/nyuz-readers.png`; the file was restored byte-exact. A second control via
a manual `wrangler dev` against a pre-built `.output` confirmed the same, with one caveat now recorded:
when the missing asset is a **JS module** the test fails with "navigation interrupted by another
navigation" rather than a clean 404 list, so the walk only cleanly proves missing **non-module**
assets. The `webServer` trap stands: `npm run build && wrangler dev` **overwrites `.output/`**, so
break a file in `public/`.

**Do not `git stash` in the shared worktree.** Other agents use it; stashing mid-investigation resets
the tree under them, which happened on this date and cost a peer their working state. Baseline with
`git worktree add /tmp/nyuz-baseline origin/main`.

**`npm run lint` was also red, on another agent's probe.** Three Prettier errors in
`.worktrees/t_5abaeb9d/scripts/_f18probe.ts` — a file belonging to a different session, untracked and
never committed, but walked by `eslint .` because a worktree is a full checkout of the repo. A fresh
CI checkout has no `.worktrees/`, so the runner never sees it; only a developer machine does. Added
`.worktrees/**` to the ignores in `eslint.config.js`, which already ignored `tmp/**`, `.scratch/**`
and the Playwright artifact directories for the same class of reason.

**2026-10-21, later still: three reviewers read the landing work, and two of them found real
defects.** The route-walk fix and the positioning change went out for review rather than straight
to a PR, and that was the right call — here is what the review changed.

**Scout (root-cause) refuted the mechanism I had written down and found the real one.** My
explanation of the e2e timeout was wrong in three places, and the doc recorded the wrong
explanation rather than a vague one. (1) `/manifest.webmanifest` is **never fetched during the
walk** — zero requests across three instrumented walks; the 4,092 ms cold figure belongs to the
installability test elsewhere in the suite. (2) There is only **one** cold start, not seven. (3) The
"45.6 s baseline vs 40.5 s changed" comparison was **noise**: interleaved three-round runs gave
baseline 43.5/47.6/72.9 s and this tree 49.7/65.6/67.2 s — the sign flips, and same-tree spread was
48.5–65.8 s on a box at load average 22–43 on 4 cores. A single duration on a loaded machine is not
a measurement. The real cause was a **duplicate load**: `blogIsAdvertised` opened `/` to read the nav
link and the walk then opened `/` again as `PUBLIC_ROUTES[0]`. The two navigations were 33–52% of
the walk's total in every run. The link is now read during the walk's own visit to `/`, with
`watch()` attached before the first navigation so the landing page stays inside the same asset
check. **Measured after the fix: 18.9 s, down from 43–73 s** — an idle-box number, and the doc says
so. `test.setTimeout(120_000)` stays as margin, not as the mechanism, and `networkidle` is still not
weakened.

**Scout also caught that the positioning change would not have reached a seeded database.** `/`
reads its description from the **stored** `site.seo` row, and `SEO_DEFAULT` is only the fallback for
a database without one. `0003_admin.sql` seeds that row and `0004_landing_copy.sql` rewrites its
description — so editing `SEO_DEFAULT` alone left every seeded environment serving a description
that said "nyuz watches hundreds of sources" (a countable claim about a number that moves weekly) and
none of them saying "information briefing" at all. Measured on the live project: there is **no**
`site.seo` row (the table holds `site.access` and two AI budget keys), so the live page serves the
bundled default and reaches production from the code change alone — but the seeded path needed its
own change, so **`0122_site_seo_information_briefing.sql`** updates the stored description **only
where it still holds one of the two values this repository has ever written**. An operator's own
edit in `/admin/content` matches neither and is left alone: the stored row is an editorial decision,
and a positioning sweep is not licence to overwrite an editor's words. The title is deliberately
untouched — the brand line is not a positioning claim.

**The coverage floor would have caught the new component too, and it was nearly right for the wrong
reason.** `vitest.config.ts` instruments every file under `src/**` (`all: true`), so an untested
123-line component counts against the floor. The repo has no jsdom and no `.test.tsx` anywhere, so
the fix is the pattern its own component tests already use: `renderToStaticMarkup(createElement(…))`
in the node environment. `src/components/landing/coverage.test.ts` pins the four areas in order,
asserts that **no decimal digit** appears anywhere in the rendered text, and asserts the copy never
widens the product into a place readers share with each other. Both assertions were **proven to
bite** by injecting a defect and watching them fail — a number in the copy, and a "share with the
community" phrase — rather than assumed.

**Three smaller things, all fixed.** The walk's comment said "seven routes" when it is six plus the
blog; the new code depended on `PUBLIC_ROUTES[0] === "/"` with only a comment enforcing it, so a
reordering would have silently dropped `/blog` out of the walk — a gate quietly covering less, now
one `expect` line loud; and `.worktrees/` was not gitignored, which is the *cause* of the lint
failure that the eslint ignore was only treating as a symptom.

**Two of my own mistakes, recorded.** The `docs/context.md` line claiming the new phrase "was swept
across every public meta description" was false for a seeded database and is now qualified. And
`npm run lint` was red for a reason that had nothing to do with this work: three Prettier errors in
`.worktrees/t_5abaeb9d/scripts/_f18probe.ts`, another session's probe, untracked and never
committed, but walked by `eslint .` because a worktree is a full checkout of the repository. A fresh
CI checkout has no `.worktrees/`, so the runner never sees it; only a developer machine does. Fixed
at the cause — `.worktrees/` is now gitignored — and at the symptom, with `.worktrees/**` in the
eslint ignores alongside `tmp/**`, `.scratch/**` and the Playwright artifact directories.

**And `hookTimeout` was never raised with `testTimeout`.** The vitest config's own comment names
the evidence — "three PGlite `beforeAll` hooks" timed out in a coverage run — but a `beforeAll` is a
HOOK, and `hookTimeout` was left at vitest's 30 s default, so raising `testTimeout` did not help
those at all. Worse, the three migration test files each passed an **explicit** `30_000` to
`beforeAll`, and an explicit value **overrides** the config. PGlite's WASM start-up measured 26 s on
a loaded machine, so 30 s was marginal rather than generous. The config now sets `hookTimeout:
60_000` unconditionally — the start-up costs the same whether or not v8 is instrumenting, so gating
it on `measuringCoverage` left the plain `vitest run` with the *shorter* ceiling, which is backwards
— and the explicit per-file overrides are gone.

**Screenshots.** Upstream landed a policy on 2026-10-21 that screenshots are local evidence and are
never committed (`docs/screenshots/` in `.gitignore`). The five PNGs this work had staged under
`docs/design/` were removed from the tree for the same reason; the design comparison HTML stays,
because it is a document rather than a capture. Local copies are kept outside the repository.
**2026-10-22 — S9 lands: one reader-facing score scale, 0–10 with one decimal.** The CEO ruled
**option A** on 2026-10-21, recorded in [decisions/score-scale.md](decisions/score-scale.md) with the
case, the three options and the reason the two surfaces then agree by construction. The defect was one
stored number printed two ways: the story rail read **Relevance 100% · Importance 50% · Novelty 70%**
while `/dashboard/alerts` said **"Only events scoring 6 or higher interrupt you"**, and both are the
same 0–10 value (`asPercent` is `clamp(round(score * 10), 0, 100)`, `story.ts:73`; `IMPORTANT_FLOOR = 6`,
`alert-floor.ts:21`). Two edits, no new component and no data change: the rail's value span now prints
`{(value / 10).toFixed(1)} / 10` (`story-article.tsx:191`, so `50` reads **5.0 / 10**), and the alerts
sentence interpolates `${IMPORTANT_FLOOR.toFixed(1)}` so a literal threshold cannot drift
(`alerts/index.tsx:65`). Bars keep `width: {value}%` — lengths unchanged — as do the 1 px height,
`bg-muted`/`bg-signal`, the card chrome, the 12.5 px rows, `CARD_LABEL` and the chip row.

`src/components/dashboard/score-scale.test.ts` (8 assertions) renders the real `StoryArticle` and reads
the alerts route's sentence, because a defect of two disagreeing surfaces passes any single-surface
test: it pins `6.0 / 10`, `5.0 / 10`, `7.0 / 10`, no `%` in the card's text, `10.0 / 10` at the top of
the scale, the three bar widths, and the cross-check that the rail's Importance row for a story at the
floor reads the same `6.0` the sentence does — with `5.9 / 10` one decimal below it. **Failing-first,
measured:** with the two source edits reverted, 5 of the 8 fail; the 3 that still pass are the
"must not move" pins. `asPercent`, `importanceBand` and the stored scores are untouched. One surface
still carries the old wording and is recorded rather than changed — the support FAQ
(`support.tsx:48`, "Only events scoring 6 or higher interrupt you") — because S9's ruling named two
files and FAQ copy is a decision, not a tidy-up.

**2026-10-23 — Composer prose: jargon expands at first use, and the reason line names the narrow
interest (audit H-06, H-11, H-14, I-03).** Recorded in
[decisions/composer-prose-expansions.md](decisions/composer-prose-expansions.md). Two rules, both pure
code. (1) The body-admission guard `contextDependent` now receives the story title from every
body-admission call in `src/lib/editorial.ts` — measured cause on the live rows: the ranked body pass
called it without the title, so ruling #17's "the title establishes" never consulted the page, and the
sentences that place a page's key nouns were refused as `unresolved_context`: Terafab card d50c1236's
"ASML, the world's sole commercial supplier of the $400 million EUV lithography systems…" and the
H-11 card b8b0110f's three facts (ZenDNN, the x86 Ecosystem Advisory Group (EAG), the steering
member). A caller without the title still gets the stricter answer. The story-wide first-use acronym
expansion (`expandAcronymsFromEvidence`, already on main) then repairs the first bare use from the
story's own evidence. (2) `reasonExplanation` in `src/lib/server/briefing.ts` names the narrowest
matched interest measured at brief time: an interest outside BROAD_TOPIC_LABELS is a specific one and
is named; otherwise, when at least two pools matched, the pool whose cards over the delivered briefing
are least common is named; when the match spans the briefing's whole feed, the line reads
"You follow AI — this card is about <the card's other labels>"; when nothing narrows and the card
carries nothing else, the line is left off (it printed "You follow AI." for the eighth time). Measured
on the audit's delivered briefing fab11fdf (17 cards, real stored labels): 17 of 17 reason lines change,
no line is left saying only "You follow AI." (probe over `digest_items` + `event_topics` +
`user_topics`, 2026-10-23).

## 7. What is next

**2026-10-22: the reader's prose is now measured, and four blockers are unowned.**
[reader-clarity-audit-2026-10-22.md](reader-clarity-audit-2026-10-22.md) reads the deployed origin on the
three surfaces a reader uses and records **43 findings — 4 blockers, 26 should-fix, 13 polish**, every quote
machine-checked against the capture it came from. The blockers are all in the composed article, on the two
PHP-security cards (an opening date fragment, a "the leak"/"Calif" reference before either exists, a
chronology out of order, and one sentence no reader can parse). Its §8 routes each finding to the component,
instrument or ruling that owns it; the copy ones (headline voice, "DELIVERED", "Why it matters") go to the
arbiter with S8/S9 first. Nothing in it changes code or copy.

**2026-10-22: delivery recommendation 1 is implemented — the reader's zone now exists from the first row.**
`wt/signup-timezone` (no column added; both `timezone` columns already existed) makes `handle_new_user`
read the browser's zone from the signup metadata, corrects the metadata-less Google/GitHub and pre-0123
rows on the first authenticated load, and keeps `profiles.timezone` — the admin console's copy — in step
with the schedule row. The entry at the end of §6 records the three writers, the gates and the two-reader
07:30 measurement. It is **on `main`** — merged in
[#48](https://github.com/g0GobliN/nyuz/pull/48) at `49ccd8f` — and changes no build cadence. **Delivery
recommendation 2 is the one that is still open**: the 25-minute lateness
(`briefing_timing.lateness_seconds` 1,543 s measured 2026-10-20) is now the only delivery defect the
decision names, and it is a ticks-per-build problem, not a timezone one.

**2026-10-22: rook's four design-spec units are implemented and measured, and waiting on review.**
S3 + S4 (the archive's inert card and its hidden months) and S6 + S7 (the story's reading measure and
the install card's one 19 px tap target) are on `wt/spec-rook`, one commit each, with every acceptance
number read off a browser rather than inferred from a diff — the entry at the end of this file records
them, including the one acceptance band this slice could not meet and the arithmetic that explains it.
Nothing here is on `main`; the deploy path is untouched by it. S1 / S2 / S5 / S10 remain forge's on
their own branch, S8 still waits on the arbiter's ruling about the inbox framing, and S9 has its ruling
(option A, one 0–10 scale) and runs after S6 because it edits the same rail file.

**Where a session starts (2026-10-19).** Sync the checkout to `main` first, then read the newest
handoff ([handoff-2026-10-19-late.md](handoff-2026-10-19-late.md)) → this file →
[reader-quality-10-of-10.md](reader-quality-10-of-10.md), the acceptance checklist whose lines are
commands. The skill for it is `resume-session`; the entry at the end of §6 records why it exists.

**2026-10-21: the design audit's should-fix work is specified and waiting on its owners.**
[design-spec-2026-10-21.md](design-spec-2026-10-21.md) turns S1–S10 into eight implementation units with
an acceptance number, a collision map and two arbiter questions (the briefing's inbox framing, and the
two score scales). Order: S10 → S1+S2 (forge) → S3+S4 (rook) → S5 (forge) → S6+S7 (rook); S8 and S9 only
after a recorded ruling. Nothing in it is on `main`; the two blockers (B1, B2) are with rook and land
first because S2 edits the same component.

**2026-10-21: the briefing's two blockers are closed and measured, so the spec's units can start.**
B1 (a dead end: 25 stories, 0 links) and B2 (144 characters on a line) are fixed in
`wt/briefing-blockers` — PR #40, head `d3a9174`, runner green, **not merged** — and measured in the
entry at the end of §6. Re-measured on that head in Chromium (dev server, compiled stylesheet, Manrope
loaded): **25 anchors at 1280 / 768 / 360 / 320** in reading order with the authored focus ring, and at
1280 a 512 px card, a 454 px summary column and **median 68 / max 73 characters per line** against the
audit's 144. The spec's S2 is the next slice to touch `BriefingPreview` and rebases on this; S8/S9 still
wait on the arbiter.

**2026-10-20: gate 2's evidence ledger is built, and the verdict is ruled — two legs, one instrument.**
Ruling #12c's window (2026-10-19T06:46Z → 2026-11-18T06:46Z) is item 2's calendar, so the reading is now a
command: `npm run audit:significance-window` takes the window from `source_exemptions`, enumerates every
briefing generated inside it, re-derives the ladder per delivered item on `briefing:checkpoint`'s own
inputs, and persists the per-event evidence to `docs/audits/significance-window-12c-30d.json` (one copy
per event; delivery rows reference event ids). The documents stated two bars and on the same rows they
read opposite — the checklist's universal bar **FAIL 1/25**, ruling #12c's existence bar **PASS** (card
#08, whose line traces to Wired, one of the eight, fetched 2026-10-19T11:00Z). **The arbiter ruled the
question (ChatGPT `nyuz` project, #17, option 3; population narrowed by #17a after one cross-examination):
gate 2 is two legs, reported apart, and a PASS on one never makes the other pass** — Leg A universal
(every delivered briefing item carries its own justified line) and Leg B the experiment's existence
condition (one qualifying non-coverage line, traced, attributable to one of the eight). The ruling retired
the pre-close exit 0: `PENDING` exits **2**, a closed window exits 0 only when both legs pass, 1 when
either fails, 2 when evidence or population is incomplete. Today: **Leg A FAIL 1/25, Leg B PASS**, so
`gate 2 PENDING` (exit 2) now and `FAIL` exit 1 on today's rows once closed. The six definitions and the
ruling are recorded in [decisions/significance-window-instrument.md](decisions/significance-window-instrument.md);
what a PASS is now stated in [reader-quality-10-of-10.md](reader-quality-10-of-10.md). The 18 November
reading is still owed — the ruling makes it possible, not early.

**2026-10-18, last: the card line and the page opening are one sentence by construction (ruling #11).**
The producer-side fix below closed the quote-first class, but the audit of the same day found the seam
was wider than one producer: **54 of 121** delivered rows opened the card on a sentence the page did not
(43 genuinely different sentences, 11 attribution-framed), because the briefing build had no access to
the composer's sentence and `reportingLeadOf` hard-coded a candidate order the composer does not share.
The arbiter's ruling #11 chose **one source of truth at the delivered surface**: the briefing build now
stores the composer's own opening verbatim in `digest_items.summary` for every shipped item, keeps the
stored line only as the no-deck fallback, and composes nothing on the reader's request path. Measured on
the live window: **131/179 → 179/179** delivered lines equal to the page opening, zero refused, and the
21 no-deck rows are the ruling's own boundary (2 fall back to a usable stored line, 19 are the
unbriefable version/canary/commit class). Nothing already delivered was rewritten; the next generation
is the first shipped under the new rule. What is still not 10/10 is unchanged and upstream: the pool.

**2026-10-18, earlier: the quote-first producer divergence is closed.** Two producers write
a story's opening sentence — the composer's deck (the story page) and the line `finalizeMetadata` stores
as `events.what_happened` (the briefing card, the alert, the search index) — and ruling #10a had taught
the report preference to the first only. That is why card 01 of the delivered 2026-10-18 briefing
printed the Freeman quotation while the story page for the same event opened on the report. Both
producers now ask one definition of the class; on the live 200 the class is **1 of 200** stored lines and
its replacement is **byte-identical to the page's own opening** — re-read on production after the
regeneration: briefing card 01 and the story page open the same event on the same sentence. The
delivered page keeps its stored
`$5,300` why-line until the next generation — `briefing:checkpoint` reads `ladder now: none 13`, so no
current rung writes it, and the next build is the regeneration (work log below). What is still not
10/10 is unchanged and upstream: the pool.

**2026-10-18, later: the composer's measured defect classes are closed, and the loop stops on the pool.**
Every must-be-zero line reads zero on the live window (`refused then published 0`, `delivered with no
body 0`, `facts lost 0`, ledger reconciling), the duplicate-block producer behind the last two of them is
closed at the producer, and no further widening of the ladder measured above half precision. What a
reader still gets that is not 10/10 is a **pool** fact: single-source events, security alerts, reviews
and product news whose stored evidence states no requirement, no effective date and no amount at stake —
22 of 25 modelled cards carry no why-line for that reason, each named per card by `briefing-preview`. The
open decisions are the owner's and are listed in the entries below: corpus and repeat coverage, and the
briefing floor's four remaining classes. Nothing in the composer is waiting on code.

**2026-10-18, later: the pool is the ceiling now, and one class of it is named.** With ruling #8 landed,
the composer's measured defect classes are closed and every must-be-zero line now reads zero — the one
still-red line on the live window, `refused then published 1`, was a cap charge against a fact the deck
had already published, and it was traced and closed the same day (work log above) rather than left as an
assumption that the window had moved. What the
next briefing still ships is **five cards, every one single-source** (`multi-source 0/5` in the same
replay), several of them product-week features rather than developments — the composer cannot fix a pool
that has one publisher per event. The next slice is therefore the corpus and the clustering that feeds
it: the demand-driven collection gap (26 of 79 sources unfetched since 2026-10-06) and repeat coverage,
measured at **7 same-story pairs in 96 hours** on 2026-10-17. The briefing floor's remaining four
classes (price, shelf, commentary, hobby-hack) stay open until each is measured on a briefing pool, as
ruling #8 requires.

**2026-10-18: the composer's page is clean on every must-be-zero line; what is left is the pool the
composer is handed.** Ruling #7 closed the last three measured published defects (paid-content pages,
unestablished page openings, the welded subhead), and `audit:reader` now prints `delivered with no body
0`, `refused then published 0`, and zero reader-visible defects on the 250-event live window. The
largest remaining gap is no longer prose: **40 of 250 stories publish nothing**, and the corpus is
single-source for most of them (the demand-driven collection gap above). The next slice therefore works
upstream — coverage and clustering — and the composer's remaining named classes (`a fused table published
as prose`, `animate anaphora`) stay listed below until a rule can be measured for them.

**2026-10-17, last: the programme-page question is ruled and landed; what is left of the composer's
published defects is smaller and named.** The ruling is
[decisions/programme-pages-and-alert-floor.md](decisions/programme-pages-and-alert-floor.md). **The open
question that follows from its own logic is upstream, not in the composer:** a programme's episode page
has no reporting in it at all, so `ingest`/`cluster` are paying to store and cluster pages that can only
be withheld — a source-class decision, and a measured one (how many of the 200 live stories are programme
pages), not a patch.

**Then, the composer's remaining published defects,** as measured on the frozen corpus while working the
adjacency slice — the two classes the 2026-10-17 ruling closed are marked closed, the rest stand:

- **staff bios published as news prose** — **closed 2026-10-17** (refused, and a story that was only a
  bio is withheld); originally 3 stories: *"Amanda Silberling is a senior writer at
  TechCrunch…"* (in two different stories), *"Theresa Loconsolo is an audio producer at TechCrunch…"*
  plus *"Theresa is based in New Jersey and holds a bachelors degree…"* and *"Before joining
  TechCrunch in 2022…"*, and *"Stewart Bendle is a deals and coupon writer at Tom's Hardware."* The
  distinguishing test is source-relative — the employer named is the source's own publisher — which
  keeps the two measured false positives (*"Neha Bora is a PhD student at Delhi's Jawaharlal Nehru
  University"*, *"Zacharia previously worked as a spokesperson for DHS"*) out.
- **programme intros published as decks** — **closed 2026-10-17**: the intro is refused and the two
  stories (*"On this episode of TechCrunch's Equity podcast…"*, *"On this episode of The Vergecast…"*)
  compose an empty body, so `unbriefable` withholds them.
- **a source's own typo in a verb slot** — **closed 2026-10-17** (ruling #6): the measured sentence is
  refused as `editorial_noise`, the story keeps its other paragraphs —
  [decisions/source-typo-verbs.md](decisions/source-typo-verbs.md).
- **a fused table published as prose** — 1 story: *"…(max).Key benchmarking results for Mistral Large
  4 Preview:➤ Most intelligent model…"* (arrow glyphs, no space after the period).
- **animate anaphora** — 5 sentences still refused because personhood cannot be proven
  (`He argued that the Nord Stream pipelines…`); a classifier is a decision, not a patch.

The furniture class is the largest and the least arguable, and it is the one the product already has
a rule family for (`providerFurniture`, `editorialNoise`, `hasSourceMetadata`) — the gap is that a
bio is grammatical, so nothing in that family sees it. **Ruled 2026-10-14 (copular byline, option A)
and implemented the same week; the three measured gaps were closed on 2026-10-17, and the last open
question in this paragraph — whether a page that is nothing but a programme's own material is
withheld — was ruled the same day and is now landed** (see the work log and
[decisions/programme-pages-and-alert-floor.md](decisions/programme-pages-and-alert-floor.md)).

**2026-10-17, later the same day: the ruling arrived and the gate is gone.** The owner: *"this saas is no
ai product, its should be pure code"*. That is now a section of [AGENTS.md](../AGENTS.md) (*"It is not an
AI product. It is pure code."*) because it was missing from the file and a session asked a question it
should have been able to answer. The principle decides the fork on its own: the ladder's three strongest
rungs are written by the `analyse` pass, so under pure code they can never be filled, and a gate that
withholds silence withholds ~97% of the pool permanently. **Q4 and pure code cannot both be true**, so
`writeStage` now ships every item that passes readiness and records the silent count in the digest note
instead of withholding. **And the rungs turned out to be a symptom: the corpus itself is single-source.**
Measured the same day: **26 of 79 active sources had not been fetched for seven days**, all stopping
together at **2026-10-06T00:45:44Z**, because `demand_driven_sources` is on (owner account, flipped
2026-09-25) and `sources_to_collect` withholds them as `no demand for 48 days` — Wired, Polygon, BBC
Politics/Business/Health/Sport/Science/Entertainment, six Guardian beats, Engadget, TechRadar, ESPN,
Crunchbase, Product Hunt. The feeds are fine: `check:feeds` reports 78 of 87 working (5,570 articles, one
unreachable). Meanwhile four arXiv feeds supply **747 of seven days' articles** against The Guardian
World's 68. So a real story is covered once — `publisher_count >= 2` for **27 of 1,000 matches** — and the
coverage rung, the one substantive rung pure code can always feed, is starved; 32 of the reader's 37
candidates are withheld as `primary-source` papers. **Clustering is not at fault and never was:** it is
already fully deterministic (0 model calls, every article "decided for free", 17 healthy runs in two days)
and has nothing to merge. **Verified by lifting the gate once:** `npm run pipeline -- ingest --force`
fetched all **79** sources with `skipped (no demand) 0` and inserted **407 articles** the reader would
never otherwise see; cross-outlet duplicates do exist in that material (BBC Sport and The Guardian Sport
carry the same Red Roses story in different words) while a 4-word shingle test finds none at jaccard 0.3,
and **55 of the last six hours' 84 news articles are still queued** behind arXiv papers, so the
deterministic matcher has not been allowed to answer yet. **And lifting the gate is only half of it:** **25,340 of the project's 47,418 articles have no event at all
(53%)**, hours-old news included — the Red Roses pair is still `event_id = null` — because clustering
selects through `priority_articles_to_cluster` over a bounded live window and three consecutive
`cluster --limit 400` runs drained 100, then 38, then 0 while the backlog stood still. **The matcher itself
is proved good, so nobody needs to re-check it:** `sameStory` merges all four real cross-outlet pairs taken
from the live corpus (both Red Roses headlines, a BBC Science wildfire pair, a Tesla Roadster pair). The
remaining choice is a cost decision, not a code one: keep those 26 sources collecting (free-plan CPU and
fetch volume) so clustering can work at all. Full record:
[decisions/reader-delivery.md](decisions/reader-delivery.md#the-rungs-are-starved-upstream-the-corpus-itself-is-single-source). Measured on the reader's live pool the same day: `briefing-preview` **0 ships →
7 ships**, all 7 silent. **What is owed now is the pure-code work the ruling implies:** rungs the code
can feed — the coverage rung first, since 97% of this reader's matches are single-source in a product
whose promise is clustered coverage.

**The checkpoint's evidence exists, both pieces of it, and the decision it was waiting on is
no longer "did it build?" — it is "is one story a briefing?"** The reader received a briefing on the
first natural attempt after the repair (1 item, push accepted 22:59:39.808Z) and the controlled build A
ran the same day; the must-be-zero gate holds at **0 raw fallbacks of 248**. What that evidence exposes
is a **collapse in size — 25 stories to 1 to 0** — whose cause is measured and recorded above: every
ladder rung that needs stored analysis text is empty, so Q4 withholds ~97% of the pool, and the rung
described as the one that carries the load is the one the code-first policy switched off. **The blocking
question is therefore now a product ruling, not an engineering one**, and the five options are in
[decisions/reader-delivery.md](decisions/reader-delivery.md#the-briefing-collapsed-from-25-stories-to-1-and-every-rung-that-could-speak-is-switched-off-2026-10-17-open).
Nothing that changes what a reader receives lands until that ruling arrives. The historical Day-2/Day-3
framing below is kept because the gate repair it describes is what produced tonight's briefing.

**Day 2 is spent and Day 3 is the release decision (2026-10-17).** The gate repair is **deployed**
(`6e88b8d`, 05:20Z): the run that first could not start at all — hosted runners refused for about
twenty minutes with a billing annotation, and the deploy job showed as *skipped* rather than
*failed* — was re-queued after the owner made the repository public to restore its free runner
minutes, and it then passed every job with the origin contract 23/23. Verified on the live Worker
rather than inferred from a green run: the 40 digest ticks after the deploy all ran `healthy`. So
tonight's 22:20Z attempt is the first one that runs the repaired gate, one brief a tick. **Email is
not part of that evidence, by the owner's ruling the same day:** the Resend key is deliberately
disabled to keep the free send quota for launch, so the 401 on every email row is intended and the
channels a reader actually receives today are push and the dashboard. The release decision is
therefore read on push and the dashboard, with email listed as a launch-time switch rather than a
broken leg; the evidence still owed is the controlled production-path build (A) at 15:00Z and the
reader's own attempt tonight.

**The ruled Day-2 slice, in the arbiter's own terms:** a build that
completes inside the existing free-plan CPU budget for a reader with a large pool. It is
landed and measured: the gate's own cost is down 5.7x with its verdicts proved unmoved on 200 frozen
stories, and every stage of the 22:30Z reader's build (selection ~250 ms, screening ~200 ms, one gated
brief's worst 435 ms, the write ~52 ms) now fits inside the ~710 ms grace that was killing it. **What
decides the release is evidence, not this paragraph:** the reader's 22:20Z natural attempt is the
first tick with the repaired gate and one brief a tick, and the arbiter's controlled production-path
build (A) runs at 15:00Z against the daily-briefing guard for persistence, provenance and the queued
delivery. The checkpoint stays **overdue** and the reader-quality gate stays **open** until those two
pieces of evidence exist.

**The owner's priority, stated 2026-10-12 and now a rule ([AGENTS.md](../AGENTS.md)).** This gates
what "next" means: **what the reader reads must be 10/10 and no rubbish reaches a reader**, judged on
the live product by reading it as a stranger, and **nothing else is next until that holds.** The
alert side is held to the same standard in its own terms — a breaking, important, recent event, and
silence otherwise. The R1 order below still stands and is still the blocking set; it is just no
longer the answer to "what work do I take", because reader quality outranks all of it.

**The card surface now asks the shared sentence boundary (2026-10-15, ruled and landed).** Both card
classes are closed as ruled: recovery validates through the shared boundary (`admissibleReaderSentence`)
as well as the card predicate, so a refused line cannot recover _into_ a byline, and `cardSummaryRefused`
carries the shared reference predicate (`unresolvedContextOpening`) at the card. Measured on one live
window (newest 1,000 complete events, 679 cards printing a line): the context class went **1 refused →
13**, all 13 dispositioned, 0 recovered lines still carrying the defect. The same measurement found a
wider class — **24 of 679 card lines printed text the shared boundary refuses** (10 a description a
provider truncated, 5 commit records carrying an author email, 1 raw media payload, 2 marketing
imperatives, 1 unsupported attribution, 1 unattributed quote, 1 context line), **24 of 24 failing on
their first sentence**. The arbiter ruled **option 1** (2026-10-15): apply the existing shared boundary
before rendering, recover lazily, withhold if nothing valid is recoverable, no new reason or card-only
classifier — and **extend `isCutSentence`** so a _terminal_ ellipsis is cut content, terminal only.
Post-change counts on the same window: **643 fast path, 36 needing recovery, 18 recovered, 18 withheld,
0 recovered-but-refused, 36 compositions paid of 1,000 events**. 8 new tests fail on the previous tree
and pass on this one. **Confirmed on the deployed origin** (2026-10-15, CI run `38670490754` deployed
`372e184`; the gate was green first: typecheck, lint, 3,263 tests, coverage ratchet, build, PWA, route
walk, origin self-test, e2e 30/30): the dashboard's 16 cards carry **0** truncated lines, **0** commit
records, **0** raw markup, **0** marketing imperatives and **0** email addresses. **Still open:** the 18
withheld cards (a deliberate trade, not a fix), the write-time cleanup of stored summaries (a separate
later decision), the article bodies, the older GitHub-slug and non-comma list-item items, and **a new
live defect found by that read** — card 16 of the briefing opens on `From Circana's US Retail Tracking
Service:For 2026 YTD ending August, …`, a source label welded to its sentence with no space at the seam
(the heading-label class `stripHeadingLabel` owns; it survives because the label is five words starting
with "From"). That one is for the arbiter, not for this slice's authority.

**The reader-quality work in flight: the byline slice landed, the card slice still held.** The live
masthead byline is **fixed and verified on the live data** — the story `7a1a7f98` no longer opens on
it, the second live instance is gone with it, and the change touched **2 of 200** stories in a frozen
before/after with no defect counter moving. The card slice's own hold was **released by the arbiter on
2026-10-15**, its conditions met: recovery is validated through the shared boundary, the 10 measured
examples carry explicit dispositions, and the two false positives are recorded. What remains comes
straight from the rulings: (1) the card slice is **landed** as ruled — see the entry above — with the
byline gap closed by demonstration rather than by assertion; (2) the older GitHub-owner/repo and
TCP/IP reference defects are absent from the current window and need their own re-read; (3) the
non-comma list-item limitation stays a documented limit, to be reassessed against verified
source-to-output examples; (4) two measured false positives of `recoverableContext` are recorded — a
card line resolved by its own headline, and "Those demands" whose antecedent is the paragraph above;
and (5) the GTA 6 memecoin suspicion is **closed as refuted** — its provenance is the story's own
source, and the arbiter removed it from the active queue. The gate stays **open**; nothing here is
10/10.

**The arbiter's order, ruled 2026-10-12 (R1 — [decisions/product-readiness.md](decisions/product-readiness.md)).**
The blocking set comes first; D8/D9 continue only where the work is independent and does not
obscure the current measurements:

1. **Restore email delivery** — both the Resend credentials _and_ `EMAIL_UNSUBSCRIBE_SECRET`, plus a
   real production sender instead of `onboarding@resend.dev`. Acceptance: a production email is
   accepted by the provider **and** verified as delivered.
2. **Fix the Stripe configuration** and verify the whole payment-to-entitlement path on a test
   transaction before any live charge. (`billing:check` exits 1 today: the `PLURA`/`OMNI` price
   variables are unset and the old `PERSONAL`/`PRO` names are still in the environment.)
3. **Investigate the 22:30 briefing failures** — **investigated 2026-10-12**
   ([decisions/briefing-slot-failures.md](decisions/briefing-slot-failures.md)); the failure is
   **not** normalised in copy and discarded work is **not** treated as steady state. Result: not a
   scheduling defect (23 sent at the same slot), two shapes — 12 built-then-discarded (413 items)and **5 never built**, diagnosed below. The code half of the fix is `reconcileDigestAfterTerminal`,
   which settles a digest on its last leg instead of letting the 120-minute sweeper discard built
   items; the channel half is item 1 (email), which is owner-side.
4. **Verify stranger sign-in and the first-user experience** end to end.
5. **Exercise Telegram or declare it inactive for this release** (1 account, 0 deliveries ever).
6. **Classify the 19 anon-executable `SECURITY DEFINER` functions** before any grant changes, and
   classify the 31 RLS-no-policy tables, the 10 mutable `search_path` functions and the disabled
   leaked-password protection separately. No blanket revocations.
   **Three of the four are classified 2026-10-12** ([decisions/security-classification.md](decisions/security-classification.md)):
   the 19 definers (revoke nothing — RLS helpers the policies themselves call, trigger-only
   bodies unreachable through PostgREST, and candidates that are invoker-rights once read),
   the 32 RLS-no-policy tables (**deny-all is correct**; the browser's anon client reaches
   exactly one `public` table, `subscriptions`, which has a policy), and `search_path` (the chain is
   clean at 0 definers and now pinned by a test; the advisor's 10 are live drift **outside** the
   chain). **Still open:** the 10 live `search_path` names and the 31-vs-32 reconciliation, both of
   which need the dashboard's list — owner-side — and the disabled leaked-password protection.

   **Shape B of the 22:30 failures is now diagnosed (2026-10-12).** The five never-built rows are the
   days whose first _successful_ claim slipped past `MAX_LATENESS_MINUTES = 120`: across all 47
   briefings scheduled at 22:30Z, healthy days claim at −9 to +26 min and the five failures at +113 to
   +120 min, with days at +45/+86 still delivering. `claimDigest` is the only writer of
   `generation_started_at` and a retake **overwrites** it, so the stamp is the _last_ claim, not the
   first. Two mechanisms, both from `pipeline_runs`: **1,936 of 27,178 digest runs are left
   `status: running` — invocations killed before the receipt could close, and nothing reaps them**
   (98/31/116/34/22 of them inside the slot windows of 10-07..10-11, and the two that failed are
   10-10 and 10-11; one is stamped `00:24:13.121`, matching the failing row's claim at `.696` of the
   same second); and three days — 09-26, 10-05, 10-06 — with **no** stuck runs but only 47–125 runs in
   the window against ~170 on a healthy day. That second reading was **wrong, and is now closed** (see
   the 2026-10-12 work-log entry and
   [decisions/cpu-killed-invocations.md](decisions/cpu-killed-invocations.md)). There is no
   trigger-delivery fault: the every-minute trigger fired on every minute
   of both days, and those shortfall days are the _same_ killed-invocation mechanism recorded on the
   other side of the Audit 47 deploy — before it, a killed invocation left no row at all, so the
   minute looked skipped. **Instrument defect found
   and fixed:** `DigestReport` had no `considered` field, so `recordRunLifecycle` — which reads a
   missing metric as 0 — recorded `considered: 0` for **every** digest run ever, including ticks that
   were generating; 285 consecutive zeroes looked like starvation and were an artifact. The report now
   carries `considered: due.length` and `describeDigest` prints it, with a regression test on the
   expiring tick. **Not fixed, deliberately:** nothing reaps an abandoned `pipeline_runs` row, and
   generation shares one invocation with delivery, so the 253 failed email legs and their retries
   compete with the work that builds the briefing — both are behaviour changes awaiting a ruling.

7. **Make failures actionable, not merely recorded** — an `ops_status` error sat 29.6 days. Failure
   detection is part of the acceptance criteria for the restored email and billing paths.
8. **Acceptance lines for every side** are now recorded (§7 of [product-readiness.md](product-readiness.md));
   the reader path keeps its stricter must-be-zero gates.

In the arbiter's order for the reader-delivery path:

1. **D1–D4 are landed and measured** (see §6): the readiness seam, the deck rule, refusal-finality,
   the one shared definition of "unresolved context", and the quote-opening classification. The
   next slice is whichever of the below the arbiter takes first; nothing else on this path lands
   without a ruling.
2. **D5 is landed** (see §6): the 19 split 11/3/5, and a marketing shape now refuses only when the
   coverage says the publisher was speaking for itself. The standing follow-up is the `rss` risk,
   which the live window did not exercise — re-run `npm run audit:reader` and read its `Vendor
shapes` section whenever the ingestion mix changes.
3. **D6 — the 59 stories that publish nothing** (31 nothing-selected, 26 single-fact-is-the-deck, 2
   charged to a named rule, 0 unexplained). Ruled 2026-10-11 and next. The contract: account for
   every one of the 59 **individually**, with the evidence and decision-time context (coverage
   availability, the event clock), and classify each as _justified silence_, _justified deck-only_,
   _false refusal_, _evidence-selection defect_ or _unresolved_ — naming any class added. The frozen
   corpus and its baseline stay as they are; a claimed defect must reproduce before its fix and pass
   afterwards; the standing invariants hold; and **no broad release rule** may land before the 59 are
   understood. The classification and the proposed disposition come first, with any clearly
   reproducible defect brought forward for a narrow ruling. Not all 59 should be published: the
   question is whether each disposition is right, not how much output there is.
   **Ruled and closed 2026-10-11 — see §6 and
   [decisions/d6-silence-classification.md](decisions/d6-silence-classification.md): 0 false
   refusals, 0 evidence-selection defects, 0 unresolved, and nothing for a release rule to fix. The
   arbiter accepted it and ruled the 267 `never_matched` events intentional cost-gate behaviour, not
   lost stories. Two narrow items came forward and are ordered: next is `priority_arm` 9 (dispatch
   starvation — a recently matched reader with in-arm articles that no tick reached), then
   `extraction_empty` 180 (fetched, enough words, zero units) as its own evidence-extraction slice.
   Neither may be "fixed" by raising `ENRICH_LIMIT` or widening a window, and no broad rule change is
   authorised.**

   **The `priority_arm` investigation is ruled and its contract is fixed** (2026-10-11): build a
   read-only **replay using the real dispatch-selection logic** over frozen inputs — not an audit-only
   reimplementation — recording, per event, its eligibility at decision time (24-hour reader-match arm
   / 72-hour article arm / both), its position under the real newest-published-first ordering, which
   three candidates consume each tick's `ENRICH_LIMIT`, and whether successive ticks reach it. Falling
   below the first three is **not** starvation; only remaining unselected across the replayed ticks is.
   If starvation is proven the failing replay becomes the regression test and the correction is the
   narrowest one that restores progress **without changing eligibility, `ENRICH_LIMIT` or the fallback
   window**; if every event is eventually selected, the nine are **deferred, not defective**, and
   dispatch behaviour does not change to zero a diagnostic count. One forward confirmation on real
   ticks follows a demonstrated correction — it supplements the replay, never replaces it. Report the
   replay, its conclusion and the proposed disposition **before** any dispatch-policy change. Full
   contract: [decisions/d6-silence-classification.md §6](decisions/d6-silence-classification.md).**

4. **The 9 two-quote blocks** — D7, after D6. D4 measured that they do **not** overlap the 29
   quote-opening blocks on this corpus (0), so they are their own queue and are not yet classified.
5. **The `rss` risk, kept visible**: no new evidence yet justifies changing the policy again, so the
   audit's `Vendor shapes` section is the instrument to re-measure on later windows.
6. **D9 — the prose behind the story, ruler first** (see §6). Opened 2026-10-11 by reading three
   alerted stories by hand: the audit calls them clean and they are not. **The ruler landed 2026-10-12**
   — a fragment/truncation class and a raw-URL class in [defects.ts](../scripts/lib/defects.ts), 12
   tests, nothing changing what the reader receives. On the frozen 200: 702 published blocks, **0
   truncated leads, 6 raw URLs** (2 of them the flagged shape). **The rule is still open and still
   needs a ruling**, and the measurement sharpened the question rather than settling it: the address
   class needs an address-as-noun sub-classification before a rule could be argued from it, so the
   count is an argument against a blanket rule; and the frozen 200 cannot measure the truncation class
   at all, because it holds neither of the two samples D9 was opened on — a **live window**
   (`npm run audit:reader`) is the instrument for that one.
7. **D8 — the alert bar itself** (see §6). The gate landed; **the floor is open and awaiting the
   arbiter**: alerts after the gate still reach phones for shapes no rule refuses (a vendor roadmap
   advertorial at importance 7, a product newsletter at 7, a hobby hack and a personal blog post at
   6, a memory-kit price piece at 6). Four options with their costs are recorded in
   [decisions/reader-delivery.md](decisions/reader-delivery.md#d8--what-an-alert-is-allowed-to-be-2026-10-11):
   (a) gate only; (b) raise the alert floor above the briefing floor — and the measurement says
   raising it to 8 removes 7 of the 8 recent non-news interrupts and 7 genuine ones with them;
   (c) refuse a first-party marketing shape even when corroborated, **which contradicts D5** and needs
   D5 reopened; (d) require more than one outlet for an alert.
   **Ruled 2026-10-12 by the arbiter: (a), provisionally** — the floor stays, no outlet minimum and no
   blanket first-party exclusion, while the open question becomes evidence rather than policy: does
   the gate distinguish news from announcements at all? A second ruling of the same day covers the 69
   alerts stuck at `ready`: that status conflates whole-alert completion with one channel's state and
   needs a model that can say successful / partial / failed / pending.
   `npm run audit:alerts` is the instrument, and it now prints a gate verdict per alert.

Blocked on the owner, not on code (all three measured 2026-10-12, §1 of
[product-readiness.md](product-readiness.md)):

- **The briefing email is deliberately off until launch, and its history has two causes.** **Owner's
  ruling, 2026-10-16: the Resend key is intentionally disabled to keep the free send quota for
  launch**, so every email row failing `Resend 401 API key is invalid` is the intended state and **not
  a defect to repair**; push and the dashboard are the channels a reader actually receives, and
  re-enabling email is a launch-time owner action (§4). Recorded because the change it replaces is
  easy to mistake: the first failure after the last accepted send (2026-08-26T23:55) was
  `Missing EMAIL_UNSUBSCRIBE_SECRET (minimum 32 characters)` on 2026-08-26T23:55, unbroken to
  2026-09-11T05:45 (125 failures); `EMAIL_UNSUBSCRIBE_SECRET` is still absent from this environment,
  so local runs and the Worker do not fail for the same reason.
- **`RESEND_FROM_EMAIL` is `onboarding@resend.dev`**, so even with a working key a stranger
  cannot receive mail until a domain is verified.
- **The Stripe price variables are the pre-rename names.** `npm run billing:check` exits 1:
  `STRIPE_PRICE_PLURA_*` / `STRIPE_PRICE_OMNI_*` are unset and `PERSONAL`/`PRO` are present but no
  longer read. Checkout resolves no price until they are renamed — and no live payment has ever run.

**Still open, measured 2026-10-17 evening.** Two reader-facing items, both with their evidence:

- **One context-dependent opening survives the composer.** `npm run audit:reader` (live corpus,
  1,855 sentences read) reports every must-be-zero counter at **0** — delivered with no body,
  refused then published, confirmed defects — and exactly **1 event carrying a reader-visible
  defect**: _NTT Global Data Centers weighs the price tag of not building fast enough_, whose first
  paragraph opens "The report models three growth trajectories through 2030 …" while the deck names
  only Berti and the page never establishes *which* report. That is the defect class AGENTS.md
  names. It is not a one-line fix: `contextDependent` is a **hard refusal** in `editorial.ts`
  (line ~1680), so adding definite document nouns would also refuse a legitimate "The report found
  …" whose antecedent an earlier paragraph established. The rule has to be scoped to a block that
  opens the story (or to a document noun with no antecedent on the page) and measured on the frozen
  corpus before it ships, which is the next slice. **Two attempts were made the same evening and
  both were reverted:** refusing the sentence, then refusing the block, each left the audit reading
  **5 context-dependent openings and the same defective event** — the article then opened on "The
  middle (baseline) scenario projects …", the same missing report read one sentence later, and the
  block's numbers were lost. The class cannot be closed by refusal; the composer has to *open* the
  story with a sentence that establishes the document. **The ruler was then widened** to count a bare
  pronoun behind a leading connector (`However, they …`), which both the ruler and the gate miss
  because they read position zero: `npm run audit:reader` now prints **2** such blocks in the corpus,
  and they are not one defect — the Taiwan one is genuine (its antecedent sentence was refused), the
  sentencing one is correct prose (`he` is the hitman named above). No rule shipped for that reason:
  a blanket refusal would delete a correct paragraph, and telling them apart needs coreference. The
  counter stays so the gap is visible. Evidence and both examples:
  [decisions/context-openings.md](decisions/context-openings.md).
- **The `why_it_matters` slot is gone from the card by ruling, and the data still carries it.** If a
  deterministic, evidence-backed source for significance appears (see
  [decisions/significance-without-a-model.md](decisions/significance-without-a-model.md)), the slot
  returns without a migration — but nothing in the current pipeline can feed it, and two measured
  attempts to widen the ladder are recorded as negative results.

**2026-10-19: the paste happened, the clock is running.** The owner applied
[0120_source_experiment_exemptions.sql](../supabase/migrations/0120_source_experiment_exemptions.sql) in the
SQL editor; the before-record was taken with the exemptions still off (**12,733 complete events, 169 with
≥2 publishers**, ladder `none 56 · coverage 3 · consequence 1`), and `npm run experiment:sources -- --on`
started the window **2026-10-19T06:46Z → 2026-11-18T06:46Z**, with the gate answering `exempt: 12c-30d` for
all eight. Nothing else in item 2 is code: the ladder needs a second outlet per story, and the corpus has
been measured to lack one. The three acceptance conditions (coverage above baseline; ≥1 future delivered
item with a non-coverage rung line; `briefing:checkpoint` non-zero and traceable) are measured on items
delivered *after* the first covering window, which is the next thing to read once the clock runs. Also
still open and not started, named so they are not silently widened into this slice: the price/discount/
first-party dashboard classes, and the context-dependent opening in `decisions/context-openings.md`.
**The "You follow AI." topic attribution has left that list**: it is measured (`npm run
audit:topic-attribution`) with its population and its mechanism recorded in
[decisions/topic-attribution-reason-lines.md](decisions/topic-attribution-reason-lines.md), and it now
waits on an arbiter ruling over four numbered options — a reader-visible change nobody has approved.

## 8. Invariants an agent must not break

- `npx tsc --noEmit` stays clean, and so does `tsc --noEmit -p tsconfig.scripts.json`.
  `noUncheckedIndexedAccess` is on: index access yields `T | undefined`.
- **Colour is three values**: black, white, and one blue (`--signal`, hue 240). Every other
  token in [styles.css](../src/styles.css) is chroma 0. A fourth colour is a test failure
  ([style-tokens.test.ts](../src/lib/style-tokens.test.ts)) — not a design decision.
- **The security boundary is `adminOnly`/`superadminOnly`** in
  [guard.ts](../src/lib/server/guard.ts). The role check in the UI only decides what is
  drawn. Never add a console query that skips the middleware, and never add a role column to
  `profiles` — it would be self-grantable.
- **Console data is fetched on the client**; the public site uses loaders, because
  `getPublicSiteContent` needs no session and never throws. Reads never throw: a malformed
  site-settings row costs one wrong headline and falls back to the bundled copy.
- **Every mutating console action writes an `admin_audit_log` row** via `audit()`.
- On the reader path: a refused fact stays refused; every selected fact is `rendered`,
  explained by a named rule, or counted as unexplained (which must be zero); the deck must
  stand on its own; no card ships without a body. **An alert clears the same `assessReadiness`
  gate a briefing story does** ([alerts.ts](../src/lib/pipeline/alerts.ts)), because an
  interruption is the one thing the reader cannot choose: a shape the briefing refuses must
  never reach a phone as breaking news.
- DeepSeek models are reasoning models: budget `max_tokens` for reasoning _plus_ output, and
  always check `finish_reason`, or a response comes back empty with no error.

## 9. Git and delivery rules

From [AGENTS.md](../AGENTS.md), which is authoritative:

- **Use skills; write the missing one.** Check the installed skills before starting, read the
  `SKILL.md` that owns the task, and when a process repeats with no skill covering it, write it
  in `docs/skills/<name>.md` **and** install it account-wide, then use it. Required, not a
  preference.

- Land verified work; do not ask whether to push it. A finished, verified change is pushed.
- Run **`npm run ci`** on the final tree before any push — typecheck, lint, the suite with
  coverage, the coverage floor, the production build, the PWA install contract, the route
  walk's self-test, then Playwright against the built Worker. A red push is not a deployed
  change, because the deploy job is skipped.
- One substantial change per commit; commits stand on their own.
- Never add a `Co-Authored-By` trailer.
- The coverage floor only rises and is recorded **from the runner**, never from a laptop.
- `docs/context.md` and `AGENTS.md` are tracked and pushed with the work. Never gitignore
  them.

## 10. Where the detail lives

| question | file |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- || Working rules for an agent in this repo | [AGENTS.md](../AGENTS.md) |
| The skills that carry those rules (install fields + text) | [skills/](skills/) — `arbitrate-first.md`, `keep-context-current.md` |
| Every side, measured today, with its acceptance line | [product-readiness.md](product-readiness.md) — the output of `npm run audit:posture` |
| The product-wide readiness ruling (R1, 2026-10-12) | [decisions/product-readiness.md](decisions/product-readiness.md) |
| Product state, area by area (historical snapshot) | [status.md](status.md) |
| Rulings on the reader-delivery path, with their dates | [decisions/reader-delivery.md](decisions/reader-delivery.md) |
| Why briefings shipped without their shared explanations (2026-10-12) | [decisions/briefing-explanations.md](decisions/briefing-explanations.md) |
| Why the 22:30 slot failed, and what the 1,936 stuck receipts say | [decisions/briefing-slot-failures.md](decisions/briefing-slot-failures.md) |
| Whether the briefing should be built once, per band, per reader, or at read time (2026-10-21) | [decisions/briefing-delivery-time.md](decisions/briefing-delivery-time.md) |
| The security findings, classified before any revocation (R1 item 6) | [decisions/security-classification.md](decisions/security-classification.md) |
| The reader-quality loop in more depth | [briefing-quality-handoff.md](briefing-quality-handoff.md) |
| Reader quality audit method | [reader-quality-audit.md](reader-quality-audit.md) |
| Architecture, database, deployment, development | [architecture.md](architecture.md), [database.md](database.md), [deployment.md](deployment.md), [development.md](development.md) |
| The admin console | [admin-console.md](admin-console.md) |
| Editing site content | [site-content.md](site-content.md) |
| Vocabulary | [glossary.md](glossary.md) |

## 11. Commands worth knowing

```bash
npm run dev          # port 8080
npm run ci           # the full gate: the same list the runner executes
npm run typecheck    # app + scripts
npm run test         # vitest
npm run e2e          # playwright; needs `npx playwright install chromium` once, on Node 22

npm run audit:posture                                 # every side, one read-only run
npm run audit:reader -- --corpus tmp/corpus-after.json   # the composer's published prose
npm run audit:reader -- --find "DigiCert"                # one event's raw rows
npm run audit:fusion                                     # re-extract sources to confirm fusions
npm run briefing:checkpoint                              # one command, end to end
npm run timing:read-path -- --user <id> --runs 3         # the build's CPU, per phase and per brief
node --env-file=.env scripts/tsrun.mjs scripts/reader-corpus-freeze.ts --out tmp/corpus-after.json
```

Node 22 (`.nvmrc`) is required; `wrangler dev` refuses to start on Node 20.

**Known local fragility, re-measured 2026-10-12.** The same four files failed inside a full
`npm run ci` again — `exclusions-db.test.ts`, `launch-plans-db.test.ts`, `ai/code-first-db.test.ts`
(hook timeouts) and the filesystem-walking `ai/callsites.test.ts` (`Test timed out in 60000ms`) — and
one worker reported `[vitest-worker]: Timeout calling "onTaskUpdate"`, which is contention rather
than an assertion. Each passes alone on the same tree with coverage enabled, so a red run that names
only these files is worker starvation: check whether the diff touches them before believing it, and
run them individually (`npx vitest run --coverage <file>`).

**Known local fragility, measured 2026-10-11.** On this machine the coverage suite can starve its
own heavy files: 179 files across many workers, and four of them then exceed their ceilings —
`exclusions-db.test.ts`, `launch-plans-db.test.ts` and `ai/code-first-db.test.ts` (30s `beforeAll`
hooks driving PGlite) and the filesystem-walking `ai/callsites.test.ts` (60s test). The same four
pass unchanged with `npx vitest run --coverage --maxWorkers=2` (verified 2026-10-11: 41 tests, 64s).
A red run that names only those files is worker starvation, not a broken change — check whether the
diff touches them before believing the failure.

- **2026-10-14 — defect 5, the unestablished first person, ruled and landed as a third slice.**
  `Two vulnerabilities chained together gave us access to ChatGPT and Codex accounts belonging to
  OpenAI employees.` published on the deployed origin while its own sibling (`We demonstrated …`) was
  rewritten to `The authors demonstrated …`. **Cause, located rather than guessed:** `resolveNarrator`'s
  opening guard tested only the subject forms (`I / we / my / our`), so a unit whose only
  first-person token was an object or possessive pronoun never entered the function and its five
  resolution steps — whose last step has always been an `ambiguous` refusal — never ran; `VOICE`
  in `publisherVoice` has the same gap, deliberately, because under `/i` `us` is the country.
  **A false premise caught in my own probe, twice:** with `/i` the class measured 30; case-exact it is
  **27 of 7,816 live units**, in three shapes — 6 own-work (all arXiv: "This allows us to harness the
  accuracy of tree-based models like XGBoost …"), 3 community, 3 newsroom ("she told us during an
  interview"), 4 company-blog handover, 11 other object pronouns. **A blind substitution was simulated
  and refused by the data:** it rewrites an audience into a paper's author list in 6 of 17 units,
  which is a worse defect than the one it fixes. **Reader-facing before the fix:** 200 completed
  events, 928 published blocks, **7 carrying an object-only first person, none of them own-work**.
  **Ruling** (ChatGPT `nyuz` project, 2026-10-14): **Option 2 with a strict attribution
  requirement** — widen the guard case-aware (never `US`), one narrow own-work resolution only where
  source attribution establishes the actor and the substitution preserves meaning, the verified actor
  noun rather than a pronoun, community and newsroom voice never substituted to the authors, **no new
  reason string or counter**, `renameNarratorPronouns` unchanged, Option 3 rejected, and the window
  rerun against the shipped code. **Landed:** `NARRATOR_OBJECT` + `restoreNarratorBeneficiary` in
  [reader-evidence.ts](../src/lib/reader-evidence.ts), and the composer's entity path in
  [editorial.ts](../src/lib/editorial.ts) now asks the same resolver — it was publishing a unit the
  evidence pass had already refused (the NetBSD story's community sentence, traced rather than
  assumed). **Re-measured:** 27 candidates → **6 resolved, 21 withheld, 0 preserved**; reader-facing
  **7 of 928 → 0 of 938 published blocks**; 23 new tests, two of which were deleted because they
  passed with the fix removed. **Limits, recorded rather than glossed:** community and newsroom voice
  is withheld, not repaired, so legitimate interview quotes and audience-directed constructions
  (`shows us that …`) are dropped — whether an audience `us` should publish unchanged is the next
  question for the arbiter; the resolution's entity-path branch is preventive (0 live cases); and
  **the overall reader-quality gate stays open**. Full record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-unestablished-first-person--the-defect-the-narrator-resolver-never-saw-2026-10-14-ruled-and-landed).

- **2026-10-14 — the ruled deck defect was still publishing on the dashboard card, and is now
  recovered there.** Read on the deployed origin: the story page for `7af726e6` opened on its real
  first sentence with the list item gone from the body, while the **card for the same story still
  printed that item as its summary line**. Cause verified, not inferred: the card renders
  `briefingText(story.what)` and `story.what` is the stored event summary, so the card never asked the
  deck predicate — `noMainClause` on that exact string is `true` and `briefingText` returned it
  unchanged. **Population:** newest 1,000 complete events → 686 cards with a summary line, 1 refused;
  the live case is older than that window, which is why a recent-window count is not an inventory.
  **Recovery measured before it was offered:** both refused lines have a usable opening published
  sentence, and composition costs 150–220 ms, so it is paid only by a refused card. **Ruling**
  (ChatGPT `nyuz` project, 2026-10-14): **option 2, lazy recovery** — predicate first, stored line as
  the fast path, compose only on refusal, print the story's own opening published sentence, withhold
  the line if nothing valid is recoverable, reuse `noMainClause` rather than adding a card predicate,
  keep the classification separate from `sourceFurnitureHead`, no recursive retry, and **no write-time
  migration in this slice**. **Landed:** `cardSummaryRefused` and `recoverCardSummary` with the card's
  predicate-first path; 7 unit tests and 3 card tests, the card test having failed on the first
  implementation (it printed the refused line), which is its fail-before evidence. **A correction
  recorded:** the ruling assumed `noMainClause` does not fire on the TCP/IP card line; measured, it
  does — the main clause's verb is the contraction `There's` — so that line is an observed false
  positive of the predicate at this surface, pinned as one, and its real defect (`that` with no
  antecedent) stays open. **Confirmed on the deployed origin** (2026-10-14, after CI run `38524225248`
  deployed `2b4a80b`, read in the browser panel): the dashboard card for story `7af726e6` now prints
  "Even projects that have been enrolled in OSS-Fuzz for years can still hide critical bugs …" and the
  string `taskflow YAMLs` is absent from the page. The preceding slice is confirmed the same way: the
  story page for `29ad32c2` carries no `gave us` and reads "The authors demonstrated the impact …".
  **Still open:** that false positive, the GitHub owner/repo reference defect,
  the non-comma list items, and **the overall reader-quality gate**. Full record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-dashboard-card--a-ruled-defect-that-stayed-publishable-on-a-second-surface-2026-10-14-ruled-and-landed).

- **2026-10-14 — the reference class measured before any rule, and the measurement moved it off the
  body.** The card ruling left three things open and required measurement **before** a rule changes;
  this is that measurement, with **no rule written and no product behaviour changed**. Window (live,
  so it drifts from the morning's count — 927 → 932 blocks, 686 → 684 lines):
  `scripts/tsrun.mjs tmp/context-opening-classify.ts --limit 200`, the newest 200 completed events
  through the composer's own loader, plus the newest 1,000 `events` rows rendered through
  `briefingText`. **Result:** of **932 published blocks, 0 open the page on an ungrounded reference** —
  every hit is mid-body, and reading the block printed immediately before each one shows three of the
  six are ordinary anaphora the paragraph above establishes, which is why the body is not proposed for
  a rule on these numbers. On the **card** surface, 10 of 684 lines (1.5%) carry one: six are
  paper-abstract prose ("These results establish …") sitting under the paper's own title, so whether
  that headline establishes the reference is the open judgement; two are resolved outright by their
  headline ("Neither Egypt nor Sudan …" under the Egypt-Sudan headline, "Her epic ride …" under "this
  teen"); and two are unresolvable however the headline is read ("While the figure on its surface
  sounds significant …", "Those were among the descriptions …"). **The two strings the ruling named by
  hand are not in this window at all** — neither "The argument is just a GitHub owner/repo slug." nor
  the TCP/IP reference appears in any published block or card line, so that open item cannot be
  re-confirmed from it. **A separate anomaly, flagged and untouched:** the GTA 6 story publishes the
  memecoin-demands line, which reads as another story's fact — contamination, not anaphora. Four
  numbered options (card-boundary reuse of the shared predicate with lazy recovery / a
  resolving-headline check first / no rule / extend to the body) were put to the arbiter and the
  ruling is **pending**. Full record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-unestablished-reference-measured-before-any-rule-2026-10-14-ruled-the-same-day-see-below).

- **2026-10-14 — the ruling arrived (Option 1), the GTA 6 contamination suspicion was refuted by its
  own provenance, and a live byline was found on the story page.** The arbiter ruled **Option 1** for
  the card — apply the existing shared predicate at the card-summary boundary with lazy recovery,
  Option 2 rejected as an unvalidated new classifier, **Option 4 rejected** on the 0-of-932 body
  finding — and made the slice conditional on the 10 measured examples each getting a disposition, on
  recovery being validated, and on any legitimate summary the predicate refuses being recorded as a
  false positive. Ruled order of work: GTA 6 provenance first, then the card slice, then the older
  GitHub-slug and TCP/IP cases, then non-comma list leakage. **Measured dispositions:** 683 card lines;
  1 refused by `noMainClause`, 10 by the shared context predicate, **0 by both** (the classes are
disjoint, as the ruling claimed); 6 are paper abstracts under their own paper's title, 2 are resolved
  by their headline — and `recoverableContext` does not see that, so they are **false positives of the
  predicate at this surface**, contained by recovery — and 2 are unresolvable however the headline is
  read; **recovery validated on all 10: 10 recovered, 0 withheld, 0 recovered lines still defective.**
  **The slice is deliberately NOT landed:** recovery for one of the 10 returns
  "Sayem Ahmed is the Subscription Editor at Tom's Hardware.", so making the card ask the predicate
  would print a byline as a card summary — the same string is that card's recovery input. **The GTA 6
  suspicion is refuted:** the memecoin sentence is in the GTA 6 story's _own_ single source (Tom's
  Hardware, `articles.excerpt`) and appears in exactly 1 article across the scanned corpus; the
  paragraph above it ends "…has threatened to leak the entire game if **their demands** are not met",
  so the referent _is_ on the page one block earlier and the block is ordinary anaphora — which also
  means `recoverableContext` produced a measured false positive there. **A live defect found instead,**
  read on the deployed origin: the story page for `7a1a7f98` opens on a masthead byline as its deck,
  entered at extraction as `article_evidence` **UNIT 1** (status `enriched`, 12 units, article
  `f0562126`) and published at deck selection; measured on that exact string, `editorialNoise`,
  `publisherVoice` and `sourceSeam` **all pass it**, because every byline entry in the closed
  `PUBLISHER_FURNITURE` list is verbless and this one has a copula. No rule was built — adding a shape
  to a closed furniture list changes what ships — and the case is with the arbiter. Full record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-ruling-on-that-measurement-2026-10-14-received).

- **2026-10-14 — the copular byline ruled (Option A) and landed through the existing furniture
  boundary.** The arbiter ruled the bounded role-and-affiliation shape into `PUBLISHER_FURNITURE`
  rather than a new rule, with **no new reason string and no counter change**, and required a
  measurement first. **Measured before it shipped:** the newest 1,000 articles / 478 `article_evidence`
  rows / **3,997 units** gave **3 matches, all three publisher masthead bylines** ("Zack Whittaker is
  the security editor at TechCrunch." twice, "Tim De Chant is a senior climate reporter at
  TechCrunch.") and **0 legitimate reporting sentences**; the arbiter's four controls all behaved, and a
  **second live instance** turned up in a body rather than a deck (_Niobia takes the guesswork out of
  some of tech's most expensive mistakes_). **Two drafts were wrong and both are recorded:** the first
  was case-sensitive and blind to the capitalised role it was written for ("is the **Subscription
  Editor** at …"), the second refused "Maya Chen is the reporter at The Verge who broke the story on
  Friday." — reporting. What separates them is that **a masthead line ends after the outlet**; the
  roles carry their own first-letter classes because under `i` the `\p{Lu}` in the name and outlet is
  case-folded too. **Landed:** `PUBLISHER_BYLINE` plus `publisherFurniture` as the single union, with
  `publisherSelfReference` and `editorialNoise` calling it so no call site misses the shape. **Cost,
  measured on one frozen 200-story corpus before/after and attributed to this change alone** (the
  shared worktree carries another agent's hunks in the same file, so the comparison was run by
  applying only these hunks to a clean worktree at `c0e55e0`): **2 of 200 stories changed — exactly the
  two bylines** (−10 and −8 words, one paragraph fewer in the second), every reader-visible defect
  counter identical, **0 stories lost 25+ words, 0 became empty**; the 1,000-article corpus is from a
  later window than the live defect, which is why the defect's own story is verified separately on the
  deployed origin. **Verified:** `npx tsc --noEmit` clean, 3 new tests (5 refused forms, 6 reporting
  controls, 2 pinned limits), the file's suite at 163 tests, the five boundary suites at 275, and with
  the rule in place the story `7a1a7f98` opens on "The global race to deploy capable closed and
  open-weight models marches on …" instead of the byline. **Still open:** the body of that story still
  reads "according to Hardware"; the card-context slice stays held until the recovery-validation
  change (the arbiter ruled the shared furniture boundary **must** participate in recovery validation)
  and its deployment are verified; the older GitHub-slug and TCP/IP cases and the non-comma list-item
  limitation are untouched. The gate stays **open**. Full record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#ruled-and-landed-the-copular-byline-refused-through-the-existing-furniture-boundary-2026-10-14).

- **2026-10-17 — the briefing carried one story three times, and the arbiter ruled the entity pair.**
  Tonight's replay (`scripts/briefing-preview.ts --user 640a69b6`, read-only, live pool) showed **7
  cards of which 3 were one product**: three reviews of the Nvidia RTX Spark laptop, same day, three
  outlets. `suppressStoryTwins` missed them because its third condition is a shared **event marker**
  (`launch`, `deal`, `arrest` …) and a review announces no event. **Ruled by the arbiter on a new chat
  inside the `nyuz` project** (option 1 of four): two briefs are twins when their titles share
  **two capitalised content tokens adjacent in the same order** — `rtx spark` — within the existing
  48-hour window, with no marker required; a shared company name alone and scattered entities
  (`Trump` … `Iran`) must not merge, the marker path stays for everything else, and no model, no new
  data. **Landed** in `duplicates.ts` as `namePairs`, with the Title-Case guard the shortlist already
  uses (`TITLE_CASE_RATIO`, now exported) so a headline that capitalises everything contributes no
  names. **Verified on the release rule the arbiter set:** the same replay now prints **5 ships, the
  RTX trio collapsed to one card** (`Benchmarked: Nvidia's RTX Spark …`), and 4 new regression tests
  pin the trio, the shared-company non-merge, the scattered-actor non-merge and the Title-Case guard.
  One existing fixture was re-pointed rather than weakened: `Acme completes takeover of Beta Systems`
  became `Betacorp`, because the adjacent pair would have decided it before the marker loop the test
  exists to exercise. Decision record: [decisions/story-twins.md](decisions/story-twins.md).
  **Not fixed by this:** all 5 cards still ship with **no significance line** (0/5), and the measured
  ceiling is still the same — 0/1,000 matches with a stored impact, 0 with an after-state, 27 with a
  second publisher. The briefing is now shorter and truthful; it does not yet explain itself.

- **2026-10-17 — the significance block is removed from the card, by ruling.** With the twin fix in,
  the same replay printed **5 cards, 0 with a why-line**, and the measurements say that is not a
  backlog item but a ceiling: the ladder's only code-feedable rungs explain **27/1,000** (coverage) and
  **7/1,000** (money consequence), a widened "change of state" rung fired on **45/400 = 11.3%** at
  about a third precision and, with a PRIMARY-entity guard, on **20/400 = 5.0%** at about half
  precision (it printed a jellyfish "suspended in water", a 2011 product halted in a retrospective,
  "Docker advises users to review their tokens"). Two independent measurements now say widening the
  ladder is the wrong lever, and the filler rule says a half-right line is worse than silence.
  **Ruled by the arbiter (option 1): the card is complete without the block** — headline + factual
  what-happened + provenance — with six acceptance criteria, including *do not withhold stories for
  lack of significance* and *do not inflate `what_happened`*. **Landed:** the dashboard card renders
  no significance block, even when the payload carries a `why`; `story-card.test.ts` pins the new
  contract (13 tests). The ruling's release condition is verified on the same replay: the same 5
  cards are eligible, each has a factual paragraph and provenance, and none shows an empty or
  fabricated block. `digest_items.why_it_matters` and `reasonFor` are kept so a deterministic source
  can bring the slot back without a migration; email/push keep printing the line only when it exists
  (email is dormant until launch). Record: [decisions/significance-without-a-model.md](decisions/significance-without-a-model.md).

- **2026-10-17 — a title the headline prints was being lowered into a broken one, and is now kept.**
  Found by the definite-reference census below, not by the audit: the deck of _We can finally hear
  some of Wu-Tang Clan's Once Upon A Time in Shaolin album_ published **`The Verge reports that once
  Upon A Time in Shaolin has a long history …`** — the album's first word lowered because `once` is
  one of the function words `reportedClause` lowers after a reporting verb. Cause located rather than
  guessed: `reportedClause` decides by word list alone, and `Once` is on it. **A shape guard was
  measured and refused:** a "run of capitals" test fires on **30** of 3,189 corpus units, almost all
  ordinary clauses (`Although Ubuntu MATE skipped …`, `If Credential Guard is not enabled …`), so the
  signal is not the capital letters. What decides it is **the page**: `opensWithHeadlineTitle` returns
  true only when a prefix of the clause is a phrase the story's own headline prints, and
  `reportedClauseFor` then declines to lower, so no frame is built (`Once …` cannot follow `that`
  while keeping a title's capital) and the citation carries the provenance. **Cost, measured on one
  frozen 200-event corpus** (`tmp/corpus-today.json`, snapshot diff old → new): **200 stories → 200,
  840 blocks → 840, exactly 1 story changed** — the Wu-Tang deck, now `Once Upon A Time in Shaolin has
  a long history, which Pablo Torre Finds Out goes into in detail.` **Three new tests** in
  [reader-prose-rules.test.ts](../src/lib/reader-prose-rules.test.ts): the title kept, a
  capitalised-word clause that is not the headline's title still lowered (`When Credential Guard …`),
  and the same sentence with no naming headline still lowered, which pins the guard as the headline
  rather than a shape. `npm run ci` green (195 files, 30 Playwright). **Not fixed by this:** the
  headline-matching is literal, so a title the headline paraphrases is still lowered — recorded, not
  papered over. Record: [decisions/reader-delivery.md](decisions/reader-delivery.md#a-title-the-headline-prints-is-not-lowered-2026-10-17).
- **2026-10-17 — the definite-reference census: the class cannot be refused, by measurement.** The
  open NTT defect is a block opening on `The report …`, which no ruler counts. The census is now a
  committed instrument — `node --env-file=.env scripts/tsrun.mjs scripts/reader-context-anchors.ts`,
  a screen that says so in its own header — and on a frozen 200-event corpus (`tmp/corpus-today.json`,
  **840 published blocks, 159 stories with prose**) it finds **69 blocks (8%)** opening on a definite
  reference whose head noun is never named above, and **171 (20%)** opening on any definite article or
  connector+pronoun. Most are readable in place (`The Verge reports that …` names
  itself; `The new phone …` has its referent in the headline), so a refusal rule would remove roughly
  a tenth of the corpus to fix one story — the "drop the run" option in
  [decisions/context-openings.md](decisions/context-openings.md) dies on this number. What remains for
  the NTT class is: **establish the document in prose** (its single source carries no such sentence,
  measured with `audit:reader --find "NTT Global"`), or **withhold** the story. The census splits
  its candidates by whether the page names the head noun above and whether the word is a proper noun
  (`The Verge reports that …` names itself), which is a screen for reading, not a verdict: the head
  word is sometimes an adjective and a stem match is not a meaning match. Both are product calls
  for the arbiter, and the ruler's own reading is recorded with them. Two instrument errors were
  caught on the way and are recorded because they would have produced a false zero: a regex written
  with `\p{L}` but no `u` flag matches nothing, and an edit written through a shell heredoc put a
  literal backspace byte in a regex — both read as "0 blocks", the answer that closes a question it
  should open.

- **2026-10-17 — the story page was the one surface that never asked what a development record is.**
  Read from the composer's own output (`npm run audit:reader -- --show 6`): the deck of the llama.cpp
  release story `b11684` was **`Assisted-by: pi:llama.cpp/… pi: use emoji in the AI stats
  disclosure.`**, and seven published sentences in that one story were commit trailers or changelog
  dumps. `developmentRecord` was ruled for the card and the email on 2026-10-15 and the composer never
  called it. **Landed:** the predicate is now asked inside `unitTextRejection`, the boundary every
  surface uses, with `instructionOpening` exempted so a changelog bullet keeps its measured
  `imperative_instruction` reason. **Cost, frozen 200-event corpus at `HEAD` vs with the change:**
  stories with prose **159 → 159**, blocks **840 → 837**, sentences **1,788 → 1,781**, development-record
  sentences published **7 → 0**, and **exactly one story changed** (`b11684`, 5 → 2 blocks); nothing
  lost, no other prose moved. Two tests added (the refusal and the ruling's four controls, including
  "Google released Chrome 141 on Tuesday, and its changelog lists 42 security fixes."); with the
  predicate removed the refusal test fails, which is its fail-before evidence. `npm run ci` green (195
  files, 3,329 tests, 30 Playwright). **Context that keeps this honest:** the gate already withholds
  releasing stories by headline — **9 withheld as `build-number`** — so none of this reached a
  briefing; the article surface is where it published, and the exposure is a release story whose
  headline is a release name (`Wine 11.20 is out …`) rather than an identifier. **Still open:** those
  stories remain changelog articles (`Re-record the MTL fusion baseline with the current build: 276
  rows …`), and whether a single-source `github` release feed should produce a reader story at all is a
  product decision with four examples in the window — [decisions/reader-delivery.md](decisions/reader-delivery.md#the-story-page-was-the-surface-that-never-asked-what-a-development-record-is-2026-10-17).

- **2026-10-17 — the first body block is measured, and the class is two stories, not one.** The deck has
  its own antecedent test; the paragraph under it had none, and that is where the NTT defect sits.
  `scripts/reader-context-anchors.ts` now reports it: **15 of 159 stories** have a first body block that
  does not stand alone, and **2 of those** open on a document noun the page never names — NTT (`The
  report …`) and *Power plant attacks reflect Russian blueprint …* (`The document does not specify which
  Russian agency developed the assessment, which is titled Analysis of Ukraine's Energy, Housing and
  Utilities Sectors …`). The other 13 are readable in place (`The US had previously warned …` under a
  headline that names the US, `The latest interim release of Ubuntu …` under a deck that names it), so a
  string rule would delete a readable opening from 13 stories to fix 2. **No behaviour changed in this
  slice**: dropping the leading block, establishing the document, and withholding the story are the
  three options, each costed in
  [decisions/context-openings.md](decisions/context-openings.md#the-first-body-block-measured-2026-10-17),
  and choosing between them is a product ruling — the arbiter is not reachable from this session's
  tools, so it is escalated to the owner with the table rather than decided here.

- **2026-10-17 — the arbiter ruled the dangling-document class, and the repair it allowed is landed.**
  The case went to the ChatGPT `nyuz` project (a new chat inside the project, per AGENTS.md) with the
  measurement: 15 of 159 stories open their body on a reference the page has not established, 2 of those
  are a document nobody names, and the other 13 are readable in place. **Ruling: option 4 — repair
  first, preserve always.** Do not ship a deletion rule, do not withhold either story, repair where the
  block itself names the document, otherwise preserve and record; and *"at the 10/10 bar, silently
  losing material evidence is not an acceptable repair"*. **Landed:** `establishDocumentIdentity` moves
  a title the block already carries in front of the `The document …` that relies on it — the source's
  own words, re-ordered, nothing invented — and records everything it cannot repair. **Release report,
  frozen 200-event corpus at `HEAD` vs with the change:** 200 → 200 stories, **678 → 678 blocks**,
  **1 story changed** (*Power plant attacks…*, its opening now `The document, titled Analysis of
  Ukraine's Energy, Housing and Utilities Sectors, does not specify…`), **1 repair**, **2 unresolved
  preserved and recorded** (NTT with its figures intact, and `b11684`), **0 withheld**, **0 content
  removed**. Four tests, the repair test failing with the call removed. `audit:reader` now prints both
  rows per story, which is the ruling's auditability condition. Full record and the quoted ruling:
  [decisions/context-openings.md](decisions/context-openings.md#ruled-repair-the-opening-do-not-delete-or-withhold-it-arbiter-2026-10-17).

- **2026-10-18 — two defects read straight off the delivered page, ruled by the arbiter, and landed.**
  The 07:30 briefing had 13 cards and every must-be-zero audit line read zero, so the work moved from
  "is anything wrong" to "read what a stranger gets". Two things were wrong on the page itself.
  **(1) Card 01 opened on a welded heading** — `Ransomware with physical consequences Building
  automation systems - BAS - are …` — because The Register's feed ships the article as plain text in
  `content:encoded` and the `<h3>` subhead is joined to the next paragraph by one space; the stored
  `what_happened` is that feed lead, so the deck printed both sentences as one. Measuring a text rule
  first settled the shape of the fix: a candidate ruler matched **35 of 200** stored summaries and
  reading all 35 found **1** real weld against 34 ordinary sentences, so a pattern that catches one
  withholds thirty-four. **Ruling (#10): option 4 — split only where the article's own page confirms a
  heading with that exact text, preserve everywhere else, and recompute the stored line only for
  confirmed repairs.** Landed as `src/lib/pipeline/welded-heading.ts` (`pageHeadings`,
  `splitWeldedHeading`) plus `npm run repair:welded-headings` (dry run by default, `--apply` writes
  single rows). Live run over  the newest 200: **36 candidates → 1 repaired, 32 preserved, 3 unavailable**; the repaired row is
  `187595da-…` (*Cybercrims go beyond stealing data…*). **The first repair was only half the defect:**
  the card updated and the story page still opened on the weld, because the composer takes the deck
  from `articles.excerpt`, not from `what_happened`. So the module has two operations — drop the
  heading for the line, close the boundary to `. ` for the document — and a second run (either string
  as the candidate: **64 candidates → 1 event repaired, 59 preserved, 4 unavailable**, 1m34s) rewrote
  that article's excerpt (`e453a906-…`). Both reader surfaces verified live afterwards; the window-wide
  audit before and after is identical (`selected 1611`, `rendered 1460`, `refused 151`, `lost 0`, 69
  stories with no body, 7 readable withheld), so nothing else moved. The one reader-visible
  consequence is that this story's deck is now an attributed quote rather than the welded line —
  recomposing with the heading deleted instead of closed gives the same quote, so it is the existing
  ranking, not an artefact of the repair, and it is recorded rather than argued away. **(2) The only why-line on
  the page described the article** — card 10 printed `Why it matters · The story carries a $5,300
  figure.` under a headline and summary that already carried the $5,300. **Ruling (#10): option 2 —
  remove the three meta-statement rungs (money, CVE, headcount) and return to silence; no label, no
  inferred consequence.** Measured on the frozen 200: **5 cards of 200 lose a line, 0 gain one**, and
  the ladder still lines **9**, all by the coverage rung; the five removed lines are the MSI price,
  a `$1 million` lawsuit settlement, `$20 billion` under a SpaceX opinion piece, `$13 billion` under a
  newsletter container title and `$10 billion` under a midterm-money column. `briefing:checkpoint` on
  the delivered digest after the change: `ladder now: none 13`, `stored equals the ladder now 0/13`.
  The reasons are recorded in
  [decisions/reader-delivery.md](decisions/reader-delivery.md#a-heading-welded-onto-the-next-sentence-repaired-only-where-the-page-confirms-it-arbiter-ruling-10-2026-10-18)
  and [decisions/significance-without-a-model.md](decisions/significance-without-a-model.md#the-figure-rungs-removed-arbiter-ruling-10-2026-10-18).

- **2026-10-18 — the repair exposed a quote-as-deck, and the arbiter ruled the deck must prefer a report (ruling #10a).** With the weld gone, card 01 opened on the Freeman quote (*"The primary thing that we see with any attack on building management systems … It's a great place for the threat actor to hide," … told The Register.*) — attributed, self-contained, and not what happened. Recomposing with the heading deleted instead of closed gave the same quote, so the repair did not cause it; the composer's highest-ranked fact simply was a quotation (**3 stories of the live 200** opened that way). **Ruling: option 2 — prefer a non-quote fact, keep quotes as the fallback, keep the candidate set, the checks, the self-sufficiency rule and the order within each group untouched.** Landed in `editorial.ts` as `OPENS_ON_QUOTE` plus a two-group walk over the candidates that composed a self-sufficient sentence. **Measured the way the ruling asked**, two snapshots of the same live 200 (HEAD vs the change): **3 decks changed, 3 of them quotation → reporting fact, 0 the other way, 0 other**, words average 176.4 → 176.4, paragraphs 2.72 → 2.73, no story became or stopped being empty, every defect line unchanged (entity/metadata/attribution/context 0, two-quotes 9 → 9), citations 544 → 545. Two of the three improve (*Cybercrims* now opens on the French refrigeration hack; *honeybees* on the study's finding); **one is weaker and is recorded rather than claimed** — *MALFEX* now opens on campaign background instead of the quote that stated the finding, factual and self-sufficient but less pointed, and no rule can tell those apart without a semantic judgement. Frozen 200: 1 story changed. Tests in `editorial.test.ts` (54 in the file) cover both halves, with the preference removed the reporting-fact test fails. Record: [decisions/reader-delivery.md](decisions/reader-delivery.md#the-deck-prefers-a-report-over-a-quotation-arbiter-ruling-10a-2026-10-18).

- **2026-10-18 — the briefing and the story page opened the same story on different sentences, and the
  class now has one definition asked by both producers.** The audit's last reader-visible contradiction:
  on the deployed product, card 01 of the delivered 2026-10-18 briefing printed the Freeman quotation
  (`“The primary thing that we see with any attack on building management systems or physical systems:
  It’s a great place for the threat actor to hide,” … told The Register.`) while the story page for the
  same event (`187595da`) opened on `Late Sunday night, a still-unknown cybercriminal or group hacked
  thousands of remote-controlled refrigeration systems…`, and the same page still printed a `$5,300`
  why-line the day's pass had removed from the ladder. **Traced before anything changed:** two producers
  write a story's opening sentence — `composeArticle` picks the deck (the page) and `finalizeMetadata`
  picks `events.what_happened` (the briefing card, the alert, the search index) — and ruling #10a had
  landed the report preference in the first only. `fact.quote` never flagged the sentence: that flag is
  set only for an enriched unit the evidence pass carried as an attributed quotation, not for an RSS
  sentence that merely starts with a quotation mark, so the selection's lead was the quotation.
  **Landed:** `OPENS_ON_QUOTE` moved to [reader-evidence.ts](../src/lib/reader-evidence.ts) and is asked
  by both; `opensAsReport`/`reportingLeadOf` apply the composer's own fact-level tests
  (`OPENS_ON_QUOTE`, `unresolvedContextOpening`) over the composer's own candidate order, and
  `finalizeMetadata` uses them for **one** case — a stored line that opens on a quotation becomes the
  first report, and a quotation with nothing reporting it stands (the ruling's fallback). **Why not
  narrow the shared lead** (the first attempt): measured, it re-ordered the deck candidates and moved
  this event's own page opening from the report to a background sentence — reverted, reason in the
  helper's doc. **Why not compose the card at build:** the artifact path exists and would guarantee the
  deck's exact sentence, but it composes for the class on every build, replaces an admissible line at
  delivery, and universal summary composition is a question the arbiter has already declined; the
  producer is where the stored sentence is wrong.  **Measured:** frozen 200, one snapshot
  (`tmp/corpus-2026-10-18b.json`), six lines deleted vs landed — stored lines **0**, decks **0**, leads
  **0** changed (the audit of the same day narrowed the first of those three: the stored-line column is a
  **one-source probe**, see the ruling #11 record's corrections); live 200 — stored quote-first lines **1** (card 01), leads quote-first 3, decks
  quote-first 0, and at full fidelity (all the event's articles) the new stored line is
  **byte-identical to the deck** the story page opens on. **The why-line is staleness, not a rule:**
  `briefing:checkpoint` reads `ladder now: none 13` for the delivered window, `briefing:preview` ships it
  with no extracted figure, and nothing was added to the ladder — the next generation is the repair.
  **Live, after the deploy:** the event was marked `metadata_dirty` and re-finalized through the
  pipeline's own writer (`pipeline analyse --event 187595da…`: 1 event, deterministic finalization,
  **0 model calls**; importance 5 → 5, novelty 5 → 5, publisher count 1 → 1, `material_revision` 0 → 0
  with the same fingerprint, no new `deliveries` row), and the delivered digest (`5294a8b9`, 13 items)
  then read on production with **card 01 and the story page opening on the same sentence** — the report —
  while the old line remains on the story page in the body, where it belongs. The `$5,300` why-line:
  `briefing:checkpoint` reads `ladder now: none 13` and `briefing:preview` (tonight's 22:30Z build)
  ships 23 items with 2 why-lines, neither a figure line — the delivered page keeps its stored line
  until the next generation. **Tests red first:** with the six lines deleted, *"prefers a fact that
  reports the event over a line that opens on a quotation"* fails at `expected false to be true` and
  passes restored. Record:
  [decisions/reader-delivery.md](decisions/reader-delivery.md#the-stored-line-and-the-page-opened-the-same-story-on-different-sentences-landed-2026-10-18).

### The delivered line is the composer's sentence — the seam closed at build (2026-10-18, ruling #11)

The quote-first slice above closed the producer; the audit then measured the rest of the seam on the
live 200 and found **54 of 121** rows opening the card on a sentence the page did not (43 genuinely
different sentences, 11 attribution-framed), plus `reportingLeadOf`'s hard-coded candidate order the
composer does not share. That is a contract question, so it went to the arbiter, which ruled **Option
2** — one source of truth at the delivered surface, owned by briefing build, no model-written text, no
composition on the reader request path, no delivered archive rewritten.

**Landed.** `assessReadiness` already composes each story and refuses one that publishes no deck, so
its ready verdict now carries that sentence (`opening`, `""` for a caller that loaded no coverage).
`runDigest` keeps it in the progress record's verdicts — additively, so a record written before the
field reads as no opening and that build keeps the previous rule — and writes it to
`digest_items.summary` for every shipped item. `composedSummaryArtifact` returns it **verbatim**
(attribution frame intact, never stripped, never regenerated) and keeps the earlier recovery only for
an item whose composition published nothing; `deliveredLine`'s order is unchanged, so every surface
that already asked it gets the new line. Withhold decisions are untouched: `ready: false` never
carries an opening, and nothing is resurrected.

**Measured** (`npm run audit:delivered-line:window`, read-only, one live snapshot, both columns from the same
instrument — *before* = the same computation with no opening, i.e. the pre-ruling rule):

| measure | value |
| --- | --- |
| events | 200 |
| composer published a deck | 179 |
| delivered line === page opening, before | 131 / 179 |
| delivered line === page opening, after | **179 / 179** |
| composed openings the delivery boundary refuses | 0 / 179 |
| no-deck rows delivered from a usable stored line (the ruling's fallback) | 2 of 21 |
| no-deck rows with neither | 19 of 21 — the unbriefable class: version, canary, commit rows |

So **48 mismatches repaired, zero remaining**, and the remainder is exactly the ruling's boundary.
**Tests red first:** `readiness.test.ts` (the verdict equals `{ ready: true }` without the opening) and
`digest-summary-artifact.test.ts` (the artifact returns the stored line, not the composed opening) both
fail against the pre-change code; `reader-summary.test.ts` gains the "verbatim, frame kept" and
"empty opening falls back" controls. Suite **3393 passed / 4 skipped** at `npm run test`. Record:
[decisions/reader-delivery.md](decisions/reader-delivery.md#the-delivered-line-is-the-composers-sentence-arbiter-ruling-11-2026-10-18).

**Delivered rows.** The briefing a reader opened is the artifact, so it was measured directly too
(`npm run audit:delivered-line`, read-only, digest `5294a8b9` built 2026-10-17T22:59Z, 13 items, every
row written before the ruling): all thirteen stored summaries are empty, **6 of 13** cards opened on
their page's sentence and **7 did not**; replaying those rows through the new write path gives
**13 of 13**. Tonight's 22:30Z build is the first shipped instance — re-run that script against it
expecting 13/13, and treat any survivor as a defect unless it is a no-deck fallback.

### The ruling-#11 check is a command now, not a scratch file (2026-10-18)

The two probes that produced the numbers above were uncommitted, so the next session would have had no
way to confirm tonight's build against the accepted criterion. `scripts/reader-delivered-line.ts`
replaces both: `npm run audit:delivered-line` reads the newest delivered briefing (the reader's own
artifact) and `npm run audit:delivered-line:window [--limit 200]` reads the live window. Each run
classifies every row `agree` / `no-deck` / `defect`, prints each survivor with its class and the point
where the two sentences part, and ends on `ruling #11  PASS|FAIL  N / M card lines equal their page
opening (defects, no-deck fallback)`, **exiting non-zero on a surviving defect** (`N/A` on zero comparable
rows also exits non-zero). Reproduced live today: window `PASS 179 / 179 (0 defects, 21 no-deck)`, with
the no-deck remainder read out exactly as recorded (2 stored line, 0 recovered, 19 no line); the
pre-ruling delivered briefing `FAIL 6 / 13 (7 defects, 0 no-deck)`. It stays out of `npm run ci`
because CI tests a tree and this reads the live product. After tonight's 22:30Z build:
`npm run audit:delivered-line` must read `PASS 13 / 13 ... (0 defects)`.

### Ruling #12 landed as a bounded drain, and the drain measured (2026-10-18)

The significance line's missing input went to the arbiter (request #12) and was ruled **option 1**:
extend the clustering window to 45 days and drain the backlog in bounded batches, measuring before
scaling. Landed as `scripts/cluster-backlog.ts` / `npm run cluster:backlog` — bounded (`--limit` ≤200),
`--days 45`, `--kind` to aim a batch, `--dry-run`, printing every join with both titles and the
acceptance number (events with ≥2 publishers) before and after, failing loudly on any model call.

**Measured live, two real news batches:** backlog 7–45 days **14,657 (4,034 news, 10,090 research)**;
batch 1 100 considered → 8 joined, batch 2 100 → 10 joined, all *cross-outlet paraphrase*, none looking
false; 0 grouped, 0 failed, 0 model calls, ~40 s each; **events with ≥2 publishers 152 → 152** — the
joins land on events that already had two outlets, so the acceptance number has not moved yet. Whether
that is the corpus or `publisher_count` lagging the analysis pass is the open question now before the
arbiter; the window change is deliberately **not** applied. Also recorded: a `--dry-run` cannot see a
pair whose articles are *both* unclustered, so its zero-join runs are not evidence about the backlog.
Checklist: [docs/reader-quality-10-of-10.md](reader-quality-10-of-10.md). Record:
[decisions/reader-delivery.md](decisions/reader-delivery.md#ruling-12--the-significance-lines-missing-input-2026-10-18-and-what-the-drain-measured).

**Ruling #12a followed (2026-10-18).** The chain attach → `metadata_dirty` (migration 0102's trigger) →
`analyse` → `finalizeMetadata` rewriting `publisher_count` was verified **in the implementation first**,
as the ruling required, and then exercised: `analyse --limit 10` ran 10 events, **0 model calls, 0
tokens**, 7 s, and the acceptance number did not move — **events with ≥2 publishers 152 → 152**, because
all 18 drain joins landed on events already at ≥2 publishers. The drain also added **182 new
single-article events** (queue now 8,960 pending, 7,608 dirty) for no coverage gain. The arbiter's own
table names this row "analysis refreshes publisher counts, but the metrics do not improve", pointing at
the corpus rather than the pipeline; the source-reactivation experiment is the next ruling to seek, and
the window change is still not applied to the database.

**Ruling #12a's inspection done (2026-10-18), read-only.** Twelve multi-publisher events read row by row:
publisher keys are sound — 0 events whose key count differs from their distinct-source count, different
publishers key differently (`theguardian.com`, `bbc.com`), and one publisher's several feeds collapse
correctly — and the events are real cross-outlet stories (Red Roses, Gloucester/Bordeaux, Amazon
deforestation). The bounded backlog probe (40 unclustered news articles, ±48h, product's own `sameStory`)
found **0 eligible cross-outlet pairs**, so the newest backlog lacks the material rather than the rules
missing it. That is the arbiter's third condition: **source reactivation as a separate, budgeted
experiment** — put to it now. No drain, no window change, no source change was made.

**The two missing checklist commands landed, and ruling #12c came back ruled (2026-10-18, evening).**
The done-list in [reader-quality-10-of-10.md](reader-quality-10-of-10.md) named four commands whose exit
status is the check; items 3 and 4 had none. Both now exist, shaped like `audit:delivered-line` — one
population per run, one class per row, every non-agree row printed with the gate that refused it and the
point in the text where it parts from the bar, one verdict line, non-zero exit on a defect or on zero
comparable rows:

- `npm run audit:surfaces` (`scripts/reader-surface-audit.ts`) — the feed, the archive and the alert
  channel, each readable alone with `--feed` / `--archive` / `--alerts`. Measured: **PASS feed 57/57,
  archive 14/14, alerts 2/2 with 8 withheld by the readiness gate, 0 defects**. It also reports ruling
  #11's contract as a counterfactual at those surfaces (**9/57** and **7/14** card lines equal their page
  opening) and does not enforce it, because extending #11 to the feed is a ruling, not a repair.
- `npm run audit:alerts-gate` — the same instrument on the alert population alone, which is the "gate
  line read against the current pool" the checklist asked for. `npm run audit:alerts` stays the deep
  report and still exits 0 by design.
- `npm run briefing:withhold-preview` (`scripts/briefing-withhold-preview.ts`) — a measurement, not a
  rule: what the delivered briefing would contain if an unexplained story were withheld. **0 of 13 items
  would survive**, all silent for the same causes (no stored impact, no before/after state; 8 also lack
  the evidence the binding rung reads; all 13 have one publisher). That is the number the option-4
  question turned on, and it is why withholding cannot ship.
- `npm run baseline:sources` (`scripts/source-experiment-baseline.ts`) — ruling #12c's own instruction
  to record the baseline before enabling anything: 79 active sources, **26 withheld by the gate
  (`sources_to_collect(72)`, all "no demand for 49 days")**, 12,296 complete events, **153 with ≥2
  publishers** (the baseline, not 152), ladder over the newest 60 live events = none 56 · coverage 2 ·
  binding 1 · consequence 1.

**Ruling #12c is ruled and not started.** The arbiter approved option 2: **eight** complementary UK/US
general-news sources, per-source exemptions with the global `demand_driven_sources` flag left on, a
bounded 30-day window, three acceptance conditions (coverage above baseline; ≥1 future delivered item
with a non-coverage rung line; `briefing:checkpoint` non-zero and traceable). The eight are selected and
recorded in [decisions/reader-delivery.md](decisions/reader-delivery.md#ruling-12c--the-source-reactivation-experiment-ruled-and-baselined-2026-10-18)
(BBC Politics + Guardian Politics, BBC Health + NPR Health, BBC Science + Guardian Environment, Wired +
Engadget). The exemption itself is a schema-plus-ingest slice and is the next work; nothing was enabled,
the 45-day window is still unapplied, no archive was touched, and there were no model calls.

### Audit `audit:delivered-line` is timezone-deterministic (2026-10-21)

The instrument and the page are two processes that read the same anchor. The formatter
(`monthPhrase` / `yearPhrase` / `dayPhrase` in `src/lib/reader-evidence.ts`) used `getMonth()`,
`getDate()` and `getFullYear()`, so the day label it wrote depended on the host's `TZ`. The page
composed on the Worker's clock (UTC), the audit composed on the laptop's, and briefing
`3fcbb21c` (built 2026-10-20T22:55Z) was the visible defect — the audit read **FAIL 23/25** under
`TZ=Asia/Tokyo` and `TZ=Pacific/Auckland`, **PASS 25/25** under `TZ=UTC` and `TZ=Europe/London`.
The two defects were events whose `publishedAt` was 21 October 00:30Z, which is 20 October 20:30
in `America/New_York` (EDT, UTC-4): the page wrote `21 October 2026`, the audit wrote
`20 October 2026`.

Fix: anchored dates are written in **UTC**, carried by the `getUTC*` / `setUTC*` accessors rather
than a zone constant. The three formatters now read `getUTCMonth` / `getUTCDate` /
`getUTCFullYear`, clone through `setUTCHours(0, 0, 0, 0)`, and run shift arithmetic in UTC.
Reader-facing rendering is unchanged — the page already wrote UTC under Cloudflare. Lock-in: a
vitest describe block in `reader-prose-rules.test.ts` ("anchored relative dates do not depend on
the host's TZ") runs `scripts/anchor-probe.ts` (new) under six zones and asserts the labels match
a UTC reference; a stash-reproduce ran the formatter with `git stash`'d fix and exited red with
`received: "20 October 2026"`.

**Measured 2026-10-21, briefing `3fcbb21c`** (built 2026-10-20T22:55Z, 25 items): audit under
`TZ=UTC`, `America/New_York`, `Asia/Tokyo`, `Pacific/Auckland`, `Europe/London`, `Asia/Kathmandu`,
`Europe/Berlin` is **byte-identical**, `ruling #11  PASS  25 / 25 card lines equal their page opening
(0 defects, 0 no-deck fallback)`, the real verdict for that deck. The pre-ruling counterfactual
stays at 14/25 (the rule predates ruling #11 and is printed beside the new number so the
before-and-after stays reproducible in one run). Suite: `npm run typecheck` clean,
`npm run lint` clean (0 errors; 20 pre-existing fast-refresh warnings on unchanged files),
`npm run test:coverage` 3,465 tests green,
`GITHUB_ACTIONS=true npm run coverage:ratchet` no regression against the committed floor
(`src/lib` lines 85.62 → 86.79, +1.17pp). Record: [decisions/anchored-dates-utc.md](decisions/anchored-dates-utc.md).

**2026-10-20 — ruling #11 is enforced at the feed and the archive, by one resolver, and the price is
recorded.** `audit:surfaces` used to report the contract as a counterfactual (`9/57` feed, `7/14`
archive) and the checklist said extending it was a decision. Enforced now: `src/lib/reader-opening.ts`
holds the single rule (`storyOpening`) the card, the story page and the instrument all call — the
delivered line through `deliveredLine`, the story's own recovered opening when there is none, nothing
for furniture — and `story-article.tsx` opens on that same sentence, with `withoutOpening`
(`reader-article.ts`) keeping the body from repeating it (`19 of 56` stored lines were a whole
sentence inside a composed paragraph; `0` took part in a `glue` pair). `summariesFor` in
`briefing.ts` puts the reader's newest `digest_items.summary` into `loadStory`, search and the
matches feed, so the page and the card resolve one input. Measured same day, live: **feed 53/53 (3
no line, 0 defects), archive 25/25, delivered briefing `4a6b2ad2` 25/25 exit 0**; the old rule read
`13/54` and `15/22` on the same rows because the page recomposed from current coverage while the
card carried the delivered sentence. The trade, recorded rather than hidden: the page opens on the
delivered line, not a freshly composed deck, because composing per card costs 61 ms p50 / 173 ms p90
over 56 stories and cannot run on the free plan's CPU or in a feed render. Three feed cards still
print no line (furniture, the 2026-10-14 ruling) and their pages open on a composed deck — an
absence, not a contradiction. No model call, no database write, archives untouched.
Record: [decisions/reader-delivery.md](decisions/reader-delivery.md#one-sentence-at-the-feed-and-the-archive-ruling-11-extended-2026-10-20).

**2026-10-21 — both instruments above were tautologies on two of three surfaces, and are now able to
fail.** The CEO's refusal of PR #30 measured the defect: the feed passed one artifact to both sides
of `classifyCard`, and `audit:delivered-line` built its `page` and `actual` from the same
`item.summary` expression — identical input to one function, so the equality was guaranteed and
`feed 53/53` and `PASS 25/25` were not evidence. `classifyCard` now takes the card's artifact and the
page's artifact as separate arguments; the card side reads the row that surface's loader hands it
(the newest briefing's own stored `summary`, or the reader's newest artifact on the matches path) and
the page side reads the reader's newest delivered row. `audit:delivered-line` reads its page side from
that newest delivery by its own query rather than rebuilding it from the audited item. The feed
population is now the cards a reader is actually shown, modelled on both branches of `loadHomeFeed`,
which is why the feed count moved. The doc comment no longer claims two sides read different rows on
the matches path, where they are one row by design; it names the render tests instead.

The instructive part is what the seed did *not* cover. `selfTest()` first classified two literals, and
`--fixture` exercised `classifyCard` directly — so with the card side collapsed back onto the page's
row at the **call site**, the real runs still printed `PASS feed 23/23` and `PASS 25 / 25`, because on
today's data the two rows are the same row and a correct instrument is indistinguishable from a
tautological one by output alone (measured 2026-10-21, both collapsed deliberately). The self-tests now
call the *named* row-selection functions (`cardArtifactFor`; `cardArtifactOf`/`pageArtifactOf` and
`pageSentence`), which the live path also calls, and each collapse is then caught with exit 1 and "the
check cannot fail" before a row is read. A fixture that cannot fail is worse than no fixture, because
it is evidence.

Measured on the merged tree, Node 22: typecheck clean; lint 0 errors (20 pre-existing warnings); 204
test files / 3472 tests pass; coverage floor no regression (total 45.41, +2.55pp); `audit:surfaces`
PASS feed 23/23 · archive 25/25 · alerts 4/4; `audit:delivered-line` PASS 25/25 on briefing `4a6b2ad2`;
both `--fixture` modes FAIL with one defect and exit 1. Counts that moved, as findings and not as
tuning targets: **feed 53 → 23** (53 was a sample of newest matched events, not a feed); archive 25
and delivered 25 unchanged. No model call, no database write, archives untouched, instrument-only.

**Gate 2's evidence ledger, and the two bars it cannot choose between (2026-10-20).** Item 2 parked its
verdict on ruling #12c's calendar, so the thing that was missing was not a rule but an instrument: nothing
in the repository enumerated *delivered items inside the window* and recorded what the ladder would say
about each. `npm run audit:significance-window`
([scripts/significance-window-audit.ts](../scripts/significance-window-audit.ts)) is that instrument,
read-only and deterministic. It reads the window from `source_exemptions` (the row the gate honours, not
a literal), enumerates every briefing whose `generated_at` falls inside it, re-derives the ladder per
delivered item with `reasonFor` on the same inputs `briefing:checkpoint` reads, and writes
[docs/audits/significance-window-12c-30d.json](audits/significance-window-12c-30d.json) — 25 events,
one copy per event with delivery rows referencing event ids, so the record survives a redeploy and does
not copy event content per reader ([database.md](database.md)'s cost model).

**First real output, measured 2026-10-20T07:39Z** (`npm run audit:significance-window`, exit 0): window
`2026-10-19T06:46:22Z → 2026-11-18T06:46:22Z`, 8 of 8 enabled rows, **5 briefings generated, 1 with
items, 1 sent, 4 skipped, 3 readers, 25 delivered items, 25 distinct events**; `ladder now: consequence
1, coverage 1, none 23`; `carried any line at all 1 / 25`; `stored equals the ladder now 1 / 25`;
`ladder now yields a line 2 / 25`; verdict **`gate 2  PENDING  window closes 2026-11-18 06:46:22Z`**. The
closed branch was exercised on the same rows with `--now 2026-11-18T07:00:00Z`: `UNDEFINED`, exit 2.
Also measured in the same run, for ruling #12c's other legs: events with ≥2 publishers **184 vs the 169
baseline**, and 3 delivered items sit on an event with an article from one of the eight fetched inside the
window.

**The finding is a definition gap, and it decides the verdict.** The checklist states a **universal** bar
(*"every delivered item either carries a line a stored fact justifies, or is not delivered"*,
[reader-quality-10-of-10.md](reader-quality-10-of-10.md) 12–14) and ruling #12c states an **existence**
bar (*"at least one future delivered briefing item carries a valid, story-specific line from a rung other
than coverage"*, [reader-delivery.md](decisions/reader-delivery.md) 3391), which the handoff adds
attribution to (*"did the eight … produce at least one"*,
[handoff-2026-10-19-afternoon.md](handoff-2026-10-19-afternoon.md) 35). On today's rows the first reads
**FAIL 1 / 25** and the second reads **PASS** — card #08's consequence line (*"The company will be
refunded the $2 million deposit and receive a breakup fee."*) is story-specific, traces to the event's
evidence, and that evidence is **Wired**, one of the eight, fetched `2026-10-19T11:00Z`. The checklist's
*"or is not delivered"* also contradicts ruling #12's *"do not withhold publishable stories for a missing
line"* (lines 66–67), so the universal bar cannot be met by the product as ruled today. The checklist's
`stored equals the ladder now` is labelled a drift check but carries no passing threshold, and card #16
shows the other seam: its event would now produce the `coverage` line while the delivered row carries
nothing. **No metric was invented.** The instrument prints every documented bar's number and refuses a
single verdict; the quoted lines, six missing definitions, four numbered options and the recommended
two-leg resolution are in
[decisions/significance-window-instrument.md](decisions/significance-window-instrument.md). That ruling
is the blocker on gate 2, not the calendar alone.

Files: `scripts/significance-window-audit.ts`, `package.json` (`audit:significance-window`),
`docs/audits/significance-window-12c-30d.json`, `docs/decisions/significance-window-instrument.md`,
`docs/reader-quality-10-of-10.md`, this file. No model call, no database write, no product behaviour
change.

**2026-10-20 — gate 2's verdict is ruled: two legs, one instrument, and the population narrowed on
cross-examination.** The definition gap above went to the arbiter (the owner's ChatGPT `nyuz` project,
chat *"Gate 2 Ruling"*) with the four options and the measured rows. **Ruling #17: option 3** — _"The
universal reader-quality bar and the experiment's existence condition are distinct tests. Neither may
substitute for the other."_ Gate 2 is now **Leg A** (universal: every delivered briefing item carries a
non-empty, story-specific line, agreed with the ladder re-derived now under the existing canonical
comparison and traced to its stored material; `coverage` eligible; a missing line is a failure and still
no reason to withhold, per ruling #12 option 1) and **Leg B** (existence: at least one qualifying item on
a rung other than coverage, traced to stored evidence **and attributable to one of the eight released
sources** — the attribution the handoff stated and #12c omitted, now recorded with the outlet and its
fetch time). The same rows read **Leg A FAIL 1 / 25 · Leg B PASS** (#08, `consequence`, Wired, fetched
`2026-10-19T11:00:15Z`). A re-read on **2026-10-20T23:48Z**, window still open, reads **6 briefings (2
with items), 50 delivered items, 3 readers, Leg A 2 / 50, Leg B 2 / 2** — #09, _French Government Calls
Emergency Meetings…_, also `consequence` on Wired, fetched `2026-10-20T19:30:14Z` — `gate 2 PENDING` exit
2: the population doubled overnight and the silence with it (47 of 50). The ledger committed with the
08:42Z snapshot stays that snapshot; the 18 November run replaces it.

**One cross-examination changed the population.** The first ruling extended Leg A to "all delivery
surfaces included in the checklist"; the feed's matched-story path never carries a `why_it_matters` line,
so that would have counted ~57 cards as failures by construction. Put with the code paths (the feed's two
paths, the archive re-rendering the same `digest_items`, checklist item 3 owning the shared card bar), the
arbiter withdrew it — **#17a: _"I extended the significance-line requirement to surfaces governed by a
different checklist item. That was too broad."_** Leg A is "delivered briefing items (`digest_items`)
generated within the authoritative experiment window"; the archive's re-render of those rows is not
counted twice, and the feed's matched-story cards and the alerts stay under item 3 — "do not classify
absence of why_it_matters as a Gate 2 failure."

**The instrument now prints the ruled verdict, and its exit status changed.** `PENDING` (window open)
exits **2**, not the old 0 — an unfinished experiment must not read green; a closed window exits 0 only
when both legs pass, 1 when either fails, and 2 when the evidence or population is incomplete. A pre-close
run records the counts and **no leg verdict** (the ledger's leg verdicts are `null`), because PASS or FAIL
before the close is forbidden. Measured 2026-10-20T08:42Z on the open window: `gate 2 PENDING window closes
2026-11-18 06:46:22Z … exit 2`. Exercised on the same rows with `--now 2026-11-18T07:00:00Z`: `gate 2 FAIL
Leg A FAIL (1/25) · Leg B PASS (1 qualifying) exit 1` — the shape 18 November will produce, **not** the 18
November reading, which is still owed on the rows delivered by then.

Files: `scripts/significance-window-audit.ts`, `docs/decisions/significance-window-instrument.md`,
`docs/reader-quality-10-of-10.md` (item 2's sentence and the state row now state what a PASS is),
`docs/audits/significance-window-12c-30d.json` (regenerated with the `verdict` block and the ruling it was
read under), this file. Read-only and deterministic: no model call, no database write, no product
behaviour change, no withholding rule added.

**2026-10-21 — the production audit went red on a new vite advisory, and a patch-level pin closed it.**
`npm audit --omit=dev --audit-level=high` began reporting `vite@8.1.5` as **high** severity when three
launch-editor advisories were published (GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm),
so **Dependencies and secret names** failed on every branch including `main` and the deploy job was
skipped — nothing in the tree changed; the advisory feed did. `vite` is reachable from production
dependencies (`package-lock.json` carries no `dev` flag on it), which is why `--omit=dev` audits it. The
exact pin moved **8.1.5 → 8.3.4** (npm's named fix), with `postcss` 8.5.31 and `nanoid` 3.3.20 re-resolved
inside vite's own ranges and no range of ours widened. Re-read: **0 vulnerabilities**. Same shape as the
2026-10-16 `@tanstack/*` bump above.

**2026-10-21 — read the live product as a reader: one welded paragraph, a briefing that cannot be
read from, and an alert channel firing on a tablet discount.** Read at 01:04–01:30Z on `f0b2761`
(bundle `assets/index-_3YT2emD.js`, CI run 39524919444; the origin still served
`assets/index-Dj2sHqc7.js` at 01:04Z, so the read spans that deploy). 25 cards in the feed and the
same 25 in the delivered briefing. **24 of 25 card lines equal their story page's opening sentence**;
the exception is `How 3 Java Champions…`, whose card line is `Meet the Java Champions.` Story 17
(Samsung's Pyeongtaek hub) carries a sentence verbatim from MIT Technology Review's 2026-08-26
Hugging Face piece, mid-paragraph and uncited. `/dashboard/briefing` has **zero story links** under a
footer that says every story links to the original reporting. **6 of 25 story opens returned an error
page** (Cloudflare 1102, 503, "Something failed on our side", blank) on a back-to-back sweep; each
returned 200 in 7.7–11.2 s when paced, so the failures are load-shaped. Alerts had fired **5 times by
09:16**, including a Fire HD discount and an Oblivion FPS mod, on a surface that says most days are
silent. An anonymous browser gets `/auth` on every reader route (HTTP 200, client-side), so the read
was taken **read-only** in a browser holding a reader session. The deck is the 07:30 JST one, so it
was composed by 22:30Z 2026-10-20, **before** `f0b2761` merged at 01:02Z — its text is evidence about
the composer up to that point, not about the merge. Report and screenshots: [live-read-2026-10-21.md](live-read-2026-10-21.md),
Screenshots were captured locally and are not committed. No product code, no deploy, no
migration, no write to production.

**2026-10-21 — the six defects read in the delivered deck `3fcbb21c` are closed, one rule each.** Scout read
the post-merge briefing (25 cards, built `2026-10-20T22:55:38Z`) as a stranger and found six defects; the
full record, the rule and the test per defect are in
[decisions/delivered-briefing-prose-defects.md](decisions/delivered-briefing-prose-defects.md#the-six-defects-scout-found-in-the-post-merge-deck-closed-2026-10-21).
Landed: `truncatedDateline` (a day-and-year dateline cut before the sentence, refused as `editorial_noise`);
`brokenQuotation`, folded into `unresolvedContextOpening` so the deck walk advances past a sentence that
starts inside somebody's quotation; the **result leg** in `suppressStoryTwins` plus its floor in
`twin-floor.ts` (one PRIMARY actor, a frame phrase on one side and an earnings term on the other); the wrong
article before an amount (`an $150`) and `prep + it's` in `sourceTypo`, with the title rung in
`assessReadiness` withholding a card whose *headline* carries the source's typo; and `fillerOpening` at the
deck walk, so a heading or a definition is skipped instead of opening the story. The closing-bracket
possessive (`(BSC) ’s`) is joined rather than refused, because the space is the extractor's and the source's
own excerpt has none. **Measured on the same 25 rows recomposed (scratch probe):** 7 openings change, 0 are
withheld, 1 title typo, and the twin pass keeps **24 of 25** — dropping position 8, The Verge's second
telling of the SpaceX release, which is the 25th card. `npm run audit:twin-corpus` over 30 days shows the
result leg fusing **1 pair**, the delivered duplicate; the marker census still reports its pre-existing
**184** below-floor fusions, untouched. A count of **23** for this deck after all six rules is a finding and
is reported: 24 after the twin fusion, minus card 24 for its headline typo. `npm run audit:delivered-line`
stays **PASS 25/25** on the archive because that instrument reads stored artifacts and the rules changed no
stored row.

**Design audit of the deployed reader surfaces (2026-10-21).** The signed-in product was read at
1280 / 768 / 360 plus a 320 px reflow probe — feed, briefing, archive, story, alerts, alert history —
with every number measured from the live DOM and the evidence committed under
screenshots captured locally (account name and avatar redacted), not committed. Record:
[design-audit-2026-10-21.md](design-audit-2026-10-21.md). Two blockers on the briefing: it renders its
**25 stories with zero links** (the marketing `BriefingPreview` was mounted in the product unchanged, so
the surface is a dead end), and it sets **144 characters on a 911 px line** where the rest of the product
runs 88–109. Should-fix: two `<h1>`s on every desktop dashboard page; the briefing's `H1 → H3` skip with
no headings on its 25 items; archive rows that respond only on a 76×19 text link; a 13-month strip hiding
9 months behind an invisible horizontal scroll; no authored focus ring on nav and icon controls; story
prose at 109 cpl; a 46×19 dismiss button; and briefing copy claiming an inbox delivery that email — dark
until launch — does not perform. Measured as sound and not to be changed: the three-colour palette in the
DOM, a 5.20 contrast floor, no horizontal overflow at 320–1280, and one page-header pattern across five
surfaces. No product code changed and no vote, save, dismiss or preference was touched.

**Anchored dates: the unused `ANCHOR_TZ` constant removed (2026-10-21).** Hygiene, no behaviour
change. `src/lib/reader-evidence.ts` declared `const ANCHOR_TZ = "UTC"` with a 13-line rationale
comment and never read it — the three formatters and the `atUTC` clone use `getUTC*`/`setUTC*`,
which take no zone argument, so there was no behaviour-preserving way to consume the string short
of calling it from nowhere. The declaration was removed and its rationale moved onto `atUTC`, the
function the UTC pinning actually lives in, with the note that the zone is carried by the accessors
rather than by a name. Two records named the symbol as "declared once" — this log and
`docs/decisions/anchored-dates-utc.md` — and both were corrected in the same commit so neither
falsifies the tree. No UTC getter, no setter and no label changed; the formatter's behaviour is
byte-identical, and the timezone-determinism describe block in `reader-prose-rules.test.ts` is the
witness. Origin: fast-forwarding PR #37 onto `origin/main` at `058f049` (docs-only), which carried
`afaad5c` plus the merge; `origin/main` then moved to `f77e448` (PR #40) while the PR was open, so
the branch was merged forward again onto it, keeping this log an append-only union.

### The briefing became a way in and a reading column — B1 and B2 landed (2026-10-21)

The two blockers from that audit are fixed in `wt/briefing-blockers`. `/dashboard/briefing` now mounts
`BriefingPreview` as `variant="reader"` instead of the marketing facsimile, so **each of the 25
headlines is a `Link` to `/dashboard/story/$id`** — the whole row stays inert, the headline is the
target, and text selection and the 25-row rhythm are unchanged. The summary moved from 13.5 px to
14.5 px and the card is capped at `max-w-[32rem]` and centred, with the page header, chips and footer
note still full width; `src/lib/briefing-measure.ts` holds the cap, the padding, the type size and the
measured Manrope advance, so the surface and the assertion read the same numbers.

**Why 32 rem and not the audit's 37 rem:** the cap was chosen from a measurement, not the
recommendation. Rendered in the product's own content column (dev server, real component, compiled
stylesheet and Google-font Manrope) at 1280, the summary's characters per full line were —
cap 592 px (the audit's) **median 80 / max 85**, 528 px **70 / 76**, 520 px **69 / 74**, **512 px
68 / 73**, 500 px **65 / 71**, 480 px **63 / 69**. Only 512 and 520 sit inside the 65–75 bar, and
512 keeps two characters of headroom for the real corpus: over the 25 delivered lines in
`docs/live-read-2026-10-21.md` §1 the narrowest-charactered line fits 74.4 at a 454 px column. Before
the fix the same surface measured **144** (audit), and the delivered card's column is now
512 − 2 (border) − 56 (`px-7`) = **454 px** at 14.5 px.

**Measured after, at 1280 / 768 / 360 / 320:** card 512 / 512 / 320 / 280, summary column
454 / 454 / 278 / 238, **25 anchors at every width**, `cursor: pointer` on all of them, no `tabindex`
attribute, a keyboard walk that stops on the story links **in reading order** with
`box-shadow: …2px offset + 2px --ring` and `outline: none` (the authored ring replaces the UA outline),
and **no horizontal overflow at any width** (scrollWidth = innerWidth at all four).

**Tests, not screenshots.** `src/components/briefing-preview.test.ts` renders 25 stories and asserts 25
`href="/dashboard/story/<id>"` in document order, no `tabindex`, `cursor-pointer` and
`focus-visible:ring-2` on each link, **zero anchors for the marketing variant** (the landing page's
fixtures must not link), the summary at the constant's size, and the characters-per-line figure at
65–75 — with the class and the pixel value cross-checked so one cannot move without the other.
`npm run audit:delivered-line` is unchanged (**PASS 25/25**): no stored row, digest or prose was
touched.

**Deferred on purpose:** the audit's nine should-fix findings (S1–S10: duplicate `h1`, briefing heading
level, archive row target, month strip, focus ring on nav, story measure 109, install-card target, the
email framing copy, the two score scales, the stale palette comment) are a follow-up task, listed in
this PR's body and not expanded into it. One known boundary of B1's link contract at the time: the
story page's reading queue had two sources (`home`, `alerts`), so a story opened from the briefing
paged in feed order, and `loadHomeFeed` happened to read the same digest for the warm case — measured
later on the deployed origin: that assumption does not hold on the live corpus, and the feed gates
the briefing's last entry (deals and mods are wider than the digest is), so today's briefing is 25
stories and the feed is 24 of them. The paging shape at the time of this slice was correct; the
follow-up that names the briefing as its own queue source lives in the next entry.

### The briefing fix passed design sign-off on the deployed origin (2026-10-21)

PR #40 merged as `f77e448` and deployed by run `39556590513`; `docs/design-signoff-2026-10-21.md` records the
acceptance pass, read on the live Worker (`https://nyuz.grgvishal-gurung17.workers.dev`) signed in as a reader at
1280 / 768 / 360. **B1 PASS:** 25 stories → **25 anchors, 25 unique ids, 0 `tabindex`, `cursor: pointer` on all 25**,
**25/25 links opened the matching story** (headline compared page by page), the `Tab` walk reaches the 25 links in
document order after the nav/header/chips, and focus carries the product's ring
(`oklch(0.53 0.12 240)` 2 px on a white 2 px offset, `outline: none`) on every card (single shared class). Back from a
briefing-opened story returns to `/dashboard/briefing`. **B2 PASS:** at 1280 the card is 512 px, the summary column
**454 px** at 14.5 px, and 59 full rendered lines measure **median 66 / max 72** characters per line (was 144); 768 is
identical; 360 reflows to a 305 px card and a 263 px column with **no horizontal overflow** and the same 25 links.
The characters-per-line figures were measured by walking a `Range` over each paragraph and grouping glyphs by line
top, not estimated.

**The sweep found the fix leaked only where it was allowed to.** Feed card summary still 14 px / 619 px column / median
96 (audit baseline 94); story body still 14.5 px / 669 px column; archive and alerts structurally identical. The shared
component's 13.5 → 14.5 px step did move the marketing card on `/`, and it **improved** that card's measure from ~80 to
**72–73** characters on its 490 px column while leaving it 548 px wide, link-free and intact at 1280 and 360.

**One should-fix came out of the pass, and it qualifies a claim in the entry above.** A story opened from the briefing
prints **`1 of 24 in your nyuz`** while the briefing the reader left says **25 things worth knowing** — the feed holds
24 stories and the briefing 25, so the "same list" assumption does not hold on the live corpus, and the `←` / `→` keys
and pager cards walk the feed from a briefing entry. Either `briefing` becomes a queue source or the position line is
suppressed when the entry context is unknown; the link itself is right and the reader can get back, so it is not a
blocker. Recorded rather than fixed: this task is a sign-off, not a code change.

### The briefing is now a queue source — the pager says "your briefing" from a 25-link briefing (2026-10-22)

The should-fix the design sign-off left as recorded-not-fixed lands here. The numbering is fixed by making
the briefing itself a queue source, not by hiding the position when the entry context is unknown.

The path is small and lives in three files:

- `src/lib/use-reading-queue.ts` — `briefing` joins `QUEUE_SOURCES` (the closed union the URL `from=` narrows
  against). The source's `queryKey` is the briefing page's own for the Today tab (`["briefing", "today", "latest"]`),
  the `queryFn` is `loadDigestStories()`, the `select` projects id / title / topics the pager asks for, the
  `staleTime` matches the briefing page, `label: "your briefing"`, and `respectsFeedback: false` because the
  briefing page does not filter its own list against the feedback store. Reading it after a briefing tab is a
  cache hit on the reader's next navigation; opening the story cold from an email or push is one fetch on the
  briefing loader, identical to the briefing page's own cost.
- `src/components/briefing-preview.tsx` — the `Link` accepts a new `fromQueue?: QueueSource` prop. The prop is
  passed only when the page that mounts the preview wants the story-page pager to walk the list the link came
  from; the marketing facsimile ignores it and the reader-view without `fromQueue` keeps the clean URL the
  previous tests assert.
- `src/routes/dashboard/briefing.tsx` — passes `fromQueue="briefing"` only on the Today chip. The Saved chip
  is not a queue (its length is "what the reader saved", not "what was delivered") and the History view is
  not a queue (a different day, retention-gated), so neither passes it and the link stays clean. A bare
  story URL keeps the story page's default `home` source: it prints the feed's own position when the story
  is in the feed, and `buildQueue` returns its empty queue — no position, no pager — when it is not. Neither
  case names the saved list, so neither can contradict the number the reader counted there.

**Why adding a queue source rather than suppressing the position line.** The queue source gives the reader the
correct list (the 25) and the correct key shortcuts (`←` / `→` walk the briefing); the suppress option loses the
pager entirely for that entry path. A reader who opens a story from the briefing is already on a known path
through a known list — the same edition the briefing page rendered — and the audited list of ten-card
briefings makes the pager the useful thing. The Saved tab is not in this scope because its count disagrees
with the briefing by construction: making `from=briefing` the only-when-today flag keeps the saved bookmark
honest.

**Tests, not screenshots.** `src/components/briefing-preview.test.ts` renders 25 stories as `variant="reader"`
with and without `fromQueue` and asserts: 25 anchors, each href ends `/dashboard/story/<id>` (no `from=` when
the prop is omitted); 25 anchors, each href ends `/dashboard/story/<id>?from=briefing` (with the prop set).
The same file's existing assertions — `cursor-pointer`, `focus-visible:ring-2`, `focus-visible:ring-ring`,
zero anchors for the marketing variant, the `max-w-[32rem]` cap, the 65–75 characters-per-line range — are
unchanged and remain green. `src/lib/use-reading-queue.test.ts` is new and asserts `asQueueSource` narrows
`"briefing"`, `"home"`, `"alerts"` and refuses a hand-edited URL value (`"saved"`, `"archive"`, the empty
string, `undefined`, numbers, objects).

**Counter on `src/lib/reading-queue.test.ts`'s contract.** `buildQueue` itself is unchanged: same return
shape, same `respectsFeedback` semantics. The change is purely a new source that hands it a different list
to walk; the build rules the seven existing tests pin down continue to hold, and the 25 / 24 asymmetry is
solved in the source, not in the queue model.

### The archive became one target and the story found its column — S3, S4, S6, S7 (2026-10-22)

The four units `docs/design-spec-2026-10-21.md` assigns to rook, on `wt/spec-rook`, one commit each.
Every number below was read off a browser — Playwright against the shipped components and the product's
own stylesheet, with Manrope asserted loaded before each read, because a fallback face is 3 px wider on a
button label and was enough to fake a layout move until the probe waited for the real one. The harness
lives in an untracked `.harness/` and never ships.

**S3 — the day card is the way in.** The card was a `<div>` whose only target was a **76 × 19**
`Open briefing` anchor: 1 % of a 956 × 112 box, no hover state, the other 99 % doing nothing on click. It
is now a `Link` carrying the alert card's own vocabulary (`block rounded-3xl border border-hairline
bg-surface transition-colors hover:border-foreground/20`) with the label demoted to a `<span>` +
`group-hover:text-foreground`, so there is no nested anchor and no second focus stop. Measured at 1280 /
768 / 360: **one anchor per day-with-stories card, sized to the card** (956 × 111.5 at 1280), the skipped
day still an inert dashed `<div>` with **0** anchors, `document.querySelectorAll("a a").length === 0`,
**0** focusable descendants inside a card, `cursor: pointer` over the whole box, the border warming
`oklch(0.925 0 0)` → `oklab(0.16 0 0 / 0.2)` on hover, and a click at the card's centre landing on
`/dashboard/briefing?digest=<the day clicked>` — compared against the clicked id, not merely that a
navigation happened. The two riders the spec attaches land in the same commit: **P2** (`rounded-2xl` →
`rounded-3xl` on the day card) and the archive's **H1 → H3 skip** (`h3` → `h2`; the archive renders
`h2` × 3 and `h3` × 0).

**S4 — thirteen months, none of them behind an invisible scroll.** The strip was one 1,288 px row inside
a 977 px container, so 3 of 13 months were unreachable at 1280 without a scroll nothing announced, and
about ten at 360. The nav keeps `overflow-x-auto` for the phone and gains `sm:overflow-visible`; the row
gains `sm:min-w-0 sm:flex-wrap`; below `sm` it stays one snapping row (`max-sm:snap-x
max-sm:snap-mandatory max-sm:scroll-px-2`) with an alpha-only edge fade on the scroller itself, which is
where it has to be — a fade element inside a scroller scrolls away with the content. Measured: **13
buttons at every width**; at 1280 `scrollWidth === clientWidth === 984`, at 768 `712 === 712`, computed
mask `none`, snap `none`, every button inside the nav's rect, strip 88 px tall as two wrapped rows
(the spec's limits are 120 and 160); at 360 `scrollWidth 1,311 > clientWidth 320`, mask
`linear-gradient(to right, rgb(0,0,0) 88%, rgba(0,0,0,0))`, `scroll-snap-type: x mandatory`, and
scrolling to the end (991 px of travel) puts `October 2025` fully inside the nav. No page-level
horizontal overflow at 320 / 360 / 768 / 1280, and the labels are still 13 px with `text-overflow: clip`
and no ellipsis anywhere in the strip.

**S6 — the story reads as a column.** One constant, `PROSE_MEASURE = "max-w-[34rem]"`, on the deck and on
the body container only. The headline keeps its 46.4 px track (684 px, unchanged) and its meta line, the
260 px rail is still the page's right edge (`right 1252 === content right 1252`), and no type size,
line-height, paragraph gap or grid moved. Measured at 1280 with the measure lifted on the same elements,
so both sides are one browser and one font: prose **684 → 544 px** and its longest rendered line
**105 → 81 characters**, the deck **91 → 74**; at 768 the same columns give **640 → 544 px**, **98 → 81**
and a deck **85 → 74**; at 360 nothing changes (320 px both ways, 48 and 47 characters), which is what
the spec expects. **The deck lands inside the spec's 68–76 band; the body does not land in its 85–92
band, and the spec's own arithmetic is why.** It converts the audit's "109 characters in 669 px" into
**6.14 px per character**, but Manrope 400 at 14.5 px measures **6.48 px** per character on rendered
prose here (the audit's figure is about 5 % tight, plausible from a single line), so 544 px tops out at
**84** characters on a perfectly packed line — the band needs at least 551 px, and **36 rem measures 89**,
which is the spec's own target rather than the 94 it predicted. The rendered ratio agrees with itself:
body/deck is 81/74 = **1.095** against the 16/14.5 font ratio of **1.103**, while the spec's 89/72 =
1.236 would need a 12 % font step. 34 rem is the spec's explicit instruction and the narrower of the two,
so it shipped as written; widening it to 36 rem is one constant if the arbiter prefers the band to the
number.

**S7 — the one tap target under 24 px.** The install card's `Not now` control measured **46.8 × 18.8** — a
`<button>`, so WCAG 2.5.8's inline-text exception does not apply, and the spec's "46 × 19" reproduces.
It gains `inline-flex min-h-6 items-center px-2 -mx-2`. Measured as an A/B against the pre-change card in
the same browser, at the same width and in the same theme: **62.8 × 24** in light and dark at 360 and
1280, the label's own box at **464.9 / 187.3** before and after (**0 px** of movement), the card's height
**167.6** at 1280 and **235.9** at 360 in both, and the `Install Nyuz` button unchanged at 99.9 × 36. The
two captures are **byte-identical**, which is the promise in one artifact: the hit area grew and not one
pixel moved. The four 32 px `IconToggle`s are untouched by design — the spec defers them to the day the
action row is touched. Note for whoever reviews this against the task card: the card asks for "≥ 44 px",
but the spec rules 44 px out for this slice and a 44 px-tall control would change the card's height,
which the same spec forbids; 24 px is the floor it names and 62 × 24 its target.

**Open question, recorded rather than decided.** The skipped-day card still carries `rounded-2xl` while
the clickable day card is now `rounded-3xl`, so the archive draws two radii in one list. The spec's "must
not move" list protects the skipped card's dashed treatment and says nothing about its radius, and
`AGENTS.md` forbids moving a radius where no acceptance measure asks for it, so it was left alone. If the
archive should read as one card family, it is one class on the skipped card.

Gates on the final tree: `npm run typecheck` clean; `npm run lint` **0 errors** (22 pre-existing
fast-refresh warnings on unchanged files); `npm run test:coverage` **3,516 tests across 205 files green**;
`GITHUB_ACTIONS=true npm run coverage:ratchet` **no regression against the committed floor** (total
statements 45.58, and no area negative). `npm run audit:delivered-line` is **unchanged**: `ruling #11 PASS 25 / 25 card
lines equal their page opening` on briefing `4a6b2ad2`, the value this file already records, and the
audit reads the composer and the database, neither of which this slice touched — the diff is class
strings, one `max-w` constant and one heading element name. Captures: `docs/screenshots/` is git-ignored
as of `861d711`, so the nine (archive and story at 360 / 768 / 1280, install at 360 and 1280 before and
after) live in the worktree and with the task, not in the repository.


### One answer to "what page is this", and one focus ring — S10, S1, S5 (2026-10-22)

**S10 — the palette comment describes the product that is here.** `src/styles.css:46-60` said "three
colours only: black, white, and one red", that the red sat at hue 27, and that it measured 5.58:1. The
tokens have been blue since `d759061` (2026-08-25): `--signal: oklch(0.53 0.12 240)` light,
`oklch(0.72 0.12 240)` dark. The block now says hue 240 and quotes pairs **re-derived on 2026-10-22**
from those two values through OKLab → linear sRGB → WCAG luminance: **5.1997:1 light, 8.1069:1 dark**,
i.e. the 5.20 and 8.11 it states. Comment only: the diff is 31 insertions and 12 deletions, every one a
comment line, and no `--token:` value moved. `--destructive`'s reason is corrected because the old one
was true only of a red accent. The one thing the comment does **not** do is explain why blue replaced the
red: nothing in the repository records that ruling, so the block says it is unrecorded and leaves it to
the arbiter instead of putting an invented reason in the file every designer opens first.

**S1 — one `<h1>` per desktop dashboard page.** The shell's location label was an `<h1>` beside
`PageHeader`'s own, so every dashboard page at ≥1024 px answered "what page is this?" twice. It is a
`<p>` now with a **byte-identical class string** — same 15 px medium muted copy, same `lg`-only
visibility — so nothing looks different. Measured in Chromium against the built Worker, signed in, at
1280 and 360: `/dashboard`, `/dashboard/briefing`, `/dashboard/history`, `/dashboard/alerts` and
`/dashboard/alerts/history` each report **`document.querySelectorAll("h1").length === 1`** and
**`header h1 === 0`**, the label is a `P` at 15 px / 500 (on `/dashboard/briefing` it reads "My
briefing"), and at 360 it is still `display: none` with the count at 1. No layout shift: the `h-16` row
measures **64 px** before and after (the `<header>` box is 65 with its border), the label's own box keeps
`margin: 0` and its 22.5 px line. The two transient `StaffOnly` states that render the shell with no
`PageHeader` now carry zero headings, which is the spec's own decision, not an oversight.

**S5 — the chrome wears the product's ring.** `focusRing` is exported once from `kit.tsx` and
`buttonClass` consumes it, so its output string is byte-identical. The constant reaches the fourteen
chrome stops the audit measured — logo, nine sidebar destinations, Search, Notifications, theme toggle,
account trigger — plus the mobile strip's items, the story card's `IconToggle`, `BackToFeed` and the two
bare text controls the shell draws in its restored-account and "not your floor" states. Keyboard-only
through those fourteen at 1280: **`outline-style: none`** and a shadow of
`oklch(0.145 0 0) 0 0 0 2px, oklch(0.72 0.12 240) 0 0 0 4px` on every one — the 2 px offset on
`--background` and the 2 px ring in **`--ring`**, the token itself, not merely "not none". A mouse click
on the same controls draws nothing (`:focus-visible` false, `box-shadow: none`). At 360 the bottom
strip's items carry it too. Two stops the spec names are left to the slices that own their files: the
briefing's "Back to the latest briefing" (`src/routes/dashboard/briefing.tsx`) and `UpgradeNote`'s link
(`history.tsx`).

**The test this slice wanted, and why it is not here — an open question.** A `shell.test.ts` was written
(20 tests: the heading outline, the ring on every focusable element in the rendered shell, and the chrome's
staff / standalone / maintenance / paused / offline / saved-copy / update states) and it passed. It could
not ship: importing `shell.tsx` for the first time made four files that v8 had never counted — the shell,
the account menu, the offline notice, the app shell — enter the dashboard branch denominator with their
real totals, and `src/components/dashboard` branches fell **89.42 → 88.13** against a committed floor.
**Nothing lost a test; the denominator grew.** The three arms needed to clear the floor again
(`shell.tsx:175`, `:267`, `:287`, the restored-account notice and the search overlay) only exist after an
effect runs or a Radix dropdown opens, which `renderToStaticMarkup` cannot do, and a DOM renderer is a new
dependency the design spec forbids. Recorded rather than forced: either those branches get recorded on the
runner (a floor decision, not a slice decision), or the shell gets a DOM test when a dependency for it is
allowed. Until one of those is ruled, the shell is held down by the browser measurements above and by no
test of its own.

Gates on the final tree: `npm run typecheck` clean; `npm run lint` **0 errors** (20 pre-existing
fast-refresh warnings on unchanged files); `GITHUB_ACTIONS=true npm run test:coverage` **3,516 tests
across 205 files green**; `GITHUB_ACTIONS=true npm run coverage:ratchet` **no regression against the
committed floor**. `npm run audit:delivered-line` is **unchanged** — this slice touches no reader copy:
the diff is one comment block, one heading element name, one exported class string and its call sites.

### The reader's zone is theirs from the first row, not from UTC — delivery recommendation 1 (2026-10-22)

`decisions/briefing-delivery-time.md` §6 keeps option B — one build per reader at 07:30 **in the reader's
own zone** — and names signup as the only timezone defect the live data supports. Reproduced before
changing anything: `handle_new_user` (0003) seeded `notification_preferences` and `profiles` from the
`timezone text not null default 'UTC'` column (`0001_init.sql:38`, `:55`), and the browser's zone reached
the account only when the reader finished the schedule step (`prefs-store.ts` hydration). A reader who
signed up and stopped before that step was scheduled at 07:30 **UTC**; the decision's own live read found
two of three rows in that state.

**The columns already existed, so there is no new column, table or index.** What 0123 changes is who
writes them, in three places that cannot disagree about the fact:

- `handle_new_user` now reads `raw_user_meta_data ->> 'timezone'` and writes the same value to
  `profiles.timezone` and `notification_preferences.timezone` in the insert it already performed. This is
  the row's first and only chance: the trigger fires inside GoTrue's own insert, so signup metadata is the
  one channel that reaches it.
- `capture_signup_timezone(uuid, text)` corrects the signup paths that carry no metadata — Google, GitHub,
  and every account written before 0123. It fires from the first authenticated `usePrefs` load that sees a
  difference, and only while `onboarded_at is null` **and** the stored zone is still `'UTC'`: a zone the
  signup already captured is never replaced by wherever the reader happened to open the dashboard, and a
  reader who has been through the schedule step is never touched. Guard and write are one statement, so
  finishing onboarding mid-flight cannot have the choice overwritten.
- `savePreferences` now mirrors a saved zone onto `profiles.timezone`, which is the copy the admin
  console's user page shows (`server/users.ts:190`). Before this, nothing but the column default ever
  wrote it, so the console showed `UTC` for every reader.

Both writers gate the offered value through `usable_timezone(text)`, which answers `'UTC'` for anything
`pg_timezone_names` does not carry instead of raising: a bad value costs the reader a schedule hour, never
their account, which is the acceptance case "an unknown zone falls back safely rather than failing
signup". `Factory` is excluded by name because it is the one catalog entry `Intl` refuses. The gate is
deliberately not stricter than the scheduler — legacy aliases (`Asia/Calcutta`) resolve and are stored as
given. `capture_signup_timezone` is revoked from `public, anon, authenticated` and granted to
`service_role` only, on 0036's lesson that revoking from the two roles alone leaves the PUBLIC grant
standing.

The browser half is `signupMetadata()` in `timezones.ts`, sent as `options.data` by `continueWithEmail`
**only** when the account is being created: Supabase merges `data` into `raw_user_meta_data`, so sending it
on an ordinary sign-in would rewrite where the reader was the day they signed up with where they are now.
The correction is awaited rather than fired and forgotten, because its answer is the settings the load
returns — a correction landing after `setPrefs` would be overwritten by the stale read.

**Two readers, two instants — the decision's arithmetic, executed.** `digest-schedule.test.ts` runs the
real `scheduleUpcoming` over a Tokyo row and a New York row, both on `uno`, where `send_at` is not read at
all: the only thing that can move either slot is the stored zone. Both readers' own clocks read 07:30 and
the instants are `2026-03-02T22:30:00.000Z` and `2026-03-02T12:30:00.000Z`; swapping the zones swaps the
instants, and two readers in one zone share one instant. `scheduleUpcoming` was exported for the test and
is otherwise unchanged — the build cadence, the composition path and rulings #17/#18/#19 are untouched.

Open, recorded rather than decided: existing onboarded readers keep `profiles.timezone = 'UTC'` in the
console until they next save a zone; a backfill from `notification_preferences` would make the console
truthful immediately but is an operator-facing data change the task did not authorise.

Gates on the final tree: `npm run typecheck` clean on both projects (`tsconfig.json`,
`tsconfig.scripts.json`); `npm run lint` **0 errors** (20 warnings, all
`react-refresh/only-export-components` on files this slice does not export from). `npm run test:coverage`
on a host running at **load average 15.7–20.3** (other agents' work, not this suite): **3,523 tests passed,
18 skipped**, and two suites failed on their own fixed timeouts rather than on an assertion —
`code-first-db.test.ts`'s 30 s PGlite `beforeAll` (it passes alone in 26 s, and applies a fixed migration
list that never executes 0123) and `callsites.test.ts`'s 60 s filesystem scan. Every new test passes in
isolation; the runner, which is not under this load, is the authority for the full-suite number.

**The runner agreed.** CI run
[39729587050](https://github.com/g0GobliN/nyuz/actions/runs/39729587050) on `b91d334` is green on every
job: commit messages, dependencies and secret names, typecheck + lint + build, **all four test shards**,
**Coverage floor**, and the browser smoke on the built Worker. Deploy is skipped, as it is for any branch
that is not `main` — nothing here is deployed.

**It is migration 0123, not 0121.** `0121` and `0122` went to the landing-coverage and site-SEO slices
while this branch was in review, so the pinned duplicate-number test refused the merge checkout
(`expected [56,94], got [56,94,121]`) even though the SQL was fine. The file is renamed and one comment
line with it; nothing executable changed. The branch was then brought onto current `main` (`e925f11`) with
a merge commit rather than a rewritten history, and CI run
[39736387529](https://github.com/g0GobliN/nyuz/actions/runs/39736387529) is green on that merged head
`5396713` — all four test shards, **Coverage floor**, typecheck + lint + build, and the browser smoke;
Deploy skipped again. That head is what **merged in [#48](https://github.com/g0GobliN/nyuz/pull/48) at
`49ccd8f`**; the two-reader measurement re-run on it gives `Asia/Tokyo` → `2026-03-02T22:30:00.000Z` and
`America/New_York` → `2026-03-02T12:30:00.000Z`, both clocks reading 07:30, `instants equal? false`.

### The story page's unparseable clause is gone — blocker 4 and the story-page should-fixes (2026-10-23, audit 4, card `t_5a6bc152`)

The reader-clarity audit (PR #54, `docs/reader-clarity-audit-2026-10-22.md`) closed its story page on a
sentence no reader can parse — card 09 ends *"…for 4chan, DeviantArt, Wikipedia, and the blog where the bar
around the corner posts pictures of people's dogs."* (I-12, the fourth blocker). The blog has no name in
any stored row, so naming it would invent a fact; the card's own second remedy is the one that landed:
**the clause is cut and the list rejoined with the conjunction the dropped item carried**. Measured on the
delivered story (`f937622f`) through the exact `StoryArticle` memo path (`composeArticle` →
`storyOpening || deck` → `withoutOpening`) on this branch: the closing paragraph now reads *"…Two bugs
found with AI are behind major issues on 21 October 2026 for 4chan, DeviantArt and Wikipedia."*

Three rules, all deterministic, all in the composer or the rail, none inventing a fact:

- **`dropUnresolvableListItem` (I-12, editorial.ts).** Only a trailing `where`-clause whose item carries
  no capital letter, in a list of at least three items, outside quoted speech. A `where`-clause is an
  adjunct describing a place — removing it cannot change what the sentence asserts — while a `that`-clause
  often *is* the content, and no regex may delete that. The quotation guard was re-cut during this
  slice's test pass: the first version compared openers before the item with closers after it, and a
  sentence quoted whole (whose closer sits after the item) balanced to zero and got rewritten anyway —
  ruling #6 says a quotation belongs to its speaker. The guard now asks the span that matters: more
  opening marks than closing marks **before** the item means the item lives inside a quotation. The
  failing-first test is `story-clarity.test.ts` "leaves the example inside a quotation whole".
- **Prevalence demotion at the deck tier (I-13, editorial.ts + `prevalenceStatistic` in
  reader-evidence.ts).** A sentence whose payload is a share of an installed base (`percent` +
  `used by|websites|servers|…`, money excluded) loses the deck to any event candidate, exactly as ruling
  #10a demotes quotations — demotes, never deletes: card 09's W3Techs statistic now opens para 0 under an
  opening that says what happened, and a statistic-only page still publishes it as the deck. Measured on
  `f937622f`: the deck is *"The "critical vulnerabilities" were discovered in the PHP programming language,
  which underpins much of the internet…"*.
- **`expandAcronymsFromEvidence` (I-03, editorial.ts).** When the composer's sentence-picker drops the
  source's own gloss off the page, the expansion is put back at the first bare use — only in the source's
  own `words (ACRO)` adjacency, only when the initials match, stop-listed for AI/US/UK/EU/TV/ID/PPT.
  Nothing is invented: every word of the gloss is the source's. On live card 01 the first paragraph now
  reads *"…perform operational technology (OT) system reconnaissance."* (measured — the audit found "OT"
  unexpanded three times on that page).
- **One measure, one label on the sources rail (I-06, story.ts + story-article.tsx).** The rail printed
  *"Based on 4 sources"* above nine rows from eight outlets, because the four came from the cluster-time
  `events.publisher_count` and the rows from current coverage. `sourceRailLabel` derives the caption from
  the rows themselves: *"Based on 8 publishers · 9 reports"* for the audited card-12 rail, plain *"Based on
  N sources"* where the two counts agree, so the reader can always count what the label claims. The
  `publisher_count` staleness itself (4 recorded against 8 distinct names) is left as an operator-facing
  data finding — this rule makes the page stop quoting it.

**Ownership, the reason the card-06 blockers are not in this slice.** The audit's four blockers split
across two cards: I-09/I-10/I-11 (card 06's chronology) belong to `t_4675d592` (forge, audit 1-3), which
declares `src/lib/editorial.ts` its owner and runs now. Last night's WIP on this branch
(`1146177`, never pushed) over-scoped into them — timeline-entry deck refusal, causal-frame refusal,
`groupTimelineFacts`. Measured against the live card-06 story this morning, the grouping made the page
open with a sentence that then reappeared near-verbatim inside the first paragraph's lead-in ("This post
from the PHP Foundation explain what went so wrong: …"), because `withoutOpening` strips only an exact
match. That is a reader-visible duplication on another card's surface, so the whole I-09/I-10/I-11 set was
**reverted from this branch** rather than fixed here; the measured duplication is handed to
`t_4675d592` so its implementation starts from what was seen, and `1146177` stays reachable as a
reference for the rejected approach. Deferred with the audit's routing, unchanged from last night: I-08
is owned by S9 (PR #51); I-01/I-02/I-04 are The Register's own quoted sentences — ruling #6 forbids
rewriting a quotation, and section 8 routes them to the composer copy-pass at the arbiter; I-05/I-07/
I-14–I-17 are polish (I-17's caveat copy is an arbiter decision).

**Cost on the frozen corpus.** `reader-composer-snapshot` on the base checkout and on this branch over the
same frozen 200 (`corpus.json`, the 2026-10-22 freeze): 200 → 200 stories, average words 181.9 → 181.9,
paragraphs 2.79 → 2.79, every ruler line unchanged; **3 stories rewritten, all three by 2–3 words, each a
one-for-one acronym gloss** (DDF, FT in the Spanish story, BO) — no sentence lost, no story emptied, no
deletion outside the audited list clause. `reader-composer-diff base.json after-scoped.json`, 2026-10-23.

**Gates on the final tree (quiet — no other agent writing into this worktree).** `npx tsc --noEmit`
clean; the focused composer suites — `story-clarity`, `story`, `card-summary`, `editorial`,
`reader-prose-rules`, `understand`, `reader-quality`, `reader-fixture-regression`, `reader-deck-clause`,
`reader-article` — **577 passed**; the new rules' tests were shown failing on the pre-fix tree (`457b61d`)
before they passed here, for the two findings the audit scored. The full `GITHUB_ACTIONS=true npm run ci`
run and the runner result are recorded in this slice's PR body.
**S8's regression guard is committed, and the page eyebrow stopped claiming a send.** The S8 ruling
(2026-10-21) pinned its diff to the card and the route, so the harness that verified the change ran and
was deleted — nothing failed if `brief@nyuz.app`, `inbox` or `Delivered at` came back to the reader's
briefing. `src/components/briefing-preview.test.ts` now carries the cases the ruling owed: edition
chrome renders **none** of the three (case-insensitive), the **default** chrome renders `brief@nyuz.app`
and `Delivered at` so the scan is proven able to fire, and a caller passing `chrome="edition"` with no
`editionTime` gets `Edition · 7:30 AM` rather than an empty stamp. Falsifiability measured, not
asserted: reverting the footer and the eyebrow turned **3 of the 5** new cases red, and the two that
stayed green are the ones asserting the unchanged default and the presence of the expression itself.

**The eyebrow moved on the arbiter's 2026-10-22 ruling.** `briefing.tsx:140` read `Delivered` (or
`Delivered · <date>` when an older digest was open) — the same defect class as the `Delivered at` stamp
the card dropped, because the reader's own page must not assert a send that did not happen. It now
reads `Edition` / `Edition · <date>`, matching the card's own `Edition · 07:30` header, and a
source-level case in the same test file (the shape `style-tokens.test.ts` uses) stops a later copy pass
putting the word back. `docs/decisions/briefing-channel-neutral-framing.md` records the move and closes
its own "recorded gap" note.

**Read at 1280 on the local build**, in a browser holding the owner's own reader session
(`npm run dev`, Node 22, `document.body.innerText`, case-insensitive): today's briefing — `Delivered`
**0**, `Edition · ` **1** (card header), eyebrow `textContent` `"Edition"`; with the **2026-10-20**
digest open — `Delivered` **0**, `Edition · ` **2** (eyebrow + card header), eyebrow
`"Edition · 20 October"`. The same page on the deployed origin, before the change, read `DELIVERED`
over the identical briefing.
### The reader's prose was audited against the Wikipedia test — 43 findings, 4 blockers (2026-10-22)

The four gates in `reader-quality-10-of-10.md` measure delivery, significance, surfaces and alerts. None of
them measures whether the prose is *understandable*, so the live product was read as a reader on the three
surfaces a reader uses: the home feed (`/dashboard`), the briefing (`/dashboard/briefing`), and four story
pages opened from it (cards 01, 12, 06 and 09 of digest `7268ba11`, the 25-item edition scheduled 07:30 JST
on 22 October), plus the 20 October archive (`4a6b2ad2`) opened the way History opens it. The session was a
Supabase magic link for the one account with a delivered briefing — no password, no email sent, no product
content edited.

[reader-clarity-audit-2026-10-22.md](reader-clarity-audit-2026-10-22.md) records **43 findings — 4 blockers,
26 should-fix, 13 polish** — every quotation sliced out of a `document.body.innerText` capture and
machine-checked against it, at 639×906, 1440×900 and 360×780. The four blockers are all in the composed
article: card 06 opens on a dateless fragment ("August 24, 2026: Wiz Research reports the vulnerabilities…"),
its second paragraph refers to "the leak" and "Calif" before either exists, its third is a chronology out of
order, and card 09 closes on "the blog where the bar around the corner posts pictures of people's dogs". The
feed and the briefing are understandable; their defects are voice (5 of 25 headlines are Title Case press
releases), jargon never expanded ("script kiddies", "spec", "OT", "oneDNN"), a band word that reads as praise
but is the bottom band ("Notable", 14 of 25 cards), a reason line that names AI on all 25 cards ("You follow
AI." on 8), an edition whose only "Why it matters" line prints "Four publishers reported this.", and two
stories carried twice (#6/#9 PHP security release; #4/#7 GTC Berlin keynote).

Measured for whoever picks the fixes up: `why_it_matters` is non-empty on **1 of 25** cards; summaries run
**13–40 words, median 25**, so no card is a wall of text; **9 of 25** summaries carry an attribution phrase;
story 12's rail says **"BASED ON 4 SOURCES" over nine rows across eight outlets** (`publisher_count` vs
`articles`, `briefing.ts:1434`); the briefing has **no `h2`** between its 25 cards. Two artefacts were excluded
rather than reported: the emoji in the browser tab is the reading browser's, not the page's (the server's
`<title>` is `nyuz — Stop searching. Start knowing.`), and the "10 of 10 used" device panel is this account's
cap. Nothing in the audit changes code, copy or content; §8 of the file routes each finding to the component,
instrument or ruling that owns it.
### The deploy gate stopped reading a registry outage as a vulnerable tree (2026-10-22)

`main` failed to deploy twice on 2026-10-22 — run 39738568520 on `49ccd8f` (07:09Z) and run 39740776619 on
`18a7407` (07:29Z) — both at `Audit production dependencies` in `.github/workflows/ci.yml`, and both passed
when the failed job was re-run on the same tree (`49ccd8f` attempt 2 at 07:26Z, `18a7407` attempt 2 at
07:41Z). `Browser smoke` (`needs: [commits, audit, verify]`) and `Deploy to Cloudflare Workers` (which needs
`audit` transitively) sit behind that job, so a green audit is what stands between a merge and a deployment.

**The 400 was npm reporting that its own request failed, not a statement about the lockfile.** The runner's
log names the environment it used: node `v22.23.3`, npm `10.9.9`. npm 10.9 posts to
`/-/npm/v1/security/advisories/bulk` first and falls back to the retired `/-/npm/v1/security/audits/quick`
only when that request *throws* (`@npmcli/arborist/lib/audit-report.js:323` and `:336`). Both failing logs
show the bulk POST never answered: the step printed its first line 5m00s after it started (07:29:03 →
07:34:03), which is npm-registry-fetch's default `fetch-timeout` of `300000` ms (`npm config get
fetch-timeout`), and what surfaced was the fallback's `400 Invalid package tree, run npm install to rebuild
your package-lock.json`. Measured locally on `18a7407`: **10 of 10** `npm audit --omit=dev --audit-level=high`
runs answered clean in under a second over the bulk endpoint (`--loglevel http` → `POST 200
.../advisories/bulk`), and **0 of 10** touched the quick endpoint — the tree was never the problem, and the
same lockfile passed this job on PR #50's CI at 07:24Z.

The step now separates the two things npm can say. The retryable class is "the registry gave no verdict" —
`audit endpoint returned an error`, `Invalid package tree`, `endpoint is being retired`, 5xx fetch and warn
lines, and the network codes — while a `# npm audit report` verdict is checked **before** that class and
exits on the first answer. That order is the point: npm can return the advisory list and still fail a
packument fetch while working out whether a fix exists, and retrying that would bury a real high-severity
advisory behind "the registry was flaky". Attempts stay bounded at three, each terminal branch prints an
`::error::` saying which of the two happened, and the third endpoint failure is still red. Alongside the
loop, `npm_config_fetch_timeout: 60000` makes a stalled bulk POST cost a minute instead of the default five,
`npm_config_fetch_retries: 0` keeps the loop the only retry policy, `npm_config_loglevel: http` puts the
endpoint npm actually talked to in the job log, and `timeout-minutes: 6` bounds the step.

**Proved by running the step, not by reading it.** A harness extracts the `run:` block from `ci.yml` and
executes it with the step's own `env:`: the clean tree → exit 0 on one attempt in 2.2 s; a production
`lodash@4.17.20` in a throwaway lockfile → exit 1 on **one** attempt with the real high advisories listed;
that same advisory delivered by a stub registry *together with* a `501` on the packument fetch → exit 1 on
one attempt; CI's exact failure replayed (bulk 503 → retired quick 400) → 3 attempts, 6 requests, exit 1;
both endpoints 503 → 3 attempts, exit 1; a bulk request that never answers → 3 attempts in 214 s and red,
against one 300 s attempt and red before. Runner evidence: PR
[#53](https://github.com/g0GobliN/nyuz/pull/53)'s CI run
[39752304047](https://github.com/g0GobliN/nyuz/actions/runs/39752304047) is green on `079e658`, the
`Dependencies and secret names` job included, where the step answered over the bulk endpoint in 127 ms
(`POST 200 .../advisories/bulk`, `found 0 vulnerabilities`) and never touched the quick one.

### The composer reads a story's timeline forwards — the audit's three chronology blockers (2026-10-23)

The reader-clarity audit (PR #54, `docs/reader-clarity-audit-2026-10-22.md` on that branch) filed four
blockers on the delivered 2026-10-21 briefing; three of them (I-09, I-10, I-11) are one defect: the
composer printed a story's sentences in an order no reader can follow. Card 06, *"Today's PHP Security
Release…"*, opened on `August 24, 2026: Wiz Research reports the vulnerabilities …` — six weeks into its
own timeline — then referred to "the leak" and to "Calif" before either existed on the page, then
printed `August 20, 2026` after `October 21st`. **The file that chose the order is
`src/lib/editorial.ts`** (`deterministicParagraphs` and the deck walk); `reader-article.ts` only
validates stored articles and ordered nothing.

**It now reads forwards.** Deck: `August 20, 2026: Unauthenticated RCE is confirmed against Drupal.` then
`August 24 …`, `September 21 …`, the 20 October leak and its consequences, and `October 21, 2026:
Patched PHP releases become available.` as the resolution. Every date on the page is non-decreasing;
`As a result of the leak` now sits behind the sentence that establishes the leak. The full page before
and after is quoted in [decisions/composer-chronology.md](decisions/composer-chronology.md).

Four parts, all in `editorial.ts`, all keyed on one condition — **the story opens two or more facts on a
calendar date**: the timeline is gathered and sorted (`chronologyTimeline`); the deck may not be a
timeline step other than the first (`deckCandidateOrder`); the body is the timeline and the narrative
woven by date (`chronologyBody`); and a paragraph's sentences are read in the order they happened
(`chronologyOrderedGroup`), with a sentence that states only a clock time reading as belonging to the
day its paragraph is about. A block built around an adjacency repair is never re-sorted (ruling #4).

**Why the ordering is done in sequence and not in paragraph boundaries.** The quality gate re-blocks
whatever the composer hands it — it splits every block into sentences and merges neighbours that share
a citation until the 75-word budget is spent — so a paragraph boundary is advice. Measured while
building this: the timeline was made its own block and the sentence after it still landed in front of
the paragraph it belongs to. `ArticleParagraph` gained `standalone`, and two adjacent sentences now
merge only when they agree about it, which fences a block at both ends.

**Blast radius, measured on frozen corpora, not inferred.** The window `2026-10-21T00:00Z →
2026-10-22T02:30Z` (450 events, a full day of the pipeline): the pass fires on **1** story, card 06. The
200 newest events, composed before and after the change: **0 pages changed**, deck and every paragraph
identical. That diff also caught a scope error in the first draft — with the paragraph sort applied to
every story, one unrelated card ("Tigray resumes daily life amid fears of wider war") had its sentences
reordered — so the pass is now gated on the story carrying a timeline.

**What it does not fix, recorded rather than padded.** The page still opens on a timeline fragment: the
audit's ideal opening is a summary sentence, and no stored fact says it — the timeline's own first step
(`August 19 …`) exists only inside a meta sentence the composer refuses, and the post's explanatory
standfirst (which *would* open the story) is refused by the sentence gate as `invalid_sentence`. The
stored `what_happened` is the same mid-timeline fragment, so the fallback deck cannot stand in for it.
A strict cross-source merge is not derivable either: for an enriched source `sourceOrder` is the index
of the evidence unit, and that pass writes its units in the order it judged them, so the rule reads
dates out of the sentences themselves. Each is listed with its evidence in
[decisions/composer-chronology.md](decisions/composer-chronology.md).

**Gates on the final tree:** `npm run typecheck` clean; `npm run lint` **0 errors** (20 warnings, all
`react-refresh/only-export-components` on files this slice does not export from); `npm test -- --run`
**3,581 tests passed** across 213 files. A unit test pins the acceptance — the opening three sentences,
a non-decreasing date sequence across the whole page, and the leak before its consequence — and the
same date-order check run against the pre-change page (quoted verbatim) fails on it, which is what
proves the test tests the defect.

### The briefing grew structure, honest chrome and the feed's facts — S2, B-03, B-01/B-02/B-06, X-01 (2026-10-23)

The audit's §4 verdict on `/dashboard/briefing` was structure and honesty, and this slice delivers
both on the reader surface. Branch `wt/briefing-surface`, PR to `main` (task `t_06717f72`); forge
holds `editorial.ts` / `reader-evidence.ts` / `server/briefing.ts` for the composer slices, so
everything here lives in `briefing-preview.tsx`, `briefing.tsx` and their tests.

**S2 — the heading tree.** Before (live, audit Appendix A): **1 h1, 1 h3, 0 h2** and 25 stories that
were not headings at all. After: the page keeps its single `h1` (`PageHeader`); the card's deck head
("25 things worth knowing…") becomes the one real `h2` on the page — reader variant only, the
marketing card keeps its `h3` so the landing page's structure does not move; and every story is an
`h3` whose first child is the link into it (`h3 > a`). Measured **after: `h1 = 1`, `h2 = 1`,
`h3 = 25`**, each story heading carrying its link — pinned as a test over a 25-item fixture. The
group labels print as paragraphs with `role="heading" aria-level="3"` (not third headings) precisely
so the tree stays one-`h2`/twenty-five-`h3`: a group heading as an element would either skip a level
or break the measured count the contract fixes.

**B-03 — structure, derived, not invented.** `briefGroups`, `briefGroupLabel` and `briefLede` live in
`briefing-preview.tsx` and read only `topics[0]` of the stories themselves. Groups sort by size
(ties by first appearance), cap at four, and everything else — plus a story with no topic — shares
one trailing **"Elsewhere"** heading, which is a bucket, not a taxonomy. Below 8 stories, or when
one topic is the whole edition, the page stays one flat list and prints no lede rather than a
structure of one. Inside a group the order is the edition's own (stable partition); numbering runs
**01…25 across the groups** without resetting, because the item number is the "1 of 25" the reader
already trusts. The lede is one sentence measured from the same groups: "The day's through-line is
⟨topic⟩ — ⟨n⟩ of ⟨total⟩ stories — with ⟨topic⟩ (⟨n⟩) behind it."

**B-01 / B-06 — chrome claims state, not delivery.** The eyebrow is now "Today's edition" (latest)
or `Edition · October 20` (archive, unchanged). The channel chips read **"Email · on (preference)"**
and **"Telegram · on (preference)"** — a preference labelled, no longer a status word that sat under
a page which once said DELIVERED.

**B-02 — the archive names its day.** With a digest open the sub-line reads "Built from coverage
published before 07:30 on October 20. Nothing here was reordered for the web." — the date the
history row already resolved (`day.date`); the latest briefing still speaks of today, its truth.

**X-01 — one card, one set of facts.** The briefing card now prints the feed's importance band in
the feed's own three tones (`IMPORTANCE_TONE`, reader-only — the marketing card is not a card the
reader can check against the feed), and the route passes the **same `useFeedback` save state** the
feed and the shelf use: every card gains **Read →** and a **Save** button, with the optimistic
label the shelf already has, and on the Saved tab the same toggle removes the story. Actions and
buttons are gated on the new props, so the marketing facsimile renders nothing a visitor could
press (test-pinned).

**Gates on the final tree:** `npm run typecheck` clean; `npm run lint` **0 errors**; `npm test --
--run` **3,614 tests passed** across 214 files; `npm run audit:surfaces` PASS and unchanged
(feed 13/13 · archive 14/14 · alerts 5/5, 0 defects); `npm run audit:delivered-line` PASS and
unchanged (14/14 card lines equal their page opening, 0 defects).

### Leg A funnel measured: the delivered pool's missing input is shapes, not coverage (2026-10-23)

#### Task t_27cc9ccb — evidence in [decisions/significance-leg-a.md](decisions/significance-leg-a.md), ledger [audits/significance-leg-a.json](audits/significance-leg-a.json), command `npm run audit:significance-leg-a`

The three newest delivered editions (50 item rows in three sent digests — one per scheduled slot,
25 items 2026-10-19 22:30Z, 9 items 2026-10-09 22:30Z, 16 items 2026-10-08 22:30Z, each on its own
event; the significance-window audit reads the same pool from its other end — its query counts every
digest generated in the window dates regardless of delivery status, Leg A **2/50** when the slice
opened, **3/92** on the 2026-10-23 tree with the extra rows being post-delivery digests, not newer
delivered editions): composed **2**, rung-refused **2** (`consequence:fragment 2`), no-shape **33**,
no-evidence **13**. Side splits: **6/50 rows carry a why-line** — 1 composed and carried, 1 coverage
line, and 4 figure-puff lines ("The story carries a $X figure.") the pre-ruling-#10 builds of the
10-08/10-09 editions printed, standing in the archive; 44/50 delivered silent; **2/50
coverage-eligible** (≥2 publishers), the ladder answers both with the coverage line. The dominant
event refusal `consequence:figure-only` 12 — the shape ruling #10 removed. **37/50 items sit on
evidence-bearing events (74%)** (the 13 no-evidence items are all `robots-blocked` — boundary, not
defect), so the delivered cohort's bottleneck is the shapes the stored evidence does not hold, not
enrich coverage.

**The classifier is code beside the ladder, not a re-derivation:** `consequenceStep`, `bindingStep`
and `storyNames` were refactored out of `inclusion.ts` as exported instrument steps with the
ladder's path unchanged in behaviour, and
[src/lib/pipeline/significance-leg-a.ts](../src/lib/pipeline/significance-leg-a.ts) classifies each
delivered item into the four mutually exclusive buckets from those same predicates — the measured
correspondence the 2026-10-17 three-instruments-disagreed rule wants. TDD: 10 tests in
`significance-leg-a.test.ts` fail-first on the instrument shape, one of which caught a real
regression in `consequenceLine` mid-refactor before it shipped.

**Enrichment's zero-yield pages stopped reporting success.** Attributing the no-evidence family meas-
ured the `extraction_empty` census family live on delivered shapes and found its cause in
`enrich.ts`: a page that fetched at the usable-words floor and yielded **zero** admissible units was
recorded `ok: true` on the source, so no failure counter, backoff or recovery path could ever see
it. Measured population: 92 zero-yield rows over the 30-day window, concentrated in non-English
feeds whose every page yields nothing (Lenta.ru 5/96 rows zero covered, El Financiero 2/29, Milan
News 2/14). Landed: zero-yield now counts toward `enrichment_failure_count` and reports
`extraction_empty` in the run row (new `OutcomeReason`), so the source reaches the failure latch a
broken origin reaches; the `article_evidence` row keeps the census's documented family shape
(`enriched`, zero units, real word count) so `enrichment-census.ts` attribution is unchanged. Two
fail-first tests in `enrich.test.ts` pin the report shape and the latch.

**Measured on the window audit after the change:** Leg A **3 / 92** (the window population grew
since the 2/50 read of 2026-10-20), `gate 2 PENDING` exit 2 as designed; `npm run
audit:delivered-line` PASS and unchanged 14/14; `npm run typecheck` clean; `npm run lint` 0
errors; full suite **3,655 tests passed** across 218 files. Note: the 2 refused fragments are not
repairable (a conditional cannot print without its "if"; one "they" does not resolve inside the
clause); widening `CONSEQUENCE` verbs was measured destructive on the cohort (8–10 of 12 figure-only
candidates die at the why-vs-what gate or are truncated mid-number) and stays with the arbiter, with
this measurement attached. A card-vs-instrument conflict on coverage eligibility for Leg A is
recorded in the decision note for the next arbiter question.
### The first post-fix build was read as a stranger — 8 of 25 closed, 5 blockers, and two defects nobody had filed (2026-10-23)

Audit v2 (`docs/reader-clarity-audit-v2.md`, task `t_377015f1`) re-scored all 25 `I`/`B`/`X`
findings from `reader-clarity-audit-2026-10-22.md` against the deployed origin, plus two story pages
from the reader's current edition, at 1440×900 and 360×780.

**Verdict: `blockers 5 · should-fix 12 · polish 11 · fixed 8 of 25`.** Closed: `I-03` (the source's
own "operational technology (OT)" gloss restored), `I-06` (`BASED ON 8 PUBLISHERS · 9 REPORTS`,
derived from the rows instead of `publisher_count`), `I-12` (the clause that named nothing is cut
and the list rejoined), `B-01` (`TODAY'S EDITION`), `B-02` (`Built from coverage published before
07:30 on October 20.` on the archive), `B-03` (lede + four groups: 6 · 5 · 2 · 4), `B-06`
(`Email · on (preference)`), `X-01` (band and `Read →`/`Save` on every briefing card).
Still present: `I-02`, `I-04`, `I-05`, `I-07`, `I-08`, `I-09`, `I-10`, `I-11` (reduced), `I-14`,
`I-15`, `I-16`, `I-17`, `B-05` (the PHP disclosure is two cards again, 09 and 10), `X-02`.

**The gate that shaped the numbers.** The reader's newest edition (`fab11fdf`) was built
`2026-10-22T22:55:38Z`; the wave (`72f85b7`, PR #57 + #59) merged `04:49:21Z` and deployed
`04:57:15Z` the next morning. `digest_items.summary` is stored at build and ruling #11 pins a story
page's opening to it, so `I-01`, `I-13`, `B-04` and the `H`-class headline/summary findings are **not
measurable** on that build — listed with their live strings in §G, scored neither fixed nor present.

**New findings, all measured on the live page.** `N-01` (blocker) card 09 of the current edition
prints `Chainguard CEO: ', the author reported making the call'.` mid-paragraph. `N-02` (blocker) the
Sudan story (`4001e8a2`) carries an unrelated Cameroon railway paragraph as its second block. `N-03`
(blocker) card 12's story page returned Cloudflare `Error 1102 — Worker exceeded resource limits` on
2 of 5 loads in three minutes. `N-04` the four group labels are `<p role="heading" aria-level="3">`,
the same level as the 17 item headings. `N-05` the lede says `NVIDIA (5)` while 7 of 17 cards are
NVIDIA's own blog. `N-06` 7 of 17 cards (41%) are `NVIDIA BLOG`; `N-10` card 14 is a discount deal
for a bird feeder, reason line `You follow AI.`. `N-07` "Nothing here was reordered for the web." is
now false on the page that groups the edition. `N-08`/`N-09`/`N-11` are polish.

**Measured again after the next deploy, inside the same run.** PR #61 merged `06:00:45Z` and deployed
`06:05:38Z`; re-captured at `06:07–06:12Z`. `H-06` is **closed** — reason lines now name the narrowest
interest (`You follow NVIDIA.` ×8, `You follow OpenAI.`, `You follow AI — this card is about
Funding.`). `I-09`/`I-10` are **unchanged**: the page still opens `August 24, 2026: Wiz Research
reports the vulnerabilities to the PHP security team.` **That is the ruling-#11 seam seen from the
reader's side**: the chronology fix is deployed and the reader's page did not move, because the
opening is the stored delivered sentence. A composer fix to an opening can only reach stories first
briefed after it — closing `I-09`/`I-13` for already-delivered pages needs either a ruling that the
opening may be recomposed at read time or a re-brief. Recorded, not patched.

**What this changes about "the work".** The briefing surface's structural slice is confirmed on the
live product (four `B` findings closed). The reader's story pages are where the blockers now live:
two of the three new blockers (`N-01`, `N-02`) are composition leaks into prose, and `N-03` is the
free-tier CPU ceiling arriving on a reader route. Next: the composer slices for those three, then the
edition's composition (7 vendor-blog cards, one duplicated story, a discount card).

### 2026-10-23 · CEO: the briefing tab returns to its pre-#59 UI, by owner ruling

The owner read the deployed briefing tab and asked for the page as it was before PR #59. Reverted
wholesale in `wt/revert-briefing-ui`: heading structure (`S2`), topic grouping with the `Elsewhere`
bucket (`B-03`), the importance band and the card's `Read`/`Save` parity (`X-01`), the
`Today's edition` eyebrow and the archive sub-line (`B-01`/`B-02`/`B-06`). `briefing-preview.test.ts`
is restored with the code, 17/17 green on the reverted tree.

Recorded, not hidden: this reopens six audit findings the quality sprint had closed on that page. The
reader-facing bar still decides — the owner's read of the live page outranks an audit score, so the
findings come back as findings and the next briefing slice starts from this surface, not from #59's.

### 2026-10-28 · Composer: the story boundary is a block's subject, not the page it arrived on

`N-02` (a story page carrying another story's paragraph) was first fixed by restricting composition to
`sourceList[0].articleId`. That was the wrong seam, and CI said so: shard 4/4 failed
`story-flow.test.ts > renders a substantial deterministic article when AI is completely unavailable`
with `expected 40 to be greater than or equal to 60` (run `40467553473`). The reason is structural:
`sourceList` is read by event id, so every entry in it already belongs to the story's event, and a
second outlet covering that event is corroboration rather than a leak. Filtering on the article
amputated the story's own coverage, and the deterministic fallback composed 40 substantial words where
the reader contract asks for 60.

The boundary now reads a block's subject instead of its page. `storySubjectEntities` collects the
story's own names, from capitalized title words, its topics and the primary article's entity
annotations. `sourceIsForeignStory` calls an entry foreign only when it carries annotations and names
none of those subjects anywhere in its annotations, headline, excerpt or units. A block whose entry
carries no annotations is not provably another story's, so it composes: the boundary withholds a
paragraph on evidence, never on the absence of it. Both halves are pinned in
`editorial-story-boundary.test.ts` — the Cameroon block is dropped, the Sudan blocks stay, the same
paragraph published from the story's own source would publish, and an unannotated second outlet
composes.

Measured on this worktree's tree, 2026-10-28, Node 22: the deterministic article composes **75**
substantial words against a 60 floor, where it composed **40** before the repair;
`npx vitest run src/lib/server/story-flow.test.ts` 17/17,
`npx vitest run src/lib/editorial-story-boundary.test.ts` 4/4, full `npx vitest run` 221 files / 3679
tests passing, `npm run lint` exit 0 (20 warnings, 0 errors), `npx tsc --noEmit` exit 0. Those totals
are taken after merging `main` into the branch (the branch was 20 commits behind and GitHub reported
`CONFLICTING`; the merge is clean and `main` had no N-02 fix of its own). Branch `wt/n02-story-boundary`,
PR #74; not merged. CI could not run at all — every Actions job aborted in ~3s on "recent account
payments have failed" — so this slice's evidence is local, and `gh pr checks 74` has nothing to report.

### The zod advisory gate is cleared by a ruled migration, not an exception (2026-10-27)

From 2026-10-23T18:26Z the CI job **"Dependencies and secret names"** failed on `main` and on every
fresh branch run: advisory [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
marks zod `< 4.6.6` high ("can exhaust memory while validating oversized constrained collections")
and the pinned `zod ^3.24.2` resolves 3.25.76 inside the range. Not a branch regression — the
advisory's metadata amendment postdates every green run of the job (PR #60 06:39Z, PR #64 07:54Z,
`main` 11:52Z, same lockfile) and it fails on a clean `main` checkout. Task `t_37980de9`, per the
`arbitrate-first` rule: the ruling landed first, then the migration.

**Ruling (2026-10-27, ChatGPT `nyuz`, thread "Migrate Zod Now"): migrate to zod ≥ 4.6.6 now
(^4.6.7). No audit-gate exception authorized.** Constraints: keep `.email()`/`.datetime()` as-is
(deprecated in zod 4 but functional — no unrelated cleanup in this PR); preserve zod 3 behaviour
(`z.partialRecord` for the legacy boolean-map sections form, regression test pinned); full suite
(3,641 tests) + typecheck + lint + `npm audit --omit=dev --audit-level=high` all green before
merging; lockfile resolves a patched zod with no vulnerable production dependency; the diff
documented per module with all reader-facing schema behaviour verified unchanged. Full question,
options and ruling quote in [decisions/zod-gate-migration.md](decisions/zod-gate-migration.md).

**The whole migration is five lines minus lockfile:** `package.json` raises the pin to
`zod ^4.6.7`; `validate.ts` (1 line) and `site-content.ts` (2 lines) take
`ZodType<T, ZodTypeDef, unknown>` → `ZodType<T, unknown>` — zod 4's `ZodType` is `<Output, Input>`,
the `ZodTypeDef` slot is gone (`parseInput`, `sectionsSchema`, `parseSetting` are the only
custom-signature sites); and
`legacySectionsSchema` becomes `z.partialRecord(sectionKeySchema, z.boolean())` — zod 4 made
enum-keyed `z.record` exhaustive, which rejected the legacy boolean-map form the ordered-list
schema replaced, and `partialRecord` restores the exact zod 3 semantics (any subset of valid keys
parses, unknown keys still rejected), pinned by the restored test
`sectionsSchema > still accepts the legacy boolean-map form`. Typecheck clean, lint 0 errors,
219 files / 3,641 tests passed, audit `found 0 vulnerabilities`,
`npm ls zod --omit=dev` shows one root zod@4.6.7 everywhere — every run on the proposal worktree at
base a4c8bfe = origin/main. `@hookform/resolvers@5.9.1` already peers `zod ^3.25.0 || ^4.0.0`
and does not move.
### One story, one card — B-05 closed inside a single edition (2026-10-26)

The reader-clarity audit's **B-05** is the pair of duplicates the 2026-10-21 briefing showed as four
cards: #04 + #07 (the GTC Berlin keynote) and #06 + #09 (the PHP security release). Each pair is two
distinct `events` rows with one stored article each, so clustering never joined them and selection had
no rule that would refuse the second. `suppressDeliveredDuplicates` could not help: it answers "was this
reader already sent this?" over 48 hours, not "are these two cards the same story?".

**Measured first, on delivered data** (push `sent`, digest `item_count > 0`, pairs judged from stored
`events.title` + `what_happened` and the stored `articles` rows): three most recent editions, **67 cards,
0 same-event-id pairs, 4 reader-visible duplicate pairs / 8 cards** — `fab11fdf` #09+#10, `7268ba11`
#04+#07 and #06+#09, `3fcbb21c` #08+#09.

**The fix is in the selection pass**, `suppressStoryTwins` in `src/lib/pipeline/duplicates.ts`, gated on
`options.b05Rules` (absent = on, `false` = the pass as it stood). Two legs: an event-noun leg (both
headlines name an event — `keynote`, `conference`, `summit`, `unveils`, `launches`, `debuts`,
`introduces` — **and** share a name; the noun alone fused a GTC liveblog with an unrelated summit
liveblog, both "Live Updates"), and a disclosure leg (both headlines disclosure-shaped —
`vulnerability`, `flaw(s)`, `bug(s)`, `security release`, `cve-YYYY` — **and** sharing a capitalised
proper name, because PRIMARY ranking also promotes concept words like `security` and `flaw`). The
disclosure leg refuses a pair whose headline announces the next turn of a saga (`PROGRESSION`: `another`,
`again`, `second`, `third`, `follow-up`, `surges`, `resumes`, `after`, `later`, `next`, `imminent`), read
off the headline only because summaries restate the original event — that is what keeps the PHP2Shell
day-two card ("…Warns of **Another** Unpatched RCE **Two Days After**…") a second card while the
retellings fuse.

**Replayed on the same four pairs, legs off → on: three go 2 cards → 1 card, and the fourth (SpaceX,
2026-10-20) is already 1 card on the base legs** — so it is not evidence for this change and its
appearance in that edition is not explained by the pass as it stands. Recorded rather than glossed.
**Blast radius on the 30-day corpus:** 18,517 events, 491 disclosure-shaped, 1,326 candidate pairs
sharing a PRIMARY; the new legs fuse **307**, of which **44** clear ruling #18's acceptance floor and
**263** sit below it. The below-floor population is not new in kind
([decisions/twin-floor-below-floor.md](decisions/twin-floor-below-floor.md) already reports 164, and they
are one story told by many outlets), but it is a widening past the floor the code was accepted against,
and it is stated as such in [decisions/edition-duplicates.md](decisions/edition-duplicates.md).

**What it does not fix.** Clustering still creates two events for one story; this pass drops the second
at selection time, which is the smallest change that makes the pair impossible *in a briefing*. The
corpus keeps both events, so once the 48-hour window passes the same story can surface again on another
day. Joining them in `cluster.ts` is the durable fix and a separate slice.

**Gates on the final tree (re-run 2026-10-27, Node 22.23.2, quiet worktree):** `npm run typecheck` clean
(both passes); `npm run lint` **0 errors** (20 pre-existing `react-refresh/only-export-components`
warnings); `npm test -- --run` **3,650 tests passed** across **219 files**. `src/lib/pipeline/duplicates.test.ts`
pins both directions: the three audited pairs fuse to one card with quoted stored card text, the same
three are two cards with `b05Rules: false` (the census's "before" column), the PHP2Shell day-two pair
stays two cards, and the day-two test was verified to fail with the progression guard removed. Against
the pre-fix pass (`HEAD~1` of `duplicates.ts`) the new block fails **4 of 43** and passes **43/43** with
the change, which is the reproduce-then-fix evidence the card asks for.

**Whole-edition replay, every card, legs off → on (2026-10-27):** `fab11fdf` 17 cards → 17 / 16
(fused #09+#10); `7268ba11` 25 → 25 / 23 (fused #04+#07, #06+#09); `3fcbb21c` 25 → 24 / 24 (nothing new;
#08+#09 already gone under today's base legs). **0 reader-visible duplicate pairs remain on all three
editions.** The "legs off" column is today's base legs with `b05Rules: false`, not the code that
generated each edition — the base pass was widened after 2026-10-20, which is why `3fcbb21c` loses a card
before the new legs run while the delivered edition carried both.

**PR #74 (N-02 story boundary) closed out unmerged at head `0b60c72`** — FAIL as a rule: the guard
exempts `sourceList[0]` (`editorial.ts:3746`), so the article-internal boundary still composes the
Cameroon paragraph as the page's only body text with `storyBoundaryDrops: 0`; zero CI ran at that head
and the PR is `CONFLICTING` with `main`. One comment: https://github.com/g0GobliN/nyuz/pull/74#issuecomment-6462801400.
Residual carried by `t_01747913` (forge: sentence-level boundary, rebase, corpus rerun) and
`t_cd95e2b9` (sentinel: re-verify at the new head); `0fb1f7d`'s lint and shard-4 failures are repaired
at `0b60c72` locally (eslint and `tsc --noEmit` exit 0, 4 + 1 tests pass), and the emptied-story risk
(`98f0a6a4-2264-4ca6-9d22-d07442179ae2`) stays unmeasured at that head.

**PR #76 (URL hardening) closed out unmerged at head `3c2f5eb`** — FAIL on the gate, not on the reader bar:
`npm run ci` was red at that head, `Typecheck, lint, build` dying on a missing trailing newline in
`src/lib/net/public-url.test.ts` (49 lines, prettier `50:4 Insert ⏎`, 1 error / 20 warnings) so the build,
Browser smoke and Deploy never ran; `Test (shard 1/4)` died on the main-side source pin at
`src/lib/push/multi-device.test.ts:318`, which still expects the old
`z.object({ endpoint: z.string().max(2048) }).parse(input)` literal that the diff replaced with
`deleteInputSchema.parse` (`src/lib/server/push/account.ts:144`) while the
`.eq("endpoint", data.endpoint)` delete itself stayed intact; `Coverage floor` cascaded with no
`coverage-summary.json`; and `docs/context.md` was absent from a 5-file diff, which AGENTS.md:112-116
forbids. One comment: https://github.com/g0GobliN/nyuz/pull/76#issuecomment-6463000213.

Residual carried by `t_8c002124` (forge, on `harden-url-validation`: newline, pin re-point, one work-log
line, and the mapped-IPv6 bypass at `src/lib/net/public-url.ts:53,55` — `[::ffff:127.0.0.1]`,
`[::ffff:169.254.169.254]`, `[::ffff:c0a8:101]`, `[::ffff:10.0.0.5]` all ALLOWED when the predicate is
executed, byte-identical to `main` so not this diff's regression) and `t_1ac97788` (sentinel: re-verify at
the new head). Reader impact of the diff is nil — 0 files under `src/routes/` or `src/components/` — and the
blog surface still has no instrument in `docs/reader-quality-10-of-10.md`, which is recorded as a finding
rather than papered over.

**PR #70 (B-05, one story one card inside an edition) closed out at head `e9b8dfa`, merged as `35d8a06`** — duplicate direction PASS, false-merge direction FAIL. Replayed over 20 delivered editions the pass eats 4 cards in 3 editions and all 4 are one story told twice (`7268ba11` 25 → 23, `fab11fdf` 17 → 16, `e2bd737e` 24 → 23); on a 30-day / 20,000-event replay 181 fusions happen only because of B-05's two legs and 152 of those (84%) sit below ruling #18's floor — `PHP … PHP2Shell RCE Flaws` fused with `NGINX Fixes 5 Flaws`, an XFS kernel changelog fused with a Plex2Shell Linux malware campaign, `CISA Adds Six …` fused with `CISA Adds Two …` — because `properIn` (`src/lib/pipeline/duplicates.ts:408-416`) treats any Title-Case word as a proper name and `Shape` (`:652-685`) has no source field to decide a merge. One comment: https://github.com/g0GobliN/nyuz/pull/70#issuecomment-6463837056.

Residual carried by `t_c258e803` (forge): re-key B-05's legs on the subject instead of a shared name (D1), pin the three false merges as test cases quoting stored card text, and split the census flag so its before/after columns differ only by B-05's own key (D2 — `scripts/twin-corpus-census.ts:121` sets `b05Rules = securityAccess`). The durable fix stays in `cluster.ts`: this pass drops the second card at selection only, so the same story can return on a later day once the 48-hour delivered-twin window passes, and the story page path `/dashboard/story/$id` still serves both halves of a pair.

### 2026-10-30 · 09:30 and 16:30, every day — the briefing schedule follows the owner's ruling

Owner, twice in one hour: *"No change the time 9:30am and 4:30pm"* and *"change 7:30 to 9:30 and 20:30 to 16:30 thats all permanently everyday."* Recorded with its measured before-state, the design and the decisions the ruling left open in [decisions/briefing-times-0930-1630.md](decisions/briefing-times-0930-1630.md).

**Measured before (live DB, 2026-10-30T01:43Z):** three `scheduled` briefing rows, all at 07:30 local — two UTC readers at `2026-10-30T07:30Z`, the Tokyo reader at `2026-10-30T22:30Z`; `notification_preferences.send_at` `07:30:00` ×3, `days` `[1,2,3,4,5]` ×2; `standard_delivery_time()` = `07:30`. One row per reader, so the evening edition the copy implied did not exist.

**Landed:** `STANDARD_DELIVERY_TIME` 09:30 / `EVENING_DELIVERY_TIME` 16:30 / `BRIEFING_SLOTS` in `launch-plans.ts`; new `src/lib/briefing-slots.ts` (`deliveryTimesFor`, `slotLabel`) as the only place a reader's day is built; `nextSlots` in `schedule.ts`; `scheduleUpcoming` now writes one row **per slot**; `DEFAULT_PREFS` is 09:30 on all seven days; `0124_briefing_slots.sql` moves `standard_delivery_time()`, the column defaults and `briefingsPerDay` to 2, changes `enforce_daily_briefing` from one briefing per local day to one per *slot* per local day, and migrates the future rows. Reader copy follows the schedule instead of repeating a literal: delivery settings and onboarding say "Morning delivery time" and name 16:30 separately, the dashboard chip reads `09:30 and 16:30`, History carries each edition's own slot, and the briefing card's `Edition · <time>` header names no clock when the edition is unknown rather than stamping an evening edition with the morning's.

**Verified:** `digest-schedule.test.ts` pins Tokyo `00:30Z`/`07:30Z`, Kolkata `04:00Z`/`11:00Z`, New York `14:30Z`/`21:30Z`, both sides of the 2026-03-08 New York DST switch, and both editions on all seven days; `schema-migrations.test.ts` applies the whole chain including 0124 on PGlite. `grep -rn "07:30" src/` now returns only the four comments that record the retired value and the fixtures that test a custom reader time.
