# The briefing gate takes the alert floor's first class (arbiter ruling #8, 2026-10-18)

**Where it was ruled.** The owner's ChatGPT `nyuz` project, chat "ARBITER REQUEST 2026-10-18 #8",
`/g/g-p-6a8ff11b12008191a6d9d24666e402a0-nyuz/c/6ad418fd-ecb8-83ee-a872-9336a0b7a074`, reached from this
session through the browser panel. The owner's standing instruction from #5 (*"discuss with chatgpt … dnt
ask me until both get conclusion"*) is why this went to the arbiter and not to the owner.

**Why it was asked.** Tonight's briefing, replayed read-only with `scripts/briefing-preview.ts` on the
live pool (reader `640a69b6`, 2026-10-18): 1000 matches → 325 eligible → 37 picked → **6 ship**, and one
of the six was

> `2026.42: Home At Last` — `what_happened: "What is Apple Doing?"`, importance 0, publisher_count 1

A reader opening that card is handed a newsletter's edition number and a heading from inside the issue,
presented as a development. It is the shape the **alert** floor already refuses: ruled 2026-10-14 (T2),
`personal-blog` — *"2026.41: It's Not You, It's Me"* was refused there for exactly this reason. Measured
over the whole stored corpus: **6 events of 22,002** carry the year.week shape, and one of them had
already been sent as an alert before that floor existed. The briefing gate had no rung for the class, so
2026.42 would have shipped that night.

The asymmetry is deliberate to date — the alert floor exists because an alert claims *this matters now*;
readiness holds the briefing's own contract, and Q4 (2026-10-17) reversed the silence rule so the
briefing ships everything that passes readiness. That is why this was a question and not a patch.

**The arbiter's ruling, verbatim in the parts that bind:**

> "**Option 1 — Apply the measured alert-floor classes to briefing readiness, one class at a time.**"

> "**Scope:** Start with `personal-blog` events whose titles identify a numbered personal-newsletter
> edition, such as `2026.42: Home At Last`. Refuse these at readiness, before composition. Evaluate
> price, shelf, commentary, and hobby-hack classes separately against briefing-pool evidence before
> extending the rule to them."

> "**Precision:** Keep ordinary titles containing years or numbers eligible, including *Best laptops 2026:
> …* and *Android 17 beta 2*. Do not reject an event merely because its title contains a number."

> "**Coverage:** Apply the rule to the edition-shaped title, not the publisher or newsletter as a whole.
> A personal newsletter covering a genuine event must remain eligible when the event itself satisfies
> readiness."

> "**Release evidence:** Demonstrate that the six measured newsletter editions are refused, with no
> unrelated events newly refused. Show that the example `2026.42: Home At Last` cannot reach composition
> or the shipped briefing. Report the before-and-after counts, refusal reason, and regression-test
> results. Confirm that `delivered with no body` remains 0 and `refused then published` remains 0."

> "**Deployment:** Keep the change deterministic and auditable. Do not introduce a general-purpose
> title-number filter or silently expand the rule to other classes."

## What landed, and how it was verified

`PERSONAL_EDITION_TITLE` in [readiness.ts](../../src/lib/pipeline/readiness.ts) — `/^\d{4}\.\d{1,2}:\s/`,
the same shape `alert-floor.ts` uses, anchored on the year.week prefix and nothing wider — refuses at
readiness with `kind: "personal-blog"` and the alert floor's own reason string, *"title is a numbered
personal-newsletter edition"*. ArtifactKind gained the kind, so the withholding note names it.

Measured after, 2026-10-18:

- `node --env-file=.env scripts/tsrun.mjs scripts/briefing-preview.ts` (live pool): **ships 6 → 5**,
  withheld by the readiness gate **27 → 28**, and the one entry added to the withheld list is
  `[personal-blog] 2026.42: Home At Last`. The other five ships are unchanged, and no unrelated event was
  newly refused.
- `npx vitest run src/lib/pipeline/readiness.test.ts` → **57 passing**, including the ruling's three
  precision controls (*Android 17 beta 2 …*, *Best laptops 2026: …*, and the same string without its
  colon) still eligible.
- `npx tsc --noEmit` clean.

## What this authorises, and what it does not

- **Authorised:** refusing an event whose title is a numbered personal-newsletter edition, at readiness,
  before composition, as `personal-blog`.
- **Not authorised:** the other alert-floor classes in the briefing gate (each needs its own
  briefing-pool measurement and its own ruling); a general title-number filter; refusing a newsletter's
  coverage of a real event; any change to Q4's ship-everything-that-passes-readiness rule.
