/**
 * Understanding an event. Once, ever.
 *
 * Stage 3 grouped thirty articles into one row in `events`. This is the pass that
 * reads that coverage and writes down what happened, what was true before, what is
 * true now, how much it matters and how new it is — and then never runs again for
 * that event.
 *
 * **That "never again" is the whole product's cost structure**, not a detail of
 * this file. Analysis is charged per event; delivery is charged per reader per
 * story and is deliberately tiny. If an event were ever analysed twice, the
 * expensive part of the system would start scaling with the volume of coverage
 * instead of with the amount of news, and the pricing would stop working. Three
 * things defend it:
 *
 *   1. `analysed_at` is the gate. Selection is `analysed_at is null`, and nothing
 *      in this module clears it. Neither does stage 3 when new coverage joins an
 *      event — that is checked by the stage 4 verification box in docs/plan.md.
 *   2. An event is **claimed** before the model is called, by moving `status` to
 *      `analysing` conditionally. Two workers cannot both pay for one event; the
 *      loser sees zero rows come back from its claim and moves on.
 *   3. An event that fails is **not retried automatically**. A permanently
 *      unanalysable event retried every half hour is an unattended bill, so the
 *      cron leaves `failed` alone and an operator asks for it by name.
 *
 * **`analysis_tokens` is a money ledger, not a success ledger.** It records what
 * was spent on an event, including a failed attempt, because its purpose is to let
 * anyone audit the cost claim. A column that only counted successful analyses
 * would make the ledger read better than the invoice.
 *
 * **Nothing here invents content.** The model is given the coverage and told that
 * absent facts are null. `before_state` is genuinely often unknowable from a press
 * release, and a plausible sentence in that column would be a fabrication printed
 * under a real headline. Topics are linked only to slugs that already exist in
 * `topics`, because a topic nobody can subscribe to is not a topic.
 *
 * **Deterministic preprocessing happens before the AI call.**
 * Facts are extracted by code, topics and tags are assigned by code, and
 * evidence is selected by code. The AI receives only the selected evidence
 * and is asked to perform synthesis only. See docs/track.md phase 7+ for
 * the shadow measurement framework that validated these replacements.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aiCapacityRetryAt,
  completeRoutedJson,
  optionalEnrichmentAllowed,
  resolvePrompt,
  type SecretBag,
} from "@/lib/ai/config";
import { TruncatedCompletionError } from "@/lib/ai/deepseek";
import type { Database, EventStatus, Json } from "@/lib/supabase/types";
import { readEventIntelligence, type EventIntelligence } from "@/lib/understand";
import { READER_ARTICLE_CONTRACT } from "@/lib/reader-article";
import { isVcsRef } from "./shortlist";
import { extractFacts, compareExtraction, type ExtractedFacts } from "./extract";
import { assignTopics, assignTags, compareTopics, compareTags } from "./topic-assign";
import {
  selectEvidence,
  deduplicateEvidence,
  computeEvidenceShadowMetrics,
  renderSelectedCoverage,
  type EvidenceArticle,
} from "./evidence-selection";
import { scoreEvent, type EventSignals } from "./scoring";
import { LIVE_LANE_DENOMINATOR, LIVE_LANE_NUMERATOR, LIVE_QUEUE_HOURS } from "./freshness";
import { loadAiRuntimeConfig } from "@/lib/ai/runtime-config";

type Db = SupabaseClient<Database>;

/**
 * Events per run, when the operator has not set one.
 *
 * Small because each one is a call to the strongest configured model. The backlog
 * is drained deliberately with `npm run pipeline -- analyse --limit N`, not by a
 * schedule that could run up a bill while nobody is watching.
 *
 * Since 0056 this is only the floor of the precedence chain: `ai.analysis_batch_size`
 * in the console wins, then `ANALYSE_BATCH_SIZE`, then this. It stays here as the
 * value `runtime-config.ts` names as the code default, so the two cannot drift.
 */
const BATCH = 8;

/**
 * Articles shown to the model per event.
 *
 * Deterministic evidence selection reduces this from 12 to the smallest
 * set that preserves all meaningful evidence. Most events need only
 * 3-4 representative sources after deduplication.
 *
 * The full article list is still read from the database and kept for
 * transparency (source attribution, conflict detection), but only the
 * selected subset reaches the model.
 */
const ARTICLES = 12;

/** After evidence selection, the maximum articles sent to the AI model. */
export const NORMAL_AI_EVIDENCE = 4;
export const ANALYSIS_PROMPT_VERSION = "5";

/** Characters of each feed excerpt kept. Enough for the substance, not the essay. */
const EXCERPT_CHARS = 400;

/** Topics linked to one event. A story about everything is a story about nothing. */
const MAX_TOPICS = 5;

/**
 * How long a claim is honoured before another run may take the event back.
 *
 * A worker that dies mid-analysis leaves `status = 'analysing'` behind with no
 * `analysed_at`, and without a reclaim that event would never be looked at again.
 * Fifteen minutes is comfortably longer than the slowest observed call and short
 * enough that a crash costs one cron cycle.
 *
 * The reclaim keys off `last_updated_at`, which stage 3 also bumps when new
 * coverage joins an event. So a stuck event that keeps attracting coverage stays
 * stuck for longer than fifteen minutes. That is an acceptable delay and not a
 * lost event; `--event <id>` overrides it.
 */
const STALE_MINUTES = 15;

/**
 * Material-enrichment refresh: the bounded exception to "analysed once, ever."
 *
 * A thin analysis (`sourceCountAtAnalysis <= 2`) is eligible for exactly one
 * re-analysis once real evidence has substantially grown past it -- at least
 * `ENRICHMENT_MIN_SOURCES` articles now attached, and at least double what the
 * document was originally generated from. `1 -> 5` is the case this exists for;
 * `7 -> 8` never qualifies, because a document already generated from enough
 * coverage to be normal or rich is not the problem this solves.
 *
 * Small and separate from the main batch on purpose: this is a rare, bounded
 * correction, not a second analysis pipeline. `ENRICHMENT_SCAN` bounds the read
 * (cheapest way to find candidates -- `last_updated_at` already moves whenever
 * stage 3 attaches new coverage, so the most recently touched analysed events
 * are exactly where a newly-eligible thin document would be), and
 * `ENRICHMENT_BATCH` bounds the spend, the same way `BATCH` does for first-time
 * analysis.
 */
const ENRICHMENT_MIN_SOURCE_COUNT_AT_ANALYSIS = 2;
const ENRICHMENT_MIN_SOURCES = 4;
const ENRICHMENT_MIN_MULTIPLE = 2;
const ENRICHMENT_SCAN = 50;
const ENRICHMENT_BATCH = 3;

/**
 * The analysis output ceiling moved to `ai.analyse_max_tokens` in 0056 and now
 * arrives on `Context.maxTokens`. Its reasoning, which is why the default is
 * 4096 and not less, is recorded on the setting in `src/lib/ai/runtime-config.ts`:
 * the ceiling must cover reasoning tokens plus the full JSON document, and
 * deepseek-v4-pro reasoning alone can exceed 2048 — below which the call returns
 * empty content and a `TruncatedCompletionError` rather than a short answer.
 */

/**
 * The thin-contract ceiling.
 *
 * Left as a literal rather than made configurable: it is not a spending knob but
 * a property of the shorter contract, which asks for strictly less JSON than the
 * full one. Tying it to the configurable ceiling would let a raised budget
 * silently buy longer thin analyses, which is not what raising a budget means.
 */
const THIN_CONTRACT_MAX_TOKENS = 4096;

/**
 * Whether a document is due its one material-enrichment refresh, given its
 * stored `analysisMeta` (as read straight off the `events.understand` column
 * -- untyped, since a legacy or malformed document may not have one at all)
 * and the event's current, live article count.
 *
 * Exported and pure so the threshold and the "never twice" rule can be tested
 * directly against every case in the spec without a database: a legacy
 * document (`meta` absent), an already-refreshed one, and every count
 * combination around the boundary.
 */
export function isEnrichmentEligible(
  meta:
    | {
        sourceCountAtAnalysis?: unknown;
        coverageCountAtAnalysis?: unknown;
        refreshedAfterEnrichment?: unknown;
      }
    | null
    | undefined,
  currentSourceCount: number,
): boolean {
  const sourceCountAtAnalysis = meta?.coverageCountAtAnalysis ?? meta?.sourceCountAtAnalysis;
  if (typeof sourceCountAtAnalysis !== "number" || !Number.isInteger(sourceCountAtAnalysis)) {
    return false;
  }
  if (meta?.refreshedAfterEnrichment === true) return false;

  return (
    sourceCountAtAnalysis <= ENRICHMENT_MIN_SOURCE_COUNT_AT_ANALYSIS &&
    currentSourceCount >= ENRICHMENT_MIN_SOURCES &&
    currentSourceCount >= sourceCountAtAnalysis * ENRICHMENT_MIN_MULTIPLE
  );
}

