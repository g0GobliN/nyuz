You are continuing work on the nyuz repository after the current AI accounting, prompt/evidence, topic, retry and runtime improvements have been committed, merged and deployed.

This is a staged production optimization task.

Do NOT jump directly to E5, LLMLingua, batching, model replacement or architecture rewrites.

At every stage:

1. measure the current production behavior
2. identify the dominant cost
3. make the smallest safe improvement
4. validate factual quality
5. report before/after
6. proceed to the next stage only if the previous stage did not make the economics acceptable

Story Ask remains disabled and out of scope.

Freshness and demand architecture must not be changed unless measurements prove they are themselves causing unnecessary paid analysis.

The overall objective is:

**Make nyuz economically sustainable under realistic usage while preserving factual quality, source attribution, citations, conflicts, freshness and product usefulness.**

Do not optimize for an arbitrary $5 target.

We expect a realistic product funnel where many registered users are inactive/free and perhaps around 5–15% become paying users.

Global event overlap may be low, approximately 1–10%, because different users can follow different topics and sources.

---

# PHASE 0 — POST-DEPLOYMENT VERIFICATION

First verify that the application code now running in production is actually the new version.

Do NOT perform expensive benchmarking yet.

Run only enough pipeline activity to prove deployment.

Verify fresh AI ledger rows now contain:

* operation
* request group
* attempt number
* provider
* route/model
* response model
* event IDs
* article IDs where relevant
* source count
* evidence characters
* complete request estimate
* output ceiling
* observed input tokens
* completion tokens
* reasoning tokens
* cached input tokens
* cost/reservation
* settled cost
* latency
* prompt version/hash
* invocation reason
* retry/repair reason
* settled/unresolved state

Confirm:

* hidden SDK retries remain disabled
* one normal provider request = one accounted attempt
* JSON repair creates its own reservation
* failed settlement does not erase observed usage
* unresolved charges remain unresolved rather than becoming zero-cost
* `ai.cluster_thinking=false` is active in production
* new rows no longer have the old empty `request_meta` signature

If another deployment/process is still producing old-style rows against the same database, identify it separately.

Do not change production behavior just to clean those rows up.

### Stop condition

If new production traffic is NOT running the new application code, stop here and fix deployment before continuing.

---

# PHASE 1 — REAL PIPELINE FUNNEL

Run/observe fresh production-like pipeline activity:

ingest
→ cluster
→ classify
→ analyse
→ match
→ digest

Measure daily/fresh-run counts:

## Ingest

* feeds/sources fetched
* articles examined
* new articles inserted
* duplicates skipped

## Cluster

* candidates evaluated
* deterministic decisions
* paid AI decisions
* successes
* failures
* input tokens
* output tokens
* reasoning tokens
* cost

## Classify

* candidate events
* classified
* rejected/skipped

## Analyse

* attempted
* successful
* failed
* thin/full
* model used
* thinking mode
* input tokens
* completion tokens
* reasoning tokens
* cached input
* USD

## Match

* analysed events considered
* events matching at least one reader
* new `user_events`
* existing matches
* no-match events

## Digest

* eligible slots
* events eligible for digest
* generated digests
* sent digests
* skipped digests and reasons

Calculate these metrics:

### Analyse-to-match ratio

matched analysed events / analysed events

### Analysis amplification

analysed events / unique delivered events

### Delivery yield

unique delivered events / analysed events

### AI cost per analysed event

total active pipeline AI spend / analysed events

### AI cost per matched event

total active pipeline AI spend / events matching a reader

### AI cost per delivered event

total active pipeline AI spend / unique delivered events

These are primary business metrics.

Do not treat API request count alone as meaningful.

---

# PHASE 2 — INVESTIGATE ANALYSED-BUT-UNMATCHED EVENTS

Previous observations suggested only about 31% of analysed events matched a reader.

Do not immediately change demand/freshness logic.

Take a representative sample of analysed events that did NOT match any reader and classify why.

Possible categories:

