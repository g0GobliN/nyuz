# `publish-branch` — install fields, and why this exists

The owner asked for it after three pushes went red in a row:

> *"can you make this as rule for pushing as right now when you push i got a ci fail so i dont want that
> happen next time so"*

The failure was not a careless push. Every one of those slices had passed `npm run ci` locally, and every
one of them failed on the runner at **`Coverage floor`** — `src/components: lines 29.15 -> 28.90`, a 0.25pp
drop that sits inside the 0.35pp portability band the local ratchet tolerates and outside the exact
comparison CI makes. The gate was green and the push was red, which is a worse failure than a red gate: it
teaches a session to distrust its own evidence and pushes a "deployed" change that never deployed.

So the rule is not "run the tests". It is: **prove the push on the runner's own terms, on a tree nobody
else is writing to, and verify the run afterwards** — and when the two gates disagree, fix the
disagreement rather than the message.

The body is written to be portable: it names no nyuz-only command, so it is the same process in any
repository. Project specifics are discovered in step 1 from `package.json` and the CI workflow, and the
nyuz numbers below appear only as the measured example that justifies the rule. The installed copies are
`~/.hermes/skills/software-development/publish-branch/SKILL.md` (what Hermes loads) and
`~/.agents/skills/publish-branch/SKILL.md` (the account-wide copy); both are byte-identical to the body
here, so a session in any project runs the same process.

## The three fields

**Name**

```
publish-branch
```

**Description**

```
Use when committing and pushing work in any repo: validate as the runner will, publish the current branch to its existing upstream, and verify the remote holds the commit.
```

**Instructions**

