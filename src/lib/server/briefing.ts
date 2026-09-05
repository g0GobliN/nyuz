import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AiBudgetExceededError, AiUnpricedRouteError, completeRouted } from "@/lib/ai/config";
import { TruncatedCompletionError } from "@/lib/ai/deepseek";
import { signedInOnly } from "./guard";
import { backfill, WINDOW_HOURS } from "@/lib/pipeline/backfill";
import { nextSlot } from "@/lib/pipeline/schedule";
import {
  ASK_COOLDOWN_MS,
  ASK_MAX_TOKENS,
  PLAN_LIMITS,
  askCapabilityFor,
  clipLabels,
  decideAsk,
} from "@/lib/plans";
import { judgeStoryQuestion } from "@/lib/ask-scope";
import { asPercent, clockOf, importanceBand, type Story } from "@/lib/story";
import { intelligenceText, readEventIntelligence } from "@/lib/understand";
import { aiRateLimit } from "./rate-limit";
import type {
  Database,
  DigestStatus,
  PlanTier,
  SourceKind,
  SourcePref,
} from "@/lib/supabase/types";

/**
 * The reader's real matched events, and the call that fills them on day one.
 *
 * ---------------------------------------------------------------------------
 * Why the backfill is triggered from here rather than from a cron
 * ---------------------------------------------------------------------------
 *
 * Every other stage of the pipeline runs on a schedule, because every other
 * stage is about the corpus. This one is about a person who is looking at the
 * screen right now: they finished onboarding thirty seconds ago and the matcher
 * next fires at twenty-five past. The work is a single query over events that
 * were analysed for somebody else, so making them wait for a cron would be
 * waiting for nothing.
 *
 * ---------------------------------------------------------------------------
 * What stops this being an endpoint that spends money on demand
 * ---------------------------------------------------------------------------
 *
 * Nothing here takes a user id. `context.actor.id` comes from a verified access
 * token, so a caller can only ever backfill themselves — and `backfill()` itself
 * refuses to analyse anything twice for one account, caps a run at three events,
 * and will not pay for an event whose headline names nothing the reader follows.
 * The brakes are in the pipeline module rather than in this file on purpose:
 * they have to hold for the CLI and the Worker too, not only for the browser.
 *
 * ---------------------------------------------------------------------------
 * This is not the fixture dashboard. `loadHomeFeed` reads `digest_items` when a
 * briefing exists and `user_events` when it does not, and the story page reads
 * real `articles`. The sample notice comes down because nothing here is a fixture.
 */

/** One matched event, flattened for the dashboard. */
export type MatchedEvent = {
  eventId: string;
  title: string;
  whatHappened: string;
  /** 0..10, shared. The same number every reader sees. */
  importance: number;
  novelty: number;
  /** 0..∞, personal. Stage 5's ordering key for this reader. */
  relevance: number;
  matchedAt: string;
  /** Labels from `event_topics`, which is what the reader was matched on. */
  topics: string[];
  /** The outlets that reported it. */
  sources: string[];
};

export type Matches = {
  events: MatchedEvent[];
  /** Hours of corpus day one considers, so the empty state can say so. */
  windowHours: number;
};

/** Rows read per request. A dashboard page, not a corpus. */
const PAGE = 24;

/**
 * Everything this reader has matched, most relevant first.
 *
 * Ordered by `relevance` rather than `matched_at` because relevance is the
 * ordering the product promises — importance the model assigned, adjusted by how
 * many of *this* reader's interests the event touches. Sorting by arrival time
 * would be a feed, which is the thing being replaced.
 */
export const loadMatches = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<Matches> => {
    const { actor } = context;

    const { data: rows, error } = await actor.db
      .from("user_events")
      .select(
        "event_id, relevance, matched_at, events ( title, what_happened, importance, novelty )",
      )
      .eq("user_id", actor.id)
      .order("relevance", { ascending: false })
      .limit(PAGE);

    if (error) throw new Error(`reading your matches: ${error.message}`);

    const matched = (rows ?? []).flatMap((row) => {
      const event = row.events as {
        title?: string;
        what_happened?: string;
        importance?: number;
        novelty?: number;
      } | null;
      // A match whose event has gone is not an error and not a story.
      if (!event?.title) return [];
      return [
        {
          eventId: row.event_id,
          title: event.title,
          whatHappened: event.what_happened ?? "",
          importance: event.importance ?? 0,
          novelty: event.novelty ?? 0,
          relevance: row.relevance,
          matchedAt: row.matched_at,
          topics: [] as string[],
          sources: [] as string[],
        },
      ];
    });

    if (matched.length === 0) return { events: [], windowHours: WINDOW_HOURS };

    const ids = matched.map((m) => m.eventId);
    const [topics, sources] = await Promise.all([
      topicsFor(actor.db, ids),
      sourcesFor(actor.db, ids),
    ]);

    return {
      events: matched.map((m) => ({
        ...m,
        topics: topics.get(m.eventId) ?? [],
        sources: sources.get(m.eventId) ?? [],
      })),
      windowHours: WINDOW_HOURS,
    };
  });

