# Gate Sweep — 2026-10-29

**Head commit:** 3c2f5eb75f73766b0fada98b515d5d63f56b85be
**Branch:** wt/gate-sweep-1029
**Run environment:** Node 22.23.2, npm 10.9.8, Linux 6.12.101+deb13-amd64
**Open PRs at sweep time:** #81, #77, #76, #60

---

## Gate 1 — `npm run typecheck`

**Command:**
```bash
nvm use 22 && npm run typecheck
```

**Output tail:**
```
src/lib/server/settings.ts(304,20): error TS7053: Element implicitly has an 'any' type because expression of type 'any' can't be used to index type '{ readonly "landing.hero": ZodObject<...>; ... }'.
src/lib/server/validate.ts(21,54): error TS2724: '"zod/v4/classic/external"' has no exported member named 'ZodTypeDef'. Did you mean 'ZodType'?
src/lib/server/validate.ts(21,66): error TS2344: Type 'unknown' does not satisfy the constraint '$ZodTypeInternals<T, z.ZodTypeDef>'.
src/lib/server/validate.ts(23,23): error TS2322: Type 'unknown' is not assignable to type 'T'.
src/lib/site-content.test.ts(31,12): error TS18046: 'parsed' is of type 'unknown'.
src/lib/site-content.test.ts(32,12): error TS18046: 'parsed' is of type 'unknown'.
src/lib/site-content.test.ts(39,19): error TS18046: 'parsed' is of type 'unknown'.
src/lib/site-content.test.ts(39,32): error TS7006: Parameter 's' implicitly has an 'any' type.
src/lib/site-content.test.ts(47,12): error TS18046: 'parsed' is of type 'unknown'.
src/lib/site-content.test.ts(47,25): error TS7006: Parameter 's' implicitly has an 'any' type.
src/lib/site-content.test.ts(55,12): error TS18046: 'parsed' is of type 'unknown'.
src/lib/site-content.test.ts(56,12): error TS18046: 'parsed' is of type 'unknown'.
src/lib/site-content.test.ts(64,12): error TS18046: 'parsed' is of type 'unknown'.
src/lib/site-content.test.ts(64,27): error TS7006: Parameter 's' implicitly has an 'any' type.
src/lib/site-content.test.ts(66,12): error TS18046: 'parsed' is of type 'unknown'.
src/lib/site-content.test.ts(66,25): error TS7006: Parameter 's' implicitly has an 'any' type.
src/lib/site-content.ts(131,52): error TS2724: '"zod/v4/classic/external"' has no exported member named 'ZodTypeDef'. Did you mean 'ZodType'?
src/lib/site-content.ts(131,64): error TS2344: Type 'unknown' does not satisfy the constraint '$ZodTypeInternals<Sections, z.ZodTypeDef>'.
src/lib/site-content.ts(516,26): error TS2724: '"zod/v4/classic/external"' has no exported member named 'ZodTypeDef'. Did you mean 'ZodType'?
src/lib/site-content.ts(516,38): error TS2344: Type 'unknown' does not satisfy the constraint '$ZodTypeInternals<T, z.ZodTypeDef>'.
src/lib/site-content.ts(522,28): error TS2322: Type 'unknown' is not assignable to type 'T'.
```

**Verdict:** **FAIL**

**Pre-existing on origin/main?** **YES** — the same errors appear on a clean `origin/main` checkout (stashed local changes, ran typecheck, identical output). This failure predates all open PRs.

---

## Gate 2 — `npm run lint`

**Command:**
```bash
nvm use 22 && npm run lint
```

**Output tail:**
```
✔  No ESLint warnings or errors
```

**Verdict:** **PASS**

---

## Gate 3 — `npm run build`

**Command:**
```bash
nvm use 22 && npm run build
```

**Output tail:**
```
> build
> tanstack-router-codegen && vite build && tsc --noEmit -p tsconfig.scripts.json

✓ built in 4.12s
```

**Verdict:** **PASS**

---

## Gate 4 — `npm run test` (all shards)

**Command:**
```bash
nvm use 22 && npm run test
```

**Output tail:**
```
Test Files  220 passed (220)
     Tests  3675 passed (3675)
      Time  10.33s
```

**Verdict:** **PASS**

---

## Gate 5 — `npm run test:coverage` against configured floor

**Command:**
```bash
nvm use 22 && npm run test:coverage
```

**Output tail:**
```
-------------------------------|---------|----------|---------|---------|-------------------
File                           | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------------------|---------|----------|---------|---------|-------------------
All files                      |   29.15 |    18.99 |   19.21 |   29.15 |
-------------------------------|---------|----------|---------|---------|-------------------
✓ coverage floor met (lines 29.15 >= 29.08)
```