* correctly analysed because there was real source/topic demand but final matching failed
* broad topic candidate that was legitimately rejected later
* source-demand event not actually relevant to a reader
* topic contamination
* stale event
* duplicate/near duplicate
* event initially relevant but superseded
* custom-source side effect
* classifier false positive
* matching threshold issue
* expected exploration/coverage behavior
* another systemic cause

For each category report:

* count
* percentage
* AI cost consumed
* whether analysis was unavoidable
* whether cheaper deterministic rejection could have happened before paid analysis

Do NOT simply move matching before analysis if matching requires analysis fields.

Find what information is actually necessary for matching.

If a deterministic pre-analysis signal can safely eliminate obvious non-matches, implement only that specific improvement.

Never remove minority/important stories merely because they are less likely to match.

### Stop condition

If analysed→matched efficiency is already acceptable and wasted analysis represents a small fraction of cost, do not over-optimize this stage.

Proceed to reasoning optimization.

---

# PHASE 3 — ANALYSE REASONING COST

This is currently the highest measured cost opportunity.

Historical/local measurements showed that reasoning can represent over 90% of analyse completion usage.

Do NOT simply set:

`AI_THINKING_ANALYSE=disabled`

globally.

First create a strong evaluation set using the **real shipped production prompt and contract**.

Use representative fixtures/events covering:

1. routine technology announcement
2. software/product release
3. product pricing change
4. corporate/business announcement
5. financial results
6. politics
7. legal/regulatory event
8. Japanese-language evidence
9. multilingual event
10. conflicting sources
11. corrected/updated reporting
12. event with subtle qualifiers
13. event with multiple dates/numbers
14. primary-source + secondary-source disagreement
15. story with multiple legitimate topics

For each fixture define:

* mandatory facts
* mandatory numbers
* mandatory dates
* required qualifiers
* expected source attribution
* known conflicts
* claims that MUST NOT appear
* expected canonical topics where relevant

A valid JSON response is NOT enough.

Mark as failure if it contains:

* unsupported claims
* strengthened qualifiers
* incorrect dates
* wrong numeric attribution
* citation mapped to the wrong source
* dropped conflict
* fabricated interpretation
* missing critical qualification

Compare:

### Route A

Current production route:
Pro + current thinking behavior

### Route B

Pro + thinking disabled

### Route C

Flash + thinking disabled

Only test Flash thinking-enabled if it adds useful information after A/B/C.

Measure per route:

* factual pass rate
* citation pass rate
* qualifier pass rate
* conflict preservation
* structured contract completeness
* input tokens
* completion tokens
* reasoning tokens
* latency
* USD/event
* truncation rate
* repair rate

Use a controlled benchmark budget.

Do not run unnecessary combinations.

---

# PHASE 4 — INTRODUCE ROUTING ONLY IF QUALITY SUPPORTS IT

If the evaluation shows that routine stories can safely use a cheaper/non-thinking route, implement selective routing.

Desired architecture conceptually:

routine event
→ cheap synthesis route
→ strict validation
→ success → persist

complex/conflicting event
→ Pro/thinking

cheap result fails validation
→ escalate to Pro/thinking

Possible complexity signals may include:

* conflicting numeric claims
* multiple materially different sources
* legal/regulatory language
* corrections
* significant qualifiers
* ambiguous entity identity
* financial disclosures
* high evidence diversity
* explicit contradiction
* low-confidence deterministic extraction

Do NOT use arbitrary complexity scoring merely to save money.

Prefer conservative escalation.

Report:

* percentage routed cheaply
* percentage escalated
* escalation reasons
* cheap-route pass rate
* total cost/event
* total cost reduction
* factual quality comparison

The goal is:

**pay for reasoning only where reasoning materially helps.**

---

# PHASE 5 — OUTPUT CEILING TUNING

Once attempt-level telemetry has accumulated enough production samples, calculate per-operation output distributions.

For each operation:

* P50
* P75
* P90
* P95
* P99
* truncation frequency
* repair frequency

Separate:

* cluster
* analyse thin
* analyse rich/full
* enrichment
* impact
* translation

Do not combine all operations.

Reduce ceilings only where measured distributions support it.

