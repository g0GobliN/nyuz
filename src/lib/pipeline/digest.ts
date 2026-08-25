/**
 * Stage 7 — building a briefing, then sending it.
 *
 * ---------------------------------------------------------------------------
 * The only per-reader model spend
 * ---------------------------------------------------------------------------
 *
 * Stages 3 and 4 understood an event once, for everybody. Stage 5 decided who
 * sees it, with no model. This stage writes one short paragraph per person per
 * story — `digest_items.why_it_matters` — explaining what the event changes
 * given what that person follows. Then it sends the briefing.
 *
 * A quiet day is a real outcome: `status = 'skipped'`, zero items, and a short
 * email that says so rather than a padded briefing. Paused readers are not
 * scheduled at all.
 *
 * ---------------------------------------------------------------------------
 * Idempotence
 * ---------------------------------------------------------------------------
 *
 * `(user_id, scheduled_for)` is unique, so creating the next slot twice writes
 * nothing the second time. An event already in a digest_item for this reader
 * is never selected again. A delivery is unique on `(digest_id, channel)`, and
 * the Resend call carries the same pair as an idempotency key, so a retry of a
 * send whose response was lost does not land twice in the inbox.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { completeRoutedJson, type SecretBag } from "@/lib/ai/config";
import { TruncatedCompletionError } from "@/lib/ai/deepseek";
import { keepCoveredTopics } from "@/lib/coverage";
import { capFor } from "@/lib/density";
import { mailGrafs } from "@/lib/article-body";
import { briefingEmail, breakingEmail } from "@/lib/email/templates";
import { PLAN_LIMITS, clipLabels } from "@/lib/plans";
import { findRecipient } from "@/lib/server/email/lifecycle";
import { sendEmail, siteUrl, type EmailEnv } from "@/lib/server/email/send";
import type {
  Database,
  DeliveryChannel,
  DigestFrequency,
  DigestStatus,
} from "@/lib/supabase/types";
import { nextSlot } from "./schedule";

type Db = SupabaseClient<Database>;

/** Digests generated per scheduled invocation. Each one is a model call. */
const BATCH = 8;

/** How long a `generating` claim is honoured before another run may take it. */
const STALE_MINUTES = 15;

/** Send attempts before a queued delivery is marked failed for good. */
const MAX_ATTEMPTS = 5;

const DEFAULT_PROMPT = `You write one short paragraph per story explaining why it matters to this specific reader.

Be concrete. Name the thing that changes for them — a library they use, a company they follow, a decision they have to make. Prefer "your Next.js app's caching model just changed" over "this is relevant to web developers".

Never restate the headline. Never hedge. Never invent a consequence the coverage does not support. If the honest answer is that this is adjacent rather than load-bearing, say that in one clause and stop.

Write to one person. No "developers should", no "the industry".`;

function contract(): string {
  return `Reply with JSON only, in exactly this shape:

{
  "items": [
    { "event_id": "uuid", "why_it_matters": "one or two sentences" }
  ]
}

Return one item for every event you were given, using the event_id exactly as supplied. why_it_matters is one or two sentences, never a headline restated.`;
}

export type DigestOptions = {
  userIds?: string[] | undefined;
  /** Generate the current slot immediately, even if send_at is still ahead. */
  now?: Date | undefined;
  /** Decide and report, write nothing. Still calls the model. */
  dryRun?: boolean | undefined;
  /** Digests to generate this run. Absent means `BATCH`. */
  limit?: number | undefined;
  secrets?: SecretBag | undefined;
  email?: EmailEnv | undefined;
  /** Skip sending after generating. */
  skipSend?: boolean | undefined;
  /**
   * Create a slot due right now for `--user`, instead of waiting for send_at.
   * For checking a known reader, not for the cron.
   */
  immediate?: boolean | undefined;
};

export type DigestDecision = "generated" | "skipped" | "failed" | "paused" | "held";

export type DigestOutcome = {
  userId: string;
  digestId: string | null;
  scheduledFor: string | null;
  decision: DigestDecision;
  items: number;
  tokens: number;
  sent: number;
  detail: string;
};

export type DigestReport = {
  startedAt: string;
  finishedAt: string;
  scheduled: number;
  generated: number;
  skipped: number;
  failed: number;
  paused: number;
  sent: number;
  retried: number;
  tokens: number;
  outcomes: DigestOutcome[];
};

