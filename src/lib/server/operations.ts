/* eslint-disable prettier/prettier */

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminOnly } from "@/lib/server/guard";
import { countOrThrow } from "@/lib/supabase/count";
import type { Database, Json } from "@/lib/supabase/types";
import { INGEST_CRON, STAGES_CRON, DIGEST_CRON, DORMANT_CRON } from "@/lib/pipeline/cron";
import { activeCutoff } from "@/lib/pipeline/freshness";

type Db = SupabaseClient<Database>;
type CountResult = { count: number | null; error: { message: string } | null };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CRON_KEYS = [
  `cron:${INGEST_CRON}`,
  `cron:${DIGEST_CRON}`,
  `cron:${STAGES_CRON}`,
  `cron:${DORMANT_CRON}`,
];
const PROCESSING_FLAGS = [
  "article_enrichment_enabled",
  "deterministic_cluster_skip",
  "deterministic_analysis",
  "pre_analysis_demand_gate",
  "breaking_alerts",
  "source_discovery_enabled",
];

export type OperationsState = "healthy" | "degraded" | "backlogged" | "partial_outage";
export type StageState = "healthy" | "idle" | "delayed" | "failing" | "disabled";

export type OperationsStage = {
  key: string;
  label: string;
  state: StageState;
  lastRun: string | null;
  lastSuccess: string | null;
  lastFailure: string | null;
  processedHour: number;
  processedDay: number;
  failedHour: number;
  backlog: number;
  oldestWaiting: string | null;
  schedule: string | null;
};

export type OperationsSnapshot = {
  generatedAt: string;
  state: OperationsState;
  stateReason: string;
  activity: {
    lastSuccessfulPipeline: string | null;
    lastCronTick: string | null;
    lastCronStage: string | null;
    oldestUnprocessed: string | null;
  };
  throughput: {
    incomingHour: number;
    processedHour: number;
    incomingDay: number;
    processedDay: number;
    keepingUp: boolean | null;
  };
  backlog: {
    unclusteredArticles: QueueMetric;
    pendingEvents: QueueMetric;
    enrichmentPending: QueueMetric;
    readyBriefings: QueueMetric;
    failedDeliveries: QueueMetric;
  };
  failures: {
    events: number;
    enrichment: number;
    deliveries: number;
    sources: number;
  };
  flags: { key: string; enabled: boolean; updatedAt: string | null }[];
  cron: { key: string; status: "healthy" | "warning" | "error"; updatedAt: string; detail: Json }[];
  stages: OperationsStage[];
  enrichment: {
    enabled: boolean;
    batchLimit: number;
    pending: number;
    enriched24h: number;
    blocked24h: number;
    failed24h: number;
    unavailable24h: number;
    evidenceUnits24h: number;
  };
  readers: {
    understood: number;
    awaiting: number;
    failed: number;
    deterministicAvailable: number;
  };
  sources: { total: number; active: number; stale: number; failing: number };
  /**
   * Source discovery (0096). Deterministic and provider-free: `links24h` and
   * `sources24h` are the two things a tick can produce -- sources we already
   * collect linked to a followed subject, and sources registered from a URL a
   * reader supplied. There is no "configured" to show, because there is no key.
   */
  discovery: {
    enabled: boolean;
    openJobs: number;
    running: number;
    links24h: number;
    sources24h: number;
    recent: {
      id: string;
      topic: string;
      status: string;
      attempt: number;
      /** `registry`, `corpus` or `none`; null while the job is unfinished. */
      method: string | null;
      linked: number;
      error: string | null;
      createdAt: string;
      finishedAt: string | null;
    }[];
  };
  delivery: {
    readyBriefings: number;
    unsentDeliveries: number;
    sent24h: number;
    failed24h: number;
    successRate24h: number | null;
  };
};

export type QueueMetric = {
  /** Active, current-news work only. */
  count: number;
  oldest: string | null;
  ageMinutes: number | null;
  /** Retained historical rows no longer eligible for active work. */
  staleCount: number;
  staleOldest: string | null;
  staleAgeMinutes: number | null;
};

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

async function count(query: PromiseLike<CountResult>): Promise<number> {
  // Every reading on this page, through the same seam, and none of them may
  // read an unreadable count as zero: this is the operator's whole view of
  // the pipeline, and a screen of zeros is indistinguishable from a quiet one.
  return countOrThrow("operations", await query);
}

