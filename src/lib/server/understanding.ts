/**
 * The long explanation, generated when somebody actually asks for it.
 *
 * ---------------------------------------------------------------------------
 * What changed and why
 * ---------------------------------------------------------------------------
 *
 * This prose used to be written by the background analysis pass, into
 * `events.understand`, for every event any reader's topics demanded. That meant
 * paying for 200-350 words about every story in the corpus regardless of whether
 * one person ever opened it — 615 calls and $4.47 of a $10 monthly ceiling in
 * the eleven days to 2026-09-12, against an open rate nobody had measured,
 * because the spend never depended on it.
 *
 * The rule now is the one the product always claimed: expensive work happens
 * when a reader asks for depth.
 *
 *   no click                      -> no generation
 *   briefing list                 -> no generation
 *   alert                         -> no generation
 *   opening a cached story        -> no generation
 *   opening an uncached story     -> exactly one generation, shared forever
 *
 * ---------------------------------------------------------------------------
 * Shared, not personal
 * ---------------------------------------------------------------------------
 *
 * The cache key is `(event_id, content_version)` and contains no user. A
 * hundred readers of one story share one generation. This is the same argument
 * `events` itself rests on and the same one `translate.ts` documents: expensive
 * work is charged per thing that happened, not per person who reads about it.
 *
 * ---------------------------------------------------------------------------
 * Existing content is never regenerated
 * ---------------------------------------------------------------------------
 *
 * `events.understand` already holds good prose for ~615 events. None of it is
 * copied, migrated or rewritten. `readUnderstanding` prefers a row in
 * `event_understanding`, falls back to the legacy column, and only generates
 * when both are empty. An event analysed before this shipped therefore costs
 * nothing and looks identical to the reader.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { completeRoutedJson, type SecretBag } from "@/lib/ai/config";
import { loadAiRuntimeConfig } from "@/lib/ai/runtime-config";
import { readEventIntelligence, type EventIntelligence } from "@/lib/understand";
import { contentVersion, coverageTextOf } from "@/lib/pipeline/event-version";
import {
  renderSelectedCoverage,
  selectEvidence,
  type EvidenceArticle,
} from "@/lib/pipeline/evidence-selection";
import { recordOps } from "@/lib/server/ops";

type Db = SupabaseClient<Database>;

/** Bumped when the prompt below changes in a way that should produce new prose. */
export const UNDERSTAND_PROMPT_VERSION = "understand:1";

/**
 * How many readers may push one event through generation before it is left
 * alone. Three, and the count is per `(event, version)` rather than per reader,
 * so a story that cannot be generated costs three calls in its lifetime rather
 * than three per person who opens it.
 */
export const UNDERSTAND_MAX_ATTEMPTS = 3;

/**
 * How long a reader's request waits for somebody else's in-flight generation.
 *
 * The loser of a claim does not generate and does not fail: it waits, because
 * the winner is seconds away from writing the row it wants. If the wait runs
 * out the reader gets the story without the long explanation and the next open
 * finds it cached — a slightly thinner page once, rather than a second bill.
 */
const WAIT_TOTAL_MS = 12_000;
const WAIT_POLL_MS = 750;

/**
 * The most coverage that may be sent. Bounded here as well as in the evidence
 * selector, because this is the reader-triggered path: an event that somehow
 * accumulated two hundred articles must not become a two hundred article prompt.
 */
const MAX_EVIDENCE_ARTICLES = 8;

/**
 * Article length.
 *
 * Note this is SHORTER than the background pass produced. `READER_ARTICLE_CONTRACT`
 * allows 250-700 words and lets the evidence decide; this asks for 200-350. That
 * is a deliberate product decision to bound the cost of a reader-triggered call,
 * not an accident of the port — it is named here so reverting it is one edit.
 */
const TARGET_WORDS_MIN = 200;
const TARGET_WORDS_MAX = 350;

const SYSTEM = `You explain one news event to a reader who has just asked to understand it properly.

You are given numbered coverage of a single event. Everything you write must be
supported by that coverage. Never add background, speculation or invented facts,
and never describe the coverage itself — write about the event, not about what
"an article reported".`;

