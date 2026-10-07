import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { fetchArticlePage, type FetchFailureKind } from "./article-fetch";
import { checkRobotsPermission } from "./robots";
import { extractMainText } from "./html-text";
import { selectEvidenceUnits } from "./evidence-extract";
import type { EvidenceUnit } from "@/lib/understand";
import { activeCutoff } from "./freshness";

type Db = SupabaseClient<Database>;

/**
 * Deterministic article-page enrichment: fetch an article's own public page
 * once, extract short structured facts, discard the page. See the 0090
 * migration for why this exists and what it does not do (no paywall bypass,
 * no crawling beyond URLs the pipeline already collected, no AI call).
 *
 * This is a dedicated pipeline stage, not something Read triggers -- see
 * `cron.ts`'s minute-0 slot. Opening Read never performs a network fetch.
 *
 * ---------------------------------------------------------------------------
 * Worst-case subrequest accounting (Workers free plan: 50/invocation)
 * ---------------------------------------------------------------------------
 *
 * Setup: up to 14 DB calls (flag check, reader-visible event ids: user_events
 * + deliveries + digest_items in two `.in()` chunks, candidate articles in
 * two `.in()` chunks — the arm caps at 400 event ids, past one URL —, the
 * evidence check over the whole arm in up to four `.in()` chunks of 200, a
 * possible stale-claim reclaim, and — only when the arm survives filtering
 * with less than a tick's worth of eligible rows — the recency fallback's
 * candidates and evidence check).
 * -- or just 1 if the flag is off, since the function returns immediately.
 *
 * Per article, worst case (a source never checked before, both robots.txt and
 * the article page redirecting the maximum allowed number of times, and the
 * fetch ultimately failing):
 *   DB:      insert claim (1) + robots-cache write (1) + finish (1)
 *            + source-failure-count write (1)                    = 4
 *   Network: robots.txt: 1 + MAX_REDIRECTS(2)                     = 3
 *            article page: 1 + MAX_REDIRECTS(2)                   = 3
 *   Subtotal per article                                          = 10
 *
 * At ENRICH_LIMIT articles per tick, all from distinct never-seen sources
 * (the same-run robots cache only helps when articles share a source, so this
 * is the true ceiling, not softened by it):
 *
 *   ENRICH_LIMIT * 10 + 10 setup <=  50
 *
 * With ENRICH_LIMIT = 3: 3*10 + 14 = 44, leaving 6 (12%) of margin under the
 * free-plan ceiling even in this pessimal case. Raising ENRICH_LIMIT or the
 * arm cap requires re-doing this arithmetic, not just editing the constant.
 *
 * Audit 32 note: reading the arm in full — instead of a newest-60 slice plus
 * a refill pass — costs one extra evidence chunk but drops the refill's three
 * calls, so the ceiling is unchanged while the tick can now reach every
 * reader-visible event the cap admits.
 *
 * Audit 36 note: the spare-capacity recovery probe adds nothing to a tick
 * that uses all three slots (40 of the 40 recent ticks did — see
 * `scripts/audit36-probe-census.ts`), because the probe's setup read only
 * runs when a slot went spare. A probing tick pays one setup read (the
 * backed-off sources' articles with their evidence status nested, answering
 * lifetime success, last failure and unattempted rows in one query) plus the
 * probe article's own worst case: 2*10 + 15 = 35, under the ceiling.
 *
 * Throughput comes from the schedule, not this constant: STAGES_CRON fires this
 * stage six times an hour, so 6 * 3 = 18 articles an hour against an arrival
 * rate of about 13.
 */

export type EnrichOptions = {
  limit?: number;
  dryRun?: boolean;
  /** Force one specific article, bypassing the feature flag -- for the CLI. */
  articleId?: string;
  now?: Date;
};

export type OutcomeReason =
  | "success"
  | "no_url_or_source"
  | "already_claimed"
  | "source_backoff"
  | "robots_blocked"
  | "robots_unknown"
  | FetchFailureKind
  | "thin_content"
  | "extraction_error";

export type ArticleOutcome = {
  articleId: string;
  decision: "enriched" | "unavailable" | "blocked" | "failed" | "skipped";
  reason: OutcomeReason;
  evidenceUnits: number;
  detail: string;
};

export type EnrichReport = {
  startedAt: string;
  finishedAt: string;
  considered: number;
  enriched: number;
  blocked: number;
  unavailable: number;
  failed: number;
  skipped: number;
  evidenceUnits: number;
  /** Per-reason tally across every outcome -- the breakdown a go/no-go review needs. */
  reasons: Partial<Record<OutcomeReason, number>>;
  /** What the spare-capacity recovery probe did (Audit 43). */
  probe: ProbeDecision;
  outcomes: ArticleOutcome[];
};

/**
 * What the spare-capacity recovery probe did on this tick (Audit 43).
 *
 * The gate is `todo.length < limit && backedOff.length > 0`, and that condition
 * is invisible in the tick's counters: `considered - skipped` equals
 * `todo.length - todoSkips`, because `considered` counts the backed-off rows
 * too and `skipped` counts them first. A full tick whose selection lost one
 * article to a pre-attempt skip therefore reports exactly the numbers a spare
 * tick reports (measured: Audit 43), so whether the probe was ever given a slot
 * cannot be inferred from the run row. The arbiter's ruling: record the
 * decision instead.
 *
 * `gate_closed`  no slot went spare — or a manual single-article run, which
 *                never probes.
 * `no_candidate` the gate opened and `selectProbeCandidate` found nothing: no
 *                source passed the cooldown/idle/robots filters, no unattempted
 *                article was young enough, or the history read failed (recovery
 *                work never costs the tick, so a failed read looks like this).
 * `fired`        the probe took the spare slot; the ids name the work it took.
 */