async function oldest(
  query: PromiseLike<{ data: { published_at?: string | null; fetched_at?: string | null; first_seen_at?: string | null; updated_at?: string | null; scheduled_for?: string | null; created_at?: string | null }[] | null; error: { message: string } | null }>,
): Promise<string | null> {
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  const row = result.data?.[0];
  return row?.published_at ?? row?.fetched_at ?? row?.first_seen_at ?? row?.updated_at ?? row?.scheduled_for ?? row?.created_at ?? null;
}

function ageMinutes(value: string | null): number | null {
  if (!value) return null;
  const age = Math.max(0, Date.now() - Date.parse(value));
  return Number.isFinite(age) ? Math.round(age / 60_000) : null;
}

function queue(
  countValue: number,
  oldestValue: string | null,
  staleCount: number,
  staleOldestValue: string | null,
): QueueMetric {
  return {
    count: countValue,
    oldest: oldestValue,
    ageMinutes: ageMinutes(oldestValue),
    staleCount,
    staleOldest: staleOldestValue,
    staleAgeMinutes: ageMinutes(staleOldestValue),
  };
}

function stateFor(params: {
  heartbeat: string | null;
  latestCron: string | null;
  backlog: number;
  oldest: string | null;
  failures: number;
  incoming: number;
  processed: number;
}): { state: OperationsState; reason: string } {
  const heartbeatAge = params.heartbeat ? Date.now() - Date.parse(params.heartbeat) : Infinity;
  const cronAge = params.latestCron ? Date.now() - Date.parse(params.latestCron) : Infinity;
  if (heartbeatAge > 2 * HOUR || cronAge > 2 * HOUR) {
    return { state: "partial_outage", reason: "The cron heartbeat is stale or has not been recorded." };
  }
  if (params.failures > 0 && params.oldest && (Date.now() - Date.parse(params.oldest)) > DAY) {
    return { state: "degraded", reason: "Recent failures are leaving work older than one day." };
  }
  if (params.backlog > 0 && params.incoming > params.processed && params.incoming > 0) {
    return { state: "backlogged", reason: "Incoming articles are arriving faster than processed articles." };
  }
  if (params.failures > 0) return { state: "degraded", reason: "The latest operational snapshot contains failures." };
  return { state: "healthy", reason: "Cron activity is recent and the measured pipeline is keeping up." };
}

export function deriveOperationsState(params: Parameters<typeof stateFor>[0]): { state: OperationsState; reason: string } {
  return stateFor(params);
}