function contract(): string {
  return `Reply with JSON only, in exactly this shape:

{
  "coverage": "thin, normal, or rich, based on usable unique facts rather than source count",
  "one_sentence": "one compact sentence on how the important actors and actions connect and what the event fundamentally means",
  "numbers": [{ "value": "$13B", "label": "Deal value", "evidence": [1] }],
  "context": [{ "text": "supported background needed to understand the event", "evidence": [2] }],
  "audiences": [{ "audience": "Developers", "implication": "a concrete practical consequence for this group specifically", "evidence": [2] }],
  "what_next": [{ "text": "a reported next step, not a prediction", "evidence": [2] }],
  "unknowns": ["The settlement amount was not disclosed"],
  "conflicts": [{ "topic": "Transaction value", "reports": [{ "text": "$12B", "evidence": [1] }, { "text": "$13B", "evidence": [2] }] }],
  "timeline": [{ "when": "Q4", "what": "Expected closing", "evidence": [2] }],
  "article": {
    "deck": { "text": "1-2 sentences introducing the event and why it is worth reading, without repeating the headline", "evidence": [1] },
    "paragraphs": [{ "text": "a natural paragraph developing the story", "evidence": [1], "heading": null }]
  }
}

evidence is article numbers from the numbered list in the user message. Use only
valid numbers; a statement supported by several articles lists each of them.

article is the reader-facing piece and the reason this was generated. Write one
connected editorial narrative from beginning to end — not fact fragments, and
not the other fields restated as sections. The deck leads into the body; the
first paragraph advances it rather than repeating it. Cover the meaningful new
facts, the important numbers, the context that makes them make sense, the
practical consequences, and any conflicting accounts or real uncertainty the
coverage supports. Distinguish reported fact from bounded implication.

Aim for ${TARGET_WORDS_MIN}-${TARGET_WORDS_MAX} words across roughly 3-5 short
paragraphs. Thin evidence justifies less, and a complete ${TARGET_WORDS_MIN}-word
answer stops there: never pad to reach the range, never add generic industry
history, never restate the introduction as a conclusion. For every paragraph
ask whether removing it would leave the reader less informed; if not, remove it.

Use clear modern English, short to medium sentences, concrete language and a
calm editorial tone. Avoid PR language and cliches such as "In today's rapidly
evolving landscape", "It remains to be seen" and "This marks a significant
milestone". Set heading to null unless a real topic transition introduces
several paragraphs.

Every field other than article is optional in substance: use [] or null where
the evidence does not justify it. Never manufacture a timeline from one date,
numbers without meaningful labels, implications not grounded in the evidence, or
next steps that were not reported. For thin coverage, a one_sentence summary,
one or two numbers and the article may be the entire useful answer.`;
}

export type UnderstandingArticle = {
  id: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
  source_id: string | null;
};

