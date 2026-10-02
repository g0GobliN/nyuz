/**
 * The shared "why it matters", written once per event and read by every reader.
 *
 * ---------------------------------------------------------------------------
 * What this restores, and why it went away
 * ---------------------------------------------------------------------------
 *
 * Briefing why-lines were designed to come from `event_impacts` (0028): one
 * explanation per event, written once, reused by every reader the event is
 * briefed to — never per-user, never on the briefing clock. The per-briefing
 * model call that used to backfill the table was removed outright (b2bf6b5) as
 * part of closing the automatic AI paths, and the *writer* went with it. Since
 * then the table has been empty, the inclusion ladder in `inclusion.ts` has
 * collapsed to its last rung, and every card in every briefing has read the
 * same sentence — "You follow AI." — differentiated only by the topic list.
 *
 * This stage is the designed replacement, with the same three boundaries the
 * redesign demanded:
 *
 *   1. **Never per-reader.** One row per event, one call per event, charged to
 *      the pipeline budget. The reader count does not appear anywhere here.
 *   2. **Never on the briefing clock.** Generation runs as its own cron stage
 *      between finalization ticks. `digest.ts` stays a read; a model outage
 *      costs the sentence, never the story and never the slot.
 *   3. **Never unbounded.** A small batch per run, a per-request token ceiling,
 *      the monthly budget reservation every other call site goes through, and
 *      the global kill switch honoured before any reservation is made.
 *
 * ---------------------------------------------------------------------------
 * The contract
 * ---------------------------------------------------------------------------
 *
 * The model returns one sentence: what is now true or threatened that was not
 * before, for someone who follows the story's subject. Not a summary — the card
 * already has one — and not advice. Output is validated for shape (one
 * sentence, 60–240 characters, ends with punctuation, no connector opening, no
 * restated headline) and grounded word-by-word against the evidence; a rejected
 * line is not stored, because a repeated or invented line is the exact failure
 * the briefing was showing before this existed. Validation failure is final:
 * the same evidence will fail the same contract next run, and the deterministic
 * ladder is the better outcome for that event.
 *
 * Events whose coverage is too thin to support the contract take no row at all
 * — the ladder serves them — and an event whose *claim* was lost to a
 * concurrent writer releases its reservation unused, so a lost race costs
 * nothing but the flag read.
 *
 * The stage is **opt-in** (`impact_writer_enabled` feature flag, default off).
 * With the flag off this module is a no-op that reports itself as skipped:
 * the pipeline is zero-AI by default, and an operator turns the writer on
 * deliberately, with the kill switch and every budget ceiling still above it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { completeRouted, isDefinitelyUnbilledAiError, type SecretBag } from "@/lib/ai/config";
import { isAiKillSwitchOn } from "@/lib/ai/launch-flags";
import { recordOps } from "@/lib/server/ops";
import { cleanText, titleSimilarity } from "./news-signals";
import { requestTokenCeiling } from "@/lib/ai/request-policy";
import { isImpactWriterEnabled } from "@/lib/ai/impact-flag";

type Db = SupabaseClient<Database>;

/** The system prompt. Versioned; bump `IMPACT_PROMPT_VERSION` when it changes. */
const SYSTEM = `You write the one-sentence "why it matters" line shown under a news headline.
Return JSON: {"why":"<sentence>"}.
The sentence states what is now true, changed, or threatened that was not before, for a reader who follows this subject.
It must be one complete sentence of 60 to 240 characters ending in a period.
It must not restate the headline, must not give advice, must not start with "Meanwhile", "However" or a similar connector,
and must only use facts present in the evidence. If the evidence does not support such a sentence, return {"why":null}.`;

/** Bumped when SYSTEM changes, so stored rows can be told apart by provenance. */
export const IMPACT_PROMPT_VERSION = "impact:1";

/** Events attempted per invocation. Bounded like every other cron stage. */
export const IMPACT_LIMIT = 4;

/** How long a `generating` claim is honoured before another run may take it. */
const STALE_MINUTES = 15;

/** How long a retryable failure waits before the row is work again. */
export const RETRY_DEFERRAL_MINUTES = 90;

/** The evidence window: events inside the daily briefing's own horizon. */
const WINDOW_HOURS = 72;

/**
 * How long after discovery an event is left alone, so finalization (which
 * writes the stable title the evidence prompt opens with) goes first.
 */
const GRACE_HOURS = 1;