/**
 * Build the smallest useful synthesis payload for the AI.
 *
 * The AI receives:
 * - Event identity
 * - Deterministic extracted facts (so it doesn't re-extract them)
 * - Selected 3-4 source excerpts (not all 12)
 * - Disagreements/conflicts between sources
 * - Minimal historical context
 * - Only fields necessary for synthesis
 *
 * This replaces the old `renderCoverage` which sent all 12 articles
 * and forced the AI to re-extract facts it could compute deterministically.
 */
export function renderAnalysisPayload(
  eventTitle: string,
  selectedEvidence: string,
  codeFacts: ReturnType<typeof extractFacts>,
  selection: {
    selectedIndices: number[];
    totalUniqueFacts: number;
    totalFactsFull: number;
    conflictsPreserved: number;
  },
  dedup: { totalFactsBefore: number; totalFactsAfter: number; factsRemoved: number },
  outlets: Map<string, string>,
): string {
  const lines: string[] = [];

  lines.push(`Event: ${eventTitle}`);
  lines.push("");

  lines.push("SELECTED EVIDENCE:");
  lines.push(selectedEvidence);

  return lines.join("\n");
}

/**
 * Summarize deterministic facts into a compact string for the AI.
 */
function summarizeFacts(facts: ReturnType<typeof extractFacts>): string | null {
  const parts: string[] = [];

  const categories: (keyof ReturnType<typeof extractFacts>)[] = [
    "money",
    "percentages",
    "dates",
    "cves",
    "cvss",
    "versions",
    "counts",
    "companies",
    "countries",
    "products",
    "tickers",
    "layoffs",
    "regulatoryActions",
  ];

  for (const cat of categories) {
    const items = facts[cat] as { value: string; label: string }[] | undefined;
    if (!items || items.length === 0) continue;
    const values = items.map((i) => i.value).join(", ");
    parts.push(`${cat}: ${values}`);
  }

  return parts.length > 0 ? parts.join(" | ") : null;
}

/**
 * The default system prompt.
 *
 * Overridable from the console — the `analysis` row in `ai_prompts` wins if it is
 * set. This constant is the fallback rather than the source of truth so that a
 * missing row means "the wording that shipped" instead of "no instructions at all",
 * which is what passing `promptKey` straight to the router would have produced.
 *
 * The JSON contract is deliberately NOT here. It is appended by `contract()` below,
 * so an operator retuning the wording cannot accidentally break the parse.
 */
export const DEFAULT_PROMPT = `You are a news analyst. You read every article about one event and write down what actually happened, for a reader who needs to know whether it changes anything for them.

Be specific and concrete. Name the thing, the number, the version, the company. Prefer "raised $300m at a $4bn valuation" over "secured significant funding".

Never state anything the coverage does not support. Where the coverage does not say what was true before, or what is true now, say null rather than filling the gap. A confident sentence about a fact nobody reported is the one failure mode of this job that cannot be detected downstream.

Write plainly. No hype, no "in a move that", no restating the headline back.`;

/**
 * The parse contract and the topic vocabulary, appended to whatever prompt is in
 * force.
 *
 * The scoring anchors are here because a model asked for 0-10 with no anchors
 * returns 7 for everything, and a scale that is always 7 cannot serve as the
 * importance threshold that `notification_preferences.density` compares against.
 *
 * So is the instruction about `what_happened` describing the event rather than the
 * coverage, which is here rather than in the editable prompt because the first real
 * run produced "An article described Wi-Fi 8 as…" — accurate, and useless in a
 * briefing. An operator who deleted that line from the console would get prose about
 * articles instead of prose about news, which is the same class of breakage as
 * deleting the JSON shape.
 */
export function contract(): string {
  return `Reply with JSON only, in exactly this shape:

{
  "title": "one neutral line naming what happened, under 100 characters",
  "what_happened": "one 50-90 word briefing paragraph containing only unique supported facts",
  "before_state": "what was true before this, or null if the coverage does not say",
  "after_state": "what is true now that was not before, or null",
  "importance": 0,
  "novelty": 0,
  "impact": "1-2 sentences on why this matters to someone who tracks this space, or null",
  "understand": {
    "coverage": "thin, normal, or rich, based on usable unique facts rather than source count",
    "one_sentence": "one compact sentence on how the important actors/actions connect and what the event fundamentally means -- not a restatement of what_happened, and not the place for a headline number that belongs in numbers",
    "numbers": [{ "value": "$13B", "label": "Deal value", "evidence": [1] }],
    "new": [{ "text": "a fact new in this announcement, only used when before_state/after_state are null", "evidence": [1] }],
    "relationships": {
      "nodes": [{ "id": "a", "label": "Nvidia", "type": "company" }, { "id": "b", "label": "Hugging Face", "type": "company" }],
      "edges": [{ "from": "a", "to": "b", "label": "acquiring for $13B", "evidence": [1] }]
    },
    "audiences": [{ "audience": "Developers", "implication": "a concrete practical consequence for this group specifically", "evidence": [2] }],
    "what_next": [{ "text": "a reported next step, not a prediction", "evidence": [2] }],
    "context": [{ "text": "supported background needed to understand the event", "evidence": [2] }],
    "perspectives": [{ "source": "The acquirer", "stance": "how this source frames it", "evidence": [1] }, { "source": "An independent researcher", "stance": "a materially different framing", "evidence": [3] }],
    "unknowns": ["The settlement amount was not disclosed"],
    "watch_next": [{ "label": "General availability", "detail": "a specific, checkable future development tied to this event", "evidence": [2] }],
    "timeline": [{ "when": "Q4", "what": "Expected closing", "evidence": [2] }],
    "conflicts": [{ "topic": "Transaction value", "reports": [{ "text": "$12B", "evidence": [1] }, { "text": "$13B", "evidence": [2] }] }],
    "comparison": { "caption": "Pricing", "left_label": "Before", "right_label": "Now", "rows": [{ "label": "Monthly", "left": "$20", "right": "$25", "evidence": [1] }] },
    "series": { "caption": "Quarterly revenue", "shape": "bar", "points": [{ "label": "Q1", "value": 26.0, "display": "$26B", "evidence": [1] }] },
    "overview": [{ "name": "Beam Ultra", "kind": "Soundbar", "detail": "$699", "evidence": [1] }],
    "article": { "deck": { "text": "short introduction", "evidence": [1] }, "paragraphs": [{ "text": "connected editorial prose", "evidence": [1], "heading": null }] }
  }
}

evidence is article numbers from the numbered list in the user message. Use only
valid numbers; a statement supported by several articles lists each of them.

understand holds internal event intelligence and a separate reader-facing article.
For the internal fields other than article, each block adds something
what_happened did not. Place
each claim in the single section it fits best; a detail in one_sentence must
not reappear in numbers, audiences, context, or anywhere else unless another
block genuinely needs it. one_sentence owns the relationship and meaning;
numbers owns the concrete figures — do not put a headline metric in
one_sentence when it belongs in numbers (the only exception is a figure so
central that removing it would make the sentence unintelligible and there is
no useful numbers entry for it).

Every understand array is optional in substance: use [] or null when the
evidence does not justify it. Never manufacture a timeline from one date,
numbers without meaningful labels, implications not grounded in the
evidence, future steps that were not reported, generic context, or a graph,
comparison, series, or overview so a block can be drawn. For thin evidence,
a one_sentence summary and one or two numbers or context items may be the
entire useful answer. Mark coverage thin and leave unsupported arrays empty.

unknowns names a specific missing fact a reader would want (a price, a date,
a scope, a named party) — "the settlement amount was not disclosed" is a real
unknown, "the source text does not specify further details" is not. If no
missing fact is worth attention, use [].

audiences names a real group and what changes for them specifically, not
"this could significantly impact the industry" or a repeat of who was
mentioned in what_happened. Grounded in listed evidence; a bounded,
clearly-scoped inference the coverage supports is allowed.

relationships, comparison, series and overview are internal structured data:
- relationships: a small graph of the entities the event turns on, only with
  a genuine structure (at least two edges or three nodes). A single
  "A acquired B" is a fact, not a map.
- comparison: two states with comparable values; omit rows whose sides match.
- series: three or more comparable numbers for a chart (value is a plain
  number, display is how to print it). Two is a comparison, one is a key
  number; never assemble a series from different measures.
- overview: two or more things announced together. One thing is a fact.

perspectives needs at least two distinct sources; never invent a dissenting
view. watch_next names a specific, checkable future development, not
"more developments may emerge". new is only used when before_state and
after_state are both null — it is the fallback for what changed when there
is no clean prior state to contrast. If credible accounts disagree over a
fact, preserve both in conflicts; if they disagree over meaning or
importance, that is perspectives.

impact is shared with every reader briefed to this event: what changes for
someone in the field generally — a constraint that shifted, a decision this
forces — not "this matters if you use X" and not a restatement of
what_happened.

what_happened is about the event, not the coverage. Name who did what
("OpenAI wrote to the governor opposing SB 1047", never "an article
reported that..."). Fewer than 50 words is correct when evidence is thin.

importance, 0 to 10 — how much this changes for someone in the field:
0-2 routine (point release, blog post, talk); 3-5 worth knowing in your area
(notable launch, funding round); 6-8 matters to the whole field (major
release, acquisition, outage with real consequences, regulatory decision);
9-10 changes plans. Most weeks contain nothing above 8.

novelty, 0 to 10 — how new: 0-2 already known or latest of many; 3-5
expected step that has now happened; 6-8 genuinely unexpected or first of
its kind from this player; 9-10 nobody was predicting this.

${READER_ARTICLE_CONTRACT}`;
}

