/**
 * Turning articles into events. The first stage that spends money.
 *
 * Thirty outlets covering one announcement should become one row in `events`, so
 * that stage 4 can understand it once and every reader who cares shares that one
 * analysis. This is where that grouping happens, and the shape of it is dictated
 * entirely by what a model call costs:
 *
 *   1. Take a bounded batch of articles with no `event_id`.
 *   2. For each, get a shortlist from Postgres — free, index-served, ten rows.
 *   3. Ask the model one question about the shortlist: which of these is the same
 *      event? One call per article, over ten titles.
 *   4. Attach to an existing event, or create one.
 *
 * **Articles are processed one at a time, and that is load-bearing.** Step 2 reads
 * the same table step 4 writes, so by the time the fourth article about an
 * announcement is examined, the first three are already attached to an event and
 * appear in its shortlist as candidates to attach to. A burst of coverage
 * converges on one event with no in-memory bookkeeping and no second pass. Running
 * the batch concurrently would break exactly that: eight workers would each see
 * the article as unclustered and create eight events for one story, which is not a
 * slow version of the right answer but the wrong answer, and an expensive one —
 * stage 4 would then analyse the same announcement eight times.
 *
 * **Two paths cost nothing.** An article whose title yields no distinctive words
 * (a release tag, a CI notification) gets no shortlist and no model call. An
 * article whose shortlist comes back empty is genuinely the only coverage of
 * something and gets no model call either. Both simply become their own event.
 *
 * **What this stage must never do** is create a second event for a story that
 * already has one. That is the whole shared-analysis property, and it is why the
 * shortlist prefers already-clustered candidates and why attachment is preferred
 * over creation whenever the model finds a match.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiCapacityRetryAt, completeRoutedJson, type SecretBag } from "@/lib/ai/config";
import type { Database, EventStatus } from "@/lib/supabase/types";
import { verdictFor, type ConfidenceVerdict } from "./confidence";
import { isVcsRef, shortlist, type Candidate } from "./shortlist";

type Db = SupabaseClient<Database>;

/** Articles per run. Bounds the model spend of one invocation. */
const BATCH = 40;

/**
 * Candidates shown to the model.
 *
 * Ten is enough to cover the outlets that pile onto one announcement and short
 * enough that the prompt stays a few hundred tokens. Raising it raises the cost of
 * every call in the stage, including the majority that find no match at all.
 */
const SHORTLIST = 10;

const SYSTEM = `You group news headlines that report the same real-world event.

An event is one specific occurrence: a single release, announcement, incident, deal,
filing or result. Two headlines are the same event when they report that same
occurrence, even if the wording, the angle or the outlet differs. Commentary,
analysis and reaction to an occurrence count as the same event as the occurrence.

Two headlines are DIFFERENT events when they describe different occurrences, even
where the subject is identical. Two releases by the same project, two lawsuits
against the same company, two funding rounds, or a general trend piece next to a
specific announcement are all different events.

When you are not sure, answer that they are different. A wrongly split event costs
one extra summary. A wrongly merged event silently misinforms every reader who
receives it.

Reply with JSON only, in the form {"same": [1, 3]}, listing the numbers of the
candidates that report the same event as the new headline. Reply {"same": []} if
none of them do.`;

type Verdict = { same?: unknown };
export type { Verdict };

export type ClusterOptions = {
  /** Articles to process. Absent means `BATCH`. */
  limit?: number | undefined;
  /** Restrict to specific articles, for verifying a known case. */
  articleIds?: string[] | undefined;
  /** Shortlist and decide, write nothing. Still calls the model. */
  dryRun?: boolean | undefined;
  windowDays?: number | undefined;
  shortlistSize?: number | undefined;
  /** Worker bindings. Required on Cloudflare, where there is no `process.env`. */
  secrets?: SecretBag | undefined;
  now?: Date | undefined;
};

