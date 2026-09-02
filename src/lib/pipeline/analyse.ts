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
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aiCapacityRetryAt,
  completeRoutedJson,
  resolvePrompt,
  type SecretBag,
} from "@/lib/ai/config";
import { TruncatedCompletionError } from "@/lib/ai/deepseek";
import type { Database, EventStatus, Json } from "@/lib/supabase/types";
import { readEventIntelligence, type EventIntelligence } from "@/lib/understand";
import { isVcsRef } from "./shortlist";

type Db = SupabaseClient<Database>;

/**
 * Events per run.
 *
 * Small because each one is a call to the strongest configured model. The backlog
 * is drained deliberately with `npm run pipeline -- analyse --limit N`, not by a
 * schedule that could run up a bill while nobody is watching.
 */
const BATCH = 8;

/**
 * Articles shown to the model per event.
 *
 * Twelve write-ups of one announcement contain everything the thirteenth does. The
 * cap matters because the prompt is the larger half of this stage's spend, and
 * because a cluster of forty would otherwise cost four times what one of ten does
 * for no better answer.
 */
const ARTICLES = 12;

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
const DEFAULT_PROMPT = `You are a news analyst. You read every article about one event and write down what actually happened, for a reader who needs to know whether it changes anything for them.

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
function contract(slugs: string[]): string {
  return `Reply with JSON only, in exactly this shape:

{
  "title": "one neutral line naming what happened, under 100 characters",
  "what_happened": "one 50-90 word briefing paragraph containing only unique supported facts",
  "before_state": "what was true before this, or null if the coverage does not say",
  "after_state": "what is true now that was not before, or null",
  "importance": 0,
  "novelty": 0,
  "topics": ["slug"],
  "impact": "1-2 sentences on why this matters to someone who tracks this space, or null",
  "understand": {
    "coverage": "thin, normal, or rich, based on usable unique facts rather than source count",
    "summary": "a 40-80 word event explanation with no repeated facts",
    "facts": [{ "text": "one unique reported fact", "evidence": [1] }],
    "key_numbers": [{ "value": "$13B", "label": "Deal value", "evidence": [1] }],
    "context": [{ "text": "supported background needed to understand the event", "evidence": [2] }],
    "timeline": [{ "when": "Q4", "what": "Expected closing", "evidence": [2] }],
    "affected_groups": [{ "group": "Developers", "effect": "a concrete supported effect", "basis": "reported or analysis", "evidence": [2] }],
    "what_next": [{ "text": "a reported next step, not a prediction", "evidence": [2] }],
    "unknowns": ["The available sources do not specify ..."],
    "conflicts": [{ "topic": "Transaction value", "reports": [{ "text": "$12B", "evidence": [1] }, { "text": "$13B", "evidence": [2] }] }],
    "relationship": { "subject": "Nvidia", "relation": "acquiring", "object": "Hugging Face", "detail": "$13B", "evidence": [1] },
    "comparison": { "caption": "Pricing", "left_label": "Before", "right_label": "Now", "rows": [{ "label": "Monthly", "left": "$20", "right": "$25", "evidence": [1] }] },
    "series": { "caption": "Quarterly revenue", "shape": "bar", "points": [{ "label": "Q1", "value": 26.0, "display": "$26B", "evidence": [1] }] },
    "overview": [{ "name": "Beam Ultra", "kind": "Soundbar", "detail": "$699", "evidence": [1] }]
  }
}

Every evidence number refers to the numbered article supplied in the user message.
Use only valid article numbers. A statement supported by several articles lists
each of them. Do not claim that every source supports a fact unless it does.

understand is event intelligence, not an article. Extract unique facts before
writing blocks. Several paraphrases of one fact are one fact. A detail already in
summary must not be repeated in facts unless the fact adds material precision.

Every understand array is optional in substance: use [] when the evidence does
not justify it. Never manufacture a timeline from one date, key numbers without
meaningful labels, effects not grounded in the supplied evidence, future steps
that were not reported, or generic context. Unknown means the available sources
do not specify something material; it does not mean the thing does not exist.

affected_groups with basis "analysis" is the only place for a bounded inference.
It must still be grounded in listed evidence and must not be phrased as reported.
All facts, context, numbers, timeline points and next steps are directly reported.
If credible accounts disagree, preserve both in conflicts instead of choosing.

relationship, comparison, series and overview exist so the page can draw what is
clearer seen than read. Each is null or [] unless the evidence carries it:

relationship: one subject-relation-object the event turns on -- an acquirer and a
target, a regulator and the company it is investigating, two partners. Not a
restatement of the summary with arrows.

comparison: two states or entities the evidence gives comparable values for --
old price and new price, expected and actual, last quarter and this one. Both
sides of every row must be reported. Omit a row whose sides say the same thing.

series: three or more comparable numbers over periods or entities, for a chart.
value is a plain number, display is how to print it. Two numbers are a
comparison, not a chart; one number is a key number. Never assemble a series from
numbers that measure different things.

