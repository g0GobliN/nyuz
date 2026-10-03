# Agent notes

nyuz is a TanStack Start app (React 19, TypeScript, Tailwind v4).

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
- Before any push, run `npm run ci` — typecheck, lint, the suite with coverage, the coverage floor, the production build, the PWA install contract, the route walk's self-test, then Playwright against the built Worker. It is the same list the runner executes, so a green local run is a checked push. Do not treat an earlier partial check as sufficient after the final changes.
- `npm run e2e` needs the Chromium that `npx playwright install chromium` fetches once, and Node 22 (`.nvmrc`); `wrangler dev` refuses to start on Node 20.
- The coverage floor in `.ci/baseline/coverage.json` only rises: `npm run coverage:ratchet -- --update` records a new measurement and refuses to lower anything. It records `measuredAtCommit`, so read that before blaming the change under review for a drop — it may be another contributor's commit that landed after the floor was taken.
- The palette is three colours and `src/lib/style-tokens.test.ts` enforces it: every token in `src/styles.css` is chroma 0 except `--signal` and `--ring` at hue 240, and the two blues in `public/logo.svg` must stay the sRGB form of `--signal` in each theme. Adding a fourth colour is a test failure, not a design decision.
- `src/lib/toolchain-consistency.test.ts` fails if `.nvmrc`, `engines.node` and any workflow's `node-version` disagree, or if the deploy job's `wranglerVersion` drifts from the pinned devDependency. Bump both together.
- Before pushing, inspect the staged diff, `git status`, and the final commit message; verify the message contains no `Co-Authored-By:` line and that only intended files are included.