export type ArticleOutcome = {
  articleId: string;
  title: string;
  decision:
    | "attached" // joined an event that already existed
    | "created" // started a new event, possibly with matched siblings
    | "alone" // no shortlist or no match: its own event
    | "ignored" // a CI ref: stored, attached to a failed event, never analysed
    | "skipped" // dry run
    | "deferred" // temporary AI capacity; retry time is persisted
    | "failed";
  eventId: string | null;
  detail: string;
  /** Candidates the model was shown. Zero means it was never called. */
  candidates: number;
  /** Other articles pulled into a new event alongside this one. */
  siblings: number;
  promptTokens: number;
  completionTokens: number;
  /**
   * What the deterministic-confidence layer would have decided, for comparison
   * against the model's real answer. Null unless `deterministic_cluster_v2` is on
   * and the model was actually called — see docs/track.md phase 7. Never used to
   * change the actual decision; this is shadow-only.
   */
  shadowVerdict: ConfidenceVerdict | null;
  /**
   * Whether a *confident* shadow verdict (same or different, not ambiguous)
   * matched what the model decided. Null when there was no confident verdict to
   * check, so a run's agreement rate is computed over decidable cases only.
   */
  shadowAgreed: boolean | null;
};

export type ClusterReport = {
  startedAt: string;
  finishedAt: string;
  considered: number;
  attached: number;
  created: number;
  alone: number;
  ignored: number;
  failed: number;
  deferred: number;
  /** Articles that reached the model. The rest were decided for free. */
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  /** Model calls where the shadow layer reached a confident (non-ambiguous) verdict. */
  shadowDecidable: number;
  /** Of those, how many matched what the model actually decided. */
  shadowAgreed: number;
  /**
   * Articles decided by the deterministic layer with no model call at all.
   * Zero unless `deterministic_cluster_skip` is on — this is the measured
   * saving phase 7 exists to produce, not an estimate.
   */
  aiSkipped: number;
  outcomes: ArticleOutcome[];
};

export async function cluster(db: Db, options: ClusterOptions = {}): Promise<ClusterReport> {
  const startedAt = (options.now ?? new Date()).toISOString();
  const articles = await selectArticles(db, options);
  const shadowOn = await loadShadowFlag(db);
  // Skipping requires shadow mode too: the verdict this acts on is the one
  // shadow mode computes, and acting without also recording would remove the
  // evidence for whether acting was right.
  const skipOn = shadowOn && (await loadSkipFlag(db));
  const outcomes: ArticleOutcome[] = [];
  // Stamped on every decision row this invocation writes, so one run can be
  // read back whole later (0057). `describeCluster`'s per-run agreement line
  // goes to a log that is gone by morning; this survives it.
  const runId = crypto.randomUUID();

  // Sequential, on purpose. See the module comment: concurrency here produces
  // duplicate events for one story rather than a faster correct answer.
  for (const article of articles) {
    outcomes.push(await runOne(db, article, options, shadowOn, skipOn, runId));
  }

  const decidable = outcomes.filter((o) => o.shadowAgreed !== null);

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    considered: articles.length,
    attached: outcomes.filter((o) => o.decision === "attached").length,
    created: outcomes.filter((o) => o.decision === "created").length,
    alone: outcomes.filter((o) => o.decision === "alone").length,
    ignored: outcomes.filter((o) => o.decision === "ignored").length,
    failed: outcomes.filter((o) => o.decision === "failed").length,
    deferred: outcomes.filter((o) => o.decision === "deferred").length,
    // Having a shortlist used to imply a model call. Since phase 7 it does
    // not: a confidently-decided article has candidates and spends nothing.
    // Counting spend rather than candidates keeps this honest.
    modelCalls: outcomes.filter((o) => o.promptTokens > 0 || o.completionTokens > 0).length,
    promptTokens: sum(outcomes, (o) => o.promptTokens),
    completionTokens: sum(outcomes, (o) => o.completionTokens),
    shadowDecidable: decidable.length,
    shadowAgreed: decidable.filter((o) => o.shadowAgreed === true).length,
    // A confident verdict on a shortlisted article that cost no tokens is one
    // the deterministic layer decided. Articles with no shortlist at all were
    // always free and are not a phase 7 saving.
    aiSkipped: outcomes.filter(
      (o) => o.candidates > 0 && o.promptTokens === 0 && o.completionTokens === 0,
    ).length,
    outcomes,
  };
}

/**
 * Whether to compute (never act on) the deterministic shadow verdict this run.
 *
 * Off by default (docs/track.md phase 7) and fails closed on any read problem:
 * a missing flag or a missing 0022 migration means no shadow computation, not a
 * crashed run. Unlike the demand gate, there is no fail-open/fail-closed decision
 * to make here at all — shadow-only computation can never change what gets
 * written, so there is nothing to protect by falling back to "on."
 */