overview: two or more things announced together -- several products, several
measures in one policy. One thing announced is a fact, not an overview.

For thin evidence, a short summary and one or two facts may be the entire useful
answer. Mark coverage thin and leave unsupported arrays empty. Never pad. Never
invent a number, date, relationship or trend so that a block can be drawn.

impact is shared: it is shown to every reader this event is briefed to, not written
for any one person. Say what changes for someone in the field generally -- a
constraint that shifted, a decision this forces, a thing that no longer works the
old way -- not "this matters if you use X" and not a restatement of what_happened.

what_happened is the Briefing layer. It is about the event, not about the coverage
of it. Name who did what:
"OpenAI wrote to the governor opposing SB 1047", never "an article reported that
OpenAI wrote to the governor". Where the only thing that happened is that somebody
published an argument or a review, name them and say what they argued. Do not
repeat a fact in different words to reach the target; fewer than 50 words is
correct when the evidence is thin.

importance, 0 to 10 - how much this changes for someone working in the field:
  0-2   routine. A point release, a blog post, a conference talk.
  3-5   worth knowing if this is your area. A notable launch, a funding round.
  6-8   matters to the whole field. A major release, an acquisition, an outage
        or breach with real consequences, a regulatory decision.
  9-10  changes plans. Rare. Most weeks contain nothing above 8.

novelty, 0 to 10 - how new this is:
  0-2   already known, rumoured for weeks, or the latest of many like it.
  3-5   an expected step that has now actually happened.
  6-8   genuinely unexpected, or the first of its kind from this player.
  9-10  nobody was predicting this.

topics - choose only from this list, most central first, at most ${MAX_TOPICS}:
${slugs.join(", ")}

