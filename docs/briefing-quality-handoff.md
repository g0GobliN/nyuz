# Briefing quality — handoff, 2026-10-09

Pick the work up here. This file is the canonical handoff; `.scratch/brief-quality/loop.md`
(the longer running log) is gitignored and stays on the machine that wrote it.

---

## 1. State of play

| Item                | Value                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Deployed commit     | `620a183` (contains the source change from `e7088a3`)                                                         |
| CI                  | Runner run `37897578077`, all ten jobs green, Deploy succeeded                                                |
| Production head SHA | `620a183003be00275bb81b7b035459fd3564f810`                                                                    |
| Suite               | 179 files / 3058 tests green; coverage 42.98% (+0.12), floor clean                                            |
| Product contract    | **No AI.** Deterministic selection, deterministic significance, silence when evidence does not support a line |

**Shipped this session:** a new deterministic significance rung (`consequence`) that reads the
story's own stored article evidence (`article_evidence`, 0090) for money the story's outcome turns
on — damages, fines, penalties, restitution, settlements, awards, forfeiture — and prints the
article's own clause, cut at the nearest comma, refused when the split leaves a fragment.
Ranked below a stored impact and above a bare figure; the why-vs-what gate still applies.

**Live proof** (reader's dashboard, deployed build): 5 significance lines across 16 cards —
three figure, one consequence, one coverage — including
`The publisher asks for damages of more than $250 million.` — with 16 provenance notes under
`Why you're seeing this` and **0** provenance sentences under `Why it matters`.

**Arbiter verdict:** rung APPROVED; an arbitrary magnitude floor was REJECTED ("judge monetary
consequences by their relationship to the event, not a dollar threshold"); the deterministic-only
contract APPROVED. Overall **10/10 HOLD** on one thing only: the scheduled content briefing at
`2026-10-09T22:30Z` (07:30 JST on 10-10) measured against the acceptance criteria in §3.

---

## 2. Fix this first — email delivery is dead (needs a human, ~5 minutes)

Every briefing email for at least the last week has been rejected by Resend:

```
2026-10-09T07:30  items  0  skipped    0b922417  email  failed  Resend 401: API key is invalid
2026-10-09T07:30  items  0  skipped    73384572  email  failed  Resend 401: API key is invalid
2026-10-08T22:30  items 16  sent       640a69b6  email  failed  Resend 401: API key is invalid
2026-10-08T22:30  items 16  sent       640a69b6  push   sent    accepted by the provider
2026-10-08T07:30  items  0  skipped    73384572  email  failed  Resend 401: API key is invalid
```

Reproduce any time with:

```
npm run briefing:checkpoint -- --recent 8
```

**Root cause.** The Worker's `RESEND_API_KEY` secret is rejected by Resend, and the key in the
local `.env` is rejected identically (`GET https://api.resend.com/domains` → `400 API key is
invalid`). So this is not a stale deployment: the key itself is revoked, rotated or a
placeholder. `src/lib/server/email/send.ts` throws when the key is _missing_; it never checks
whether the key is _accepted_ until the send, which is why this sat silent behind a digest row
that reads `sent`.

**Fix steps.**

1. Resend dashboard → API Keys → create a new key (or un-revoke the existing one).
2. Set it on the Worker: `npx wrangler secret put RESEND_API_KEY` (production) — secrets survive
   deploys, and CI does not carry it, so this is a one-time cloud change, not a code change.
3. Put the same fresh value in the local `.env` so local runs behave like production.
4. Confirm `RESEND_FROM_EMAIL` is a sender on a domain verified in Resend.
5. Verify with `npm run briefing:checkpoint -- --recent 8` after the next send: the email row must
   read `sent`, then watch the 22:30Z briefing's delivery row.

Never paste the key into chat, a commit or this file. Worker secret + local `.env` only.

**Note on honesty in the UI:** a digest row says `sent` while its email delivery says `failed`.
Both facts are recorded, but they are only visible when `digests` and `deliveries` are read side by
side — the checkpoint tool does that. An operator-facing surface for per-channel outcomes would
close this gap for good (see §6).

---

## 3. The checkpoint — `2026-10-09T22:30Z` (07:30 JST on 10-10)

```
npm run briefing:checkpoint -- --commit <deployed sha>
npm run briefing:checkpoint -- <digestId> --commit <deployed sha>     # a specific briefing
```

The tool is `scripts/briefing-checkpoint.ts`. It reads only (safe against production between
sends) and prints, per condition:

- **1 Deployment** — declare the deployed commit with `--commit`; print the digest's own row.
- **2, 3, 4 Gate and controls** — replays the candidate window (same 72h rule as selection) and runs
  the gate's own `assessReadiness` over it, listing each promotion/acquisition/launch/review control
  with its verdict and whether it shipped. A control that never entered the window prints
  **NOT EXERCISED** — do not score it as a pass.
- **5 Significance** — re-derives every line with the real ladder (`reasonFor`), reports the rung
  histogram, stored-equals-ladder count, silent count, and any stored line kept verbatim or retired.
- **6 Provenance** — counts follow/subject shapes stored in `why_it_matters` (must be 0).
- **7 Read-inside** — deliberately not re-derived here; the report names the commands to run.
- **8 Automation** — generated vs its slot, recorded failure, item rows vs `item_count`.
- **9 Persistence vs rendering** — the item rows and their stored lines, side by side with what the
  ladder produces now.
- **10 Delivery** — per-channel outcome, reported as the strongest state actually observable: an
  accepted send is the provider taking the message, never proof of arrival.

The arbiter's acceptance criteria for this sample, verbatim in intent:

1. The actual generation path runs `620a183` or a verified successor containing the same changes.
2. The commerce gate executes during scheduled selection, not only in the preview harness.
3. The SSD promotion and RTX Spark pre-order do not ship; if either is absent from the candidate
   pool, mark it **not exercised**.
4. Legitimate acquisition, launch and review stories remain eligible and are not wrongly withheld.
5. Item count and the figure / consequence / coverage / silent breakdown recorded; every emitted
   line defensible and through the why-vs-what gate.
6. No follow explanation under `Why it matters`; provenance stays under its own heading.
7. Read-inside prose clean, attributed, free of promotional furniture and masthead biography.
8. The scheduled pipeline completes with no manual intervention, and the real send/skip result is
   recorded.
9. The stored digest and the reader-visible briefing agree, including lines generated from article
   evidence.
10. The channel's actual outcome, reported separately: accepted/sent, delivered where observable, or
    failed with a recorded reason.

**Do not force a sample.** The plan's day-dedup trigger correctly refuses a second briefing for one
account-local day, and the arbiter ruled against changing a reader's topics to manufacture one. The
two 07:30Z readers (`0b922417`, `73384572`) have no topics, so their briefings are honest quiet
days that prove nothing about the gate.

---

## 4. What changed in the code

| File                                          | Why                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/pipeline/inclusion.ts`               | The `consequence` rung: money the outcome turns on, the article's own clause, fragment and connective refusal. Ranks below a stored impact, above a bare figure.               |
| `src/lib/pipeline/digest.ts`                  | Loads `article_evidence` for the picked events (`EVIDENCE_ARTICLE_CHUNK = 150`, keyed per article, folded per event) and passes it to the ladder; the `EventBrief` carries it. |
| `src/lib/server/briefing.ts`                  | The read-time recompute passes the same evidence, taken from the story's own `sourceList` — no extra query, and the line and the article cannot disagree.                      |
| `scripts/briefing-preview.ts`                 | The operator harness loads the same evidence, so the preview prints what generation would store.                                                                               |
| `scripts/briefing-checkpoint.ts`              | **New.** The report in §3, plus `--recent <n>` for the delivery census.                                                                                                        |
| `src/lib/pipeline/inclusion.test.ts`          | 26 ladder tests, including the money-consequence shapes and the rejections.                                                                                                    |
| `src/lib/pipeline/digest-cost-safety.test.ts` | One test through the real digest path asserting the stored `why_it_matters` comes from stored evidence with nothing bought.                                                    |
| `src/lib/server/story-flow.test.ts`           | One test through `loadDigestStories` asserting the line the reader sees is recomputed from the story's own evidence.                                                           |
| `package.json`                                | `briefing:checkpoint` script.                                                                                                                                                  |

Measurement that drove the design: a looser rule (any date, amount or outcome verb) reached 21 of 60
events at roughly a third precision — tournament heritage, collected-quotation metadata, vendor
truisms. It was measured, rejected and never shipped. The narrow rule qualified 2 of 60, both
defensible. Live replay after the change: 16 cards → 5 lines (figure 4, consequence 1, silent 11),
distinct 5/5.

---

## 5. Verification performed

Green on the final tree, in this order: `tsc --noEmit` (app + scripts), `eslint .` 0 errors,
prettier check, full suite 3058 tests, `npm run test:coverage` (42.98%, +0.12), `coverage:ratchet`,
`npm run build`, PWA self-test, route-walk self-test, and the runner's ten jobs including the
browser smoke on the built Worker and the deploy.

**One red run, explained.** `37896720697` (`e7088a3`) failed **Coverage floor** and skipped Deploy:
`src/lib/server` measured 71.98 branches against a floor of 71.99. Cause was real — the new evidence
read adds an optional chain and an empty fallback, and only one half was exercised. It was fixed by
covering the missing half (`620a183`), not by raising the floor; local `src/lib/server` branches then
measured 72.49 against the 71.99 floor.

Not verified: the end-to-end acceptance sample (§3), and the delivery leg (§2) — which is broken,
not untested.

---

## 6. Known gaps and the natural next steps

1. **Email is down** (§2) — fix first; it is the only thing standing between "the briefing is
   correct" and "the reader received it".
2. **Channel outcomes need a surface.** `digests.status = sent` next to `email failed` is recorded
   but not visible to an operator. An admin-console panel (or an extended `--recent`) that shows the
   per-channel state of the last N briefings would make a bad provider key impossible to miss.
3. **No AI means dead paths.** The impact writer and the AI reader block are still in the tree,
   flag-off, and their tables hold failures (73 of 87 `event_understanding` rows failed, 35 on
   `402 Insufficient Balance`). Deleting the writers and their migrations would make "code only" true
   by construction instead of by flag. It is a larger, reversible refactor — do it as its own change.
4. **Coverage-floor nondeterminism (Audit 42).** Two runner runs of one commit disagree by a few
   branch ranges. The floor is recorded with 0.05pp headroom and clamps upward only; a bounded
   reproduction of the cause is still unwritten.
5. **The consequences rung's reach is honest, not large** — 1 extra line in today's pool. Do not
   chase coverage: the arbiter's rule is that a line must be defensible, and silence is the correct
   answer when it is not.

---

## 7. Command cheat sheet

```
npm run dev                                   # port 8080
npm run ci                                    # typecheck, lint, coverage, floor, build, PWA, walk, e2e
npm run briefing:checkpoint -- --recent 8      # per-channel delivery of the last 8 briefings
npm run briefing:checkpoint -- --commit <sha>  # the acceptance report for the latest briefing
npm run briefing:preview                       # what the next briefing would contain, read-only
npm run pipeline match                         # re-match readers after analysis changes
node --env-file=.env scripts/tsrun.mjs scripts/refresh-latest-brief.ts --hours 48 [--apply]
```

Commit style in this repo: imperative subject, body explaining _why_, no `Co-Authored-By` trailer.
Before a push, `npm run ci` must be green — a red push skips the deploy job, so the change is not
live even though it is on `main`.

---

## 8. Fact ledger and the empty-story census — 2026-10-10

The read-quality loop continued in the ChatGPT `nyuz` project (the arbiter's rulings live there).
Two slices landed, each measured on a **frozen** corpus so before and after are the same stories:

```
node --env-file=.env scripts/tsrun.mjs scripts/reader-corpus-freeze.ts --out tmp/corpus.json
node --env-file=.env scripts/tsrun.mjs scripts/reader-composer-snapshot.ts --out tmp/after.json --corpus tmp/corpus.json
node scripts/tsrun.mjs scripts/reader-composer-diff.ts tmp/before.json tmp/after.json
node --env-file=.env scripts/tsrun.mjs scripts/reader-composer-audit.ts --corpus tmp/corpus.json
```

**The fact ledger (slice d).** Every selected fact now leaves the composer in exactly one of three
states — `selected = rendered + refused + lost` — and the three are a partition, asserted in
`src/lib/editorial.ts`'s tests rather than inferred from totals. The composer records which fact
became which published sentence, so a sentence-level refusal in the gate is charged to the fact
behind it, and a block drop (`short_block`, `thin_evidence_cap`, `article_limit`, `deck_refused`)
charges every fact the block carried. `facts.unrendered` lists each unrendered fact with its rule;
`facts.refusalEvents` is the rules' execution history, deliberately separate from the partition.
On the frozen 200-story corpus: **1631 = 1496 rendered + 135 explained + 0 unexplained** (before:
1508 rendered / 86 refusal events / 51 unexplained).

The one real bypass found and fixed: the ranked `priorityFacts` hoist could republish a fact the
anaphora rule had already refused. Effect measured on the frozen corpus — context-dependent
openings 15 → 7, words/story 183.1 → 181.4, 17 stories rewritten, 0 stories became empty. Six
“refused then published” cases remain and are listed by the audit with the test that matched them;
three are sentence-level (a two-sentence fact whose other sentence was refused) and three are the
older wording comparison being generous. The arbiter ruled those a standing diagnostic, not a
slice, until one of them is shown to be a real republication path.

**The empty-story census (slice e).** 44 of the frozen 200 publish no paragraphs, and every one is
now classified by the path that emptied it: **17 `nothing-selected`** (the evidence pass found no
usable fact), **27 `single-fact-is-the-deck`** (one usable fact becomes the deck; a body needs a
second), and **0 `emptied-after-selection`** — no story that selected two or more facts lost its
body. The rich-but-empty set is dominated by `llama.cpp` release tags (`b11534`, `b11526`, …): a
build tag whose only body text is a changelog bullet, already recorded in `status.md` as an
accepted limitation, not a new defect. The audit prints this classification on every run, so the
avoidable class is a number that has to stay zero.

Still blocked on a human: the Resend key (§2). Everything else above is code-side and verified.

### The arbiter's next rulings, queued

1. **`emptied-after-selection = 0` is a condition, not a number.** It is printed by the audit on
   every run; the arbiter wants a test that fails the day it stops being zero. That needs a corpus
   in the tree — today the frozen corpus is a local `tmp/corpus.json`, so the enforcement is the
   audit's own line. Committing a small eval corpus is the obvious way to close it.
2. **Next slice — the 17 `nothing-selected` stories.** The card is emitted with a real headline and
   provenance and no body. Questions to answer before any code: what does the card communicate
   without a body; does the stored summary carry real information or is it the headline again;
   where should the decision live (selection vs delivery); and what does the existing product
   contract already promise about reader-facing inclusion. The arbiter's provisional ruling is to
   withhold a `nothing-selected` item unless there is an independently defensible reason to show
   it — and explicitly **not** to add the rule in both places. Acceptance: identify all 17 with
   reasons, keep the three-way classification, keep the avoidable class at zero, do not weaken the
   evidence pass, and do not count fewer empty cards as an improvement on its own.
3. Queued after that: the 7 context-dependent openings, then the 24 quote-opening blocks, then the
   8 two-quote blocks — each evidence-driven, none an automatic rewrite.
4. The release-feed limitation stays accepted: no exceptions, no artificial facts, no turning build
   tags into substantive reporting.

---

## 9. The selection gate, and the 26 stories it was losing — 2026-10-10

Slice (g). The arbiter accepted it and closed it on the frozen corpus, in the same `nyuz` project
chat. This is what shipped, and what it cost and bought.

**The contract was already right, and in one place.** The gate's last rung, `unbriefable` in
`src/lib/pipeline/readiness.ts`, refuses any candidate whose own coverage yields fewer than two
accepted facts (`MIN_BODY_FACTS`), at selection, in `digest.ts`. There is no delivery-side
eligibility rule and there should not be one. Measured over the frozen 200 by running the composer
and the real gate over the same events:

```
npm run audit:reader -- --corpus tmp/corpus.json
# Selection gate: what the reader would actually receive
#   stories that published no paragraph        44
#     withheld as build-number                  9
#     withheld as unbriefable                  35
#   delivered with no body  <- must be zero     0
#   readable stories withheld                   18
#     of those, by the summary rung  <- zero    0
```

**The defect it found.** Rung 1 — "summary below 20 characters" — was refusing 26 stories that HAVE
a composed body (3-6 paragraphs from their own coverage), every one with `what_happened = ""`. A
chain-reaction crash with the FDNY in its deck, a banned parade, a vaccine trial, a Fed appointment:
13% of the corpus, invisible to the reader, and invisible to the operator because the reason string
said "unreadable". The rung was measuring the summariser's output, not the reader's page. Fixed by
making it conditional on the caller: `input.sources === undefined`, and the evidence rung decides
readability wherever coverage was actually loaded. An explicitly empty `sources: []` is _evidence_
that there is nothing to read and takes the evidence path, not the fallback — tested, not assumed.

**The pair that made it a trade-off rather than a fix.** Two event promotions escaped every commerce
rung and were withheld only by rung 1, i.e. by accident. One is now refused on purpose by a new
rung — a ticket/pass/badge/registration noun AND an incentive AND an explicit deadline, all three in
one title, no `NEWS_VERB` exemption because "starts in 4 days" is the offer's clock. The other (a
session listing) is deliberately **kept**: the arbiter's ruling is that concerning a commercial
event is not itself a defect, so no rule was written for it.

**The transition table (same frozen 200, before -> after).** ready 113 -> 138. Withheld as rung 1
48 -> 0; as build-number 9 -> 18 (nine `b115xx` whose empty summary had been masking an identifier
refusal); as unbriefable 22 -> 35; as commerce 2 -> 3; marketing, quote, commit-message unchanged.
**Newly withheld 0.** Empty stories delivered 0 -> 0. Readable stories withheld 43 -> 18, of which
26 -> 0 by the summary rung. The 25 newly ready are this corpus's measured outcome, not a promise
about every summary-less story; the remaining 18 readable-withheld are legitimate refusals and their
rules must not be weakened to improve a count.

**Verified:** tsc clean (app + scripts), eslint 0 errors, `readiness.test.ts` 36 tests (6 new), the
six affected suites 108 tests (digest, digest-delivery, digest-cost-safety, briefing-timing,
story-flow, readiness). 0 model calls, 0 new queries, 0 new allocations — the gate is one
deterministic pass over material already loaded, so nothing here changes cost per reader at 1,000 or
100,000. The audit prints the cross-tab above on every run.

### The next slice, ruled and queued: fused-subheading decks

The 25 recovered decks were read rather than counted, and two are two sentences run together with no
punctuation:

```
Locals also express fear after man shot in the neck while his child was in the back of his car Residents of Manhattan's Marble Hill neighborhood were furious at federal ICE on Friday…
Prospect of contentious Orange Order march through Garvaghy Road in Portadown has led to a nearly two-week standoff The Northern Ireland secretary of state has banned the Drumcree parade…
```

A source subheading (no terminal punctuation) is being glued to the sentence after it. The arbiter's
acceptance for the fix, verbatim in intent: reproduce both from the frozen corpus and preserve the
original outputs; trace how the subheading enters the deck and why the boundary is invalid; state an
explicit rule for combining summaries, subheadings and fragments; preserve meaning and attribution
and **do not insert punctuation blindly where the underlying text is ambiguous**; the deck must read
as coherent prose with correct separation and capitalisation; regression tests for both cases _and_
for a subheading that legitimately continues a sentence; re-run the same 200-story audit and report
deck quality, factual coverage, refusals and dispositions; keep the deterministic path and every
evidence gate intact; **no general-purpose sentence rewriter** — fix the boundary between source
fields and their composition. If the audit shows the same structural defect in other stories,
include them; do not expand into unrelated deck polishing.

**The trace, done before any code, and it moved the fix upstream.** The deck is not appending
anything. For the Marble Hill story the _stored_ evidence unit is already fused, verbatim, in
`article_evidence`: `"Locals also express fear after man shot in the neck while his child was in the
back of his car Residents of Manhattan's Marble Hill neighborhood were furious at federal…"`. The
cause is one line in `src/lib/pipeline/html-text.ts`: `stripTags` turns **every** tag into a word
space before whitespace is collapsed, so a `<br>` (or block boundary) inside a paragraph welds a
punctuation-less standfirst to the sentence after it, and the evidence extractor then finds no
terminal punctuation between them and stores one fact. The proposed rule: a line-breaking tag is a
sentence boundary, an inline tag stays a word space.

**A counter I proposed and then withdrew.** The obvious ruler for the stored population (lowercase +
space + Capital + a word) fires on **933 of 1369** stored units — 68% — on "trains to Delhi",
"Haryana state", "Prime Minister Narendra Modi". It is the blind heuristic the arbiter forbade,
expressed as a counter, and it is worth remembering as a shape: a counter that calls two thirds of
the corpus defective is one nobody reads. The honest measurement is a re-extraction diff over a
bounded sample of pages, which also means **the frozen 200 cannot be the acceptance corpus for the
extraction fix** — its evidence is already stored. The arbiter's ruling on (i) the boundary rule,
(ii) refuse-vs-split for already-stored fused units, and (iii) the bounded re-extraction diff as the
slice's before/after was requested and had not arrived when this file was written.

Queued after it, in order: the 7 context-dependent openings, then the 24 quote-opening blocks, then
the 8 two-quote blocks.

## 10. The fused standfirst, fixed where it started — 2026-10-10

Slice (h), accepted by the arbiter with one correction from me. The defect was never in the composer: it
was one line of `src/lib/pipeline/html-text.ts`, where every tag became a word space, so a
punctuation-less standfirst was welded to the sentence after it and stored as one fact.

**Shipped.** A structural tag (`<br>`, `<p>`, `<div>`, `<h1>`-`<h6>`, `<li>`, `<ul>`, `<ol>`,
`<blockquote>`, `<section>`, `<article>`, `<figure>`, `<figcaption>`, `<td>`, `<th>`, `<tr>`, `<table>`,
`<dd>`, `<dt>`, `<dl>`, `<pre>`, `<hr>`) ends a text run; every other tag stays a word space, so
`The <a>New York Times</a> reported` is untouched. Runs are joined by a private-use marker, converted
to `STRUCTURAL_BREAK` on the way out, because a page's own markup newlines are formatting and not
boundaries. `selectEvidenceUnits` splits the body into runs before sentence extraction, so a run is a
candidate boundary. **No full stop is inserted anywhere**, and a run that is half a sentence is refused
by the existing `isCutSentence` rule rather than published as a fragment.

**Two `npm run` entry points, both read-mostly:**

```
npm run audit:fusion                     # bounded re-extraction sample, one article per publisher
npm run reenrich:fusions                 # dry run: validates and writes nothing
npm run reenrich:fusions -- --apply      # writes validated rows (production data — needs the owner)
```

**Measured, and a correction that matters.** The first "confirmed" test could not fail — it looked for
the two halves of a fused unit inside text where the unit was still whole, and collapsing whitespace
turned the new run boundary back into a space. It certified 10 of 16 articles. The test that can fail:
a unit always comes from one run, so **a stored unit that no longer sits inside any single run was
divided**, plus its first and last 40 characters must survive so a deletion is not counted as a repair.
On the same 20-article sample: 16 fetched, 4 unavailable, 11 carrying the candidate signature, and
**4 confirmed** — Marble Hill, Drumcree, the Delhi protest (BBC), Starlink India (TechCrunch). Word loss
above 5 across the sample: 0.

**The repair, dry run: 4 attempted, 4 corrected, 0 rejected, word-neutral** (872 = 872, 630 = 630). Each
row keeps the original evidence and the proposed replacement, so it can be rolled back without a
re-fetch. A failed fetch leaves the stored row untouched.

**The candidate ruler is not a defect count and must never be quoted as one.** It fires on 374 of the
corpus's 1369 stored units and 96 stories, because "travelled from nearby Haryana state" and "Prime
Minister Narendra Modi" look exactly like a fusion to a pattern. The audit prints those numbers with
that caption and points at `audit:fusion` for the only count that means anything.

**Verified:** tsc clean (app + scripts), eslint 0 errors, html-text 11 tests (6 new), evidence-extract
21 (2 new), full `src/lib` suite 3028 of 3029 with only the pre-existing `count.test.ts` Windows path
failure.

**The repair was applied and verified, twice, and the second time is the interesting one.** The owner
authorised it; `npm run reenrich:fusions -- --apply` wrote the 4 rows, and verifying the written rows
(instead of trusting the write) caught a regression of my own: the first version of the writer rebuilt
each unit field by field and **silently dropped `entities`**. 782 of 2035 stored units across the corpus
carry entities, so the four rows stood out as implausible; a fresh extraction of the same pages yields
5 and 9 entity-carrying units for two of them. Fixed, re-applied with `--force`, re-verified:

```
4 rows: units=12 before and after, fused units 0, entities restored where the extraction produces them,
words identical (872/630/882/804)
```

`--force` exists because of that mistake: the "nothing to repair" skip condition would have made an
_incomplete_ repair invisible and permanent. The rollback material for the applied rows is
`tmp/re-enrich-applied.json`.

### A delivery breach the audit found on the live window — the next slice

`delivered with no body <- must be zero` read **1** after the repair, on a freshly frozen 200. It is not
caused by the repair or by slices (g)/(h); it is a pre-existing disagreement between the gate's counter
and the composer's publication rules, and the audit's new cross-tab is what made it visible.

```
Microsoft barred from sponsoring foreign workers for US residency
  gate: ready (composedFactCount 3)
  composer: 3 facts selected, 1 rendered as a 31-word deck, 2 refused as stacked_quotes,
            0 paragraphs, 0 unexplained
```

Three quoted fragments of the story's own sentences each carry two quotes, so `stacked_quotes` refuses
both non-deck sentences, and the reader would receive a card with a headline, a deck and no article.
The gate's readability rung counts facts the _evidence_ pass accepts; the composer additionally applies
publication-time rules, and where those disagree a body-less card is delivered. **Proposed seam:** the
gate should ask the composer's own answer — "does this story publish at least one paragraph" — once per
candidate, composed from the same story the delivery path will use, so the rule lives in one place and
no counter can drift. Not started; it needs the arbiter's ruling and its own before/after.

The empty-story census now also splits the class it used to overstate: on the same 200,
`emptied-after-selection (charged to a rule) 2` (`unresolved_context` once, `stacked_quotes` twice) and
`emptied after selection (the avoidable class) 0`. Two or more facts selected and no paragraph is not a
defect by itself; a fact no rule can account for is, and that is the number the line reports.

**Ledger on the repaired corpus:** `1572 = 1422 rendered + 150 explained + 0 unexplained`, reconciles.

**The frozen corpus lives at `tmp/corpus.json`** (200 events, as `CorpusEvent[]`; re-freeze with
`scripts/reader-corpus-freeze.ts`). It is the only file in `tmp/` worth keeping between sessions:
the live window slides, so a re-freeze is a different 200 stories and no longer a before/after of
the same change. Everything else in `tmp/` is a run's output and can be deleted — except, while the
repair above is pending, `tmp/fusion-sample.json` (the repair's input) and `tmp/re-enrich-report.json`
(the rollback material).
