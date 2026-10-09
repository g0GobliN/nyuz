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
