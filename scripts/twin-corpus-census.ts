/**
 * Ruling #18's corpus constraint, measured over 30 days of stored events.
 *
 *   npm run audit:twin-corpus [-- --days 30] [-- --limit 20000]
 *
 * The ruling added `hack`, `hacker`, `hacking`, `break in`, `break into` and
 * `broke into` to the delivery twin pass's vocabulary. A wider vocabulary buys a
 * real duplicate (the delivered 2026-10-19 pair) and costs risk, so the ruling
 * put a floor on what the widening may suppress: **no pair that does not also
 * share a capitalised entity and three content words.**
 *
 * The population is every stored event in the window whose headline carries one
 * of the new words — the pairs the widening can newly affect — and each pair is
 * run through the same `suppressStoryTwins` the briefing runs, twice: once with
 * the widened vocabulary and once without it (`{ securityAccess: false }`), which
 * separates what the widening bought from what the pass already did. A new fusion
 * below the floor exits non-zero, so the check can gate a later widening.
 *
 * The read is **paged**, because PostgREST returns at most the server's max-rows
 * (1000 on the hosted project) and a single `.limit()` therefore reads a prefix
 * of the window while printing a count that looks like the whole of it. Measured
 * 2026-10-20: the unpaged form reported "5 headlines carrying the new vocabulary"
 * and PASS; the whole window is 16,715 events, 119 such headlines, and it holds
 * one pre-existing fusion below the floor that the truncated read could not see.
 *
 * Read-only.
 */

import { capitalised } from "../src/lib/pipeline/news-signals";
import { suppressStoryTwins } from "../src/lib/pipeline/duplicates";
import { STOPWORDS } from "../src/lib/pipeline/shortlist";
import { db, main, say } from "./lib/db";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const index = args.indexOf(name);
  const value = Number(index >= 0 ? args[index + 1] : undefined);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const DAYS = flag("--days", 30);
/**
 * A ceiling, not a page: the read below walks `range()` until the window or this
 * number is reached, and the count is printed either way. 3000 was the first
 * value and it truncated the window at exactly the cap, which is why it is now
 * far above any plausible day count for this corpus.
 */
const LIMIT = flag("--limit", 20000);

/** The vocabulary ruling #18 added: the only words that can newly fuse a pair. */
const NEW_WORDS = ["hack", "hacker", "hacking", "break in", "break into", "broke into"];

const stem = (word: string): string => {
  if (word.length <= 4) return word;
  if (word.endsWith("ing")) return word.slice(0, -3);
  if (word.endsWith("ed")) return word.slice(0, -2);
  if (word.endsWith("es")) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
};

const contentWords = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
      .map(stem),
  );

type Event = { id: string; title: string; what_happened: string | null; first_seen_at: string };

main(async () => {
  const since = new Date(Date.now() - DAYS * 24 * 3_600_000).toISOString();
  // Paged, because PostgREST caps a response at the server's max-rows (1000 on
  // the hosted project) and a single `.limit(3000)` therefore reads a *prefix*
  // of the window while printing a count that looks like the whole of it. First
  // run of this census did exactly that: "window 30 days, 1000 events loaded".
  // A corpus test that silently drops the tail of its corpus is not a test of
  // the corpus, so the read walks `range()` until a short page ends it.
  const PAGE = 1000;
  const events: Event[] = [];
  for (let offset = 0; offset < LIMIT; offset += PAGE) {
    const { data, error } = await db()
      .from("events")
      .select("id,title,what_happened,first_seen_at")
      .gte("first_seen_at", since)
      .order("first_seen_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, Math.min(offset + PAGE, LIMIT) - 1);
    if (error) throw new Error(`events: ${error.message}`);
    const page = (data ?? []) as Event[];
    events.push(...page);
    if (page.length < PAGE) break;
  }
  const carries = (event: Event): boolean =>
    NEW_WORDS.some((word) => event.title.toLowerCase().includes(word));
  const carrying = events.filter(carries);
  say(`window              ${DAYS} days, ${events.length} events loaded`);
  say(`headlines carrying the new vocabulary   ${carrying.length}`);

  /**
   * Three populations, because the ruling's floor is about the *widening*.
   *
   *   `newly`        a pair the delivery pass fuses now and did not before. This
   *                  is what ruling #18 bought, and every one of them has to
   *                  clear the floor or the widening is spending risk the ruling
   *                  did not allow.
   *   `preexisting`  a pair the pass already fused without the new words. A
   *                  measured example, found only once this read was paged to the
   *                  whole window: *"FBI confirms 'multiple' arrests related to
   *                  ShinyHunters hack"* against *"Dutch police arrest a
   *                  ShinyHunters hacker accused of planning two murders"* share
   *                  a PRIMARY entity and a figure, so they fuse by the
   *                  figure-of-one-incident branch and never reach the marker
   *                  test. That is a different rule's defect and changing it here
   *                  would be a change no ruling covers, so it is counted and
   *                  named rather than silently folded into either column.
   *   `floor`        whether a pair shares a capitalised entity and three
   *                  content words — the ruling's own bar.
   */
  const floor = (a: Event, b: Event): { entity: boolean; words: number } => {
    const entities = new Set([...capitalised(a.title)].map((word) => word.toLowerCase()));
    const entity = [...capitalised(b.title)].some((word) => entities.has(word.toLowerCase()));
    const other = contentWords(`${b.title} ${b.what_happened ?? ""}`);
    const words = [...contentWords(`${a.title} ${a.what_happened ?? ""}`)].filter((word) =>
      other.has(word),
    ).length;
    return { entity, words };
  };
  const fuses = (a: Event, b: Event, securityAccess: boolean): boolean =>
    suppressStoryTwins(
      [
        { title: a.title, whatHappened: a.what_happened },
        { title: b.title, whatHappened: b.what_happened },
      ],
      { securityAccess },
    ).length === 1;

  let newly = 0;
  let violations = 0;
  let preexisting = 0;
  let preexistingViolations = 0;
  for (let i = 0; i < carrying.length; i += 1) {
    for (let j = i + 1; j < carrying.length; j += 1) {
      const a = carrying[i]!;
      const b = carrying[j]!;
      if (!fuses(a, b, true)) continue;
      const { entity, words } = floor(a, b);
      if (fuses(a, b, false)) {
        preexisting += 1;
        if (entity && words >= 3) continue;
        preexistingViolations += 1;
        say("");
        say(`PRE-EXISTING (not this ruling)  shared entity ${entity}, words ${words}`);
        say(`  A ${a.title}`);
        say(`  B ${b.title}`);
        continue;
      }
      newly += 1;
      if (entity && words >= 3) continue;
      violations += 1;
      say("");
      say(`VIOLATION  shared entity ${entity}, shared content words ${words}`);
      say(`  A ${a.title}`);
      say(`  B ${b.title}`);
    }
  }

  say("");
  say(`pairs newly fused by the widening   ${newly}`);
  say(`pairs fused before it as well       ${preexisting}`);
  say(`new fusions below the ruling floor  ${violations}`);
  say(
    `pre-existing fusions below it       ${preexistingViolations}   (another rule's; reported, not tuned)`,
  );
  if (violations > 0) {
    say("ruling #18  FAIL  the widening suppresses a pair the ruling does not allow");
    process.exitCode = 1;
  } else {
    say(
      `ruling #18  PASS  every suppressed pair shares a capitalised entity and three content words`,
    );
  }
});