async function loadShadowFlag(db: Db): Promise<boolean> {
  const { data } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "deterministic_cluster_v2")
    .maybeSingle();
  return data?.enabled === true;
}

/**
 * Whether a confident deterministic verdict may actually skip the model
 * (docs/plan2.md phase 7, §25).
 *
 * Separate from the shadow flag on purpose, and both must be on. Shadow mode
 * measures; this acts. Turning this on without a long look at
 * `cluster_shadow_summary` first is precisely the "blindly enable" plan2
 * warns against — and as of 0033 there is no measurement to look at yet, so
 * it ships off and stays off until there is.
 *
 * Fails closed: anything unexpected means keep asking the model, which is the
 * behaviour that has been correct for the whole life of the product.
 */
async function loadSkipFlag(db: Db): Promise<boolean> {
  const { data } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "deterministic_cluster_skip")
    .maybeSingle();
  return data?.enabled === true;
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

type Unclustered = { id: string; title: string; published_at: string | null };

/**
 * The batch, newest first.
 *
 * Newest first because a briefing is about what just happened, and because recent
 * articles are the ones whose siblings are also still unclustered — clustering the
 * front of the queue first is what lets a burst of coverage converge in one run.
 * The consequence is that a long backlog is worked through from the wrong end, so
 * `articleIds` exists for driving it deliberately.
 *
 * Stale filter: articles older than 7 days without current demand are excluded
 * from clustering candidate selection to prevent unnecessary AI budget consumption.
 * They remain in the DB as historical data and may be retried when demand reappears.
 */
async function selectArticles(db: Db, options: ClusterOptions): Promise<Unclustered[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  let query = db
    .from("articles")
    .select("id, title, published_at")
    .gt("published_at", sevenDaysAgo)
    .is("event_id", null)
    .or(
      `clustering_deferred_until.is.null,clustering_deferred_until.lte.${(options.now ?? new Date()).toISOString()}`,
    )
    .order("published_at", { ascending: false })
    .limit(options.limit ?? BATCH);

  const ids = options.articleIds;
  if (ids && ids.length > 0) query = query.in("id", ids);

  const { data, error } = await query;
  if (error) throw new Error(`selecting unclustered articles: ${error.message}`);
  return data ?? [];
}