export type ProbeDecision =
  | { decision: "gate_closed" }
  | { decision: "no_candidate" }
  | { decision: "fired"; articleId: string; sourceId: string | null };

/**
 * The probe decision as `pipeline_runs.reason_counts` records it.
 *
 * Flat keys, because that column is read in SQL: `reason_counts->>'probe'`
 * answers "did the gate open", and the paired ids answer "on what".
 */
export function probeRunFields(probe: ProbeDecision): Record<string, string> {
  if (probe.decision !== "fired") return { probe: probe.decision };
  return {
    probe: "fired",
    probe_article_id: probe.articleId,
    ...(probe.sourceId ? { probe_source_id: probe.sourceId } : {}),
  };
}

/**
 * Articles enriched per tick. See the worst-case accounting above -- this
 * number is load-bearing, not a rough guess.
 */
const ENRICH_LIMIT = 3;
/** Below this many words of extracted body text, treat the page like a paywall/thin page: fall back rather than enrich from noise. */
const MIN_USABLE_WORDS = 60;
/**
 * Rows the fallback arm reads. The priority arm no longer slices at all — see
 * `armCandidates` — so this bounds only the recency fallback, where sixty is
 * still the right shape: the fallback exists for the moments the arm comes up
 * empty, not for draining it.
 */
const CANDIDATE_WINDOW_ROWS = 60;
/**
 * Rows read per arm chunk before the eligibility filters. The arm is read in
 * full — Audit 31 measured the old newest-60 slice excluding 21 of the 23
 * control events by publish recency alone, while 60 slots held 32 done and 28
 * backoff rows and supplied nothing — so the eligibility filters run over the
 * whole arm and the slice happens last. Bounded per chunk so a reader burst
 * cannot turn one tick into a scan: 400 events carry roughly one article each,
 * so 400 rows per 200-id chunk leaves generous headroom.
 */
const ARM_ROW_CAP = 400;
/**
 * Consecutive enrichment failures (fetch/extraction, not robots) before a
 * source's remaining articles are skipped for the rest of this run and future
 * ones, until a success resets it. Mirrors `ingest.ts`'s `failure_count`
 * backoff in spirit -- a source that is currently broken should not have every
 * new article it publishes cost a fetch -- but as a simple threshold rather
 * than a time-based table, since each article is only ever attempted once
 * regardless of outcome (there is no retry loop to space out).
 */
const ENRICHMENT_FAILURE_THRESHOLD = 5;

/**
 * Hours a recoverable source must sit after its newest failed enrichment
 * attempt before the spare-capacity probe may try it again (Audit 36).
 *
 * The cooldown is derived, not stored: no schema column records when a probe
 * failed, and the stage already timestamps every finished attempt in
 * `article_evidence.extracted_at`, so the newest failed or unavailable row is
 * the honest last-probe time. Deriving it keeps `enrichment_failure_count` as
 * the only probe-relevant state the stage writes — no migration, no second
 * lifecycle to keep consistent with the counter the latch already owns.
 */
const PROBE_COOLDOWN_HOURS = 24;
/**
 * How far back the probe's cooldown read looks: failures older than this
 * window are past any cooldown that matters, so the read stays bounded while
 * "no failure seen in seven days" remains a strictly stronger answer than
 * "cooldown elapsed". The window carries no semantic weight beyond the
 * cooldown — eligibility's lifetime-success signal lives on the source row
 * itself (`enrichment_last_success`, Audit 37) — and the read paginates to
 * its end so a large corpus cannot silently truncate the failures it does
 * return (PostgREST caps a single request at 1000 rows; the Audit 37
 * investigation was itself caught by that cap).
 */
const PROBE_HISTORY_DAYS = 7;
/** Rows per page of the probe's history read (one request caps at 1000). */
const PROBE_HISTORY_PAGE = 500;
/**
 * The oldest article a probe will offer. The normal scheduler refuses work
 * this old for measured reasons (Audit 33: the starved band yielded zero
 * evidence units on every attempt), so recovery work holds itself to the
 * productive band's floor rather than re-litigating that decision with spare
 * capacity.
 */
const PROBE_MAX_ARTICLE_AGE_HOURS = 72;
/**
 * Days a backed-off source with no lifetime success must sit idle before the
 * probe may try it (Audit 38).
 *
 * Five failures say enrichment is unreliable right now, not that the feed can
 * never be enriched. The Audit 38 census measured four latched families with
 * no lifetime success holding 1,023 unattempted articles that no code path
 * could ever retry — normal selection refuses a latched source before any
 * attempt, and the probe required a lifetime success. The clock is the source
 * row's own `enrichment_last_attempt_at`, never `article_evidence`: some
 * failure paths move the counter without writing an evidence row, so evidence
 * is not a complete attempt log, and reading it as one is the same
 * bounded-read mistake Audit 37 corrected. Fourteen days is twice the probe's
 * history window: long enough that a broken feed is not poked repeatedly,
 * short enough that a feed fixed after a bad fortnight returns without a human.
 */
const PROBE_IDLE_DAYS = 14;