/**
 * A reduced contract for routine events that do not need a full understand block.
 *
 * The AI is asked only for the fields that are genuinely useful for every event:
 * title, what_happened, importance, novelty. Everything else is either
 * deterministically assigned or belongs to a deeper analysis this event does not
 * need.
 */
export function thinContract(): string {
  return `Reply with JSON only, in exactly this shape:

{
  "title": "one neutral line naming what happened, under 100 characters",
  "what_happened": "one 50-90 word briefing paragraph containing only unique supported facts",
  "importance": 0,
  "novelty": 0,
  "understand": {
    "coverage": "thin",
    "one_sentence": "one compact sentence capturing the event",
    "article": { "deck": { "text": "short introduction", "evidence": [1] }, "paragraphs": [{ "text": "only the useful supported detail", "evidence": [1], "heading": null }] }
  }
}

importance, 0 to 10 — how much this changes for someone in the field:
0-2 routine (point release, blog post, talk); 3-5 worth knowing in your area
(notable launch, funding round); 6-8 matters to the whole field (major
release, acquisition, outage with real consequences, regulatory decision);
9-10 changes plans. Most weeks contain nothing above 8.

novelty, 0 to 10 — how new: 0-2 already known or latest of many; 3-5
expected step that has now happened; 6-8 genuinely unexpected or first of
its kind from this player; 9-10 nobody was predicting this.

${READER_ARTICLE_CONTRACT}`;
}

export type AnalyseOptions = {
  /** Events to process. Absent means `BATCH`. */
  limit?: number | undefined;
  /** Restrict to specific events, for verifying a known case. Ignores the claim gate. */
  eventIds?: string[] | undefined;
  /** Call the model and print the analysis, write nothing. */
  dryRun?: boolean | undefined;
  /** Include events a previous run failed on. Off by default: they cost money again. */
  retryFailed?: boolean | undefined;
  articleLimit?: number | undefined;
  /** Worker bindings. Required on Cloudflare, where there is no `process.env`. */
  secrets?: SecretBag | undefined;
  now?: Date | undefined;
};

export type EventOutcome = {
  eventId: string;
  title: string;
  decision:
    | "analysed" // written: scores, prose, topics, analysed_at
    | "skipped" // dry run
    | "claimed" // another worker got there first
    | "empty" // an event with no articles: nothing to read, no call made
    | "ignored" // a single-article CI ref: marked failed, no model call
    | "no_demand" // gate on, no source reaches an eligible reader: left pending
    | "demand_check_failed" // gate RPC/database error: no AI spend, event remains pending
    | "deferred" // temporary AI capacity; retry time is persisted
    | "failed"
    | "enriched"; // material-enrichment refresh: a thin early analysis replaced with a richer one
  articles: number;
  importance: number | null;
  novelty: number | null;
  topics: string[];
  /** Slugs the model returned that are not in `topics`. A coverage signal, not data. */
  unknownTopics: string[];
  promptTokens: number;
  completionTokens: number;
  detail: string;
};

export type AnalysisReport = {
  startedAt: string;
  finishedAt: string;
  considered: number;
  analysed: number;
  failed: number;
  skipped: number;
  claimed: number;
  ignored: number;
  noDemand: number;
  demandCheckFailed: number;
  deferred: number;
  /** Events that reached the model. The rest cost nothing. */
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  outcomes: EventOutcome[];
};

export async function analyse(db: Db, options: AnalyseOptions = {}): Promise<AnalysisReport> {
  const startedAt = (options.now ?? new Date()).toISOString();

  // Resolved once, before anything is selected: the batch size decides how much
  // this run may spend, and the ceiling decides how much each call may. Both are
  // operator settings since 0056, and both must be the same number for every
  // event in the batch — see `Context.maxTokens`.
  const runtime = await loadAiRuntimeConfig(db, options.secrets);
  const events = await selectEvents(db, options, runtime.analysisBatchSize);

  // Read once per run, not once per event: the topic vocabulary is fifteen rows
  // that change when somebody edits a migration, and the outlet names are sixty-
  // eight. Sixteen extra round trips per batch would buy nothing.
  const sourceKinds = new Map<string, string>();
  const [topics, outlets] = await Promise.all([loadTopics(db), loadOutlets(db, sourceKinds)]);
  const slugs = topics.slugs;

  const system = await promptFor(options.secrets);
  const hasDemand = await loadDemand(db, events, options);
  const outcomes: EventOutcome[] = [];

  // Sequential, unlike stage 3 where it is a correctness requirement. Here it is a
  // spending decision: one call at a time is one call's worth of money committed at
  // a time, and an operator watching the output can stop it.
  for (const event of events) {
    outcomes.push(
      await runOne(db, event, {
        options,
        topics,
        outlets,
        sourceKinds,
        slugs,
        system,
        demand: hasDemand,
        maxTokens: runtime.analyseMaxTokens,
      }),
    );
  }

  // The material-enrichment pass, run through this same scheduled invocation
  // rather than a separate stage or cron entry -- see `selectEnrichmentCandidates`.
  // Skipped for a targeted `--event` run: that path exists to verify one known
  // pending case, not to also refresh unrelated events it happens to scan past.
  //
  // Gate: enrichment_pass_enabled flag. When off (launch default), the pass
  // is skipped entirely — no model calls, no reservations, no Pro spend.
  if ((options.eventIds?.length ?? 0) === 0) {
    const { data: enrichmentFlag } = await db
      .from("feature_flags")
      .select("enabled")
      .eq("key", "enrichment_pass_enabled")
      .maybeSingle();

    if (
      enrichmentFlag?.enabled === true &&
      (await optionalEnrichmentAllowed(db, options.secrets))
    ) {
      const enrichmentCandidates = await selectEnrichmentCandidates(db, ENRICHMENT_BATCH);
      for (const event of enrichmentCandidates) {
        outcomes.push(
          await runEnrichment(db, event, {
            options,
            topics,
            outlets,
            sourceKinds,
            slugs,
            system,
            demand: hasDemand,
            maxTokens: runtime.analyseMaxTokens,
          }),
        );
      }
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    considered: events.length,
    analysed: outcomes.filter((o) => o.decision === "analysed").length,
    failed: outcomes.filter((o) => o.decision === "failed").length,
    skipped: outcomes.filter((o) => o.decision === "skipped").length,
    claimed: outcomes.filter((o) => o.decision === "claimed").length,
    ignored: outcomes.filter((o) => o.decision === "ignored").length,
    noDemand: outcomes.filter((o) => o.decision === "no_demand").length,
    demandCheckFailed: outcomes.filter((o) => o.decision === "demand_check_failed").length,
    deferred: outcomes.filter((o) => o.decision === "deferred").length,
    modelCalls: outcomes.filter((o) => o.promptTokens > 0 || o.completionTokens > 0).length,
    promptTokens: outcomes.reduce((total, o) => total + o.promptTokens, 0),
    completionTokens: outcomes.reduce((total, o) => total + o.completionTokens, 0),
    outcomes,
  };
}

/**
 * Which of this batch's events have a source that is core coverage or
 * currently reaches an eligible reader — see 0021_demand_gate.sql for what
 * "reaches" means.
 *
 * Returns a discriminated union:
 * - `inactive`: gate off or --event bypass (analysis proceeds normally)
 * - `error`: RPC/database failed (analysis must NOT proceed - fail closed)
 * - `loaded`: successful check with set of demanded event IDs
 *
 * Fails closed on RPC/database errors: if demand cannot be verified, no AI
 * tokens are spent. The event remains pending for retry once the service recovers.
 */
type DemandResult =
  | { kind: "inactive" } // flag off or --event bypass
  | { kind: "error"; message: string } // RPC/database failed
  | { kind: "loaded"; demanded: Set<string> }; // successful check

async function loadDemand(
  db: Db,
  events: Pending[],
  options: AnalyseOptions,
): Promise<DemandResult> {
  if ((options.eventIds?.length ?? 0) > 0 || events.length === 0) {
    return { kind: "inactive" };
  }

  const { data: flag } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "pre_analysis_demand_gate")
    .maybeSingle();
  if (flag?.enabled !== true) return { kind: "inactive" };

  const { data, error } = await db.rpc("events_with_demand", {
    p_event_ids: events.map((e) => e.id),
  });
  if (error) {
    console.error(`pre-analysis demand gate failed: ${error.message}`);
    return { kind: "error", message: error.message };
  }

  return {
    kind: "loaded",
    demanded: new Set((data ?? []).filter((row) => row.has_demand).map((row) => row.event_id)),
  };
}