async function runOne(
  db: Db,
  article: Unclustered,
  options: ClusterOptions,
  shadowOn: boolean,
  skipOn: boolean,
  runId: string,
): Promise<ArticleOutcome> {
  const base = {
    articleId: article.id,
    title: article.title,
    eventId: null,
    candidates: 0,
    siblings: 0,
    promptTokens: 0,
    completionTokens: 0,
    shadowVerdict: null,
    shadowAgreed: null,
  };

  if (isVcsRef(article.title)) {
    if (options.dryRun === true) {
      return { ...base, decision: "skipped", detail: "CI ref; would discard without analysing" };
    }
    return discardRef(db, article);
  }

  // The title-hash cluster cache (0059) is deliberately not consulted. Attaching
  // an article to an event on a title match alone changes clustering correctness
  // semantics for a small saving, which P0 is not willing to trade. The table and
  // its RPCs stay in the database, dormant, so this can be revisited after P0.

  let candidates: Candidate[];
  try {
    candidates = await shortlist(db, article, {
      ...(options.windowDays !== undefined ? { windowDays: options.windowDays } : {}),
      size: options.shortlistSize ?? SHORTLIST,
    });
  } catch (error) {
    return {
      ...base,
      decision: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (candidates.length === 0) {
    if (options.dryRun === true) {
      return { ...base, decision: "skipped", detail: "no candidates; would create its own event" };
    }
    return createEvent(
      db,
      article,
      [],
      "no similar headline within the window",
      "pending",
      candidates.length,
    );
  }

  // Computed before the model is asked so the shadow layer can never see, and
  // therefore can never be nudged by, the model's own answer — only the two
  // headlines. See docs/track.md phase 7 and src/lib/pipeline/confidence.ts.
  const shadow = shadowOn ? verdictFor(article.title, candidates) : null;

  let matched: Candidate[];
  let usage: { promptTokens: number; completionTokens: number };
  let usageId: string | null = null;
  let skipped = false;

  if (skipOn && shadow !== null && shadow.verdict === "different") {
    // Only skip on confident "different" verdicts. "same" verdicts still
    // require the model — shadow agreement on "same" is lower (3 of 5 in the
    // 2026-09-05 audit) and a wrong merge misinforms every reader. "different"
    // agreed 93 of 93, and being wrong there only creates an extra event, which
    // costs one analysis rather than misinformation.
    matched = [];
    usage = { promptTokens: 0, completionTokens: 0 };
    skipped = true;
  } else {
    try {
      const decided = await ask(article, candidates, options);
      matched = decided.matched;
      usage = decided.usage;
      usageId = decided.usageId ?? null;
    } catch (error) {
      const retryAt = aiCapacityRetryAt(error, options.now ?? new Date());
      if (retryAt !== null) {
        if (options.dryRun !== true) {
          const { error: deferError } = await db
            .from("articles")
            .update({ clustering_deferred_until: retryAt.toISOString() })
            .eq("id", article.id);
          if (deferError) throw new Error(`deferring clustering: ${deferError.message}`);
        }
        return {
          ...base,
          candidates: candidates.length,
          decision: "deferred",
          detail: `temporary AI capacity; retry after ${retryAt.toISOString()}`,
        };
      }
      return {
        ...base,
        candidates: candidates.length,
        decision: "failed",
        detail: `model: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const spent = { candidates: candidates.length, ...usage };
  // Whether a confident shadow verdict matches what the model actually decided.
  // Ambiguous (or shadow off) means nothing to check, not disagreement — and
  // when the model was skipped there is nothing to compare against either,
  // since the shadow verdict *is* the decision.
  const shadowResult = {
    shadowVerdict: shadow?.verdict ?? null,
    shadowAgreed:
      shadow === null || shadow.verdict === "ambiguous" || skipped
        ? null
        : shadow.verdict === "different"
          ? matched.length === 0
          : matched.length === 1 && matched[0]?.id === shadow.matchedId,
  };

  if (options.dryRun === true) {
    const names = matched.map((c) => `"${c.title.slice(0, 60)}"`).join(", ");
    return {
      ...base,
      ...spent,
      ...shadowResult,
      decision: "skipped",
      detail: matched.length === 0 ? "no match" : `would join ${names}`,
    };
  }

  // Attachment beats creation. Any matched candidate that already belongs to an
  // event settles it — joining costs nothing in stage 4, and starting a second
  // event for the same story costs a whole analysis and breaks the property this
  // product is priced on.
  const existing = matched.find((c) => c.event_id !== null);
  const outcome: ArticleOutcome = existing?.event_id
    ? { ...(await attach(db, article, existing, spent)), ...shadowResult }
    : matched.length === 0
      ? {
          ...(await createEvent(
            db,
            article,
            [],
            "shortlisted, but no match",
            "pending",
            spent.candidates,
          )),
          ...spent,
          ...shadowResult,
        }
      : {
          ...(await createEvent(
            db,
            article,
            matched,
            "grouped with matched coverage",
            "pending",
            spent.candidates,
          )),
          ...spent,
          ...shadowResult,
        };

  // Written after the decision rather than before it, so the row carries what
  // stage 3 actually did and not merely what it was about to do. Every
  // shortlisted article gets a row while shadow mode is on — including the
  // ambiguous ones, which are the denominator 0033 was missing (0057).

  if (shadow !== null) {
    await recordShadow(db, article, candidates.length, shadow, matched, shadowResult.shadowAgreed, {
      runId,
      modelCalled: !skipped,
      bypassReason: skipped ? "deterministic:different" : null,
      usageId,
      decision: outcome.decision,
    });
  }

  return outcome;
}

/** One model call: this headline against that shortlist. */
async function ask(
  article: Unclustered,
  candidates: Candidate[],
  options: ClusterOptions,
): Promise<{
  matched: Candidate[];
  usage: { promptTokens: number; completionTokens: number };
  usageId: string | null;
}> {
  const numbered = candidates.map((c, i) => `${i + 1}. ${c.title}`).join("\n");

  const { data, usage, usageId } = await completeRoutedJson<Verdict>({
    capability: "cluster",
    system: SYSTEM,
    user: `New headline:\n${article.title}\n\nCandidates:\n${numbered}`,
    feature: "cluster",
    ...(options.secrets ? { secrets: options.secrets } : {}),
  });

  return {
    matched: readVerdict(data, candidates),
    usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
    usageId,
  };
}

/**
 * The model's answer, turned into candidates it actually referred to.
 *
 * Written defensively because the reply is the one input here that no type can
 * guarantee. A model that returns a string, a nested object, or the number 11 for a
 * ten-item list must not take the run down or — much worse — resolve to the wrong
 * article by way of an out-of-range index reading as `undefined` and being merged
 * anyway. Anything unrecognised means no match, which errs towards splitting an
 * event: the cheap mistake rather than the misinforming one.
 *
 * Exported for `cluster.test.ts`. It is the only part of this module that can be
 * tested without a database, and the only part where being wrong corrupts data
 * rather than merely failing.
 */
export function readVerdict(data: Verdict, candidates: Candidate[]): Candidate[] {
  if (!Array.isArray(data.same)) return [];

  const matched: Candidate[] = [];
  for (const entry of data.same) {
    const index = typeof entry === "number" ? entry : Number.parseInt(String(entry), 10);
    if (!Number.isInteger(index) || index < 1 || index > candidates.length) continue;

    const candidate = candidates[index - 1];
    if (candidate && !matched.includes(candidate)) matched.push(candidate);
  }
  return matched;
}

/**
 * Records what stage 3 did with one article (0033, widened by 0057).
 *
 * **A row per shortlisted article, not per confident verdict.** The original
 * rule wrote only where `agreed` was non-null, which excluded every `ambiguous`
 * verdict — so the table held the numerator of the deterministic layer's
 * success rate and none of its denominator. Read that way the layer looked
 * confident on 94.9% of calls; measured against the real call count on
 * 2026-09-05 it was confident on 11.1%. A promotion decision taken from the
 * first number would have been taken from a number that does not exist.
 *
 * `usageId` links to the `ai_usage_ledger` row that priced the call rather than
 * copying its tokens here. One accounting system, joined — two would drift, and
 * the ledger is the one the monthly ceiling counts.
 *
 * Best-effort and never fatal: this is measurement, and losing a measurement
 * row must not cost an article its clustering. The failure is logged so a
 * silent gap in the evidence is explainable rather than invisible — the same
 * treatment `audit()` gives its own writes.
 */
async function recordShadow(
  db: Db,
  article: Unclustered,
  candidates: number,
  shadow: { verdict: ConfidenceVerdict; matchedId: string | null },
  matched: Candidate[],
  agreed: boolean | null,
  extra: {
    runId: string;
    modelCalled: boolean;
    bypassReason: string | null;
    usageId: string | null;
    decision: ArticleOutcome["decision"];
  },
): Promise<void> {
  const { error } = await db.from("cluster_shadow_log").insert({
    article_id: article.id,
    article_title: article.title,
    candidates,
    shadow_verdict: shadow.verdict,
    shadow_matched_id: shadow.matchedId,
    model_matched_id: matched[0]?.id ?? null,
    agreed,
    run_id: extra.runId,
    model_called: extra.modelCalled,
    bypass_reason: extra.bypassReason,
    usage_id: extra.usageId,
    decision: extra.decision,
  });
  if (error) console.warn(`recording cluster shadow for ${article.id}: ${error.message}`);
}

type Spend = { candidates: number; promptTokens: number; completionTokens: number };

/** Joins an article to an event that already exists. */
async function attach(
  db: Db,
  article: Unclustered,
  via: Candidate,
  spent: Spend,
): Promise<ArticleOutcome> {
  const eventId = via.event_id;
  if (eventId === null) throw new Error("attach called with an unclustered candidate");

  const { error } = await db.from("articles").update({ event_id: eventId }).eq("id", article.id);
  if (error) {
    return {
      articleId: article.id,
      title: article.title,
      decision: "failed",
      eventId,
      detail: `attaching: ${error.message}`,
      siblings: 0,
      shadowVerdict: null,
      shadowAgreed: null,
      ...spent,
    };
  }

  // `last_updated_at` moves; `analysed_at` deliberately does not. New coverage of
  // an understood event is not a reason to understand it again — that is the
  // property stage 4 verifies, and clearing the timestamp here would break it
  // from a distance in a way that would look like a stage 4 bug.
  await db.from("events").update({ last_updated_at: new Date().toISOString() }).eq("id", eventId);

  return {
    articleId: article.id,
    title: article.title,
    decision: "attached",
    eventId,
    detail: `joined via "${via.title.slice(0, 60)}"`,
    siblings: 0,
    shadowVerdict: null,
    shadowAgreed: null,
    ...spent,
  };
}

/**
 * Parks a CI ref as a failed event of one, so it leaves the unclustered queue
 * without ever reaching the model in this stage or the next.
 *
 * `status = 'failed'` is what analysis already skips, and `event_id` is what
 * clustering already uses as "done". Analysed-at stays null: this is not a claim
 * to have understood anything.
 */
async function discardRef(db: Db, article: Unclustered): Promise<ArticleOutcome> {
  const outcome = await createEvent(db, article, [], "CI ref, not a headline", "failed", 0);
  if (outcome.decision === "failed") return outcome;
  return { ...outcome, decision: "ignored", detail: "CI ref, not a headline" };
}

/**
 * Starts an event for this article, and for any unclustered siblings matched with it.
 *
 * The event's title is this article's headline. It is a placeholder with a real
 * cost if it leaks: stage 4 writes a proper one, and until it runs an event reads
 * as whichever outlet happened to be processed first. Left as-is rather than
 * synthesised, because inventing a neutral title here would be inventing content,
 * and `status` stays `pending` so it is obvious nothing has understood it yet.
 */
async function createEvent(
  db: Db,
  article: Unclustered,
  siblings: Candidate[],
  why: string,
  status: EventStatus = "pending",
  candidateCount = 0,
): Promise<ArticleOutcome> {
  const failure = (detail: string): ArticleOutcome => ({
    articleId: article.id,
    title: article.title,
    decision: "failed",
    eventId: null,
    detail,
    candidates: candidateCount,
    siblings: 0,
    promptTokens: 0,
    completionTokens: 0,
    shadowVerdict: null,
    shadowAgreed: null,
  });

  const { data: event, error } = await db
    .from("events")
    .insert({
      title: article.title,
      status,
      ...(article.published_at !== null ? { first_seen_at: article.published_at } : {}),
    })
    .select("id")
    .single();

  if (error || !event) return failure(`creating event: ${error?.message ?? "no row returned"}`);

  // Only genuinely unclustered siblings. A candidate that acquired an event
  // between the shortlist and now would otherwise be moved out of it, which would
  // orphan an event mid-run and could strand an analysis already paid for.
  const ids = [article.id, ...siblings.filter((c) => c.event_id === null).map((c) => c.id)];

  const { error: linked } = await db
    .from("articles")
    .update({ event_id: event.id })
    .in("id", ids)
    .is("event_id", null);

  if (linked) return failure(`linking articles to ${event.id}: ${linked.message}`);

  return {
    articleId: article.id,
    title: article.title,
    decision: ids.length > 1 ? "created" : "alone",
    eventId: event.id,
    detail: ids.length > 1 ? `${why}, ${ids.length} articles` : why,
    candidates: candidateCount,
    siblings: ids.length - 1,
    promptTokens: 0,
    completionTokens: 0,
    shadowVerdict: null,
    shadowAgreed: null,
  };
}

/**
 * One line for a log or a commit message.
 *
 * Not called `describe`: `cron.ts` already exports one, and vitest injects one as
 * a global, so the plain name would collide in both places it is used.
 */
export function describeCluster(report: ClusterReport): string {
  const seconds = Math.round(
    (new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000,
  );

  const shadow =
    report.shadowDecidable > 0
      ? `, shadow ${report.shadowAgreed}/${report.shadowDecidable} agreed`
      : "";
  const skipped = report.aiSkipped > 0 ? `, ${report.aiSkipped} decided without AI` : "";
  const deferred = report.deferred > 0 ? `, ${report.deferred} capacity-deferred` : "";

  return (
    `cluster: ${report.considered} articles, ${report.attached} attached, ` +
    `${report.created} new events, ${report.alone} alone, ${report.ignored} ignored, ` +
    `${report.failed} failed${deferred}, ` +
    `${report.modelCalls} model calls, ` +
    `${report.promptTokens + report.completionTokens} tokens, ${seconds}s${shadow}${skipped}`
  );
}
