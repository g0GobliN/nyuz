# One reader-facing score scale: 0–10 with one decimal (ruled 2026-10-21, option A)

**Where it was ruled.** The CEO's ruling of **2026-10-21**: _option A — one 0–10 scale with one
decimal_. It reaches this slice through the task that authorised it ("Implement S9 — one 0–10 scale",
`t_329d386f`), which quotes the ruling and requires it to be recorded here before the code lands;
[design-spec-2026-10-21.md](../design-spec-2026-10-21.md) §S9 is the case it decided, and it had
recommended the same option. This session did not hold a verbatim transcript of the arbiter's reply
and does not quote one: the ruling is recorded as it was handed over — option A, one scale, one
decimal — together with the reason S9 gives for it, which the implementation depends on.

**Why it was asked.** The product printed **one stored number two ways**, and neither surface said
which scale it was on. On a story page the rail read **Relevance 100% · Importance 50% · Novelty
70%** (`story-sidebar-1280.png`); on `/dashboard/alerts` the reader was told **"Only events scoring 6
or higher interrupt you"** (`alerts-1280-fold.png`). The data is one scale, checkable in the source
rather than inferred: `story.score.importance` and `story.score.novelty` are
`asPercent(event.importance | event.novelty)` and `relevance` is `asPercent(user_events.relevance)`,
where `asPercent` is `clamp(round(score * 10), 0, 100)` ([story.ts:73](../../src/lib/story.ts)) — so
"Importance 50%" *is* importance **5.0 out of 10**, and the alert floor's 6 is that same number
(`IMPORTANT_FLOOR = 6`, [alert-floor.ts:21](../../src/lib/pipeline/alert-floor.ts);
`importanceBand` calls ≥ 6 "High", ≥ 3 "Medium", else "Notable", `story.ts:66`). A reader who saw a
story's importance and then the alert rule had to divide by ten to learn that the 6 that interrupts
them is the 5.0 they had just read.

**The options, as the spec recorded them.** (A) one scale, 0–10 with one decimal, on both surfaces —
three value spans and one sentence; (B) words instead of numbers, reusing `importanceBand` — removes
the three bars and leaves relevance with no band word; (C) keep 0–100 and add a legend teaching the
conversion. The spec recommended A as the only option where the two surfaces agree **by
construction**, and the ruling took it.

## What landed

Two files, no new component, no new token, no data change:

- `src/components/dashboard/story-article.tsx` — the rail's value span only,
  `<span className="tabular-nums">{value}%</span>` →
  `<span className="tabular-nums">{(value / 10).toFixed(1)} / 10</span>`, so the 0–100 bar value
  prints back as the stored 0–10 score (`60 → 6.0 / 10`, `50 → 5.0 / 10`). A comment above the card
  states the scale and the reason.
- `src/routes/dashboard/alerts/index.tsx` — the one template literal now reads **"Only events scoring
  6.0 or higher out of 10 interrupt you."**, with the number interpolated from `IMPORTANT_FLOOR`
  (`${IMPORTANT_FLOOR.toFixed(1)}`, imported from `@/lib/pipeline/alert-floor`) so a hard-coded
  threshold cannot drift from the alert stage again. The sentence that follows it — "Most days that
  is none — never more than N in a day" — is untouched: S9 changes the scale, and deleting a true
  statement about the reader's own allowance is a copy decision this ruling did not take.

**Must not move, and did not:** the bars' 1 px height, the `bg-muted` track and `bg-signal` fill,
`width: {value}%` (still driven by the 0–100 value, so bar lengths are unchanged), the card's
`rounded-2xl border border-hairline bg-surface p-5` chrome, the rows' `text-[12.5px]`, `CARD_LABEL`'s
11 px uppercase, and the alerts page's chip row. `asPercent`, `importanceBand` and every stored score
are untouched.

## Verification

`src/components/dashboard/score-scale.test.ts` renders the real `StoryArticle` (server render, real
score shape) and reads the alerts route's own sentence, because the defect was two surfaces
disagreeing and either surface alone would pass:

- the Scoring card prints exactly `6.0 / 10`, `5.0 / 10`, `7.0 / 10` for a story whose stored
  importance is 5.0 — the capture's `50%` — and its text contains no `%` at all;
- the top of the scale prints `10.0 / 10`, so the one decimal is not dropped at 100;
- bar widths still read `60% / 50% / 70%` from the same 0–100 values;
- the alerts sentence is interpolated from `IMPORTANT_FLOOR` and no literal `scoring 6 or higher`
  remains;
- the cross-check the spec asks for: for a story at the floor, the rail's Importance row reads
  `6.0 / 10`, and one decimal below it reads `5.9 / 10` — the sentence's number is the smallest one
  that can alert.

**Failing-first, measured:** with the two source changes reverted, 5 of the 8 assertions fail
(`60%` does not match `^\d{1,2}\.\d / 10$`; `50%` is not `5.0 / 10`; the route has no
`IMPORTANT_FLOOR` import; the floor story prints `60%`). The 3 that pass on the old code are the
"must not move" pins — bars, chrome, and the daily-allowance sentence — which is what they are for.

## Open, and deliberately not changed

`src/routes/support.tsx:48` carries the same rule in the product's FAQ, still as **"Only events
scoring 6 or higher interrupt you"**. It is the same ambiguity on a third surface, but S9's ruling
named two files and copy is a decision, not a tidy-up; changing it here would land wording the ruling
did not cover. It is recorded so the next slice can ask for one sentence change, with this decision's
number beside it.