type Pending = {
  id: string;
  title: string;
  status: EventStatus;
  analysis_tokens: number;
};

/**
 * The batch: events with no analysis, newest first.
 *
 * Newest first because a briefing is about what just happened, and because an
 * event still gathering coverage is the one a reader is about to ask about.
 *
 * `failed` is excluded unless asked for. An event that failed once will usually
 * fail again — a cluster of thirty CI notifications has nothing to analyse — and a
 * schedule that retried it every half hour would spend real money doing so.
 */
async function selectEvents(db: Db, options: AnalyseOptions, batch: number): Promise<Pending[]> {
  const ids = options.eventIds;
  const columns = "id, title, status, analysis_tokens";

  if (ids && ids.length > 0) {
    const { data, error } = await db.from("events").select(columns).in("id", ids);
    if (error) throw new Error(`selecting events: ${error.message}`);
    // Deliberately not filtered on `analysed_at`: `runOne` refuses an analysed
    // event on its own, and a `--event` that silently matched nothing would read
    // as "no work to do" rather than "that event is already understood".
    return data ?? [];
  }

  if (options.retryFailed !== true) {
    const { data: flag } = await db
      .from("feature_flags")
      .select("enabled")
      .eq("key", "pre_analysis_demand_gate")
      .maybeSingle();

    if (flag?.enabled === true) {
      // The lane parameters are passed rather than left to the SQL defaults for
      // the reason 0044's cost arguments are: a ceiling the console can show but
      // not change is worse than no ceiling, and a window TypeScript believes in
      // while the database uses another is worse than either. One set of numbers,
      // in `freshness.ts`, sent explicitly.
      const { data, error } = await db.rpc("pending_events_with_demand", {
        p_limit: options.limit ?? batch,
        p_live_hours: LIVE_QUEUE_HOURS,
        p_live_share: LIVE_LANE_NUMERATOR / LIVE_LANE_DENOMINATOR,
      });
      if (!error) return data ?? [];
      console.warn(`demand-aware event selection: ${error.message} — using legacy selector`);
    }
  }

  const states: readonly EventStatus[] =
    options.retryFailed === true ? ["pending", "failed"] : ["pending"];
  const now = (options.now ?? new Date()).toISOString();

  const { data, error } = await db
    .from("events")
    .select(columns)
    .is("analysed_at", null)
    .in("status", states)
    .or(`analysis_deferred_until.is.null,analysis_deferred_until.lte.${now}`)
    .order("first_seen_at", { ascending: false })
    .limit(options.limit ?? batch);

  if (error) throw new Error(`selecting events: ${error.message}`);
  return data ?? [];
}

/**
 * The rare, bounded exception: analysed events whose thin original analysis
 * has been overtaken by real evidence growth.
 *
 * Scoped to the most recently touched analysed events rather than scanning
 * every analysed row, because `last_updated_at` already moves whenever stage 3
 * attaches new coverage to an event (`cluster.ts`'s `attach()`) -- a document
 * that just became eligible is, almost by definition, one of these. Older
 * analysed events that have not moved recently were not enriched recently
 * either, so they are outside the window this exists to catch.
 */
async function selectEnrichmentCandidates(db: Db, limit: number): Promise<Pending[]> {
  const { data, error } = await db
    .from("events")
    .select("id, title, status, analysis_tokens, understand")
    .not("analysed_at", "is", null)
    .not("understand", "is", null)
    .order("last_updated_at", { ascending: false })
    .limit(ENRICHMENT_SCAN);

  if (error) throw new Error(`selecting enrichment candidates: ${error.message}`);

  const out: Pending[] = [];
  for (const row of data ?? []) {
    if (out.length >= limit) break;

    const meta = (
      row.understand as {
        analysisMeta?: { sourceCountAtAnalysis?: unknown; refreshedAfterEnrichment?: unknown };
      } | null
    )?.analysisMeta;

    // Cheapest check first: most rows in the scan window will not even have
    // usable metadata (a legacy document, or one already refreshed), and that
    // is decidable without a second query.
    if (typeof meta?.sourceCountAtAnalysis !== "number") continue;
    if (meta.refreshedAfterEnrichment === true) continue;

    const { count } = await db
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("event_id", row.id);

    if (isEnrichmentEligible(meta, count ?? 0)) {
      out.push({
        id: row.id,
        title: row.title,
        status: row.status,
        analysis_tokens: row.analysis_tokens,
      });
    }
  }
  return out;
}

/**
 * The classification vocabulary, and the reason it is filtered.
 *
 * Every slug returned here is embedded in the system prompt of every event
 * analysis. Readers can now create their own topics (0049), so an unfiltered
 * read of this table would put every label anybody has ever typed into every
 * prompt for ever — a prompt that grows with signups and is paid for per event.
 *
 * `kind = 'predefined'` is what keeps that bounded. Custom interests never
 * reach the model: they are matched deterministically in stage 5 against the
 * `tags` this same pass writes, which costs one extraction shared by everyone
 * rather than one judgement per reader.
 */
export type TopicVocabulary = {
  /** Slugs, exactly as the table spells them. This is what the prompt embeds. */
  slugs: string[];
  /** Topic id by lowercased slug *and* by lowercased label. See below. */
  ids: Map<string, string>;
};

/**
 * Resolvable by slug or by label, because the two callers speak different names.
 *
 * The prompt is written in slugs (`open-source`), and for as long as the model
 * chose the topics that was the only vocabulary this map needed. Since topics
 * became deterministic, the names actually handed to `writeAnalysis` come from
 * `assignTopics`, whose pool is editorial labels (`Open source`) — so a map keyed
 * on slugs alone resolved nothing at all, silently, and `event_topics` stopped
 * being written on 2026-09-02. Nothing threw: `topicIds.get("Open source")` is
 * `undefined`, the row list came out empty, and an empty upsert is a no-op. The
 * damage surfaced four stages later as readers with no matches and empty
 * briefings.
 *
 * Holding both keys is deliberate rather than transitional. "Which topic is this
 * name" is one question, and the answer should not depend on which of a topic's
 * two names the caller happens to hold. Collisions are not a concern: slugs and
 * labels are drawn from the same 28 rows, and where they coincide once
 * lowercased (`world`) they coincide on the same id.
 */
async function loadTopics(db: Db): Promise<TopicVocabulary> {
  const { data, error } = await db
    .from("topics")
    .select("id, slug, label")
    .eq("kind", "predefined");
  if (error) throw new Error(`reading topics: ${error.message}`);
  return topicVocabulary(data ?? []);
}

/**
 * The row-to-vocabulary step, exported because it is the join that broke.
 *
 * Pure, so the rule it encodes -- a topic answers to either of its names, in any
 * case -- is pinned by a test rather than by a live run nobody repeats.
 */
export function topicVocabulary(
  rows: readonly { id: string; slug: string; label: string }[],
): TopicVocabulary {
  const ids = new Map<string, string>();
  for (const topic of rows) {
    ids.set(topic.slug.toLowerCase(), topic.id);
    ids.set(topic.label.toLowerCase(), topic.id);
  }
  return { slugs: rows.map((topic) => topic.slug), ids };
}

async function loadOutlets(db: Db, kinds: Map<string, string>): Promise<Map<string, string>> {
  const { data, error } = await db.from("sources").select("id, name, kind");
  if (error) throw new Error(`reading sources: ${error.message}`);
  for (const source of data ?? []) kinds.set(source.id, source.kind);
  return new Map((data ?? []).map((s) => [s.id, s.name]));
}

/** The console's wording if set, the shipped wording otherwise. */
async function promptFor(secrets: SecretBag | undefined): Promise<string> {
  const stored =
    secrets === undefined
      ? await resolvePrompt("analysis")
      : await resolvePrompt("analysis", secrets);
  return stored.trim() === "" ? DEFAULT_PROMPT : stored;
}

type Context = {
  options: AnalyseOptions;
  topics: TopicVocabulary;
  outlets: Map<string, string>;
  sourceKinds: Map<string, string>;
  slugs: string[];
  system: string;
  /** Demand check result. See loadDemand. */
  demand: DemandResult;
  /**
   * The analysis output ceiling in force for this run, resolved once in
   * `analyse()` rather than per event. Reading it per call would make a save
   * mid-run change the ceiling between two events of the same batch, so a batch
   * could report two different ceilings for the same work.
   */
  maxTokens: number;
};

type Coverage = {
  id: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
  source_id: string | null;
};

