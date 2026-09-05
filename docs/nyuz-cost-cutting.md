You are acting as a principal/staff-level systems engineer with 20+ years of experience designing production SaaS systems, distributed pipelines, AI-assisted products, and cost-efficient infrastructure.

You have full access to the Nyuz repository.

We already completed the investigation into why Nyuz is consuming too much AI budget. Do NOT repeat the same high-level audit unless you discover that an assumption below is wrong.

The goal now is to IMPLEMENT the safest, highest-impact cost optimizations in the real Nyuz pipeline.

# PRIMARY GOAL

Nyuz is currently in testing / early-launch stage.

I want to support roughly the first 100 users while spending only around:

$10–20/month TOTAL on AI/infrastructure where realistically possible.

Later, when Nyuz earns revenue, I should be able to scale mainly by upgrading providers/plans such as Cloudflare, Supabase, AI providers, etc., rather than redesigning the whole architecture again.

Therefore optimize for:

1. Extremely low AI cost
2. No meaningful reduction in news quality
3. Deterministic programming wherever programming can do the job reliably
4. AI only where semantic synthesis/reasoning genuinely adds value
5. Shared work across users
6. Strong caching and reuse
7. Easy future scaling
8. No fragile hacks
9. No major unnecessary rewrite

# IMPORTANT EXISTING FINDINGS

From the previous repository audit, these systems already exist:

* `extract.ts`

  * deterministic fact extraction
  * money
  * percentages
  * dates
  * CVEs
  * CVSS
  * versions
  * counts
  * companies
  * countries
  * products
  * tickers
  * layoffs
  * regulatory actions
  * etc.

* `topic-assign.ts`

  * deterministic topic/tag assignment
  * currently/shadow-mode validation

* `evidence-selection.ts`

  * evidence/article selection
  * can reduce redundant coverage
  * currently/shadow-mode

* `compareExtraction()`

* `compareTopics()`

* `compareTags()`

The major architectural problem identified was:

Nyuz already computes many facts deterministically, but still asks AI to compute the same information again.

AI is currently doing BOTH:

structured extraction + creative synthesis.

That is wasteful.

# TARGET ARCHITECTURE

Move Nyuz toward this pipeline:

Raw articles
↓
deterministic preprocessing
↓
fact extraction
↓
duplicate/redundancy detection
↓
evidence selection
↓
deterministic topic/tag/scoring
↓
AI receives only the minimum high-value evidence
↓
AI performs synthesis only
↓
results cached/reused globally
↓
per-user personalization happens as cheaply as possible

AI should be the last resort for semantic synthesis, not the default tool for every operation.

---

# TASK 1 — PROMOTE EVIDENCE SELECTION INTO PRODUCTION

Currently analysis may send up to ~12 articles even when many contain the same information.

Inspect `evidence-selection.ts` and all related call sites.

Promote the existing selection logic into the actual analysis pipeline where safe.

Goal:

Instead of blindly sending 12 articles:

1. examine all available articles using deterministic logic
2. identify which articles introduce unique facts/evidence
3. remove redundant reporting
4. preserve source diversity
5. prefer higher-quality / more informative reporting
6. normally send only around 3–4 representative sources to AI

Do NOT blindly enforce 3 articles if an important event genuinely needs more evidence.

The selector should optimize for:

* unique facts
* outlet diversity
* primary/authoritative sources where available
* contradictory reporting
* materially different perspectives
* recency
* useful context

Do not send 10 articles saying essentially the same thing.

Keep the full list of source references in Nyuz for transparency even if the AI only reads a subset.

---

# TASK 2 — MOVE STRUCTURED FACT EXTRACTION OUT OF AI

Inspect the current `analyse.ts`, `contract()`, prompts, response schema, and downstream dependencies.

Anything that can already be produced reliably by deterministic code should stop being requested from the AI.

Candidate fields include:

* numbers
* dates
* entities
* companies
* countries
* products
* CVEs
* versions
* percentages
* counts
* layoffs
* regulatory actions
* obvious timeline information
* deterministic topic/tag information

Use `extractFacts()` and existing infrastructure.

Do NOT remove a field merely because deterministic extraction technically exists.

First verify:

* extraction quality
* downstream expectations
* null behavior
* edge cases
* conflicts across sources
* schema compatibility

Where deterministic extraction is not sufficiently trustworthy, retain an AI fallback.

Target philosophy:

CODE FIRST
AI FALLBACK

not:

AI FIRST
CODE SHADOW MODE

---

# TASK 3 — PROMOTE DETERMINISTIC TOPICS + TAGS

Inspect:

`topic-assign.ts`
`assignTopics()`
`assignTags()`
`compareTopics()`
`compareTags()`