type Db = SupabaseClient<Database>;

/** Topic labels per event, in one round trip rather than one per card. */
async function topicsFor(db: Db, eventIds: string[]): Promise<Map<string, string[]>> {
  const { data, error } = await db
    .from("event_topics")
    .select("event_id, topics ( label )")
    .in("event_id", eventIds);

  if (error) throw new Error(`reading event topics: ${error.message}`);

  const out = new Map<string, string[]>();
  for (const row of data ?? []) {
    const label = (row.topics as { label?: string } | null)?.label;
    if (!label) continue;
    out.set(row.event_id, [...(out.get(row.event_id) ?? []), label]);
  }
  return out;
}

/** Outlet names per event, de-duplicated: one outlet can report a story twice. */
async function sourcesFor(db: Db, eventIds: string[]): Promise<Map<string, string[]>> {
  const { data, error } = await db
    .from("articles")
    .select("event_id, sources ( name )")
    .in("event_id", eventIds);

  if (error) throw new Error(`reading sources: ${error.message}`);

  const out = new Map<string, string[]>();
  for (const row of data ?? []) {
    const name = (row.sources as { name?: string } | null)?.name;
    if (!row.event_id || !name) continue;
    const seen = out.get(row.event_id) ?? [];
    if (!seen.includes(name)) out.set(row.event_id, [...seen, name]);
  }
  return out;
}

export type FirstBriefing = {
  outcome: string;
  matched: number;
  analysed: number;
  detail: string;
};

/**
 * Runs day one for the caller.
 *
 * Called when onboarding finishes and once more the first time a signed-in
 * reader's answers reach the account — a visitor can complete onboarding before
 * signing up, in which case the topics only exist server-side after that first
 * authenticated sync, and matching them before it would match an empty list.
 *
 * Safe to call repeatedly: the free pass is idempotent by construction, and the
 * paid one runs at most once per account.
 */
export const startFirstBriefing = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<FirstBriefing> => {
    const report = await backfill(context.actor.db, { userId: context.actor.id });

    // Logged rather than only returned. This is the one reader-triggered path
    // that can spend model tokens, so the server keeps its own record of what it
    // decided, independent of a browser that may have navigated away.
    if (report.analysed > 0) {
      console.log(`backfill: ${report.userId} analysed ${report.analysed} for ${report.tokens}`);
    }

    return {
      outcome: report.outcome,
      matched: report.matched,
      analysed: report.analysed,
      detail: report.detail,
    };
  });

/* ---------------------------------------------------------------------- */
/* Home, briefing, history, story                                          */
/* ---------------------------------------------------------------------- */

export type HomeFeed = {
  stories: Story[];
  /** `digest` when today's briefing exists, `matches` when only user_events do. */
  source: "digest" | "matches" | "empty";
  digestStatus: DigestStatus | null;
  scheduledFor: string | null;
  nextAt: string | null;
  windowHours: number;
};

export const loadHomeFeed = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<HomeFeed> => {
    const { actor } = context;
    const nextAt = await nextSend(actor.db, actor.id);

    const latest = await latestDigest(actor.db, actor.id);
    if (latest && (latest.status === "ready" || latest.status === "sent")) {
      const stories = await storiesFromDigest(actor.db, latest.digest_id);
      return {
        stories,
        source: "digest",
        digestStatus: latest.status,
        scheduledFor: latest.scheduled_for,
        nextAt,
        windowHours: WINDOW_HOURS,
      };
    }

    if (latest?.status === "skipped") {
      return {
        stories: [],
        source: "empty",
        digestStatus: "skipped",
        scheduledFor: latest.scheduled_for,
        nextAt,
        windowHours: WINDOW_HOURS,
      };
    }

    const matches = await loadMatchedStories(actor.db, actor.id, PAGE);
    return {
      stories: matches,
      source: matches.length > 0 ? "matches" : "empty",
      digestStatus: latest?.status ?? null,
      scheduledFor: latest?.scheduled_for ?? null,
      nextAt,
      windowHours: WINDOW_HOURS,
    };
  });

export type HistoryDay = {
  digestId: string;
  iso: string;
  date: string;
  weekday: string;
  count: number;
  headline: string;
  skipped: boolean;
};

export type HistoryFeed = {
  days: HistoryDay[];
  retentionDays: number;
  retention: string;
};

