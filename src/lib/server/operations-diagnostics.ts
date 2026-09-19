import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminOnly } from "@/lib/server/guard";
import { readEventIntelligence, readerQuality, type EventIntelligence } from "@/lib/understand";
import type { Database, Json } from "@/lib/supabase/types";
import { activeCutoff } from "@/lib/pipeline/freshness";

type Db = SupabaseClient<Database>;
const DAY = 86_400_000;
const bounded = (value: number, max: number) => Math.max(1, Math.min(value, max));

type Quality = "thin" | "adequate" | "rich";
type Mode = "ai_cached" | "deterministic_enriched" | "deterministic_rss" | "minimal";

export type ReadQualityDiagnostics = {
  evaluated: number;
  modes: Record<Mode, number>;
  quality: Record<Quality, number>;
  words: Record<"lt150" | "150_249" | "250_399" | "400_599" | "600plus", number>;
  averageWords: number | null;
  medianWords: number | null;
  p90Words: number | null;
  evidence: {
    rawUnits: number;
    enrichedArticles: number;
    sourceWords: number;
    selectedUnits: number | null;
    rejectedUnits: number | null;
  };
  evidenceReasons: Record<string, number>;
  related: {
    candidates: number;
    accepted: number;
    rejected: number;
    zeroRelated: number;
    acceptanceRate: number | null;
  };
};

export type EnrichmentDiagnostics = {
  enabled: boolean;
  batchLimit: number;
  outcomes: Record<string, number>;
  recentArticles: number;
  sourceRows: {
    source: string;
    active: boolean;
    allowed: boolean | null;
    robotsCheckedAt: string | null;
    attempts: number;
    enriched: number;
    failed: number;
    backoff: boolean;
    lastSuccess: string | null;
    lastFailure: string | null;
  }[];
};

export type SourceDiagnostics = {
  total: number;
  active: number;
  rows: {
    id: string;
    name: string;
    active: boolean;
    lastFetch: string | null;
    lastArticle: string | null;
    articles24h: number;
    articles7d: number;
    consecutiveFailures: number;
    enrichmentAllowed: boolean | null;
    robotsCheckedAt: string | null;
    backoff: boolean;
    state: "healthy" | "stale" | "failing" | "backed_off" | "no_recent_content";
  }[];
};

export type DeliveryDiagnostics = {
  byChannel: Record<
    string,
    { queued: number; sent: number; failed: number; bounced: number; successRate: number | null }
  >;
  failureReasons: { reason: string; count: number }[];
  recentFailures: { at: string; channel: string; reason: string }[];
  briefings: {
    generated: number;
    ready: number;
    unsent: number;
    failed: number;
    oldestReady: string | null;
  };
};

export type FailureDiagnostics = {
  at: string;
  stage: string;
  identifier: string | null;
  reason: string;
  retryState: string;
}[];

export type OperationsDiagnostics = {
  generatedAt: string;
  readQuality: ReadQualityDiagnostics;
  enrichment: EnrichmentDiagnostics;
  sources: SourceDiagnostics;
  delivery: DeliveryDiagnostics;
  failures: FailureDiagnostics;
  scheduler: {
    key: string;
    status: string;
    updatedAt: string;
    detail: Json;
    schedule: string | null;
  }[];
  runs: {
    id: string;
    stage: string;
    trigger: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    considered: number;
    processed: number;
    skipped: number;
    failed: number;
  }[];
  recentStories: { id: string; title: string; firstSeen: string; status: string }[];
};

