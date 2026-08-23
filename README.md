<div align="center">

# nyuz

### Stop searching. Start knowing.

**You don't read the news. It reports to you.**

</div>

---

Every morning the same ritual. Twenty tabs. Four newsletters you skim and delete.
An hour on X telling yourself it's research. And still the one thing that actually
mattered to your work reached you three days late, from a colleague, in passing.

The problem was never access to information. It's that there is far too much of it,
almost none of it is for you, and the same story arrives thirty times wearing thirty
different headlines.

**nyuz watches instead of you.** You say what matters. It reads everything, works out
what actually happened, throws away the noise and the duplicates, and sends you the
handful of things worth knowing — at the time you choose, in the format you choose.

Most mornings that's six stories. Some mornings it's one. Occasionally it's none, and
we tell you that rather than padding it out.

---

## What makes it different

**One event, not thirty articles.**
When thirty outlets cover one announcement, you get one story with all thirty sources
attached — not thirty entries to mentally deduplicate at 7am.

**It explains why _you_ care.**
Not a generic summary. A line about what this changes given what you actually follow,
written for you and nobody else.

**Quiet days stay quiet.**
There is no daily quota to fill. If nothing crossed your threshold, your briefing is
short or it doesn't come. A calendar of manufactured urgency is what we're replacing.

**Sources are always one tap away.**
Summaries are generated, and generated text can be wrong. nyuz never presents itself
as the origin of a story — the original reporting is never more than one tap from the
summary of it.

**You control the volume, precisely.**
A density dial from "only if it's genuinely major" to "tell me everything". Exclusions
that actually hold: a term you've excluded cannot be smuggled back in by a topic you
follow.

---

## How it works

**1. Tell it what matters.** Topics, companies, technologies — and, just as importantly,
what to ignore.

**2. It watches.** Hundreds of sources on a schedule. Company blogs, newsrooms, research
pages, release notes.

**3. It understands.** Articles describing the same real-world event are merged into one
event, read once, and scored for importance and novelty.

**4. It matches.** Your interests are compared against those events by a database query —
not a language model. Your topic list never leaves our infrastructure.

**5. You receive it.** One briefing. Your time, your timezone, your channel.

The deep version of this, with the actual mechanism at each stage, is at
[`docs/architecture.md`](docs/architecture.md).

---

## Plans

|                 | **Free** | **Personal**     | **Pro**                   |
| --------------- | -------- | ---------------- | ------------------------- |
|                 | $0       | **$7**/month     | **$15**/month             |
| Topics          | 3        | 15               | Unlimited                 |
| Briefings       | Daily    | Daily and weekly | Multiple schedules        |
| Delivery        | Email    | Email, Telegram  | Email, Telegram, WhatsApp |
| History         | 7 days   | 90 days          | 1 year                    |
| Breaking alerts | —        | Yes              | Yes                       |
| AI explanations | —        | Yes              | Deeper                    |

Start free. The free plan is the trial — no card, no countdown.

---

## Built on a real cost argument

Most "AI news" products re-read the internet for every subscriber, and their costs rise
in a straight line with their user count. nyuz doesn't.

An event is understood **once**, no matter how many people it eventually reaches. The
hundredth subscriber to care about a story doesn't trigger a hundredth analysis — they're
matched against an event that already exists. The only per-person model spend is one short
paragraph.

That's the whole architecture, and it's why the economics work at a $7 price point.
[The details](docs/architecture.md#why-it-stays-cheap).

---

## Documentation

Full technical and product documentation lives in [`docs/`](docs/README.md):

|                                        |                                                       |
| -------------------------------------- | ----------------------------------------------------- |
| [Architecture](docs/architecture.md)   | The pipeline, stage by stage, and the cost model      |
| [Database](docs/database.md)           | Schema, row-level security, and the rules behind both |
| [Admin console](docs/admin-console.md) | Analytics, users, bans, blog, AI routing, audit trail |
| [Site content](docs/site-content.md)   | Editing the marketing site without a deploy           |
| [AI providers](docs/ai-providers.md)   | Swapping DeepSeek for another provider                |
| [Security](docs/security.md)           | Trust boundaries, secrets, and what is enforced where |
| [Development](docs/development.md)     | Running it locally, testing, CI                       |
| [Deployment](docs/deployment.md)       | Shipping to Cloudflare Workers                        |
| [Project status](docs/status.md)       | **What is real and what is not — read this first**    |
| [Product brief](docs/product-brief.md) | The original brief this was built from                |

---

## Status

nyuz is **in development and not yet accepting customers.** The marketing site, accounts,
admin console and blog are real and working. Source collection and clustering now run
against real feeds — there are 1017 stored articles, grouped into events by a real model
call — but scoring, matching and delivery are not built, so the dashboard still shows
clearly-labelled sample stories.

[`docs/status.md`](docs/status.md) is an honest, itemised account of exactly what works
today and what doesn't. It's worth reading before forming an opinion about either.

---

## Licence

**This is not open source.** nyuz is proprietary software, all rights reserved. The
repository is visible for reference only — you may not use, copy, modify, deploy, or sell
it, in whole or in part. See [`LICENSE`](LICENSE) for the full terms, and
[`docs/development.md`](docs/development.md) if you are working on it with permission.

<div align="center">
<sub>Less information. More relevance. Zero searching.</sub>
</div>