async function runOne(db: Db, event: Pending, ctx: Context): Promise<EventOutcome> {
  const base = {
    eventId: event.id,
    title: event.title,
    articles: 0,
    importance: null,
    novelty: null,
    topics: [],
    unknownTopics: [],
    promptTokens: 0,
    completionTokens: 0,
  };

  // Handle demand check result
  if (ctx.demand.kind === "error") {
    // Demand check failed - do not spend AI tokens. Event remains pending for retry.
    return {
      ...base,
      decision: "demand_check_failed",
      detail: `demand check failed: ${ctx.demand.message}`,
    };
  }

  if (ctx.demand.kind === "loaded" && !ctx.demand.demanded.has(event.id)) {
    // Gate active, event has no demand - skip analysis
    return { ...base, decision: "no_demand", detail: "no source reaches an eligible reader" };
  }

  // Gate inactive or event has demand - proceed with analysis

  const { articles, total, error: readFailed } = await readCoverage(db, event.id, ctx.options);
  if (readFailed) return { ...base, decision: "failed", detail: readFailed };

  if (articles.length === 0) {
    // An event with no articles is orphaned data, not work. Left alone rather than
    // marked failed: nothing about it is this stage's fault, and a `failed` row
    // would hide it from the next run that could tell you why.
    return { ...base, decision: "empty", detail: "no articles attached" };
  }

  if (isUnanalysable(articles, total)) {
    if (ctx.options.dryRun !== true) {
      await recordFailure(db, event, 0, ctx.options);
    }
    return {
      ...base,
      articles: total,
      decision: "ignored",
      detail: "single-article CI ref, not a headline",
    };
  }

  const claim = await claimEvent(db, event, ctx.options);
  if (claim !== "held") {
    return { ...base, articles: total, decision: "claimed", detail: claim };
  }

  // ---- Stage A: Deterministic preprocessing (free) ----
  // Extract facts, assign topics/tags, and select evidence before
  // touching the AI model. The AI only receives the selected evidence
  // and is asked for synthesis only.

  const fullText = articles.map((a) => `${a.title}\n${a.excerpt ?? ""}`).join("\n---\n");
  const codeFacts = extractFacts(fullText, 0);
  const codeTopics = assignTopics(fullText);
  const codeTags = assignTags(fullText);

  // Build EvidenceArticle objects for selection
  const sourceMap = ctx.outlets;
  const evidenceArticles: EvidenceArticle[] = articles.map((a) => {
    const outlet = a.source_id ? ctx.sourceKinds.get(a.source_id) : undefined;
    return outlet !== undefined
      ? {
          title: a.title,
          excerpt: a.excerpt,
          published_at: a.published_at,
          source_id: a.source_id,
          source_kind: outlet,
        }
      : {
          title: a.title,
          excerpt: a.excerpt,
          published_at: a.published_at,
          source_id: a.source_id,
        };
  });

  // Select the smallest set of articles preserving all meaningful evidence
  const selection = selectEvidence(evidenceArticles);
  const selectedIndices = selection.selectedIndices;
  const selectedArticles = selectedIndices.map((i) => articles[i]!);

  // Deduplicate evidence for the AI payload
  const dedup = deduplicateEvidence(evidenceArticles);

  // Render only the selected evidence for the AI
  const selectedEvidenceText = renderSelectedCoverage(
    evidenceArticles,
    selectedIndices,
    total,
    sourceMap,
  );

  // Determine which topics/tags to use: code-assigned where confident,
  // AI-assigned where ambiguous. For launch, prefer code-assigned.
  const topics = codeTopics.length > 0 ? codeTopics.slice(0, MAX_TOPICS) : [];
  const tags = codeTags.length > 0 ? codeTags.slice(0, 8) : [];

  // Build the AI user message with reduced evidence and deterministic facts
  const user = renderAnalysisPayload(
    event.title,
    selectedEvidenceText,
    codeFacts,
    selection,
    dedup,
    ctx.outlets,
  );

  let parsed: Analysis | null;
  let spent: { promptTokens: number; completionTokens: number };

  // ---- Deterministic event signals (free) ----
  // Used to choose a thin or full AI contract. Does not replace AI scoring:
  // the model still produces importance/novelty, but for obvious cases we
  // can omit the expensive understand block.
  const signals = scoreEvent(articles, codeFacts);

  try {
    if (selection.omittedUniqueSources)
      throw new Error("Evidence source limit would omit unique claims");
    const useThinContract = signals.confidence === "high" && signals.importanceEstimate <= 3;

    const systemPrompt = useThinContract
      ? `${ctx.system}\n\n${thinContract()}`
      : `${ctx.system}\n\n${contract()}`;

    const { data, usage } = await completeRoutedJson<unknown>({
      capability: "reason",
      system: systemPrompt,
      user,
      feature: "analyse",
      eventIds: [event.id],
      promptVersion: `${ANALYSIS_PROMPT_VERSION}:${useThinContract ? "thin" : "full"}`,
      sourceCount: selectedIndices.length,
      evidenceCharacters: selectedEvidenceText.length,
      invocationReason: "demanded_unanalysed_event",
      ...(selectedIndices.length > NORMAL_AI_EVIDENCE
        ? { budgetExceptionReason: "additional_sources_preserve_distinct_claims" }
        : {}),
      maxTokens: useThinContract ? THIN_CONTRACT_MAX_TOKENS : ctx.maxTokens,
      ...(ctx.options.secrets ? { secrets: ctx.options.secrets } : {}),
    });
    spent = { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
    parsed = readAnalysis(data, codeTopics, codeTags, selectedIndices.length);
  } catch (error) {
    // A truncated call spent everything it was given and the API reports the
    // reasoning half of it. Recorded as a floor rather than an estimate: it is a
    // number the provider returned, and the prompt tokens of a failed call are not
    // available on this path.
    const floor = error instanceof TruncatedCompletionError ? error.reasoningTokens : 0;
    const retryAt = aiCapacityRetryAt(error, ctx.options.now ?? new Date());
    if (retryAt !== null) {
      await deferAnalysis(db, event, retryAt, ctx.options);
      return {
        ...base,
        articles: total,
        decision: "deferred",
        completionTokens: floor,
        detail: `temporary AI capacity; retry after ${retryAt.toISOString()}`,
      };
    }
    await recordFailure(db, event, floor, ctx.options);
    return {
      ...base,
      articles: total,
      decision: "failed",
      completionTokens: floor,
      detail: `model: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!parsed) {
    await recordFailure(db, event, spent.promptTokens + spent.completionTokens, ctx.options);
    return {
      ...base,
      ...spent,
      articles: total,
      decision: "failed",
      detail: "reply parsed as JSON but was not a usable analysis",
    };
  }

  // Written on every analysis, not asked of the model: how many articles this
  // document was actually generated from. Nothing downstream trusts the model
  // for this number -- it is the real length of what `renderCoverage` showed it.
  if (parsed.understand) {
    parsed = {
      ...parsed,
      understand: {
        ...parsed.understand,
        analysisMeta: {
          sourceCountAtAnalysis: selectedIndices.length,
          coverageCountAtAnalysis: articles.length,
          sourceArticleIds: selectedArticles.map((a) => a.id),
        },
      },
    };
  }

  const shared = {
    ...base,
    ...spent,
    title: parsed.title ?? event.title,
    articles: total,
    importance: parsed.importance,
    novelty: parsed.novelty,
    topics: parsed.topics,
    unknownTopics: parsed.unknownTopics,
  };

  if (ctx.options.dryRun === true) {
    return { ...shared, decision: "skipped", detail: summarise(parsed) };
  }

  const written = await writeAnalysis(db, event, parsed, spent, ctx.topics);
  if (written) return { ...shared, decision: "failed", detail: written };

  // Shadow mode: compute deterministic extraction results alongside
  // the AI analysis and log the comparison.
  //
  // NOTE: As of the production promotion, extractFacts(), assignTopics(),
  // and assignTags() are now used in production. This shadow log records
  // the comparison between code-extracted facts and the AI's understand
  // block for measurement purposes only.
  //
  // See docs/track.md phase 7 for the shadow measurement framework.
  await recordShadowLog(db, event, articles, parsed);

  // Production evidence selection metrics.
  //
  // Evidence selection is now used in production — the full 12-article set
  // is read from the database, but only the selected subset reaches the
  // AI model. This function records the selection metrics for observability.
  //
  // See docs/track.md phase 9 for the measurement framework.
  await recordEvidenceShadowLog(db, event, articles, parsed);

  return { ...shared, decision: "analysed", detail: summarise(parsed) };
}

/**
 * The one-time refresh for a thin document real evidence has overtaken.
 *
 * Structurally a smaller `runOne`: same coverage read, same prompt, same
 * model call, same parser, same writer. The only differences are the claim
 * (`claimEnrichment`, which requires `status = 'complete'` instead of
 * `analysed_at is null`) and the failure path (`recordEnrichmentFailure`,
 * which leaves the existing `understand` and `analysed_at` untouched instead
 * of marking the event `failed`) -- a refresh that doesn't happen must never
 * look like the event losing what it already had.
 */
async function runEnrichment(db: Db, event: Pending, ctx: Context): Promise<EventOutcome> {
  const base = {
    eventId: event.id,
    title: event.title,
    articles: 0,
    importance: null,
    novelty: null,
    topics: [],
    unknownTopics: [],
    promptTokens: 0,
    completionTokens: 0,
  };

  const { articles, total, error: readFailed } = await readCoverage(db, event.id, ctx.options);
  if (readFailed) return { ...base, decision: "failed", detail: readFailed };
  if (articles.length === 0) return { ...base, decision: "empty", detail: "no articles attached" };

  const claim = await claimEnrichment(db, event, ctx.options);
  if (claim !== "held") {
    return { ...base, articles: total, decision: "claimed", detail: claim };
  }

  const fullText = articles.map((a) => `${a.title}\n${a.excerpt ?? ""}`).join("\n---\n");
  const codeFacts = extractFacts(fullText, 0);
  const codeTopics = assignTopics(fullText);
  const codeTags = assignTags(fullText);

  const evidenceArticles: EvidenceArticle[] = articles.map((a) => ({
    title: a.title,
    excerpt: a.excerpt,
    published_at: a.published_at,
    source_id: a.source_id,
    ...(a.source_id && ctx.sourceKinds.has(a.source_id)
      ? { source_kind: ctx.sourceKinds.get(a.source_id)! }
      : {}),
  }));
  const selection = selectEvidence(evidenceArticles);
  const selectedIndices = selection.selectedIndices;
  const selectedEvidence = renderSelectedCoverage(
    evidenceArticles,
    selectedIndices,
    total,
    ctx.outlets,
  );
  const dedup = deduplicateEvidence(evidenceArticles);

  const user = renderAnalysisPayload(
    event.title,
    selectedEvidence,
    codeFacts,
    selection,
    dedup,
    ctx.outlets,
  );

  let parsed: Analysis | null;
  let spent: { promptTokens: number; completionTokens: number };

  try {
    if (selection.omittedUniqueSources)
      throw new Error("Evidence source limit would omit unique claims");
    const { data, usage } = await completeRoutedJson<unknown>({
      capability: "reason",
      system: `${ctx.system}\n\n${contract()}`,
      user,
      feature: "enrich",
      eventIds: [event.id],
      promptVersion: `${ANALYSIS_PROMPT_VERSION}:full`,
      sourceCount: selectedIndices.length,
      evidenceCharacters: selectedEvidence.length,
      invocationReason: "material_evidence_growth",
      ...(selectedIndices.length > NORMAL_AI_EVIDENCE
        ? { budgetExceptionReason: "additional_sources_preserve_distinct_claims" }
        : {}),
      maxTokens: ctx.maxTokens,
      ...(ctx.options.secrets ? { secrets: ctx.options.secrets } : {}),
    });
    spent = { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
    parsed = readAnalysis(data, codeTopics, codeTags, selectedIndices.length);
  } catch (error) {
    // Includes an exhausted AI budget: the call throws before it spends
    // anything, `refreshedAfterEnrichment` is never set, and the event simply
    // stays eligible for a later run once the budget allows it again.
    const floor = error instanceof TruncatedCompletionError ? error.reasoningTokens : 0;
    await recordEnrichmentFailure(db, event, floor, ctx.options);
    return {
      ...base,
      articles: total,
      decision: "failed",
      completionTokens: floor,
      detail: `enrichment model: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!parsed) {
    await recordEnrichmentFailure(
      db,
      event,
      spent.promptTokens + spent.completionTokens,
      ctx.options,
    );
    return {
      ...base,
      ...spent,
      articles: total,
      decision: "failed",
      detail: "enrichment reply parsed as JSON but was not a usable analysis",
    };
  }

  if (parsed.understand) {
    parsed = {
      ...parsed,
      understand: {
        ...parsed.understand,
        analysisMeta: {
          sourceCountAtAnalysis: selectedIndices.length,
          coverageCountAtAnalysis: articles.length,
          refreshedAfterEnrichment: true,
          sourceArticleIds: selectedIndices.map((i) => articles[i]!.id),
        },
      },
    };
  }

  const shared = {
    ...base,
    ...spent,
    title: parsed.title ?? event.title,
    articles: total,
    importance: parsed.importance,
    novelty: parsed.novelty,
    topics: parsed.topics,
    unknownTopics: parsed.unknownTopics,
  };

  if (ctx.options.dryRun === true) {
    return { ...shared, decision: "skipped", detail: summarise(parsed) };
  }

  const written = await writeAnalysis(db, event, parsed, spent, ctx.topics);
  if (written) {
    await recordEnrichmentFailure(db, event, 0, ctx.options);
    return { ...shared, decision: "failed", detail: written };
  }

  // Shadow mode: compute deterministic results and log comparison
  await recordShadowLog(db, event, articles, parsed);

  // Shadow mode: compute adaptive evidence selection and deduplication metrics
  await recordEvidenceShadowLog(db, event, articles, parsed);

  return { ...shared, decision: "enriched", detail: summarise(parsed) };
}

/**
 * A single-article event whose only coverage is a CI ref.
 *
 * Stage 3 used to create an event of one for these (the cheap cluster path) and
 * this stage then paid to "understand" them. That was 20% of the analysis bill.
 * Refusing here, before the claim, means a leftover of that shape costs nothing
 * and is marked failed so the schedule does not retry it.
 *
 * A real release tag (`v8.2.2`) is not this: it is news, just a thin headline.
 * Two articles, even two refs, also are not — the second outlet is evidence of
 * something worth a look.
 */
export function isUnanalysable(articles: { title: string }[], total: number): boolean {
  const only = articles[0];
  return total === 1 && only !== undefined && isVcsRef(only.title);
}

/**
 * The event's coverage, oldest first, and how much of it there is.
 *
 * Oldest first because the first report is the announcement and the later ones are
 * reaction to it, which is the order that makes `before_state` and `after_state`
 * answerable. `count: "exact"` is asked for so the prompt can say honestly that it
 * is showing twelve of thirty rather than implying thirty is all there was.
 */
async function readCoverage(
  db: Db,
  eventId: string,
  options: AnalyseOptions,
): Promise<{ articles: Coverage[]; total: number; error: string | null }> {
  const { data, error, count } = await db
    .from("articles")
    .select("id, title, excerpt, published_at, source_id", { count: "exact" })
    .eq("event_id", eventId)
    .order("published_at", { ascending: true, nullsFirst: false })
    .limit(options.articleLimit ?? ARTICLES);

  if (error) return { articles: [], total: 0, error: `reading coverage: ${error.message}` };

  const articles = data ?? [];
  return { articles, total: count ?? articles.length, error: null };
}

/**
 * Takes the event, or reports who has it.
 *
 * The update is conditional on the state that made this event eligible, so the
 * database decides the winner rather than this process assuming it. Postgres
 * evaluates it as one statement, which is why two workers a millisecond apart
 * cannot both be told they hold the same event.
 *
 * Normal cron workers only claim events in explicitly retryable states:
 * `pending`, `failed`, or `deferred` (deferred_until past). A row left in
 * `analysing` by a crashed worker is NOT automatically reclaimed by another
 * normal cron — the stale reservation reaper handles the reservation, and the
 * operator can recover the event with `--event <id>`.
 *
 * `--event <id>` adds the stale-analysing predicate on purpose: it exists for
 * verifying a known case and for recovering an event a crash left claimed.
 * It still cannot re-analyse, because the `analysed_at` check below is
 * unconditional.
 */
async function claimEvent(
  db: Db,
  event: Pending,
  options: AnalyseOptions,
): Promise<"held" | string> {
  if (options.dryRun === true) return "held";

  const now = new Date().toISOString();
  const forced = (options.eventIds?.length ?? 0) > 0;

  let update = db
    .from("events")
    .update({ status: "analysing", last_updated_at: now })
    .eq("id", event.id)
    .is("analysed_at", null);

  if (forced) {
    // The operator path, and the only one that may take an event back from a
    // crashed worker. Bounded by STALE_MINUTES so it still cannot take one a
    // live worker is holding.
    const stale = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
    update = update.or(
      `status.in.(pending,failed),and(status.eq.analysing,last_updated_at.lt.${stale})`,
    );
  } else {
    // The cron path. Retryable states only, and deliberately no stale-`analysing`
    // branch: age is not evidence that a paid call did not happen, so an aged
    // claim must never become a second paid call. `deferred` work is `pending`
    // with `analysis_deferred_until` set, which `selectEvents` gates on.
    update = update.in("status", ["pending", "failed"]);
  }

  const { data, error } = await update.select("id");
  if (error) return `claiming: ${error.message}`;
  if ((data?.length ?? 0) === 0) {
    return event.status === "analysing"
      ? "another run holds this event"
      : "already analysed, or claimed between selection and now";
  }
  return "held";
}

/**
 * Claims an already-analysed event for its one material-enrichment refresh.
 *
 * Deliberately does not touch `analysed_at` -- unlike `claimEvent`, an
 * enrichment candidate is required to already have it set. `status = 'complete'`
 * is the guard instead: it only takes a settled event, never one another run is
 * mid-touching, and never one that has already been refreshed (that event's
 * `analysisMeta.refreshedAfterEnrichment` kept it out of selection in the
 * first place, so this is belt-and-suspenders against a race, not the primary
 * check).
 */
async function claimEnrichment(
  db: Db,
  event: Pending,
  options: AnalyseOptions,
): Promise<"held" | string> {
  if (options.dryRun === true) return "held";

  const { data, error } = await db
    .from("events")
    .update({ status: "analysing", last_updated_at: new Date().toISOString() })
    .eq("id", event.id)
    .eq("status", "complete")
    .select("id");

  if (error) return `claiming for enrichment: ${error.message}`;
  if ((data?.length ?? 0) === 0) return "not settled, or claimed between selection and now";
  return "held";
}

export type Analysis = {
  title: string | null;
  whatHappened: string;
  beforeState: string | null;
  afterState: string | null;
  importance: number;
  novelty: number;
  topics: string[];
  unknownTopics: string[];
  /**
   * Open-vocabulary concepts for `events.tags`. Not a second topic list: these
   * are never shown and never joined, they are the shared signal a reader's own
   * words match against in stage 5.
   */
  tags: string[];
  /**
   * The shared "why it matters" line -- see docs/track.md phase 2. Optional,
   * unlike what_happened and the scores: a missing or unusable impact still
   * leaves an analysed, matchable event. digest.ts backfills it lazily on
   * first need for exactly this case, so refusing the whole analysis over
   * a missing sentence would throw away real signal to protect a fallback
   * path that already exists.
   */
  impact: string | null;
  /** Optional for rollout compatibility; legacy replies still produce a valid event. */
  understand: EventIntelligence | null;
};

/**
 * The model's reply, turned into something writable — or null.
 *
 * Exported for `analyse.test.ts`, and the only part of this stage that can be
 * tested without a database. It is also the only part where being wrong writes
 * something false: a missing importance defaulted to 0 would hide a real event from
 * every reader whose density threshold is above zero, and a missing one defaulted
 * to 5 would be a score nobody produced. So a reply without both scores and a
 * `what_happened` is not repaired, it is refused — the event stays unanalysed and
 * says so.
 */
export function readAnalysis(
  reply: unknown,
  codeTopics: string[] = [],
  codeTags: string[] = [],
  evidenceCount = 0,
): Analysis | null {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return null;
  const raw = reply as Record<string, unknown>;

  const whatHappened = text(raw["what_happened"]);
  if (whatHappened === null) return null;

  const importance = score(raw["importance"]);
  const novelty = score(raw["novelty"]);
  if (importance === null || novelty === null) return null;

  const title = text(raw["title"]);

  return {
    title: title === null ? null : title.slice(0, 200),
    whatHappened,
    beforeState: text(raw["before_state"]),
    afterState: text(raw["after_state"]),
    importance,
    novelty,
    topics: codeTopics.slice(0, MAX_TOPICS),
    unknownTopics: [],
    tags: codeTags.slice(0, 8),
    impact: text(raw["impact"]),
    understand: readEventIntelligence(raw["understand"], evidenceCount),
  };
}

/**
 * A field that has to be prose, or null.
 *
 * The literal strings are checked because a model told to answer null in JSON
 * routinely answers `"null"`, `"none"` or `"unknown"` instead, and storing that as
 * `before_state` would put the word "unknown" on a story page as though it were a
 * finding.
 */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^(null|none|unknown|n\/a|not (stated|specified|reported))\.?$/i.test(trimmed)) return null;
  return trimmed;
}

