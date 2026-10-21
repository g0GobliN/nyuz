# Anchored dates are written in UTC (2026-10-21)

**Status: RULED 2026-10-21, owner override accepted** — the formatter writes UTC calendar days for
every anchored date in the reader-facing output, and the audit under every host `TZ` agrees with
the page. The local-time getters that previously picked the host's day are gone; `setDate` and
`setMonth` were the only local-zone math still in the path, and they were UTC-ed too. The shipped
briefing `3fcbb21c` (built 2026-10-20T22:55Z) was the failure: the audit reported **FAIL 23/25**
under `TZ=Asia/Tokyo` and `TZ=Pacific/Auckland`, **PASS 25/25** under `TZ=UTC`. After the fix the
same instrument reports **PASS 25/25** under seven zones (`UTC`, `Asia/Tokyo`, `Pacific/Auckland`,
`Europe/London`, `America/New_York`, `Asia/Kathmandu`, `Europe/Berlin`), byte-identical output, and
the real verdict for that deck is **PASS**.

## The ruler reads the same numbers

| zone             | before         | after      |
| ---------------- | -------------- | ---------- |
| UTC              | PASS 25/25     | PASS 25/25 |
| America/New_York | **FAIL 23/25** | PASS 25/25 |
| Asia/Tokyo       | **FAIL 23/25** | PASS 25/25 |
| Pacific/Auckland | **FAIL 23/25** | PASS 25/25 |
| Europe/London    | PASS 25/25     | PASS 25/25 |
| Asia/Kathmandu   | PASS 25/25     | PASS 25/25 |
| Europe/Berlin    | PASS 25/25     | PASS 25/25 |

PASS means every card delivered on briefing `3fcbb21c` carries the exact sentence the page opens
on. The "pre-ruling rule" counterfactual is unchanged at 14/25 (the rule predates ruling #11 and is
printed beside the new number so the before-and-after stays reproducible in one run).

The two defects in `America/New_York` were the title cards "AMD's FSR 4.1 now works on Radeon RX
6000 cards, Xbox Series X" and "PyTorch Foundation Welcomes Nine New Members As Momentum Build" —
both `21 October 2026` to the page (Cloudflare, UTC) and `20 October 2026` to a laptop with
`TZ=America/New_York` (EDT, UTC-4), because both events were published in the first hours of UTC 21
October, which is 20 October in the evening in New York.

## The rule

The anchored-date formatter is the only place a story's event date is rewritten into a calendar
day, and it lives in `src/lib/reader-evidence.ts`:

- `monthPhrase(shift, at, before)` — `in July 2026`, etc.
- `yearPhrase(shift, at, before)` — `in 2027`, etc.
- `dayPhrase(shift, at, before)` — `on 21 October 2026`, etc.

The three now read `getUTCDate`, `getUTCMonth`, `getUTCFullYear`, and `setUTCDate`,
`setUTCMonth`, `setUTCHours` on a clone that's zeroed to midnight UTC. The shift arithmetic runs
in UTC because `setMonth(getMonth() + 1)` rolls the year correctly only when the surrounding zone
is UTC — at a `2026-12-31T22:00:00-04:00` (`2027-01-01T02:00:00Z`) anchor, the local-time route
would land `January 2026` instead of `January 2027`, just for one date arithmetic one shift away.

The `Date` clones that the formatters work on are zeroed to start-of-day UTC
(`setUTCHours(0, 0, 0, 0)`) before any shift, which is the place the local-time version would
have flagged a different day depending on where `new Date(at.getTime())` put the clone's local
midnight relative to the moment the event was published.

The page reader, the audit, and the test runner all reach the same labels because they all reach
the formatter with `at = new Date(publishedAt)` and the formatter pins the calendar day to the
absolute moment `publishedAt` carries. Reader-facing rendering rules are unchanged — the page
already wrote UTC dates because Cloudflare runs in UTC; the audit didn't, and now does.

## Why this is not a "lower the bar" answer

