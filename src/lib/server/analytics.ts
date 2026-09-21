import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminOnly } from "@/lib/server/guard";
import { resolvePlanPrices } from "@/lib/plans";
import { activeCutoff } from "@/lib/pipeline/freshness";
import type {
  DailyCount,
  Database,
  DeliveryStatus,
  DigestStatus,
  EventStatus,
  FeedbackVote,
  PlanTier,
} from "@/lib/supabase/types";

/**
 * Console analytics.
 *
 * Everything here is counted in Postgres — `head: true` with an exact count
 * returns the number without shipping a single row, so the cost of this page
 * does not grow with the size of the tables. Nothing is estimated except MRR,
 * which is labelled as an estimate wherever it is shown because it multiplies
 * list price by active subscription and knows nothing about discounts,
 * refunds, or failed charges.
 */

type Counter = { count: number | null; error: { message: string } | null };

async function countRows(
  db: SupabaseClient<Database>,
  table: keyof Database["public"]["Tables"],
  refine?: (q: never) => never,
): Promise<number> {
  const base = db.from(table).select("*", { count: "exact", head: true });
  const query = refine ? refine(base as never) : base;
  const { count, error } = (await query) as unknown as Counter;
  if (error) throw new Error(`count(${table}): ${error.message}`);
  return count ?? 0;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/** Whole minutes since an instant, floored at zero, or null for no instant. */
function minutesSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 60_000));
}

export type Overview = {
  users: {
    total: number;
    new7: number;
    new30: number;
    active7: number;
    active30: number;
    onboarded: number;
    banned: number;
    admins: number;
  };
  revenue: {
    byPlan: Record<PlanTier, number>;
    /** List price x active paid subscription. An estimate, not billed revenue. */
    mrrEstimate: number;
    pricesOverridden: boolean;
    paid: number;
    /** Paid / total, 0..1. */
    conversion: number;
  };
  content: {
    sources: number;
    activeSources: number;
    failingSources: number;
    articles: number;
    events: number;
    events24h: number;
    pendingEvents: number;
    failedEvents: number;
  };
  delivery: {
    digestsByStatus: Record<DigestStatus, number>;
    deliveriesByStatus: Record<DeliveryStatus, number>;
    /** sent / (sent + failed + bounced), 0..1. Null when nothing has been sent. */
    successRate: number | null;
  };
  /**
   * Windowed and aged figures.
   *
   * Every other field on this type is a lifetime total, and a lifetime total
   * cannot show recovery: a failure count that never drops leaves a queue
   * reading "degraded" forever, long after the cause was fixed. These are the
   * numbers that can return to normal, plus the ages that separate a busy
   * queue from a stuck one.
   */
  health: {
    /** Delivery attempts in the last 24 hours. */
    sent24h: number;
    failed24h: number;
    bounced24h: number;
    /** sent / (sent + failed + bounced) over 24h. Null when nothing was attempted. */
    successRate24h: number | null;
    /** The most recent terminal delivery failure, so a page can say why. */
    lastDeliveryError: string | null;
    oldestQueuedAt: string | null;
    oldestQueuedMinutes: number | null;
    oldestFailedAt: string | null;
    oldestFailedMinutes: number | null;
    /** Pending events inside the active horizon — work that can still be done. */
    pendingLive: number;
    /** Pending events past the horizon — unreachable, and cannot decline. */
    pendingExpired: number;
    /** Event failures in the last 24 hours. */
    failedEvents24h: number;
    oldestPendingAt: string | null;
    oldestPendingMinutes: number | null;
  };
  feedback: Record<FeedbackVote, number>;
  ai: {
    /** Tokens spent on the shared per-event analysis pass. */
    analysisTokens: number;
    /** Tokens spent on per-user digest generation. */
    generationTokens: number;
    analysedEvents: number;
  };
  blog: {
    total: number;
    published: number;
    drafts: number;
    views: number;
  };
  generatedAt: string;
};

const DIGEST_STATUSES: DigestStatus[] = [
  "scheduled",
  "generating",
  "ready",
  "sent",
  "skipped",
  "failed",
];
const DELIVERY_STATUSES: DeliveryStatus[] = ["queued", "sent", "failed", "bounced"];
const VOTES: FeedbackVote[] = ["useful", "not_useful", "not_interested"];

