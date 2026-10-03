# Contributing

> **Read the licence position first.** nyuz is proprietary. Submitting a pull request,
> issue or patch grants you no right to this software, and anything you submit may be used
> without restriction or payment. See [`LICENSE`](../LICENSE) clause 2.
>
> This page is for people working on nyuz with permission.

---

## Before you start

Read [status.md](status.md). Several parts of this codebase look finished and are not, and
the reverse is also true. Building something that already exists, or assuming a working
pipeline, both waste a day.

---

## Branching

`main` is the default and is what CI protects. Work on a branch and open a pull request:

```bash
git switch -c topic/short-description
```

---

## Commits

**One commit per coherent change.** A commit that adds a feature, reformats twelve
unrelated files and bumps a dependency is three commits pretending to be one, and it cannot
be reviewed or reverted.

Subject in the imperative, under ~70 characters. The body explains **why**, not what — the
diff already says what:

```
Filter dashboard stories against the reader's own topics

Every reader saw all six sample stories with a hard-coded caption
claiming what they followed, so somebody who onboarded asking for
singing was told "You follow chips and AI infrastructure".

Exclusions are applied before topics so an excluded term cannot be
reintroduced by a topic that overlaps it, matching the rule 0001
specifies for the real pipeline.
```

Formatting-only changes go in their own commit, never mixed with logic.

---

## Checks

Everything CI runs must pass before review, and `npm run ci` is that list in that order —
typecheck, lint, the suite with coverage, the coverage floor, the build, the PWA install
contract, the route walk's self-test, then Chromium against the built Worker. Running it before
you push is the whole point: a green push is then a checked push.

```bash
npm run ci
```

The individual pieces, if you want one of them:

```bash
npm run typecheck
npm run lint
npm run test          # or: npm run test:shard -- 1/4
npm run test:coverage && npm run coverage:ratchet
npm run build
npm run route:walk:self-test   # does the checker still report failures?
npm run route:walk -- https://nyuz.app   # against a live origin
npm run e2e           # builds first, then drives the Worker in Chromium
```

`npm run coverage:ratchet` fails when a change makes the codebase **less tested** than it
was — a new module with no tests, most often. Cover it, or raise the floor deliberately with
`npm run coverage:ratchet -- --update` in the same commit, which is a decision the diff then
shows.

Add a test when you fix a bug in pure logic. `matching.test.ts` exists because of a real
bug; its cases are the specification now.

---

## Conventions

Full list in [development.md](development.md#conventions). The ones most often missed:

- **`tsc --noEmit` stays clean.** `noUncheckedIndexedAccess` is on — narrow before use.
- **Three colours.** Black, white, one blue. Do not add a fourth.
- **Never edit `src/routeTree.gen.ts`.** It is generated.
- **Never import `src/lib/server/` or `supabase/admin.ts` from a component.**
- **LF line endings**, enforced by `.gitattributes`.

### Comments

Explain **why**, especially where the code looks odd. A comment restating the code is
noise; a comment recording the constraint that forced an unusual shape is the most
valuable thing in the file. Match the density of the surrounding code.

---

## Security-sensitive changes

Work through the checklist in [security.md](security.md#checklist-for-new-code) and say in
the PR description that you have.

Anything touching these needs particular care:

- RLS policies, or a new table
- `src/lib/server/guard.ts`
- Role or ban handling
- Anywhere the service-role key is used
- Anywhere operator-supplied text or URLs reach the DOM

Do not report a vulnerability in a public issue — see `/legal/security`.

---

## Docs

Update the relevant page in `docs/` in the same PR. A doc that describes last month's
behaviour is worse than no doc, because it is believed.

If you make something in [status.md](status.md) untrue — by building it — change that page
too. It is the one people read first.