The instrument disagreed with itself under two valid zones. That is the same shape of defect ruling
#11 exists to empty: the page and the audit ought to read the same line for the same event, and a
zone-disagreement is what makes them not. The fix does not change what a reader sees (the page
already wrote UTC), the published briefing does not need to be rebuilt (`3fcbb21c` already prints
25/25 in the deployment, only the audit miscounted), and the page instruments (`composer-audit`,
`delivered-line`, `delivered-summary`) all read from the same formatter — they all agree now.

The change is the formatter plus the in-house rule that **anchor dates are written in UTC** — a
fixed, documented zone, carried by the `getUTC*` / `setUTC*` accessors the three formatters and
their `atUTC` clone use, with the rationale documented on `atUTC` and a pointer here. The zone is
not held in a string constant: `Date` takes no zone argument on those accessors, so a named
`"UTC"` would describe the rule without governing it (an earlier revision carried an unused
`ANCHOR_TZ` constant; it was removed on 2026-10-21 as dead weight).

## The test that locks it

`src/lib/reader-prose-rules.test.ts` keeps the "anchored relative dates do not depend on the
host's TZ" describe block. It runs `scripts/anchor-probe.ts` (added 2026-10-21) through six zones
in a child process and asserts:

1. each zone prints exactly the expected calendar labels for a fixed `at = 2026-10-21T01:00:00Z`
   anchor (UTC midnight plus 01:00, the moment the bug showed up under `TZ=America/New_York`);
2. every zone's labels equal `UTC`'s labels (the cross-zone determinism claim);
3. every zone writes `on 21 October 2026` for `today` at the same anchor (the direct check).

The describe block exits the test red if any one of the three classes of getters finds its way
back in. The bug it locks against was reproduced by stashing the formatter fix — the test fails
on `receives: "on 20 October 2026"` exactly where the shipped briefing was failing on
`TZ=America/New_York`.

The runner is a child process because in-process Date behaviour is fixed by the host's `TZ` at
startup and cannot be reset. `scripts/anchor-probe.ts` reads `process.env["TZ"]`, prints the
labels for seven fixed inputs (yesterday, today, tomorrow, this month, last month, next year,
last year), and is the only place in the tree that touches `TZ`. `TZ` is added to the
`env-contract.test.ts` allowlist with a one-line reason (POSIX ambient zone, set by the test
runner only), so the contract test that grep-finds `process.env["TZ"]` finds the right
documentation.

## How a future change breaks the test

The formatter's three getters all run in UTC. A change that reaches for the `getDate()` style
getter, or for a host-aware `Date.parse` of the publishedAt string, will produce a different day
label from `expect(result["today"]).toBe("on 21 October 2026 the plant reopens.")` and the
describe block's per-zone loop will return the new label while the other five zones still print
the UTC-pinned one — the test exits red with an obvious diff. A change that goes the other way
("make the formatter follow the host's TZ") would need to also rewrite the page, because the page
already reads as UTC and the test asserts the two ends agree; that is the larger design choice
recorded in [reader-delivery.md](reader-delivery.md) rather than a quiet edit to one file.

## Provenance

- Branch `wt/audit-tz`, derived from `origin/main` at `3ee81ae`.
- Files touched: `src/lib/reader-evidence.ts`, `src/lib/reader-prose-rules.test.ts`,
  `src/lib/env-contract.test.ts`, `scripts/anchor-probe.ts`, this file.
- Measured locally (Node 22, Linux): the table above, taken with the same audit command
  (`npm run audit:delivered-line`) under seven zones. Same instrument, same deck, identical
  output. Suite: `npm run typecheck`, `npm run lint`, `npm run test:coverage` (3,465 tests), and
  `GITHUB_ACTIONS=true npm run coverage:ratchet` (no regression against the committed floor —
  coverage in `src/lib` rose 1.17pp).
- PR-style commit history (one commit per change): the formatter fix, the test, the env-contract
  allowlist, the new probe script, this decision record.