export type UnderstandingOutcome =
  | { status: "cached"; understanding: EventIntelligence; source: "table" | "legacy" }
  | { status: "generated"; understanding: EventIntelligence }
  | { status: "waited"; understanding: EventIntelligence | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

/**
 * The cached explanation for an event, or null. Never calls a model.
 *
 * Order matters: a row in `event_understanding` is the current answer, and the
 * legacy column is what the background pass left behind. Preferring the table
 * means a regenerated event shows its new prose while an untouched one keeps
 * serving what it always did.
 */
export async function readUnderstanding(
  db: Db,
  eventId: string,
  legacy: unknown,
  evidenceCount: number,
  version?: string,
): Promise<{ understanding: EventIntelligence | null; source: "table" | "legacy" | "none" }> {
  let query = db
    .from("event_understanding")
    .select("payload, status")
    .eq("event_id", eventId)
    .eq("status", "ready");
  if (version) query = query.eq("content_version", version);
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A cache read that fails is not a reason to fail the page. Fall through to
  // the legacy column, which is what the reader saw yesterday anyway.
  if (!error && data?.payload) {
    const parsed = readEventIntelligence(data.payload, evidenceCount);
    if (parsed) return { understanding: parsed, source: "table" };
  }
  const fallback = readEventIntelligence(legacy, evidenceCount);
  return fallback
    ? { understanding: fallback, source: "legacy" }
    : { understanding: null, source: "none" };
}

/** Bulk form of the table read, for hydrating several events at once. */
export async function readUnderstandingBatch(
  db: Db,
  eventIds: string[],
): Promise<Map<string, unknown>> {
  if (eventIds.length === 0) return new Map();
  const { data, error } = await db
    .from("event_understanding")
    .select("event_id, payload, updated_at")
    .in("event_id", eventIds)
    .eq("status", "ready")
    .order("updated_at", { ascending: false });
  if (error) return new Map();
  const byEvent = new Map<string, unknown>();
  // Ordered newest first, so the first row seen for an event is the one to keep.
  for (const row of data ?? []) {
    if (!byEvent.has(row.event_id) && row.payload) byEvent.set(row.event_id, row.payload);
  }
  return byEvent;
}

export type EnsureOptions = {
  secrets?: SecretBag;
  /** Outlet names by source id, for the numbered evidence list. */
  outlets?: Map<string, string>;
  now?: Date;
};

/**
 * Cache hit, or exactly one generation shared by everybody who asks next.
 *
 * The caller must already have decided that a reader genuinely asked for this.
 * Prefetch, list rendering and alert delivery must not reach here.
 */
export async function ensureUnderstanding(
  db: Db,
  event: { id: string; title: string; understand: unknown },
  articles: UnderstandingArticle[],
  options: EnsureOptions = {},
): Promise<UnderstandingOutcome> {
  if (articles.length === 0) return { status: "skipped", reason: "no coverage" };

  const version = await contentVersion(coverageTextOf(articles));
  const cached = await readUnderstanding(db, event.id, event.understand, articles.length, version);
  if (cached.understanding && cached.source === "table") {
    return { status: "cached", understanding: cached.understanding, source: "table" };
  }

  // Legacy prose is a cache hit unless the event has materially moved on since
  // it was written. "Materially" is the deterministic rule in event-version.ts:
  // another outlet running the same facts is not a development, a confirmed
  // acquisition after talks is. An event whose version row already exists has
  // been adopted; one that has not been adopted keeps its legacy text until
  // something real happens to it.
  if (cached.understanding && cached.source === "legacy") {
    const { data: adopted } = await db
      .from("event_understanding")
      .select("content_version")
      .eq("event_id", event.id)
      .limit(1)
      .maybeSingle();
    if (!adopted) {
      // Never generated under the new scheme. Record the version this legacy
      // text corresponds to, so the next material change is detectable — and
      // do it WITHOUT generating anything.
      await db.from("event_understanding").upsert(
        {
          event_id: event.id,
          content_version: version,
          status: "ready",
          payload: event.understand as Json,
          prompt_version: "legacy:analysis",
          source_count: articles.length,
        },
        { onConflict: "event_id,content_version", ignoreDuplicates: true },
      );
      return { status: "cached", understanding: cached.understanding, source: "legacy" };
    }
    if (adopted.content_version === version) {
      return { status: "cached", understanding: cached.understanding, source: "legacy" };
    }
    // Materially moved on: fall through and generate once at the new version.
  }

  const claim = await db.rpc("claim_event_understanding", {
    p_event_id: event.id,
    p_content_version: version,
    p_max_attempts: UNDERSTAND_MAX_ATTEMPTS,
  });
  if (claim.error) return { status: "skipped", reason: `claim failed: ${claim.error.message}` };

  const verdict = claim.data as string;
  if (verdict === "ready") {
    const row = await readUnderstanding(db, event.id, null, articles.length, version);
    return row.understanding
      ? { status: "cached", understanding: row.understanding, source: row.source as "table" }
      : { status: "skipped", reason: "claim said ready but no payload" };
  }
  if (verdict === "failed") return { status: "skipped", reason: "generation previously failed" };
  if (verdict === "generating") {
    // Somebody else is paying for this one. Wait for their row rather than
    // buying a second copy of the same words.
    return { status: "waited", understanding: await waitForRow(db, event.id, version, articles) };
  }

  if (verdict !== "won") return { status: "skipped", reason: "unrecognised claim result" };

  return generate(db, event, articles, version, options);
}

async function waitForRow(
  db: Db,
  eventId: string,
  version: string,
  articles: UnderstandingArticle[],
): Promise<EventIntelligence | null> {
  const deadline = Date.now() + WAIT_TOTAL_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
    const { data } = await db
      .from("event_understanding")
      .select("payload, status")
      .eq("event_id", eventId)
      .eq("content_version", version)
      .maybeSingle();
    if (data?.status === "ready" && data.payload) {
      return readEventIntelligence(data.payload, articles.length);
    }
    if (data?.status === "failed") return null;
  }
  return null;
}

