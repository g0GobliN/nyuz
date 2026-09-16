import type { SupabaseClient } from "@supabase/supabase-js";
import type { SecretBag } from "@/lib/ai/config";
import { related } from "@/lib/relate";
import { matchesTerms, normaliseText } from "@/lib/topics";
import type { Database } from "@/lib/supabase/types";
import { analyse } from "./analyse";
import { loadReaders, match, type Reader } from "./match";

type Db = SupabaseClient<Database>;

export const WINDOW_HOURS = 72;

export const ON_DEMAND_LIMIT = 3;

const CANDIDATE_PAGE = 200;

export type BackfillOptions = {
  userId: string;

  windowHours?: number | undefined;

  onDemand?: boolean | undefined;

  analyseLimit?: number | undefined;

  dryRun?: boolean | undefined;

  secrets?: SecretBag | undefined;
  now?: Date | undefined;
};

export type BackfillOutcome =
  | "matched" // the free path found something. The common case.
  | "analysed" // nothing matched, so events were understood on demand, then matched
  | "quiet" // nothing matched and nothing was worth paying to understand
  | "no-topics" // follows nothing: an empty briefing is the correct answer
  | "no-reader"; // no preferences row, or briefings are paused

export type BackfillReport = {
  startedAt: string;
  finishedAt: string;
  userId: string;
  windowHours: number;
  outcome: BackfillOutcome;

  matched: number;

  inserted: number;

  analysed: number;

  tokens: number;

  spentBefore: boolean;
  detail: string;
};

export async function backfill(db: Db, options: BackfillOptions): Promise<BackfillReport> {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const windowHours = options.windowHours ?? WINDOW_HOURS;

  const done = (
    outcome: BackfillOutcome,
    rest: Partial<BackfillReport> & { detail: string },
  ): BackfillReport => ({
    startedAt,
    finishedAt: new Date().toISOString(),
    userId: options.userId,
    windowHours,
    outcome,
    matched: 0,
    inserted: 0,
    analysed: 0,
    tokens: 0,
    spentBefore: false,
    ...rest,
  });

  // Paused readers are skipped here exactly as the cron skips them. Pausing
  // means "stop", and a stage that quietly kept filling the dashboard would be
  // making that word mean something narrower than the reader was told.
  const { readers } = await loadReaders(db, { userIds: [options.userId] });
  const reader = readers[0];
  if (!reader) {
    return done("no-reader", { detail: "no preferences row, or briefings are paused" });
  }

  if (reader.topics.length === 0) {
    // Not a miss worth spending on. Following nothing is a state the dashboard
    // already has words for, and no amount of analysis changes it.
    return done("no-topics", { detail: "follows no topics" });
  }

  const first = await runMatch(db, options, windowHours, now);
  if (first.matched > 0) {
    return done("matched", {
      matched: first.matched,
      inserted: first.inserted,
      detail: `${first.matched} matched from the last ${windowHours}h, ${first.inserted} new`,
    });
  }

  if (options.onDemand === false) {
    return done("quiet", { detail: "nothing matched; deterministic backfill not requested" });
  }

  const pending = await pendingEvents(db, windowHours, now);
  const worth = worthAnalysing(pending, reader, options.analyseLimit ?? ON_DEMAND_LIMIT);

  if (worth.length === 0) {
    return done("quiet", {
      detail: `nothing matched, and none of ${pending.length} unanalysed events names a followed topic`,
    });
  }

  if (options.dryRun) {
    return done("quiet", {
      detail: `would analyse ${worth.length} of ${pending.length} unanalysed events (dry run)`,
    });
  }

  const analysis = await analyse(db, {
    eventIds: worth.map((e) => e.id),
    ...(options.secrets ? { secrets: options.secrets } : {}),
  });

  const tokens = analysis.promptTokens + analysis.completionTokens;
  const second = await runMatch(db, options, windowHours, now);

  return done(second.matched > 0 ? "analysed" : "quiet", {
    matched: second.matched,
    inserted: second.inserted,
    analysed: analysis.analysed,
    tokens,
    detail:
      `analysed ${analysis.analysed} of ${worth.length} on demand for ${tokens} tokens, ` +
      `then matched ${second.matched}`,
  });
}

async function runMatch(
  db: Db,
  options: BackfillOptions,
  windowHours: number,
  now: Date,
): Promise<{ matched: number; inserted: number }> {
  const report = await match(db, {
    userIds: [options.userId],
    sinceHours: windowHours,
    ...(options.dryRun ? { dryRun: true } : {}),
    now,
    skipAlerts: true,
  });

  const outcome = report.outcomes[0];
  return { matched: outcome?.matched ?? 0, inserted: outcome?.inserted ?? 0 };
}

export type PendingEvent = { id: string; title: string };

async function pendingEvents(db: Db, windowHours: number, now: Date): Promise<PendingEvent[]> {
  const since = new Date(now.getTime() - windowHours * 3_600_000).toISOString();

  const { data, error } = await db
    .from("events")
    .select("id, title")
    .is("analysed_at", null)
    .eq("status", "pending")
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(CANDIDATE_PAGE);

  if (error) throw new Error(`reading pending events: ${error.message}`);
  return data ?? [];
}

export function worthAnalysing(
  events: PendingEvent[],
  reader: Reader,
  limit: number,
): PendingEvent[] {
  const wanted = reader.topics.flatMap((t) =>
    t.kind === "predefined" ? [t.label, t.slug, ...t.keywords] : t.keywords,
  );
  const vetoes = [...reader.exclusions, ...reader.topics.flatMap((t) => t.excludeKeywords)];
  // A reader-created interest has to earn its place here the same way, and can
  // only be judged on the headline: an event this stage is deciding whether to
  // finalize has not been analysed, so it has no tags yet. Every term must
  // appear, which is the same rule stage 5 applies to the richer signal.
  const custom = reader.topics.filter((t) => t.kind === "custom" && t.terms.length > 0);

  const chosen: PendingEvent[] = [];
  for (const event of events) {
    if (chosen.length >= limit) break;
    const named =
      wanted.some((term) => related(event.title, term)) ||
      custom.some((t) => matchesTerms(normaliseText(event.title), t.terms));
    if (!named) continue;
    if (vetoes.some((term) => related(event.title, term))) continue;
    chosen.push(event);
  }

  return chosen;
}

export function describeBackfill(report: BackfillReport): string {
  const seconds = Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000);

  return (
    `backfill: ${report.userId.slice(0, 8)} ${report.outcome}, ` +
    `${report.matched} matched, ${report.inserted} new, ` +
    `${report.analysed} analysed for ${report.tokens} tokens, ${seconds}s` +
    ` | ${report.detail}`
  );
}
