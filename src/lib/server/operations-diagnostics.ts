import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminOnly } from "@/lib/server/guard";
import type { Database, Json } from "@/lib/supabase/types";
import { activeCutoff } from "@/lib/pipeline/freshness";
import { composeArticleWithDiagnostics } from "@/lib/editorial";
import { selectReaderEvidence } from "@/lib/reader-evidence";
import { readEventIntelligence, type EventIntelligence } from "@/lib/understand";
import type { Story } from "@/lib/story";
import type { EvidenceUnit } from "@/lib/understand";
import { parseInput } from "@/lib/server/validate";

type Db = SupabaseClient<Database>;
const DAY = 86_400_000;
const READ_SAMPLE = 100;
const STORY_SAMPLE = 30;
const RUN_SAMPLE = 100;
const FAILURE_SAMPLE = 500;
const PIPELINE_RUN_PAGE_SIZE = 30;

type Quality = "thin" | "adequate" | "rich";
type Mode = "ai_cached" | "deterministic_enriched" | "deterministic_rss" | "minimal";
type WordBand = "lt150" | "150_249" | "250_399" | "400_599" | "600plus";

export type ReadQualityDiagnostics = {
  evaluated: number;
  sampleSize: number;
  scope: string;
  modes: Record<Mode, number>;
  quality: Record<Quality, number>;
  words: Record<WordBand, number>;
  averageWords: number | null;
  medianWords: number | null;
  p90Words: number | null;
  evidence: {
    enrichedStories: number;
    rawUnits: number;
    averageUnitsPerEnrichedStory: number | null;
    sourceWords: number | null;
  };
  /**
   * What the deterministic evidence boundary did to the sample. Provider
   * metadata never reaches a reader, so these are the only place it is visible:
   * fields stripped before evidence, units that were metadata and nothing else,
   * duplicate claims merged, and what the quality gate refused to publish.
   */
  sourceNormalization: {
    removedMetadataFields: number;
    cleanedEvidence: number;
    rejectedMetadataOnly: number;
  };
  dedupe: {
    duplicateGroups: number;
    preferredCleanVariant: number;
    nearDuplicateMerges: number;
  };
  qualityGate: {
    metadataLeakWarnings: number;
    malformedAttributionWarnings: number;
  };
};

export type EnrichmentDiagnostics = {
  enabled: boolean;
  batchLimit: number | null;
  scope: string;
  outcomes: Record<string, number>;
  pending: number | null;
  evidenceUnits: number;
  averageEvidencePerEnrichedArticle: number | null;
  averageSourceWords: number | null;
  successRate: number | null;
  attention: {
    sourceId: string;
    source: string;
    reason: string;
    robots: "allowed" | "blocked" | "unknown";
    backoff: boolean;
    recentAttempts: number;
    recentEnriched: number;
    lastFailure: string | null;
  }[];
};

export type DeliveryFailureGroup = {
  channel: string;
  reason: string;
  count: number;
  firstAt: string;
  lastAt: string;
  examples: { at: string; id: string }[];
};

export type DeliveryDiagnostics = {
  scope: string;
  byChannel: Record<
    string,
    { queued: number; sent: number; failed: number; bounced: number; successRate: number | null }
  >;
  failureGroups: DeliveryFailureGroup[];
  briefings: {
    generated: number;
    ready: number;
    unsent: number;
    failed: number;
    expired: number;
    oldestReady: string | null;
  };
};

export type FailureGroup = {
  stage: string;
  reason: string;
  count: number;
  firstAt: string;
  lastAt: string;
  examples: { at: string; identifier: string | null }[];
};

export type PipelineRunPage = {
  rows: OperationsDiagnostics["runs"];
  nextBefore: string | null;
  hasMore: boolean;
};

