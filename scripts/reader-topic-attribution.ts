/**
 * Why a delivered card says "You follow X." -- and how much of that rests on the headline alone.
 *
 * The reason line is the reader's only explanation of why a story is on their page, so a wrong one is
 * a defect of the same family as a wrong summary. It is composed by `personalizationFor`
 * (`src/lib/server/briefing.ts`) as a plain intersection of the event's `event_topics` labels and the
 * reader's own `user_topics` labels -- so when it is wrong, the fault is upstream of the line: either
 * the event carries a label it should not, or the reader follows something they did not mean.
 *
 * The labelling rule has one deliberate exception: a *weak* keyword in the headline labels a story on
 * its own, because a publisher's headline states its subject (a real travel headline should label with
 * no body mention at all). This measures what that exception costs. Per card it recomputes the shipped
 * pure function twice -- once as shipped, once with the headline removed from the haystack, which
 * switches the title rule off -- and reports the labels the headline alone produces and whether the
 * reader-visible reason names one.
 *
 * The 2026-10-19 reading of the newest delivered briefing found four of thirteen cards in that state,
 * one of them plainly wrong: a Windows command-prompt story reasoned "You follow AI." because the AI
 * topic lists "prompt" as a weak term. This reads the delivered corpus rather than one briefing, so a
 * ruling has a population instead of an anecdote.
 *
 * Read-only: SELECTs plus the shipped pure function. Nothing here writes, and no rule is applied.
 *
 * Usage: npm run audit:topic-attribution [-- --briefings <n>] [--digest <uuid>] [--all]
 *   --briefings  how many of the newest delivered briefings to read (default 20)
 *   --digest     one briefing by id, instead of the newest N
 *   --all        print every card, not only the flagged ones
 */

import { assignTopics } from "@/lib/pipeline/topic-assign";
import { db, heading, main, say } from "./lib/db";

const args = process.argv.slice(2);
const digestArg = args.includes("--digest") ? args[args.indexOf("--digest") + 1] : undefined;
const briefingsArg = args.indexOf("--briefings");
const BRIEFINGS = briefingsArg === -1 ? 20 : Math.max(1, Number(args[briefingsArg + 1]) || 20);
const showAll = args.includes("--all");

/** One card's evidence, in the order the question is asked. */
type Card = {
  position: number;
  title: string;
  reason: string | null;
  labels: string[];
  /** Labels the headline's weak terms alone produce. */
  headlineOnly: string[];
  /** Of those, the ones named in the reader-visible reason line. */
  headlineOnlyInReason: string[];
};