If shadow-mode results show acceptable quality, move topic/tag assignment into production.

Remove topics/tags from AI output where safe.

Do not just delete AI classification without checking historical agreement.

If some ambiguous stories genuinely require semantic classification, design an inexpensive fallback.

For example:

deterministic confident result
→ accept

deterministic low-confidence result
→ AI fallback

Avoid AI classification for obvious cases.

---

# TASK 4 — BE CAREFUL WITH IMPORTANCE + NOVELTY

The previous proposal suggested deterministic scoring.

I agree with the direction but DO NOT simply use a naive formula and assume it is correct.

For example:

many sources != automatically important

A huge breaking story may initially have only one authoritative source.

Design deterministic scoring using multiple signals such as:

* source count
* source quality
* core vs demand source
* outlet diversity
* primary source detection
* recency
* event type
* user/topic demand
* historical novelty
* whether this is a material change from the previous known state
* duplicate/rewrite ratio
* unusual high-signal entities/actions

Importance and novelty should be cheap, but they must not bury genuinely important breaking stories.

Use confidence ranges / guardrails where useful.

If deterministic confidence is low, allow escalation.

Do not optimize cost at the expense of Nyuz missing major news.

---

# TASK 5 — SPLIT ANALYSIS INTO DETERMINISTIC + AI SYNTHESIS

Refactor the logical analysis pipeline into two conceptual stages.

## Stage A — deterministic/free

Produce as much as reliably possible:

* extracted facts
* entities
* numbers
* dates
* topics
* tags
* basic scores
* evidence selection
* source diversity
* known historical comparison
* obvious before/after information
* other mechanical fields

## Stage B — AI synthesis

The AI should primarily produce fields requiring human-like understanding, such as:

* `whatHappened`
* concise one-sentence summary
* nuanced impact
* perspectives
* genuinely unresolved unknowns
* contextual explanation
* what may happen next
* what to watch

Review every field in the existing analysis JSON contract.

For EACH field ask:

"Could normal programming generate this reliably?"

If yes:
remove it from AI.

If no:
keep it in synthesis.

Shrink both the system prompt and output contract accordingly.

---

# TASK 6 — REDUCE ANALYSIS INPUT

AI should not receive the entire event/database object.

Build the smallest useful synthesis payload.

Prefer something similar to:

* event identity
* deterministic extracted facts
* selected 3–4 source excerpts
* disagreements/conflicts
* minimal historical context
* only fields necessary for synthesis

Do NOT pass huge redundant JSON structures.

Measure actual input token reduction.

---

# TASK 7 — REDUCE ANALYSIS OUTPUT

Review current:

`max_tokens`
reasoning configuration
JSON response size
unused fields
verbose instructions

If analysis currently allows around 4096 output tokens but typical useful output can fit around ~1k–2k, reduce the limit safely.

Do not arbitrarily set 2048 without checking worst-case valid outputs.

We want enough headroom to avoid truncation while eliminating waste.

Also investigate whether reasoning effort/model configuration can be lowered for simple events.

---

# TASK 8 — TWO-TIER EVENT ANALYSIS

Not every event deserves expensive deep analysis.

Create an analysis-depth strategy.

Example concept:

## LOW / ROUTINE EVENT

For minor events:

* title
* what happened
* topics/tags
* basic facts
* minimal Understand content

Use deterministic processing + cheaper/smaller AI synthesis if AI is needed at all.

## IMPORTANT EVENT

For meaningful events:

* richer synthesis
* context
* perspectives
* unknowns
* what-next
* deeper Understand content

## CRITICAL / COMPLEX EVENT

For major or conflicting stories:

* allow more evidence
* stronger model/deeper reasoning if necessary

Do NOT hardcode this blindly around one `importance >= 4` threshold.

Design it around the actual Nyuz scoring and event model.

The important principle is:

simple news should be cheap;
complex news earns expensive reasoning.

---

# TASK 9 — WHY-IT-MATTERS / IMPACT

Inspect current `digest.ts` and the `impact`/`why_it_matters` AI calls.

Determine how many separate AI calls are being made solely for short 1–2 sentence impact text.

Try to eliminate unnecessary independent calls.

Prefer, in this order:

1. reuse event-level synthesis already generated
2. deterministic generation where quality is acceptable
3. cheap fallback model
4. expensive AI only when genuinely necessary

Do NOT make Nyuz sound robotic with generic templates such as:

"Because X happened, this matters to Y."

If templates are used, make them sufficiently rich and conditional.

Start conservatively.

Quality matters because `why_it_matters` is user-facing.

---

# TASK 10 — TRANSLATION

Inspect `translate.ts`.

Translation should be:

* on demand where possible
* cached globally where possible
* reused for every user requesting the same event + language
* supplied only the text that actually requires translation

Do not repeatedly translate the same event for different users.

Check database uniqueness/caching, ideally equivalent to:

`event_id + language`

Do not send large irrelevant objects to the translation model.

Shorten translation system prompts while maintaining quality.

---

# TASK 11 — STORY ASK COST SAFETY

Previous audit could not clearly trace Story Ask's actual AI call site.

Find it.

Audit the entire Story Ask request path.

It MUST have:

* authentication
* plan entitlement check
* per-user rate limiting
* global safety cap
* bounded context
* bounded output tokens
* AI usage ledger
* cost attribution
* reasonable abuse protection

One user must NOT be able to burn the monthly Nyuz AI budget by repeatedly asking questions.

Also verify failures/timeouts/retries cannot accidentally multiply AI calls.

---

# TASK 12 — CLUSTER AI REDUCTION

Inspect the clustering pipeline.

Current behavior reportedly uses an AI call when a shortlist exists.

Add deterministic handling for obvious duplicate cases where safe.

Potential deterministic signals:

* normalized headline
* same named entities
* same company/product
* exact key facts
* date proximity
* highly similar excerpts
* SimHash / Jaccard
* same announcement/action
* source relation

AI should mainly resolve ambiguous cluster membership.

Do NOT weaken clustering accuracy merely to remove calls.

False merges are worse than spending a tiny amount of AI.

---

# TASK 13 — GLOBAL REUSE ACROSS USERS

This is extremely important.

Nyuz should NOT analyse the same world event separately for every user.

Confirm:

collection
→ clustering
→ event analysis
→ Understand generation
→ translation where appropriate

are shared globally whenever the content itself is identical.

Per-user work should ideally be limited to things that are actually personal, such as:

* matching
* ranking
* delivery
* explicit Story Ask
* genuinely personalized explanation

If 100 users follow AI and the same Nvidia story appears:

Nyuz should ideally analyse the Nvidia event ONCE,
not 100 times.

Trace the DB and pipeline and prove this behavior.

Fix duplicate AI work if you find any.

---

# TASK 14 — CACHE / IDEMPOTENCY / RETRY AUDIT

AI cost can also leak through retries.

Audit:

* job retries
* worker crashes
* queue retries
* timeout retries
* duplicate cron execution
* concurrency races
* failed DB writes after successful AI responses
* repeated regeneration
* translation duplication
* analysis regeneration

Every expensive AI operation should be as idempotent as reasonably possible.

Prefer patterns like:

claim job
→ check existing result
→ perform AI once
→ persist result
→ mark complete

Ensure two workers cannot both spend money analysing the same event simultaneously.

---

# TASK 15 — AI USAGE LEDGER

I want to know exactly where every cent goes.

Inspect the existing AI usage ledger.

Make sure we can see at least:

* timestamp
* feature
* provider
* model
* event/user where applicable
* input tokens
* output tokens
* reasoning tokens if exposed
* cached tokens if exposed
* estimated cost
* success/failure
* latency
* retry count

Feature names should clearly distinguish things such as:

* clustering
* event analysis
* impact
* translation
* Story Ask
* alerts
* any other AI function

Do not log private article/user content unnecessarily.

---

# TASK 16 — COST GUARDS

Add reasonable cost protection.

I want configuration for things such as:

* per-user daily AI ceiling
* per-plan limits
* Story Ask limits
* global daily/monthly emergency budget
* per-feature guardrails
* max output tokens
* concurrency
* retries

Important:

The global guard must fail gracefully.

If an AI budget is reached, Nyuz should still continue:

* ingestion
* deterministic extraction
* clustering where possible
* browsing existing analysed stories
* scheduled system work that doesn't require AI

It should not completely break the application.

---

# TASK 17 — MODEL ROUTING

After reducing AI workload, review model routing.

Do NOT automatically move everything to the cheapest model.

Use the cheapest model that meets the quality requirement.

Potential routing philosophy:

deterministic
→ no model

simple ambiguity
→ cheap/fast model

normal synthesis
→ capable mid-tier model

rare complex/critical event
→ strongest model

Story Ask
→ based on plan + complexity + limits

The architecture must make provider/model changes easy through configuration.

I do NOT want to redesign Nyuz when changing DeepSeek → Groq → Cloudflare → another provider later.

---

# TASK 18 — OBSERVABILITY BEFORE/AFTER

Before modifying behavior, establish the current baseline from the AI ledger/logs if possible.

Then after the implementation compare:

* AI calls/event
* input tokens/event
* output tokens/event
* reasoning tokens/event
* cost/event
* clustering cost
* analysis cost
* translation cost
* Story Ask cost
* total cost/day
* total AI calls/day