export type OperationsDiagnostics = {
  generatedAt: string;
  readQuality: ReadQualityDiagnostics;
  enrichment: EnrichmentDiagnostics;
  delivery: DeliveryDiagnostics;
  failures: FailureGroup[];
  scheduler: {
    logicalJob: string;
    schedule: string | null;
    raw: string;
    status: string;
    updatedAt: string;
  }[];
  runs: {
    id: string;
    stage: string;
    trigger: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    considered: number | null;
    processed: number | null;
    skipped: number | null;
    failed: number | null;
  }[];
  recentStories: {
    id: string;
    title: string;
    firstSeen: string;
    status: string;
    mode: Mode;
    quality: Quality;
    words: number;
    sources: number;
    evidence: number;
    category: string | null;
  }[];
  suspiciousTitles: { id: string; title: string; reason: string }[];
};

type ArticleRow = {
  id: string;
  event_id: string | null;
  title: string;
  source_id: string | null;
  published_at: string | null;
  fetched_at: string;
  excerpt: string | null;
  sources: { name?: string } | null;
};

type EvidenceRow = {
  article_id: string;
  status: string;
  evidence: Json;
  source_word_count: number;
  attempts: number;
  updated_at: string;
};

function reasonOf(value: string | null | undefined): string {
  const clean = (value ?? "unknown").replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean || "unknown";
}

function wordsOf(article: { deck: { text: string }; paragraphs: { text: string }[] }): number {
  const text = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ").trim();
  return text ? text.split(/\s+/).length : 0;
}

export function qualityOf(words: number, facts: number, sources: number): Quality {
  if (facts >= 8 && words >= 250 && sources >= 2) return "rich";
  if (facts >= 3 && words >= 80) return "adequate";
  return "thin";
}
export function modeOf(
  intel: EventIntelligence | null,
  enriched: boolean,
  hasSourceText: boolean,
): Mode {
  if (intel?.article) return "ai_cached";
  if (enriched) return "deterministic_enriched";
  if (hasSourceText) return "deterministic_rss";
  return "minimal";
}

function unitsOf(value: Json): EvidenceUnit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as { kind?: unknown; text?: unknown; attribution?: unknown };
    if (
      typeof row.text !== "string" ||
      (row.kind !== "fact" && row.kind !== "quote" && row.kind !== "uncertain")
    )
      return [];
    return [
      {
        kind: row.kind,
        text: row.text,
        ...(typeof row.attribution === "string" ? { attribution: row.attribution } : {}),
      },
    ];
  });
}

function storyFor(
  event: {
    id: string;
    title: string;
    what_happened: string;
    importance: number;
    novelty: number;
    first_seen_at: string;
    tags: string[];
    understand: Json | null;
  },
  articles: ArticleRow[],
  evidenceByArticle: Map<string, EvidenceRow>,
  intel: EventIntelligence | null,
): Story {
  return {
    id: event.id,
    org: articles[0]?.sources?.name ?? "",
    title: event.title,
    what: event.what_happened,
    why: "",
    importance: event.importance >= 6 ? "High" : event.importance >= 3 ? "Medium" : "Notable",
    score: { relevance: 0, importance: event.importance, novelty: event.novelty },
    sources: articles.length,
    topics: event.tags ?? [],
    time: "",
    publishedAt: event.first_seen_at,
    sourceList: articles.map((article) => {
      const evidence = evidenceByArticle.get(article.id);
      return {
        articleId: article.id,
        name: article.sources?.name ?? "Unknown source",
        at: article.published_at ?? article.fetched_at,
        headline: article.title,
        ...(article.excerpt ? { excerpt: article.excerpt } : {}),
        ...(evidence?.status === "enriched"
          ? { enrichedEvidence: unitsOf(evidence.evidence) }
          : {}),
      };
    }),
    before: "",
    after: "",
    timeline: [],
    ...(intel ? { understand: intel } : {}),
  };
}

