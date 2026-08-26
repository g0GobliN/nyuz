# Localisation plan — briefings in the reader's own language

Today every reader gets English. The feeds are English, the analysis prompt is
English, the `why_it_matters` paragraph is English, the interface is English, and
`shell.ts` hardcodes `lang="en" dir="ltr"`. For a product that intends to sell
outside one market that is the largest single limit on who can use it.

This page is the plan for removing that limit, and an honest estimate of what each
part costs. It follows the conventions in [`README.md`](README.md): **Built**,
**Designed, not built**, **Not started**. Everything below is Not started.

> **The headline number.** Getting the _briefing itself_ into a reader's language,
> with a per-story toggle back to English, is about **a week and a half**. Getting
> the whole product there — interface, marketing site, blog, and local sources per
> country — is about **six to nine weeks**. Those two things get conflated
> constantly, and they are not the same feature.

---

## The estimate

| Phase | What it delivers                                      | Focused days | Ships something on its own?      |
| ----- | ----------------------------------------------------- | ------------ | -------------------------------- |
| 0     | Two columns, three decisions, and a purge job         | 1.5          | Yes — the purge job stands alone |
| 1     | The briefing arrives written in the reader's language | 4–6          | **Yes**                          |
| 1b    | Per-story toggle between their language and English   | 2–3          | Yes — rides on phase 1           |
| 2     | The app, marketing site and blog in that language     | 8–12         | Yes                              |
| 3     | Local sources per country, not just English ones      | 10–14        | Yes                              |
| 4     | One event recognised across languages                 | 8–10         | Yes                              |

"Focused days" means one person, working on this and not on four other things.
Multiply by whatever your real week looks like.

**Phase 1 is the one that matters.** It converts the product from unusable to usable
for a Japanese or Spanish or Arabic reader. Phases 2–4 make it feel native rather
than translated. If only one phase ever ships, ship phase 1 and stop.

**Phase 1b is small and worth attaching to it.** The translation cache phase 1 builds
means both language versions of a story already exist as rows; showing a toggle is a
read, not a new call. It is also the answer to the credibility problem that follows
every translated news product — see below.

---

## Why this splits into two different features

There are two things "Japanese users get Japanese" can mean, and they cost an order
of magnitude apart.

**World news, written in Japanese.** The pipeline already understands each event
exactly once for everybody ([`analyse.ts`](../src/lib/pipeline/analyse.ts)) and then
writes one paragraph per reader in [`digest.ts`](../src/lib/pipeline/digest.ts). That
per-reader call already happens on every briefing. Telling it which language to write
in is a prompt parameter. This is phases 0–2.

**Japanese news, from Japanese sources.** This means new feeds, and new feeds break
things that currently work. It is phases 3–4, and it is where the real engineering is.

Do not start with the second one because it sounds more impressive. A Tokyo reader
who gets world coverage in fluent Japanese is a customer. A Tokyo reader who gets
Nikkei headlines in English is not.

---

## Phase 0 — decisions and two columns

**0.5 days.** Cheap now, painful later.

- [ ] `sources.language` and `sources.country` columns, added in the next migration
      you write anyway. Nothing reads them until phase 3. The 64 live feeds get
      backfilled to `en` in the same statement.
- [ ] Decide the language tag format and write it down: BCP-47 (`ja`, `pt-BR`,
      `es-419`). Region-flavoured tags matter more than they look — Brazilian and
      European Portuguese are not interchangeable to a reader, and a schema that
      only stores `pt` cannot express the difference later.