/** A 0-10 score, clamped, or null if it was not a number at all. */
function score(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(10, Math.max(0, n)) * 10) / 10;
}

/**
 * The prompt body: the coverage itself.
 *
 * Outlet names are included because breadth of coverage is real evidence of
 * importance — three national outlets and a wire service is a different event from
 * three personal blogs — and because they are already in hand from one query per
 * run.
 *
 * Exported for testing: the truncation and the honest "12 of 30" line are both
 * things that would be easy to get subtly wrong and impossible to notice.
 */
export function renderCoverage(
  articles: Coverage[],
  total: number,
  outlets: Map<string, string>,
): string {
  const shown = articles.length;
  const header =
    shown === total
      ? `${total} article${total === 1 ? "" : "s"} about one event, oldest first.`
      : `${total} articles about one event. The ${shown} earliest are below.`;

  const body = articles.map((article, i) => {
    const outlet = article.source_id ? outlets.get(article.source_id) : undefined;
    const when = article.published_at?.slice(0, 10);
    const meta = [outlet, when].filter((part) => part !== undefined && part !== "").join(", ");
    const excerpt = (article.excerpt ?? "").trim().replace(/\s+/g, " ");

    return [
      `${i + 1}. ${article.title}${meta === "" ? "" : ` (${meta})`}`,
      excerpt === ""
        ? null
        : `   ${excerpt.slice(0, EXCERPT_CHARS)}${excerpt.length > EXCERPT_CHARS ? "..." : ""}`,
    ]
      .filter((line) => line !== null)
      .join("\n");
  });

  return `${header}\n\n${body.join("\n\n")}`;
}

