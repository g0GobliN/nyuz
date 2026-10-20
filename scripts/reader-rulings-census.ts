/**
 * What rulings #17, #18 and #19 do to the delivered briefing, line by line.
 *
 *   npm run audit:delivered-rulings
 *
 * Three questions, one run, because they are the acceptance the rulings name:
 *
 *   `suppressStoryTwins` over the delivered cards   how many the twin pass keeps
 *   `unresolvedContextOpening` per opening           which openings no longer stand
 *   the gate + composition, per card                 which cards the new rules refuse
 *
 * It also prints the **rebuilt** alignment: for every card the new rules keep, the
 * opening the composer publishes now and the line a briefing built from it would
 * deliver. Ruling #11's contract is that those two are one sentence, so that count
 * is what a freshly built briefing has to show — the archived briefing cannot,
 * because its stored summaries were composed by the old rules (recorded as the
 * before/after comparison in the handoff, never as a regression).
 *
 * Read-only: it loads the newest generated briefing from `digests` /
 * `digest_items` and writes nothing.
 */

import { loadCorpusEvents, storyForEvent } from "./lib/corpus";
import { db, main, say } from "./lib/db";
import { composeFromSources } from "../src/lib/editorial";
import { assessReadiness } from "../src/lib/pipeline/readiness";
import { suppressStoryTwins, type TwinBrief } from "../src/lib/pipeline/duplicates";
import {
  quotationCarriesOpening,
  sourceTypo,
  thinStateOpening,
  unresolvedContextOpening,
} from "../src/lib/reader-evidence";
import { composedSummaryArtifact, deliveredLine } from "../src/lib/reader-summary";

type Row = {
  position: number;
  eventId: string;
  title: string;
  stored: string;
  delivered: string;
  opening: string;
  rebuilt: string;
  refused: string | null;
};

