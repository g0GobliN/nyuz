# Zod advisory gate — migrate to zod ^4.6.7 (2026-10-27, ruled)

**Status: RULED 2026-10-27 — migrate now; no audit-gate exception.** The arbiter (ChatGPT `nyuz`
project, thread "Migrate Zod Now"):
chatgpt.com/g/g-p-6a8ff11b12008191a6d9d24666e402a0-nyuz/c/6ae03d59-9220-83ec-a547-343026cd1ec6

## The failure

The CI job **"Dependencies and secret names"** runs `npm audit --omit=dev --audit-level=high`.
Advisory [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) — zod `< 4.6.6`,
high severity: "Zod can exhaust memory while validating oversized constrained collections" — made
that job fail on `main` and on every fresh branch run from 2026-10-23T18:26Z onward. It failed on a
clean `main` checkout:
`npm audit --omit=dev --audit-level=high` → exit 1, one high-severity vulnerability.

The failure is **not introduced by any branch**: the advisory's metadata was amended at
`2026-10-23T18:26:52Z`, which postdates every green run of the job (PR #60's run at 06:39Z, PR #64's
at 07:54Z, `main`'s at 11:52Z) while the lockfile stayed identical. `package.json` pinned
`"zod": "^3.24.2"`, resolving to 3.25.76 inside the vulnerable range. The `npm audit fix` suggested
by the advisory installs zod 4.6.7 — a major bump — which is why the fix is a decision and not a
lockfile tick.

## The decision put to the arbiter

One sentence: should we migrate the repo to zod ≥ 4.6.6 to clear the CI advisory gate, or keep zod 3
behind a documented, time-boxed exception on the audit gate?

Evidence carried in the question: the measured failure above; that the job's own script separates
an advisory verdict from a registry error (both npm sets are printed as `::error::`, so weakening the
gate cannot be misread as tolerating endpoint blips); 29 files import zod; a proposal worktree where
the migration to ^4.6.7 was already measured — typecheck clean, lint 0 errors, the full suite green
after the two fixes below, `npm audit --omit=dev --audit-level=high` reporting "found 0
vulnerabilities".

Options given: **(1) migrate now**; **(2) keep zod@3 and exempt GHSA-mrhx-c7xc-m3w5 from the gate
until a scheduled migration** — the reverse of what the gate exists to enforce, and exempting exactly
this advisory (high, memory exhaustion on the production validate path) while cheap, is the option
where the gate's "real advisory verdict" contract is bent on purpose.

## The ruling

> Ruling: Option 1 — migrate to zod >= 4.6.6 now.
>
> Approve the minimal migration to zod ^4.6.7, subject to these constraints:
>
> - Keep .email() and .datetime() unchanged. Avoid unrelated deprecation cleanup; keep this PR
>   focused on resolving the advisory.
> - Preserve Zod 3 behavior. Retain z.partialRecord for the legacy boolean-map sections form and
>   verify the existing regression test.
> - Require a full test-suite pass. Run all 3,641 tests, typecheck, lint, and
>   npm audit --omit=dev --audit-level=high. All must pass before merging.
> - Verify the production dependency resolution. Confirm the lockfile resolves Zod to a patched
>   version, with no remaining vulnerable production dependency.
> - Keep the diff minimal and documented. Explain both validator type changes and the
>   z.partialRecord change in the PR. Confirm that reader-facing schema behavior remains unchanged.
>
> Merge condition: Do not merge until the full suite passes and the final diff and lockfile have
> been reviewed.
>
> No audit-gate exception is authorized. The advisory affects the production parsing path, and the
> proposed migration is small, reversible, and already clears the audit gate.

## What exactly changed and why (the migration ledger)

Every non-package change in the PR is one of these; anything else that looks different is noise:

1. **`src/lib/server/validate.ts` — `ZodType<T, z.ZodTypeDef, unknown>` → `ZodType<T, unknown>`.**
   Type-level only. Zod 4's `ZodType` takes `<Output, Input>`; the `ZodTypeDef` slot is gone, so the
   `unknown` that used to be the third argument becomes the second. No behaviour change: `parseInput`
   still runs `schema.safeParse` exactly as before.
2. **`src/lib/site-content.ts` — the same signature change on `sectionsSchema` and `parseSetting`.**
   Same reason as 1, no behaviour change.
3. **`src/lib/site-content.ts` — `legacySectionsSchema`: `z.record(sectionKeySchema, z.boolean())`
   → `z.partialRecord(sectionKeySchema, z.boolean())`, a deliberate behaviour restoration, not a
   new behaviour.** Zod 4 makes an enum-keyed `z.record` exhaustive — every enum member must be
   present — which rejected the legacy boolean-map form stored before the ordered-list schema
   landed: with zod 3, a subset map like `{ noise: false, comparison: true }` parsed; with zod 4's
   `z.record`, the union's record leg threw `invalid_type` (`expected boolean, received undefined`)
   for each missing key, so the test `sectionsSchema > still accepts the legacy boolean-map form`
   failed. `z.partialRecord` keeps the exact zod 3 semantics: any subset of the valid section keys
   can be present, and unknown keys are still rejected as before. The fixed test now passes and
   pins the restored semantics.

Nothing else moves. `.email()` / `.datetime()` chains stay as-is per the ruling (deprecated in zod
4 but fully functional, functional aliases of `z.iso.datetime()` and `z.email()`), and they are the
first-minutes to re-sweep later, never in this PR. `@hookform/resolvers 5.9.1` already peer-supports
`zod ^3.25.0 || ^4.0.0`, so the resolver pair does not change.

## The gates, measured 2026-10-27 on the proposal worktree (zod 4.6.7 installed)

- `npx tsc --noEmit` — clean (exit 0).
- `npm run lint` — 0 errors, 20 pre-existing react-refresh warnings.
- `npm test -- --run` — 219 files, **3,641 / 3,641 passed**.
- `npm_config_fetch_timeout=60000 npm_config_fetch_retries=0 npm audit --omit=dev --audit-level=high`
  — exit 0, `found 0 vulnerabilities`.
- `npm ls zod --omit=dev` — every production path resolves to the single root `zod@4.6.7`
  (deduped through `@hookform/resolvers`, `openai`, `@tanstack/*`); no inner copy left behind.

## What this closes, and what it does not

- Leaving `main` and lines where the CI job went red before the advisory's own amendment (PR #60 at
  06:39Z, PR #64 at 07:54Z, `main` at 11:52Z were green under an identical lockfile) — the red is
  metadata on the advisory, not a code change, and the record is this file.
- Reader-visible behaviour: none — the site-content schema's one deliberate change restores the
  pre-zod-4 semantics at the one enum-keyed legacy map, pinned by the regression test.
- `npm audit fix --force` remains correct under zod 4: it shows `zod@4.6.7` as the fix target, and
  now means "bump the root" rather than "break the major version" next time.