/**
 * Writes the analysis. Topics first, `analysed_at` last.
 *
 * The order is the interesting part. If `analysed_at` were set first and the topic
 * insert then failed, the event would be permanently understood and permanently
 * unmatchable — invisible to every reader, and never retried, because nothing
 * re-analyses an analysed event. Failing the other way round costs at worst one
 * repeated analysis of one event, which is bounded and visible. So the cheap
 * failure is chosen deliberately.
 *
 * `analysis_tokens` accumulates rather than overwrites: a prior failed attempt
 * genuinely spent money on this event, and the column is what the cost claim is
 * audited against.
 */
async function writeAnalysis(
  db: Db,
  event: Pending,
  analysis: Analysis,
  spent: { promptTokens: number; completionTokens: number },
  topics: TopicVocabulary,
): Promise<string | null> {
  if (analysis.topics.length > 0) {
    // Lowercased because the names arrive as editorial labels ("Open source")
    // and the map also holds slugs; see `loadTopics` for why it holds both.
    const rows = analysis.topics
      .map((name) => topics.ids.get(name.trim().toLowerCase()))
      .filter((id): id is string => id !== undefined)
      .map((topic_id) => ({ event_id: event.id, topic_id }));

    // An empty list here is not "no topics" -- it is every name failing to
    // resolve, which is the fault that went unnoticed for a week. Warned rather
    // than returned: the analysis is already bought and already good, and
    // discarding its prose over an unresolvable label would turn a broken join
    // into a lost event. The regression test is what keeps this at zero.
    if (rows.length === 0) {
      console.warn(`no topic resolved for ${event.id} from: ${analysis.topics.join(", ")}`);
    } else {
      const { error } = await db
        .from("event_topics")
        .upsert(rows, { onConflict: "event_id,topic_id", ignoreDuplicates: true });

      if (error) return `linking topics: ${error.message}`;
    }
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("events")
    .update({
      ...(analysis.title === null ? {} : { title: analysis.title }),
      what_happened: analysis.whatHappened,
      before_state: analysis.beforeState,
      after_state: analysis.afterState,
      importance: analysis.importance,
      novelty: analysis.novelty,
      understand: analysis.understand as unknown as Json,
      tags: analysis.tags,
      status: "complete",
      analysis_deferred_until: null,
      analysed_at: now,
      last_updated_at: now,
      analysis_tokens: event.analysis_tokens + spent.promptTokens + spent.completionTokens,
    })
    .eq("id", event.id);

  if (error) return `writing analysis: ${error.message}`;

  // Best-effort: a shared impact this stage failed to write is exactly what
  // digest.ts's lazy backfill exists for. Not folded into the write above --
  // failing the event write over a table this stage did not need to touch
  // would be a strictly worse failure than leaving one impact row absent.
  if (analysis.impact !== null) {
    const { error: impactError } = await db.from("event_impacts").upsert(
      {
        event_id: event.id,
        status: "complete",
        text: analysis.impact,
        prompt_tokens: 0,
        completion_tokens: 0,
      },
      { onConflict: "event_id" },
    );
    if (impactError) {
      console.warn(`writing shared impact for ${event.id}: ${impactError.message}`);
    }
  }

  return null;
}

/**
 * Records that an attempt failed, and what it cost.
 *
 * `analysed_at` stays null, so this is not a claim to have understood anything. The
 * spend is added because it was really spent; see the note on the money ledger at
 * the top of this file.
 */
async function recordFailure(
  db: Db,
  event: Pending,
  spent: number,
  options: AnalyseOptions,
): Promise<void> {
  if (options.dryRun === true) return;

  await db
    .from("events")
    .update({
      status: "failed",
      analysis_deferred_until: null,
      analysis_tokens: event.analysis_tokens + spent,
      last_updated_at: new Date().toISOString(),
    })
    .eq("id", event.id);
}

/**
 * A failed enrichment attempt is not a failed event. `understand` and
 * `analysed_at` are left exactly as they were -- the document that already
 * existed keeps working -- and `status` returns to `complete` rather than
 * `failed`, so nothing downstream that reads status sees this event as
 * unanalysed.
 */
async function recordEnrichmentFailure(
  db: Db,
  event: Pending,
  spent: number,
  options: AnalyseOptions,
): Promise<void> {
  if (options.dryRun === true) return;

  await db
    .from("events")
    .update({
      status: "complete",
      analysis_tokens: event.analysis_tokens + spent,
      last_updated_at: new Date().toISOString(),
    })
    .eq("id", event.id);
}

async function deferAnalysis(
  db: Db,
  event: Pending,
  retryAt: Date,
  options: AnalyseOptions,
): Promise<void> {
  if (options.dryRun === true) return;

  const { error } = await db
    .from("events")
    .update({
      status: "pending",
      analysis_deferred_until: retryAt.toISOString(),
      last_updated_at: new Date().toISOString(),
    })
    .eq("id", event.id);
  if (error) throw new Error(`deferring analysis: ${error.message}`);
}

function summarise(analysis: Analysis): string {
  const topics = analysis.topics.length === 0 ? "no topics" : analysis.topics.join(" ");
  return `i${analysis.importance} n${analysis.novelty} [${topics}] ${analysis.whatHappened.slice(0, 90)}`;
}

/**
 * Shadow mode: compute deterministic extraction results alongside
 * the AI analysis and log the comparison.
 *
 * NOTE: As of the production promotion, extractFacts(), assignTopics(),
 * and assignTags() are now used in production. This shadow log records
 * the comparison between code-extracted facts and the AI's understand
 * block for measurement purposes only.
 *
 * See docs/track.md phase 7 for the shadow measurement framework.
 */
async function recordShadowLog(
  db: Db,
  event: Pending,
  articles: Coverage[],
  analysis: Analysis,
): Promise<void> {
  if (articles.length === 0) return;

  // Combine all article text for deterministic extraction
  const fullText = articles.map((a) => `${a.title}\n${a.excerpt ?? ""}`).join("\n---\n");

  // Deterministic extraction (now used in production)
  const codeFacts = extractFacts(fullText, 0);
  const codeTopics = assignTopics(fullText);
  const codeTags = assignTags(fullText);

  // AI results from the understand block
  const aiFacts: Record<string, string[]> = {};
  if (analysis.understand) {
    const numbers = (analysis.understand.numbers ?? []).map((n: { value: string }) => n.value);
    if (numbers.length > 0) aiFacts["money"] = numbers;
    const dates = (analysis.understand.timeline ?? []).map((t: { when: string }) => t.when);
    if (dates.length > 0) aiFacts["dates"] = dates;
    const cves = (analysis.understand.unknowns ?? []).filter((u: string) => u.startsWith("CVE-"));
    if (cves.length > 0) aiFacts["cves"] = cves;
  }
  const aiTopics = analysis.topics;
  const aiTags = analysis.tags;

  // Compute comparison metrics
  const factComparisons = compareExtraction(codeFacts, aiFacts);
  const topicComparison = compareTopics(codeTopics, aiTopics);
  const tagComparison = compareTags(codeTags, aiTags);
  const comparisons = [...factComparisons, topicComparison, tagComparison];

  // Overall agreement rate
  const hasOpinion = comparisons.some((c) => c.codeCount > 0 || c.aiCount > 0);
  const rates = comparisons
    .filter((c) => c.codeCount > 0 || c.aiCount > 0)
    .map((c) => c.agreementRate);
  const overallAgreementRate =
    rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 1.0;

  // Write to shadow log — best-effort, never fails the analysis
  try {
    const { error } = await db.from("analysis_shadow_log").insert({
      event_id: event.id,
      article_id: articles[0]?.id ?? null,
      article_title: articles[0]?.title ?? event.title,
      code_facts: JSON.stringify(
        Object.fromEntries(
          Object.entries(codeFacts).map(([k, v]) => [k, v.map((x: { value: string }) => x.value)]),
        ),
      ),
      code_topics: codeTopics,
      code_tags: codeTags,
      ai_facts: JSON.stringify(aiFacts),
      ai_topics: aiTopics,
      ai_tags: aiTags,
      comparisons: JSON.stringify(comparisons),
      overall_agreement_rate: Math.round(overallAgreementRate * 10000) / 10000,
      has_opinion: hasOpinion,
    });
    if (error) {
      console.warn(`shadow log for ${event.id}: ${error.message}`);
    }
  } catch (err) {
    // Shadow logging must never fail the analysis
    console.warn(`shadow log failed for ${event.id}: ${err}`);
  }
}

/**
 * Production evidence selection metrics.
 *
 * Evidence selection is now used in production — the full 12-article set
 * is read from the database, but only the selected subset reaches the
 * AI model. This function records the selection metrics for observability.
 *
 * See docs/track.md phase 9 for the measurement framework.
 */
async function recordEvidenceShadowLog(
  db: Db,
  event: Pending,
  articles: Coverage[],
  analysis: Analysis,
): Promise<void> {
  if (articles.length === 0) return;

  try {
    // Load source metadata for scoring
    const { data: sources } = await db
      .from("sources")
      .select("id, name, kind, coverage_mode, polling_tier, failure_count")
      .in(
        "id",
        articles.map((a) => a.source_id).filter((id): id is string => id !== null),
      );

    const sourceMap = new Map<
      string,
      { kind?: string; coverage_mode?: string; polling_tier?: string; failure_count?: number }
    >();
    for (const s of sources ?? []) {
      sourceMap.set(s.id, {
        kind: s.kind,
        coverage_mode: s.coverage_mode,
        polling_tier: s.polling_tier,
        failure_count: s.failure_count,
      });
    }

    // Build EvidenceArticle objects with source metadata
    const evidenceArticles: import("./evidence-selection").EvidenceArticle[] = articles.map((a) => {
      const meta = a.source_id ? sourceMap.get(a.source_id ?? "") : undefined;
      const article: import("./evidence-selection").EvidenceArticle = {
        title: a.title,
        excerpt: a.excerpt,
        published_at: a.published_at,
        source_id: a.source_id,
      };
      if (meta?.kind !== undefined) article.source_kind = meta.kind;
      if (meta?.coverage_mode !== undefined) article.source_coverage_mode = meta.coverage_mode;
      if (meta?.polling_tier !== undefined) article.source_polling_tier = meta.polling_tier;
      if (meta?.failure_count !== undefined) article.source_failure_count = meta.failure_count;
      return article;
    });

    // Compute production metrics
    const metrics = computeEvidenceShadowMetrics(event.id, evidenceArticles);

    // Write to evidence_shadow_log for observability
    try {
      const { error } = await (
        db.from("evidence_shadow_log") as unknown as {
          insert: (
            val: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: { message: string } }>;
        }
      ).insert({
        event_id: event.id,
        full_article_count: metrics.fullArticleCount,
        selected_article_count: metrics.selectedArticleCount,
        facts_preserved: metrics.factsPreserved,
        facts_lost: metrics.factsLost,
        conflicts_preserved: metrics.conflictsPreserved,
        source_attribution_preserved: metrics.sourceAttributionPreserved,
        prompt_tokens_saved: metrics.promptTokensSaved,
        agreement_rate: metrics.agreementRate,
        selected_indices: metrics.selectedIndices as number[],
        fact_preservation_detail: JSON.stringify(metrics.factPreservationDetail),
      });
      if (error) {
        console.warn(`evidence shadow log for ${event.id}: ${error.message}`);
      }
    } catch (err) {
      console.warn(`evidence shadow log failed for ${event.id}: ${err}`);
    }
  } catch (err) {
    console.warn(`evidence shadow computation failed for ${event.id}: ${err}`);
  }
}

/**
 * One line for a log or a commit message.
 *
 * Named for its stage for the same reason `describeCluster` is: `cron.ts` exports a
 * `describe`, and so does vitest.
 */
export function describeAnalysis(report: AnalysisReport): string {
  const seconds = Math.round(
    (new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000,
  );

  const demand = report.noDemand > 0 ? `, ${report.noDemand} no demand` : "";
  const demandFailed =
    report.demandCheckFailed > 0 ? `, ${report.demandCheckFailed} demand-check-failed` : "";
  const deferred = report.deferred > 0 ? `, ${report.deferred} capacity-deferred` : "";

  return (
    `analyse: ${report.considered} events, ${report.analysed} analysed, ` +
    `${report.ignored} ignored, ${report.failed} failed, ${report.claimed} held elsewhere${demand}${demandFailed}${deferred}, ` +
    `${report.modelCalls} model calls, ` +
    `${report.promptTokens + report.completionTokens} tokens, ${seconds}s`
  );
}
