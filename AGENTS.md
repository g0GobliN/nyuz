# Agent notes

nyuz is a TanStack Start app (React 19, TypeScript, Tailwind v4).

## Context comes first, and is kept current

- **`docs/context.md` is the shared memory of this project.** It says what nyuz is, what it
  does today, what has landed, what is next, and which invariants must not be broken. Read
  it before touching anything. It exists so a session that starts cold does not have to
  infer the product from the code — and so that it cannot quietly invent a version of the
  product that never existed.
- **Update it in the same commit as the change it describes.** Append to its work log and
  keep its state, next and measured-number sections true. A change that is not recorded in
  that file reads as a change that never happened, so an unrecorded slice is an unfinished
  slice. Record measured numbers with their provenance: the date, the command, and the
  corpus they came from.
- **Both files are tracked and are pushed with the work.** `docs/context.md` and this file
  must never be added to `.gitignore`, excluded from a commit, or left out of a push. A
  private context file is exactly how the next session starts hallucinating.
- Every push carries the rules in this file with it: before pushing anything, re-read the
  delivery rules below and check the staged diff against them.

## Decisions come before code

- This is a product, not a scratch script. Anything a reader or operator would experience
  differently — what ships or is withheld, copy, prices, limits, schema, policy, error
  states — is a decision, and decisions are ruled on before they are built.
- The arbiter's rulings live in the owner's ChatGPT `nyuz` project. Put the case to it with
  evidence and numbered options, wait for the ruling, record it, and only then implement the
  smallest slice that matches it. A proposal may exist as a diff outside the shipping path;
  nothing that changes behaviour lands on a recommendation alone.
- **The arbiter is asked first, and it is cross-examined.** A question goes to the ChatGPT
  `nyuz` project before it goes to the owner, and before you decide it does not need asking.
  Question it as much as the evidence warrants: re-ask with better evidence, name the part you
  believe is wrong, and check the ruling against the code, the data and the frozen corpus.
  Escalate to the owner only when the arbiter is unreachable, or when evidence you can show
  contradicts it and it will not revise — and say which of the two it is. Never invent either
  answer: a ruling nobody gave is not a ruling, and an unanswered question is not permission.
- Open and recorded decisions live in `docs/decisions/`. Read the log before re-opening a
  settled question, and record the ruling with its date and reason when it arrives.
- The same rule is packaged as the global `arbitrate-first` skill, so it applies in every
  project rather than only here.

## Skills are mandatory, and a missing one is written

- **Use the skill that owns the task** instead of improvising a process. Read its `SKILL.md`
  first. The ones that matter most here: `arbitrate-first` for a decision,
  `keep-context-current` for this repository's context file, `investigate-first` and `debug-bug`
  for an unknown cause, `surgical-patch` for a narrow fix, `safe-refactor` for structure,
  `migration` for a schema or data transition, `verify-and-stop` for proving finished work,
  `run-long-goal` for a goal that outlives a session, `review-diff` for a diff, `handoff-session`
  when context is running out. The full set is installed account-wide, not per project.
- **When a process repeats and no skill covers it, write the skill** — this is a rule from the
  owner, not a preference. It takes two places, both required: the body in
  `docs/skills/<name>.md` in this repository (the install fields plus the text, so it is reviewed
  and versioned with the code) and the installed copy in the account's global skill set, so the
  next session in any project gets it. Then use it. A process that lives only in one session's
  head is not a skill.

- `npm run dev` serves on port 8080. `npm run build` produces a nitro server bundle.
- Routes are file-based under `src/routes/`; `src/routeTree.gen.ts` is generated — never edit it by hand.
- `npx tsc --noEmit` must stay clean. `noUncheckedIndexedAccess` is on, so index
  access yields `T | undefined` — narrow before use.
- Colour is limited to three values: black, white, and one blue (`--signal`, hue 240).
  Every other token in `src/styles.css` is chroma 0. Do not introduce a fourth colour.
  `--destructive` is monochrome on purpose — a coloured error state would compete
  with the accent for attention, so destructive states lean
  on iconography and weight. The two hex values in `public/logo.svg` are the sRGB
  form of `--signal` light/dark and must be changed alongside it.

## Admin console

- Lives at `/admin`, separate from the customer dashboard. Migration
  `0003_admin.sql` adds roles, bans, the blog, site settings, AI routing,
  feature flags and the audit log.
- **The security boundary is `adminOnly` / `superadminOnly` in
  `src/lib/server/guard.ts`, nowhere else.** They verify the caller's Supabase
  token server-side and re-read the role from `user_roles` on every call. The
  role check in the UI (`src/lib/viewer.ts`) only decides what gets drawn —
  never treat it as protection, and never add a console query that skips the
  middleware.
- `user_roles` has no write policy at all. A role can only change through an
  audited server function holding the service-role key. Do not add a role
  column to `profiles`: 0002 lets a user update their own profile row, which
  would make it self-grantable.
