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
| Ingestion, clustering, analysis, matching    | Built                                                                                                                                                                                                               |
| Briefing assembly and delivery               | Built — email, push, Telegram; quiet days skip honestly                                                                                                                                                             |
| Breaking alerts                              | Built; gated like a briefing story (D8), floor ruled to stay (R1)                                                                                                                                                   |
| **Briefing email actually delivered**        | **BROKEN — two causes in sequence** (see §7): 125 failures for `Missing EMAIL_UNSUBSCRIBE_SECRET` (26 Aug → 11 Sep), then 128 for the Resend 401 (11 Sep → today, current); nothing accepted since 2026-08-26T22:59 |
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

## 7. What is next

**The owner's priority, stated 2026-10-12 and now a rule ([AGENTS.md](../AGENTS.md)).** This gates
what "next" means: **what the reader reads must be 10/10 and no rubbish reaches a reader**, judged on
the live product by reading it as a stranger, and **nothing else is next until that holds.** The
alert side is held to the same standard in its own terms — a breaking, important, recent event, and
silence otherwise. The R1 order below still stands and is still the blocking set; it is just no
longer the answer to "what work do I take", because reader quality outranks all of it.

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

- **The briefing email is blocked by two independent causes, not one.** The first failure after the
  last accepted send (2026-08-26T23:55) was `Missing EMAIL_UNSUBSCRIBE_SECRET (minimum 32
characters)` on 2026-08-26T23:55, unbroken to 2026-09-11T05:45 (125 failures); the Resend 401 is the
  current cause, 128 failures from 2026-09-11T06:14 to today. `EMAIL_UNSUBSCRIBE_SECRET` is still
  absent from this environment, so local runs and the Worker do not fail for the same reason.
- **`RESEND_FROM_EMAIL` is `onboarding@resend.dev`**, so even with a working key a stranger
  cannot receive mail until a domain is verified.
- **The Stripe price variables are the pre-rename names.** `npm run billing:check` exits 1:
  `STRIPE_PRICE_PLURA_*` / `STRIPE_PRICE_OMNI_*` are unset and `PERSONAL`/`PRO` are present but no
  longer read. Checkout resolves no price until they are renamed — and no live payment has ever run.

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
