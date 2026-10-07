/**
 * Audit 36 — spare-capacity recovery probe census.
 *
 * The arbiter approved a conditional probe: when a tick's normal candidate
 * selection uses fewer than ENRICH_LIMIT slots, at most one parked article may
 * be attempted, and only from a source that has enriched at least once ever
 * (`sources.enrichment_last_success`, Audit 37), is not robots-refused, and
 * whose newest recorded failure is past the 24h cooldown. This instrument
 * measures:
 *   - the backed-off sources (failure_count >= 5), split by eligibility;
 *   - events and articles parked behind each, and their evidence status;
 *   - the newest failed attempt per source (the cooldown signal the probe
 *     derives from article_evidence.extracted_at);
 *   - per-tick utilization from pipeline_runs: how often recent enrich ticks
 *     used all three slots, i.e. how often a probe slot could even open;
 *   - with `--since <iso>`, the observation window: attempts that appear
 *     after the probe went live, marker moves, and the tick history in that
 *     window.
 *
 * Two counts that are not the same thing, kept apart on purpose (Audit 39
 * ruling): "raw parked articles" is every unattempted article behind a source
 * latch, which is a diagnostic number, and "currently recoverable work" is the
 * part inside the scheduler's 72h freshness window. Recovery restores a source
 * to normal selection; it does not authorize historical backfill outside that
 * boundary, so the older band is not reader-facing unmet work and must not be
 * reported as if it were.
 *
 * PostgREST caps one request at 1000 rows, so every read that can exceed the
 * cap is paged explicitly. The first version of this instrument read all
 * backed-off sources in one chunked `.in()` query; the rows summed to the cap
 * exactly and the last source was silently truncated, which produced a wrong
 * census and a wrong report. Pages stay well under the cap.
 *
 * SELECT only, service-role client. Node 22 or later.
 */

import { writeFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

/** Rows per request. Half the server's 1000-row cap, so a lowered cap still pages. */
const PAGE = 500;

/** Mirrors PROBE_HISTORY_DAYS in src/lib/pipeline/enrich.ts. */
const PROBE_HISTORY_DAYS = 7;
/** Mirrors PROBE_COOLDOWN_HOURS in src/lib/pipeline/enrich.ts. */
const PROBE_COOLDOWN_HOURS = 24;
/** Mirrors PROBE_MAX_ARTICLE_AGE_HOURS in src/lib/pipeline/enrich.ts. */
const PROBE_MAX_ARTICLE_AGE_HOURS = 72;
/** Mirrors PROBE_IDLE_DAYS in src/lib/pipeline/enrich.ts (Audit 38). */
const PROBE_IDLE_DAYS = 14;
/** Mirrors ENRICH_LIMIT in src/lib/pipeline/enrich.ts. */
const ENRICH_LIMIT = 3;

type SourceRow = {
  id: string;
  name: string | null;
  enrichment_failure_count: number;
  enrichment_allowed: boolean | null;
  enrichment_last_success: string | null;
  enrichment_last_attempt_at: string | null;
  /** Why the newest concluded attempt failed (Audit 40); null = none recorded. */
  enrichment_last_failure_reason: string | null;
  robots_checked_at: string | null;
};

type ArticleRow = {
  id: string;
  sourceId: string;
  event_id: string | null;
  title: string | null;
  published_at: string;
};

type Evidence = { status: string | null; extracted_at: string | null };

type EnrichRunRow = {
  started_at: string;
  considered: number | null;
  processed: number | null;
  skipped: number | null;
  /** Free-form Json: `metrics_recorded`, and Audit 43's probe decision. */
  reason_counts: unknown;
};

/** The probe decision a tick recorded (Audit 43), or null on older rows. */
type ProbeRecord = { decision: string; articleId: string | null; sourceId: string | null };

function probeOf(reasonCounts: unknown): ProbeRecord | null {
  if (typeof reasonCounts !== "object" || reasonCounts === null) return null;
  const record = reasonCounts as Record<string, unknown>;
  if (typeof record["probe"] !== "string") return null;
  const field = (key: string): string | null =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  return {
    decision: record["probe"] as string,
    articleId: field("probe_article_id"),
    sourceId: field("probe_source_id"),
  };
}

main(async () => {
  const args = process.argv.slice(2);
  const argOf = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const out = argOf("--out");
  const since = argOf("--since") ?? null;
  const client = db();

  heading("Audit 36 — spare-capacity probe: census");

  // ---------------------------------------------------------------------------
  // 1. Backed-off sources, split by eligibility
  // ---------------------------------------------------------------------------
  const { data: backedOffSources, error: sourcesError } = await client
    .from("sources")
    .select(
      "id, name, enrichment_failure_count, enrichment_allowed, enrichment_last_success, enrichment_last_attempt_at, enrichment_last_failure_reason, robots_checked_at",
    )
    .gte("enrichment_failure_count", 5);
  if (sourcesError) throw new Error(`sources: ${sourcesError.message}`);
  const sources = (backedOffSources ?? []) as SourceRow[];
  say(rowLine("backed-off sources (failures >= 5)", sources.length));

  // Every article per backed-off source, paged to the end of the source. The
  // nested evidence embed is one-to-one (article_id is that table's primary
  // key), so a row means the article has been attempted exactly once.
  const articles: ArticleRow[] = [];
  const evidenceByArticle = new Map<string, Evidence>();
  const readSourceArticles = async (sourceId: string): Promise<ArticleRow[]> => {
    const rows: ArticleRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await client
        .from("articles")
        .select("id, event_id, title, published_at, article_evidence(status, extracted_at)")
        .eq("source_id", sourceId)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`articles(${sourceId}): ${error.message}`);
      const page = (data ?? []) as unknown as (Omit<ArticleRow, "sourceId"> & {
        article_evidence: Evidence | null;
      })[];
      for (const raw of page) {
        rows.push({
          id: raw.id,
          sourceId,
          event_id: raw.event_id,
          title: raw.title,
          published_at: raw.published_at,
        });
        if (raw.article_evidence) evidenceByArticle.set(raw.id, raw.article_evidence);
      }
      if (page.length < PAGE) break;
    }
    return rows;
  };

  for (const source of sources) {
    const rows = await readSourceArticles(source.id);
    articles.push(...rows);
  }
  say(rowLine("articles across those sources", articles.length));

  /** Per source: successes, last failed attempt, and what it would offer a probe. */
  type SourceProfile = {
    id: string;
    name: string | null;
    failures: number;
    allowed: boolean | null;
    marker: string | null;
    clock: string | null;
    reason: string | null;
    corpus: number;
    successes: number;
    lastSuccess: string | null;
    lastFailedAt: string | null;
    attempted: number;
    failed: number;
    other: number;
    unattempted: number;
    /**
     * Where the unattempted work sits by age. Recovery returns a source to
     * normal selection, and normal selection only takes articles the scheduler
     * still considers fresh -- so this is what a recovered family would
     * actually yield, not just how much is parked.
     */
    unattemptedWithin72h: number;
    unattemptedWithin7d: number;
    unattemptedWithin30d: number;
    unattemptedOlder: number;
  };
  const profiles = new Map<string, SourceProfile>();
  for (const source of sources) {
    profiles.set(source.id, {
      id: source.id,
      name: source.name,
      failures: source.enrichment_failure_count,
      allowed: source.enrichment_allowed,
      marker: source.enrichment_last_success,
      clock: source.enrichment_last_attempt_at,
      reason: source.enrichment_last_failure_reason,
      corpus: 0,
      successes: 0,
      lastSuccess: null,
      lastFailedAt: null,
      attempted: 0,
      failed: 0,
      other: 0,
      unattempted: 0,
      unattemptedWithin72h: 0,
      unattemptedWithin7d: 0,
      unattemptedWithin30d: 0,
      unattemptedOlder: 0,
    });
  }
  for (const article of articles) {
    const profile = profiles.get(article.sourceId);
    if (!profile) continue;
    profile.corpus += 1;
    const evidence = evidenceByArticle.get(article.id);
    if (!evidence) {
      profile.unattempted += 1;
      const age = Date.now() - Date.parse(article.published_at);
      if (age <= 72 * 3_600_000) profile.unattemptedWithin72h += 1;
      else if (age <= 7 * 24 * 3_600_000) profile.unattemptedWithin7d += 1;
      else if (age <= 30 * 24 * 3_600_000) profile.unattemptedWithin30d += 1;
      else profile.unattemptedOlder += 1;
      continue;
    }
    profile.attempted += 1;
    if (evidence.status === "enriched") {
      profile.successes += 1;
      const at = evidence.extracted_at;
      if (at && (!profile.lastSuccess || at > profile.lastSuccess)) profile.lastSuccess = at;
    } else if (evidence.status === "failed" || evidence.status === "unavailable") {
      profile.failed += 1;
      const at = evidence.extracted_at;
      if (at && (!profile.lastFailedAt || at > profile.lastFailedAt)) profile.lastFailedAt = at;
      // 'blocked' and 'other' statuses carry no cooldown timestamp and are not
      // fetch failures, so they land in `other`.
    } else {
      profile.other += 1;
    }
  }

  // Eligibility is the Audit 37/38 rule: lifetime success is state on the
  // source row, and a source that has never succeeded is recoverable only
  // after PROBE_IDLE_DAYS without an attempt — also read from the source row,
  // never inferred from evidence, which is not a complete attempt log.
  const idleCutoff = Date.now() - PROBE_IDLE_DAYS * 24 * 3_600_000;
  const idleEnough = (s: SourceRow): boolean => {
    const clock = s.enrichment_last_attempt_at;
    return clock === null || Date.parse(clock) <= idleCutoff;
  };
  const eligible = sources.filter(
    (s) => s.enrichment_allowed !== false && (s.enrichment_last_success !== null || idleEnough(s)),
  );
  const markerEligible = sources.filter(
    (s) => s.enrichment_last_success !== null && s.enrichment_allowed !== false,
  );
  const neverSucceeded = sources.filter((s) => (profiles.get(s.id)?.successes ?? 0) === 0);
  const refused = sources.filter((s) => s.enrichment_allowed === false);
  say(rowLine("probe-eligible (marker or 14d idle)", eligible.length));
  say(rowLine("  of those, on the marker alone", markerEligible.length));
  say(rowLine("never succeeded (stays parked)", neverSucceeded.length));
  say(rowLine("robots-refused (ineligible regardless)", refused.length));
  heading("Why each source is parked (Audit 40 — observational)");
  for (const source of sources) {
    const p = profiles.get(source.id);
    if (!p) continue;
    say(
      `  ${String(p.name ?? p.id.slice(0, 8))
        .slice(0, 30)
        .padEnd(30)} ${p.reason ?? "(no reason recorded yet)"}`,
    );
  }

  heading("Per source");
  for (const source of sources) {
    const p = profiles.get(source.id);
    if (!p) continue;
    say(
      `  ${String(p.name ?? p.id.slice(0, 8))
        .slice(0, 34)
        .padEnd(
          34,
        )} failures=${String(p.failures).padStart(3)}  corpus=${String(p.corpus).padStart(4)}  successes=${String(p.successes).padStart(3)}  marker=${(p.marker ?? "NULL").slice(0, 16).padEnd(16)}  clock=${(p.clock ?? "NULL").slice(0, 16).padEnd(16)}  unattempted=${String(p.unattempted).padStart(3)}`,
    );
  }

  // Events parked behind each backed-off source (what a probe could unlock).
  const parkedEvents = new Map<string, Set<string>>();
  for (const article of articles) {
    const eventId = article.event_id;
    if (!eventId) continue;
    (
      parkedEvents.get(article.sourceId) ??
      parkedEvents.set(article.sourceId, new Set()).get(article.sourceId)!
    ).add(eventId);
  }

  // ---------------------------------------------------------------------------
  // 2. Per-tick utilization from pipeline_runs
  // ---------------------------------------------------------------------------
  // `considered - skipped` is the tick's normal selection size: `considered`
  // counts selected + backed-off rows, `skipped` the backed-off ones. Using
  // `processed` (successes) instead would conflate "selected three, one failed"
  // with "selected two" — the probe gate is about selection, not success.
  //
  // Enrichment fires six times an hour, so the read pages back to `since` when
  // a window is given and stops at 40 ticks otherwise; a single 1000-row page
  // would cover only a few days and a window could silently lose its tail.
  const enrichRuns: EnrichRunRow[] = [];
  const runFloor = since ? Date.parse(since) : null;
  /** Without a window the read stops at 40 ticks; with one it pages to the floor. */
  const pageEnd = (offset: number): number =>
    runFloor === null ? Math.min(offset + PAGE, 40) - 1 : offset + PAGE - 1;
  for (let offset = 0; ; offset += PAGE) {
    const end = pageEnd(offset);
    if (end < offset) break;
    const { data, error } = await client
      .from("pipeline_runs")
      .select("started_at, considered, processed, skipped, reason_counts")
      .eq("stage", "enrich")
      .order("started_at", { ascending: false })
      .range(offset, end);
    if (error) throw new Error(`pipeline_runs: ${error.message}`);
    const page = (data ?? []) as EnrichRunRow[];
    enrichRuns.push(...page);
    if (page.length < end - offset + 1) break;
    if (runFloor !== null && Date.parse(page[page.length - 1]?.started_at ?? "") < runFloor) break;
    if (runFloor === null) break;
  }
  const selected = enrichRuns.map((r) => {
    const skipped = r.skipped ?? 0;
    const considered = r.considered ?? 0;
    return {
      startedAt: r.started_at,
      processed: r.processed ?? 0,
      selected: considered - skipped,
      probe: probeOf(r.reason_counts),
    };
  });
  const full = selected.filter((r) => r.selected >= ENRICH_LIMIT);
  // `selected` is `considered - skipped`, which is `todo.length - todoSkips`:
  // `considered` counts the backed-off rows too and `skipped` counts them
  // first, so a full tick that lost one article to a pre-attempt skip reads
  // exactly like a spare slot. Where a tick recorded its probe decision (Audit
  // 43) that decision is the answer; for older rows the gap shape below is an
  // upper bound on the wait, never proof that a slot was offered.
  const chronological = [...selected].reverse();
  const spareTicks = chronological.filter((r) => r.selected < ENRICH_LIMIT);
  const spareGapsMs: number[] = [];
  for (let i = 1; i < spareTicks.length; i += 1) {
    const previous = spareTicks[i - 1];
    const current = spareTicks[i];
    if (!previous || !current) continue;
    spareGapsMs.push(Date.parse(current.startedAt) - Date.parse(previous.startedAt));
  }
  let longestFullRun = 0;
  let currentRun = 0;
  for (const tick of chronological) {
    if (tick.selected < ENRICH_LIMIT) {
      currentRun = 0;
      continue;
    }
    currentRun += 1;
    if (currentRun > longestFullRun) longestFullRun = currentRun;
  }

  say(rowLine("recent enrich ticks read", enrichRuns.length));
  say(rowLine(`ticks at full ${ENRICH_LIMIT}-slot selection (proxy)`, full.length));
  say(rowLine("spare-capacity ticks (proxy, not the gate)", selected.length - full.length));
  say(
    `  ${selected
      .slice(0, 12)
      .map(
        (r) =>
          `${r.startedAt.slice(5, 16).replace("T", " ")}Z selected=${String(r.selected)} enriched=${String(r.processed)} probe=${r.probe?.decision ?? "unrecorded"}`,
      )
      .join("\n  ")}`,
  );

  heading("Spare-capacity gaps — legacy proxy only, not the probe gate");
  // Audit 43: `selected` is `todo.length - todoSkips`, so these gaps bound the
  // wait from above; only a recorded decision proves a slot was offered.
  say(
    "  `considered - skipped` counts a full tick that lost one article to a pre-attempt skip as spare",
  );
  const hours = (ms: number): string => `${(ms / 3_600_000).toFixed(1)}h`;
  const sortedGaps = [...spareGapsMs].sort((a, b) => a - b);
  const median = sortedGaps[Math.floor(sortedGaps.length / 2)];
  say(rowLine("spare ticks in the read", `${spareTicks.length} of ${chronological.length}`));
  say(rowLine("longest run of full ticks", longestFullRun));
  if (sortedGaps.length > 0) {
    say(rowLine("gap between spare ticks — median", hours(median ?? 0)));
    say(
      rowLine("gap between spare ticks — longest", hours(sortedGaps[sortedGaps.length - 1] ?? 0)),
    );
    const bucket = (limitMs: number): number => spareGapsMs.filter((ms) => ms <= limitMs).length;
    say(
      `  gaps: <=15m ${bucket(15 * 60_000)}  <=1h ${bucket(3_600_000)}  <=6h ${bucket(6 * 3_600_000)}  <=24h ${bucket(24 * 3_600_000)}  >24h ${spareGapsMs.length - bucket(24 * 3_600_000)}`,
    );
  } else {
    say("  no two spare ticks in the read: every interval is a starvation interval");
  }

  // ---------------------------------------------------------------------------
  // 3. Probe candidates under the current rule
  // ---------------------------------------------------------------------------
  heading("Probe candidates under the current rule");
  const now = Date.now();
  const cooldownCutoff = now - PROBE_COOLDOWN_HOURS * 3_600_000;
  const ageCutoff = now - PROBE_MAX_ARTICLE_AGE_HOURS * 3_600_000;
  const eligibleIds = new Set(eligible.map((s) => s.id));
  const candidates: {
    source: string;
    articleId: string;
    event: string | null;
    title: string;
    published: string;
    lastFailedAt: string | null;
    cooldownOk: boolean;
  }[] = [];
  for (const article of articles) {
    const profile = profiles.get(article.sourceId);
    if (!profile || !eligibleIds.has(article.sourceId)) continue;
    // Articles already finished (any status) are not probe candidates — the
    // probe picks work the tick refused but that has no evidence row yet.
    if (evidenceByArticle.has(article.id)) continue;
    // The probe's own read only looks back PROBE_HISTORY_DAYS and then requires
    // the article to be young enough to be worth extracting.
    if (Date.parse(article.published_at) < ageCutoff) continue;
    const withinCooldown =
      profile.lastFailedAt !== null && Date.parse(profile.lastFailedAt) > cooldownCutoff;
    candidates.push({
      source: profile.name ?? article.sourceId.slice(0, 8),
      articleId: article.id,
      event: article.event_id,
      title: article.title ?? "(untitled)",
      published: article.published_at,
      lastFailedAt: profile.lastFailedAt,
      cooldownOk: !withinCooldown,
    });
  }
  heading("What a recovery would yield — unattempted work by age");
  for (const source of sources) {
    const p = profiles.get(source.id);
    if (!p) continue;
    say(
      `  ${String(p.name ?? p.id.slice(0, 8))
        .slice(0, 30)
        .padEnd(
          30,
        )} <=72h=${String(p.unattemptedWithin72h).padStart(4)}  <=7d=${String(p.unattemptedWithin7d).padStart(4)}  <=30d=${String(p.unattemptedWithin30d).padStart(4)}  older=${String(p.unattemptedOlder).padStart(4)}`,
    );
  }
  const fresh = [...profiles.values()].reduce((sum, p) => sum + p.unattemptedWithin72h, 0);
  const total = [...profiles.values()].reduce((sum, p) => sum + p.unattempted, 0);
  say(rowLine("currently recoverable work (<=72h)", fresh));
  say(rowLine("raw parked articles (all ages, diagnostic)", total));
  say(
    `  ${Math.round((fresh / Math.max(total, 1)) * 100)}% of the parked total is work the scheduler would take; the rest is history the 72h floor already refused.`,
  );

  say(rowLine("unattempted articles on eligible sources", candidates.length));
  say(rowLine("ready now (past 24h cooldown)", candidates.filter((c) => c.cooldownOk).length));
  for (const candidate of candidates.slice(0, 12)) {
    say(
      `  ${candidate.source.slice(0, 24).padEnd(24)} cooldown=${candidate.cooldownOk ? "ready" : "wait "}  ${candidate.title.slice(0, 56)}`,
    );
  }
  say(
    "  a probe also needs its source to reach the tick's selection (a skipped, backed-off row) and a spare slot in that tick",
  );

  // ---------------------------------------------------------------------------
  // 4. Observation window, when one is given
  // ---------------------------------------------------------------------------
  type WindowAttempt = { status: string | null; extracted_at: string | null; sourceId: string };
  let windowAttempts: WindowAttempt[] = [];
  /** Audit 43's tally: the gate's answer per tick, for the report. */
  type WindowProbe = {
    ticks: number;
    recorded: number;
    gateClosed: number;
    noCandidate: number;
    fired: number;
    firedWork: { startedAt: string; articleId: string | null; sourceId: string | null }[];
  };
  let windowProbe: WindowProbe | null = null;
  if (since) {
    const sinceMs = Date.parse(since);
    windowAttempts = articles
      .map((article) => ({
        evidence: evidenceByArticle.get(article.id),
        sourceId: article.sourceId,
      }))
      .filter((row): row is { evidence: Evidence; sourceId: string } => !!row.evidence)
      .map((row) => ({
        status: row.evidence.status,
        extracted_at: row.evidence.extracted_at,
        sourceId: row.sourceId,
      }))
      .filter((row) => row.extracted_at !== null && Date.parse(row.extracted_at) >= sinceMs);

    heading(`Since ${since}`);
    // A latched source is refused by normal selection, so any attempt on it
    // after the probe shipped is a probe firing. Attempts that fail on a path
    // writing no evidence row (a robots refusal) leave no trace here; the
    // failure counter is the only signal, so it is printed for diffing.
    say(rowLine("attempts recorded in the window", windowAttempts.length));
    say(
      rowLine(
        "  of those, enriched (recoveries)",
        windowAttempts.filter((a) => a.status === "enriched").length,
      ),
    );
    say(
      rowLine(
        "  of those, failed/unavailable",
        windowAttempts.filter((a) => a.status === "failed" || a.status === "unavailable").length,
      ),
    );
    for (const source of sources) {
      const mine = windowAttempts.filter((a) => a.sourceId === source.id);
      const p = profiles.get(source.id);
      const markerMoved =
        p?.marker != null && Date.parse(p.marker) >= Date.parse(since) ? " marker-refreshed" : "";
      if (mine.length > 0 || markerMoved) {
        say(
          `  ${String(p?.name ?? source.id)
            .slice(0, 30)
            .padEnd(
              30,
            )} attempts=${String(mine.length).padStart(3)}  failures=${String(p?.failures ?? 0).padStart(3)}${markerMoved}`,
        );
      }
    }
    const windowRuns = selected.filter((r) => Date.parse(r.startedAt) >= sinceMs);
    const windowProbed = windowRuns.filter((r) => r.probe !== null);
    const decisionCount = (decision: string): number =>
      windowProbed.filter((r) => r.probe?.decision === decision).length;
    say(rowLine("ticks in the window", windowRuns.length));
    // Audit 43 replaced the proxy that used to sit here: the recorded decision
    // is the only datum that can say whether the gate opened, so it is the only
    // one this section reports. Ticks recorded before it landed are counted
    // separately rather than inferred.
    say(rowLine("  with a recorded probe decision", windowProbed.length));
    say(rowLine("  gate_closed (no slot went spare)", decisionCount("gate_closed")));
    say(rowLine("  no_candidate (gate open, nothing eligible)", decisionCount("no_candidate")));
    say(rowLine("  fired (probe took a slot)", decisionCount("fired")));
    windowProbe = {
      ticks: windowRuns.length,
      recorded: windowProbed.length,
      gateClosed: decisionCount("gate_closed"),
      noCandidate: decisionCount("no_candidate"),
      fired: decisionCount("fired"),
      firedWork: windowProbed
        .filter((r) => r.probe?.decision === "fired")
        .map((r) => ({
          startedAt: r.startedAt,
          articleId: r.probe?.articleId ?? null,
          sourceId: r.probe?.sourceId ?? null,
        })),
    };
    for (const work of windowProbe.firedWork) {
      say(
        `  fired ${work.startedAt.slice(5, 16).replace("T", " ")}Z  article=${work.articleId ?? "?"}  source=${work.sourceId ?? "?"}`,
      );
    }
    if (windowProbe.ticks > windowProbe.recorded) {
      say(
        `  ${windowProbe.ticks - windowProbe.recorded} tick${windowProbe.ticks - windowProbe.recorded === 1 ? "" : "s"} predate the recorded decision — their capacity cannot be read from the run row at all`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Persist
  // ---------------------------------------------------------------------------
  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          takenAt: new Date().toISOString(),
          since,
          backedOffSources: sources.map((s) => {
            const p = profiles.get(s.id);
            return {
              id: s.id,
              name: s.name,
              failures: s.enrichment_failure_count,
              allowed: s.enrichment_allowed,
              marker: s.enrichment_last_success,
              clock: s.enrichment_last_attempt_at,
              reason: s.enrichment_last_failure_reason,
              corpus: p?.corpus ?? 0,
              successes: p?.successes ?? 0,
              lastSuccess: p?.lastSuccess ?? null,
              lastFailedAt: p?.lastFailedAt ?? null,
              unattempted: p?.unattempted ?? 0,
              unattemptedWithin72h: p?.unattemptedWithin72h ?? 0,
              unattemptedWithin7d: p?.unattemptedWithin7d ?? 0,
              unattemptedWithin30d: p?.unattemptedWithin30d ?? 0,
              unattemptedOlder: p?.unattemptedOlder ?? 0,
              parkedEvents: parkedEvents.get(s.id)?.size ?? 0,
            };
          }),
          eligibleSources: eligible.length,
          markerEligibleSources: markerEligible.length,
          neverSucceededSources: neverSucceeded.length,
          refusedSources: refused.length,
          recentTicks: selected.map((r) => ({
            startedAt: r.startedAt,
            selected: r.selected,
            enriched: r.processed,
            probe: r.probe,
          })),
          fullUtilizationTicks: full.length,
          spareCapacityTicks: selected.length - full.length,
          longestFullRun,
          spareGapMedianHours: sortedGaps.length > 0 ? (median ?? 0) / 3_600_000 : null,
          spareGapLongestHours:
            sortedGaps.length > 0 ? (sortedGaps[sortedGaps.length - 1] ?? 0) / 3_600_000 : null,
          probeCandidates: candidates,
          windowAttempts: windowAttempts.map((a) => ({
            sourceId: a.sourceId,
            status: a.status,
            extractedAt: a.extracted_at,
          })),
          windowProbe,
        },
        null,
        1,
      )}\n`,
    );
    say();
    say(`written to ${out}`);
  }
});
