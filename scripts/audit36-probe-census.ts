/**
 * Audit 36 — pre-change census for the spare-capacity recovery probe.
 *
 * The arbiter approved a conditional probe: when a tick's normal candidate
 * selection uses fewer than ENRICH_LIMIT slots, at most one parked article may
 * be attempted, and only from a source with `enrichment_failure_count >= 5`
 * AND a lifetime enrichment success. This census measures, before any code
 * changes:
 *   - the backed-off sources (failure_count >= 5), split by lifetime success;
 *   - events and articles parked behind each, and their evidence status;
 *   - the last failed attempt per source (the cooldown signal the probe will
 *     derive from article_evidence.extracted_at of failed rows);
 *   - normal per-tick utilization from pipeline_runs: how often the last
 *     ENRICH_LIMIT-firing ticks actually used their slots, i.e. how often the
 *     probe would even have fired;
 *   - the probe candidates that WOULD have fired under the ruling's rule.
 *
 * SELECT only, service-role client. Node 22 or later.
 */

import { writeFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

type ArticleRow = {
  id: string;
  event_id: string | null;
  title: string | null;
  published_at: string;
  sources: { id: string; name: string | null; enrichment_failure_count: number } | null;
};

type EvidenceRow = {
  article_id: string;
  status: string | null;
  extracted_at: string | null;
};

type EnrichRunRow = {
  started_at: string;
  considered: number | null;
  processed: number | null;
  skipped: number | null;
};

main(async () => {
  const args = process.argv.slice(2);
  const argOf = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const out = argOf("--out");
  const client = db();

  heading("Audit 36 — spare-capacity probe: pre-change census");

  // ---------------------------------------------------------------------------
  // 1. Backed-off sources, split by lifetime success
  // ---------------------------------------------------------------------------
  const { data: backedOffSources, error: sourcesError } = await client
    .from("sources")
    .select("id, name, enrichment_failure_count, enrichment_allowed, robots_checked_at")
    .gte("enrichment_failure_count", 5);
  if (sourcesError) throw new Error(`sources: ${sourcesError.message}`);
  const sources = backedOffSources ?? [];
  const sourceIds = sources.map((s) => s.id);
  say(rowLine("backed-off sources (failures >= 5)", sources.length));

  // Every article in the corpus per backed-off source, with its evidence
  // outcome and the timestamps the cooldown will be derived from. One chunked
  // read over articles with the evidence outcome nested.
  const articles: ArticleRow[] = [];
  const evidenceByArticle = new Map<string, EvidenceRow>();
  for (let i = 0; i < sourceIds.length; i += 200) {
    const chunk = sourceIds.slice(i, i + 200);
    if (chunk.length === 0) continue;
    const { data, error } = await client
      .from("articles")
      .select(
        "id, event_id, title, published_at, sources(id, name, enrichment_failure_count), article_evidence(status, extracted_at)",
      )
      .in("source_id", chunk);
    if (error) throw new Error(`articles: ${error.message}`);
    for (const raw of data ?? []) {
      const row = raw as unknown as ArticleRow & { article_evidence: EvidenceRow | null };
      articles.push({
        id: row.id,
        event_id: row.event_id,
        title: row.title,
        published_at: row.published_at,
        sources: row.sources,
      });
      if (row.article_evidence) evidenceByArticle.set(row.id, row.article_evidence);
    }
  }
  say(rowLine("articles across those sources", articles.length));

  /** Per source: successes, last failed attempt, and what it would offer a probe. */
  type SourceProfile = {
    id: string;
    name: string | null;
    failures: number;
    allowed: boolean | null;
    corpus: number;
    successes: number;
    lastSuccess: string | null;
    lastFailedAt: string | null;
    attempted: number;
    failed: number;
    other: number;
    unattempted: number;
  };
  const profiles = new Map<string, SourceProfile>();
  for (const source of sources) {
    profiles.set(source.id, {
      id: source.id,
      name: source.name,
      failures: source.enrichment_failure_count,
      allowed: source.enrichment_allowed,
      corpus: 0,
      successes: 0,
      lastSuccess: null,
      lastFailedAt: null,
      attempted: 0,
      failed: 0,
      other: 0,
      unattempted: 0,
    });
  }
  for (const article of articles) {
    const sid = article.sources?.id;
    if (!sid) continue;
    const profile = profiles.get(sid);
    if (!profile) continue;
    profile.corpus += 1;
    const evidence = evidenceByArticle.get(article.id);
    if (!evidence) {
      profile.unattempted += 1;
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

  const recoverable = sources.filter((s) => (profiles.get(s.id)?.successes ?? 0) > 0);
  const neverSucceeded = sources.filter((s) => (profiles.get(s.id)?.successes ?? 0) === 0);
  say(rowLine("with lifetime success (probe-eligible)", recoverable.length));
  say(rowLine("never succeeded (stays parked)", neverSucceeded.length));

  heading("Per source");
  for (const source of sources) {
    const p = profiles.get(source.id);
    if (!p) continue;
    say(
      `  ${String(p.name ?? p.id.slice(0, 8))
        .slice(0, 34)
        .padEnd(
          34,
        )} failures=${String(p.failures).padStart(3)}  corpus=${String(p.corpus).padStart(4)}  successes=${String(p.successes).padStart(3)}  lastSuccess=${(p.lastSuccess ?? "never").slice(0, 16).padEnd(16)}  lastFailed=${(p.lastFailedAt ?? "—").slice(0, 16).padEnd(16)}  unattempted=${String(p.unattempted).padStart(3)}`,
    );
  }

  // Events parked behind each backed-off source (what a probe could unlock).
  const parkedEvents = new Map<string, Set<string>>();
  for (const article of articles) {
    const sid = article.sources?.id;
    const eventId = article.event_id;
    if (!sid || !eventId) continue;
    (parkedEvents.get(sid) ?? parkedEvents.set(sid, new Set()).get(sid)!).add(eventId);
  }

  // ---------------------------------------------------------------------------
  // 2. Normal per-tick utilization from pipeline_runs (recent enrich ticks)
  // ---------------------------------------------------------------------------
  // `considered - skipped` is the tick's normal selection size: `considered`
  // counts selected + backed-off rows, `skipped` the backed-off ones. Using
  // `processed` (successes) instead would conflate "selected three, one failed"
  // with "selected two" — the probe gate is about selection, not success.
  const { data: runs, error: runsError } = await client
    .from("pipeline_runs")
    .select("started_at, considered, processed, skipped")
    .eq("stage", "enrich")
    .order("started_at", { ascending: false })
    .limit(40);
  if (runsError) throw new Error(`pipeline_runs: ${runsError.message}`);
  const enrichRuns = (runs ?? []) as EnrichRunRow[];
  const selected = enrichRuns.map((r) => {
    const skipped = r.skipped ?? 0;
    const considered = r.considered ?? 0;
    return { startedAt: r.started_at, processed: r.processed ?? 0, selected: considered - skipped };
  });
  const full = selected.filter((r) => r.selected >= 3);
  say(rowLine("recent enrich ticks read", enrichRuns.length));
  say(rowLine("ticks at full 3-slot selection", full.length));
  say(rowLine("spare-capacity ticks (would open a probe slot)", enrichRuns.length - full.length));
  say(
    `  ${selected
      .slice(0, 12)
      .map(
        (r) =>
          `${r.startedAt.slice(5, 16).replace("T", " ")}Z selected=${String(r.selected)} enriched=${String(r.processed)}`,
      )
      .join("\n  ")}`,
  );

  // ---------------------------------------------------------------------------
  // 3. The probe candidates that WOULD have fired, had the probe existed
  // ---------------------------------------------------------------------------
  heading("Probe candidates under the ruling's rule");
  const COOLDOWN_HOURS = 24;
  const cooldownCutoff = Date.now() - COOLDOWN_HOURS * 3_600_000;
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
    const sid = article.sources?.id;
    if (!sid) continue;
    const profile = profiles.get(sid);
    // Historical-success gate mirrors the probe: never-succeeded stays parked.
    if (!profile || profile.successes === 0) continue;
    // Articles already finished (any status) are not probe candidates — the
    // probe picks work the tick refused but that has no evidence row yet.
    if (evidenceByArticle.has(article.id)) continue;
    const withinCooldown =
      profile.lastFailedAt !== null && Date.parse(profile.lastFailedAt) > cooldownCutoff;
    candidates.push({
      source: profile.name ?? sid.slice(0, 8),
      articleId: article.id,
      event: article.event_id,
      title: article.title ?? "(untitled)",
      published: article.published_at,
      lastFailedAt: profile.lastFailedAt,
      cooldownOk: !withinCooldown,
    });
  }
  say(rowLine("unattempted articles on recoverable sources", candidates.length));
  say(rowLine("ready now (past 24h cooldown)", candidates.filter((c) => c.cooldownOk).length));
  for (const candidate of candidates.slice(0, 12)) {
    say(
      `  ${candidate.source.slice(0, 24).padEnd(24)} cooldown=${candidate.cooldownOk ? "ready" : "wait "}  ${candidate.title.slice(0, 56)}`,
    );
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
          backedOffSources: sources.map((s) => {
            const p = profiles.get(s.id);
            return {
              id: s.id,
              name: s.name,
              failures: s.enrichment_failure_count,
              allowed: s.enrichment_allowed,
              corpus: p?.corpus ?? 0,
              successes: p?.successes ?? 0,
              lastSuccess: p?.lastSuccess ?? null,
              lastFailedAt: p?.lastFailedAt ?? null,
              unattempted: p?.unattempted ?? 0,
              parkedEvents: parkedEvents.get(s.id)?.size ?? 0,
            };
          }),
          recoverableSources: recoverable.length,
          neverSucceededSources: neverSucceeded.length,
          recentTicks: selected.map((r) => ({
            startedAt: r.startedAt,
            selected: r.selected,
            enriched: r.processed,
          })),
          fullUtilizationTicks: full.length,
          spareCapacityTicks: enrichRuns.length - full.length,
          probeCandidates: candidates,
        },
        null,
        1,
      )}\n`,
    );
    say();
    say(`written to ${out}`);
  }
});
