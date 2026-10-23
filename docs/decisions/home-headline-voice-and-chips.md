# Headline voice and wrong topic chips on the home feed — measured 2026-10-23 (rook, wave 2)

**Card:** `t_1e5032eb` ("Home feed: close the H-class clarity findings"), source of truth
[reader-clarity-audit-2026-10-22.md §3](../reader-clarity-audit-2026-10-22.md) and §8. This record
marks what closed in code and what closed as a measured finding, so the next session does not
re-run the rejected rules as if they had never been tried.

## What landed

Two slices, both in the card's allowed files, both failing-test-first:

1. **The band is Low / Medium / High over the shared 0–10 score** (H-05, plus S9's ruling of
   2026-10-21). `importanceBand` (`src/lib/story.ts`) returned "Notable" below 3 — a compliment
   printed on the 14 of 25 feed cards sitting in the bottom band, in a scale mixing registers
   (level / size / compliment). It returns **"Low"** now; the three bands can be put in order by
   reading them. The `"Notable"` union member survives only so stored fixtures and the evaluation
   corpus keep compiling; the band a reader is handed can no longer be produced. Before/after over
   the audited digest's 25 cards: **before — High 2 · Medium 9 · Notable 14; after — High 2 ·
   Medium 9 · Low 14.** The briefing side is owned by the wave-1 card (PR #59): its
   `IMPORTANCE_TONE` needs a `Low` key once these merge — see the hotspot note on the card.

2. **A carried headline is framed as the outlet's own wording** (H-01/H-04/H-18's frame half).
   `headlineOutlet` (`src/lib/story.ts`) finds the source row whose stored `headline` equals the
   card's title, verbatim, and `StoryCard` prints the ruled frame — "As published by \<outlet>" —
   in place of the bare wordmark. No frame is printed for a headline no source stores. This also
   fixed an attribution error the audit implicitly names: on the audited four-publisher card
   (audit card 12, digest `7268ba11`), the headline "Musk confirms SpaceX and Tesla exploring
   merger" is **Al Jazeera's** wording, while the old wordmark showed whichever outlet sorted
   first. Before/after: carried-headline cards framed **25 of 25** (every audited title verified
   verbatim against its article row); mis-attributed clustered card **1 → 0**.

## What closed as a measured finding, not code

- **The headline rewrite half of the ruling** — "nyuz writes its own sentence-case headline from
  the event" — cannot be produced by pure code from stored data without inventing facts a source
  headline does not state, which the same ruling forbids. The audit's suggested rewrites
  (H-01 "AI is helping amateur hackers…", H-08 "A software CEO says clear specifications…")
  rest on body facts, not on the headline's words. That is a composer headline-policy slice
  (forge's files: `editorial.ts` / the analysis stack), not a card-surface edit. Title Case
  count over the audited 25: **5 before, 5 after** — unchanged in words, changed in voice: the
  printed Title-Case headlines are now visibly attributed rather than printed in nyuz's voice.
- **Jargon expansion (H-11, H-14)**: forge's shared expansion helper has not landed (no
  expansion list exists anywhere in `src/` as of 2026-10-23 — the "jargon" hit in
  `reader-article.ts` is the legacy model prompt, inert). Reuse when it lands; **no second
  expansion list was forked**, per this card's own instruction.
- **The card 04 topic chips (H-16)** — the audited fixture's root cause is present-day
  **stale**: stored `event_topics` for digest `7268ba11` card 04 are
  `Politics · Music · Economy · AI · NVIDIA · Robotics` (six labels — the store holds more than
  the 5 `assignTopics` ever returns) while recomputing `assignTopics` today over the same stored
  text yields `NVIDIA · AI · Politics · Robotics` — **Music and Economy are already refused by
  today's vocabulary** (prior rulings #13). The chips a reader saw came from the ingest-era
  union: `analyse.ts` unions its recompute with `event_topic_candidates` written earlier,
  deliberately "never landing narrower than classification" — so older vocabularies keep
  labeling cards until a new analysis pass. The fix belongs in the analysis stage's write path
  (`analyse.ts`, forge's file — named in comments, not edited here), tracked as a child card.

### Rules tried and rejected by measurement (2026-10-23, whole DB)

| candidate rule | effect on the audited fixture | measured cost elsewhere |
| --- | --- | --- |
| lone-body-strong needs corroboration (strong && weak, or strong ≥ 2, or headline hit) | drops the wrong Politics chip on card 04 | 11 of 625 events lose true labels — every one an arXiv paper whose "ai" evidence lives in the `cs.ai` category string or its abstract; AI · Robotics · Economy · Health chips all dropped |
| labels filtered to what title + event line (`what_happened`) carry | drops Music, Economy, Politics — the audited wrong chips | 17 of the audited 25 change, dropping ~20 **true** labels, including AI on 11 cards whose event line never says "ai" — erring against the "topics the event actually carries" half |
| Sports restricted to strong-or-signalled evidence (weak terms need strong company) | drops the wrong Sports chip on card 11 ("code coaches", "a team of codesmiths") | 102 events label Sports from weak terms only, and the samples are **true** sports news (Steelers' quarterbacks, a WNBA record, a Dolphins trade, the Asian Games) |

Each rejected rule moves the wrong-chip number down while measurably destroying correct labels
elsewhere — a trade no reader would ask for. The audited fixture's remaining wrong label
(Politics on card 04, from "…hosted concerts galas and political events…" in a venue blurb)
fires on incidental context that only the event's own line can distinguish from reportage —
the same anchoring the analysis stage owns.

## Merge collision (recorded as predicted)

First runner run (39905646456, pre-merge head) went red on the exact hotspot predicted in the PR body:
PR #59 had merged to `main` (72f85b7) meanwhile, and its `IMPORTANCE_TONE` in `briefing-preview.tsx`
lacked the new `Low` union member — a type error only the merged tree has (local green ran on the
branch alone). The branch integrated `origin/main` and added the missing key with the same muted
tones as `Notable`, so the briefing's band word is the feed's, too. `briefing-preview.tsx` is the
wave-1 card's file (its card and PR are both complete); the edit is the one companion line the union
change requires and is called out in the card comments.

## Verification

- `nvm use 22`; tests red-then-green measured: with the two source files stashed, 4 assertions
  fail (`importanceBand(2.9)` not "Low" ×2, frame absent ×2); with them applied, all pass.
- `npm run typecheck`, `npm run lint`, the full suite, `npm run audit:surfaces` and
  `npm run audit:delivered-line` run on the final tree before publication (counts in the PR body).