async function run(): Promise<void> {
  const client = db();

  const { data: topicRows, error: topicError } = await client.from("topics").select("id, label");
  if (topicError) throw new Error(`topics: ${topicError.message}`);
  const labelOf = new Map((topicRows ?? []).map((row) => [row.id, row.label] as const));

  let digestQuery = client
    .from("digests")
    .select("digest_id, user_id, scheduled_for, status, kind")
    .eq("kind", "briefing")
    .in("status", ["sent", "ready"])
    .order("scheduled_for", { ascending: false })
    .limit(digestArg ? 1000 : BRIEFINGS);
  if (digestArg) digestQuery = digestQuery.eq("digest_id", digestArg);

  const { data: digests, error: digestError } = await digestQuery;
  if (digestError) throw new Error(`digests: ${digestError.message}`);
  if (!digests?.length)
    throw new Error("no delivered briefing found (kind=briefing, status sent|ready)");

  const rowsByBriefing: { digest: (typeof digests)[number]; cards: Card[] }[] = [];

  for (const digest of digests) {
    const { data: items, error: itemError } = await client
      .from("digest_items")
      .select("event_id, position")
      .eq("digest_id", digest.digest_id)
      .order("position", { ascending: true });
    if (itemError) throw new Error(`digest_items: ${itemError.message}`);
    const delivered = items ?? [];
    if (!delivered.length) continue;

    const eventIds = delivered.map((row) => row.event_id);
    // Labels come from `topics` by id rather than through an embedded `topics ( label )` select: the
    // generated types do not declare that relationship for this client, and a cast would be quieter
    // than the join is worth.
    const [events, links, followedTopics] = await Promise.all([
      client.from("events").select("id, title").in("id", eventIds),
      client.from("event_topics").select("event_id, topic_id").in("event_id", eventIds),
      client.from("user_topics").select("topic_id").eq("user_id", digest.user_id),
    ]);
    if (events.error) throw new Error(`events: ${events.error.message}`);
    if (links.error) throw new Error(`event_topics: ${links.error.message}`);
    if (followedTopics.error) throw new Error(`user_topics: ${followedTopics.error.message}`);

    const titleOf = new Map((events.data ?? []).map((row) => [row.id, row.title] as const));
    const labelsOf = new Map<string, string[]>();
    for (const row of links.data ?? []) {
      const label = labelOf.get(row.topic_id);
      if (!label) continue;
      labelsOf.set(row.event_id, [...(labelsOf.get(row.event_id) ?? []), label]);
    }
    const follows = (followedTopics.data ?? [])
      .map((row) => labelOf.get(row.topic_id))
      .filter((label): label is string => Boolean(label));

    const cards: Card[] = [];
    for (const item of delivered) {
      const labels = labelsOf.get(item.event_id) ?? [];
      const overlap = labels.filter((label) =>
        follows.some((follow) => follow.toLowerCase() === label.toLowerCase()),
      );

      const { data: articles, error: articleError } = await client
        .from("articles")
        .select("title, excerpt")
        .eq("event_id", item.event_id);
      if (articleError) throw new Error(`articles: ${articleError.message}`);
      const title = titleOf.get(item.event_id) ?? "";
      const haystack = [
        title,
        ...(articles ?? []).map((row) => `${row.title ?? ""} ${row.excerpt ?? ""}`),
      ].join(" ");
      // The same pure function the pipeline runs, twice: once as shipped, once with the headline
      // removed from the haystack (which switches the title rule off). The difference is what the
      // headline alone is producing.
      const withTitle = assignTopics(haystack, title);
      const withoutTitle = assignTopics(haystack, "");
      const headlineOnly = withTitle.filter((label: string) => !withoutTitle.includes(label));

      cards.push({
        position: item.position,
        title,
        reason: overlap.length ? `You follow ${overlap.join(", ")}.` : null,
        labels,
        headlineOnly,
        headlineOnlyInReason: headlineOnly.filter((label: string) =>
          overlap.some((follow) => follow.toLowerCase() === label.toLowerCase()),
        ),
      });
    }
    rowsByBriefing.push({ digest, cards });
  }

  heading("Delivered briefings, newest first");
  let totalCards = 0;
  let totalFlagged = 0;
  const carriers = new Map<string, number>();
  const flaggedCards: { reason: string; label: string; title: string }[] = [];
  const printed: string[] = [];

  for (const { digest, cards } of rowsByBriefing) {
    const flagged = cards.filter((card) => card.headlineOnlyInReason.length > 0);
    totalCards += cards.length;
    totalFlagged += flagged.length;
    for (const card of flagged) {
      for (const label of card.headlineOnlyInReason) {
        carriers.set(label, (carriers.get(label) ?? 0) + 1);
        flaggedCards.push({ reason: card.reason ?? "(no line)", label, title: card.title });
      }
    }
    say(
      `  ${digest.scheduled_for.slice(0, 10)}  ${digest.status.padEnd(8)}  ` +
        `${String(cards.length).padStart(3)} cards  ${String(flagged.length).padStart(2)} flagged  ` +
        `reader ${digest.user_id.slice(0, 8)}  ${digest.digest_id.slice(0, 8)}`,
    );
    for (const card of cards) {
      if (!showAll && card.headlineOnlyInReason.length === 0) continue;
      printed.push(
        `  #${String(card.position).padStart(2)}  ${card.reason ?? "(no follow line)"}\n` +
          `      ${card.title}\n` +
          `      headline-only labels: ${card.headlineOnly.join(", ") || "none"}` +
          (card.headlineOnlyInReason.length
            ? `  <- in the reason line: ${card.headlineOnlyInReason.join(", ")}`
            : ""),
      );
    }
  }

  if (printed.length) {
    heading(showAll ? "Every card" : "Cards whose reason names a headline-only topic");
    for (const block of printed) say(block);
  }

  heading("Population");
  say(`  briefings read                              ${rowsByBriefing.length}`);
  say(`  cards examined                              ${totalCards}`);
  say(`  reason names a headline-only topic          ${totalFlagged}`);
  if (totalCards > 0) {
    say(
      `  share of delivered cards                    ${((totalFlagged / totalCards) * 100).toFixed(1)}%`,
    );
  }

  if (carriers.size) {
    heading("Which label, and how often");
    for (const [label, count] of [...carriers.entries()].sort((a, b) => b[1] - a[1])) {
      say(`  ${label.padEnd(22)} ${String(count).padStart(4)}`);
    }
  }

  if (flaggedCards.length) {
    heading("Samples (first six)");
    for (const card of flaggedCards.slice(0, 6)) {
      say(`  ${card.reason}   [${card.label}]`);
      say(`      ${card.title.slice(0, 110)}`);
    }
  }

  say();
  say(
    totalFlagged === 0
      ? "  nothing for a ruling to weigh: every reason line rests on evidence in the story itself."
      : "  each flagged card tells the reader they follow a topic the story's own text does not carry.",
  );
  say();
}

main(run);