type CandidateSource = {
  id: string;
  name: string | null;
  homepage: string | null;
  enrichment_allowed: boolean | null;
  enrichment_failure_count: number;
  /** Newest successful enrichment ever (Audit 37); null = never succeeded. */
  enrichment_last_success: string | null;
  /**
   * When the source was last attempted (Audit 38); null means no attempt is
   * recorded since the column existed, which the idle rule reads as long idle.
   */
  enrichment_last_attempt_at: string | null;
};

type Candidate = {
  id: string;
  title: string;
  url: string | null;
  /** Read only so the chunked arm read can be re-sorted into one window. */
  published_at: string;
  sources: CandidateSource | null;
};

async function enrichmentEnabled(db: Db): Promise<boolean> {
  const { data } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "article_enrichment_enabled")
    .maybeSingle();
  return data?.enabled === true;
}

function emptyReport(now: Date): EnrichReport {
  const at = now.toISOString();
  return {
    startedAt: at,
    finishedAt: at,
    considered: 0,
    enriched: 0,
    blocked: 0,
    unavailable: 0,
    failed: 0,
    skipped: 0,
    evidenceUnits: 0,
    reasons: {},
    probe: { decision: "gate_closed" },
    outcomes: [],
  };
}

export /**
 * Events a reader can still see, most recent touch first.
 *
 * The priority set for enrichment. These are the stories the next briefing and
 * the home feed draw from, and they are the only ones a reader can reach:
 * `article_evidence` is read while hydrating a dashboard, briefing, search or
 * saved view, so an article on an event nobody matched can never surface one.
 *
 * A *touch* is either a match (`user_events`) or a delivery (`digest_items`,
 * whose send time lives on the digest's `deliveries` row), and the window is
 * seven days, not the 24 hours this arm used to read. A match day that came
 * and went while the stage was busy used to strand the event permanently:
 * outside this arm for being older than a day, and outside the recency
 * fallback for being older than `activeCutoff` — which is how 145 events in
 * the 30-day evaluation window had matched or delivered readers and yet never
 * one enriched article (Audit 29). One reader touch should keep an event's
 * articles enrichable for as long as a reader can still open the story.
 *
 * Null means "no priority" rather than "no candidates" — any failure or an
 * empty set falls back to the recency window below rather than costing the
 * stage a run.
 */
const READER_VISIBLE_DAYS = 7;
/**
 * The cap the arm feeds: the newest reader-visible events by touch time. 400
 * matches the arm-row read caps, so the arm never asks for more ids than its
 * sources were read with. 400 uuids do not fit one `.in()` URL, so the
 * candidate read chunks them — see `ARM_ID_CHUNK`.
 */
const READER_VISIBLE_EVENT_CAP = 400;
/** Ids per `.in()` over the arm: 400 × 36-char uuids ≈ 15 KB, past a safe URL. */
const ARM_ID_CHUNK = 200;
/**
 * Rows read per arm before the merge. Bounded so a reader burst cannot turn
 * one tick into a scan; 400 because the `digest_items` `.in()` chunks below
 * are 200 wide and PostgREST silently returns nothing over ~400 ids.
 */
const READER_VISIBLE_ARM_ROWS = 400;

async function readerVisibleEventIds(db: Db, now: Date): Promise<string[] | null> {
  try {
    const since = new Date(now.getTime() - READER_VISIBLE_DAYS * 24 * 3_600_000).toISOString();
    /** `event_id` → the reader's most recent touch, which is the priority order. */
    const touched = new Map<string, string>();

    const { data: matches, error: matchError } = await db
      .from("user_events")
      .select("event_id, matched_at")
      .gte("matched_at", since)
      .order("matched_at", { ascending: false })
      .limit(READER_VISIBLE_ARM_ROWS);
    if (matchError) return null;
    for (const row of matches ?? []) {
      if (!row.event_id) continue;
      const prior = touched.get(row.event_id);
      if (!prior || row.matched_at > prior) touched.set(row.event_id, row.matched_at);
    }

    const { data: sends, error: sendError } = await db
      .from("deliveries")
      .select("digest_id, delivered_at")
      .gte("delivered_at", since)
      .order("delivered_at", { ascending: false })
      .limit(READER_VISIBLE_ARM_ROWS);
    if (sendError) return null;
    const deliveredAt = new Map<string, string>();
    for (const row of sends ?? []) {
      // `delivered_at` is nullable in the schema; the `.gte` above already
      // excludes the nulls, but the type does not know that.
      if (!row.delivered_at) continue;
      const prior = deliveredAt.get(row.digest_id);
      if (!prior || row.delivered_at > prior) deliveredAt.set(row.digest_id, row.delivered_at);
    }
    const digestIds = [...deliveredAt.keys()];
    for (let i = 0; i < digestIds.length; i += 200) {
      const { data: items, error: itemsError } = await db
        .from("digest_items")
        .select("digest_id, event_id")
        .in("digest_id", digestIds.slice(i, i + 200));
      if (itemsError) return null;
      for (const item of items ?? []) {
        if (!item.event_id) continue;
        const at = deliveredAt.get(item.digest_id);
        if (!at) continue;
        const prior = touched.get(item.event_id);
        if (!prior || at > prior) touched.set(item.event_id, at);
      }
    }

    if (touched.size === 0) return null;
    return [...touched.entries()]
      .sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? 1 : -1))
      .slice(0, READER_VISIBLE_EVENT_CAP)
      .map(([id]) => id);
  } catch {
    // Priority is an improvement, never a requirement: any failure here falls
    // back to the recency window below rather than costing the stage a run.
    return null;
  }
}

