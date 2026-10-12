# `reader-quality-loop` — install fields, and why this exists

This one was **missing until the owner said so twice.** The product had a green suite, a coverage
ratchet, a frozen corpus and a route walk, and it still shipped briefings with no explanation for
four weeks, and one day shipped all 25 of its stories without the sentence that makes a briefing a
briefing. Every one of those was invisible to the gates, because the gates measure the code and the
reader reads the output. This skill is the loop that closes that gap, and the rules it enforces are
also written into `AGENTS.md` under **Stage and priority** and **The loop does not stop**.

Install it the same way as `arbitrate-first` (Freebuff → Settings → Skills → Create, paste the
three fields below, Save). The skill body is identical to the installed copy in the account's
global skill set, so a session in any project gets the same process, not only sessions inside this
repository.

## The three fields

**Name**

```
reader-quality-loop
```

**Description**

```
Run pre-launch product work as a continuous loop gated on what the end user actually receives. Judge quality on the live artifact by reading it as a stranger, keep the decision-maker and the running product open on every pass, treat free-tier limits as conditions rather than bugs, and never hand back a status report in place of progress. Use when the bar that matters is the quality of what a user reads or receives rather than a passing test suite.
```

**Instructions**

```markdown
---
name: reader-quality-loop
description: "Run pre-launch product work as a continuous loop gated on what the end user actually receives. Judge quality on the live artifact by reading it as a stranger, keep the decision-maker and the running product open on every pass, treat free-tier limits as conditions rather than bugs, and never hand back a status report in place of progress. Use when the bar that matters is the quality of what a user reads or receives rather than a passing test suite."
---

You are working a product that is not launched yet, where the only bar that matters is **what the
end user actually receives**. Work in a loop, and keep looping.

## 1. The gate

- **The bar is the user's output, and it is 10/10 with no exceptions.** No rubbish reaches a user.
  Name the rubbish concretely — a thin briefing, a story with no explanation, a paragraph opening on
  a reference the page never establishes, a truncated sentence, a claim the sources do not carry, a
  notification nobody needed. A defect in what a user receives **outranks every other kind of work**.
- **Nothing is "next" until this is met.** Features, infrastructure, refactors, dashboards: all of
  it waits. When asked what to do next, the answer is the worst thing the user currently receives.
- **Silence is the correct default for anything that interrupts a user.** An alert claims _this
  matters now_. If the user did not need to act on it, it is a defect of the same class as a bad
  paragraph. Never widen a rule to make a feature look used, and never fill a quiet day.

## 2. Judge it on the live artifact, not on the repository

- **Open the running product and read it as a stranger would, every pass.** Not the composer's own
  opinion of its prose, not a snapshot, not a fixture. What actually shipped.
- **A passing suite is not evidence about a user.** Tests prove a sentence is well-formed; they do
  not prove a briefing is worth reading. The reverse also holds: "all green" says nothing about
  output quality, and "red" does not necessarily say anything about it either.
- **Read on the real target.** The live URL for a web product; the real message on the real
  transport for anything sent. If you cannot reach it, say so plainly and treat that as the
  blocker — do not substitute a local approximation and call it verified.

## 3. Keep these open, and read them each pass

- **The decision-maker.** Whatever the arbiter is for this product (a review thread, a council, a
  model, a person): a decision goes there _first_, before the owner, and before you decide it does
  not need asking. Cross-examine it, re-ask with better evidence, and name the part you believe is
  wrong. Escalate only when it is unreachable, or when evidence you can show contradicts it and it
  will not revise — and say which of the two it is.
- **The live product in the browser panel**, so what you check is what shipped rather than what the
  repository implies.

## 4. Free-tier limits are conditions, not bugs

- A pre-launch product runs on free plans on purpose. When a limit bites, **record it with its
  evidence and design inside it**; do not spend a slice trying to upgrade it, and do not ask the
  owner to pay before the quality bar is met.
- Write the measurement down once, in the place a cold session will read, so the next session does
  not re-investigate the same limit as though it were a defect. A limit nobody wrote down costs
  every future session the same investigation.

## 5. The loop mechanics

- **Every pass ends with either a landed, verified change or a sharper question.** "I investigated
  it" is not an end state: write the finding down, then take the next slice, or put numbered options
  to the arbiter and say plainly that you are blocked on the ruling.
- **One pass = one slice**, verified once on the final tree, recorded in the same commit, pushed
  when confirmed. Do not dribble out commits for a slice still being verified, and do not wait to be
  asked whether to push a confirmed one.
- **When the context window fills, hand off rather than stop.** Write the state, the open question
  and the next slice to a file, and continue in a fresh thread pointed at it. A long goal outliving
  one session is the normal case, not a failure.
- **Report progress, not status.** The user is watching a live transcript: lead with what changed
  and what it now does, not with what you looked at. Never present a plan as though it were done,
  and never present a check you could not run as though it passed.

## 6. What this is not

It is not permission to lower a check, skip a test, weaken an assertion or widen a tolerance to
make a pass. If the gate is red for a reason unrelated to quality, say which reason and prove it
from the failure output — then fix the cause. A gate that has been disabled to go green is how a
product ships rubbish while reporting success.
```