Choose no topic at all rather than a loose one. An empty list is a correct answer
for an event outside every topic above.`;
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
    | "deferred" // temporary AI capacity; retry time is persisted
    | "failed";
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
  deferred: number;
  /** Events that reached the model. The rest cost nothing. */
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  outcomes: EventOutcome[];
};

export async function analyse(db: Db, options: AnalyseOptions = {}): Promise<AnalysisReport> {
  const startedAt = (options.now ?? new Date()).toISOString();
  const events = await selectEvents(db, options);

  // Read once per run, not once per event: the topic vocabulary is fifteen rows
  // that change when somebody edits a migration, and the outlet names are sixty-
  // eight. Sixteen extra round trips per batch would buy nothing.
  const [topics, outlets] = await Promise.all([loadTopics(db), loadOutlets(db)]);
  const slugs = [...topics.keys()];

  const system = await promptFor(options.secrets);
  const hasDemand = await loadDemand(db, events, options);
  const outcomes: EventOutcome[] = [];

  // Sequential, unlike stage 3 where it is a correctness requirement. Here it is a
  // spending decision: one call at a time is one call's worth of money committed at
  // a time, and an operator watching the output can stop it.
  for (const event of events) {
    outcomes.push(await runOne(db, event, { options, topics, outlets, slugs, system, hasDemand }));
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
 * "reaches" means. `null` means the gate does not apply this run, either
 * because the flag is off (its default; see docs/track.md phase 8) or
 * because `--event` named specific events, which bypasses it on purpose —
 * the same reasoning `claimEvent` already applies to the claim gate.
 *
 * Fails open, deliberately. If the flag were somehow turned on ahead of
 * 0021 being applied, or the RPC errors for any other reason, the correct
 * response is "run analysis as if the gate did not exist," not "silently
 * analyse nothing." An AI-provider-shaped outage must not take the
 * deterministic system down with it, and neither should this.
 */
async function loadDemand(
  db: Db,
  events: Pending[],
  options: AnalyseOptions,
): Promise<Set<string> | null> {
  if ((options.eventIds?.length ?? 0) > 0 || events.length === 0) return null;

  const { data: flag } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "pre_analysis_demand_gate")
    .maybeSingle();
  if (flag?.enabled !== true) return null;

  const { data, error } = await db.rpc("events_with_demand", {
    p_event_ids: events.map((e) => e.id),
  });
  if (error) {
    console.warn(`pre-analysis demand gate: ${error.message} — running without it this pass`);
    return null;
  }

  return new Set((data ?? []).filter((row) => row.has_demand).map((row) => row.event_id));
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
async function selectEvents(db: Db, options: AnalyseOptions): Promise<Pending[]> {
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
      const { data, error } = await db.rpc("pending_events_with_demand", {
        p_limit: options.limit ?? BATCH,
      });
      if (!error) return data ?? [];
      console.warn(`demand-aware event selection: ${error.message} — using legacy selector`);
    }
  }

  const stale = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  const states = options.retryFailed === true ? "pending,failed" : "pending";
  const now = (options.now ?? new Date()).toISOString();

  const { data, error } = await db
    .from("events")
    .select(columns)
    .is("analysed_at", null)
    .or(`status.in.(${states}),and(status.eq.analysing,last_updated_at.lt.${stale})`)
    .or(`analysis_deferred_until.is.null,analysis_deferred_until.lte.${now}`)
    .order("first_seen_at", { ascending: false })
    .limit(options.limit ?? BATCH);

  if (error) throw new Error(`selecting events: ${error.message}`);
  return data ?? [];
}

async function loadTopics(db: Db): Promise<Map<string, string>> {
  const { data, error } = await db.from("topics").select("id, slug");
  if (error) throw new Error(`reading topics: ${error.message}`);
  return new Map((data ?? []).map((t) => [t.slug, t.id]));
}

async function loadOutlets(db: Db): Promise<Map<string, string>> {
  const { data, error } = await db.from("sources").select("id, name");
  if (error) throw new Error(`reading sources: ${error.message}`);
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
  topics: Map<string, string>;
  outlets: Map<string, string>;
  slugs: string[];
  system: string;
  /** null = gate inactive this run. See loadDemand. */
  hasDemand: Set<string> | null;
};

type Coverage = {
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

  if (ctx.hasDemand !== null && !ctx.hasDemand.has(event.id)) {
    // Left exactly as selected: no write, no claim, no coverage read. Still
    // `pending`, still analysed_at null — eligible for the very next run,
    // gate or no gate, the moment a source covering it gains a reader.
    return { ...base, decision: "no_demand", detail: "no source reaches an eligible reader" };
  }

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

  const user = renderCoverage(articles, total, ctx.outlets);

  let parsed: Analysis | null;
  let spent: { promptTokens: number; completionTokens: number };

  try {
    const { data, usage } = await completeRoutedJson<unknown>({
      capability: "reason",
      system: `${ctx.system}\n\n${contract(ctx.slugs)}`,
      user,
      ...(ctx.options.secrets ? { secrets: ctx.options.secrets } : {}),
    });
    spent = { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
    parsed = readAnalysis(data, ctx.slugs, articles.length);
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

  return { ...shared, decision: "analysed", detail: summarise(parsed) };
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
    .select("title, excerpt, published_at, source_id", { count: "exact" })
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
 * `--event <id>` skips the gate on purpose: it exists for verifying a known case
 * and for recovering an event a crash left claimed, and both of those need to
 * proceed against a row this predicate would refuse. It still cannot re-analyse,
 * because the `analysed_at` check below is unconditional.
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

  if (!forced) {
    const stale = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
    update = update.or(
      `status.in.(pending,failed),and(status.eq.analysing,last_updated_at.lt.${stale})`,
    );
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
  allowed: string[],
  evidenceCount = 0,
): Analysis | null {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return null;
  const raw = reply as Record<string, unknown>;

  const whatHappened = text(raw["what_happened"]);
  if (whatHappened === null) return null;

  const importance = score(raw["importance"]);
  const novelty = score(raw["novelty"]);
  if (importance === null || novelty === null) return null;

  const permitted = new Set(allowed);
  const topics: string[] = [];
  const unknownTopics: string[] = [];

  for (const entry of Array.isArray(raw["topics"]) ? raw["topics"] : []) {
    // A model that returns objects instead of strings has still told you which
    // topics it means, and `{"slug": "ai"}` is a formatting mistake rather than a
    // wrong answer. Anything else is ignored.
    const slug = (
      typeof entry === "string"
        ? entry
        : typeof entry === "object" && entry !== null
          ? String((entry as Record<string, unknown>)["slug"] ?? "")
          : ""
    )
      .trim()
      .toLowerCase();

    if (slug === "") continue;
    if (!permitted.has(slug)) {
      if (!unknownTopics.includes(slug)) unknownTopics.push(slug);
      continue;
    }
    if (!topics.includes(slug)) topics.push(slug);
  }

  const title = text(raw["title"]);

  return {
    title: title === null ? null : title.slice(0, 200),
    whatHappened,
    beforeState: text(raw["before_state"]),
    afterState: text(raw["after_state"]),
    importance,
    novelty,
    topics: topics.slice(0, MAX_TOPICS),
    unknownTopics,
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
  topicIds: Map<string, string>,
): Promise<string | null> {
  if (analysis.topics.length > 0) {
    const rows = analysis.topics
      .map((slug) => topicIds.get(slug))
      .filter((id): id is string => id !== undefined)
      .map((topic_id) => ({ event_id: event.id, topic_id }));

    const { error } = await db
      .from("event_topics")
      .upsert(rows, { onConflict: "event_id,topic_id", ignoreDuplicates: true });

    if (error) return `linking topics: ${error.message}`;
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
  const deferred = report.deferred > 0 ? `, ${report.deferred} capacity-deferred` : "";

  return (
    `analyse: ${report.considered} events, ${report.analysed} analysed, ` +
    `${report.ignored} ignored, ${report.failed} failed, ${report.claimed} held elsewhere${demand}${deferred}, ` +
    `${report.modelCalls} model calls, ` +
    `${report.promptTokens + report.completionTokens} tokens, ${seconds}s`
  );
}