export const loadHistory = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<HistoryFeed> => {
    const { actor } = context;
    const plan = await planOf(actor.db, actor.id);
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    const since = new Date(Date.now() - limits.retentionDays * 86_400_000).toISOString();

    const { data, error } = await actor.db
      .from("digests")
      .select("digest_id, scheduled_for, status, item_count")
      .eq("user_id", actor.id)
      .eq("kind", "briefing")
      .in("status", ["ready", "sent", "skipped"])
      .gte("scheduled_for", since)
      .order("scheduled_for", { ascending: false })
      .limit(Math.min(400, limits.retentionDays + 5));

    if (error) throw new Error(`reading history: ${error.message}`);

    const rows = data ?? [];
    const headlines = await headlinesFor(
      actor.db,
      rows.filter((r) => r.item_count > 0).map((r) => r.digest_id),
    );

    const days: HistoryDay[] = rows.map((row) => {
      const at = new Date(row.scheduled_for);
      return {
        digestId: row.digest_id,
        iso: row.scheduled_for,
        date: at.toLocaleDateString(undefined, { month: "long", day: "numeric" }),
        weekday: at.toLocaleDateString(undefined, { weekday: "long" }),
        count: row.item_count,
        headline: headlines.get(row.digest_id) ?? "Nothing important for your nyuz",
        skipped: row.status === "skipped" || row.item_count === 0,
      };
    });

    return { days, retentionDays: limits.retentionDays, retention: limits.retention };
  });

export const loadDigestStories = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    parseInput(z.object({ digestId: z.string().uuid().optional() }), input ?? {}),
  )
  .handler(async ({ context, data }): Promise<Story[]> => {
    const { actor } = context;
    if (data.digestId) {
      const { data: row, error } = await actor.db
        .from("digests")
        .select("digest_id")
        .eq("digest_id", data.digestId)
        .eq("user_id", actor.id)
        .maybeSingle();
      if (error) throw new Error(`reading digest: ${error.message}`);
      if (!row) return [];
      return storiesFromDigest(actor.db, row.digest_id);
    }
    const latest = await latestDigest(actor.db, actor.id);
    if (!latest || latest.item_count === 0) return [];
    return storiesFromDigest(actor.db, latest.digest_id);
  });

export const loadSavedStories = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<Story[]> => {
    const { data, error } = await context.actor.db
      .from("saved_stories")
      .select("event_id")
      .eq("user_id", context.actor.id)
      .order("saved_at", { ascending: false });
    if (error) throw new Error(`reading saved stories: ${error.message}`);
    const ids = (data ?? []).map((r) => r.event_id);
    return storiesFromEventIds(context.actor.db, context.actor.id, ids);
  });

export const searchStories = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) => parseInput(z.object({ q: z.string().max(120) }), input))
  .handler(async ({ context, data }): Promise<Story[]> => {
    const term = data.q.trim();
    if (term.length < 2) return [];
    const stories = await loadMatchedStories(context.actor.db, context.actor.id, 80);
    const needle = term.toLowerCase();
    return stories.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) ||
        s.org.toLowerCase().includes(needle) ||
        s.what.toLowerCase().includes(needle) ||
        s.topics.some((t) => t.toLowerCase().includes(needle)),
    );
  });

export const loadStory = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) => parseInput(z.object({ id: z.string().min(1).max(80) }), input))
  .handler(async ({ context, data }): Promise<Story | null> => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)) {
      return null;
    }
    const stories = await storiesFromEventIds(context.actor.db, context.actor.id, [data.id]);
    return stories[0] ?? null;
  });

export type SentAlert = {
  digestId: string;
  eventId: string;
  title: string;
  why: string;
  at: string;
  status: "queued" | "sent" | "failed" | "bounced";
};