main(async () => {
  const client = db();
  const { data: digests, error } = await client
    .from("digests")
    .select("digest_id, generated_at, scheduled_for, kind, status, item_count")
    .order("scheduled_for", { ascending: false })
    .limit(12);
  if (error) throw new Error(`digests: ${error.message}`);
  const digest =
    (digests ?? []).find((row) => row.generated_at !== null && row.kind === "briefing") ??
    (digests ?? []).find((row) => row.generated_at !== null);
  if (!digest) throw new Error("no generated briefing to read");

  const { data: items, error: itemError } = await client
    .from("digest_items")
    .select("event_id, position, summary")
    .eq("digest_id", digest.digest_id)
    .order("position", { ascending: true });
  if (itemError) throw new Error(`digest_items: ${itemError.message}`);
  const deliveredRows = items ?? [];
  const events = await loadCorpusEvents(
    deliveredRows.length,
    undefined,
    undefined,
    deliveredRows.map((row) => row.event_id),
  );
  const byId = new Map(events.map((event) => [event.id, event] as const));

  say(`delivered briefing   ${digest.digest_id}  built ${digest.generated_at}`);
  say(`items delivered      ${deliveredRows.length}`);
  say();

  const rows: Row[] = [];
  for (const item of deliveredRows) {
    const event = byId.get(item.event_id);
    if (!event) continue;
    const page = storyForEvent(event);
    const opening = composeFromSources(page.title, page.sourceList, {
      publishedAt: event.publishedAt,
    }).article.deck.text;
    // The line the reader actually received, before this run's rules re-read it:
    // the stored artifact is what the briefing wrote, and compare-and-repair
    // below is what the *new* rules make of it.
    const asDelivered = (item.summary ?? "").trim() || event.what.trim();
    const verdict = assessReadiness({
      title: event.title,
      whatHappened: event.what,
      publishedAt: event.publishedAt,
      sources: page.sourceList,
      sourceCount: page.sourceList.length,
    });
    // Why this card would not be delivered now, if any rule refuses it.
    const refused = !verdict.ready
      ? `${verdict.kind}: ${verdict.reason}`
      : verdict.opening.trim() === ""
        ? "composition published no deck (thin state)"
        : null;
    rows.push({
      position: item.position,
      eventId: item.event_id,
      title: event.title,
      stored: event.what,
      delivered: asDelivered,
      opening: verdict.ready ? verdict.opening : opening,
      rebuilt: deliveredLine(
        {
          summary: composedSummaryArtifact({
            title: page.title,
            sources: page.sourceList,
            publishedAt: event.publishedAt,
            opening,
          }),
        },
        event.what,
        page.title,
      ),
      refused,
    });
  }

  // Ruling #18's acceptance: the delivered pair keeps one card.
  const twins: TwinBrief[] = rows.map((row) => ({ title: row.title, whatHappened: row.stored }));
  const keptTitles = new Set(suppressStoryTwins(twins).map((brief) => brief.title));
  const dropped = rows.filter((row) => !keptTitles.has(row.title));

  say("suppressStoryTwins over the delivered cards");
  for (const row of dropped) say(`  suppressed  #${row.position}  ${row.title}`);
  say(`  -> ${keptTitles.size} kept of ${rows.length}`);
  // The ruling's own acceptance line, on the pair it was taken against. Selected
  // by title rather than by position, because the ruling numbers cards the way a
  // reader counts them (03/04) while `digest_items.position` is zero-based: the
  // pair is #02/#03 here, and a positional guess printed "2 kept of 2" the first
  // time this was written.
  const PAIR_TITLES = [
    "A Chinese hacker used AI agents to break into more than 100 company websites",
    "A hacker broke into John Deere and SharkNinja with an army of AI agents",
  ];
  const pair = rows
    .filter((row) => PAIR_TITLES.includes(row.title))
    .map((row) => ({
      title: row.title,
      whatHappened: row.stored,
    }));
  if (pair.length === 2) {
    say(`  suppressStoryTwins(03,04)  -> ${suppressStoryTwins(pair).length} kept of 2`);
  }
  say();
  say("unresolvedContextOpening over the delivered lines");
  for (const row of rows) {
    const line = row.delivered !== "" ? row.delivered : row.opening;
    say(
      `  #${String(row.position).padStart(2, "0")}  ${unresolvedContextOpening(line, row.title) ? "REFUSED" : "stands "}  ${line.slice(0, 96)}`,
    );
  }
  say();
  say("ruling #19 classes over the delivered lines");
  for (const row of rows) {
    const flags = [
      quotationCarriesOpening(row.delivered) ? "quote-opening" : "",
      sourceTypo(row.delivered) ? "source-typo" : "",
      thinStateOpening(row.delivered) ? "thin-state" : "",
    ].filter(Boolean);
    if (flags.length > 0) say(`  #${String(row.position).padStart(2, "0")}  ${flags.join(", ")}`);
  }
  say();
  say("what a briefing built from these items would do");
  for (const row of dropped) say(`  #${String(row.position).padStart(2, "0")}  twin-suppressed`);
  for (const row of rows)
    if (row.refused !== null && keptTitles.has(row.title))
      say(`  #${String(row.position).padStart(2, "0")}  withheld  ${row.refused}`);
  const survivors = rows.filter((row) => row.refused === null && keptTitles.has(row.title));
  const aligned = survivors.filter((row) => row.rebuilt === row.opening && row.opening !== "");
  say(
    `  -> ${rows.length - dropped.length - rows.filter((row) => row.refused !== null).length} cards kept; ` +
      `${aligned.length} / ${survivors.length} line === page opening on a rebuild`,
  );
  say();
  const differences = rows.filter((row) => row.delivered !== row.rebuilt);
  say(`as delivered vs built now   ${rows.length - differences.length} / ${rows.length} equal`);
  for (const row of differences)
    say(
      `  #${String(row.position).padStart(2, "0")}  differs: ${row.delivered.slice(0, 70) || "(none)"}`,
    );
});
