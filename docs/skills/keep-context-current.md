# `keep-context-current` — install fields, and why this exists

The second rule of this repository, after `arbitrate-first`: **a session must be able to start
cold without inventing the product.** That is what `docs/context.md` is for, and this skill is
the process that keeps it true.

Install it the same way as `arbitrate-first` (Freebuff → Settings → Skills → Create, paste the
three fields below, Save). The skill body is identical to the installed copy in the account's
global skill set, so a session in any project gets the same process, not only sessions inside
this repository.

## The three fields

**Name**

```
keep-context-current
```

**Description**

```
Keep a project's context file — what the product is, what it does, what has landed, what is next, and the invariants — as the first thing any session reads, and update it in the same commit as every change. Use in any repository that should be resumable by an agent or a person who was not there, and wherever a new session must not re-derive the product from the code and quietly invent a version of it that never existed.
```

**Instructions**

```markdown
---
name: keep-context-current
description: Keep a project's context file — what the product is, what it does, what has landed, what is next, and the invariants — as the first thing any session reads, and update it in the same commit as every change. Use in any repository that should be resumable by an agent or a person who was not there, and wherever a new session must not re-derive the product from the code and quietly invent a version of it that never existed.
---

# Keep the context current

A session that has to infer what a product is will build a plausible version of it. That
version is wrong in the places that matter — what ships, what is deliberately withheld, what
was ruled and why — and the wrongness is invisible, because everything it produces looks
consistent with the code it just read and nothing contradicts it.

The fix is one file that says the truth, in one place, kept current by the same commit that
changes it.

## Read it before you touch anything

At the start of a session, read the context file before reading code, and let it route you:
to the rules file, the decision log, the status page, the document that owns the question you
are about to ask. Do not re-derive the product from `src/`; the code cannot tell you what is
intentionally not built, what was ruled against, or what "done" means here.

## What the file must contain

Seven sections, and nothing that belongs in one of the documents it points to:

1. **What the product is** — the sentence a stranger needs, the customer, the plans, the
   operator, and what is deliberately not for sale yet.
2. **How it works** — the pipeline or the request path as a short diagram, plus the stack.
3. **The area under active work** — where the bar is set, and what the acceptance condition
   is, so a change can be judged rather than admired.
4. **State** — table by area, with the honest word for each: built, dormant, blocked,
   planned. Where something is blocked, say on whom and on what.
5. **Work log** — append-only, newest last, one entry per landed change with its evidence.
   Slices a decision log names get named here too.
6. **What is next** — the queue in priority order, and which items are waiting on a ruling
   rather than on code.
7. **Invariants and rules** — what must not be broken, and where the detail lives (a table of
   question → file), plus the commands worth knowing.

## Update it in the same commit

The change and its context entry are one commit. Not "afterwards", not "in a docs pass" — in
the same commit, because a change that is not recorded reads as a change that never happened,
and the next session will re-litigate it or undo it.

That means: append the work-log entry, move the item out of _next_, update the state row, and
correct any number the change moved. If the change was a decision, the ruling goes in the
decision log and the context file points at it.

## Numbers carry provenance

Every measured number states the date it was taken and the command that produced it, and,
where a corpus or dataset was involved, which one. A number without provenance is an anecdote,
and the next session will either trust it too much or not at all. Where a number has a floor
or a must-be-zero line, say so explicitly — that is the difference between a measurement and
an acceptance condition.

## Keep it short enough to be true

A context file that has grown into a second copy of the repository is a file nobody updates,
and an unmaintained context file is worse than none: it is confidently wrong. Keep the detail
in the documents it links to, and keep here only what a session needs to start, judge, and
pick up the thread.

## When the file and the code disagree, the code wins

Never patch the code to match the file. Read the code, decide which is right, fix the file in
that commit, and say which one was wrong. A silently reconciled disagreement is how the file
starts drifting.

## Never hide it

The context file and the rules file are tracked, reviewed, and pushed with the work. Never
add them to `.gitignore`, never leave them out of a commit, never keep a private copy: a
context file only the last session can see is the same as no context file at all.

## Signs you are doing it wrong

- You are inferring the product from the code because reading the file felt slower.
- The file's work log stops several changes ago.
- A number in the file is bare — no date, no command.
- Your change is committed and the file still describes the old state.
- The file names a plan as if it were delivered, or a delivered thing as a plan.
- The next session asks a question the file already answered.
```

## Limits the app enforces (from its own schema)

| Rule         | Value                       | This skill         |
| ------------ | --------------------------- | ------------------ |
| Name         | `^[a-z0-9][a-z0-9-]{0,63}$` | matches (20 chars) |
| Description  | 1–1000 chars                | 423                |
| Instructions | 1–50,000 chars              | 4,631              |

## The repository half of this skill

The skill is the process; the file it maintains is the artefact. In this repository:

- The file is **[context.md](../context.md)**, and it says so itself in its first line.
- `AGENTS.md` carries the rule ("Context comes first, and is kept current") so a session that
  never opens the skills list still gets it.
- Both files are tracked and pushed with the work, and `.gitignore` must never mention them.

## Invoking it afterwards

`$keep-context-current`, or the plain-language triggers: "keep the context current", "update
the context file", "write down what we did", "so the next session does not hallucinate".