I want hard numbers.

The previous estimate suggested 60–75% token reduction.

Do NOT claim that result unless measurements support it.

---

# TASK 19 — QUALITY VALIDATION

Cost savings mean nothing if Nyuz quality drops badly.

Use existing shadow comparison infrastructure wherever possible.

Compare old vs new for a representative sample:

* simple news
* breaking news
* multi-source event
* one-source event
* conflicting reports
* acquisition
* security vulnerability
* product release
* regulatory news
* funding
* geopolitical story
* minor routine update

Check:

* factual accuracy
* missing facts
* false extraction
* topic accuracy
* tag accuracy
* importance accuracy
* clustering accuracy
* quality of `whatHappened`
* Understand quality
* important source coverage

If a deterministic method is materially worse, retain an AI fallback.

---

# TASK 20 — DO NOT DESTROY EXISTING FEATURES

Before editing, trace downstream consumers.

Nyuz currently has features such as:

* Briefings
* Read
* Understand
* Alerts
* Scoring
* Topics
* custom topics
* translations
* Story Ask
* source attribution
* plan limits
* user preferences

Do not remove fields that the frontend or other pipeline stages expect without migrating their consumers.

Maintain backward compatibility where reasonable.

Do not leave partially dead architecture behind.

---

# IMPLEMENTATION APPROACH

Do NOT make one huge blind rewrite.

Implement this carefully in stages.

Recommended order:

1. baseline current usage
2. evidence selection
3. deterministic topics/tags
4. deterministic fact extraction in production
5. shrink AI analysis contract
6. shrink evidence payload
7. reduce output limits
8. tiered analysis
9. remove redundant impact AI calls
10. translation optimization
11. clustering optimization
12. Story Ask guards
13. idempotency/retry protection
14. global/per-user cost guards
15. validate quality
16. measure cost again

You can adjust this order if repository dependencies require it.

---

# TESTING

For every change:

* run existing tests
* add missing unit tests
* add integration tests where necessary
* test failure cases
* test null/missing values
* test single-source events
* test multi-source events
* test highly duplicated coverage
* test contradictory sources
* test retries
* test concurrent workers
* test AI provider failure
* test budget guard behavior

Do not leave tests skipped merely to make the suite green.

---

# IMPORTANT ECONOMIC TARGET

Our goal is NOT to prove an arbitrary estimate.

Our goal is to make Nyuz genuinely cheap enough for an early solo-founder launch.

Approximately:

first ~100 users
→ ideally ~$10–20/month operating AI spend during testing/light usage

If that exact number is not realistic, tell me based on measured usage.

Do not fake economics.

Calculate expected costs from actual pipeline behavior after the optimization.

Also tell me approximately:

* cost per event
* cost per active free user/month
* cost per active paid user/month
* cost for 100 users
* cost for 1,000 users
* biggest remaining cost driver

Separate:

AI cost
database
Cloudflare/hosting
email
third-party services
other infrastructure

---

# FUTURE SCALABILITY REQUIREMENT

Design this so if Nyuz grows, scaling mostly means:

upgrade provider plan
increase worker capacity
increase DB capacity
increase queue capacity
increase AI budget

NOT:

rewrite the application.

Do not over-engineer for 1 million users today, but do not introduce architecture that obviously prevents scaling.

---

# FINAL OUTPUT I WANT FROM YOU

After implementation, give me a detailed report:

## 1. What you changed

File-by-file.

## 2. Why

Explain the architectural reasoning.

## 3. AI calls before vs after

Show exact pipeline differences.

## 4. Token usage before vs after

Use measured values where available.

## 5. Estimated monthly cost

For:

* 1 active user
* 10 users
* 100 users
* 1,000 users

Do not assume costs scale perfectly linearly because global event analysis should be shared.

## 6. Quality impact

What became deterministic?

What still uses AI?

Where do fallbacks exist?

## 7. Remaining risks

Especially cases where optimization could miss important news or reduce synthesis quality.

## 8. Remaining expensive paths

Rank them from most expensive to least expensive.

## 9. Tests

Tell me exactly what was tested and results.

## 10. Launch verdict

Tell me whether the architecture is now safe enough to launch Nyuz to the first ~100 users without unexpectedly burning AI budget.

Be critical.

If something is still dangerous, say so.

---

# NON-NEGOTIABLE PRINCIPLE

Do not make Nyuz worse just to make it cheap.

The ideal architecture is:

**programming handles predictable work,
AI handles intelligence,
and the same intelligence is reused as many times as possible.**

Start by tracing the exact current production call graph and usage ledger, then implement the changes rather than giving me another theoretical optimization report.