Do NOT arbitrarily replace 4096/8192 ceilings with 500.

Retain controlled exceptions for genuinely rich events.

Cost metric:

**billed tokens per successfully validated output**

not merely requested maxTokens.

---

# PHASE 6 — BATCHING EXPERIMENT

Only after reasoning/model routing is measured, test whether event batching provides additional savings.

Compare:

* 1 event/request
* 2 events/request
* 4 events/request

Do not test giant batches initially.

Use independent event IDs and strict response boundaries.

Requirements:

* citations remain scoped to correct event
* one bad event does not corrupt another
* validation occurs independently
* failure can be attributed per event
* partial retry is possible where practical
* cost allocation can be calculated per event
* idempotency remains correct

Measure:

* total billed tokens
* billed tokens / successfully validated event
* latency/event
* malformed response rate
* citation error rate
* repair rate
* retry cost
* USD/event

Keep batching only if:

**total cost per successfully validated event improves without measurable quality loss.**

Do not keep it merely because API request count decreases.

---

# PHASE 7 — TEST E5 / TRANSFORMERS.JS

Only reach this stage if input/evidence size remains a meaningful part of cost after reasoning optimization.

Do NOT integrate directly into production.

Benchmark first.

Potential stack:

* `@huggingface/transformers`
* a small multilingual E5 model with clear permissive commercial licensing

Potential uses:

* semantic near-duplicate evidence detection
* sentence relevance ranking
* source novelty ranking
* duplicate event detection

Before adding anything verify:

* exact library version
* exact model
* exact license
* commercial SaaS compatibility
* attribution/notice requirement
* Cloudflare Worker compatibility
* bundle size
* memory
* CPU time
* latency
* cold-start impact

Compare:

current deterministic evidence selection

vs

current + E5

Use representative multilingual nyuz events.

Measure:

* selected evidence tokens
* AI request input tokens
* preserved critical facts
* preserved conflicts
* citation correctness
* Worker cost/runtime impact
* AI USD saved

Keep E5 only if the total system benefit is meaningful.

If it saves a few hundred tokens but substantially increases Worker CPU, memory, latency or complexity, reject it.

---

# PHASE 8 — TEST LLMLINGUA

Only if significant input cost remains after evidence selection/E5.

Do not assume LLMLingua automatically improves news workloads.

Benchmark a commercially compatible model/version.

Test conservative compression ratios first.

Evaluate:

* names
* dates
* numbers
* percentages
* currencies
* quotes
* negation
* attribution
* qualifiers
* conflicts
* multilingual/Japanese evidence

Compare:

original evidence
vs
LLMLingua-compressed evidence

then run the same production analyse task.

Measure:

* input token reduction
* output quality
* citation correctness
* unsupported claims
* latency
* CPU/RAM
* total cost/event

If compression damages factual precision, reject it.

If it gives substantial input savings with no meaningful factual regression and acceptable runtime impact, integrate behind a feature flag first.

---

# PHASE 9 — READABILITY

Do NOT add Mozilla Readability to the current feed ingestion path just because it is free.

The current architecture uses short RSS/feed excerpts rather than full article HTML.

Readability only becomes relevant if nyuz later introduces:

* full article fetching
* HTML source ingestion
* custom-source crawling
* publisher pages requiring main-content extraction

If such a path exists by the time this phase is reached, evaluate Readability specifically for that path.

Otherwise skip it.

---

# PHASE 10 — COMPRESSION APIs

Default decision: avoid.

Only consider an external compression API if all of the following are true:

* local/deterministic methods are insufficient
* provider cost saving exceeds compression API cost by a significant margin
* additional latency is acceptable
* provider privacy/data-processing terms are acceptable
* factual quality is preserved
* dependency risk is acceptable

Do NOT add a compression API simply because it reduces tokens.

A second paid model/API before the main AI is usually economically counterproductive for nyuz.

---

# PHASE 11 — GPU INFRASTRUCTURE

Default decision: do not use.

Only revisit self-hosted GPU inference when nyuz AI API spend is large enough that:

monthly hosted API cost

>

GPU infrastructure + operations + maintenance + engineering overhead