export function suspiciousTitle(title: string): string | null {
  const clean = title.trim();
  if (!clean) return "empty";
  if (/^(?:[a-z]\d+|b\d+|[a-f0-9]{8,})$/i.test(clean)) return "identifier-like";
  if (clean.length < 8) return "too short";
  if (/^[\W_\d]+$/.test(clean)) return "malformed";
  return null;
}

function groupFailure(
  map: Map<string, FailureGroup>,
  stage: string,
  reason: string,
  at: string,
  identifier: string | null,
) {
  const key = `${stage}\u0000${reason}`;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      stage,
      reason,
      count: 1,
      firstAt: at,
      lastAt: at,
      examples: [{ at, identifier }],
    });
    return;
  }
  existing.count += 1;
  if (at < existing.firstAt) existing.firstAt = at;
  if (at > existing.lastAt) existing.lastAt = at;
  if (existing.examples.length < 3) existing.examples.push({ at, identifier });
}

export function scheduleForKey(key: string): {
  logicalJob: string;
  schedule: string | null;
  raw: string;
} {
  const raw = key.replace(/^cron:/, "");
  if (raw === "*/15 * * * *") return { logicalJob: "Source ingest", schedule: raw, raw };
  if (raw === "* * * * *")
    return { logicalJob: "Digest / delivery dispatcher", schedule: raw, raw };
  if (raw === "0 12 * * *") return { logicalJob: "Maintenance", schedule: raw, raw };
  if (raw.includes("0,2,8,9,14,17,23,24,29,32,38,39,44,47,53,54,59")) {
    return { logicalJob: "Pipeline stage dispatcher", schedule: raw, raw };
  }
  return { logicalJob: "Scheduled job", schedule: raw || null, raw };
}

export function recordedMetric(detail: Json, metric: string, value: number): number | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const recorded = (detail as { metrics_recorded?: Json })["metrics_recorded"];
  return Array.isArray(recorded) && recorded.includes(metric) ? value : null;
}

export const getPipelineRunHistory = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    parseInput(z.object({ before: z.string().datetime().nullable().optional() }), input),
  )
  .handler(async ({ context, data }): Promise<PipelineRunPage> => {
    const db = context.actor.db as Db;
    let query = db
      .from("pipeline_runs")
      .select(
        "id, stage, trigger, started_at, finished_at, status, considered, processed, skipped, failed, reason_counts",
      )
      .order("started_at", { ascending: false })
      .limit(PIPELINE_RUN_PAGE_SIZE + 1);
    if (data.before) query = query.lt("started_at", data.before);
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    const rows = result.data ?? [];
    const pageRows = rows.slice(0, PIPELINE_RUN_PAGE_SIZE);
    const mapRow = (row: (typeof rows)[number]): OperationsDiagnostics["runs"][number] => ({
      id: row.id,
      stage: row.stage,
      trigger: row.trigger,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      considered: recordedMetric(row.reason_counts, "considered", row.considered),
      processed: recordedMetric(row.reason_counts, "processed", row.processed),
      skipped: recordedMetric(row.reason_counts, "skipped", row.skipped),
      failed: recordedMetric(row.reason_counts, "failed", row.failed),
    });
    return {
      rows: pageRows.map(mapRow),
      nextBefore:
        rows.length > PIPELINE_RUN_PAGE_SIZE ? (pageRows.at(-1)?.started_at ?? null) : null,
      hasMore: rows.length > PIPELINE_RUN_PAGE_SIZE,
    };
  });