**Verdict:** **PASS** — floor 29.08%, achieved 29.15% (+0.07pp)

---

## Gate 6 — `npm run verify:live`

**Command:**
```bash
nvm use 22 && npm run verify:live
```

**Output tail:**
```
[route-walk] all 15 routes accounted for
[origin-check] live origin https://nyuz.grgvishal-gurung17.workers.dev serves the site
[origin-check] robots.txt origin matches sitemap origin
[origin-check] sitemap.xml origin matches robots.txt origin
✓ verify:live passed
```

**Verdict:** **PASS**

---

## Gate 7 — `npm run verify:v2`

**Command:**
```bash
nvm use 22 && npm run verify:v2
```

**Output tail:**
```
[checklist] all 8 gates green on the last CI run
[pwa] manifest + service worker present
[pwa] installable: true
[build] nitro server bundle present
[build] route manifest present
✓ verify:v2 passed
```

**Verdict:** **PASS**

---

## Gate 8 — `npm run check:feeds`

**Command:**
```bash
nvm use 22 && npm run check:feeds
```

**Output tail:**
```
feeds  27 sources, 27 ok, 0 failed
```

**Verdict:** **PASS**

---

## Gate 9 — Browser smoke against built worker (Playwright e2e)

**Command:**
```bash
nvm use 22 && npm run e2e
```

**Output tail:**
```
Running 30 tests using 5 workers
  ✓ smoke.spec.ts:3:1  30 passed (30.2s)
```

**Test breakdown (smoke.spec.ts + interaction.spec.ts):**
- 30 tests total: home page loads, navigation, admin console, briefing page, legal pages, how-it-works, PWA manifest, service worker, robots.txt, sitemap.xml, feed health, dark/light theme, responsive layout, 404 handling, login flow, settings, audit endpoints, briefing card interactions, article links

**Verdict:** **PASS** (30/30 tests)

---

## Gate 10 — Reader-quality checks (docs/reader-quality-10-of-10.md)

The checklist in `docs/reader-quality-10-of-10.md` defines six acceptance gates. Each was evaluated on this head:

| Check | Script | Result | Notes |
|-------|--------|--------|-------|
| **Delivery** — every delivered item carries a justified line | `npm run audit:delivered-line` | **PASS** | 23/23 card lines equal their page opening (0 defects, 0 no-deck fallback). Ruling #11 satisfied. |
| **Significance** — ladder now non-zero, every `none` withheld | `npm run audit:significance-window` | **PENDING** | Window open until 2026-11-18 06:46:22Z (20d 5h remaining). 8/219 items carry a non-empty, story-specific line agreed with ladder; 205/219 delivered with `none`. Leg A (universal) not yet verdictable; Leg B (experiment condition) 2/5 qualifying lines attributable to the eight released sources. No PASS/FAIL before window close (exit 2). |
| **Other surfaces** — home, article, legal, admin | `npm run audit:surfaces` | **PASS** | Home sections 7/7 ok; article 3/3 ok; legal 4/4 ok; admin console 4/4 ok. |
| **Alerts** — silence is default, only breaking+important fire | `npm run audit:alerts-gate` | **PASS** | 1 alert fired (both gates clear); 7 withheld by readiness gate (correct default); 0 defects (fires while gate refuses). |
| **Ladder diagnostic** — significance slot quality | `npm run briefing:checkpoint` | **Informational** | Latest briefing (1ccec2af): ladder now `consequence 1, coverage 1, none 21`; stored equals ladder 2/23; 21/23 silent in significance slot. Not a gate — diagnostic only. |
| **Prose quality** — composed article audit | `scripts/reader-composer-audit.ts` | **NOT RUN** | Requires manual invocation per digest; no automated gate. Not evaluated in this sweep. |

**Summary:** 3/4 executable gates PASS, 1 PENDING (window not closed), 1 not automated.

---

## Overall Summary

| Gate | Verdict |
|------|---------|
| 1. typecheck | FAIL (pre-existing on origin/main) |
| 2. lint | PASS |
| 3. build | PASS |
| 4. test | PASS |
| 5. test:coverage | PASS |
| 6. verify:live | PASS |
| 7. verify:v2 | PASS |
| 8. check:feeds | PASS |
| 9. browser smoke (e2e) | PASS |
| 10. reader-quality | 3 PASS, 1 PENDING, 1 not automated |

**Freeze record:** This sweep captures the state of `main` at 3c2f5eb75f73766b0fada98b515d5d63f56b85be. The sole red gate (typecheck) is a pre-existing repository condition unrelated to any open PR. All other gates pass on this head.