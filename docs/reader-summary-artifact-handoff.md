# Handoff: the validated summary artifact (the ruled root-cause fix)

**Status 2026-10-15: both halves of the ruling are landed and the arbiter has ruled on this slice.**
The withhold half is in force at the join, and the composed half is built and stored —
`digest_items.summary` (0118), composed at briefing build time through `recoverCardSummary`'s own path
and read at the delivery join (the email's translated path included: a translation of a refused line is
withheld in every language). Ruled the same day: **Q1 = A** — an alert's explanation stays a paragraph
under the alert's own contract, no code change; **Q2 = A first** — wait up to 24 hours after the deploy
for a natural briefing build, with a labelled controlled build for a reader whose channels are empty as
the approved fallback; **historical backfill and universal summary composition are not authorized**.
The measurement, the scope and the ruling are recorded in
[decisions/reader-delivery.md](decisions/reader-delivery.md#the-composed-half-of-the-ruling-landed-2026-10-15);
the section below is kept as the specification the slice was built from, so the two can be compared.
What is *not* yet observed live is a delivered row carrying an artifact: that comes from the first
briefing built after the deploy, and `npm run audit:delivered-summary -- --deploy-at <iso>` reports it
from then on, split into the historical and post-deploy cohorts the ruling requires. The briefing
denominator was corrected in the same measurement: 13 of the 20 "delivered" briefings actually reached a
reader (the other 7 have only failed deliveries), so the affected-briefing rate is 8 of 13 = 61.5%.## Where the post-deploy verification stands (read this first in a fresh thread)

- **Landed and deployed:** `a82a8c0` (deploy finished **2026-10-15T06:42:45Z**) and the email-join slice
  `9ff000d`. **The checkpoint is recorded as OVERDUE**: the 24-hour window ended 2026-10-16T06:42:45Z,
  and A is expected at about 15:00Z on 2026-10-16, ~8h17m later. Do not reset that clock.
- **The natural attempt is over and produced nothing:** the 22:30Z slot ended `failed`, 0 items,
  *“missed slot by 123 minutes; not sent”* (last claim 00:26:40Z, generated 00:32:40Z) — the sixth
  consecutive night of the free-plan CPU condition. The two 07:30Z builds are `skipped` with 0 items.
  **The 22:30Z reader has received no briefing for six nights.**
- **Why the controlled build did not run at 00:34Z:** `enforce_daily_briefing` (0082) drops a second
  briefing for the same account-local date when the day's earlier row failed *after* starting, and the
  reader's 10-15T22:30Z row (JST 2026-10-16) has `generation_started_at` set. The CLI still prints
  *“slots created 1”* — it counts planned rows — while writing nothing. **The guard must not be disabled
  and the failed row must not be rewritten**; every reader is blocked until **15:00Z** (JST midnight).
- **A, to run at/after 15:00Z (one run, ruled 2026-10-16):** first verify the slot row actually exists
  after `scheduleUpcoming` (query `digests` for the reader; do not trust the printed count). If the slot
  is *still* rejected, stop and report — do not retry. Then
  `npm run pipeline -- digest --user 640a69b6-36ff-4523-841c-957abfc60315 --now --skip-send` and verify:
  a real digest and its items persisted; composition attempted for at least one item; the artifact passed
  all three checks; `delivered_revision` matches the revision composed from; the reader path reads the
  artifact and never substitutes a refused raw line; **no notification sent by the controlled build
  itself**; and that `--skip-send` **does** queue delivery rows which the Worker's own delivery stage
  then sends (the email leg will fail with `Resend 401` while the Resend key is invalid; the push leg
  succeeds). Keep three cohorts separate — historical pre-deploy delivery, controlled build, actual
  delivery — and never count a stored artifact as delivered.
- **B already ran (read-only, 2026-10-16):** `npm run diagnostic:composition -- --user <id>` replays the
  real selection and composer, writes nothing and delivers nothing. Findings: the reader's pool is 1000
  matches → 128 eligible → 37 considered → **13 ship, 23 withheld**, and **all 13 shipping items carry an
  admitted line, so a build today would store 0 artifacts**. Of the 200 most relevant matches, **16 are
  compose targets** (5 refused, 11 with no stored line), 14 withheld by the gate and **2 shippable but
  outside today's eligible set** — for both, the composer publishes a valid line. So A may legitimately
  report *composition not attempted*; that is a fact about the pool (~3.4% of delivered lines are refused
  historically), not a defect. B's numbers must never enter the delivered-artifact metric.
- **What to run when a briefing with items is built:**
  `npm run audit:delivered-summary -- --deploy-at 2026-10-15T06:42:45Z` — the post-deploy cohort line
  must show `composed artifacts >= 1`, `stored lines refused == repaired`, `raw fallbacks 0`; then read
  the rendered briefing page for that reader in the browser and compare the line to `digest_items.summary`
  (the ruling wants rendered text, not only database flags).
- **After the checkpoint closes, the ruled next slice** is **a build that completes inside the free-plan
  CPU budget for a large pool** (reproduce → locate the spend → reduce without bypassing readiness,
  duplicate suppression or composition → demonstrate completion → verify selection, artifacts and
  delivery). Do not pay to lift the limit and do not weaken a quality gate to fit the budget.
- **Live defect found on the way, owner-side:** every email leg fails with `Resend 401` (*“API key is
  invalid”*) — 128 failures since 2026-09-11 and still failing today, on both `skipped` and built
  digests; the local `.env` key is invalid too. Two of the three readers are **email-only**, so they
  receive nothing at all; the third has push, which succeeds. A fresh Resend key (and a verified sending
  domain) is owner configuration, not code, and the no-domain stage condition means transactional email
  to a reader cannot work until one exists.
- **Already ruled, do not rebuild:** alert text stays a paragraph under the alert contract (Q1 = A);
  backfill of delivered history and universal summary composition are **not authorized**.
- **Also recorded 2026-10-15, measured and not acted on:** the repair-only scope leaves ~1% of printing
  lines multi-sentence (3 of 279 delivered, 8 of 838 card lines); a live story page carries one dropped
  determiner (*“Department's plan …”*) with no population measured. Both live in
  [decisions/reader-delivery.md](decisions/reader-delivery.md).

State as of 2026-10-15, `main` at the commit that lands this file. Everything below is verified or
cited; nothing here is an assumption. Read [decisions/reader-delivery.md](decisions/reader-delivery.md)
for the ruling and [context.md](context.md) §6-7 for the state it lands in.

## The one-sentence problem

**A reader's summary line is `events.what_happened` read straight out of the database — the feed's own
description — while the story page composes and validates its prose. Two standards on one product, so a
story can be withheld on one surface and delivered on another.**

## What the trace established (the step the ruling required before any code)

1. **`digest_items` does not store a summary.** Its generated column is `why_it_matters` only
   (`docs/database.md` line 88; `supabase/migrations/0001_init.sql:187`). Every surfaced line is a
   **read-time join from `digest_items.event_id` to `events.what_happened`**:
   `src/lib/server/briefing.ts:1259-1302` (`what_happened` selected, `lead = event.what_happened ?? ""`,
   `what: event.what_happened`), `src/lib/server/briefing.ts:105-126` and `:522-544`
   (`{ title, summary: e.what_happened }`), `src/lib/pipeline/digest.ts:2094-2179`,
   `src/lib/pipeline/alerts.ts:538-580`, `src/lib/server/history.ts:184`.
   **Consequence:** there is no stored per-surface copy to reconcile — the same raw column reaches
   dashboard, briefing, email and alerts, so **one validated artifact fixes all four at once**.
2. **The digest builder never validates that line.** `src/lib/pipeline/digest.ts` assembles
   `why_it_matters` (the per-item explanation) and selects titles plus summaries for its own reading
   (`:1141`, `:1163-1169`, `:1411`, `:1510`), but the summary it hands over is the raw column.
3. **The provenance hook the ruling asks for already exists**: `events.material_revision` (migration
   `0097_material_revision.sql`) and `digest_items.delivered_revision`
   (`0099_revision_delivery.sql:28-50`), which record *which revision of the event material a reader
   actually received*. A validated summary artifact should carry the revision it was composed from.
4. **The composition path to reuse exists** and is the story page's own: `admissibleReaderSentence` in
   `src/lib/reader-evidence.ts` (the shared boundary, now carrying the development-record refusal),
   the card's recovery/withhold seam in `src/lib/card-summary.ts`, and the item-level seam in
   `src/lib/pipeline/inclusion.ts` (its step 6 is already "an empty string, which
   `digest_items.why_it_matters` ... leaves unset").

## Already landed (do not rebuild it)

The **withhold half** of the ruling is in force: `deliveredSummary` in `src/lib/reader-summary.ts` is
asked at the join every reader surface reads through, so a stored summary the boundaries refuse is
withheld rather than printed -- re-measured at 10 of 289 delivered lines withheld, 8 of 20 briefings
affected, and the missing-line rate rising from 8 to 18 of 297 (6.06%) as an explained cost. Its tests
record two delivered lines as **true negatives** (a single-reference commit line, a flattened list
item); widening either is an arbiter decision, not a code change to slip in. `npm run
audit:delivered-summary` reproduces the measurement and names the predicate behind each refusal.

## The seam the composed half must use (found 2026-10-15, do not re-search it)

The existing composition path for a refused line is **`recoverCardSummary(story)`** in
`src/lib/editorial.ts:2429`, which calls `composeArticle(story)` and takes the first non-empty block of
`deck.text` / the paragraphs, refusing it through `briefingText`, `cardSummaryRefused` and
`admissibleReaderSentence` before returning -- empty string when the story publishes nothing valid. The
card already recovers through it (`src/components/dashboard/story-card.tsx:101` and `:104`).

**Why the composed line must be stored and must not be composed at read time:** the card's own comment
records the cost -- 150-220 ms for every such card in a feed -- and the Worker runs on the free plan's
10 ms CPU budget per invocation (the recorded constraint, `docs/decisions/cpu-killed-invocations.md`).
`hydrateEvents` is on the request path, so composing there for the withheld items would be paid by a
reader's request. Build time is where the pipeline already composes the same article for the readiness
gate, so the recovered line is nearly free there and must be persisted (with the revision it was
composed from, the provenance the ruling asks for) for the surfaces to read.

## The slice that was built (kept as the specification it was built from)

At **briefing build time** (inside the digest build path, `src/lib/pipeline/digest.ts`), per item:

1. resolve the event to its story and its source material;
2. compose the summary **through the existing path** — the same call the card/story page uses, no new
   composer, no model-writing path;
3. apply the applicable checks: sentence admissibility (`admissibleReaderSentence`), publisher
   furniture, context recoverability, attribution;
4. **store the validated result with provenance** (the revision it was composed from), so the reader
   surface reads the artifact instead of `what_happened`;
5. **if validation fails, withhold the summary** — store nothing and let the surface render no line.
   The raw description is **never** substituted. A card with no line is acceptable; a card with a raw
   feed description is the defect being fixed.

Then repoint the reader surfaces (`src/lib/server/briefing.ts` home feed + history, the email path
under `src/lib/server/email/`, `src/lib/pipeline/alerts.ts`) at the artifact, leaving the existing fast
paths only where they demonstrably read a valid artifact.

**Do not** add a second composer, do not let a retry loop restore the raw summary, and do not let
recovery pick a *different* event's material.

## Acceptance (the ruling's criteria, measured on the delivered surface)

`digests` + `digest_items` + `deliveries`: delivered defective-summary rate, defective-item delivery
rate, missing-summary rate, affected-briefing rate, valid-summary availability, and a **raw-fallback
count that must be zero** — each with numerator and denominator, and the denominator not switched
between reports. Baseline to beat, last 21 days: **57 briefings, 341 delivered items, 12 refused
(3.5%), 14 with no line, 14 of 57 briefings affected (25%)**. Gate: zero refused summaries in the
defined acceptance sample, zero raw fallbacks, no unexplained rise in missing summaries, no
attribution or provenance regression, correct on dashboard, briefing and email.

## Method notes that cost time here, do not repeat them

- Measure the **delivered** surface (`digest_items` × `deliveries`), not a tail of newest events; the
  event-tail numbers are not a reader-quality measure.
- Take each scope decision from a **live measurement with negative controls** before writing a rule,
  and record the numbers in the code comment where the rule lives (see the `developmentRecord` block
  in `src/lib/reader-evidence.ts` for the shape).
- `npm run ci` is the push gate; the pieces can be run as one background chain
  (`npm run lint && npm run test:coverage && npm run coverage:ratchet && npm run build &&
  npm run pwa:self-test && npm run route:walk:self-test && npm run origin:self-test && npm run e2e`)
  and polled, because the full run exceeds a single foreground window (~13 minutes).
- The checkout may be in **detached HEAD** with a stale local `main`; push the intended commit as
  `git push origin HEAD:main`.
