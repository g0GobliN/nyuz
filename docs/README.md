# nyuz documentation

Everything about how nyuz is built, why it is built that way, and what state it is
actually in.

These pages are written to be read by someone who did not build this. Where a decision
looks odd, the page says why it was made — the reasoning is usually the useful part, and
it is the part that gets lost.

---

## Start here

**[Project status](status.md)** — what is real and what is a prototype. Read this before
anything else; several pages below describe systems that are fully built, and one
describes a dashboard that is not.

---

## The product

| Page                              | What it covers                                                  |
| --------------------------------- | --------------------------------------------------------------- |
| [Product brief](product-brief.md) | The original brief, preserved verbatim                          |
| [Architecture](architecture.md)   | The pipeline stage by stage, and the cost argument              |
| [Glossary](glossary.md)           | Event, digest, density, importance, novelty — defined precisely |

## The system

| Page                              | What it covers                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------- |
| [Database](database.md)           | Tables, enums, row-level security, and the reasoning behind the policies        |
| [Admin console](admin-console.md) | Analytics, user management, bans, blog, feature flags, audit log                |
| [Site content](site-content.md)   | How marketing copy is edited without a deploy, and what deliberately cannot be  |
| [AI providers](ai-providers.md)   | Model routing, swapping provider, and why keys are not in the database          |
| [Security](security.md)           | Trust boundaries, secrets handling, what is enforced in the database vs the app |

## Working on it

| Page                            | What it covers                                                        |
| ------------------------------- | --------------------------------------------------------------------- |
| [Development](development.md)   | Local setup, scripts, tests, conventions                              |
| [Deployment](deployment.md)     | Cloudflare Workers, migrations, secrets                               |
| [Contributing](contributing.md) | Branching, commits, review, and the licence position on contributions |

---

## Conventions used in these docs

Three things are called out consistently, because mixing them up is how a reader ends up
believing something untrue about the system:

> **Built** — exists, works, has been exercised.

> **Designed, not built** — the schema and the interfaces exist, the behaviour does not.

> **Not started** — named here so its absence is deliberate rather than an oversight.

Where a number appears in the product UI, these docs say whether it is measured or
illustrative. Nothing in nyuz should display a plausible-looking figure that nobody
computed, and where that rule was hard to hold, the page explains how it was held.
