/**
 * Every line the binding rung prints, over the whole live corpus. Read-only.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/reader-binding-census.ts
 *
 * The rung (`bindingLine`, `pipeline/inclusion.ts`) exists because the reader's
 * briefing ships cards with no explanation, and the shapes that were tried
 * before it printed filler about half the time. What makes it shippable is the
 * measurement this instrument repeats: every hit is printed with the story it
 * came from, so precision is read rather than assumed. It calls `reasonFor` —
 * not the predicate directly — so it measures the rung in the order the ladder
 * actually consults it, and a card whose stronger rung fired is not counted as
 * evidence for this one.
 *
 * SELECT only, service-role client, same as `db:status`.
 */

import { reasonFor } from "../src/lib/pipeline/inclusion";
import { db, heading, main, say } from "./lib/db.ts";

main(async () => {
  let from = 0;
  let rowsRead = 0;
  const events = new Map<
    string,
    { title: string; what: string; evidence: string[]; sources: number }
  >();
  for (;;) {
    const { data: units, error } = await db()
      .from("article_evidence")
      .select("article_id, evidence")
      .eq("status", "enriched")
      .range(from, from + 199);
    if (error) throw new Error(error.message);
    if (!units || units.length === 0) break;
    rowsRead += units.length;
    const articleIds = units
      .map((unit) => unit.article_id)
      .filter((id): id is string => id !== null);
    const { data: articles } = await db()
      .from("articles")
      .select("id, event_id")
      .in("id", articleIds);
    const articleById = new Map((articles ?? []).map((article) => [article.id, article]));
    const eventIds = [
      ...new Set((articles ?? []).flatMap((a) => (a.event_id ? [a.event_id] : []))),
    ];
    const { data: events_ } = await db()
      .from("events")
      .select("id, title, what_happened, publisher_count")
      .in("id", eventIds);
    const eventById = new Map((events_ ?? []).map((event) => [event.id, event]));
    for (const unit of units) {
      const event = articleById.get(unit.article_id)?.event_id;
      const row = event ? eventById.get(event) : undefined;
      if (!row) continue;
      const texts = (Array.isArray(unit.evidence) ? unit.evidence : [])
        .map((item) => (item as { text?: unknown }).text)
        .filter((text): text is string => typeof text === "string" && text.trim() !== "");
      const seen = events.get(row.id) ?? {
        title: row.title,
        what: row.what_happened ?? "",
        evidence: [],
        sources: (row as { publisher_count?: number }).publisher_count ?? 0,
      };
      seen.evidence.push(...texts);
      events.set(row.id, seen);
    }
    if (units.length < 200) break;
    from += 200;
  }

  const lines: string[] = [];
  for (const [id, event] of events) {
    // The stronger rungs are given their own inputs, exactly as generation does:
    // this census is about the rung's own lines, and a card whose stored impact
    // fired is not a card this rung explained.
    const why = reasonFor({
      storedImpact: null,
      beforeState: null,
      afterState: null,
      sourceCount: event.sources,
      evidence: event.evidence,
      title: event.title,
      whatHappened: event.what,
    });
    if (why.source !== "binding") continue;
    lines.push(`[${id.slice(0, 8)}] ${event.title} :: ${why.text}`);
  }

  say(`enriched rows read ${rowsRead}, events with evidence ${events.size}`);
  heading(`binding lines (${lines.length})`);
  for (const line of lines) say(`  ${line.slice(0, 340)}`);
});
