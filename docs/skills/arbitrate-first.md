# Adding `arbitrate-first` in Freebuff → Settings → Skills

Adapted to the dialog the app actually ships, read out of its UI bundle
(`resources/orchestrator/ui/assets/index-DCS_evve.js`), not guessed at.

## What that screen really is

- The text box under **Your skills** is **Search skills** — a filter. Typing `arbitrate` there
  only narrows the list; it is not a name field.
- Click **Create**. A blank row appears with exactly three inputs: **Name**, **Description**,
  **Instructions**. Paste the three values below and press **Save**.
- Instructions may be the whole `SKILL.md`, frontmatter included — the app's own About text says
  "Create skills or paste instructions from a SKILL.md", and the bundled skills store their
  instructions that way.

## The three fields

**Name**

```
arbitrate-first
```

**Description**

```
Put every product decision to the decision-maker before changing code, then implement only the ruling. Use in real products and SaaS where behaviour, copy, pricing, limits, schema, policy or architecture is the user's call, especially when the user carries questions to an arbiter such as a review thread, a council, or another model.
```

**Instructions**

```markdown
---
name: arbitrate-first
description: Put every product decision to the decision-maker before changing code, then implement only the ruling. Use in real products and SaaS where behaviour, copy, pricing, limits, schema, policy or architecture is the user's call, especially when the user carries questions to an arbiter such as a review thread, a council, or another model.
---

# Arbitrate first

In a product, most "bugs" are decisions. The code change is the last step of a decision
that was made on purpose. Write nothing that changes what ships until someone with the
authority has ruled on it.

## Classify before touching code

- **Mechanical, no-judgement fix** — a typo, a crash, a failing type, a broken build, a
  flaky test, an obvious off-by-one. Fix it, then report what you changed.
- **Decision** — anything a reader, customer or operator would experience differently: what
  ships or is withheld, copy, prices, limits, quotas, ranking, schemas, migrations, policy,
  error states, defaults, retention. Do not implement it. Put it to the arbiter.
- When unsure, treat it as a decision. Asking costs one message; a unilateral product change
  costs a shipped behaviour nobody agreed to.

Refactors, tests and docs are not a loophole. A decision smuggled in as "cleanup" is still
a product change.

## It is asked first, and it is cross-examined

The arbiter is where a question goes **first** — before the owner, and before you decide the
question does not need asking. The owner is the escalation, not the first responder.

Within that, the arbiter is not an oracle to be obeyed:

- **Question it.** Re-ask with better evidence, name the part you believe is wrong, and say
  what would have to be true for your reading to hold. Push back as many times as it takes; a
  ruling you had to argue for is stronger than one you accepted to avoid friction.
- **Check it against the code, the data and the measured corpus.** When a ruling contradicts
  something you can demonstrate, take the demonstration back instead of implementing around it.
- **Escalate to the owner only when the arbiter is unavailable, or when evidence you can show
  contradicts its answer and it will not revise.** Say plainly which of the two it is.
- **Never invent either answer.** A ruling nobody gave is not a ruling, and an unanswered
  question is not permission to proceed.

## How a decision is put

1. **Evidence, not opinion.** The measurement that made the problem visible, the numbers
   before and after, the file and line, and what a real user experiences. If you cannot
   measure it, say so.
2. **Name the decision in one sentence.** "Does a story with no body get delivered?" — not
   "improve reader quality".
3. **Two to four options.** For each: what changes, what it costs, who notices, what breaks,
   and whether it is reversible.
4. **Recommend one, and label it a recommendation.** Say what would change your mind.
5. **Numbered questions.** One question per message when the answer decides the next
   question. Several at once only when they are genuinely independent.
6. **Send it and wait.** Silence, a partial answer, or an unrelated reply is not a ruling.

## While waiting

- Nothing that changes behaviour lands. A proposal may exist as a diff, a branch, or a file
  outside the shipping path — never as a live edit on the shipping path.
- Do not "prepare" the change by wiring it behind a flag that is already on.
- If the ruling is already written down — a spec, an ADR, the project's own instructions —
  follow it instead of asking again.

## After the ruling

- **Record it where the next thread will find it**: the date, the question, the options, the
  ruling, and the reason. A ruling nobody can find gets re-litigated.
- Implement the smallest slice that matches the ruling, then measure before and after on the
  same inputs and report both, including the cases where the ruling made things worse.
- If the code or the data contradicts the ruling, stop and take the evidence back. Never
  override the decision silently, and never reword it into something easier to build.

## Signs you are doing it wrong

- You ran a test suite to justify a change you had already made.
- A change "obviously" followed, so you made it.
- The user learns about a product decision from the diff.
- You wrote the option you disagreed with as a straw man.
- You asked, got no answer, and treated your own recommendation as the ruling.
```

## Companion skill

`keep-context-current` is installed the same way, and carries the other half of this
repository's discipline: the context file every session reads first, and the rule that it is
updated in the same commit as the change it describes. See
[keep-context-current.md](keep-context-current.md).

## Limits the app enforces (from its own schema)

| Rule               | Value                                | This skill             |
| ------------------ | ------------------------------------ | ---------------------- |
| Name               | `^[a-z0-9][a-z0-9-]{0,63}$`          | matches (15 chars)     |
| Description        | 1–1000 chars, trimmed, non-empty     | 334                    |
| Instructions       | 1–50,000 chars, trimmed, non-empty   | 3,390                  |
| Skills per account | 50 (you are at 48 → this is slot 49) | one slot left after it |
| Names              | unique                               | no collision           |
| Whole skill set    | under 2.5 MB                         | 583,045 bytes          |

The dialog has **no field for resource files**. The agent file below is therefore optional and
cannot be typed in here — it applies only if the skill is installed from files rather than the
UI. The skill works without it.

## Optional resource, for file-based installs only

```
interface:
  display_name: "Arbitrate First"
  short_description: "Rule on product decisions before changing code"
  default_prompt: "Use $arbitrate-first to put this product decision to the arbiter before any code changes."
```

## Invoking it afterwards

`$arbitrate-first`, or the plain-language triggers: "arbitrate first", "decide before coding",
"is this a decision or a fix?", "put this to the arbiter before touching code".
