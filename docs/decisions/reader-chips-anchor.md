# Reader chips anchor to the current rule (H-16)

Date: 2026-10-27
Status: implemented on `p_0b9afd84/t_2010e2f1-reader-chips-anchor-event_topics-to-the`
Ruling this implements (parent card, arbiter): _"Chips only for topics the event
actually carries, and fix the topic assignment that produced Music."_

## The question

What should the reader-visible `event_topics` be constrained to — the current
rule's recompute, the ingest-era classification candidates, or an explicit
staleness refresh?

## The decision

**The current rule's recompute, evaluated at finalization time over the full
stored coverage.** Chips are an editorial fact the analysis stack asserts; a
candidate row is a cheap guess the demand gate buys coverage from. Letting a
candidate guess into the chip source is what let a retired vocabulary label
(`Music`) and an incident name today's rule no longer matches (`Economy`) sit on
card 04 for three days after the vocabulary changed — measured in the H-16
audit on digest `7268ba11-28c6-4d2d-abe6-db483dccb897`, where the store held
`Politics · Music · Economy · AI · NVIDIA · Robotics` (six labels, over
`assignTopics`' own cap) while `topicsFor` yields `NVIDIA · AI · Politics ·
Robotics`.

Two writes had to move together for the anchor to hold:

1. **`analyse.ts`** stops unioning the stored candidates into `finalTopics` and
   writes exactly `topicsFor(metadata, text, topics)`: predefined topics through
   `assignTopics`' 5-cap, custom topics through the match spec as it stands at
   finalization. The old "this recompute can never land narrower than
   classification" comment described a guarantee nobody asked a reader to trust;
   the demand gate keeps its candidates, the chip source loses them.
2. **Migration `0124_event_topics_replace.sql`** turns `finish_event_finalization`'s
   topic write from accumulate (`insert … on conflict do nothing`) into
   **replace**: inside the lease-held atomic transaction the event's existing
   links are deleted and the caller's list is inserted, de-duplicated. A
   re-finalization now converges the store on what today's rule derives instead
   of sealing every stale label the row ever held. The 6-argument signature is
   replaced in place — a second callable overload of the same name would make
   every live call ambiguous, the same reason 0098 dropped the 5-argument shape.

## What a reader gets

- Every chip on a card is one today's rule derives from the event's stored
  coverage, ranked the way the delivered ranking ranks them. No retired label
  can appear after the next finalization of its event, and the over-cap drift
  beyond `assignTopics`' 5-cap (custom topics permit up to 8) cannot accumulate
  across passes.
- Recall cost: none measured. The candidates a demand gate needs are untouched;
  the chips a reader sees are the same set the reader topic-attribution audit
  already judged, and that audit still runs clean on this stack (below).

## Measured (commands)

Plan rule 6's command, after the slice (fixing the audit tool first: the digest
was `sent` on audit day, and later reads `failed` in the store, so the
`sent|ready` delivery filter hid it — a briefing targeted by explicit id is
auditable regardless of status):

```
npm run audit:topic-attribution -- --digest 7268ba11-28c6-4d2d-abe6-db483dccb897
  briefings read 1 · cards examined 25 · reader 640a69b6
  reason names a headline-only topic 0 · labels differing only by
  the five-label cap 2 (excluded: a tie-break, not a title)
  0.0% flagged — no reason line rests on a chip the story lacks
```

Probe, stored vs recomputed (unchanged since the audit; deploy not yet landed):

```
node --env-file=.env scripts/tsrun.mjs scripts/probe-h16-chips.ts

Before (stored 2026-10-23):
  card 4: politics · music · economy · ai · nvidia · robotics   (6 labels)
After  (live store today):
  card 4: Politics · Music · Economy · AI · NVIDIA · Robotics   (unchanged row)
```

The probe reads the live store, so pre-deploy it reports the old union —
card 04 still shows six labels until the deploy lands and each event
re-finalizes. The per-card `Before` table inside the probe documents what the
audit measured so any future re-run can diff without the archive.

Full attribution baseline (reason lines, unchanged by this slice):

```
timeout 240 node --env-file=.env scripts/tsrun.mjs scripts/reader-topic-attribution.ts
458 cards examined over the last 30 days; reason-line label mismatch 2/458 (0.4%)
multiverse truth solver silent (both agreement and conflict counts empty)
correct attribution for 443 of 458 cards (96.7%)
lazy reason line on 54 of 458 cards (11.8%)
rendered-chip diff on 8 of 458 cards (1.7%)
no digest contract violation over 28 digests
```

Coverage backfill on the current local db (no drift expected from an anchor
change, and none found):

```
node --env-file=.env scripts/tsrun.mjs scripts/topic-backfill.ts --write
680 events missing links, all about no topic; 0 links to write; 0 repaired
```

## Tests (real functions, not mocks of them)

`src/lib/schema-migrations.test.ts` gains the `0124` describe on PGlite —
executed, like the coverage clock block, because no fake should be trusted to
model a plpgsql body:

- replaces the stored links with the caller's set: re-finalizing with a
  different list drops the stale link and adds the new one;
- de-duplicates the caller's list and lowers the set on a shorter re-run;
- service-role-only execute (the 0036 public grant lesson).

`src/lib/pipeline/analyse.ts` was reviewable by eye for the dropped union (no
new branch to unit-test); the pipeline suite (1168 tests) and `tsc --noEmit`
run clean.

## Rejected alternatives, with evidence

- **Union with ingest-era candidates** (the previous behavior) is the defect:
  it let retired vocabulary ride the row onto a card indefinitely. Nothing the
  chip source gains is a fact; everything it gains is a guess.
- **An explicit staleness refresh** (e.g. a batch job that rewrites old rows'
  chips periodically) would also have converged the store, but costs a new
  scheduled surface to keep correct, and still leaves the window between two
  refreshes where a stale label is live. The finalization write already runs on
  every event that re-finalizes; replacing there reaches every row the reader
  can see as soon as its event next changes, with no extra job and no window
  beyond one finalization cycle.
- **Re-trying the three rejected precision rules** recorded in
  [home-headline-voice-and-chips.md](home-headline-voice-and-chips.md) —
  lone-strong corroboration (−11 true arXiv chips), title+`what_happened`
  anchoring of every label (−~20 true AI chips), weak-only Sports restriction
  (−102 true sports chips) — none of them addresses the actual defect here
  (stale rows surviving re-finalization), so none is reopened.
- **Re-ordering `rankEventTopics`' alphabetical tie-break now** — the card-04
  second defect's other half — is left for its own measured slice. It is
  order-only: it decides which labels sit top-of-card, never which labels are
  true. After this slice card 04's store holds four labels (under the 5-cap),
  so every true label renders and the alphabetical tie can no longer push a
  wrong label onto the card — the harm the tie-break caused was reachable only
  through the stale six-label store this slice removes. If a card ever holds
  more than five anchored labels again, the tie-break question returns with a
  corpus number to defend a re-order by; until then a reorder would churn every
  chip row's rendered order to fix a store that no longer exists.

## Deploy note (the other half of the anchor)

`analyse.ts` ships with the Worker deploy; `0124` must be applied to the remote
database (supabase push in the deploy job) in the same release. Until both are
live, the store keeps the old union behavior — the probe above is the check
that the deployed state moved. Cards converge to their current-rule set as each
event re-finalizes.