export const loadRecentAlerts = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<SentAlert[]> => {
    const { actor } = context;
    const { data, error } = await actor.db
      .from("digests")
      .select("digest_id, scheduled_for, status")
      .eq("user_id", actor.id)
      .eq("kind", "alert")
      .in("status", ["ready", "sent"])
      .order("scheduled_for", { ascending: false })
      .limit(20);
    if (error) throw new Error(`reading alerts: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.digest_id);
    const [{ data: items, error: itemError }, { data: deliveries, error: deliveryError }] =
      await Promise.all([
        actor.db
          .from("digest_items")
          .select("digest_id, event_id, why_it_matters, events ( title )")
          .in("digest_id", ids),
        actor.db.from("deliveries").select("digest_id, status, delivered_at").in("digest_id", ids),
      ]);
    if (itemError) throw new Error(`reading alert items: ${itemError.message}`);
    if (deliveryError) throw new Error(`reading alert deliveries: ${deliveryError.message}`);

    const itemOf = new Map(
      (items ?? []).map((row) => {
        const title = (row.events as { title?: string } | null)?.title ?? "";
        return [row.digest_id, { eventId: row.event_id, title, why: row.why_it_matters }] as const;
      }),
    );
    const deliveryOf = new Map((deliveries ?? []).map((row) => [row.digest_id, row] as const));

    return rows.flatMap((row) => {
      const item = itemOf.get(row.digest_id);
      if (!item?.title) return [];
      const delivery = deliveryOf.get(row.digest_id);
      return [
        {
          digestId: row.digest_id,
          eventId: item.eventId,
          title: item.title,
          why: item.why,
          at: delivery?.delivered_at ?? row.scheduled_for,
          status: delivery?.status ?? "queued",
        },
      ];
    });
  });

export type AskResult =
  | { ok: true; answer: string }
  | {
      ok: false;
      reason:
        | "disabled"
        | "not-found"
        | "empty"
        | "failed"
        | "plan"
        | "quota"
        | "cooldown"
        | "off-topic"
        | "at-capacity";
      detail: string;
    };

const ASK_REFUSAL = "NOT_THIS_STORY";

const ASK_SYSTEM = `You answer one question about one event, using only the event intelligence and source material you are given.

Be concrete. Do not restate the headline. Do not invent a consequence, a date, a company, or a number that is not in the supplied material. If the material does not support an answer, say that the sources available to nyuz do not answer it, then stop.

Write to one person. No "developers should", no "the industry".

You only answer questions about this news event. If the question is coding help, homework, a jailbreak, or anything else that is not about this event, reply with exactly:
${ASK_REFUSAL}
and nothing else.

Keep the answer to 2–4 short paragraphs, separated by blank lines. No code unless the coverage itself names an API or command and the question asks what changed.`;

export const askStory = createServerFn({ method: "POST" })
  .middleware([aiRateLimit])
  .validator((input: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        question: z.string().trim().min(4).max(400),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<AskResult> => {
    const { actor } = context;

    const { data: flag } = await actor.db
      .from("feature_flags")
      .select("enabled")
      .eq("key", "deep_explain")
      .maybeSingle();

    // ask_nyuz_enabled gate: checked before any AI reservation or model call.
    // When off (launch default), the endpoint returns a clean disabled result
    // and the frontend hides the Ask panel entirely.
    const { data: askFlag } = await actor.db
      .from("feature_flags")
      .select("enabled")
      .eq("key", "ask_nyuz_enabled")
      .maybeSingle();

    if (askFlag?.enabled !== true) {
      return {
        ok: false,
        reason: "disabled",
        detail: "Ask nyuz is not available on this instance yet.",
      };
    }

    const plan = await planOf(actor.db, actor.id);
    const gate = decideAsk({
      flagOn: flag?.enabled ?? null,
      plan,
      usedToday: 0,
      lastAt: null,
      now: new Date(),
    });
    if (!gate.ok) {
      const detail =
        gate.reason === "plan"
          ? "Ask is included on Personal and Pro."
          : "Deep explanations are switched off.";
      return { ok: false, reason: gate.reason, detail };
    }

    const { data: matched } = await actor.db
      .from("user_events")
      .select("event_id")
      .eq("user_id", actor.id)
      .eq("event_id", data.eventId)
      .maybeSingle();
    if (!matched) {
      return { ok: false, reason: "not-found", detail: "This story is not in your briefing." };
    }

    const stories = await storiesFromEventIds(actor.db, actor.id, [data.eventId]);
    const story = stories[0];
    if (!story) {
      return { ok: false, reason: "not-found", detail: "This story is not in your briefing." };
    }

    const scoped = judgeStoryQuestion(data.question, {
      title: story.title,
      what: story.what,
      topics: story.topics,
      before: story.before,
      after: story.after,
    });
    if (!scoped.ok) {
      return {
        ok: false,
        reason: "off-topic",
        detail: "Ask only about this story.",
      };
    }

    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    const cap = limits.asksPerDay;
    const { data: claimed, error: claimError } = await actor.db.rpc("claim_ask", {
      p_user_id: actor.id,
      p_event_id: data.eventId,
      p_cap: cap,
      p_cooldown_ms: ASK_COOLDOWN_MS,
    });
    if (claimError || claimed !== "ok") {
      const reason =
        claimed === "quota" || claimed === "cooldown" || claimed === "plan" ? claimed : "failed";
      const detail =
        reason === "quota"
          ? "You've asked a lot today. Come back tomorrow."
          : reason === "cooldown"
            ? "Wait a moment before asking again."
            : reason === "plan"
              ? "Ask is included on Personal and Pro."
              : "Ask is temporarily unavailable.";
      return { ok: false, reason, detail };
    }

    const coverage = [
      `Title: ${story.title}`,
      `What happened: ${story.what}`,
      story.before ? `Before: ${story.before}` : "",
      story.after ? `After: ${story.after}` : "",
      story.understand
        ? `Shared event intelligence:\n${intelligenceText(story.understand).join("\n")}`
        : "",
      ...story.sourceList.slice(0, 6).map((source, index) => {
        const excerpt = (source.excerpt ?? "").replace(/\s+/g, " ").trim().slice(0, 700);
        const label = `[${index + 1}] ${source.name}${source.headline ? ` — ${source.headline}` : ""}`;
        return excerpt ? `${label}\n${excerpt}` : label;
      }),
      "",
      `Question: ${data.question}`,
    ]
      .filter((line) => line.length > 0)
      .join("\n");

    // The Story Ask cache (0062) is deliberately not consulted. Ask is not a
    // material cost driver at this stage; the table and RPCs stay dormant in the
    // database so it can be switched back on after P0.

    try {
      const capability = askCapabilityFor(limits.askModel);
      if (capability === null) {
        return { ok: false, reason: "plan", detail: "Ask is included on Personal and Pro." };
      }
      const result = await completeRouted({
        capability,
        system: ASK_SYSTEM,
        user: coverage,
        maxTokens: ASK_MAX_TOKENS,
        feature: "ask",
        meterUserId: actor.id,
        userMonthlyTokenCap: limits.monthlyAiTokenCap,
        signal: AbortSignal.timeout(25_000),
      });
      const answer = result.content.trim();
      if (!answer) {
        return { ok: false, reason: "empty", detail: "The model returned nothing usable." };
      }
      if (answer === ASK_REFUSAL || answer.startsWith(ASK_REFUSAL)) {
        return { ok: false, reason: "off-topic", detail: "Ask only about this story." };
      }
      return { ok: true, answer };
    } catch (error) {
      // The monthly ceiling is an operator state, not a reader mistake. Saying
      // "could not be generated" would send somebody retrying against a wall
      // that will not move until the month rolls over or the cap is raised.
      // `AiUnpricedRouteError` is an operator misconfiguration rather than a
      // budget state, but it is indistinguishable from one to a reader and has
      // the same remedy — wait for somebody to fix it — so it reads the same.
      if (error instanceof AiBudgetExceededError || error instanceof AiUnpricedRouteError) {
        return {
          ok: false,
          reason: "at-capacity",
          detail: "Ask is at capacity right now. Please try again later.",
        };
      }
      const timedOut = error instanceof Error && /aborted|timeout/i.test(error.message);
      const detail =
        error instanceof TruncatedCompletionError
          ? "The model ran out of tokens before finishing."
          : timedOut
            ? "The explanation took too long. Try again."
            : "The explanation could not be generated.";
      return { ok: false, reason: "failed", detail };
    }
  });

export type WatchedSource = {
  id: string;
  name: string;
  kind: SourceKind;
  homepage: string | null;
  pref: SourcePref;
  /** False only when a downgrade preserved a priority beyond the new plan cap. */
  priorityActive: boolean;
};

export type SourceGroup = { group: string; items: WatchedSource[] };

const KIND_LABEL: Record<SourceKind, string> = {
  company_blog: "Official company blogs",
  news: "News sites",
  rss: "RSS",
  github: "GitHub",
  research: "Research",
  product: "Product announcements",
  other: "Other",
};

/**
 * The reader's source page.
 *
 * This used to be `select id, name, kind, homepage from sources where active`
 * with no limit — every reader pulled the entire global table on every visit.
 * Two things were wrong with that, and only one of them was performance.
 *
 * `sources` became reader-writable in 0030: a feed one person adds is a row in
 * the same global table everyone reads. So the unbounded select showed every
 * account every other account's private sources. 0039 adds `listed` and
 * replaces the `using (true)` policy; this function is the application half of
 * the same fix, and it matters independently because `actor.db` holds the
 * service-role key and therefore bypasses RLS entirely.
 *
 * What a reader now gets: catalogue sources (`listed`) that cover a subject
 * they actually follow, through `source_topics`, plus every source they follow
 * themselves regardless of topic — they asked for those by name, so a topic
 * filter has no business hiding them. Bounded and paged in SQL, so the page
 * cost does not grow with the size of the catalogue.
 */
export const loadWatchedSources = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    parseInput(
      z.object({
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      }),
      input ?? {},
    ),
  )
  .handler(async ({ context, data }): Promise<SourceGroup[]> => {
    const { actor } = context;
    const [{ data: rows, error }, { data: prefs, error: prefError }, { data: subscription }] =
      await Promise.all([
        actor.db.rpc("reader_sources", {
          p_user_id: actor.id,
          p_limit: data.limit,
          p_offset: data.offset,
        }),
        actor.db
          .from("user_source_prefs")
          .select("source_id, pref, created_at")
          .eq("user_id", actor.id),
        actor.db.from("subscriptions").select("plan").eq("user_id", actor.id).maybeSingle(),
      ]);
    if (error) throw new Error(`reading sources: ${error.message}`);
    if (prefError) throw new Error(`reading source prefs: ${prefError.message}`);

    return groupForReader(rows ?? [], prefs ?? [], subscription?.plan ?? "free");
  });

/**
 * Explicit search, for finding a source you do not already have.
 *
 * Deliberately wider than the list above: the whole catalogue rather than only
 * the subjects already followed, because somebody typing a publication's name
 * is looking for something outside what they have. Never wider than the
 * catalogue plus their own follows — the bound that matters is unchanged.
 */
export const searchSources = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) => parseInput(z.object({ q: z.string().max(120) }), input ?? {}))
  .handler(async ({ context, data }): Promise<SourceGroup[]> => {
    const { actor } = context;
    const term = data.q.trim();
    if (term.length < 2) return [];

    const [{ data: rows, error }, { data: prefs }, { data: subscription }] = await Promise.all([
      actor.db.rpc("search_reader_sources", { p_user_id: actor.id, p_query: term, p_limit: 40 }),
      actor.db
        .from("user_source_prefs")
        .select("source_id, pref, created_at")
        .eq("user_id", actor.id),
      actor.db.from("subscriptions").select("plan").eq("user_id", actor.id).maybeSingle(),
    ]);
    if (error) throw new Error(`searching sources: ${error.message}`);

    return groupForReader(rows ?? [], prefs ?? [], subscription?.plan ?? "free");
  });

/**
 * Shared shaping for both of the above.
 *
 * The priority-cap arithmetic is the fiddly part and duplicating it would let
 * the list and the search disagree about which of a reader's priorities are
 * live — the same figure the billing page quotes.
 */
function groupForReader(
  rows: { id: string; name: string; kind: SourceKind; homepage: string | null }[],
  prefs: { source_id: string; pref: SourcePref; created_at: string }[],
  plan: PlanTier,
): SourceGroup[] {
  const prefOf = new Map(prefs.map((p) => [p.source_id, p.pref] as const));
  const priorityCap = PLAN_LIMITS[plan]?.prioritySources ?? PLAN_LIMITS.free.prioritySources;
  const activePriorities = new Set(
    clipLabels(
      prefs
        .filter((p) => p.pref === "priority")
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      priorityCap,
    ).map((p) => p.source_id),
  );

  const grouped = new Map<SourceKind, WatchedSource[]>();
  for (const row of rows) {
    const item: WatchedSource = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      homepage: row.homepage,
      pref: prefOf.get(row.id) ?? "normal",
      priorityActive: activePriorities.has(row.id),
    };
    grouped.set(row.kind, [...(grouped.get(row.kind) ?? []), item]);
  }

  return (Object.keys(KIND_LABEL) as SourceKind[])
    .map((kind) => ({ group: KIND_LABEL[kind], items: grouped.get(kind) ?? [] }))
    .filter((g) => g.items.length > 0);
}

export const setSourcePref = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    z
      .object({ sourceId: z.string().uuid(), pref: z.enum(["normal", "priority", "muted"]) })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: boolean; reason?: "plan" }> => {
    if (data.pref === "priority") {
      const plan = await planOf(context.actor.db, context.actor.id);
      const cap = PLAN_LIMITS[plan]?.prioritySources ?? PLAN_LIMITS.free.prioritySources;
      if (Number.isFinite(cap)) {
        const { count } = await context.actor.db
          .from("user_source_prefs")
          .select("source_id", { count: "exact", head: true })
          .eq("user_id", context.actor.id)
          .eq("pref", "priority");
        if ((count ?? 0) >= cap) return { ok: false, reason: "plan" };
      }
    }
    const { error } = await context.actor.db.from("user_source_prefs").upsert({
      user_id: context.actor.id,
      source_id: data.sourceId,
      pref: data.pref,
    });
    if (error?.message.includes("priority source cap exceeded")) {
      return { ok: false, reason: "plan" };
    }
    if (error) throw new Error(`saving source preference: ${error.message}`);
    return { ok: true };
  });

/* ---------------------------------------------------------------------- */
/* Mapping                                                                 */
/* ---------------------------------------------------------------------- */

type DigestHead = {
  digest_id: string;
  scheduled_for: string;
  status: DigestStatus;
  item_count: number;
};

async function latestDigest(db: Db, userId: string): Promise<DigestHead | null> {
  const { data, error } = await db
    .from("digests")
    .select("digest_id, scheduled_for, status, item_count")
    .eq("user_id", userId)
    .eq("kind", "briefing")
    .in("status", ["ready", "sent", "skipped", "generating", "failed"])
    .order("scheduled_for", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`reading latest digest: ${error.message}`);
  return data;
}

async function nextSend(db: Db, userId: string): Promise<string | null> {
  const { data } = await db
    .from("notification_preferences")
    .select("send_at, timezone, days, frequency, paused")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || data.paused) return null;
  const slot = nextSlot(
    {
      sendAt: data.send_at,
      timezone: data.timezone,
      days: data.days,
      frequency: data.frequency,
    },
    new Date(),
  );
  return slot?.toISOString() ?? null;
}

async function planOf(db: Db, userId: string): Promise<PlanTier> {
  const { data } = await db
    .from("subscriptions")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.plan ?? "free";
}

async function headlinesFor(db: Db, digestIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (digestIds.length === 0) return out;
  const { data, error } = await db
    .from("digest_items")
    .select("digest_id, position, events ( title )")
    .in("digest_id", digestIds)
    .eq("position", 0);
  if (error) throw new Error(`reading digest headlines: ${error.message}`);
  for (const row of data ?? []) {
    const title = (row.events as { title?: string } | null)?.title;
    if (title) out.set(row.digest_id, title);
  }
  return out;
}

async function storiesFromDigest(db: Db, digestId: string): Promise<Story[]> {
  const { data, error } = await db
    .from("digest_items")
    .select("event_id, position, why_it_matters")
    .eq("digest_id", digestId)
    .order("position", { ascending: true });
  if (error) throw new Error(`reading digest_items: ${error.message}`);
  const items = data ?? [];
  const why = new Map(items.map((i) => [i.event_id, i.why_it_matters] as const));
  const order = items.map((i) => i.event_id);
  const stories = await hydrateEvents(db, order);
  return stories.map((s) => ({ ...s, why: why.get(s.id) ?? s.why }));
}

async function loadMatchedStories(db: Db, userId: string, limit: number): Promise<Story[]> {
  const { data, error } = await db
    .from("user_events")
    .select("event_id, relevance, matched_at")
    .eq("user_id", userId)
    .order("relevance", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`reading user_events: ${error.message}`);
  const rows = data ?? [];
  const stories = await hydrateEvents(
    db,
    rows.map((r) => r.event_id),
  );
  const relevance = new Map(rows.map((r) => [r.event_id, r.relevance] as const));
  const matchedAt = new Map(rows.map((r) => [r.event_id, r.matched_at] as const));
  return stories.map((s) => ({
    ...s,
    score: { ...s.score, relevance: asPercent(relevance.get(s.id) ?? 0) },
    publishedAt: matchedAt.get(s.id) ?? s.publishedAt,
    time: clockOf(matchedAt.get(s.id) ?? s.publishedAt),
  }));
}

async function storiesFromEventIds(db: Db, userId: string, eventIds: string[]): Promise<Story[]> {
  if (eventIds.length === 0) return [];
  const [stories, why, personalization] = await Promise.all([
    hydrateEvents(db, eventIds),
    whyFor(db, userId, eventIds),
    personalizationFor(db, userId, eventIds),
  ]);
  return stories.map((s) => {
    const forThisStory = personalization.get(s.id);
    return {
      ...s,
      why: why.get(s.id) ?? s.why,
      ...(forThisStory ? { personalization: forThisStory } : {}),
    };
  });
}

async function whyFor(db: Db, userId: string, eventIds: string[]): Promise<Map<string, string>> {
  const { data } = await db
    .from("digest_items")
    .select("event_id, why_it_matters, digests ( user_id, scheduled_for )")
    .in("event_id", eventIds);
  const why = new Map<string, string>();
  for (const row of data ?? []) {
    const digest = row.digests as { user_id?: string } | null;
    if (digest?.user_id !== userId) continue;
    if (!why.has(row.event_id)) why.set(row.event_id, row.why_it_matters);
  }
  return why;
}

/**
 * "Why you're seeing this", computed, never generated.
 *
 * Two things both have to be true: the event actually reached this reader
 * through their own subscriptions (a `user_events` row exists -- a reader who
 * found this by search or a shared link gets nothing here, correctly), and it
 * shares a topic label with what they follow. No LLM call: `user_topics` and
 * `event_topics` both store the reader-facing label directly, so this is a
 * plain intersection.
 */
async function personalizationFor(
  db: Db,
  userId: string,
  eventIds: string[],
): Promise<Map<string, { heading: string; explanation: string }>> {
  const out = new Map<string, { heading: string; explanation: string }>();
  const [matches, followed, eventLabels] = await Promise.all([
    db.from("user_events").select("event_id").eq("user_id", userId).in("event_id", eventIds),
    db.from("user_topics").select("topics ( label )").eq("user_id", userId).eq("muted", false),
    topicsFor(db, eventIds),
  ]);

  const matchedIds = new Set((matches.data ?? []).map((row) => row.event_id));
  if (matchedIds.size === 0) return out;

  const followedLabels = new Set(
    (followed.data ?? [])
      .map((row) => (row.topics as { label?: string } | null)?.label)
      .filter((label): label is string => Boolean(label))
      .map((label) => label.toLowerCase()),
  );
  if (followedLabels.size === 0) return out;

  for (const eventId of matchedIds) {
    const labels = eventLabels.get(eventId) ?? [];
    const overlap = labels.filter((label) => followedLabels.has(label.toLowerCase()));
    if (overlap.length === 0) continue;
    out.set(eventId, {
      heading: "Why you're seeing this",
      explanation: `You follow ${joinLabels(overlap)}.`,
    });
  }
  return out;
}

function joinLabels(labels: string[]): string {
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

type EventBits = {
  id: string;
  title: string;
  what_happened: string;
  importance: number;
  novelty: number;
  before_state: string | null;
  after_state: string | null;
  first_seen_at: string;
  last_updated_at: string;
  analysed_at: string | null;
  understand: unknown;
};

async function hydrateEvents(db: Db, eventIds: string[]): Promise<Story[]> {
  if (eventIds.length === 0) return [];

  const { data: events, error } = await db
    .from("events")
    .select(
      "id, title, what_happened, importance, novelty, before_state, after_state, first_seen_at, last_updated_at, analysed_at, understand",
    )
    .in("id", eventIds);
  if (error) throw new Error(`reading events: ${error.message}`);

  const byId = new Map(((events ?? []) as EventBits[]).map((e) => [e.id, e] as const));
  const [topics, articles] = await Promise.all([
    topicsFor(db, eventIds),
    articlesFor(db, eventIds),
  ]);

  return eventIds.flatMap((id) => {
    const event = byId.get(id);
    if (!event) return [];
    const coverage = articles.get(id) ?? [];
    const understand = readEventIntelligence(event.understand, coverage.length);
    const publishedAt = coverage[0]?.publishedAt ?? event.analysed_at ?? event.first_seen_at;
    return [
      {
        id: event.id,
        org: coverage[0]?.name ?? topics.get(id)?.[0] ?? "Unattributed",
        title: event.title,
        what: event.what_happened,
        why: "",
        importance: importanceBand(event.importance),
        score: {
          relevance: asPercent(event.importance),
          importance: asPercent(event.importance),
          novelty: asPercent(event.novelty),
        },
        sources: coverage.length,
        topics: topics.get(id) ?? [],
        time: clockOf(publishedAt),
        publishedAt,
        updatedAt: event.last_updated_at,
        sourceList: coverage.map((c) => ({
          name: c.name,
          at: clockOf(c.publishedAt),
          url: c.url,
          headline: c.headline,
          ...(c.excerpt ? { excerpt: c.excerpt } : {}),
        })),
        before: event.before_state ?? "",
        after: event.after_state ?? "",
        timeline: coverage.map((c) => ({
          at: clockOf(c.publishedAt),
          label: `${c.name} published`,
        })),
        ...(understand ? { understand } : {}),
      },
    ];
  });
}

type Coverage = {
  name: string;
  url: string;
  headline: string;
  publishedAt: string;
  excerpt: string;
};

async function articlesFor(db: Db, eventIds: string[]): Promise<Map<string, Coverage[]>> {
  const { data, error } = await db
    .from("articles")
    .select("event_id, url, title, published_at, excerpt, sources ( name )")
    .in("event_id", eventIds)
    .order("published_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`reading articles: ${error.message}`);

  const out = new Map<string, Coverage[]>();
  for (const row of data ?? []) {
    if (!row.event_id) continue;
    const name = (row.sources as { name?: string } | null)?.name ?? "Unattributed";
    const publishedAt = row.published_at ?? "";
    const excerpt = (row.excerpt ?? "").trim();
    const list = out.get(row.event_id) ?? [];
    if (!list.some((c) => c.url === row.url)) {
      list.push({ name, url: row.url, headline: row.title, publishedAt, excerpt });
    }
    out.set(row.event_id, list);
  }
  return out;
}