- Console data is fetched **on the client**, never in a route loader. The
  caller's identity is a token in browser storage, so a loader running during
  SSR has nobody to be. The public site is the opposite — it uses loaders,
  because `getPublicSiteContent` needs no session and never throws.
- Every mutating console action writes an `admin_audit_log` row via `audit()`.
- First superadmin: `supabase/bootstrap_superadmin.sql`, run by hand once.

## Editable site content

- `src/lib/site-content.ts` holds one zod schema **and** a matching default per
  editable key. The public site, the console form and the server-side write
  validation all use the same schema, so a value that saves is a value that
  renders. Every default reproduces the copy bundled in the components, which
  is why an empty `site_settings` table renders exactly what ships.
- Reads never throw. A malformed row costs one wrong headline and falls back to
  the bundled copy — it does not 500 the front door.
- Landing sections are an **ordered list** (`[{key, enabled}]`), because the
  console can reorder them. The reader also accepts the older boolean-map form.
  Adding a section means three edits: `SECTION_KEYS`, `SECTION_LABELS`, and
  `SECTION_COMPONENTS` in `src/routes/index.tsx`. Missing one is a type error.
- Legal text is deliberately NOT editable from the console — it is a legal
  commitment that should require a deploy and therefore a code review. It lives
  in `src/routes/legal/$doc.tsx`. `ENTITY` is the unregistered operator in Japan
  (city + postcode, no building). Incorporate later and this block has to change.
- `/how-it-works` must not re-render the landing page's sections. The home page
  argues; that page explains. Its content is `pipeline-explainer.tsx`.

## DeepSeek

- Models are `deepseek-v4-flash` (high volume) and `deepseek-v4-pro` (user-facing
  quality), read from `MODEL_*` env vars. `deepseek-chat` / `deepseek-reasoner`
  do NOT exist on this account — verify with `GET /models` before assuming.
- **Both are reasoning models.** Completion tokens are spent on
  `reasoning_content` before any visible `content` is produced — a "reply ok"
  test burned 27 of 29 tokens on reasoning. Budget `max_tokens` for reasoning
  plus output, or responses come back with empty `content` and
  `finish_reason: "length"` and no error. Always check `finish_reason`.
- OpenAI-compatible API, so use the `openai` SDK pointed at `DEEPSEEK_BASE_URL`.

## Git delivery

- Never add a `Co-Authored-By` trailer to a commit.
- **Land verified work; do not ask whether to push it.** A finished, verified change is pushed, not
  left sitting in the worktree. Do not stop to ask "should I push?" when the checks are green and the
  change is the one being worked on — the answer is yes, and the deploy job is what makes the change
  real. This is an authorisation to push the work in flight, not to push anything else: someone
  else's files, a half-finished slice, or a red tree still stop and wait.
- **A red push is not a deployed change.** The deploy job is skipped when any check fails, so
  pushing red leaves `main` ahead of production — the worst of both states. Green before the push,
  or the push does not happen.
- Before any push, run `npm run ci` — typecheck, lint, the suite with coverage, the coverage floor, the production build, the PWA install contract, the route walk's self-test, then Playwright against the built Worker. It is the same list the runner executes, so a green local run is a checked push. Do not treat an earlier partial check as sufficient after the final changes.
- Push one substantial change at a time, in commits that each stand on their own — not one lump per
  session. Conversely, do not dribble out commits for a change still being verified: the unit is the
  finished slice, checked once on the final tree.
- `npm run e2e` needs the Chromium that `npx playwright install chromium` fetches once, and Node 22 (`.nvmrc`); `wrangler dev` refuses to start on Node 20.
- The coverage floor in `.ci/baseline/coverage.json` only rises, and it is recorded from the runner rather than from a laptop (Audit 42): v8 reports the ranges it discovered while executing, so two machines measure one commit differently — same tree, seven files apart, and a branch denominator that differed for the same file. `npm run coverage:ratchet -- --update` therefore refuses a local measurement; record the runner's summary with `gh run download <run-id> -n coverage-summary -D /tmp/ci-coverage` and `npm run coverage:ratchet -- --update --from /tmp/ci-coverage/coverage-summary.json`. Off CI a shortfall inside the 0.35pp portability band is reported as a warning instead of a failure (local runs drifted 0.22pp against themselves); CI compares exactly. It records `measuredAtCommit`, so read that before blaming the change under review for a drop — it may be another contributor's commit that landed after the floor was taken.
- The palette is three colours and `src/lib/style-tokens.test.ts` enforces it: every token in `src/styles.css` is chroma 0 except `--signal` and `--ring` at hue 240, and the two blues in `public/logo.svg` must stay the sRGB form of `--signal` in each theme. Adding a fourth colour is a test failure, not a design decision.
- `src/lib/toolchain-consistency.test.ts` fails if `.nvmrc`, `engines.node` and any workflow's `node-version` disagree, or if the deploy job's `wranglerVersion` drifts from the pinned devDependency. Bump both together.
- Before pushing, inspect the staged diff, `git status`, and the final commit message; verify the message contains no `Co-Authored-By:` line and that only intended files are included.