export const getOverview = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<Overview> => {
    const db = context.actor.db;
    const since7 = daysAgo(7);
    const since30 = daysAgo(30);
    const since1 = daysAgo(1);
    // The pipeline's active work horizon. A pending event older than this can no
    // longer be picked up by any stage, so it is counted apart from the live
    // queue rather than inflating it — see `health.pendingExpired`.
    const activeSince = activeCutoff().toISOString();

    // Counts are independent, so they go out together rather than in sequence.
    // On a cold Postgres connection the difference is most of the page load.
    const [
      total,
      new7,
      new30,
      active7,
      active30,
      onboarded,
      banned,
      admins,
      sources,
      activeSources,
      failingSources,
      articles,
      events,
      events24h,
      pendingEvents,
      failedEvents,
      blogTotal,
      blogPublished,
      sent24h,
      failed24h,
      bounced24h,
      pendingLive,
      pendingExpired,
      failedEvents24h,
    ] = await Promise.all([
      countRows(db, "profiles"),
      countRows(db, "profiles", (q) => (q as never as Filter).gte("created_at", since7) as never),
      countRows(db, "profiles", (q) => (q as never as Filter).gte("created_at", since30) as never),
      countRows(db, "profiles", (q) => (q as never as Filter).gte("last_seen_at", since7) as never),
      countRows(
        db,
        "profiles",
        (q) => (q as never as Filter).gte("last_seen_at", since30) as never,
      ),
      countRows(
        db,
        "profiles",
        (q) => (q as never as Filter).not("onboarded_at", "is", null) as never,
      ),
      countRows(db, "user_bans"),
      countRows(db, "user_roles", (q) => (q as never as Filter).neq("role", "user") as never),
      countRows(db, "sources"),
      countRows(db, "sources", (q) => (q as never as Filter).eq("active", true) as never),
      countRows(db, "sources", (q) => (q as never as Filter).gte("failure_count", 3) as never),
      countRows(db, "articles"),
      countRows(db, "events"),
      countRows(db, "events", (q) => (q as never as Filter).gte("first_seen_at", since1) as never),
      countRows(db, "events", (q) => (q as never as Filter).eq("status", "pending") as never),
      countRows(db, "events", (q) => (q as never as Filter).eq("status", "failed") as never),
      countRows(db, "blog_posts"),
      countRows(db, "blog_posts", (q) => (q as never as Filter).eq("status", "published") as never),
      countRows(
        db,
        "deliveries",
        (q) =>
          ((q as never as Filter).eq("status", "sent") as never as Filter).gte(
            "delivered_at",
            since1,
          ) as never,
      ),
      countRows(
        db,
        "deliveries",
        (q) =>
          ((q as never as Filter).eq("status", "failed") as never as Filter).gte(
            "created_at",
            since1,
          ) as never,
      ),
      countRows(
        db,
        "deliveries",
        (q) =>
          ((q as never as Filter).eq("status", "bounced") as never as Filter).gte(
            "created_at",
            since1,
          ) as never,
      ),
      countRows(
        db,
        "events",
        (q) =>
          ((q as never as Filter).eq("status", "pending") as never as Filter).gte(
            "first_seen_at",
            activeSince,
          ) as never,
      ),
      countRows(
        db,
        "events",
        (q) =>
          ((q as never as Filter).eq("status", "pending") as never as Filter).lt(
            "first_seen_at",
            activeSince,
          ) as never,
      ),
      countRows(
        db,
        "events",
        (q) =>
          ((q as never as Filter).eq("status", "failed") as never as Filter).gte(
            "last_updated_at",
            since1,
          ) as never,
      ),
    ]);

    const [byPlan, digestsByStatus, deliveriesByStatus, feedback] = await Promise.all([
      countByPlan(db),
      countByEnum(db, "digests", "status", DIGEST_STATUSES),
      countByEnum(db, "deliveries", "status", DELIVERY_STATUSES),
      countByEnum(db, "feedback", "vote", VOTES),
    ]);

    const [priceSetting, totals] = await Promise.all([
      db.from("site_settings").select("value").eq("key", "billing.prices").maybeSingle(),
      usageTotals(db),
    ]);

    const { prices, overridden } = resolvePlanPrices(priceSetting.data?.value ?? null);
    const paid = byPlan.plura + byPlan.omni;
    const mrrEstimate = byPlan.plura * prices.plura + byPlan.omni * prices.omni;

    // Queue age and the most recent failure reason. One row each, so these stay
    // cheap however large the tables grow, and no count can express either.
    const [oldestQueued, oldestFailed, oldestPending, lastFailure] = await Promise.all([
      db
        .from("deliveries")
        .select("created_at")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      db
        .from("deliveries")
        .select("created_at")
        .eq("status", "failed")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      db
        .from("events")
        .select("first_seen_at")
        .eq("status", "pending")
        .gte("first_seen_at", activeSince)
        .order("first_seen_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      db
        .from("deliveries")
        .select("last_error")
        .eq("status", "failed")
        .not("last_error", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    for (const result of [oldestQueued, oldestFailed, oldestPending, lastFailure]) {
      if (result.error) throw new Error(`delivery health: ${result.error.message}`);
    }

    const attempted =
      deliveriesByStatus.sent + deliveriesByStatus.failed + deliveriesByStatus.bounced;
    const attempted24h = sent24h + failed24h + bounced24h;

    return {
      users: { total, new7, new30, active7, active30, onboarded, banned, admins },
      revenue: {
        byPlan,
        mrrEstimate,
        pricesOverridden: overridden,
        paid,
        conversion: total > 0 ? paid / total : 0,
      },
      content: {
        sources,
        activeSources,
        failingSources,
        articles,
        events,
        events24h,
        pendingEvents,
        failedEvents,
      },
      delivery: {
        digestsByStatus,
        deliveriesByStatus,
        successRate: attempted > 0 ? deliveriesByStatus.sent / attempted : null,
      },
      health: {
        sent24h,
        failed24h,
        bounced24h,
        successRate24h: attempted24h > 0 ? sent24h / attempted24h : null,
        lastDeliveryError: lastFailure.data?.last_error ?? null,
        oldestQueuedAt: oldestQueued.data?.created_at ?? null,
        oldestQueuedMinutes: minutesSince(oldestQueued.data?.created_at),
        oldestFailedAt: oldestFailed.data?.created_at ?? null,
        oldestFailedMinutes: minutesSince(oldestFailed.data?.created_at),
        pendingLive,
        pendingExpired,
        failedEvents24h,
        oldestPendingAt: oldestPending.data?.first_seen_at ?? null,
        oldestPendingMinutes: minutesSince(oldestPending.data?.first_seen_at),
      },
      feedback,
      ai: totals.ai,
      blog: {
        total: blogTotal,
        published: blogPublished,
        drafts: blogTotal - blogPublished,
        views: totals.blogViews,
      },
      generatedAt: new Date().toISOString(),
    };
  });

/**
 * Minimal shape of the PostgREST filter builder. The generated Database types
 * make the real builder type depend on the table, which `countRows` is generic
 * over — this narrows to just the methods used here rather than defeating the
 * type system with `any` at each call site.
 */
type Filter = {
  gte: (column: string, value: string | number) => unknown;
  lt: (column: string, value: string | number) => unknown;
  eq: (column: string, value: string | number | boolean) => unknown;
  neq: (column: string, value: string | number | boolean) => unknown;
  not: (column: string, operator: string, value: null) => unknown;
};

async function countByPlan(db: SupabaseClient<Database>): Promise<Record<PlanTier, number>> {
  const tiers: PlanTier[] = ["uno", "plura", "omni"];
  const counts = await Promise.all(
    tiers.map((tier) =>
      countRows(
        db,
        "subscriptions",
        (q) =>
          ((q as never as Filter).eq("plan", tier) as never as Filter).eq(
            "status",
            "active",
          ) as never,
      ),
    ),
  );
  return {
    uno: counts[0] ?? 0,
    plura: counts[1] ?? 0,
    omni: counts[2] ?? 0,
  };
}

async function countByEnum<T extends string>(
  db: SupabaseClient<Database>,
  table: keyof Database["public"]["Tables"],
  column: string,
  values: T[],
): Promise<Record<T, number>> {
  const counts = await Promise.all(
    values.map((value) =>
      countRows(db, table, (q) => (q as never as Filter).eq(column, value) as never),
    ),
  );
  const out = {} as Record<T, number>;
  values.forEach((value, i) => {
    out[value] = counts[i] ?? 0;
  });
  return out;
}

/**
 * Token spend.
 *
 * PostgREST has no sum(), so this pages the two token columns and adds them up
 * here. Both are integers on tables that grow with pipeline activity, so the
 * page is capped: beyond the cap the figure is a floor, not a total, and the
 * caller says so rather than quietly under-reporting.
 */
/**
 * The overview's totals, summed by Postgres.
 *
 * These used to be two functions that selected rows under a `limit` and added
 * them up here. A limit does not error, it truncates: past ten thousand
 * analysed events the token figure quietly stopped growing, so the number an
 * operator reads to decide whether AI spend is under control was a floor
 * presented as a total. See 0052.
 */
async function usageTotals(
  db: SupabaseClient<Database>,
): Promise<{ ai: Overview["ai"]; blogViews: number }> {
  const { data, error } = await db.rpc("admin_usage_totals");
  if (error) throw new Error(`usage totals: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;

  return {
    ai: {
      analysisTokens: Number(row?.analysis_tokens ?? 0),
      generationTokens: Number(row?.generation_tokens ?? 0),
      analysedEvents: Number(row?.analysed_events ?? 0),
    },
    blogViews: Number(row?.blog_views ?? 0),
  };
}

/** Daily buckets for the overview chart. Grouped in Postgres — see 0003. */
export const getDailyCounts = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((days: unknown): number => {
    const n = typeof days === "number" ? days : 30;
    // Clamped rather than validated-and-rejected: the only caller is a segment
    // control with fixed options, so an out-of-range value is a bug, not input.
    return Math.min(Math.max(Math.round(n), 1), 180);
  })
  .handler(async ({ context, data }): Promise<DailyCount[]> => {
    const { data: rows, error } = await context.actor.db.rpc("admin_daily_counts", {
      p_days: data,
    });
    if (error) throw new Error(`admin_daily_counts: ${error.message}`);
    return rows ?? [];
  });

export type TopicUptake = { label: string; slug: string; users: number };

/** Which topics people actually subscribe to — the signal for what to source. */
export const getTopicUptake = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<TopicUptake[]> => {
    const db = context.actor.db;

    const [topics, links] = await Promise.all([
      db.from("topics").select("id, slug, label"),
      db.from("user_topics").select("topic_id").eq("muted", false).limit(50_000),
    ]);

    if (topics.error) throw new Error(`topics: ${topics.error.message}`);
    if (links.error) throw new Error(`user_topics: ${links.error.message}`);

    const counts = new Map<string, number>();
    for (const link of links.data ?? []) {
      counts.set(link.topic_id, (counts.get(link.topic_id) ?? 0) + 1);
    }

    return (topics.data ?? [])
      .map((topic) => ({
        label: topic.label,
        slug: topic.slug,
        users: counts.get(topic.id) ?? 0,
      }))
      .sort((a, b) => b.users - a.users)
      .slice(0, 12);
  });

export type PipelineEvent = {
  id: string;
  title: string;
  importance: number;
  status: EventStatus;
  sources: number;
  topics: string[];
};

/** Newest events, for the staff pipeline page — not a fixture list. */
export const listRecentEvents = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<PipelineEvent[]> => {
    const db = context.actor.db;
    const { data, error } = await db
      .from("events")
      .select("id, title, importance, status")
      .order("last_updated_at", { ascending: false })
      .limit(8);
    if (error) throw new Error(`listing events: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [
      { data: articles, error: articleError },
      { data: links, error: linkError },
      { data: topicRows, error: topicError },
    ] = await Promise.all([
      db.from("articles").select("event_id").in("event_id", ids),
      db.from("event_topics").select("event_id, topic_id").in("event_id", ids),
      db.from("topics").select("id, label"),
    ]);
    if (articleError) throw new Error(`counting event articles: ${articleError.message}`);
    if (linkError) throw new Error(`reading event topics: ${linkError.message}`);
    if (topicError) throw new Error(`reading topics: ${topicError.message}`);

    const sourceCount = new Map<string, number>();
    for (const row of articles ?? []) {
      if (!row.event_id) continue;
      sourceCount.set(row.event_id, (sourceCount.get(row.event_id) ?? 0) + 1);
    }

    const labelOf = new Map((topicRows ?? []).map((t) => [t.id, t.label] as const));
    const topics = new Map<string, string[]>();
    for (const row of links ?? []) {
      const label = labelOf.get(row.topic_id);
      if (!label) continue;
      const list = topics.get(row.event_id) ?? [];
      if (!list.includes(label)) list.push(label);
      topics.set(row.event_id, list);
    }

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      importance: row.importance,
      status: row.status,
      sources: sourceCount.get(row.id) ?? 0,
      topics: topics.get(row.id) ?? [],
    }));
  });
