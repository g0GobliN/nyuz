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

nyuz is a daily news briefing product. Each reader gets one briefing a day, built from
coverage the system has already collected and clustered, delivered by **email**, **browser
push** and **Telegram**. Every story in it opens into a **Read** page: a headline, a deck,
and an article assembled deterministically from the coverage itself — never from model
prose. The product's promise is that a story is _told_ to the reader rather than handed to
them as links.

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
| `uno`   | $0      | —       | free: fewer briefings, no breaking alerts       |
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

| area                                         | state                                                         |
| -------------------------------------------- | ------------------------------------------------------------- |
| Marketing site, pricing, how-it-works, legal | Built                                                         |
| Accounts, sign-in (email + Google + GitHub)  | Built                                                         |
| Admin console, roles, audit log              | Built — the security boundary is `adminOnly`/`superadminOnly` |
| Blog, site content, feature flags            | Built                                                         |
| Billing (Stripe checkout, portal, webhook)   | Built; no live customer                                       |
| Ingestion, clustering, analysis, matching    | Built                                                         |
| Briefing assembly and delivery               | Built — email, push, Telegram; quiet days skip honestly       |
| **Briefing email actually delivered**        | **BLOCKED — the Resend key returns 401** (see §7)             |
| Reader article (deterministic composer)      | Built, under active quality work (see §5)                     |
| Story Ask                                    | Dormant — endpoint disabled, zero allowance on every plan     |

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

## 7. What is next

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
4. **The 9 two-quote blocks** — D7, after D6. D4 measured that they do **not** overlap the 29
   quote-opening blocks on this corpus (0), so they are their own queue and are not yet classified.
5. **The `rss` risk, kept visible**: no new evidence yet justifies changing the policy again, so the
   audit's `Vendor shapes` section is the instrument to re-measure on later windows.

Blocked on the owner, not on code:

- **The briefing email has never been delivered to a reader because the Worker's Resend key
  returns 401.** Nothing in the code changes that: it needs a fresh key from the Resend
  dashboard set as the Worker secret.
- **`RESEND_FROM_EMAIL` is `onboarding@resend.dev`**, so even with a working key a stranger
  cannot receive mail until a domain is verified.

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
  stand on its own; no card ships without a body.
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
| Product state, area by area | [status.md](status.md) |
| Rulings on the reader-delivery path, with their dates | [decisions/reader-delivery.md](decisions/reader-delivery.md) |
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

npm run audit:reader -- --corpus tmp/corpus-after.json   # the composer's published prose
npm run audit:reader -- --find "DigiCert"                # one event's raw rows
npm run audit:fusion                                     # re-extract sources to confirm fusions
npm run briefing:checkpoint                              # one command, end to end
node --env-file=.env scripts/tsrun.mjs scripts/reader-corpus-freeze.ts --out tmp/corpus-after.json
```

Node 22 (`.nvmrc`) is required; `wrangler dev` refuses to start on Node 20.

**Known local fragility, measured 2026-10-11.** On this machine the coverage suite can starve its
own heavy files: 179 files across many workers, and four of them then exceed their ceilings —
`exclusions-db.test.ts`, `launch-plans-db.test.ts` and `ai/code-first-db.test.ts` (30s `beforeAll`
hooks driving PGlite) and the filesystem-walking `ai/callsites.test.ts` (60s test). The same four
pass unchanged with `npx vitest run --coverage --maxWorkers=2` (verified 2026-10-11: 41 tests, 64s).
A red run that names only those files is worker starvation, not a broken change — check whether the
diff touches them before believing the failure.