export const getOperationsSnapshot = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<OperationsSnapshot> => {
    const db = context.actor.db;
    const hour = isoAgo(HOUR);
    const day = isoAgo(DAY);
    const activeSince = activeCutoff().toISOString();

    const [
      articles,
      incomingHour,
      incomingDay,
      processedHour,
      processedDay,
      unclustered,
      unclusteredOldest,
      pendingEvents,
      pendingOldest,
      failedEvents,
      evidencePending,
      evidencePendingOldest,
      evidenceEnrichedDay,
      evidenceBlockedDay,
      evidenceFailedDay,
      evidenceUnavailableDay,
      evidenceUnits,
        readyBriefings,
      readyBriefingsOldest,
      queuedDeliveries,
      queuedDeliveriesOldest,
      failedDeliveries,
      failedDeliveriesOldest,
      sentDeliveriesDay,
      failedDeliveriesDay,
      totalDeliveriesDay,
      activeSources,
      totalSources,
      staleSources,
      failingSources,
      understood,
      awaitingUnderstanding,
      failedUnderstanding,
      deterministicAvailable,
      openDiscoveryJobs,
      discoveredSourcesDay,
      sourceLinksDay,
    ] = await Promise.all([
      count(db.from("articles").select("id", { count: "exact", head: true })),
      count(db.from("articles").select("id", { count: "exact", head: true }).gte("fetched_at", hour)),
      count(db.from("articles").select("id", { count: "exact", head: true }).gte("fetched_at", day)),
      count(db.from("articles").select("id", { count: "exact", head: true }).not("event_id", "is", null).gte("fetched_at", hour)),
      count(db.from("articles").select("id", { count: "exact", head: true }).not("event_id", "is", null).gte("fetched_at", day)),
      count(db.from("articles").select("id", { count: "exact", head: true }).is("event_id", null).gte("published_at", activeSince)),
      oldest(db.from("articles").select("published_at, fetched_at").is("event_id", null).gte("published_at", activeSince).order("published_at", { ascending: true, nullsFirst: true }).limit(1)),
      count(db.from("events").select("id", { count: "exact", head: true }).eq("status", "pending").gte("first_seen_at", activeSince)),
      oldest(db.from("events").select("first_seen_at").eq("status", "pending").gte("first_seen_at", activeSince).order("first_seen_at", { ascending: true }).limit(1)),
      count(db.from("events").select("id", { count: "exact", head: true }).eq("status", "failed")),
      count(db.from("article_evidence").select("article_id", { count: "exact", head: true }).eq("status", "pending").gte("updated_at", activeSince)),
      oldest(db.from("article_evidence").select("updated_at").eq("status", "pending").gte("updated_at", activeSince).order("updated_at", { ascending: true }).limit(1)),
      count(db.from("article_evidence").select("article_id", { count: "exact", head: true }).eq("status", "enriched").gte("updated_at", day)),
      count(db.from("article_evidence").select("article_id", { count: "exact", head: true }).eq("status", "blocked").gte("updated_at", day)),
      count(db.from("article_evidence").select("article_id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", day)),
      count(db.from("article_evidence").select("article_id", { count: "exact", head: true }).eq("status", "unavailable").gte("updated_at", day)),
      sumEvidenceUnits(db, day),
      count(db.from("digests").select("digest_id", { count: "exact", head: true }).eq("status", "ready").gte("scheduled_for", activeSince)),
      oldest(db.from("digests").select("scheduled_for").eq("status", "ready").gte("scheduled_for", activeSince).order("scheduled_for", { ascending: true }).limit(1)),
      count(db.from("deliveries").select("id", { count: "exact", head: true }).eq("status", "queued").gte("created_at", activeSince)),
      oldest(db.from("deliveries").select("created_at").eq("status", "queued").gte("created_at", activeSince).order("created_at", { ascending: true }).limit(1)),
      count(db.from("deliveries").select("id", { count: "exact", head: true }).eq("status", "failed")),
      oldest(db.from("deliveries").select("created_at").eq("status", "failed").order("created_at", { ascending: true }).limit(1)),
      count(db.from("deliveries").select("id", { count: "exact", head: true }).eq("status", "sent").gte("delivered_at", day)),
      count(db.from("deliveries").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", day)),
      count(db.from("deliveries").select("id", { count: "exact", head: true }).gte("created_at", day)),
      count(db.from("sources").select("id", { count: "exact", head: true }).eq("active", true)),
      count(db.from("sources").select("id", { count: "exact", head: true })),
      count(db.from("sources").select("id", { count: "exact", head: true }).eq("active", true).lt("last_fetched_at", isoAgo(2 * HOUR))),
      count(db.from("sources").select("id", { count: "exact", head: true }).eq("active", true).gte("failure_count", 3)),
      count(db.from("event_understanding").select("event_id", { count: "exact", head: true }).eq("status", "ready")),
      count(db.from("event_understanding").select("event_id", { count: "exact", head: true }).in("status", ["generating"])),
      count(db.from("event_understanding").select("event_id", { count: "exact", head: true }).eq("status", "failed")),
      count(db.from("events").select("id", { count: "exact", head: true }).eq("status", "complete")),
      count(
        db
          .from("discovery_jobs")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending", "running"]),
      ),
      count(
        db
          .from("sources")
          .select("id", { count: "exact", head: true })
          .eq("origin", "discovered")
          .gte("created_at", day),
      ),
      count(
        db
          .from("source_topics")
          .select("source_id", { count: "exact", head: true })
          .gte("created_at", day),
      ),
    ]);

    const [
      staleUnclustered,
      staleUnclusteredOldest,
      stalePendingEvents,
      stalePendingOldest,
      staleEvidencePending,
      staleEvidencePendingOldest,
      staleReadyBriefings,
      staleReadyBriefingsOldest,
      staleQueuedDeliveries,
      staleQueuedDeliveriesOldest,
    ] = await Promise.all([
      count(db.from("articles").select("id", { count: "exact", head: true }).is("event_id", null).lt("published_at", activeSince)),
      oldest(db.from("articles").select("published_at, fetched_at").is("event_id", null).lt("published_at", activeSince).order("published_at", { ascending: true }).limit(1)),
      count(db.from("events").select("id", { count: "exact", head: true }).eq("status", "pending").lt("first_seen_at", activeSince)),
      oldest(db.from("events").select("first_seen_at").eq("status", "pending").lt("first_seen_at", activeSince).order("first_seen_at", { ascending: true }).limit(1)),
      count(db.from("article_evidence").select("article_id", { count: "exact", head: true }).eq("status", "pending").lt("updated_at", activeSince)),
      oldest(db.from("article_evidence").select("updated_at").eq("status", "pending").lt("updated_at", activeSince).order("updated_at", { ascending: true }).limit(1)),
      count(db.from("digests").select("digest_id", { count: "exact", head: true }).eq("status", "ready").lt("scheduled_for", activeSince)),
      oldest(db.from("digests").select("scheduled_for").eq("status", "ready").lt("scheduled_for", activeSince).order("scheduled_for", { ascending: true }).limit(1)),
      count(db.from("deliveries").select("id", { count: "exact", head: true }).eq("status", "queued").lt("created_at", activeSince)),
      oldest(db.from("deliveries").select("created_at").eq("status", "queued").lt("created_at", activeSince).order("created_at", { ascending: true }).limit(1)),
    ]);

    const [opsResult, flagsResult, jobsResult] = await Promise.all([
      db.from("ops_status").select("key, status, detail, updated_at").order("updated_at", { ascending: false }).limit(50),
      db.from("feature_flags").select("key, enabled, updated_at").in("key", PROCESSING_FLAGS),
      db
        .from("discovery_jobs")
        .select(
          "id, status, attempt, method, linked_count, error, created_at, finished_at, topics ( label )",
        )
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (opsResult.error) throw new Error(`operations status: ${opsResult.error.message}`);
    if (flagsResult.error) throw new Error(`processing flags: ${flagsResult.error.message}`);
    if (jobsResult.error) throw new Error(`discovery jobs: ${jobsResult.error.message}`);

    const ops = opsResult.data ?? [];
    const heartbeat = ops.find((row) => row.key === "cron:heartbeat");
    const cron = ops.filter((row) => row.key.startsWith("cron:") && row.key !== "cron:heartbeat").map((row) => ({
      key: row.key,
      status: row.status,
      updatedAt: row.updated_at,
      detail: row.detail,
    }));
    const latestCron = cron[0]?.updatedAt ?? null;
    const lastSuccessful = ops.find((row) => row.key.startsWith("cron:") && row.status === "healthy")?.updated_at ?? null;
    const backlogTotal = unclustered + pendingEvents + evidencePending + readyBriefings + queuedDeliveries;
    const failures = failedEvents + evidenceFailedDay + failedDeliveriesDay + failingSources;
    const derived = stateFor({
      heartbeat: heartbeat?.updated_at ?? null,
      latestCron,
      backlog: backlogTotal,        oldest: [unclusteredOldest, pendingOldest, evidencePendingOldest, readyBriefingsOldest, queuedDeliveriesOldest].filter(Boolean).sort()[0] ?? null,
      failures,
      incoming: incomingHour,
      processed: processedHour,
    });

    const stageByKey = new Map<string, OperationsStage>();
    const makeStage = (key: string, label: string, schedule: string | null, backlog: number, waiting: string | null): OperationsStage => {
      const latest = cron.find((row) => row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) && (row.detail as Record<string, Json>)["stage"] === key);
      const state: StageState = latest?.status === "error" ? "failing" : latest?.status === "warning" ? "delayed" : latest ? "healthy" : "idle";
      const stageProcessedHour = key === "ingest" ? incomingHour : key === "cluster" ? processedHour : 0;
      const stageProcessedDay = key === "ingest" ? incomingDay : key === "cluster" ? processedDay : 0;
      const failedHour = key === "delivery" ? failedDeliveriesDay : 0;
      const stage: OperationsStage = {
        key,
        label,
        state,
        lastRun: latest?.updatedAt ?? null,
        lastSuccess: latest?.status === "healthy" ? latest.updatedAt : null,
        lastFailure: latest?.status === "error" ? latest.updatedAt : null,
        processedHour: stageProcessedHour,
        processedDay: stageProcessedDay,
        failedHour,
        backlog,
        oldestWaiting: waiting,
        schedule,
      };
      stageByKey.set(key, stage);
      return stage;
    };
    const stages = [
      makeStage("ingest", "Ingest", INGEST_CRON, unclustered, unclusteredOldest),
      makeStage("cluster", "Cluster", STAGES_CRON, unclustered, unclusteredOldest),
      makeStage("classify", "Classify / topics", STAGES_CRON, pendingEvents, pendingOldest),
      makeStage("analyse", "Deterministic finalization", STAGES_CRON, pendingEvents, pendingOldest),
      makeStage("enrich", "Article enrichment", STAGES_CRON, evidencePending, evidencePendingOldest),
      makeStage("discover", "Source discovery", STAGES_CRON, openDiscoveryJobs, null),
      makeStage("match", "Matching", STAGES_CRON, 0, null),
      makeStage("digest", "Briefing generation", DIGEST_CRON, readyBriefings, readyBriefingsOldest),
      makeStage("delivery", "Delivery", DIGEST_CRON, failedDeliveries, failedDeliveriesOldest),
      makeStage("dormant", "Maintenance", DORMANT_CRON, 0, null),
    ];

    const enrichmentFlag = flagsResult.data?.find((row) => row.key === "article_enrichment_enabled");
    const discoveryFlag = flagsResult.data?.find((row) => row.key === "source_discovery_enabled");
    const attemptedDelivery = sentDeliveriesDay + failedDeliveriesDay;

    return {
      generatedAt: new Date().toISOString(),
      state: derived.state,
      stateReason: derived.reason,
      activity: {
        lastSuccessfulPipeline: lastSuccessful,
        lastCronTick: heartbeat?.updated_at ?? null,
        lastCronStage: jsonString(heartbeat?.detail, "stage"),
        oldestUnprocessed: [unclusteredOldest, pendingOldest, evidencePendingOldest].filter(Boolean).sort()[0] ?? null,
      },
      throughput: {
        incomingHour,
        processedHour,
        incomingDay,
        processedDay,
        keepingUp: incomingHour === 0 ? null : processedHour >= incomingHour,
      },
      backlog: {
        unclusteredArticles: queue(unclustered, unclusteredOldest, staleUnclustered, staleUnclusteredOldest),
        pendingEvents: queue(pendingEvents, pendingOldest, stalePendingEvents, stalePendingOldest),
        enrichmentPending: queue(evidencePending, evidencePendingOldest, staleEvidencePending, staleEvidencePendingOldest),
        readyBriefings: queue(readyBriefings, readyBriefingsOldest, staleReadyBriefings, staleReadyBriefingsOldest),
        failedDeliveries: queue(queuedDeliveries, queuedDeliveriesOldest, staleQueuedDeliveries, staleQueuedDeliveriesOldest),
      },
      failures: { events: failedEvents, enrichment: evidenceFailedDay, deliveries: failedDeliveriesDay, sources: failingSources },
      flags: (flagsResult.data ?? []).map((row) => ({ key: row.key, enabled: row.enabled, updatedAt: row.updated_at })),
      cron,
      stages,
      enrichment: {
        enabled: enrichmentFlag?.enabled === true,
        batchLimit: 3,
        pending: evidencePending,
        enriched24h: evidenceEnrichedDay,
        blocked24h: evidenceBlockedDay,
        failed24h: evidenceFailedDay,
        unavailable24h: evidenceUnavailableDay,
        evidenceUnits24h: evidenceUnits,
      },
      readers: { understood, awaiting: awaitingUnderstanding, failed: failedUnderstanding, deterministicAvailable },
      sources: { total: totalSources, active: activeSources, stale: staleSources, failing: failingSources },
      discovery: {
        enabled: discoveryFlag?.enabled === true,
        openJobs: openDiscoveryJobs,
        running: (jobsResult.data ?? []).filter((row) => row.status === "running").length,
        links24h: sourceLinksDay,
        sources24h: discoveredSourcesDay,
        recent: (jobsResult.data ?? []).map((row) => {
          const embedded = row.topics as { label?: string } | null;
          return {
            id: row.id,
            topic: embedded?.label ?? "",
            status: row.status,
            attempt: row.attempt,
            method: row.method,
            linked: row.linked_count,
            error: row.error,
            createdAt: row.created_at,
            finishedAt: row.finished_at,
          };
        }),
      },
      delivery: {
        readyBriefings,
        unsentDeliveries: queuedDeliveries,
        sent24h: sentDeliveriesDay,
        failed24h: failedDeliveriesDay,
        successRate24h: attemptedDelivery > 0 ? sentDeliveriesDay / attemptedDelivery : null,
      },
    };
  });

async function sumEvidenceUnits(db: Db, since: string): Promise<number> {
  const { data, error } = await db.from("article_evidence").select("evidence").eq("status", "enriched").gte("updated_at", since).limit(5_000);
  if (error) throw new Error(`evidence units: ${error.message}`);
  return (data ?? []).reduce((total, row) => total + (Array.isArray(row.evidence) ? row.evidence.length : 0), 0);
}

function jsonString(value: Json | null | undefined, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value[key];
  return typeof item === "string" ? item : null;
}