export async function enrich(db: Db, options: EnrichOptions = {}): Promise<EnrichReport> {
  const now = options.now ?? new Date();
  if (!options.articleId && !(await enrichmentEnabled(db))) return emptyReport(now);

  const limit = options.limit ?? ENRICH_LIMIT;
  const base = () => {
    const q = db
      .from("articles")
      .select(
        "id, title, url, published_at, sources ( id, name, homepage, enrichment_allowed, enrichment_failure_count, enrichment_last_success, enrichment_last_attempt_at )",
      )
      .not("event_id", "is", null)
      .not("url", "is", null)
      .order("published_at", { ascending: false });
    return options.articleId ? q.eq("id", options.articleId) : q;
  };

  // ---------------------------------------------------------------------------
  // Which articles are candidates, and in what order
  // ---------------------------------------------------------------------------
  // A reader-visible story is the only one worth a network fetch: `article_evidence`
  // is read for exactly the events hydrating a dashboard, briefing, search or
  // saved view, so an article nobody was ever matched to can never surface one.
  // The recency window on its own pointed the stage at the corpus rather than at
  // the news, and its newest-twelve reach meant a story older than about half an
  // hour was never a candidate at all -- which is how none of the 25 stories in
  // the 2026-09-30 briefing had an enriched body.
  let rows: Candidate[] = [];
  const priorityIds = options.articleId ? null : await readerVisibleEventIds(db, now);

  /**
   * The arm's candidate pool, read in full and ordered oldest-published first.
   *
   * Audit 31 falsified the cap as the primary bottleneck: after the arm cap
   * went 120 → 400, the 23 events that were inside the original cap drained 0
   * of 23, because the old newest-60-by-published_at slice never reached them —
   * their window ranks were 62-312 of 406 arm articles. So the eligibility
   * filters now run over the WHOLE arm and the slice happens last, which also
   * retires the dead-head refill pass: a window that is filtered before it is
   * cut cannot have a dead head to walk past.
   *
   * Ordering is starvation-first. Every candidate surviving the filters is one
   * that has never been attempted (a finished evidence row of any status, or a
   * source at the failure-backoff threshold, removes it), so there is no
   * last-attempt variance left to sort on and article age is the honest
   * starvation signal: the oldest has been waiting longest, and the arm's own
   * 7-day touch cap already bounds how old can enter. A fresh arrival still
   * clears within a tick or two of the pool emptying, which the drain rate
   * (3/tick) reaches long before inflow does.
   *
   * The event ids travel in `.in()` URLs, so they are chunked; each page is
   * bounded and the merge is re-sorted, because a chunk boundary must not
   * decide which articles a tick sees. One failed chunk fails the arm — the
   * recency fallback answers, exactly as the single read did.
   */
  const armCandidates = async (): Promise<Candidate[]> => {
    const ids = priorityIds ?? [];
    const merged: Candidate[] = [];
    for (let i = 0; i < ids.length; i += ARM_ID_CHUNK) {
      const { data, error } = await base()
        .in("event_id", ids.slice(i, i + ARM_ID_CHUNK))
        .limit(ARM_ROW_CAP);
      if (error) throw new Error(`reading priority arm: ${error.message}`);
      merged.push(...((data ?? []) as unknown as Candidate[]));
    }
    return merged.sort((a, b) => {
      const at = (candidate: Candidate): number => Date.parse(candidate.published_at) || 0;
      return at(a) - at(b);
    });
  };

  // A candidate is dead until proven eligible: a finished evidence row (any
  // status) or a source at the failure backoff removes it from this tick. Both
  // filters run over the whole arm BEFORE anything is sliced — the slice now
  // happens at `todo` below, on the survivors, so neither a dead head (Audit
  // 29-B) nor a publish-recency window (Audit 31) can hide the backlog.
  const done = new Set<string>();
  const readEvidence = async (candidates: Candidate[]): Promise<void> => {
    const ids = candidates.map((a) => a.id);
    // Chunked: the arm is read in full now, so this can carry several hundred
    // ids and a single `.in()` URL does not survive that.
    const abandoned: string[] = [];
    for (let i = 0; i < ids.length; i += ARM_ID_CHUNK) {
      const existing = await db
        .from("article_evidence")
        .select("article_id, status")
        .in("article_id", ids.slice(i, i + ARM_ID_CHUNK));
      if (existing.error) throw new Error(`reading article_evidence: ${existing.error.message}`);
      // A `pending` row is a claim some earlier run died holding. There is no
      // timestamp on a claim — `extracted_at` is written when the work
      // *finishes* — so age cannot be measured, and it does not have to be:
      // this stage fires on its own cron minutes and walks its batch
      // sequentially, so a pending row seen at the start of a run is not from
      // this run.
      for (const row of existing.data ?? []) {
        if (row.status === "pending") abandoned.push(row.article_id);
        else done.add(row.article_id);
      }
    }
    // Reclaim before claiming. Best effort: if this fails the claim below
    // simply reports `already_claimed`, which is the behaviour we have today,
    // so a database that refuses the delete cannot cost the stage its run.
    if (abandoned.length > 0) {
      try {
        await db
          .from("article_evidence")
          .delete()
          .in("article_id", abandoned)
          .eq("status", "pending");
      } catch {
        // left for a later run
      }
    }
  };

  if (priorityIds) {
    try {
      rows = await armCandidates();
      await readEvidence(rows);
    } catch {
      rows = [];
    }
  }
  await readEvidence(rows);

  const backedOff: Candidate[] = [];
  const eligible: Candidate[] = [];
  const classify = (candidates: Candidate[]): void => {
    for (const article of candidates) {
      if (done.has(article.id)) continue;
      const failures = article.sources?.enrichment_failure_count ?? 0;
      if (!options.articleId && failures >= ENRICHMENT_FAILURE_THRESHOLD) backedOff.push(article);
      else eligible.push(article);
    }
  };
  classify(rows);

  // The fallback arm, judged from the post-filter count: a window clogged with
  // done or backed-off rows must not inert it (Audit 29-B).
  if (eligible.length < limit && !options.articleId) {
    const { data, error } = await base()
      .gte("published_at", activeCutoff(now).toISOString())
      .limit(CANDIDATE_WINDOW_ROWS);
    if (error) throw new Error(`reading enrichment candidates: ${error.message}`);
    const seen = new Set(rows.map((r) => r.id));
    const fresh = ((data ?? []) as unknown as Candidate[]).filter((r) => !seen.has(r.id));
    rows.push(...fresh);
    await readEvidence(fresh);
    classify(fresh);
  }
  if (rows.length === 0 && options.articleId) {
    const { data, error } = await base();
    if (error) throw new Error(`reading enrichment candidates: ${error.message}`);
    rows = (data ?? []) as unknown as Candidate[];
    await readEvidence(rows);
    classify(rows);
  }

  const todo = interleaveBands(eligible, limit, now);

  // ---------------------------------------------------------------------------
  // Spare-capacity recovery probe (Audit 36)
  // ---------------------------------------------------------------------------
  // The failure backoff is a one-way latch: `classify` above excludes sources
  // at the threshold before any attempt is made, so `recordSourceOutcome`'s
  // reset path is unreachable for them and a source that accumulates five
  // failures stays parked even after its feed recovers. The arbiter's ruling
  // on the fix: recovery work may consume idle capacity, but it may never
  // compete with productive work. So the probe runs only when normal selection
  // left slots unused, takes at most one of them per tick, and treats a source
  // as recoverable on either of two signals: a lifetime enrichment success, or
  // PROBE_IDLE_DAYS without an attempt even though it has never succeeded
  // (Audit 38 — a feed the pipeline could not parse today is not a verdict on
  // the feed). A successful probe flows through `enrichOne` like any other
  // attempt, so `recordSourceOutcome(..., true)` resets the counter and the
  // source re-enters the normal pool with no duplicate reset logic.
  // The decision is recorded rather than left to be inferred (Audit 43): the
  // run row cannot tell a spare slot from a full selection that lost one
  // article to a pre-attempt skip, so "did the recovery probe ever fire" has no
  // answer without this field.
  let probe: ProbeDecision = { decision: "gate_closed" };
  if (!options.articleId && todo.length < limit && backedOff.length > 0) {
    const candidate = await selectProbeCandidate(db, backedOff, limit - todo.length, now);
    if (candidate) {
      probe = {
        decision: "fired",
        articleId: candidate.id,
        sourceId: candidate.sources?.id ?? null,
      };
      todo.push(candidate);
      // The probed article leaves the backoff tally: it is this tick's work
      // now, and reporting it as both skipped and enriched would double-count
      // it in the go/no-go breakdown.
      backedOff.splice(backedOff.indexOf(candidate), 1);
    } else {
      probe = { decision: "no_candidate" };
    }
  }

  // Bounds every source's robots.txt to at most one check per run, even when
  // several of this run's articles share a domain -- without it, each would
  // independently see the same stale `enrichment_allowed: null` snapshot from
  // the query above and re-fetch robots.txt for itself.
  const robotsCache = new Map<string, RobotsCheck>();

  const outcomes: ArticleOutcome[] = backedOff.map((article) => ({
    articleId: article.id,
    decision: "skipped",
    reason: "source_backoff",
    evidenceUnits: 0,
    detail: "Source has repeated recent enrichment failures; skipping until it succeeds again",
  }));
  for (const article of todo) {
    outcomes.push(await enrichOne(db, article, options.dryRun === true, robotsCache));
  }

  const reasons: Partial<Record<OutcomeReason, number>> = {};
  for (const outcome of outcomes) reasons[outcome.reason] = (reasons[outcome.reason] ?? 0) + 1;

  return {
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    considered: todo.length + backedOff.length,
    enriched: outcomes.filter((o) => o.decision === "enriched").length,
    blocked: outcomes.filter((o) => o.decision === "blocked").length,
    unavailable: outcomes.filter((o) => o.decision === "unavailable").length,
    failed: outcomes.filter((o) => o.decision === "failed").length,
    skipped: outcomes.filter((o) => o.decision === "skipped").length,
    evidenceUnits: outcomes.reduce((n, o) => n + o.evidenceUnits, 0),
    reasons,
    probe,
    outcomes,
  };
}