- [ ] **Enforce retention with a purge job** (~1 day). Not a localisation task, but
      it belongs here — see [The thing this turned up](#the-thing-this-turned-up).
      Writing it before `digest_item_translations` exists saves rewriting it after.
- [x] **Launch set decided — six languages.** See the table below.

**Already fine, no work needed:** `public.topics` carries `slug` _and_ `label`
separately, so the vocabulary is already keyed by a stable identifier. The
localisation of topic names is a display-layer change, not a data migration. This
was the expensive mistake available here and the schema already avoids it.

### The launch set

| Language | Tag       | Script     | Note                                    |
| -------- | --------- | ---------- | --------------------------------------- |
| English  | `en`      | Latin      | Canonical. What analysis is written in. |
| Hindi    | `hi`      | Devanagari | Natively verifiable in-house            |
| Nepali   | `ne`      | Devanagari | Natively verifiable in-house            |
| Japanese | `ja`      | Kanji/kana |                                         |
| Korean   | `ko`      | Hangul     |                                         |
| Chinese  | `zh-Hans` | Simplified | "Chinese" is not one tag — see below    |

**"Chinese" needs deciding before the first row is written.** `zh-Hans` and `zh-Hant`
are not interchangeable to a reader, and a schema storing bare `zh` cannot express the
difference later. `zh-Hans` is the larger market and the recommendation; if Taiwan and
Hong Kong matter, they are a second tag, not a variant of the first.

**Verify before building, not after.** Generate twenty real briefing paragraphs per
language and read them. Hindi, Japanese, Korean and Simplified Chinese are well served
by current models. Nepali is genuinely low-resource and the quality gap is likely
real — check it on its own terms rather than assuming it behaves like Hindi because
they share a script. Hindi and Nepali are the two that can be checked in-house, which
is why the first release is scoped to them plus English.

**Everything except English is non-Latin**, so the UTF-8 and token inflation under
[What it costs](#what-it-costs) is this product's normal case, not an edge case. No
RTL language is in the set, so phase 2 avoids about two days of `dir="rtl"` work —
adding Arabic later is a real cost, not a dropdown entry.

---

## Phase 1 — the briefing in the reader's language

**4–6 days.** Delivers: a reader picks Japanese, and every briefing, breaking alert,
push and Telegram message arrives in Japanese. Sources stay English.

| Task                                                                                                 | Days |
| ---------------------------------------------------------------------------------------------------- | ---- |
| Migration: `notification_preferences.language text not null default 'en'`                            | 0.25 |
| `Prefs.language`, `DEFAULT_PREFS`, and the round trip in `preferences-map.ts` with its test          | 0.5  |
| Language picker — onboarding step, `dashboard/settings`, `dashboard/delivery`                        | 0.5  |
| `event_translations` table, filled lazily at digest time (see costs)                                 | 1.5  |
| `digest.ts` — language into the prompt and the contract; read translated event text                  | 1.0  |
| `email/templates.ts`, `email/shell.ts`, `telegram/format.ts`, `push/payload.ts` — strings per locale | 1.5  |
| Dates, times and numbers through `Intl` with the reader's locale                                     | 0.5  |

### The one decision inside phase 1 that has a wrong answer

Do **not** translate the event on the fly inside each reader's digest call. Ten
Japanese readers on the same story would pay for the same translation ten times, and
the entire cost argument in [`architecture.md`](architecture.md) rests on an event
being understood once.

Translate **once per event per language**, cached:

```
event_translations (event_id, language, title, what_happened,
                    before_state, after_state, tokens, created_at)
primary key (event_id, language)
```

Cost then scales with `events × languages`, not with readers. At today's volume —
98 events a day — five languages is roughly 490 extra calls per day regardless of
whether you have ten readers or ten thousand. That is the property worth protecting.

The per-reader `why_it_matters` call stays per-reader and simply writes in the target
language. It costs nothing extra because it already happens.

### Three things that break quietly in another language

Found while costing this. None of them error; all of them degrade.

**Ask has an English-shaped guard, and it fails open.** `askStory` compares the
model's reply against `ASK_REFUSAL` with `===` and `startsWith` — an exact English
sentinel. A model refusing in Hindi or Japanese produces a refusal that never
matches, so the off-topic guard passes it through as a normal answer. Worse,
[`ask-scope.ts`](../src/lib/ask-scope.ts) detects coding requests with regexes built
on English keywords and `\b` word boundaries; Japanese has no word boundaries and
Hindi has none of those keywords, so the scope check does not fire at all. A reader
who asks in another language has an unguarded reasoning model. That is a plan limit
being bypassed, not just a rough edge. Ask also needs the target language in its
prompt so an answer comes back in the language the story was read in.

**Telegram truncation still works, but drops more.** `TELEGRAM_MAX = 4096` is
compared against `text.length`, which matches how Telegram counts, so the guard is
correct. But Devanagari spells the same content in more code points — combining vowel
signs are separate characters — so a briefing that fits in English can lose its last
stories in Hindi, silently, at `format.ts:73`. Worth checking against a real briefing
rather than assuming.

**Push has no size guard at all.** `storyPush` builds title, body and url with no
length cap anywhere, and web push payloads are limited to about 4 KB after
encryption. `why_it_matters` at ~400 bytes of English is ~1,200 bytes of Hindi. It
probably still fits; nothing in the code says so, and a failed push is invisible to
the reader. Add the cap while the paragraph is small enough that the cap never fires.

### Style is not translation

A Japanese briefing is not an English briefing with Japanese words. Register,
sentence length, how directly you are allowed to state a conclusion — these differ,
and a reader notices immediately. So the per-language instruction belongs in
`ai_prompts` where the console can edit it, not hardcoded in `DEFAULT_PROMPT`. That
way a native speaker tunes a locale without a deploy, which is the only mechanism
that actually fixes tone.

---

## Phase 1b — reading a story in either language

**2–3 days, on top of phase 1.** Delivers: a reader on the dashboard sees a story in
Hindi, clicks once, and reads the same story in English. The interface stays in
whatever language they chose — this control is about the article, not the site.

| Task                                                                           | Days |
| ------------------------------------------------------------------------------ | ---- |
| Toggle on the story page and in the briefing list; language carried in the URL | 1.0  |
| Lazy translation of `why_it_matters` on first click, cached                    | 1.0  |
| "Read in English" link in the email and Telegram briefing                      | 0.5  |

### Why this is nearly free

Phase 1 already writes `event_translations` keyed by `(event_id, language)`, because
the cost argument demanded it. Both versions of the shared story text therefore
already exist by the time anyone can click anything. The toggle selects a row.

One piece is not free. `digest_items.why_it_matters` is, as its own schema comment
says, "the only per-user generated text" — one paragraph, generated once, in one
language. Generating it in both languages for everybody would double the only
per-reader spend in the product, to serve a button most readers will never press.

So translate it **lazily, on first click, cached**:

```
digest_item_translations (digest_id, event_id, language, why_it_matters)
primary key (digest_id, event_id, language)
```

A reader who never toggles costs nothing. One who toggles a story costs one small
call, once, ever. This is the same argument as phase 1's cache, applied one level
down.

### Two switchers is a design problem, not a feature

The instinct to keep site language and article language separate is right — a reader
who wants a Hindi interface and English source text is a real person, and forcing
those to move together serves nobody. But two bare language chips sitting next to
each other in a header is how you get people flipping the wrong one and concluding
the product is broken.

So: **label the controls by what they do, not by which language they are.**

- Site language belongs in settings and the footer. It is set rarely — usually once.
- Article language belongs on the story itself, beside the text, written as an action
  in the target language: `Read in English` on a Hindi story, `हिंदी में पढ़ें` on an
  English one. A single button that names the destination, not a pair of codes the
  reader has to decode.

Never render them adjacent.

### The language has to live in the URL

If the story page can render in two languages, `/dashboard/story/$id` needs to carry
which one — a `?lang=` search param at minimum. Otherwise a reader shares the English
version of a story and the recipient opens it in Hindi, which is a confusing bug that
looks like the toggle failed.

### Delivered briefings cannot toggle

Email, Telegram and push are sent once and cannot change afterwards. So the toggle is
a web feature, and the delivered briefing needs the other half of it: send in the
reader's chosen language, and carry a link back to the story page in the other one.
That link is worth building well — it is a reason to open the app.

### The part that is worth more than it looks

A translated news product has a credibility problem. When a reader half-doubts a
translated sentence about something that matters to them — a policy change, a figure,
a quote — there is currently nothing they can do but distrust it. One click to the
English text is the whole answer, and it costs a button.

That is a stronger argument for this feature than convenience is, and it is worth
saying so in the interface copy rather than treating the toggle as a settings detail.

---

## What it costs

Short answer: **single-digit cents per reader per month, and it does not justify a
price rise.** The arithmetic below says why, and is written so it can be checked.

Following the convention in [`README.md`](README.md), every figure is marked
**measured** or **modelled**. Nothing here is a plausible-looking number nobody
computed.

### The baseline, measured

| Line item        | Cost                    | Scales with         |
| ---------------- | ----------------------- | ------------------- |
| Clustering       | ~610 tokens per article | articles            |
| Analysis         | ~1,857 tokens per event | events              |
| `why_it_matters` | ~491 tokens per item    | **readers × items** |

Sources: `events.analysis_tokens` holds 181,980 across 98 rows; the first live digest
run was 16 items for 7,858 tokens. The third row is the only one that grows with
subscribers, which is the entire point of [`architecture.md`](architecture.md).

### What localisation adds, modelled

**Shared event translation.** Translating one event's `title`, `what_happened`,
`before_state` and `after_state` reads a few hundred tokens of finished analysis and
writes the same content back. Two things inflate it: the routed models are reasoning
models, so completion tokens include hidden reasoning before any visible output; and
non-Latin scripts tokenise far worse than English — Japanese roughly 1.5–2× for
equivalent content, Devanagari more. Modelled at **~1,500 tokens per event per
language**, so roughly 80% of what analysing that event cost in the first place.

**Per-reader text.** `why_it_matters` does not become an extra call — it is the same
call, writing in a different language. It costs more only through script inflation:
~491 tokens becomes maybe 700–900 for Hindi. **Modelled at +40–70% on one line item.**

**The toggle (phase 1b).** ~600 tokens per story actually toggled, once ever, cached.
At a 10% toggle rate that is under 1,000 tokens per reader per day.

### Fill the translation cache lazily

Most events never reach a reader in a given language — 29 of 98 analysed events
matched the one live reader, and a briefing carried 16 items. Translating all 98
events into all six launch languages would pay for coverage nobody opens.

So `event_translations` is filled **on demand, when an event first enters a digest for
a reader of that language**, not eagerly after analysis. The row is still shared by
every subsequent reader in that language, so nothing is paid twice.

This has the right shape at both ends. With ten Hindi readers, only the handful of
events they actually see get translated. With ten thousand, nearly every event does —
but by then the readership is paying for it. Cost tracks how much a language is used,
not how many languages exist.

The trade is latency: a translation call lands inside the digest path, which already
batches eight at a time. Worth measuring before assuming it is fine.

### Why this does not move the price

At any scale where pricing matters, the per-reader line dominates everything else.
Take 1,000 readers, 16 stories a day, 100 events a day, five languages beyond
English:

| Per month                          | Tokens (modelled) |
| ---------------------------------- | ----------------- |
| `why_it_matters`, English today    | ~336M             |
| Script inflation from localisation | ~+100M            |
| **All shared event translation**   | **~8M**           |

The feature people think is expensive — translating the news — is under 2% of the
bill. It is a fixed cost divided by everyone in that language, and it shrinks per
reader as the market grows. The part that actually costs something is the per-reader
paragraph, and that cost exists today in English.

Against $7.00 a month, the added cost of serving a reader in Hindi rather than English
is cents. **Do not raise prices for it, and do not gate language behind a tier.**
Charging more to read in Hindi is pricing by nationality; it would be noticed, and it
would be right to notice.

### The pricing question that is actually real

The pressure runs the other way. $7.00 a month is a different proposition in Delhi,
São Paulo or Jakarta than in San Francisco, and those are precisely the markets this
work opens. The question worth putting on the table is not "charge more for
translation" but **"can this sell at $7.00 in these markets at all, or does it need
purchasing-power pricing?"**

That is a Stripe configuration and a revenue decision, not an engineering one, and it
is out of scope here. But it should be decided before phase 2 spends two weeks
localising a pricing page — the number on that page may be the thing that needs to
change, not just the language around it.

### The storage bill

Tokens are not the whole infra cost, and storage behaves differently: tokens are
spent once, rows are paid for every month forever. Localisation makes this worse in a
specific way, and looking at it turned up something bigger than localisation.

**Articles are cheap and always will be.** `articles` stores a feed's own excerpt,
clamped to 500 characters by `EXCERPT_LIMIT`, and never the article body — ingest
does not fetch article pages at all. With four indexes including the trigram GIN on
`title`, a row costs roughly **1.6 KB all-in** (modelled; heap plus indexes). The
1,040 rows on the live database are under 2 MB. Even phase 3 multiplying the feed
count fivefold for local markets lands around **100 MB a year**. This is not the
problem, and the 30-day ingest window keeps it from becoming one.

**The per-reader tables are the real bill**, exactly as with tokens:

| Table          | Rows per reader per day    | Modelled per reader per year |
| -------------- | -------------------------- | ---------------------------- |
| `user_events`  | ~30 matched events         | ~1.9 MB                      |
| `digest_items` | ~16, each with a paragraph | ~3.2 MB                      |
| `digests`      | 1                          | negligible                   |

About **5 MB per reader per year**, in English, today.

**What localisation adds is UTF-8, and it is the same mechanism as the token
inflation.** Devanagari and CJK cost three bytes per character where ASCII costs one.
A `why_it_matters` paragraph of ~400 bytes in English is ~1,200 in Hindi. So the
largest per-reader table roughly triples, and total per-reader storage goes from ~5 MB
to **~10 MB per reader per year** for a non-Latin-script reader. Add
`event_translations` (shared, lazily filled, ~210 MB a year for five languages) and
`digest_item_translations` (only what gets toggled, under 1 MB per reader per year).

Byte inflation, token inflation and egress inflation are one phenomenon with one
cause. Fixing nothing about it is fine; being surprised by it three times is not.

### The thing this turned up

**Retention is not enforced anywhere. It is a query filter.**

[`briefing.ts:296`](../src/lib/server/briefing.ts#L296) computes `since` from
`PLAN_LIMITS[plan].retentionDays` and filters the SELECT. Nothing in the codebase
deletes an article, an event, a digest or a digest item — there is no purge job at
all. So a Free reader sees seven days of history while the database keeps every row
they have ever generated, forever, and the product pays rent on data nobody is
permitted to read.

Today that is invisible: the whole database is a couple of megabytes. It is invisible
because there is one reader. At 1,000 readers it is 5 GB in the first year and
another 5 GB every year after, growing without bound — and localisation roughly
doubles that rate for non-Latin markets.

**Purging on `retentionDays` turns an unbounded liability into a fixed steady state:**

| Plan     | Retention | Steady state per reader (Latin / non-Latin) |
| -------- | --------- | ------------------------------------------- |
| Free     | 7 days    | ~0.1 MB / ~0.2 MB                           |
| Personal | 90 days   | ~1.2 MB / ~2.5 MB                           |
| Pro      | 365 days  | ~5 MB / ~10 MB                              |

That is a few gigabytes at a thousand readers and it stops growing, which fits inside
a Supabase Pro plan's included database rather than accruing per-gigabyte overage on
history no one can open.

This is a pre-existing gap, not something localisation causes. But localisation
doubles its rate, so it belongs in the same conversation. **Roughly a day of work**,
and it should land before phase 1 rather than after, because a purge job written
against `digest_items` alone is a purge job that has to be rewritten once
`digest_item_translations` exists.

Two details worth getting right: purge by the reader's plan at purge time, not at
write time, so a downgrade does not silently destroy history someone might restore by
re-upgrading — and keep `events` and `articles` out of it. They are shared, they are
cheap, and deleting an event out from under a digest item breaks a foreign key.

### So does infra change the pricing answer?

No. At 1,000 readers, storage is single-digit gigabytes and single-digit dollars a
month against $7,000 of revenue — and with retention purging it stops compounding
entirely. The compounding worry is real in principle and small in this product,
because the excerpt clamp and the ingest window were already the right decisions.

The thing to fix is the missing purge, not the price.

---

## Phase 2 — the app, the site and the blog

**8–12 days.** Mostly grunt work, low risk, hard to shortcut.

| Task                                                                               | Days |
| ---------------------------------------------------------------------------------- | ---- |
| Pick and wire the i18n runtime                                                     | 0.5  |
| Extract strings from ~96 `.tsx` files                                              | 5–7  |
| `site_settings` marketing copy — per-locale, plus a locale switcher in the console | 2.0  |
| Blog — `blog_posts.language`, a `translation_of` grouping, localised routes        | 2.0  |
| Locale routing, `Accept-Language` detection, `hreflang` for SEO                    | 1.5  |

Three notes.

**Prefer a small in-house dictionary over `react-i18next`.** This app is SSR on
Cloudflare Workers with a deliberately lean bundle; a full i18n framework brings a
loader, a plugin system and an interpolation language you will use one percent of.
A typed `Record<Locale, Record<Key, string>>` with a `t()` helper covers this product
and typechecks the keys, which the framework does not.

**Marketing copy lives in the database.** [`site-content.ts`](../src/lib/site-content.ts)
validates a jsonb blob in `site_settings` so copy can change without a deploy. That
system is per-site today and has to become per-locale. It is the fiddliest part of
phase 2 because the zod schemas, the defaults and the console form all assume one
copy of everything.

**The blog is where the SEO argument gets won.** Localised blog posts with correct
`hreflang` are how a Japanese reader finds this product at all. Worth doing properly
rather than machine-translating and hoping.

---

## Phase 3 — local sources

**10–14 days.** This is the phase that is bigger than it looks, and the reason is
specific.

| Task                                                                             | Days                  |
| -------------------------------------------------------------------------------- | --------------------- |
| Source language/country in the admin console; curate and verify feeds per market | 1.0 + ~0.5 per market |
| Per-language tokenisation in `shortlist.ts`                                      | 3.0                   |
| Cluster within a language; analysis prompt in the article's language             | 1.5                   |
| Reader region/source preference, and the filter at match time                    | 1.5                   |
| Ingest hardening — charset, encoding, non-Gregorian and localised dates          | 1.0                   |
| Tests per tokenisation path                                                      | 1.5                   |

### `shortlist.ts` is the thing that breaks

[`shortlist.ts`](../src/lib/pipeline/shortlist.ts) is what makes stage 3 affordable:
it pulls the most distinctive words out of a headline and turns them into `ilike`
patterns against `articles_title_trgm_idx`. It does that by splitting on whitespace
and dropping an English stopword list.

Japanese has no whitespace. Chinese has no whitespace. A Japanese headline yields
zero usable tokens, which the module handles gracefully — it issues no query and the
article becomes an event of its own. That is correct behaviour for a version tag. For
a national news market it means **clustering silently stops working**: every article
its own event, no deduplication, and the analysis bill multiplies while the briefing
quality drops. Nothing errors. Nothing alerts. It just quietly gets worse.

So this needs a per-language token strategy — character bigrams for CJK, stopword
lists per language, and the existing path for space-delimited languages. Three days
is for building it and proving it on real headlines, not for the idea.

---

## Phase 4 — one event, many languages

**8–10 days, plus ongoing tuning.** Reuters and Nikkei covering the same event should
be one event, not two.

This is the genuinely valuable part and the genuinely hard part. Trigram matching
cannot connect an English headline to a Japanese one — there are no shared
characters. The realistic options are an embedding column (`pgvector`, a real
dependency and a real per-article cost) or a language-independent key built from what
survives translation: dates, figures, tickers, and organisation names that stay in
Latin script.

Then a policy question with no obvious answer: when a merged event has coverage in
three languages, which text is canonical, and does a reader see their own market's
framing or the merged one?

**Do not attempt this in the same release as phase 3.** Within-language clustering
is a complete, shippable product. Cross-language merging is a research problem
wearing a ticket.

---

## Risks and what makes these numbers wrong

**Migrations are a manual step here.** DDL cannot be applied from the development
machine — see [`plan.md`](plan.md). This plan adds at least five migrations, and each
is a hand-applied step against the live database that must be verified afterwards.
Budget the coordination, not just the SQL.

**Model quality is not uniform across languages.** The routed model writes English
well. Whether it writes Hindi or Arabic at the standard a paying reader expects is an
empirical question, and the answer decides the launch set. Spend an afternoon before
phase 0 generating twenty real briefing paragraphs per candidate language and having
someone who speaks it read them. That afternoon can save six weeks aimed at a market
the model cannot serve.

**RTL is not a cost here, and that is deliberate.** Arabic and Hebrew would need
`dir="rtl"` throughout, and [`shell.ts:240`](../src/lib/email/shell.ts#L240) hardcodes
`dir="ltr"` in the email shell where CSS logical properties do not help — about two
extra days. Neither is in the launch set, so phase 2's estimate holds. Adding one
later is a real cost, not a new row in a dropdown.

**Every language in the launch set except English is non-Latin.** The UTF-8 and
tokenisation inflation described under [What it costs](#what-it-costs) is therefore
the normal case for this product, not an edge case affecting some readers. Budget for
it as the default.

**Three of the six break `shortlist.ts` in phase 3.** Japanese, Korean and Chinese are
free in phase 1, where sources stay English and only the output is translated. The
moment phase 3 adds local CJK sources, the per-language tokenisation work is
unavoidable rather than optional. That is an argument for phases 1–2 standing alone as
a release, not for dropping those languages.

**No engineering substitutes for a native reader.** One speaker per language reading
a full week of real briefings will find things no test can. That review is part of
shipping a locale, not a nice-to-have after it.

---

## The recommendation

Ship phases 1 and 1b together, to two languages, as one release. A week and a half,
most of the user-visible win, and it answers the question that actually matters —
whether people in that market want this — before you spend five more weeks on the
pipeline. 1b rides on 1's schema rather than adding one, so splitting them buys
nothing and costs a second round of migrations.

Do phase 0's two columns now regardless, because they are free today.
