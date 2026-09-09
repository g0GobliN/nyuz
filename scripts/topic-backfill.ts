/**
 * Re-links analysed events to their topics. **A repair, run by hand.**
 *
 *   npm run topics:backfill                 report what is missing, write nothing
 *   npm run topics:backfill -- --write      write the missing event_topics rows
 *   npm run topics:backfill -- --limit 500  bound the scan
 *
 * ---------------------------------------------------------------------------
 * Not a pipeline stage, and never scheduled
 * ---------------------------------------------------------------------------
 *
 * This is an admin tool for one specific past fault, in the same family as
 * `backlog-audit.ts` and `ledger-audit.ts`: an operator runs it, reads the
 * counts, and decides. It is deliberately absent from `scripts/pipeline.ts`,
 * from `STAGES`, and from the scheduled Worker, and it must stay that way.
 *
 * The reason is not cost -- it is free -- but authority. `analyse.ts` is the one
 * writer of `event_topics`, because a topic on a story is an editorial fact and
 * facts need a single author. A job that quietly wrote the same table on a timer
 * would become a second author whose output nobody reviewed, and the next time
 * the two disagreed there would be no way to tell which one was right. Worse, it
 * would mask exactly the class of bug it was written to clean up: the fault
 * below went unnoticed for a week precisely because nothing complained, and a
 * nightly repair would have made sure nothing ever did.
 *
 * So: run it when a known break has left links missing, confirm `missing links`
 * falls to zero, and leave it alone otherwise. If it ever has real work to do on
 * a tree where nothing is known to be broken, that is a bug in `analyse.ts` to
 * be fixed there -- not a reason to schedule this.
 *
 * ---------------------------------------------------------------------------
 * The fault it was written for
 * ---------------------------------------------------------------------------
 *
 * Between 2026-09-02 (bbc29c2, which made topics deterministic) and 2026-09-09,
 * `analyse.ts` looked its code-assigned topics up in a map keyed only by slug.
 * `assignTopics` returns editorial labels, so every lookup missed, the row list
 * came out empty, and an empty upsert writes nothing and reports no error. Every
 * event analysed in that week is complete, scored and unmatched to any topic --
 * which is why `match` found nothing to give readers and no briefing was built.
 *
 * The lookup is fixed. This repairs what it already lost.
 *
 * **No model call, ever.** Topics have been assigned by code since bbc29c2, so
 * the rows written here are byte-for-byte what the analysis pass would have
 * written at the time; nothing is re-analysed and nothing is inferred. That is
 * the whole reason the repair is affordable and the reason it is honest.
 *
 * It only inserts. Events that already have links keep them, and no row is ever
 * deleted -- an event whose links predate the fault is not evidence of the fault.
 */

import { assignTopics } from "@/lib/pipeline/topic-assign";
import { db, fail, heading, main, row, say } from "./lib/db.ts";

/** Ids per `in` filter, matching the limit analyse.ts and classify.ts both use. */
const IN_CHUNK = 100;
const WRITE_CHUNK = 500;
const DEFAULT_LIMIT = 2000;

function numberFlag(args: string[], flag: string): number | null {
  const at = args.indexOf(flag);
  if (at === -1) return null;
  const value = Number(args[at + 1]);
  return Number.isFinite(value) ? value : null;
}

main(async () => {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const limit = numberFlag(args, "--limit") ?? DEFAULT_LIMIT;

  heading(write ? "Topic backfill" : "Topic backfill (dry run — nothing is written)");

  // The vocabulary, resolvable by either name, exactly as analyse.ts builds it.
  const { data: topicRows, error: topicError } = await db()
    .from("topics")
    .select("id, slug, label")
    .eq("kind", "predefined");
  if (topicError) fail(`reading topics: ${topicError.message}`);
  const ids = new Map<string, string>();
  for (const topic of topicRows ?? []) {
    ids.set(topic.slug.toLowerCase(), topic.id);
    ids.set(topic.label.toLowerCase(), topic.id);
  }

  const { data: events, error: eventError } = await db()
    .from("events")
    .select("id, title")
    .not("analysed_at", "is", null)
    .order("analysed_at", { ascending: false })
    .limit(limit);
  if (eventError) fail(`reading events: ${eventError.message}`);
  const candidates = events ?? [];

  // Which of them already have a link. Only the absent ones are considered, so a
  // re-run after a partial write is cheap rather than a full recompute.
  const linked = new Set<string>();
  for (let i = 0; i < candidates.length; i += IN_CHUNK) {
    const slice = candidates.slice(i, i + IN_CHUNK).map((e) => e.id);
    const { data, error } = await db()
      .from("event_topics")
      .select("event_id")
      .in("event_id", slice);
    if (error) fail(`reading event_topics: ${error.message}`);
    for (const link of data ?? []) linked.add(link.event_id);
  }
  const missing = candidates.filter((e) => !linked.has(e.id));

  // The same haystack analyse.ts assigns from: every attached article's title
  // and excerpt. Assigning from the event title alone would produce a different
  // and thinner answer than the pass this is standing in for.
  const text = new Map<string, string[]>();
  for (let i = 0; i < missing.length; i += IN_CHUNK) {
    const slice = missing.slice(i, i + IN_CHUNK).map((e) => e.id);
    const { data, error } = await db()
      .from("articles")
      .select("event_id, title, excerpt")
      .in("event_id", slice);
    if (error) fail(`reading articles: ${error.message}`);
    for (const article of data ?? []) {
      if (!article.event_id) continue;
      const parts = text.get(article.event_id) ?? [];
      parts.push(`${article.title}\n${article.excerpt ?? ""}`);
      text.set(article.event_id, parts);
    }
  }

  const rows: { event_id: string; topic_id: string }[] = [];
  let unresolved = 0;
  let noTopic = 0;
  for (const event of missing) {
    const body = (text.get(event.id) ?? []).join("\n---\n");
    const assigned = assignTopics(body);
    if (assigned.length === 0) {
      noTopic++;
      continue;
    }
    const resolved = assigned
      .map((name) => ids.get(name.trim().toLowerCase()))
      .filter((id): id is string => id !== undefined);
    if (resolved.length === 0) {
      unresolved++;
      continue;
    }
    for (const topic_id of resolved) rows.push({ event_id: event.id, topic_id });
  }

  if (write && rows.length > 0) {
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const { error } = await db()
        .from("event_topics")
        .upsert(rows.slice(i, i + WRITE_CHUNK), {
          onConflict: "event_id,topic_id",
          ignoreDuplicates: true,
        });
      if (error) fail(`writing event_topics: ${error.message}`);
    }
  }

  say();
  say(row("analysed scanned", candidates.length));
  say(row("already linked", candidates.length - missing.length));
  say(row("missing links", missing.length));
  say(row("about no topic", noTopic));
  say(row("unresolvable name", unresolved));
  say(row(write ? "links written" : "links to write", rows.length));
  say(row("events repaired", new Set(rows.map((r) => r.event_id)).size));
});