/**
 * Age at which an eligible candidate moves from the productive band into the
 * starvation band. Measured, not sacred: the first post-deploy census found the
 * arm's oldest eligible cohort at 72-96h yielding zero evidence units on every
 * attempt, while 192 extractable candidates sat at 24-48h behind it, so a pure
 * starvation order would spend ~2.5 hours of capacity proving old pages were
 * old before reaching anything usable (Audit 33).
 */
const STARVED_BAND_HOURS = 72;
/** Slots per interleave group: 1 starved, 2 productive — repeat to `limit`. */
const STARVED_SLOTS = 1;
const PRODUCTIVE_SLOTS = 2;

/**
 * Audit 33's scheduling experiment: old work keeps a guaranteed share of every
 * tick, but never the whole tick.
 *
 * `eligible` arrives ordered oldest-first, so each band is already in its own
 * starvation order and the interleave only decides how the tick's slots are
 * split. A band that runs dry surrenders its slots to the other rather than
 * leaving capacity idle, and when one band is empty the tick behaves exactly
 * as strict oldest-first would — so the split is a share, never a reservation
 * that can starve the other side.
 */
function interleaveBands(eligible: Candidate[], limit: number, now: Date): Candidate[] {
  const cutoff = now.getTime() - STARVED_BAND_HOURS * 3_600_000;
  const starved = eligible.filter((c) => (Date.parse(c.published_at) || 0) < cutoff);
  const productive = eligible.filter((c) => (Date.parse(c.published_at) || 0) >= cutoff);
  const todo: Candidate[] = [];
  let starvedIndex = 0;
  let productiveIndex = 0;
  // Bounded by `limit` groups: each pass consumes at least one candidate while
  // either band has work, so the loop always terminates at `limit` slots or an
  // empty pool, whichever comes first. A band that runs dry mid-group simply
  // yields its remaining slots to the other.
  for (
    let group = 0;
    group < limit &&
    todo.length < limit &&
    (starvedIndex < starved.length || productiveIndex < productive.length);
    group += 1
  ) {
    for (let slot = 0; slot < STARVED_SLOTS && todo.length < limit; slot += 1) {
      const next = starved[starvedIndex];
      starvedIndex += 1;
      if (next) todo.push(next);
    }
    for (let slot = 0; slot < PRODUCTIVE_SLOTS && todo.length < limit; slot += 1) {
      const next = productive[productiveIndex];
      productiveIndex += 1;
      if (next) todo.push(next);
    }
  }
  return todo;
}