for a sustained period.

At current/beta scale, GPU infrastructure is almost certainly economically backwards.

Do not introduce it to save tens of dollars/month.

---

# PHASE 12 — REALISTIC BUSINESS ECONOMICS

Do NOT model:

100 registered users = 100 paying users.

Use a funnel.

Create scenarios such as:

### Conservative

100 registered
20 MAU
5 paid

### Central

100 registered
40 MAU
10 paid

### Strong conversion

100 registered
60 MAU
15 paid

Use actual observed plan distribution once available.

Model separately:

* inactive/casual users
* active Uno users
* Plura users
* Omni users

Use actual plan caps from the repository.

Model usage at:

* 25%
* 50%
* 100%

Model event reuse at:

* 1%
* 5%
* 10%
* 25%

Calculate:

* subscription revenue
* AI cost
* AI cost / revenue
* AI cost / MAU
* AI cost / paid user
* AI cost / analysed event
* AI cost / matched event
* AI cost / delivered event
* total tokens
* reasoning share
* provider/model share

Do not pretend free users cost zero.

Do not pretend every paid user maxes their plan.

Do not assume everybody follows the same topics.

---

# PHASE 13 — BUDGET POLICY

After real telemetry exists, choose budget thresholds based on economics rather than an arbitrary number.

Potential KPI:

AI spend / subscription revenue

Do not hardcode final percentages without data.

Possible interpretation to investigate:

very low:
healthy

moderate:
acceptable if product quality is strong

high:
investigate routing/demand efficiency

dangerous:
restrict optional AI work before core product quality

The hard ceiling should primarily prevent:

* runaway retry loops
* provider bugs
* accidental test traffic
* configuration errors
* malicious abuse
* unexpected pricing

It should NOT routinely shut off legitimate paid-user news processing.

Keep all thresholds runtime configurable.

---

# PHASE 14 — FINAL DECISION TREE

At each step use this logic:

Current cost acceptable?
→ YES: stop optimizing and monitor.

NO
↓
Is reasoning/completion dominant?
→ YES: optimize routing/thinking.

NO
↓
Are many analysed events never matched/delivered?
→ YES: improve pre-analysis demand/relevance efficiency safely.

NO
↓
Are output ceilings wasteful?
→ YES: tune from measured distributions.

NO
↓
Can batching reduce cost per validated event?
→ TEST.

Still expensive?
↓
Is input evidence now a material cost?
→ YES: benchmark E5.

Still expensive?
↓
Benchmark LLMLingua.

Still expensive at meaningful scale?
↓
Review provider/model pricing and product economics.

Only at very large sustained API spend:
↓
evaluate GPU/self-hosting.

---

# STRICT RULES

Throughout this work:

* Story Ask remains out of scope.
* Do not weaken freshness.
* Do not weaken demand correctness.
* Do not remove important minority-source evidence just to save tokens.
* Do not silently discard conflicting claims.
* Do not treat parser-valid JSON as factual success.
* Do not blindly lower token ceilings.
* Do not install tools just because they are open source.
* Do not assume open-source means zero operational cost.
* Do not use production customer data for unnecessary benchmarking.
* Do not burn significant AI budget without reporting expected exposure first.
* Preserve existing working architecture whenever possible.

The priority hierarchy is:

1. factual correctness
2. source/citation correctness
3. reliable delivery
4. economically useful AI work
5. minimum unnecessary reasoning/tokens
6. implementation simplicity

---

# REPORT AFTER EACH PHASE

Do not disappear into multiple phases and return one giant report.

After each meaningful phase report:

### Finding

What the data showed.

### Change

What was changed, if anything.

### Before → After

Tokens, cost, quality and failures.

### Decision

Stop here or proceed.

### Next

The single highest-value next step.

If the current economics become acceptable, explicitly recommend stopping optimization rather than continuing to add complexity.

The desired end state is not “nyuz uses every optimization tool.”

The desired end state is:

**nyuz spends AI money only where it creates enough product value to justify the cost, while routine deterministic work remains cheap, shared, measurable and reliable.**