export const getOperationsDiagnostics = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<OperationsDiagnostics> => {
    const db = context.actor.db as Db;
    const since24 = new Date(Date.now() - DAY).toISOString();
    const since7 = new Date(Date.now() - 7 * DAY).toISOString();
    const since30 = new Date(Date.now() - 30 * DAY).toISOString();
    const activeSince = activeCutoff().toISOString();

    const [flags, events, evidence, sources, deliveries, digests, ops, runs] = await Promise.all([
      db
        .from("feature_flags")
        .select("key, enabled")
        .eq("key", "article_enrichment_enabled")
        .maybeSingle(),
      db
        .from("events")
        .select(
          "id, title, status, what_happened, importance, novelty, tags, understand, first_seen_at",
        )
        .eq("status", "complete")
        .gte("first_seen_at", activeSince)
        .order("first_seen_at", { ascending: false })
        .limit(READ_SAMPLE),
      db
        .from("article_evidence")
        .select("article_id, status, evidence, source_word_count, attempts, updated_at")
        .gte("updated_at", since7)
        .order("updated_at", { ascending: false })
        .limit(5_000),
      db
        .from("sources")
        .select("id, name, active, enrichment_allowed, robots_checked_at, enrichment_failure_count")
        .limit(500),
      db
        .from("deliveries")
        .select("id, digest_id, channel, status, last_error, created_at, delivered_at")
        .gte("created_at", since30)
        .order("created_at", { ascending: false })
        .limit(10_000),
      db
        .from("digests")
        .select("digest_id, kind, status, scheduled_for, generated_at, generation_failure_reason")
        .gte("scheduled_for", since30)
        .limit(10_000),
      db
        .from("ops_status")
        .select("key, status, updated_at, detail")
        .order("updated_at", { ascending: false })
        .limit(100),
      db
        .from("pipeline_runs")
        .select(
          "id, stage, trigger, started_at, finished_at, status, considered, processed, skipped, failed, reason_counts",
        )
        .order("started_at", { ascending: false })
        .limit(RUN_SAMPLE),
    ]);
    for (const result of [flags, events, evidence, sources, deliveries, digests, ops, runs]) {
      if (result.error) throw new Error(result.error.message);
    }

    const eventRows = events.data ?? [];
    const eventIds = eventRows.map((row) => row.id);
    const articleResult = eventIds.length
      ? await db
          .from("articles")
          .select(
            "id, event_id, title, source_id, published_at, fetched_at, excerpt, sources ( name )",
          )
          .in("event_id", eventIds)
          .order("published_at", { ascending: true })
          .limit(2_000)
      : { data: [], error: null };
    if (articleResult.error) throw new Error(articleResult.error.message);
    const articleRows = (articleResult.data ?? []) as unknown as ArticleRow[];
    const articleIds = articleRows.map((row) => row.id);
    const evidenceResult = articleIds.length
      ? await db
          .from("article_evidence")
          .select("article_id, status, evidence, source_word_count, attempts, updated_at")
          .in("article_id", articleIds)
      : { data: [], error: null };
    if (evidenceResult.error) throw new Error(evidenceResult.error.message);

    const evidenceRows = (evidenceResult.data ?? []) as EvidenceRow[];
    const evidenceByArticle = new Map(evidenceRows.map((row) => [row.article_id, row]));
    const articlesByEvent = new Map<string, ArticleRow[]>();
    for (const article of articleRows) {
      if (!article.event_id) continue;
      const list = articlesByEvent.get(article.event_id) ?? [];
      list.push(article);
      articlesByEvent.set(article.event_id, list);
    }

    const eventUnderstanding = new Map<string, Json>();
    const understandingResult = eventIds.length
      ? await db
          .from("event_understanding")
          .select("event_id, payload, status, updated_at")
          .in("event_id", eventIds)
          .eq("status", "ready")
          .order("updated_at", { ascending: false })
          .limit(READ_SAMPLE)
      : { data: [], error: null };
    if (understandingResult.error) throw new Error(understandingResult.error.message);
    for (const row of understandingResult.data ?? [])
      if (!eventUnderstanding.has(row.event_id) && row.payload)
        eventUnderstanding.set(row.event_id, row.payload);

    const modes: Record<Mode, number> = {
      ai_cached: 0,
      deterministic_enriched: 0,
      deterministic_rss: 0,
      minimal: 0,
    };
    const quality: Record<Quality, number> = { thin: 0, adequate: 0, rich: 0 };
    const words: Record<WordBand, number> = {
      lt150: 0,
      "150_249": 0,
      "250_399": 0,
      "400_599": 0,
      "600plus": 0,
    };
    const wordValues: number[] = [];
    const recentStories: OperationsDiagnostics["recentStories"] = [];
    const suspiciousTitles: OperationsDiagnostics["suspiciousTitles"] = [];
    const sourceNormalization: ReadQualityDiagnostics["sourceNormalization"] = {
      removedMetadataFields: 0,
      cleanedEvidence: 0,
      rejectedMetadataOnly: 0,
    };
    const dedupe: ReadQualityDiagnostics["dedupe"] = {
      duplicateGroups: 0,
      preferredCleanVariant: 0,
      nearDuplicateMerges: 0,
    };
    const qualityGate: ReadQualityDiagnostics["qualityGate"] = {
      metadataLeakWarnings: 0,
      malformedAttributionWarnings: 0,
    };
    let enrichedStories = 0;
    let rawUnits = 0;
    let sourceWords = 0;
    for (const event of eventRows) {
      const articles = articlesByEvent.get(event.id) ?? [];
      const payload = eventUnderstanding.get(event.id) ?? event.understand;
      const intel = readEventIntelligence(payload, articles.length);
      const enriched = articles.some(
        (article) => evidenceByArticle.get(article.id)?.status === "enriched",
      );
      const hasSourceText = articles.some((article) => Boolean(article.excerpt?.trim()));
      const mode = modeOf(intel, enriched, hasSourceText);
      const story = storyFor(event, articles, evidenceByArticle, intel);
      const composition = composeArticleWithDiagnostics(story);
      const article = composition.article;
      const outputWords = wordsOf(article);
      const selection = selectReaderEvidence(event.title, story.sourceList);
      sourceNormalization.removedMetadataFields +=
        composition.diagnostics.sourceNormalization.removedMetadataFields;
      sourceNormalization.cleanedEvidence +=
        composition.diagnostics.sourceNormalization.cleanedEvidence;
      sourceNormalization.rejectedMetadataOnly +=
        composition.diagnostics.sourceNormalization.rejectedMetadataOnly;
      dedupe.duplicateGroups += composition.diagnostics.dedupe.duplicateGroups;
      dedupe.preferredCleanVariant += composition.diagnostics.dedupe.preferredCleanVariant;
      dedupe.nearDuplicateMerges += selection.dedupe.nearDuplicateMerges;
      qualityGate.metadataLeakWarnings += composition.diagnostics.qualityGate.metadataLeakWarnings;
      qualityGate.malformedAttributionWarnings +=
        composition.diagnostics.qualityGate.malformedAttributionWarnings;
      const q = qualityOf(outputWords, selection.facts.length, articles.length);
      modes[mode] += 1;
      quality[q] += 1;
      wordValues.push(outputWords);
      if (outputWords < 150) words.lt150 += 1;
      else if (outputWords < 250) words["150_249"] += 1;
      else if (outputWords < 400) words["250_399"] += 1;
      else if (outputWords < 600) words["400_599"] += 1;
      else words["600plus"] += 1;
      if (enriched) enrichedStories += 1;
      for (const articleRow of articles) {
        const row = evidenceByArticle.get(articleRow.id);
        if (!row) continue;
        rawUnits += unitsOf(row.evidence).length;
        sourceWords += row.source_word_count;
      }
      const suspicious = suspiciousTitle(event.title);
      if (suspicious && suspiciousTitles.length < 10)
        suspiciousTitles.push({ id: event.id, title: event.title, reason: suspicious });
      if (recentStories.length < STORY_SAMPLE)
        recentStories.push({
          id: event.id,
          title: event.title,
          firstSeen: event.first_seen_at,
          status: event.status,
          mode,
          quality: q,
          words: outputWords,
          sources: articles.length,
          evidence: articles.reduce(
            (n, a) =>
              n +
              (evidenceByArticle.get(a.id)?.status === "enriched"
                ? unitsOf(evidenceByArticle.get(a.id)!.evidence).length
                : 0),
            0,
          ),
          category: event.tags?.[0] ?? null,
        });
    }
    wordValues.sort((a, b) => a - b);
    const percentile = (p: number) =>
      wordValues.length
        ? (wordValues[Math.min(wordValues.length - 1, Math.floor(wordValues.length * p))] ?? null)
        : null;

    const outcomes: Record<string, number> = {};
    let pending = 0;
    for (const row of evidenceRows) {
      outcomes[row.status] = (outcomes[row.status] ?? 0) + 1;
      if (row.status === "pending") pending += 1;
    }
    const enrichedRows = evidenceRows.filter((row) => row.status === "enriched");
    const attention = (sources.data ?? [])
      .flatMap((source) => {
        const sourceEvidence = evidenceRows.filter(
          (row) => articleRows.find((a) => a.id === row.article_id)?.source_id === source.id,
        );
        const recentFailed = sourceEvidence.filter((row) => row.status === "failed");
        const backoff = source.enrichment_failure_count >= 5;
        const robots: "allowed" | "blocked" | "unknown" =
          source.enrichment_allowed === true
            ? "allowed"
            : source.enrichment_allowed === false
              ? "blocked"
              : "unknown";
        if (!source.active || (!backoff && robots === "allowed" && recentFailed.length < 2))
          return [];
        const reason = backoff
          ? "repeated failures / backoff"
          : robots === "blocked"
            ? "robots blocked"
            : robots === "unknown"
              ? "robots state unknown"
              : "recent enrichment failures";
        return [
          {
            sourceId: source.id,
            source: source.name,
            reason,
            robots,
            backoff,
            recentAttempts: sourceEvidence.reduce((n, row) => n + row.attempts, 0),
            recentEnriched: sourceEvidence.filter((row) => row.status === "enriched").length,
            lastFailure:
              recentFailed
                .map((row) => row.updated_at)
                .sort()
                .at(-1) ?? null,
          },
        ];
      })
      .slice(0, 8);

    const byChannel: DeliveryDiagnostics["byChannel"] = {};
    const deliveryGroups = new Map<string, DeliveryFailureGroup>();
    for (const row of deliveries.data ?? []) {
      const bucket = byChannel[row.channel] ?? {
        queued: 0,
        sent: 0,
        failed: 0,
        bounced: 0,
        successRate: null,
      };
      if (row.status in bucket) bucket[row.status as "queued" | "sent" | "failed" | "bounced"] += 1;
      byChannel[row.channel] = bucket;
      if (row.status === "failed" || row.status === "bounced") {
        const reason = reasonOf(row.last_error);
        const key = `${row.channel}\u0000${reason}`;
        const group = deliveryGroups.get(key);
        if (!group)
          deliveryGroups.set(key, {
            channel: row.channel,
            reason,
            count: 1,
            firstAt: row.created_at,
            lastAt: row.created_at,
            examples: [{ at: row.created_at, id: row.id }],
          });
        else {
          group.count += 1;
          group.firstAt = row.created_at < group.firstAt ? row.created_at : group.firstAt;
          group.lastAt = row.created_at > group.lastAt ? row.created_at : group.lastAt;
          if (group.examples.length < 3) group.examples.push({ at: row.created_at, id: row.id });
        }
      }
    }
    for (const bucket of Object.values(byChannel)) {
      const attempted = bucket.sent + bucket.failed + bucket.bounced;
      bucket.successRate = attempted ? bucket.sent / attempted : null;
    }
    const digestRows = digests.data ?? [];
    const briefingRows = digestRows.filter((row) => row.kind === "briefing");
    const ready = briefingRows.filter((row) => row.status === "ready");
    const expired = briefingRows.filter(
      (row) =>
        row.status === "failed" &&
        /expired|stale|missed slot/i.test(row.generation_failure_reason ?? ""),
    );
    const queuedDigestIds = new Set(
      (deliveries.data ?? []).filter((row) => row.status === "queued").map((row) => row.digest_id),
    );

    const failureMap = new Map<string, FailureGroup>();
    for (const row of ops.data ?? [])
      if (row.status === "error" || row.status === "warning")
        groupFailure(
          failureMap,
          row.key.replace(/^cron:/, "pipeline"),
          reasonOf(typeof row.detail === "string" ? row.detail : JSON.stringify(row.detail)),
          row.updated_at,
          null,
        );
    for (const group of deliveryGroups.values())
      groupFailure(
        failureMap,
        `delivery:${group.channel}`,
        group.reason,
        group.lastAt,
        group.examples[0]?.id ?? null,
      );

    return {
      generatedAt: new Date().toISOString(),
      readQuality: {
        evaluated: eventRows.length,
        sampleSize: eventRows.length,
        scope: `Latest ${eventRows.length} complete events within the active news window`,
        modes,
        quality,
        words,
        averageWords: wordValues.length
          ? Math.round(wordValues.reduce((a, b) => a + b, 0) / wordValues.length)
          : null,
        medianWords: percentile(0.5),
        p90Words: percentile(0.9),
        evidence: {
          enrichedStories,
          rawUnits,
          averageUnitsPerEnrichedStory: enrichedStories ? rawUnits / enrichedStories : null,
          sourceWords: enrichedStories ? sourceWords : null,
        },
        sourceNormalization,
        dedupe,
        qualityGate,
      },
      enrichment: {
        enabled: flags.data?.enabled === true,
        batchLimit: 3,
        scope: "Article evidence rows updated in the last 7 days",
        outcomes,
        pending,
        evidenceUnits: enrichedRows.reduce((n, row) => n + unitsOf(row.evidence).length, 0),
        averageEvidencePerEnrichedArticle: enrichedRows.length
          ? enrichedRows.reduce((n, row) => n + unitsOf(row.evidence).length, 0) /
            enrichedRows.length
          : null,
        averageSourceWords: enrichedRows.length
          ? enrichedRows.reduce((n, row) => n + row.source_word_count, 0) / enrichedRows.length
          : null,
        successRate: evidenceRows.length ? enrichedRows.length / evidenceRows.length : null,
        attention,
      },
      delivery: {
        scope: "Delivery and briefing rows created in the last 30 days",
        byChannel,
        failureGroups: [...deliveryGroups.values()].sort((a, b) => b.count - a.count),
        briefings: {
          generated: briefingRows.filter((row) => row.generated_at !== null).length,
          ready: ready.length,
          unsent: queuedDigestIds.size,
          failed: briefingRows.filter((row) => row.status === "failed").length,
          expired: expired.length,
          oldestReady: ready.map((row) => row.scheduled_for).sort()[0] ?? null,
        },
      },
      failures: [...failureMap.values()]
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
        .slice(0, 30),
      scheduler: (ops.data ?? [])
        .filter((row) => row.key.startsWith("cron:"))
        .map((row) => ({
          ...scheduleForKey(row.key),
          status: row.status,
          updatedAt: row.updated_at,
        })),
      runs: (runs.data ?? []).map((row) => ({
        id: row.id,
        stage: row.stage,
        trigger: row.trigger,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        status: row.status,
        considered: recordedMetric(row.reason_counts, "considered", row.considered),
        processed: recordedMetric(row.reason_counts, "processed", row.processed),
        skipped: recordedMetric(row.reason_counts, "skipped", row.skipped),
        failed: recordedMetric(row.reason_counts, "failed", row.failed),
      })),
      recentStories,
      suspiciousTitles,
    };
  });