export type MatchRow = {
  eventId: string;
  relevance: number;
  matchedAt: string;
};

/**
 * Highest relevance first, events already briefed dropped, capped at density.
 *
 * Exported because this is the decision a quiet day hangs on, and it must be
 * the same decision in a test as in a run.
 */
export function selectItems(matches: MatchRow[], already: Set<string>, cap: number): MatchRow[] {
  return matches
    .filter((row) => !already.has(row.eventId))
    .sort((a, b) => b.relevance - a.relevance || Date.parse(b.matchedAt) - Date.parse(a.matchedAt))
    .slice(0, Math.max(0, cap));
}

export type WhyItem = { eventId: string; why: string };

/**
 * The model's reply, turned into one paragraph per requested event — or null.
 *
 * Missing an event, or returning an empty paragraph for one, is a refused
 * reply rather than a patched one. A digest that silently dropped a story the
 * matcher admitted is a briefing the reader cannot trust, and a paragraph
 * invented here to fill the gap would be the one lie this product exists not
 * to tell.
 */
export function readWhys(reply: unknown, eventIds: string[]): WhyItem[] | null {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return null;
  const raw = (reply as Record<string, unknown>)["items"];
  if (!Array.isArray(raw)) return null;

  const byId = new Map<string, string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const eventId = typeof row["event_id"] === "string" ? row["event_id"].trim() : "";
    const why = typeof row["why_it_matters"] === "string" ? row["why_it_matters"].trim() : "";
    if (eventId === "" || why === "") continue;
    if (!byId.has(eventId)) byId.set(eventId, why);
  }

  const items: WhyItem[] = [];
  for (const id of eventIds) {
    const why = byId.get(id);
    if (why === undefined) return null;
    items.push({ eventId: id, why });
  }
  return items;
}