export type ImpactOutcome =
  | { eventId: string; title: string; decision: "written" | "no-line" | "claimed"; detail: string }
  | { eventId: string; title: string; decision: "failed"; detail: string };

export type ImpactReport = {
  startedAt: string;
  finishedAt: string;
  considered: number;
  written: number;
  noLine: number;
  claimed: number;
  failed: number;
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  outcomes: ImpactOutcome[];
};

type CandidateRow = {
  id: string;
  title: string;
  event_impacts: { status: string; text: string | null; deferred_until: string | null }[] | null;
};

/**
 * The events that owe a line: recent, covered, not already written, not held by
 * a live claim, and not inside a retry deferral.
 *
 * A single-source event is eligible — it is exactly the shape of breaking news
 * — but the evidence gate in `evidenceUser` is what keeps single-source prose
 * honest, and the selection prefers corroborated coverage implicitly by
 * recency order. The oversample lets a batch full of too-thin events be
 * skipped for better ones rather than wasted.
 */
export async function selectImpactWork(db: Db, limit: number, now: Date): Promise<CandidateRow[]> {
  const windowStart = new Date(now.getTime() - WINDOW_HOURS * 3_600_000).toISOString();
  const graceEnd = new Date(now.getTime() - GRACE_HOURS * 3_600_000).toISOString();
  const stale = new Date(now.getTime() - STALE_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from("events")
    .select(`id, title, event_impacts ( status, text, deferred_until )`)
    .gte("first_seen_at", windowStart)
    .lt("first_seen_at", graceEnd)
    .order("first_seen_at", { ascending: false })
    .limit(limit * 5);
  if (error) throw new Error(`reading impact candidates: ${error.message}`);

  const rows: CandidateRow[] = [];
  for (const row of (data ?? []) as unknown as CandidateRow[]) {
    const existing = row.event_impacts?.[0];
    if (!existing) {
      rows.push(row);
      continue;
    }
    if (existing.status === "complete" || existing.status === "failed") continue;
    if (existing.status === "generating") {
      // A claim is live only while its lease is in the future; a row whose
      // lease has lapsed was abandoned mid-flight and is this run's to retake.
      const lapsed = existing.deferred_until === null || existing.deferred_until < stale;
      if (!lapsed) continue;
    }
    if (
      existing.status === "pending" &&
      existing.deferred_until !== null &&
      existing.deferred_until >= stale
    )
      continue;
    rows.push(row);
  }
  return rows.slice(0, limit);
}

/**
 * Validates the model's sentence against the contract.
 *
 * Returns null for anything that would read badly on a card: fragments,
 * headline restatements, connector openings, vocabulary the coverage never
 * contained. The deterministic ladder is the better outcome for a rejected
 * line — it says something true about the coverage rather than something
 * shaped like insight.
 */
export function acceptWhy(
  raw: string | null | undefined,
  title: string,
  evidence: { title: string; excerpt: string | null }[],
): string | null {
  if (raw === null || raw === undefined) return null;
  const text = cleanText(raw).replace(/\s+/gu, " ").trim();
  if (text.length < 60 || text.length > 240) return null;
  if (!/[.!?]$/u.test(text)) return null;
  // The first word must look like prose, not a fragment label.
  if (!/[a-z]/u.test(text)) return null;
  if (
    /^(meanwhile|meantime|furthermore|moreover|additionally|however|therefore|thus|instead|still)\b/iu.test(
      text,
    )
  )
    return null;
  // A restatement of the headline is not an explanation of it. Two tests:
  // wholesale similarity, and the subtler echo — a line that repeats three
  // consecutive title words is parroting the headline even when the rest of
  // the sentence is new, which is the "differentiated without being different"
  // failure the single-source rung was removed for.
  if (titleSimilarity(text, title) > 0.6) return null;
  const titleWords = title.toLowerCase().match(/[a-z][a-z'-]+/gu) ?? [];
  const lineWords = text.toLowerCase().match(/[a-z][a-z'-]+/gu) ?? [];
  const grams = new Set(
    titleWords.slice(2).map((_, i) => `${titleWords[i]} ${titleWords[i + 1]} ${titleWords[i + 2]}`),
  );
  for (let i = 0; i + 2 < lineWords.length; i += 1) {
    const gram = `${lineWords[i]} ${lineWords[i + 1]} ${lineWords[i + 2]}`;
    if (gram !== undefined && grams.has(gram)) return null;
  }
  // Grounded against the evidence, in three tiers of danger. A named actor the
  // coverage never mentioned and a figure the coverage never reported are the
  // hallucinations that matter — they invent facts, not phrasing — so both are
  // refused outright. Ordinary vocabulary is allowed small variation: a
  // sentence will legitimately say "largest" or "lands" when the evidence said
  // "larger" or "announced", so unknown content words are tolerated up to two,
  // and beyond that the line is reading between the evidence rather than from
  // it.
  const haystack = evidence
    .map((a) => `${a.title} ${a.excerpt ?? ""}`)
    .join(" ")
    .toLowerCase();
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "over",
    "after",
    "before",
    "what",
    "when",
    "while",
    "whose",
    "their",
    "them",
    "they",
    "than",
    "then",
    "will",
    "would",
    "could",
    "should",
    "have",
    "been",
    "being",
    "more",
    "most",
    "less",
    "least",
    "very",
    "also",
    "such",
    "which",
    "about",
    "between",
    "against",
    "under",
    "among",
    "across",
    "because",
    "make",
    "makes",
    "made",
    "take",
    "takes",
    "taken",
    "give",
    "gives",
    "given",
    "first",
    "today",
    "yesterday",
    "now",
    "new",
    "one",
    "two",
    "its",
    "it",
    "his",
    "her",
    "our",
    "while",
    "when",
    "where",
    "same",
    "three",
    "four",
    "five",
    "was",
    "were",
    "is",
    "are",
  ]);
  const tokens = text.match(/[A-Za-z][A-Za-z'’-]+|\d+(?:[.,]\d+)?/gu) ?? [];
  const unknown: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (/^\d/.test(token)) {
      // A number the evidence never printed is an invented fact.
      if (!haystack.includes(lower)) return null;
      continue;
    }
    // A capitalised token that does not open the sentence is a name; a name
    // the coverage never mentioned is an invented actor.
    if (/^[A-Z]/u.test(token) && token !== text && !text.startsWith(token)) {
      if (!haystack.includes(lower)) return null;
      continue;
    }
    if (lower.length < 4 || stopwords.has(lower)) continue;
    if (!haystack.includes(lower)) unknown.push(lower);
  }
  if (unknown.length > 2) return null;
  return text;
}

/** The user message, or null when the coverage cannot support the contract. */
export function evidenceUser(
  event: { id: string; title: string },
  articles: { title: string; excerpt: string | null }[],
): string | null {
  const usable: string[] = [];
  let characters = 0;
  for (const article of articles) {
    const excerpt = cleanText(article.excerpt ?? "");
    if (excerpt.length < 80) continue;
    if (titleSimilarity(article.title, excerpt) > 0.9) continue;
    if (characters + excerpt.length > 4_500) continue;
    usable.push(`- ${article.title} — ${excerpt}`);
    characters += article.title.length + excerpt.length;
  }
  // Below roughly two short paragraphs of real coverage, the contract is
  // guesswork; the deterministic ladder serves those events instead.
  if (characters < 240) return null;
  return `Event: ${event.title}\n\nReporting:\n${usable.join("\n")}`;
}

export async function writeImpacts(
  db: Db,
  options: {
    limit?: number | undefined;
    secrets?: SecretBag | undefined;
    now?: Date | undefined;
  } = {},
): Promise<ImpactReport> {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const limit = options.limit ?? IMPACT_LIMIT;
  const candidates = await selectImpactWork(db, limit, now);
  const empty = (considered: number): ImpactReport => ({
    startedAt,
    finishedAt: new Date().toISOString(),
    considered,
    written: 0,
    noLine: 0,
    claimed: 0,
    failed: 0,
    modelCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    outcomes: [],
  });

  if (candidates.length === 0) return empty(0);

  // The opt-in gate, read once per run before anything else: off means a
  // no-op run that still reports itself, so a silent flag and an idle queue
  // are distinguishable in the logs.
  if (!(await isImpactWriterEnabled(db))) {
    return {
      ...empty(candidates.length),
      outcomes: candidates.map((row) => ({
        eventId: row.id,
        title: row.title,
        decision: "claimed" as const,
        detail: "impact_writer_enabled is off — deterministic ladder serves this event",
      })),
    };
  }

  // One flag read per run, before any reservation: the kill switch stops this
  // stage exactly where it stops every other AI stage.
  if (await isAiKillSwitchOn(db)) {
    return {
      ...empty(candidates.length),
      outcomes: candidates.map((row) => ({
        eventId: row.id,
        title: row.title,
        decision: "claimed" as const,
        detail: "AI kill switch enabled",
      })),
    };
  }

  // Coverage for exactly these events, in slices small enough to stay a GET.
  const coverage: { event_id: string | null; title: string; excerpt: string | null }[] = [];
  const candidateIds = candidates.map((row) => row.id);
  for (let from = 0; from < candidateIds.length; from += 100) {
    const { data, error } = await db
      .from("articles")
      .select("event_id, title, excerpt")
      .in("event_id", candidateIds.slice(from, from + 100));
    if (error) throw new Error(`reading coverage: ${error.message}`);
    coverage.push(
      ...((data ?? []) as { event_id: string | null; title: string; excerpt: string | null }[]),
    );
  }
  const articlesOf = new Map<string, { title: string; excerpt: string | null }[]>();
  for (const article of coverage) {
    if (!article.event_id) continue;
    const list = articlesOf.get(article.event_id) ?? [];
    list.push({ title: article.title, excerpt: article.excerpt });
    articlesOf.set(article.event_id, list);
  }

  const outcomes: ImpactOutcome[] = [];
  let written = 0;
  let noLine = 0;
  let claimed = 0;
  let failed = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let modelCalls = 0;

  for (const candidate of candidates) {
    const base = { eventId: candidate.id, title: candidate.title };
    const articles = articlesOf.get(candidate.id) ?? [];
    const user = evidenceUser(candidate, articles);
    if (user === null) {
      // Leave no row: the deterministic ladder stays in charge, and a row with
      // a deferral would just be a promise to fail again later.
      outcomes.push({
        ...base,
        decision: "no-line",
        detail: "evidence too brief for the contract",
      });
      noLine += 1;
      continue;
    }
    if (requestTokenCeiling(SYSTEM, user) > 6_500) {
      outcomes.push({ ...base, decision: "no-line", detail: "evidence exceeds safe input limit" });
      noLine += 1;
      continue;
    }

    const leaseUntil = new Date(now.getTime() + STALE_MINUTES * 60_000).toISOString();
    const staleAt = new Date(now.getTime() - STALE_MINUTES * 60_000).toISOString();
    let heldReservation: string | null = null;
    let inClaimPhase = true;
    try {
      const result = await completeRouted({
        capability: "digest",
        feature: "impact",
        system: SYSTEM,
        user,
        maxTokens: 1024,
        eventIds: [candidate.id],
        promptVersion: IMPACT_PROMPT_VERSION,
        sourceCount: articles.length,
        evidenceCharacters: user.length,
        invocationReason: "scheduled_impact_writer",
        signal: AbortSignal.timeout(30_000),
        ...(options.secrets ? { secrets: options.secrets } : {}),
        beforeProvider: async (reservation) => {
          heldReservation = reservation;
          // The claim races the reservation, not the provider call: a row set
          // to `generating` here is invisible to the next run's select, and a
          // claim lost to another worker means this reservation is released
          // unused. One conditional UPDATE, therefore — the row is claimed
          // exactly when this statement is the one that moved it, and the
          // lease rides the same statement so a crashed claim is retakeable.
          const claim = await db
            .from("event_impacts")
            .update({ status: "generating", deferred_until: leaseUntil })
            .eq("event_id", candidate.id)
            // The same predicate the selector used, including a lapsed lease:
            // a claim whose worker died is this run's to retake, and the lease
            // comparison must sit in SQL or the retake races a live worker.
            .or(
              `status.eq.pending,status.eq.failed,and(status.eq.generating,deferred_until.lt.${staleAt})`,
            )
            .select("event_id");
          if (claim.error) throw new Error(`claiming impact row: ${claim.error.message}`);
          if ((claim.data?.length ?? 0) === 0) {
            // An empty claim means either another worker holds the row or the
            // row does not exist yet. Re-read to tell those apart: the two
            // outcomes differ — one is a skipped batch member, the other a
            // first writer whose row still has to be created.
            const existing = await db
              .from("event_impacts")
              .select("event_id")
              .eq("event_id", candidate.id)
              .maybeSingle();
            if (existing.error) throw new Error(`reading impact row: ${existing.error.message}`);
            if (existing.data) throw new ClaimLostError();
            const seeded = await db
              .from("event_impacts")
              .upsert(
                { event_id: candidate.id, status: "generating", deferred_until: leaseUntil },
                { onConflict: "event_id", ignoreDuplicates: true },
              );
            if (seeded.error) throw new Error(`seeding impact row: ${seeded.error.message}`);
          }
          inClaimPhase = false;
        },
      });
      modelCalls += 1;
      promptTokens += result.promptTokens;
      completionTokens += result.completionTokens;
      let why: string | null = null;
      try {
        const parsed = JSON.parse(result.content.replace(/^```(?:json)?\s*|\s*```$/gu, "")) as {
          why?: string | null;
        };
        why = acceptWhy(parsed.why, candidate.title, articles);
      } catch {
        why = null;
      }
      if (why === null) {
        // Unusable output is not stored, and the spend did happen. Validation
        // failure is final: the same evidence will fail the same contract
        // next run, so the row is parked as failed rather than deferred.
        await park(db, candidate.id, "failed", null);
        outcomes.push({ ...base, decision: "no-line", detail: "model output failed validation" });
        noLine += 1;
        continue;
      }
      const { error } = await db.from("event_impacts").upsert(
        {
          event_id: candidate.id,
          status: "complete",
          text: why,
          deferred_until: null,
          prompt_tokens: result.promptTokens,
          completion_tokens: result.completionTokens,
        },
        { onConflict: "event_id" },
      );
      if (error) throw new Error(`writing impact: ${error.message}`);
      outcomes.push({ ...base, decision: "written", detail: why });
      written += 1;
    } catch (error) {
      if (error instanceof ClaimLostError) {
        // The reservation was taken before the race was lost; config releases
        // only *unbilled* errors, and a lost claim is not one of those — it is
        // this module's own refusal, so the release happens here.
        if (heldReservation) await releaseReservation(db, heldReservation);
        outcomes.push({ ...base, decision: "claimed", detail: "another worker holds the row" });
        claimed += 1;
        continue;
      }
      // A claim-phase failure means no provider call happened, but config
      // releases only unbilled-looking errors and a lease/seeding failure is
      // neither — release explicitly, then record why.
      if (inClaimPhase && heldReservation) await releaseReservation(db, heldReservation);
      const cause = error instanceof Error ? error : new Error(String(error));
      // Configuration and billing failures are not going to succeed on retry;
      // capacity failures are exactly what a deferral exists for.
      const final = isDefinitelyUnbilledAiError(cause);
      await park(db, candidate.id, final ? "failed" : "pending", final ? null : deferAfter(now));
      if (final)
        await recordOps(db, "impact:writer", "warning", {
          event_id: candidate.id,
          reason: cause.message.slice(0, 200),
        });
      outcomes.push({ ...base, decision: "failed", detail: cause.message.slice(0, 140) });
      failed += 1;
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    considered: candidates.length,
    written,
    noLine,
    claimed,
    failed,
    modelCalls,
    promptTokens,
    completionTokens,
    outcomes,
  };
}

class ClaimLostError extends Error {
  constructor() {
    super("impact row claimed elsewhere");
    this.name = "ClaimLostError";
  }
}

/** One line per run, for `wrangler tail` and `npm run pipeline -- impact`. */
export function describeImpacts(report: ImpactReport): string {
  const parts = [
    `impact: ${report.written} written`,
    `${report.noLine} no-line`,
    `${report.claimed} held`,
    `${report.failed} failed`,
    `${report.modelCalls} calls`,
  ];
  const failures = report.outcomes.filter((o) => o.decision === "failed");
  const lines = [parts.join(", ")];
  if (failures.length > 0)
    lines.push(...failures.map((f) => `  ${f.eventId.slice(0, 8)}: ${f.detail}`));
  return lines.join("\n");
}

function deferAfter(now: Date): string {
  return new Date(now.getTime() + RETRY_DEFERRAL_MINUTES * 60_000).toISOString();
}

async function releaseReservation(db: Db, reservation: string): Promise<void> {
  const { error } = await db.rpc("release_ai_reservation", { p_id: reservation });
  if (error) console.error(`releasing unused AI reservation: ${error.message}`);
}

/**
 * Park a row after a finished attempt.
 *
 * A partial upsert on purpose: the row's counters and timestamps belong to the
 * attempt that wrote them, and the only fields a failure may move are the
 * status, the deferral, and — for a successful write — the text itself.
 */
async function park(
  db: Db,
  eventId: string,
  status: "pending" | "failed",
  deferredUntil: string | null,
): Promise<void> {
  const { error } = await db
    .from("event_impacts")
    .upsert(
      { event_id: eventId, status, deferred_until: deferredUntil },
      { onConflict: "event_id" },
    );
  if (error) throw new Error(`parking impact row: ${error.message}`);
}
