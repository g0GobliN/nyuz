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

All four must pass before review. CI runs the same four.

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Add a test when you fix a bug in pure logic. `matching.test.ts` exists because of a real
bug; its cases are the specification now.

---

## Conventions

Full list in [development.md](development.md#conventions). The ones most often missed:

- **`tsc --noEmit` stays clean.** `noUncheckedIndexedAccess` is on — narrow before use.
- **Three colours.** Black, white, one red. Do not add a fourth.
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