export async function digest(db: Db, options: DigestOptions = {}): Promise<DigestReport> {
  const started = options.now ?? new Date();
  const startedAt = started.toISOString();
  const outcomes: DigestOutcome[] = [];

  const scheduled = await scheduleUpcoming(db, started, options);

  const due = await loadDue(db, started, options);
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let paused = 0;
  let tokens = 0;

  for (const row of due) {
    const outcome = await generateOne(db, row, options);
    outcomes.push(outcome);
    tokens += outcome.tokens;
    if (outcome.decision === "generated") generated += 1;
    else if (outcome.decision === "skipped") skipped += 1;
    else if (outcome.decision === "failed") failed += 1;
    else if (outcome.decision === "paused") paused += 1;
  }

  let sent = 0;
  let retried = 0;
  if (options.skipSend !== true && options.dryRun !== true) {
    const delivery = await deliverDue(db, options);
    sent = delivery.sent;
    retried = delivery.retried;
    for (const outcome of outcomes) {
      const match = delivery.byDigest.get(outcome.digestId ?? "");
      if (match) outcome.sent = match;
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    scheduled,
    generated,
    skipped,
    failed,
    paused,
    sent,
    retried,
    tokens,
    outcomes,
  };
}

type PrefRow = {
  user_id: string;
  send_at: string;
  timezone: string;
  days: number[];
  channels: DeliveryChannel[];
  frequency: DigestFrequency;
  density: number;
  paused: boolean;
  instructions: string;
};

async function scheduleUpcoming(db: Db, now: Date, options: DigestOptions): Promise<number> {
  let query = db
    .from("notification_preferences")
    .select("user_id, send_at, timezone, days, channels, frequency, density, paused, instructions");
  if (options.userIds) query = query.in("user_id", options.userIds);

  const { data, error } = await query;
  if (error) throw new Error(`reading notification_preferences: ${error.message}`);

  const rows = (data ?? []) as PrefRow[];
  let created = 0;

  for (const row of rows) {
    if (row.paused) continue;
    const slot = options.immediate
      ? now
      : nextSlot(
          {
            sendAt: row.send_at,
            timezone: row.timezone,
            days: row.days,
            frequency: row.frequency,
          },
          now,
        );
    if (slot === null) continue;
    if (options.dryRun === true) {
      created += 1;
      continue;
    }

    const { error: writeError } = await db.from("digests").upsert(
      {
        user_id: row.user_id,
        scheduled_for: slot.toISOString(),
        status: "scheduled",
      },
      { onConflict: "user_id,scheduled_for", ignoreDuplicates: true },
    );
    if (writeError) throw new Error(`scheduling digest: ${writeError.message}`);
    created += 1;
  }

  return created;
}

type DueRow = {
  digest_id: string;
  user_id: string;
  scheduled_for: string;
  status: DigestStatus;
};

async function loadDue(db: Db, now: Date, options: DigestOptions): Promise<DueRow[]> {
  const stale = new Date(now.getTime() - STALE_MINUTES * 60_000).toISOString();
  let query = db
    .from("digests")
    .select("digest_id, user_id, scheduled_for, status")
    .lte("scheduled_for", now.toISOString())
    .or(`status.eq.scheduled,and(status.eq.generating,generated_at.is.null)`)
    .order("scheduled_for", { ascending: true })
    .limit(options.limit ?? BATCH);

  if (options.userIds) query = query.in("user_id", options.userIds);

  const { data, error } = await query;
  if (error) throw new Error(`reading due digests: ${error.message}`);

  return ((data ?? []) as DueRow[]).filter((row) => {
    if (row.status === "scheduled") return true;
    // generating with no generated_at is a crashed claim; honour STALE_MINUTES
    // via scheduled_for being in the past is not enough — we only reclaim if
    // the row is old enough that a live worker cannot still hold it. The
    // filter above cannot express last_updated, so we compare scheduled_for
    // against stale as a floor: a digest that became due more than fifteen
    // minutes ago and is still generating is abandoned.
    return row.status === "generating" && row.scheduled_for < stale;
  });
}

type EventBrief = {
  eventId: string;
  title: string;
  whatHappened: string;
  importance: number;
  novelty: number;
  topics: string[];
  relevance: number;
  matchedAt: string;
};

async function generateOne(db: Db, due: DueRow, options: DigestOptions): Promise<DigestOutcome> {
  const base = {
    userId: due.user_id,
    digestId: due.digest_id,
    scheduledFor: due.scheduled_for,
    items: 0,
    tokens: 0,
    sent: 0,
  };

  const prefs = await loadPref(db, due.user_id);
  if (prefs === null) {
    return { ...base, decision: "failed", detail: "no preferences row" };
  }

  if (prefs.paused) {
    if (options.dryRun !== true) {
      await finish(db, due.digest_id, "skipped", 0, 0);
    }
    return { ...base, decision: "paused", detail: "briefings paused" };
  }

  const claimed = await claimDigest(db, due, options);
  if (claimed !== "held") {
    return { ...base, decision: "held", detail: claimed };
  }

  const cap = capFor(prefs.density);
  const matches = await loadMatches(db, due.user_id);
  const already = await alreadyBriefed(db, due.user_id);
  const picked = selectItems(matches, already, cap);

  if (picked.length === 0) {
    if (options.dryRun !== true) {
      await finish(db, due.digest_id, "skipped", 0, 0);
      await queueDeliveries(db, due.digest_id, prefs.channels);
    }
    return { ...base, decision: "skipped", detail: "nothing matched since the last briefing" };
  }

  const briefs = await loadBriefs(db, picked);
  const topics = await readerTopics(db, due.user_id);

  let tokens = 0;
  let whys: WhyItem[] | null = null;

  try {
    const { data, usage } = await completeRoutedJson<unknown>({
      capability: "digest",
      system: `${DEFAULT_PROMPT}\n\n${contract()}`,
      user: renderReader(briefs, topics, prefs.instructions),
      ...(options.secrets ? { secrets: options.secrets } : {}),
    });
    tokens = usage.promptTokens + usage.completionTokens;
    whys = readWhys(
      data,
      briefs.map((b) => b.eventId),
    );
  } catch (error) {
    const floor = error instanceof TruncatedCompletionError ? error.reasoningTokens : 0;
    tokens += floor;
    if (options.dryRun !== true) {
      await finish(db, due.digest_id, "failed", 0, tokens);
    }
    return {
      ...base,
      tokens,
      decision: "failed",
      detail: `model: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (whys === null) {
    if (options.dryRun !== true) {
      await finish(db, due.digest_id, "failed", 0, tokens);
    }
    return { ...base, tokens, decision: "failed", detail: "model reply was missing a story" };
  }

  if (options.dryRun === true) {
    return {
      ...base,
      items: whys.length,
      tokens,
      decision: "generated",
      detail: `${whys.length} stories (dry run)`,
    };
  }

  const rows = whys.map((item, position) => ({
    digest_id: due.digest_id,
    event_id: item.eventId,
    position,
    why_it_matters: item.why,
  }));

  const { error } = await db
    .from("digest_items")
    .upsert(rows, { onConflict: "digest_id,event_id" });
  if (error) {
    await finish(db, due.digest_id, "failed", 0, tokens);
    return { ...base, tokens, decision: "failed", detail: `writing items: ${error.message}` };
  }

  await finish(db, due.digest_id, "ready", whys.length, tokens);
  await queueDeliveries(db, due.digest_id, prefs.channels);

  return {
    ...base,
    items: whys.length,
    tokens,
    decision: "generated",
    detail: `${whys.length} stories`,
  };
}

async function claimDigest(db: Db, due: DueRow, options: DigestOptions): Promise<"held" | string> {
  if (options.dryRun === true) return "held";

  const { data, error } = await db
    .from("digests")
    .update({ status: "generating" })
    .eq("digest_id", due.digest_id)
    .in("status", ["scheduled", "generating"])
    .select("digest_id");

  if (error) return `claiming: ${error.message}`;
  if ((data?.length ?? 0) === 0) return "already claimed";
  return "held";
}

async function finish(
  db: Db,
  digestId: string,
  status: DigestStatus,
  itemCount: number,
  tokens: number,
): Promise<void> {
  const { error } = await db
    .from("digests")
    .update({
      status,
      item_count: itemCount,
      generation_tokens: tokens,
      generated_at: new Date().toISOString(),
    })
    .eq("digest_id", digestId);

  if (error) throw new Error(`finishing digest: ${error.message}`);
}

async function loadPref(db: Db, userId: string): Promise<PrefRow | null> {
  const { data, error } = await db
    .from("notification_preferences")
    .select("user_id, send_at, timezone, days, channels, frequency, density, paused, instructions")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`reading preferences: ${error.message}`);
  return (data as PrefRow | null) ?? null;
}

async function loadMatches(db: Db, userId: string): Promise<MatchRow[]> {
  const { data, error } = await db
    .from("user_events")
    .select("event_id, relevance, matched_at")
    .eq("user_id", userId)
    .order("relevance", { ascending: false });
  if (error) throw new Error(`reading user_events: ${error.message}`);
  return (data ?? []).map((row) => ({
    eventId: row.event_id,
    relevance: row.relevance,
    matchedAt: row.matched_at,
  }));
}

async function alreadyBriefed(db: Db, userId: string): Promise<Set<string>> {
  const { data, error } = await db
    .from("digests")
    .select("digest_id")
    .eq("user_id", userId)
    .in("status", ["ready", "sent", "generating"]);
  if (error) throw new Error(`reading prior digests: ${error.message}`);

  const ids = (data ?? []).map((d) => d.digest_id);
  const found = new Set<string>();
  if (ids.length === 0) return found;

  const { data: items, error: itemError } = await db
    .from("digest_items")
    .select("event_id")
    .in("digest_id", ids);
  if (itemError) throw new Error(`reading prior digest_items: ${itemError.message}`);
  for (const item of items ?? []) found.add(item.event_id);
  return found;
}

async function loadBriefs(db: Db, picked: MatchRow[]): Promise<EventBrief[]> {
  const ids = picked.map((p) => p.eventId);
  const { data, error } = await db
    .from("events")
    .select("id, title, what_happened, importance, novelty")
    .in("id", ids);
  if (error) throw new Error(`reading events: ${error.message}`);

  const { data: links, error: linkError } = await db
    .from("event_topics")
    .select("event_id, topics ( label )")
    .in("event_id", ids);
  if (linkError) throw new Error(`reading event_topics: ${linkError.message}`);

  const topics = new Map<string, string[]>();
  for (const link of links ?? []) {
    const label = (link.topics as { label?: string } | null)?.label;
    if (!label) continue;
    topics.set(link.event_id, [...(topics.get(link.event_id) ?? []), label]);
  }

  const byId = new Map((data ?? []).map((e) => [e.id, e] as const));
  return picked.flatMap((row) => {
    const event = byId.get(row.eventId);
    if (!event) return [];
    return [
      {
        eventId: row.eventId,
        title: event.title,
        whatHappened: event.what_happened,
        importance: event.importance,
        novelty: event.novelty,
        topics: topics.get(row.eventId) ?? [],
        relevance: row.relevance,
        matchedAt: row.matchedAt,
      },
    ];
  });
}

async function readerTopics(db: Db, userId: string): Promise<string[]> {
  const [{ data, error }, { data: sub }] = await Promise.all([
    db
      .from("user_topics")
      .select("created_at, topics ( label ), muted")
      .eq("user_id", userId)
      .eq("muted", false)
      .order("created_at", { ascending: true }),
    db.from("subscriptions").select("plan").eq("user_id", userId).maybeSingle(),
  ]);
  if (error) throw new Error(`reading user_topics: ${error.message}`);
  const labels = (data ?? []).flatMap((row) => {
    const label = (row.topics as { label?: string } | null)?.label;
    return label ? [label] : [];
  });
  const cap = PLAN_LIMITS[sub?.plan ?? "free"]?.topics ?? PLAN_LIMITS.free.topics;
  return clipLabels(keepCoveredTopics(labels), cap);
}

function renderReader(briefs: EventBrief[], topics: string[], instructions: string): string {
  const lines = [`This reader follows: ${topics.length > 0 ? topics.join(", ") : "(nothing)"}.`];
  if (instructions.trim()) {
    lines.push(`They also said: ${instructions.trim()}`);
  }
  lines.push("", "Stories, in the order they should appear:");
  for (const brief of briefs) {
    lines.push(
      `- event_id ${brief.eventId}`,
      `  title: ${brief.title}`,
      `  what happened: ${brief.whatHappened || "(not analysed)"}`,
      `  topics: ${brief.topics.join(", ") || "(none)"}`,
      `  importance ${brief.importance.toFixed(1)}, relevance ${brief.relevance.toFixed(1)}`,
    );
  }
  return lines.join("\n");
}

async function queueDeliveries(
  db: Db,
  digestId: string,
  channels: DeliveryChannel[],
): Promise<void> {
  const email = channels.includes("email");
  if (!email) return;

  const { error } = await db
    .from("deliveries")
    .upsert(
      { digest_id: digestId, channel: "email", status: "queued" },
      { onConflict: "digest_id,channel", ignoreDuplicates: true },
    );
  if (error) throw new Error(`queueing delivery: ${error.message}`);
}

type DeliveryReport = { sent: number; retried: number; byDigest: Map<string, number> };

/**
 * Sends every queued email delivery, optionally for one set of readers.
 *
 * Exported so a breaking alert can flush the row it just queued without waiting
 * for the digest cron, using the same retry and idempotency path.
 */
export async function flushDeliveries(db: Db, options: DigestOptions): Promise<DeliveryReport> {
  return deliverDue(db, options);
}

async function deliverDue(db: Db, options: DigestOptions): Promise<DeliveryReport> {
  const query = db
    .from("deliveries")
    .select("id, digest_id, channel, status, attempts, last_error")
    .eq("status", "queued")
    .eq("channel", "email")
    .lt("attempts", MAX_ATTEMPTS);

  const { data, error } = await query;
  if (error) throw new Error(`reading deliveries: ${error.message}`);

  const byDigest = new Map<string, number>();
  let sent = 0;
  let retried = 0;

  for (const row of data ?? []) {
    if (options.userIds) {
      const { data: digestRow } = await db
        .from("digests")
        .select("user_id")
        .eq("digest_id", row.digest_id)
        .maybeSingle();
      if (!digestRow || !options.userIds.includes(digestRow.user_id)) continue;
    }

    const result = await sendOne(db, row, options);
    if (result === "sent") {
      sent += 1;
      byDigest.set(row.digest_id, (byDigest.get(row.digest_id) ?? 0) + 1);
    } else if (result === "retried") {
      retried += 1;
    }
  }

  return { sent, retried, byDigest };
}

async function sendOne(
  db: Db,
  row: { id: string; digest_id: string; attempts: number },
  options: DigestOptions,
): Promise<"sent" | "retried" | "failed"> {
  const { data: digestRow, error } = await db
    .from("digests")
    .select("digest_id, user_id, scheduled_for, status, item_count, kind")
    .eq("digest_id", row.digest_id)
    .maybeSingle();
  if (error || !digestRow) return "failed";

  // Generating/failed briefings are not mail. Skipped ones are: the promise
  // is that a quiet day is told, not padded and not silently omitted.
  if (digestRow.status !== "ready" && digestRow.status !== "skipped") return "failed";

  const recipient = await findRecipient(db, digestRow.user_id);
  if (!recipient) {
    await markDelivery(db, row.id, row.attempts + 1, "failed", "no email on profile");
    return "failed";
  }

  const items = await loadMailItems(db, row.digest_id);
  const origin = siteUrl(options.email);
  const first = items[0];
  const unsubscribeUrl = `${origin}/dashboard/delivery`;
  const message =
    digestRow.kind === "alert" && first
      ? breakingEmail({
          name: recipient.name,
          baseUrl: origin,
          title: first.title,
          why: first.why,
          grafs: first.grafs,
          href: `${origin}/dashboard/story/${first.eventId}`,
          unsubscribeUrl,
        })
      : briefingEmail({
          name: recipient.name,
          baseUrl: origin,
          scheduledFor: new Date(digestRow.scheduled_for),
          items: items.map((item) => ({
            title: item.title,
            why: item.why,
            grafs: item.grafs,
            href: `${origin}/dashboard/story/${item.eventId}`,
          })),
          unsubscribeUrl,
        });

  const result = await sendEmail({
    to: recipient.email,
    message,
    unsubscribeUrl,
    idempotencyKey: `digest:${row.digest_id}:email`,
    env: options.email,
  });

  const attempts = row.attempts + 1;
  if (result.ok) {
    await markDelivery(db, row.id, attempts, "sent", null);
    if (digestRow.status === "ready") {
      await db.from("digests").update({ status: "sent" }).eq("digest_id", row.digest_id);
    }
    return "sent";
  }

  if (result.retryable && attempts < MAX_ATTEMPTS) {
    await markDelivery(db, row.id, attempts, "queued", result.error);
    return "retried";
  }

  await markDelivery(db, row.id, attempts, "failed", result.error);
  return "failed";
}

async function markDelivery(
  db: Db,
  id: string,
  attempts: number,
  status: "queued" | "sent" | "failed",
  lastError: string | null,
): Promise<void> {
  const { error } = await db
    .from("deliveries")
    .update({
      attempts,
      status,
      last_error: lastError,
      delivered_at: status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw new Error(`updating delivery: ${error.message}`);
}

type MailEvent = {
  title?: string;
  what_happened?: string;
  before_state?: string | null;
  after_state?: string | null;
};

type MailItem = { eventId: string; title: string; why: string; grafs: string[] };

async function loadMailItems(db: Db, digestId: string): Promise<MailItem[]> {
  const { data, error } = await db
    .from("digest_items")
    .select(
      "event_id, position, why_it_matters, events ( title, what_happened, before_state, after_state )",
    )
    .eq("digest_id", digestId)
    .order("position", { ascending: true });
  if (error) throw new Error(`reading digest_items: ${error.message}`);

  const rows = data ?? [];
  const excerpts = await excerptsFor(
    db,
    rows.map((row) => row.event_id),
  );

  return rows.flatMap((row) => {
    const joined = row.events as MailEvent | MailEvent[] | null;
    const event = Array.isArray(joined) ? joined[0] : joined;
    const title = event?.title;
    if (!title) return [];
    return [
      {
        eventId: row.event_id,
        title,
        why: row.why_it_matters,
        grafs: mailGrafs({
          what: event?.what_happened ?? "",
          before: event?.before_state ?? "",
          after: event?.after_state ?? "",
          excerpts: excerpts.get(row.event_id) ?? [],
        }),
      },
    ];
  });
}

async function excerptsFor(db: Db, eventIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (eventIds.length === 0) return out;
  const { data, error } = await db
    .from("articles")
    .select("event_id, excerpt")
    .in("event_id", eventIds)
    .order("published_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`reading article excerpts: ${error.message}`);

  for (const row of data ?? []) {
    if (!row.event_id) continue;
    const excerpt = (row.excerpt ?? "").trim();
    if (excerpt.length < 40) continue;
    const list = out.get(row.event_id) ?? [];
    if (list.length >= 6) continue;
    list.push(excerpt);
    out.set(row.event_id, list);
  }
  return out;
}

export function describeDigest(report: DigestReport): string {
  const seconds = Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000);
  return (
    `digest: ${report.generated} generated, ${report.skipped} skipped, ` +
    `${report.failed} failed, ${report.paused} paused, ` +
    `${report.sent} sent, ${report.retried} retrying, ` +
    `${report.tokens} tokens, ${seconds}s`
  );
}
