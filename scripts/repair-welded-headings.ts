/**
 * The repair for a heading welded onto the sentence after it.
 *
 *   npm run repair:welded-headings            -- dry run, writes nothing
 *   npm run repair:welded-headings -- --apply -- writes the confirmed repairs
 *   npm run repair:welded-headings -- --events 200
 *
 * Why this exists. Card 01 of the delivered 2026-10-18 briefing opened with
 *
 *     Ransomware with physical consequences Building automation systems - BAS -
 *     are the critical systems ...
 *
 * because The Register's feed ships the article as plain text in
 * `content:encoded` with its `<h3>` subhead and the next paragraph separated by
 * a single space, so `events.what_happened` stored both sentences as one. The
 * page itself has the heading marked up, so the boundary can be *confirmed*
 * rather than guessed — and the arbiter's ruling (#10, 2026-10-18, option 4) is
 * exactly that: split only where the article's own page confirms a heading with
 * that text, and preserve the line everywhere else.
 *
 * What it holds itself to, mirroring `scripts/reader-reenrich-fusions.ts`:
 *
 *   1. **Dry run by default.** `--apply` is the only thing that writes, and it
 *      updates `events.what_happened` for confirmed repairs only.
 *   2. **The page decides.** A stored line that matches a text pattern is a
 *      *candidate*, never a repair: on the frozen 200 (2026-10-18) the candidate
 *      ruler matched 35 summaries and exactly 1 was real. The other 34 are
 *      fetched, checked against their page's own headings, and left untouched.
 *   3. **Preserve both sides.** Every row is printed with its original line and
 *      the proposed replacement, so the change can be read and reversed without
 *      fetching anything again.
 *   3a. **Two strings, two repairs.** `events.what_happened` is the card's line,
 *      so the heading is dropped there; `articles.excerpt` is the document the
 *      composer selects the story page's deck from, so the boundary is closed
 *      there and the heading keeps its words. Repairing only the first left the
 *      story page still opening on the weld (measured 2026-10-18).
 *   4. **A failed fetch is not a licence.** An article whose page cannot be read
 *      keeps its stored line and is reported as unavailable.
 *
 * SELECT-only apart from the single-row update `--apply` performs. Service-role
 * client, same as the other operator scripts. Node 22 or later.
 */

import {
  pageHeadings,
  separateWeldedHeading,
  splitWeldedHeading,
} from "@/lib/pipeline/welded-heading";
import { fetchArticlePage } from "../src/lib/pipeline/article-fetch";
import { loadCorpusEvents } from "./lib/corpus.ts";
import { db, heading, main, row, say } from "./lib/db.ts";

/**
 * The candidate ruler, deliberately loose.
 *
 * It only decides which pages are worth fetching: a lowercase word followed by a
 * capitalised phrase and a lowercase word is the shape of *any* weld, and of
 * plenty of ordinary sentences. Precision is the page's job — see rule 2 above.
 */
const WELD_CANDIDATE = /[a-z]{4,}[,;:)”"]?\s+[A-Z][a-z]{3,}\s+[a-z]{2,}\s+[\w’'-]{2,}/u;

main(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const eventsIndex = args.indexOf("--events");
  const limit = eventsIndex >= 0 ? Number(args[eventsIndex + 1] ?? 200) : 200;

  const events = await loadCorpusEvents(limit);
  /**
   * An event is a candidate when either stored string trips the loose ruler.
   *
   * Both, not just the event line: the first repair run fixed the line and the
   * story page kept its weld, because the composer selects the deck from
   * `articles.excerpt` rather than from `what_happened`. A run that only looked
   * at the line would report the defect fixed while the page still showed it.
   */
  const candidates = events.filter(
    (event) =>
      WELD_CANDIDATE.test(event.what ?? "") ||
      event.sourceList.some((source) => WELD_CANDIDATE.test(source.excerpt ?? "")),
  );

  heading("Welded headings: stored text whose own page confirms a boundary");
  say(row("events read", events.length));
  say(row("candidates to check against their own page", candidates.length));
  say(
    row("mode", apply ? "APPLY - confirmed repairs are written" : "dry run - nothing is written"),
  );

  const client = db();
  let repaired = 0;
  let preserved = 0;
  let unavailable = 0;

  for (const event of candidates) {
    const pages = event.sourceList.filter(
      (source) =>
        (source.url ?? "") !== "" &&
        (source === event.sourceList[0] || WELD_CANDIDATE.test(source.excerpt ?? "")),
    );
    if (pages.length === 0) {
      unavailable += 1;
      say(`· [no page] ${event.title}`);
      continue;
    }

    /** The line repair, from the first page that confirms a heading in it. */
    let lineRepair: ReturnType<typeof splitWeldedHeading> = null;
    /** Each article whose own excerpt the page confirms is welded. */
    const excerptRepairs: {
      articleId: string;
      heading: string;
      text: string;
    }[] = [];
    let readAny = false;

    for (const source of pages) {
      if (!source.url) continue;
      const fetched = await fetchArticlePage(source.url);
      if (!fetched.ok) continue;
      readAny = true;
      const headings = pageHeadings(fetched.html);
      if (lineRepair === null && WELD_CANDIDATE.test(event.what ?? "")) {
        lineRepair = splitWeldedHeading(event.what ?? "", headings);
      }
      const excerptRepair = separateWeldedHeading(source.excerpt ?? "", headings);
      if (excerptRepair !== null && source.articleId !== undefined) {
        excerptRepairs.push({
          articleId: source.articleId,
          heading: excerptRepair.headings.join(" / "),
          text: excerptRepair.text,
        });
      }
    }

    if (!readAny) {
      unavailable += 1;
      say(`· [unavailable] ${event.title} — no page could be read`);
      continue;
    }
    if (lineRepair === null && excerptRepairs.length === 0) {
      preserved += 1;
      continue;
    }

    repaired += 1;
    say(`· [repaired] ${event.title}`);
    if (lineRepair !== null) {
      say(`    line heading confirmed: ${lineRepair.headings.join(" / ")}`);
      say(`    line before: ${event.what}`);
      say(`    line after:  ${lineRepair.text}`);
    }
    for (const entry of excerptRepairs) {
      say(`    excerpt heading confirmed: ${entry.heading}`);
      say(`    excerpt after: ${entry.text.slice(0, 300)}…`);
    }
    if (!apply) continue;

    if (lineRepair !== null) {
      const { error } = await client
        .from("events")
        .update({ what_happened: lineRepair.text })
        .eq("id", event.id);
      if (error) say(`    WRITE FAILED (events): ${error.message}`);
      else say(`    written: events.what_happened = ${event.id}`);
    }
    for (const entry of excerptRepairs) {
      const { error } = await client
        .from("articles")
        .update({ excerpt: entry.text })
        .eq("id", entry.articleId);
      if (error) say(`    WRITE FAILED (articles): ${error.message}`);
      else say(`    written: articles.excerpt = ${entry.articleId}`);
    }
  }

  heading("Totals");
  say(row("candidates read", candidates.length));
  say(row("events repaired", repaired));
  say(row("preserved (no heading on the page, or nothing to cut)", preserved));
  say(row("unavailable (page not readable)", unavailable));
  if (!apply && repaired > 0) say("Dry run: pass --apply to write the confirmed repairs.");
});
