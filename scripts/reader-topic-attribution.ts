/**
 * Why a delivered card says "You follow X." -- and how much of that rests on the headline alone.
 *
 * The reason line is the reader's only explanation of why a story is on their page, so a wrong one is
 * a defect of the same family as a wrong summary. It is composed by `personalizationFor`
 * (`src/lib/server/briefing.ts`) as a plain intersection of the event's `event_topics` labels and the
 * reader's own `user_topics` labels -- so when it is wrong, the fault is upstream of the line itself:
 * either the event carries a label it should not, or the reader follows something they did not mean.
 * This instrument asks the first question and names the carrier.
 *
 * The 2026-10-19 read of the live dashboard found one instance: a Windows command-prompt story whose
 * card reasoned "You follow AI.". `assignTopics` gives the AI topic the weak term "prompt", and the
 * title rule -- a weak term in the headline labels on its own, built for real travel headlines -- fires
 * on "command prompt". This prints, per card, the reader-visible reason, the labels the event carries,
 * and whether recomputing `assignTopics` without the headline would still produce the label the reason
 * names. It prints a population, not an opinion, so the fix can be ruled on with the number in hand.
 *
 * Read-only: SELECTs plus the shipped pure function. Nothing here writes, and no rule is applied.
 *
 * Usage: npm run audit:topic-attribution [-- --digest <uuid>] [--all]
 *   default  the newest briefing of each reader's that ever reached a reader (sent or ready to send)
 *   --all    every item of those digests, not only the ones whose reason line rests on the headline
 */

import { assignTopics } from "@/lib/pipeline/topic-assign";
import { db, heading, main, say } from "./lib/db";

const args = process.argv.slice(2);
const digestArg = args.includes("--digest") ? args[args.indexOf("--digest") + 1] : undefined;
const showAll = args.includes("--all");

/**
 * One card's evidence, in the order the question is asked: what the reader is told, what the event
 * carries, and what the shipped rule would say with and without the headline in the haystack.
 */
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

  let digestQuery = client
    .from("digests")
    .select("digest_id, user_id, scheduled_for, status, kind")
    .eq("kind", "briefing")
    .in("status", ["sent", "ready"])
    .order("scheduled_for", { ascending: false })
    .limit(1);
  if (digestArg) digestQuery = digestQuery.eq("digest_id", digestArg);

  const { data: digests, error: digestError } = await digestQuery;
  if (digestError) throw new Error(`digests: ${digestError.message}`);
  if (!digests?.length)
    throw new Error("no delivered briefing found (kind=briefing, status sent|ready)");

  let flagged = 0;
  let cards = 0;
  let reasonsNamingHeadlineOnly = 0;

  for (const digest of digests) {
    heading(
      `Briefing ${digest.digest_id}  reader ${digest.user_id}  ${digest.scheduled_for.slice(0, 16)}  ${digest.status}`,
    );

    const { data: items, error: itemError } = await client
      .from("digest_items")
      .select("event_id, position")
      .eq("digest_id", digest.digest_id)
      .order("position", { ascending: true });
    if (itemError) throw new Error(`digest_items: ${itemError.message}`);
    const delivered = items ?? [];
    if (!delivered.length) {
      say("  no items");
      continue;
    }

    const eventIds = delivered.map((row) => row.event_id);
    // Labels come from `topics` by id rather than through an embedded `topics ( label )` select: the
    // generated types do not declare that relationship for this client, and a cast would be quieter
    // than the join is worth. `topics` is a few dozen rows, read once per digest.
    const [events, links, followedTopics, topics] = await Promise.all([
      client.from("events").select("id, title").in("id", eventIds),
      client.from("event_topics").select("event_id, topic_id").in("event_id", eventIds),
      client.from("user_topics").select("topic_id").eq("user_id", digest.user_id),
      client.from("topics").select("id, label"),
    ]);
    if (events.error) throw new Error(`events: ${events.error.message}`);
    if (links.error) throw new Error(`event_topics: ${links.error.message}`);
    if (followedTopics.error) throw new Error(`user_topics: ${followedTopics.error.message}`);
    if (topics.error) throw new Error(`topics: ${topics.error.message}`);

    const labelOf = new Map((topics.data ?? []).map((row) => [row.id, row.label] as const));
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
    say(`  reader follows: ${follows.join(", ") || "(none)"}`);

    const cardRows: Card[] = [];
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

      const reason = overlap.length ? `You follow ${overlap.join(", ")}.` : null;
      cardRows.push({
        position: item.position,
        title,
        reason,
        labels,
        headlineOnly,
        headlineOnlyInReason: headlineOnly.filter((label: string) =>
          overlap.some((follow) => follow.toLowerCase() === label.toLowerCase()),
        ),
      });
    }

    for (const card of cardRows) {
      cards++;
      const rests = card.headlineOnlyInReason.length > 0;
      if (rests) flagged++;
      if (!rests && !showAll) continue;
      if (card.headlineOnlyInReason.length > 0) reasonsNamingHeadlineOnly++;
      say();
      say(`  #${String(card.position).padStart(2)}  ${card.reason ?? "(no follow line)"}`);
      say(`      ${card.title}`);
      say(`      labels: ${card.labels.join(", ") || "(none)"}`);
      if (rests) {
        say(
          `      HEADLINE-ONLY: ${card.headlineOnlyInReason.join(", ")} -- the reader is told they ` +
            `follow a topic whose only evidence is a weak term in the headline ` +
            `(all headline-only labels here: ${card.headlineOnly.join(", ")})`,
        );
      } else if (showAll) {
        say(
          `      headline-only labels (not in the reason line): ${card.headlineOnly.join(", ") || "none"}`,
        );
      }
    }
  }

  heading("Population");
  say(`  cards examined                              ${cards}`);
  say(`  reason names a headline-only topic          ${flagged}`);
  say(
    flagged === 0
      ? "  nothing for a ruling to weigh: every reason line rests on evidence in the story itself."
      : "  each flagged card tells the reader they follow a topic the story's own text does not carry.",
  );
  say();
}

main(run);
