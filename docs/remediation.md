# Repository audit remediation

Tracks the findings from the 2026-09-26 full-system audit. Items are handled in
dependency order; no external database, provider, or deployment state is changed
from this checklist.

## Findings

| ID   | Finding                                                                                                                                                  | Status                                                      | Resolution / remaining work                                                                                                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | Reader and digest-scheduler queries can truncate at the PostgREST row cap.                                                                               | Implemented; full CI passed                                 | Matcher preference/topic/exclusion/source/plan reads and topic/source indexes page in 500-row ranges; digest scheduling pages preferences and chunks user IDs.                                                                                                                      |
| F-02 | Match candidate limit can starve eligible events in a busy rolling window.                                                                               | Partially mitigated                                         | Candidate page raised from 400 to 1,000. A durable cursor is still required to guarantee service for backlogs above the PostgREST page cap.                                                                                                                                         |
| F-03 | Synchronized digest cohorts can exceed generation and delivery capacity.                                                                                 | Partially mitigated                                         | Generation batch raised from 4 to 8; queued delivery reads are bounded to 24 channel rows per run. Arithmetic capacity is 1,040 digest rows over the 10-minute preparation plus 120-minute grace window; Worker runtime/provider capacity still needs a deployment-size load check. |
| F-04 | Unsubscribe GET mutates notification preferences.                                                                                                        | Implemented; explicit route regression test missing         | GET validates the token and renders a POST confirmation form; signed one-click POST still performs the change. Add a route-level test proving GET does not mutate preferences and POST does.                                                                                        |
| F-05 | Promotion evidence is unordered and does not use the reader match signal.                                                                                | Implemented; full CI passed                                 | Stable event ordering and a shared `customTopicSignal` now include tags, other topic labels, and source names.                                                                                                                                                                      |
| F-06 | Subject significance history may include stale custom-topic links.                                                                                       | Implemented; full CI and migration-chain tests passed       | The history RPC now returns the current event signal and match filters custom-topic history through the current spec. The live read-only schema preflight finds `subject_history` and `coverage_changed_at`; the Supabase migration-history ledger was not inspected.               |
| F-07 | Duplicate migration versions and missing CLI config.                                                                                                     | Repository docs updated; remote migration ledger unverified | Deployment instructions now initialize missing CLI config and inspect linked history. Existing duplicate prefixes remain; do not renumber until remote history is inspected. Migrations `0102` and `0103` are included in this work.                                                |
| F-08 | Admin audit insert failures do not stop mutations.                                                                                                       | Accepted by design; verify policy wording                   | `audit()` is explicitly best-effort and logs failures. Making it atomic with varied admin actions requires a separate transactional design; no behavior change was made.                                                                                                            |
| F-09 | Windows CI path assertions and PWA self-test shutdown fail.                                                                                              | Implemented; full CI passed                                 | Normalize test paths to `/`; PWA checker now sets `process.exitCode` and lets the event loop close naturally.                                                                                                                                                                       |
| F-10 | Product/status documentation disagrees with current plans and active features.                                                                           | Implemented; reviewed                                       | README prices/channels and status claims for Story Ask, translation, WhatsApp, delivery and cron cadence were updated. Historical live snapshots are labeled as unverified.                                                                                                         |
| F-11 | A high `js-yaml` advisory fails the production audit, but the workflow captures the status of the `if` compound and can exit successfully after retries. | Fixed; production audit passed                              | Lockfile now resolves `js-yaml@4.3.2`; the workflow preserves npm's exit status and retries only recognized transient network/5xx errors. `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities.                                                                   |

## Work log

- 2026-09-26: Created from the repository-wide audit. Worktree was already dirty;
  existing changes were preserved. No tests or live-service checks have been run
  during remediation yet.
- 2026-09-26: Implemented F-01 paging for matcher inputs/indexes and digest
  scheduling; F-04 safe GET confirmation; F-09 Windows path normalization and
  graceful PWA process exit. No test suite has been run during remediation.
- 2026-09-26: Added the shared custom-topic signal to promotion evidence and
  subject-history filtering; raised match candidates to 1,000; raised digest
  generation batches to 8 and bounded queued delivery reads; reconciled README,
  status, track, scheduler comments and deployment setup. Typecheck and lint pass;
  tests, migration execution and linked database history remain unverified.
- 2026-09-26: `npm run ci` passed (typecheck, lint, 2,487 tests, production build,
  23 PWA checks). `npx vitest run src/lib/schema-migrations.test.ts` passed all
  17 tests. The documented read-only `npm run db:status` succeeded, and a
  read-only schema preflight found `coverage_changed_at`, `subject_history` and
  `delivered_revision` in the live database. No live migration was applied; the
  Supabase migration-history ledger remains unverified because this checkout has
  no `supabase/config.toml`. The unsubscribe route still lacks a direct GET/POST
  regression test.
- 2026-09-26: Release preflight found a high `js-yaml` advisory and a fail-open
  audit retry in CI. Updated the compatible lockfile resolution to `4.3.2` and
  corrected the workflow to retain npm's error status; the production dependency
  audit now reports zero vulnerabilities. Full CI will be rerun after this change.