async function generate(
  db: Db,
  event: { id: string; title: string },
  articles: UnderstandingArticle[],
  version: string,
  options: EnsureOptions,
): Promise<UnderstandingOutcome> {
  const outlets = options.outlets ?? new Map<string, string>();
  const evidenceArticles: EvidenceArticle[] = articles.map((a) => ({
    title: a.title,
    excerpt: a.excerpt,
    published_at: a.published_at,
    source_id: a.source_id,
  }));
  const selection = selectEvidence(evidenceArticles);
  const selectedIndices = selection.selectedIndices.slice(0, MAX_EVIDENCE_ARTICLES);
  const evidence = renderSelectedCoverage(
    evidenceArticles,
    selectedIndices,
    articles.length,
    outlets,
  );
  const user = `Event: ${event.title}\n\n${evidence}`;

  try {
    const { analyseMaxTokens } = await loadAiRuntimeConfig(db, options.secrets);
    const { data, usage, usageId } = await completeRoutedJson<unknown>({
      capability: "reason",
      system: `${SYSTEM}\n\n${contract()}`,
      user,
      // The label this whole redesign exists to make true. Never omit it.
      feature: "understand_generation",
      eventIds: [event.id],
      promptVersion: UNDERSTAND_PROMPT_VERSION,
      sourceCount: selectedIndices.length,
      evidenceCharacters: evidence.length,
      invocationReason: "reader_opened_uncached_event",
      maxTokens: analyseMaxTokens,
      signal: AbortSignal.timeout(25_000),
      // One configured route. The shared JSON helper allows one metered repair
      // for malformed JSON; all attempts still pass the global budget gate.
      ...(options.secrets ? { secrets: options.secrets } : {}),
    });

    const parsed = readEventIntelligence(data, selectedIndices.length);
    if (!parsed) {
      await markFailed(db, event.id, version, "reply parsed as JSON but was not usable");
      return { status: "failed", reason: "unusable reply" };
    }

    const payload = {
      ...(data as Record<string, Json>),
      analysisMeta: {
        sourceCountAtAnalysis: selectedIndices.length,
        coverageCountAtAnalysis: articles.length,
        sourceArticleIds: selectedIndices.map((i) => articles[i]!.id),
      },
    };
    const { error } = await db
      .from("event_understanding")
      .update({
        status: "ready",
        payload,
        model: usage.model,
        prompt_version: UNDERSTAND_PROMPT_VERSION,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        usage_id: usageId,
        source_count: articles.length,
        updated_at: new Date().toISOString(),
      })
      .eq("event_id", event.id)
      .eq("content_version", version);
    if (error) {
      // The words exist and were paid for; failing to store them is worth
      // saying out loud, but the reader should still get them this once.
      await recordOps(db, "understand:write", "error", { event_id: event.id, version });
    }
    return { status: "generated", understanding: parsed };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markFailed(db, event.id, version, reason);
    return { status: "failed", reason };
  }
}

async function markFailed(db: Db, eventId: string, version: string, reason: string): Promise<void> {
  await db
    .from("event_understanding")
    .update({
      status: "failed",
      failure_reason: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", eventId)
    .eq("content_version", version);
}
