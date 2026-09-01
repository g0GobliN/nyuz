/**
 * What is actually in the database right now.
 *
 *   npm run db:status
 *
 * docs/plan.md requires every stage to be verified against a real database rather
 * than against a passing typecheck, and several of its boxes are literally a row
 * count. This prints them, plus the handful of derived numbers that say whether a
 * stage did its job or merely ran: how many articles are still unclustered, how
 * many events are waiting to be analysed, how much the analysis has cost.
 *
 * It writes nothing. Safe to run against production, and meant to be.
 */

import { PIPELINE_TABLES, count, db, heading, main, row, say } from "./lib/db.ts";

/** `head: true` returns no rows — the number arrives in a header. */
const HEAD = { count: "exact", head: true } as const;

type CountQuery = PromiseLike<{ count: number | null; error: { message: string } | null }>;

/** Awaits a count query and gives back the number, or throws with the reason. */
async function n(query: CountQuery): Promise<number> {
  const { count: value, error } = await query;
  if (error) throw new Error(error.message);
  return value ?? 0;
}

main(async () => {
  heading("Row counts");
  for (const table of PIPELINE_TABLES) {
    say(row(table, await count(table)));
  }

  const sources = () => db().from("sources").select("*", HEAD);
  const articles = () => db().from("articles").select("*", HEAD);
  const events = () => db().from("events").select("*", HEAD);
  const digests = () => db().from("digests").select("*", HEAD);

  heading("Sources");
  say(row("active", await n(sources().eq("active", true))));
  say(row("active, failing", await n(sources().eq("active", true).gt("failure_count", 0))));
  say(row("ever fetched", await n(sources().not("last_fetched_at", "is", null))));

  heading("Articles");
  say(row("attached to an event", await n(articles().not("event_id", "is", null))));
  say(row("not yet clustered", await n(articles().is("event_id", null))));

  heading("Events");
  say(row("analysed", await n(events().not("analysed_at", "is", null))));
  say(row("awaiting analysis", await n(events().is("analysed_at", null))));
  say(
    row("pending and eligible", await n(events().is("analysed_at", null).eq("status", "pending"))),
  );
  say(row("failed", await n(events().is("analysed_at", null).eq("status", "failed"))));

  // The shared-analysis property in one number. Tokens are recorded per event and
  // never re-spent, so this total is the entire model cost of understanding the
  // news so far — independent of how many readers, or how many articles.
  const { data: tokenRows, error } = await db().from("events").select("analysis_tokens");
  if (error) throw new Error(`analysis_tokens: ${error.message}`);
  say(
    row(
      "analysis tokens spent",
      (tokenRows ?? []).reduce((sum, r) => sum + r.analysis_tokens, 0),
    ),
  );

  heading("Digests");
  for (const status of ["scheduled", "generating", "ready", "sent", "skipped", "failed"] as const) {
    say(row(status, await n(digests().eq("status", status))));
  }

  say();
});