```markdown
---
name: publish-branch
description: "Use when committing and pushing work in any repo: validate as the runner will, publish the current branch to its existing upstream, and verify the remote holds the commit."
version: 2.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [git, push, ci, verification, release]
    category: software-development
    related_skills: [guard-git, requesting-code-review, systematic-debugging]
---

# Publish the current branch

Inspect → review → validate → fix → commit → push → verify. This publishes finished work to the branch
that is already checked out and has an upstream; it is not a commit-only procedure and not a
pull-request procedure. A push is a claim that the runner will pass, so make the claim true before
pushing and verify it afterwards. Measured in one project: three consecutive pushes went red on a
coverage floor while the local gate was green, and every red run skipped its deploy — the branch was
ahead of production, the worst of both states.

## When to use

- "push this", "land it", "ship it", "commit and push".
- After a CI failure on your own commit: fix forward, then publish again.
- Not for opening a pull request, and not for history surgery — rewrites are `guard-git` territory.

## 1. Inspect the repository first

```sh
git rev-parse --show-toplevel
git status -sb
git rev-parse --abbrev-ref --symbolic-full-name @{u}
git remote -v
git log --oneline -8
```

- Separate staged, unstaged and untracked files. Never assume the tree is clean, and never assume every
  change in it is yours — the user or another agent may share the checkout.
- Read the project's real gate from `package.json`, `Makefile`, `pyproject.toml`, `justfile` and the CI
  workflow files. Do not invent commands, and note which ones the runner actually executes.
- Decide which changes belong to the task in hand before staging anything.

## 2. Review the diff, not the file names

- Read `git diff` and `git diff --cached` in full.
- Look for accidental deletions, unrelated refactors, debugging output, temporary probe scripts, generated
  artifacts, and hardcoded credentials, tokens or private configuration.
- Documentation that describes the change belongs in the same commit as the change.
- If the tree holds someone else's work, leave it out: stage explicit paths, never `git add -A` on a shared
  tree, and never commit unrelated work to make the tree look clean.

## 3. Validate on the tree you are about to commit

- **The tree must be quiet while the gate runs.** No subagent, dev server or editor writing a file during
  the run. Measured: a worker rewriting a route file while Playwright drove the built app failed the e2e
  that pins that page's copy — the commit was innocent and the evidence was worthless. If another writer
  is active, wait for it and start again.
- **A green run on an older tree is not evidence.** Edit → gate → commit, and nothing in between. If you
  edit after the run, run it again.
- **Local green is not runner green.** Run the gate as the runner does; find the project's CI switch
  (`CI=true`, `GITHUB_ACTIONS=true`, `NODE_ENV=production`) and set it, because scripts relax locally. In
  one project a coverage ratchet applied its 0.35pp portability band only off CI, so a 0.25pp drop warned
  locally and failed three pushes; the fix was `GITHUB_ACTIONS=true npm run ci`. When the gate is long,
  the minimum honest check is the full gate plus the strict comparison of any script with a local
  tolerance.
- **Never push on a red gate**, even when you believe the failure is contamination. Prove the tree is
  quiet and re-run. A red push is not a deployed change when the deploy job is gated on green checks.
- Run the checks and record their results. Do not claim a check you did not run, and do not weaken tests
  or skip steps to manufacture a green result.
- If a check cannot run for an environmental reason, say which and whether that blocks publication — an
  environmental limitation is not a pass.

## 4. Fix what can safely be fixed, then re-run

- Investigate with the logs, the source and the failing test before changing anything.
- Smallest appropriate fix, plus the regression test that would have caught it.
- Re-run what the fix touched, then the whole gate on the final tree, and read the final diff again.
- A coverage shortfall is a code problem: cover what you added, or raise the floor deliberately and say
  why in the commit.
- Distinguish code from infrastructure: a runner install dying with `ECONNRESET` is the network — re-run
  that job. A real assertion failure is the code.
- Stop and ask when the fix needs a destructive action, unavailable credentials, or a product decision
  outside the task's authority.

## 5. Stage deliberately

- Explicit paths, then `git diff --cached --stat` and a read of the staged diff.
- No `.env`, secrets, caches, build output, or files from someone else's work.
- One coherent slice per commit; a session's work is usually several commits, not one lump.

## 6. Commit with a true message

- Say what changed and why, in the project's existing style (`git log --oneline -8`).
- No `update`, `fix stuff` or `changes`. No `Co-Authored-By` trailer and no AI attribution.
- Do not rewrite existing history to improve presentation, and do not add a redundant commit when the
  work is already committed appropriately.

## 7. Push to the current branch's existing upstream

- `main` current → push `main`. Another branch → push that branch to its configured upstream:
  `git push` (or `git push origin HEAD`).
- Do not open a pull request, create a review branch, or merge: publication here is a direct push, and a
  direct push to `main` is intended when `main` is checked out.
- Do not switch branches, do not push a different branch than the checked-out one, and do not change the
  remote or upstream to get past a failure.
- No upstream, or an ambiguous destination → stop and report it. The one exception: when the current
  branch has no upstream and publishing is what was asked, create the upstream deliberately with
  `git push -u origin HEAD` and say the branch was created. Never as a workaround for a rejected push.

## 8. Handle a failed push by cause, not by force

- Read the whole error. Classify it: authentication, permissions, connectivity, upstream mismatch, or
  remote history conflict.
- Fix ordinary causes when authorised — re-authenticate, correct the remote URL, `git fetch` before
  retrying.
- Rejected because the remote moved: `git fetch`, inspect the new commits, integrate them without
  rewriting published history, re-run the affected checks if the code changed, then retry.
- Never force-push over a rejection, never rewrite published history, and never change git configuration
  or the destination as a workaround. Ask when the blocker needs a decision you are not authorised to
  make.

## 9. Verify the published result

- `git fetch`, then `git rev-parse HEAD` must equal `git rev-parse @{u}` (or `origin/<branch>`). The same
  commit, or the push is not done.
- Confirm the remote branch points at the intended commit and that every intended commit is included.
- With CI: watch the run for that sha — `gh run list --limit 3`, then `gh run watch <id> --exit-status`. A
  job that reads `success` may belong to a different workflow; check the run whose `headSha` is your
  commit.
- Red: `gh run view <id> --log-failed`, fix forward in a new commit, push again. Do not report success
  while the run is red, queued or unknown; if the remote cannot be queried, say verification failed.
- Network-flaked job: `gh run rerun <id> --failed`, and say that is what happened.

## 10. Report the result

Branch published; commits (sha and subject); what changed; the checks actually run and their results; the
remote verification (run id and conclusion, or that the remote could not be queried); anything still
blocked or unverified. A successful `git push` line is not verification, and a green local gate is not a
green run.

## Pitfalls, all measured

- A subagent editing the tree mid-gate produced a false red; the push made on the belief "it was
  contamination" was later red for a real reason.
- A docs-only commit pushed behind a run on an older tree is usually harmless but still unverified: gate
  after the last edit, or push only behind a run that already covers the final tree.
- Off CI a ratchet or threshold mutes itself; the runner does not. The CI switch is the difference.
- `pkill -f "<pattern>"` can match the shell running it and kill your own command (SIGTERM, `-15`): kill
  by PID from `ss -ltnp` instead.
- Never `git add -A` on a shared checkout — it silently publishes another session's half-finished file.

## Operating rule

Inspect first. Preserve the current branch and existing work. Review the changes, run the relevant checks,
fix what can safely be fixed, commit meaningful changes, push directly to the current branch's existing
upstream, and verify the published commit.
```
