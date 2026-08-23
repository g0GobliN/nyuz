# Project status

Last reviewed: 22 August 2026.

nyuz is **in development and not accepting customers.** This page is the honest,
itemised version of that sentence.

It exists because the app looks considerably more finished than it is. The marketing
site, the accounts, the admin console and the blog are genuinely working software. The
thing the product is actually for — a briefing assembled from real reporting — is not
built. Anyone forming a judgement from the screenshots alone will be wrong in one
direction or the other.

---

## Summary

| Area                                                   | State                                          |
| ------------------------------------------------------ | ---------------------------------------------- |
| Marketing site (landing, pricing, how-it-works, legal) | **Built**                                      |
| Editable site content + feature flags                  | **Built**                                      |
| Accounts, sign-in, OAuth                               | **Built**                                      |
| Admin console (analytics, users, bans, roles, audit)   | **Built**                                      |
| Blog (authoring + public pages)                        | **Built**                                      |
| AI provider routing configuration                      | **Built** (config only — nothing calls it yet) |
| Onboarding flow                                        | **Built**, writes to browser storage only      |
| Customer dashboard                                     | **Prototype** — renders labelled sample data   |
| Ingestion pipeline                                     | **Not started**                                |
| Clustering, scoring, matching                          | **Designed, not built**                        |
| Digest generation and delivery                         | **Designed, not built**                        |
| Billing                                                | **Not started**                                |

---

## What is genuinely working

**Accounts.** Supabase auth, email/password plus Google and GitHub. Signing up creates a
profile, a subscription row, notification preferences and a role row via a database
trigger.

**The admin console** at `/admin`. Real queries against real tables: user list with
search and filtering, role management, bans enforced through the Supabase Admin API,
blog authoring, feature flags, editable site content, an append-only audit log, and
analytics that count rows in Postgres rather than estimating. See
[admin-console.md](admin-console.md).

**The marketing site.** Landing, pricing, how-it-works and eight legal pages. The
headline, hero copy, prices, section order, section visibility and image slots are all
editable from the console without a deploy — see [site-content.md](site-content.md).

**The blog.** Markdown authoring in the console, scheduled publishing that goes live
without a job running, public index and post pages, view counting.

**AI provider configuration.** Which provider and model serves each of the three
capability tiers is a database row, not code. Adding a provider is a row plus a secret.
Nothing calls it yet, because there is no pipeline to call it. See
[ai-providers.md](ai-providers.md).

---

## What is a prototype

**The customer dashboard.** Every story on every dashboard page comes from
`src/lib/sample-data.ts` — six fixtures. There is no ingestion, so `events`, `articles`
and `digests` are empty and will stay empty.

Two things were done so that this is not misleading:

1. **A "Sample data" notice** on the dashboard and briefing pages, saying plainly that
   collection is not running and nothing was gathered for the reader. Grep
   `SampleDataNotice` — it is meant to be deleted when the pipeline lands.

2. **The fixtures are matched against the reader's real topics** by
   `src/lib/matching.ts`. Previously all six stories were shown to everyone with a
   hard-coded caption claiming what the reader followed, so someone who onboarded asking
   for singing was told "You follow chips and AI infrastructure". Now a reader whose
   interests match nothing sees an honest empty state.

That second point is worth being precise about: it makes the _relationship_ between
stated interests and displayed stories honest. It does not make the stories real.

**Onboarding.** Collects topics, exclusions, schedule and channels, and writes them to
`localStorage` under `nyuz.prefs.v2`. Nothing is persisted to the account yet, so
preferences do not survive a different browser.

**The Pipeline page** at `/dashboard/admin`. Queue depths and funnel volumes are fixture
figures from a local set. The business metrics on its economics tab are deliberately left
empty rather than filled with plausible numbers.

---

## What is not built

**The pipeline, entirely.** Nothing in the codebase writes to `events`, `articles`,
`user_events`, `digests`, `digest_items` or `deliveries`. There are no cron triggers, no
queue consumers, no fetchers. The DeepSeek client exists and is configured; nothing calls
it to cluster or summarise anything.

The stages, in the order they need building:

1. **Collect** — fetch feeds on a schedule, record failures, back off dead sources.
2. **Normalise** — canonicalise URLs, hash, drop exact duplicates.
3. **Cluster** — trigram shortlist in Postgres, then one model call to confirm.
4. **Understand** — one analysis pass per event; importance, novelty, before/after.
5. **Match** — deterministic SQL against topics, keywords, exclusions and density.
6. **Generate and deliver** — one paragraph per person per story, then send.

Stages 1 and 2 need no model calls and would put real rows in the database quickly, which
is why they are the sensible starting point.

**Billing.** The pricing page and plan limits are presentation only. No payment provider
is integrated; `subscriptions.plan` is never written by anything but the default.

**Delivery.** No email, Telegram or WhatsApp integration exists. The `deliveries` table
and its retry semantics are designed and unused.

---

## Known gaps and rough edges

**Coverage does not match the interest picker.** `TOPIC_POOL` offers fifteen topics and
all fifteen are technology, but onboarding accepts any free-text topic. So the interface
implies coverage the product does not have. Either narrow onboarding to state that
coverage is technology, or broaden sourcing when the pipeline exists. This is a product
decision, not a bug to fix in code.

**Onboarding preferences are browser-local.** They should be written to
`user_topics`, `user_exclusions` and `notification_preferences` on the account once the
person signs up. The tables exist; the write does not.

**Legal documents are unreviewed drafts.** `src/routes/legal/$doc.tsx` contains eight
policies with an `ENTITY` constant holding four placeholders. They describe what the
system genuinely does, which is the part a template cannot supply, but they have not been
seen by a lawyer.

**The licence has placeholders too.** `LICENSE` names `[Company legal name]`. A
copyright notice naming nobody is hard to enforce.

**`react-refresh/only-export-components` warnings.** Nineteen of them, all in files that
export both a component and a helper. They affect hot-reload granularity in development
and nothing else. Left alone deliberately; splitting those files to satisfy the rule
would scatter closely-related code for no runtime benefit.

---

## Checks that must stay green

CI runs all four on every push and pull request — see
[development.md](development.md#continuous-integration).

```
npm run typecheck   # tsc --noEmit, with noUncheckedIndexedAccess on
npm run lint        # eslint, currently 0 errors / 19 warnings
npm run test        # vitest, 34 tests
npm run build       # vite + nitro, Cloudflare Workers target
```
