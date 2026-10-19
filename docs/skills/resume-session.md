# `resume-session` — install fields, and why this exists

The counterpart of `handoff-session`. That skill writes the state out; this one reads it back and
starts work, because the failure this project kept repeating was a session that began on a stale
checkout: 62 commits behind `main`, with the previous session's handoff, acceptance checklist and
decision log all sitting in the worktree unread.

The owner asked for it in these words — *"pull the repo and update with main as main have new things
then check the ai left docs what to do where to start things, make this a skill so next time i dont
need to say to you give me skill to put this in freebuff"*.

Its body is identical to the installed copy in the account's global skill set, so a session in any
project runs the same process, not only sessions inside this repository.

## The three fields

**Name**

```
resume-session
```

**Description**

```
Bring a project up to date and start work where the last session stopped: sync the checkout to main, read the handoff, context and acceptance docs a previous session left, name the one next slice with its acceptance evidence, then take it. Use at the start of a session on an existing codebase — "pull the repo and update to main", "what did the last agent leave", "where do I start", "catch up with main" — so a cold session continues the work instead of re-deriving it.
```

**Instructions**

```markdown
---
name: resume-session
description: "Bring a project up to date and start work where the last session stopped: sync the checkout to main, read the handoff, context and acceptance docs a previous session left, name the one next slice with its acceptance evidence, then take it. Use at the start of a session on an existing codebase — \"pull the repo and update to main\", \"what did the last agent leave\", \"where do I start\", \"catch up with main\" — so a cold session continues the work instead of re-deriving it."
---

# Resume where the last session stopped

A session that starts working without syncing reinvents history: it re-fixes a bug that is already
fixed upstream, or builds on a checkout an unknown number of commits old and reports success against
a repository nobody is running. The two halves of this skill are **sync first** and **read what was
left**, in that order, before any new work.

## 1. Sync the checkout first, and do not lose what is only here

- `git status` and the current branch before anything else. In a shared checkout another agent may be
  mid-edit: uncommitted work is not yours to move, and a dirty tree is a reason to stop and say so.
- `git fetch --prune`, then compare both directions: `git log --oneline HEAD..origin/main` is what is
  upstream and missing here, `git log --oneline origin/main..HEAD` is what exists only here.
- A diverged branch is a normal state, not an error. Before moving `main`:
  - If the local-only commit has an upstream commit with the same subject, diff the two trees. An
    identical tree is a duplicate. A tree that is **worse** than upstream — a mangled function body,
    a duplicated import line — is the pre-fix draft of something that landed corrected, and keeping
    it would restore the bug.
  - Write the local sha down before moving anything, so the old position is recoverable.
  - If the local commit is a real change with no upstream twin, it is not a duplicate: merge or
    rebase it and say so, never discard it.
- `git reset --keep origin/main` moves the branch without touching a dirty tree; `--hard` is for when
  you have proved there is nothing to keep.

## 2. Read what the last session left, newest first

Look for these and stop at the first that exists:

1. **A handoff file** — `docs/handoff-*.md`, `HANDOFF.md`, anything whose own first line says "start
   here". It is written to be read cold and it names the next slice.
2. **The context file** — `docs/context.md`, `CLAUDE.md`, `AGENTS.md`: what the product is, what is
   built, what is next, which invariants must not break.
3. **The acceptance or definition-of-done doc** — the list of what "finished" still fails, each line
   with the command that measures it.
4. **The decision log** — the rulings the handoff names, with their dates and reasons.

The handoff's next slice outranks your own idea of what is interesting: it is the result of the last
measurement, and a slice chosen from the code alone is usually one that was already ruled out.

## 3. Say where the work starts — one slice, one acceptance reading

Name **one** slice, the evidence that will prove it done (the command and the reading it must print),
and who owes it: code, the owner (a credential, a price, a machine), or the arbiter (a ruling).

- "The next slice is X; it is done when `npm run something` prints Y" beats a survey of the
  repository, and beats a plan.
- If the next slice is blocked on a ruling or a missing credential, say that in one line, name the
  blocker, and take the next unblocked slice instead of stopping.

## 4. Check the docs against the tree before trusting them

Docs drift, and the drift is invisible until you act on it. Verify the claims you are about to rely
on: a file named in the doc, a script `npm run` can actually reach, a command whose exit status
matches what the doc says, a skill the doc claims is installed. Run the instrument rather than
reading its last recorded output.

A claim that turns out to be false is a finding to record in the same breath as the work — not a
reason to abandon the slice, and never something to quietly assume was true.

## 5. Then take the slice — the reading is not the session

Resume the project's own loop with the project's own rules: the smallest verified change, evidence
before and after, the context file updated **in the same commit** as the change it describes, and the
push when the project's gate is green. A session that syncs, reads, reports and stops has done the
reading and none of the work.

## 6. Report progress, not status

Lead with what changed upstream, what the next slice is, what you are doing about it, and the
evidence — not with a list of files you looked at. Never present a plan as though it were done, and
never present a check you could not run as though it passed.

## What this is not

- Not for a greenfield repository: with no history there is nothing to sync and nothing to read.
- Not a licence to skip the project's own rules file. Read it (step 2) and follow it; this skill says
  where to look, not what the project's rules are.
- Not permission to move a branch with uncommitted work in it, or to drop a local commit you have not
  proved is a duplicate.
```

## Install it (both halves are required)

1. **The account's global skill set** — the installed copy is
   `~/.agents/skills/resume-session/SKILL.md` (frontmatter + the body above). That directory is the
   global install target this app reads for every project, so a session in any repository gets it.
   Freebuff also syncs skills from the account (`GET/PUT /api/v1/cloud/skills`); making it a
   *cloud/account* skill rather than a local one is a Settings → Skills action in the app, and the
   three fields above are what to paste there.
2. **This repository's copy** — this file, tracked so the published half of the skill is reviewed and
   versioned with the code, as `AGENTS.md` requires.

## Why this is not only a convenience

Measured 2026-10-19 in this checkout: local `main` was **62 commits behind `origin/main`** and one
commit ahead with a commit whose upstream twin (`372e184`) had landed a corrected
`src/lib/editorial.ts` — the local copy carried a duplicated import and a malformed
`recoverCardSummary` body. `docs/handoff-2026-10-18-night.md`, `docs/reader-quality-10-of-10.md` and
the newest `docs/context.md` work-log entries were all on the remote side of that gap, so a session
working from the local tree would have been repairing a tree nobody ships, and would not have seen
the ruling (`#12c`) that says what the next slice is.

The same read found a second kind of drift, recorded here so the next session checks rather than
assumes: `docs/skills/keep-context-current.md` and `reader-quality-loop.md` describe their skills as
"installed in the account's global skill set", and the account snapshot at that date held **39
skills, none of them named `arbitrate-first`, `keep-context-current` or `reader-quality-loop`**. The
repository half existed; the installed half did not. Verify with the snapshot
(`~/.config/freebuff-desktop/account-skills/<account>/current.json`) and install what is missing.
