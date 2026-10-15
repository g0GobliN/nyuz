# Handoff: the validated summary artifact (the ruled root-cause fix)

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

## The slice to build

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