type ProbeHistoryRow = {
  id: string;
  source_id: string | null;
  published_at: string;
  article_evidence: { status: string | null; extracted_at: string | null } | null;
};

/**
 * The one candidate a spare-capacity tick may probe, or null.
 *
 * Eligibility follows the Audit 36/37/38 rulings: the source must be backed
 * off AND recoverable, which means either a lifetime enrichment success — read
 * from the source's own `enrichment_last_success` marker, so eligibility
 * survives the bounded history window (a success-published-within-7-days
 * predicate silently re-latched the only historically productive latched
 * source; Audit 37) — or an attempt older than PROBE_IDLE_DAYS for a source
 * that has never succeeded (Audit 38). The source's newest failed attempt must
 * also be older than the cooldown, and the article itself must be unattempted
 * and young enough to be worth extracting (see `PROBE_MAX_ARTICLE_AGE_HOURS`).
 *
 * One paginated read answers the rest: the cooldown signal (newest
 * failed/unavailable `extracted_at`) and the unattempted pool, from
 * `article_evidence(status, extracted_at)` nested on `articles` — the column
 * is the table's primary key, so the embed is one-to-one and returns a single
 * row or null. Pages are read until the source's window is exhausted; a
 * single request is capped by PostgREST at 1000 rows, and a truncated read
 * would both hide fresh failures from the cooldown and lie about the pool.
 */
async function selectProbeCandidate(
  db: Db,
  backedOff: Candidate[],
  spareSlots: number,
  now: Date,
): Promise<Candidate | null> {
  if (spareSlots < 1) return null;
  const cutoff = new Date(now.getTime() - PROBE_HISTORY_DAYS * 24 * 3_600_000).toISOString();

  try {
    // One article per backed-off source enters this list, but several can
    // share a source; `.in()` dedupes server-side and the URL budget does not
    // (400 uuids is the size PostgREST silently refuses — see ARM_ID_CHUNK).
    const sourceIds = [
      ...new Set(backedOff.map((a) => a.sources?.id).filter((id): id is string => !!id)),
    ];
    const rows: ProbeHistoryRow[] = [];
    for (let i = 0; i < sourceIds.length; i += ARM_ID_CHUNK) {
      // Paginate to the end of the window: the first page caps at 1000 rows
      // server-side, and a truncated history would misread the cooldown.
      for (let offset = 0; ; offset += PROBE_HISTORY_PAGE) {
        const { data, error } = await db
          .from("articles")
          .select("id, source_id, published_at, article_evidence(status, extracted_at)")
          .gte("published_at", cutoff)
          .in("source_id", sourceIds.slice(i, i + ARM_ID_CHUNK))
          .order("id", { ascending: true })
          .range(offset, offset + PROBE_HISTORY_PAGE - 1);
        if (error) return null;
        const page = (data ?? []) as unknown as ProbeHistoryRow[];
        rows.push(...page);
        if (page.length < PROBE_HISTORY_PAGE) break;
      }
    }

    const newestFailure = new Map<string, string>();
    const unattempted: ProbeHistoryRow[] = [];
    for (const row of rows) {
      // The history is matched to its source through the row's own source_id,
      // not through the arm: a source's failures usually sit on events no
      // reader currently sees, so they are precisely the rows the arm does
      // not hold.
      const sourceId = row.source_id;
      if (!sourceId) continue;
      const evidence = row.article_evidence;
      if (!evidence) {
        unattempted.push(row);
        continue;
      }
      if (evidence.status === "failed" || evidence.status === "unavailable") {
        const at = evidence.extracted_at;
        if (at) {
          const prior = newestFailure.get(sourceId);
          if (!prior || at > prior) newestFailure.set(sourceId, at);
        }
      }
    }

    const cooldownCutoff = new Date(now.getTime() - PROBE_COOLDOWN_HOURS * 3_600_000).getTime();
    const ageCutoff = now.getTime() - PROBE_MAX_ARTICLE_AGE_HOURS * 3_600_000;
    const idleCutoff = now.getTime() - PROBE_IDLE_DAYS * 24 * 3_600_000;
    const readySources = backedOff.filter((article) => {
      if (!article.sources) return false;
      // robots.txt already refused this source: a probe would claim, block and
      // finish one article after another without ever moving the counter, so
      // the slot would be spent re-proving a known boundary every spare tick.
      if (article.sources.enrichment_allowed === false) return false;
      // Lifetime productivity is state on the source row: a marker means the
      // source has enriched at least once, ever (Audit 37). A source that has
      // never succeeded is recoverable only after PROBE_IDLE_DAYS without an
      // attempt (Audit 38), read from the source's own clock rather than from
      // evidence — evidence misses the failure paths that write no row. One
      // success is what un-latches it for good.
      const succeeded = article.sources.enrichment_last_success !== null;
      const lastAttempt = article.sources.enrichment_last_attempt_at;
      const idle = lastAttempt === null || Date.parse(lastAttempt) <= idleCutoff;
      if (!succeeded && !idle) return false;
      const lastFailure = newestFailure.get(article.sources.id);
      if (lastFailure && Date.parse(lastFailure) > cooldownCutoff) return false;
      return true;
    });
    if (readySources.length === 0) return null;

    const readyIds = new Set(readySources.map((a) => a.sources?.id ?? ""));
    const candidate = unattempted
      .filter(
        (row) =>
          row.source_id !== null &&
          readyIds.has(row.source_id) &&
          (Date.parse(row.published_at) || 0) >= ageCutoff,
      )
      .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at))
      .map((row) => backedOff.find((a) => a.sources?.id === row.source_id))
      .find((c): c is Candidate => c !== undefined);
    return candidate ?? null;
  } catch {
    // Recovery work never costs the tick: a probe that cannot read its own
    // history simply does not happen.
    return null;
  }
}