function wordsOf(intel: EventIntelligence | null): number {
  if (!intel) return 0;
  const text = intel.article
    ? [intel.article.deck.text, ...intel.article.paragraphs.map((p) => p.text)].join(" ")
    : [intel.oneSentence, ...intel.newDevelopments, ...intel.context]
        .map((item) => (typeof item === "string" ? item : item.text))
        .join(" ");
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function modeFor(intel: EventIntelligence | null, enriched: boolean, aiCached: boolean): Mode {
  if (aiCached && intel?.article) return "ai_cached";
  if (enriched) return "deterministic_enriched";
  if (intel && wordsOf(intel) > 0) return "deterministic_rss";
  return "minimal";
}

function reasonOf(value: string | null): string {
  const clean = (value ?? "unknown").replace(/\s+/g, " ").trim();
  return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean || "unknown";
}

export const getOperationsDiagnostics = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<OperationsDiagnostics> => {
    const db = context.actor.db;
    const since24 = new Date(Date.now() - DAY).toISOString();
    const since7 = new Date(Date.now() - 7 * DAY).toISOString();
    const activeSince = activeCutoff().toISOString();

    const [
      flags,
      events,
      understanding,
      evidence,
      articles,
      sources,
      deliveries,
      digests,
      ops,
      runs,
    ] = await Promise.all([
      db
        .from("feature_flags")
        .select("key, enabled")
        .eq("key", "article_enrichment_enabled")
        .maybeSingle(),
      db
        .from("events")
        .select("id, title, status, understand, publisher_count, article_count, first_seen_at")
        .eq("status", "complete")
        .gte("first_seen_at", activeSince)
        .order("first_seen_at", { ascending: false })
        .limit(5_000),
      db
        .from("event_understanding")
        .select("event_id, payload, status, updated_at")
        .eq("status", "ready")
        .gte("updated_at", since7)
        .order("updated_at", { ascending: false })
        .limit(5_000),
      db
        .from("article_evidence")
        .select("article_id, status, evidence, source_word_count, attempts, updated_at")
        .gte("updated_at", since7)
        .limit(5_000),
      db
        .from("articles")
        .select("id, event_id, source_id, published_at, fetched_at")
        .gte("fetched_at", since7)
        .limit(10_000),
      db
        .from("sources")
        .select(
          "id, name, active, last_fetched_at, failure_count, enrichment_allowed, robots_checked_at, enrichment_failure_count",
        )
        .limit(500),
      db
        .from("deliveries")
        .select("id, digest_id, channel, status, last_error, created_at, delivered_at")
        .gte("created_at", since30())
        .order("created_at", { ascending: false })
        .limit(10_000),
      db
        .from("digests")
        .select("digest_id, kind, status, scheduled_for, generated_at")
        .gte("scheduled_for", since30())
        .limit(10_000),
      db
        .from("ops_status")
        .select("key, status, updated_at, detail")
        .order("updated_at", { ascending: false })
        .limit(100),
      db
        .from("pipeline_runs")
        .select(
          "id, stage, trigger, started_at, finished_at, status, considered, processed, skipped, failed",
        )
        .order("started_at", { ascending: false })
        .limit(100),
    ]);
    for (const result of [
      flags,
      events,
      understanding,
      evidence,
      articles,
      sources,
      deliveries,
      digests,
      ops,
      runs,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const eventRows = events.data ?? [];
    const aiByEvent = new Map<string, Json>();
    for (const row of understanding.data ?? [])
      if (!aiByEvent.has(row.event_id)) aiByEvent.set(row.event_id, row.payload);
    const evidenceByArticle = new Map<string, { status: string; units: number; words: number }>();
    for (const row of evidence.data ?? []) {
      evidenceByArticle.set(row.article_id, {
        status: row.status,
        units: Array.isArray(row.evidence) ? row.evidence.length : 0,
        words: row.source_word_count,
      });
    }
    const articleIdsByEvent = new Map<string, string[]>();
    const sourceArticles = new Map<string, { last: string | null; h24: number; d7: number }>();
    for (const article of articles.data ?? []) {
      if (article.event_id)
        articleIdsByEvent.set(article.event_id, [
          ...(articleIdsByEvent.get(article.event_id) ?? []),
          article.id,
        ]);
      if (article.source_id) {
        const row = sourceArticles.get(article.source_id) ?? { last: null, h24: 0, d7: 0 };
        const published = article.published_at ?? article.fetched_at;
        if (!row.last || published > row.last) row.last = published;
        if (published >= since24) row.h24 += 1;
        row.d7 += 1;
        sourceArticles.set(article.source_id, row);
      }
    }

    const modes: Record<Mode, number> = {
      ai_cached: 0,
      deterministic_enriched: 0,
      deterministic_rss: 0,
      minimal: 0,
    };
    const quality: Record<Quality, number> = { thin: 0, adequate: 0, rich: 0 };
    const words: Record<"lt150" | "150_249" | "250_399" | "400_599" | "600plus", number> = {
      lt150: 0,
      "150_249": 0,
      "250_399": 0,
      "400_599": 0,
      "600plus": 0,
    };
    const wordValues: number[] = [];
    let rawUnits = 0;
    let enrichedArticles = 0;
    let sourceWords = 0;
    for (const event of eventRows) {
      const ids = articleIdsByEvent.get(event.id) ?? [];
      const enriched = ids.some((id) => evidenceByArticle.get(id)?.status === "enriched");
      const intel = readEventIntelligence(aiByEvent.get(event.id) ?? event.understand, ids.length);
      const mode = modeFor(intel, enriched, aiByEvent.has(event.id));
      modes[mode] += 1;
      const q = readerQuality(
        intel ?? { newDevelopments: [], context: [] },
        event.publisher_count ?? 0,
      );
      quality[q] += 1;
      const count = wordsOf(intel);
      wordValues.push(count);
      if (count < 150) words.lt150 += 1;
      else if (count < 250) words["150_249"] += 1;
      else if (count < 400) words["250_399"] += 1;
      else if (count < 600) words["400_599"] += 1;
      else words["600plus"] += 1;
      for (const id of ids) {
        const row = evidenceByArticle.get(id);
        if (!row) continue;
        rawUnits += row.units;
        sourceWords += row.words;
        if (row.status === "enriched") enrichedArticles += 1;
      }
    }
    wordValues.sort((a, b) => a - b);
    const percentile = (p: number) =>
      wordValues.length
        ? (wordValues[Math.min(wordValues.length - 1, Math.floor(wordValues.length * p))] ?? null)
        : null;

    const outcomeCounts: Record<string, number> = {};
    for (const row of evidence.data ?? [])
      outcomeCounts[row.status] = (outcomeCounts[row.status] ?? 0) + 1;
    const sourceRows = (sources.data ?? []).map((source) => {
      const stats = sourceArticles.get(source.id) ?? { last: null, h24: 0, d7: 0 };
      const backoff = source.enrichment_failure_count >= 5;
      const stale =
        !source.last_fetched_at || Date.parse(source.last_fetched_at) < Date.now() - 2 * DAY;
      const state: SourceDiagnostics["rows"][number]["state"] = backoff
        ? "backed_off"
        : source.failure_count >= 3
          ? "failing"
          : stats.h24 === 0 && stale
            ? "no_recent_content"
            : stale
              ? "stale"
              : "healthy";
      return {
        id: source.id,
        name: source.name,
        active: source.active,
        lastFetch: source.last_fetched_at,
        lastArticle: stats.last,
        articles24h: stats.h24,
        articles7d: stats.d7,
        consecutiveFailures: source.failure_count,
        enrichmentAllowed: source.enrichment_allowed,
        robotsCheckedAt: source.robots_checked_at,
        backoff,
        state,
      };
    });

    const byChannel: DeliveryDiagnostics["byChannel"] = {};
    const failureReasons = new Map<string, number>();
    const recentFailures: DeliveryDiagnostics["recentFailures"] = [];
    for (const row of deliveries.data ?? []) {
      const bucket = byChannel[row.channel] ?? {
        queued: 0,
        sent: 0,
        failed: 0,
        bounced: 0,
        successRate: null,
      };
      bucket[row.status] += 1;
      byChannel[row.channel] = bucket;
      if (row.status === "failed" || row.status === "bounced") {
        const reason = reasonOf(row.last_error);
        failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
        if (recentFailures.length < 50)
          recentFailures.push({ at: row.created_at, channel: row.channel, reason });
      }
    }
    for (const bucket of Object.values(byChannel)) {
      const attempted = bucket.sent + bucket.failed + bucket.bounced;
      bucket.successRate = attempted > 0 ? bucket.sent / attempted : null;
    }
    const digestRows = digests.data ?? [];
    const ready = digestRows.filter((row) => row.kind === "briefing" && row.status === "ready");
    const failed = digestRows.filter((row) => row.kind === "briefing" && row.status === "failed");
    const generated = digestRows.filter(
      (row) => row.kind === "briefing" && row.generated_at !== null,
    );
    const queuedDigestIds = new Set(
      (deliveries.data ?? []).filter((row) => row.status === "queued").map((row) => row.digest_id),
    );
    const failureList: FailureDiagnostics = [];
    for (const row of ops.data ?? [])
      if (row.status === "error" || row.status === "warning")
        failureList.push({
          at: row.updated_at,
          stage: row.key.replace(/^cron:/, ""),
          identifier: null,
          reason: reasonOf(
            typeof row.detail === "string" ? row.detail : JSON.stringify(row.detail),
          ),
          retryState: row.status,
        });
    for (const row of recentFailures.slice(0, 50))
      failureList.push({
        at: row.at,
        stage: `delivery:${row.channel}`,
        identifier: null,
        reason: row.reason,
        retryState: "final/diagnostic",
      });

    return {
      generatedAt: new Date().toISOString(),
      readQuality: {
        evaluated: eventRows.length,
        modes,
        quality,
        words,
        averageWords: wordValues.length
          ? Math.round(wordValues.reduce((a, b) => a + b, 0) / wordValues.length)
          : null,
        medianWords: percentile(0.5),
        p90Words: percentile(0.9),
        evidence: {
          rawUnits,
          enrichedArticles,
          sourceWords,
          selectedUnits: null,
          rejectedUnits: null,
        },
        evidenceReasons: {},
        related: { candidates: 0, accepted: 0, rejected: 0, zeroRelated: 0, acceptanceRate: null },
      },
      enrichment: {
        enabled: flags.data?.enabled === true,
        batchLimit: 3,
        outcomes: outcomeCounts,
        recentArticles: evidence.data?.length ?? 0,
        sourceRows: sourceRows
          .filter((row) => row.active)
          .map((row) => {
            const stats = sourceArticles.get(row.id);
            return {
              source: row.name,
              active: row.active,
              allowed: row.enrichmentAllowed,
              robotsCheckedAt: row.robotsCheckedAt,
              attempts: row.consecutiveFailures,
              enriched: stats?.d7 ?? 0,
              failed: row.consecutiveFailures,
              backoff: row.backoff,
              lastSuccess: null,
              lastFailure: null,
            };
          }),
      },
      sources: {
        total: sourceRows.length,
        active: sourceRows.filter((row) => row.active).length,
        rows: sourceRows,
      },
      delivery: {
        byChannel,
        failureReasons: [...failureReasons]
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count),
        recentFailures,
        briefings: {
          generated: generated.length,
          ready: ready.length,
          unsent: queuedDigestIds.size,
          failed: failed.length,
          oldestReady: ready.map((row) => row.scheduled_for).sort()[0] ?? null,
        },
      },
      failures: failureList.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100),
      scheduler: (ops.data ?? [])
        .filter((row) => row.key.startsWith("cron:"))
        .map((row) => ({
          key: row.key,
          status: row.status,
          updatedAt: row.updated_at,
          detail: row.detail,
          schedule: scheduleForKey(row.key),
        })),
      runs: (runs.data ?? []).map((row) => ({
        id: row.id,
        stage: row.stage,
        trigger: row.trigger,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        status: row.status,
        considered: row.considered,
        processed: row.processed,
        skipped: row.skipped,
        failed: row.failed,
      })),
      recentStories: eventRows.slice(0, 50).map((row) => ({
        id: row.id,
        title: row.title,
        firstSeen: row.first_seen_at,
        status: row.status,
      })),
    };
  });

function scheduleForKey(key: string): string | null {
  if (key === "cron:*/15 * * * *") return "*/15 * * * *";
  if (key === "cron:* * * * *") return "* * * * *";
  if (key === "cron:0,2,8,9,14,17,23,24,29,32,38,39,44,47,53,54,59 * * * *") {
    return "shared logical stage trigger";
  }
  if (key === "cron:0 12 * * *") return "0 12 * * *";
  return null;
}

function since30(): string {
  return new Date(Date.now() - 30 * DAY).toISOString();
}
