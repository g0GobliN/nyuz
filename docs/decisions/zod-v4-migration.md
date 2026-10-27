# zod 3 → 4: the audit gate and the three behaviours that moved

**Status: landed 2026-10-27 on `wt/zod-v4`.** `zod` went from `^3.24.2` to `^4.6.7` (installed
4.6.7, node v22.23.2, npm 10.9.8). The audit step that had gone red on every branch —
`npm audit --omit=dev --audit-level=high` — returns `found 0 vulnerabilities`. Three behaviours
changed between the majors and are handled below; one thing that looked like a change turned out to
be a pre-existing hole and was left alone.

## Why the gate failed

`GHSA-mrhx-c7xc-m3w5` (memory exhaustion while validating oversized constrained collections) marks
every `zod < 4.6.6` high. `package.json` declared `^3.24.2`, so no 3.x release clears it: this was a
major migration, not a lockfile refresh. `npm audit fix --force` names `zod@4.6.7` as the install.

| measure                                   | before             | after                |
| ----------------------------------------- | ------------------ | -------------------- |
| `npm audit --omit=dev --audit-level=high` | 1 high, exit 1     | found 0, exit 0      |
| `package.json` zod spec / installed       | `^3.24.2` / 3.24.2 | `^4.6.7` / 4.6.7     |
| `npx tsc --noEmit`                        | exit 0             | exit 0               |
| `npx vitest run`                          | 219 files, 3644    | 220 files, 3658 pass |

The 14 new tests are this migration's own: 6 in `src/lib/server/validate.test.ts` and 8 cases added
to `src/lib/errors.test.ts`. Nothing else needed editing.

## 1. `z.ZodType` lost its middle parameter

v3's signature is `ZodType<Output, Def extends ZodTypeDef, Input>`. v4's is `ZodType<Output, Input>`.
Three signatures in the repo passed `z.ZodTypeDef` explicitly and stopped compiling:

- `src/lib/server/validate.ts` — `parseInput`'s `schema` parameter
- `src/lib/site-content.ts` — `sectionsSchema` and the `readSections` helper parameter

All three now read `z.ZodType<T, unknown>`, and `grep -rn ZodTypeDef src` returns nothing.

## 2. An enum-keyed `z.record` became exhaustive

This is the one that would have shipped a bug rather than a compile error. `sectionsSchema` accepts
two stored shapes, and its fallback for the old one is a record keyed by the section enum:

```ts
const legacySectionsSchema = z.partialRecord(sectionKeySchema, z.boolean());
```

In v3 a `z.record` checked the keys that were present, and nothing more. In v4 the same schema is
exhaustive — it demands a value for **every** key of the enum. Measured on both versions with the
three-key enum `noise | paywall | labs`:

| input                             | v3.24.2 `z.record` | v4.6.7 `z.record` | v4.6.7 `z.partialRecord` |
| --------------------------------- | ------------------ | ----------------- | ------------------------ |
| `{ noise: false }`                | parses             | **fails**         | parses                   |
| `{}`                              | parses             | **fails**         | parses                   |
| `{ noise: false, paywall: true }` | parses             | **fails**         | parses                   |
| `{ nope: true }`                  | fails              | fails             | fails                    |

The failure text is `Invalid input: expected boolean, received undefined`, once per missing key. A
row seeded by migration `0003` — `{ noise: false }`, written before the later sections existed — is
exactly that input, so a straight swap would have blanked every section for every stored tenant.

`z.partialRecord` keeps the enum's key set closed (an unknown key still fails) and keeps the
missing-keys tolerance; `normaliseSections` already fills the gaps, which is the whole point of
accepting the old shape. The existing test `sectionsSchema > still accepts the legacy boolean-map
form` covers it: with plain `z.record` it fails, with `partialRecord` it passes.

## 3. Every default issue message was rewritten

v4 replaced the wording wholesale. Measured, same schema (`z.object({ feedUrl: z.string() })`,
`z.object({ name: z.string().max(8) })`):

| case                              | v3.24.2                                      | v4.6.7                                               |
| --------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| field missing                     | `Required`                                   | `Invalid input: expected string, received undefined` |
| wrong type                        | `Expected string, received number`           | `Invalid input: expected string, received number`    |
| over the max                      | `String must contain at most 8 character(s)` | `Too big: expected string to have <=8 characters`    |
| `.url()` on `javascript:alert(1)` | parses                                       | parses                                               |
| `error.errors` alias              | present                                      | **gone** (`error.issues` only)                       |

Those strings are not written for readers, and `src/lib/errors.ts` is the place that turns them into
sentences ("Check the email address."). Its guard matched `Required` and `Expected … received …`
only, so under v4 the guard would have stopped matching and zod's own text would have reached the
reader verbatim — the exact regression the migration had to avoid. `humanError` now asks one
exported predicate, `isDeveloperWording`, which covers the v3 strings (an error serialised by an
older bundle can still arrive) and the v4 families: `invalid input`, `invalid option`, `invalid
union`, `invalid type`, `invalid url`, `invalid email`, `too big`, `too small`, `expected … received
…`. It matches on the prefix, because every v4 message is a prefix plus detail.

`parseInput` uses the same predicate to choose what it throws: the first issue whose message a person
wrote, else `Those details are not valid.` Before, it threw zod's first message whatever it said.

Nothing else touched the old error API: `grep -rn '\.errors\b|\.flatten()|\.format(' src` finds no
zod use (the hits are `Intl.*Format` and a Cloudflare `errors` payload), so v4 dropping the `.errors`
alias broke nothing here.

## What was left alone

`z.string().url()` accepts `javascript:`, `file:`, `data:` and `mailto:` — in **both** majors. v4
validates with `new URL()`; v3's regex was just as permissive on the schemes measured above. Two
call sites still pass such a value onward: `src/lib/server/push/account.ts:14` (a push endpoint a
Worker POSTs to) and `src/lib/server/blog.ts:243` (a cover image rendered as `src`). That is a real
hole and it is not this migration's, so the schemas are untouched here and the hardening is filed as
its own card. `src/lib/net/public-url.ts` already refuses non-http schemes for the value it guards;
the fix is to use it at those two sites.

## Evidence

- `npm audit --omit=dev --audit-level=high` → `found 0 vulnerabilities` (exit 0), on the committed tree.
- `npx tsc --noEmit` → exit 0; `npx vitest run` → 220 files, 3658 tests passing.
- `GITHUB_ACTIONS=true npm run ci` → see the PR; the runner's "Dependencies and secret names" job is
  the check this migration exists to turn green.
- Version probes: zod 3.24.2 and 4.6.7 installed side by side in scratch dirs, same script, output
  transcribed into the tables above.