async function enrichOne(
  db: Db,
  article: Candidate,
  dryRun: boolean,
  robotsCache: Map<string, RobotsCheck>,
): Promise<ArticleOutcome> {
  const source = article.sources;
  if (!article.url || !source) {
    return {
      articleId: article.id,
      decision: "skipped",
      reason: "no_url_or_source",
      evidenceUnits: 0,
      detail: "No URL or source",
    };
  }

  try {
    if (!dryRun) {
      // The primary key is the lock: a concurrent worker racing this article
      // loses the insert (a real Postgres unique-violation error) and the
      // article is left for a later tick, exactly as `event_understanding`
      // (0078) already does this. FakeDb cannot simulate the conflict itself
      // -- see enrich.test.ts -- but the guarantee is Postgres's, not this
      // code's, the same guarantee 0078 already relies on in production.
      const claim = await db
        .from("article_evidence")
        .insert({ article_id: article.id, status: "pending" });
      if (claim.error) {
        return {
          articleId: article.id,
          decision: "skipped",
          reason: "already_claimed",
          evidenceUnits: 0,
          detail: "Already claimed",
        };
      }
    }

    const robots = await sourceAllowed(db, source, article.url, dryRun, robotsCache);
    if (!robots.allowed) {
      if (!dryRun) {
        await finish(db, article.id, "blocked", [], 0);
        await recordSourceAttempt(db, source.id, robots.reason);
      }
      return {
        articleId: article.id,
        decision: "blocked",
        reason: robots.reason,
        evidenceUnits: 0,
        detail:
          robots.reason === "robots_blocked"
            ? "robots.txt disallows this path"
            : "robots.txt permission could not be determined safely; not fetching",
      };
    }

    const fetched = await fetchArticlePage(article.url);
    if (!fetched.ok) {
      if (!dryRun) {
        await finish(db, article.id, "unavailable", [], 0);
        await recordSourceOutcome(db, source, { ok: false, reason: fetched.kind });
      }
      return {
        articleId: article.id,
        decision: "unavailable",
        reason: fetched.kind,
        evidenceUnits: 0,
        detail: fetched.reason,
      };
    }

    const mainText = extractMainText(fetched.html);
    const wordCount = mainText.trim() === "" ? 0 : mainText.trim().split(/\s+/).length;
    if (wordCount < MIN_USABLE_WORDS) {
      if (!dryRun) {
        await finish(db, article.id, "unavailable", [], wordCount);
        await recordSourceOutcome(db, source, { ok: false, reason: "thin_content" });
      }
      return {
        articleId: article.id,
        decision: "unavailable",
        reason: "thin_content",
        evidenceUnits: 0,
        detail: `Only ${wordCount} words of extractable text (paywall or non-article page)`,
      };
    }

    const units = selectEvidenceUnits(mainText, undefined, article.title, {
      name: source.name ?? undefined,
      url: article.url,
    });
    if (!dryRun) {
      await finish(db, article.id, "enriched", units, wordCount);
      await recordSourceOutcome(db, source, { ok: true });
    }
    return {
      articleId: article.id,
      decision: "enriched",
      reason: "success",
      evidenceUnits: units.length,
      detail: `${units.length} evidence units from ${wordCount} words`,
    };
  } catch (error) {
    if (!dryRun) {
      await finish(db, article.id, "failed", [], 0).catch(() => undefined);
      await recordSourceOutcome(db, source, { ok: false, reason: "extraction_error" }).catch(
        () => undefined,
      );
    }
    return {
      articleId: article.id,
      decision: "failed",
      reason: "extraction_error",
      evidenceUnits: 0,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

type RobotsCheck =
  { allowed: true } | { allowed: false; reason: "robots_blocked" | "robots_unknown" };

async function sourceAllowed(
  db: Db,
  source: CandidateSource,
  articleUrl: string,
  dryRun: boolean,
  robotsCache: Map<string, RobotsCheck>,
): Promise<RobotsCheck> {
  const cached = robotsCache.get(source.id);
  if (cached !== undefined) return cached;

  if (source.enrichment_allowed !== null) {
    const result: RobotsCheck = source.enrichment_allowed
      ? { allowed: true }
      : { allowed: false, reason: "robots_blocked" };
    robotsCache.set(source.id, result);
    return result;
  }

  let origin: string;
  let path: string;
  try {
    const url = new URL(articleUrl);
    origin = url.origin;
    path = url.pathname + url.search;
  } catch {
    const result: RobotsCheck = { allowed: false, reason: "robots_unknown" };
    robotsCache.set(source.id, result);
    return result;
  }

  const { decision, definitive } = await checkRobotsPermission(origin, path);
  const allowed = decision === "allowed";
  const result: RobotsCheck = allowed
    ? { allowed: true }
    : { allowed: false, reason: decision === "blocked" ? "robots_blocked" : "robots_unknown" };
  // Cached for the rest of THIS run regardless of definitiveness, so a batch
  // with several articles from one still-ambiguous domain does not re-fetch
  // its robots.txt for each one. Only a definitive answer is persisted to the
  // database, so an ambiguous result gets a fresh chance next run.
  robotsCache.set(source.id, result);
  if (!dryRun && definitive) {
    await db
      .from("sources")
      .update({ enrichment_allowed: allowed, robots_checked_at: new Date().toISOString() })
      .eq("id", source.id);
  }
  return result;
}

/**
 * The source's attempt clock on its own (Audit 38), for the one concluding
 * path that does not move the counter: a robots-blocked article. Without it a
 * source whose robots answer stays ambiguous would read as idle forever and be
 * probed every PROBE_IDLE_DAYS without the clock ever moving. The refusal is
 * recorded alongside it (Audit 40) so a parked source's reason is answerable
 * without a survey against the live web.
 */
async function recordSourceAttempt(db: Db, sourceId: string, failureReason: string): Promise<void> {
  await db
    .from("sources")
    .update({
      enrichment_last_attempt_at: new Date().toISOString(),
      enrichment_last_failure_reason: failureReason,
    })
    .eq("id", sourceId);
}

/** The conclusion of one enrichment attempt, as the source row records it. */
type SourceOutcome = { ok: true } | { ok: false; reason: string };

async function recordSourceOutcome(
  db: Db,
  source: CandidateSource,
  outcome: SourceOutcome,
): Promise<void> {
  const now = new Date().toISOString();
  if (outcome.ok) {
    // The marker must move even when the counter is already 0 — the old
    // early-return was the whole body, and a success on a healthy source
    // would never refresh its recovery signal (Audit 37). The attempt clock
    // moves with it: a source that just succeeded has not been idle (Audit 38).
    // A cleared reason keeps the column's meaning honest: non-null always means
    // the newest concluded attempt failed (Audit 40).
    await db
      .from("sources")
      .update({
        enrichment_failure_count: 0,
        enrichment_last_success: now,
        enrichment_last_attempt_at: now,
        enrichment_last_failure_reason: null,
      })
      .eq("id", source.id);
    return;
  }
  // The clock is written on the failure path too: this is what arms the idle
  // rule for a source that has never succeeded, so a probe that fails waits
  // another PROBE_IDLE_DAYS instead of returning on the next spare tick
  // (Audit 38). The reason rides along (Audit 40): observational only, read by
  // nothing, but it is the difference between "parked" and "parked because the
  // origin refuses us".
  await db
    .from("sources")
    .update({
      enrichment_failure_count: source.enrichment_failure_count + 1,
      enrichment_last_attempt_at: now,
      enrichment_last_failure_reason: outcome.reason,
    })
    .eq("id", source.id);
}

async function finish(
  db: Db,
  articleId: string,
  status: "enriched" | "unavailable" | "blocked" | "failed",
  evidence: EvidenceUnit[],
  wordCount: number,
): Promise<void> {
  await db
    .from("article_evidence")
    .update({
      status,
      evidence: evidence as unknown as Json,
      source_word_count: wordCount,
      extracted_at: new Date().toISOString(),
      attempts: 1,
    })
    .eq("article_id", articleId);
}

export function describeEnrich(report: EnrichReport): string {
  const reasonSummary = Object.entries(report.reasons)
    .filter(([reason]) => reason !== "success")
    .map(([reason, count]) => `${String(reason)}=${count}`)
    .join(" ");
  // The probe's decision rides the log line too (Audit 43), so `wrangler tail`
  // answers the same question the run row does.
  const probeSummary =
    report.probe.decision === "fired"
      ? `probe fired: ${report.probe.articleId}`
      : `probe: ${report.probe.decision}`;
  return (
    `enrich: ${report.enriched} enriched, ${report.blocked} blocked, ${report.unavailable} unavailable, ` +
    `${report.failed} failed, ${report.skipped} skipped, ${report.considered} considered ` +
    `(${report.evidenceUnits} evidence units)` +
    (reasonSummary ? ` [${reasonSummary}]` : "") +
    ` [${probeSummary}]`
  );
}
