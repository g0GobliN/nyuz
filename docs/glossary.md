# Glossary

Terms used precisely throughout nyuz. Several are ordinary words with a specific meaning
here, and mixing them up is how a design conversation goes wrong.

---

**Article**
One item fetched from one source. Thirty outlets covering one announcement produce thirty
articles. Stored in `articles`; a row exists per genuinely distinct URL after
canonicalisation and hashing.

**Event**
One real-world thing that happened, with every article that reported it attached. **The
unit of meaning in nyuz**, and the unit that is understood by a model exactly once. Stored
in `events`.

The article → event collapse is the product. Thirty articles, one event, one analysis.

**Content hash**
`sha` of the canonicalised URL plus the title. An exact collision is a republish of
something already seen, not a new article. The cheap first-pass duplicate guard, before any
similarity work.

**Clustering**
Deciding which articles describe the same event. A trigram index shortlists candidates in
Postgres; only the shortlist reaches a model.

**Importance** — 0 to 10
How much this event matters in general, to anybody. Set once, by the shared analysis pass.
Compared against a reader's density threshold at match time.

**Novelty** — 0 to 10
How much this is genuinely new versus a restatement of something already known. Distinct
from importance: a widely-covered non-development scores high importance and low novelty.

**Relevance**
How much this event matters **to one specific reader**. Computed per person by SQL from
topics, keywords, source preferences and weights. Never set by a model. Stored in
`user_events`.

Importance is global; relevance is personal. The three-number split — relevance,
importance, novelty — is why a major story you do not care about can rank below a minor one
you do.

**Density** — 0 to 100
The reader's volume dial, from "only if genuinely major" to "tell me everything". Drives the
importance threshold at digest time.

Density and topics do different jobs: **topics decide what is eligible, density decides how
high the bar is.** Twenty topics at high density gives a shorter briefing than three at low.

**Exclusion**
A term that removes an event regardless of any topic that would have selected it.
**Exclusions are applied last and win** — a product promise, not an implementation detail.

**Digest**
One briefing for one reader for one scheduled slot. Stored in `digests`.

**A digest with zero items and status `skipped` is a success**, not a failure. A quiet day
is a real outcome and the schema has a state for it.

**Why it matters**
The one short paragraph generated per person per story, explaining what this changes given
what that reader follows. `digest_items.why_it_matters`.

**The only per-user generated text in the system.** Everything else in a briefing was
written once, upstream.

**Delivery**
One attempt to send one digest on one channel, with retry. `deliveries`. Separate from the
digest because a digest can succeed while its email bounces.

**Breaking alert**
An out-of-schedule send for an event clearing a much higher importance bar. Governed by the
reader's `breaking` setting: important / everything / off.

---

## Roles

**User** — an ordinary subscriber. The default `user_roles.role`.

**Admin** — reaches the console: analytics, users, bans, blog, site content, audit.

**Superadmin** — additionally changes roles, edits AI provider configuration and prompts,
and deletes users. The distinction is deliberate: those actions change the system for
everyone at once, or hand somebody else the console.

---

## Infrastructure

**Anon key** — public by design, compiled into every visitor's bundle. RLS is what protects
the data behind it.

**Service-role key** — bypasses RLS entirely, reads and writes every row for every user.
Server-side only, forever.

**RLS** — Row-level security. Authorisation enforced in Postgres rather than in application
code, so an application bug cannot return another user's rows.

**Capability tier** — `cluster`, `digest` or `reason`. Which model serves each is a
database row.

---

## Words avoided

**"Radar"** was the original metaphor throughout the product ("Build my radar"). It was
removed in favour of the product name — the noun for what nyuz builds for you is "your
nyuz". The repository is still named `radar-report` for historical reasons.

**"Personalised" without qualification.** The matching is personalised; the story analysis
is shared. Saying the whole briefing is personalised implies per-user analysis, which is
exactly the cost model nyuz avoids.
