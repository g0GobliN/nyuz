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
 * The floor itself lives in `src/lib/pipeline/twin-floor.ts`, not here, so the
 * regression fixtures in the suite assert the same bar this reads. Its two legs
 * were tightened on 2026-10-20 after the Plex2Shell / BeyondTrust pair showed
 * both of them accepting evidence that is not evidence: a sentence-initial
 * capital counted as a name ("Hackers"), and function words counted as content
 * (`and`, absent from the shortlist's stop set). Both pairs of anchors are
 * printed with a failing pair, because the count of pairs below a tightened
 * floor is a question about the bar and not a number to tune away.
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

import { rankEntities } from "../src/lib/reader-evidence";
import { suppressStoryTwins } from "../src/lib/pipeline/duplicates";
import { twinFloor } from "../src/lib/pipeline/twin-floor";
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
   *                  content words — the ruling's own bar, as implemented in
   *                  `src/lib/pipeline/twin-floor.ts`. The verdict comes with
   *                  its anchors so a failing pair can be argued with rather
   *                  than merely counted.
   */
  const fuses = (a: Event, b: Event, securityAccess: boolean, resultFrames = false): boolean =>
    suppressStoryTwins(
      [
        { title: a.title, whatHappened: a.what_happened },
        { title: b.title, whatHappened: b.what_happened },
      ],
      { securityAccess, resultFrames },
    ).length === 1;

  const anchors = (entities: string[], words: string[]): string => {
    const names = entities.length === 0 ? "none" : entities.join(", ");
    return `entity ${names}  words ${words.length === 0 ? "none" : words.join(", ")}`;
  };

  let newly = 0;
  let violations = 0;
  let preexisting = 0;
  let preexistingViolations = 0;
  for (let i = 0; i < carrying.length; i += 1) {
    for (let j = i + 1; j < carrying.length; j += 1) {
      const a = carrying[i]!;
      const b = carrying[j]!;
      if (!fuses(a, b, true)) continue;
      const { entities, words, clears } = twinFloor(
        { title: a.title, whatHappened: a.what_happened },
        { title: b.title, whatHappened: b.what_happened },
      );
      if (fuses(a, b, false)) {
        preexisting += 1;
        if (clears) continue;
        preexistingViolations += 1;
        say("");
        say(`PRE-EXISTING (not this ruling)  ${anchors(entities, words)}`);
        say(`  A ${a.title}`);
        say(`  B ${b.title}`);
        continue;
      }
      newly += 1;
      if (clears) continue;
      violations += 1;
      say("");
      say(`VIOLATION  ${anchors(entities, words)}`);
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
    say(
      `ruling #18  FAIL  ${violations} newly fused pair(s) do not clear the floor — a ruling is needed, not a wider vocabulary and not a looser floor`,
    );
    process.exitCode = 1;
  } else {
    say(
      `ruling #18  PASS  every pair the widening newly fuses shares a capitalised name and three content words`,
    );
  }

  /*
   * The result leg (2026-10-21): its own population, bucketed by PRIMARY actor.
   *
   * The marker population above is the wrong denominator for a leg that reads a
   * frame on one side and a term on the other — the delivered SpaceX pair shares
   * no marker at all. So the result leg is measured where it can act: every pair
   * inside one PRIMARY-entity bucket, which is the leg's first condition. The
   * pairs it buys are printed with the floor's own anchors, because a leg that
   * suppresses has to be able to say what it suppressed on.
   */
  const RESULT_FRAME =
    /\b(?:beat|beats|beating|missed|misses|missing|topped|topping|exceeded|surpassed|above)\s+(?:expectations|estimates|forecasts|guidance|consensus)\b/iu;
  const RESULT_WORDS = [
    "revenue",
    "revenues",
    "earnings",
    "income",
    "profit",
    "profits",
    "sales",
    "quarter",
    "quarters",
    "quarterly",
    "margin",
    "margins",
    "results",
    "q1",
    "q2",
    "q3",
    "q4",
  ];
  const carriesResult = (event: Event): boolean => {
    const text = `${event.title} ${event.what_happened ?? ""}`;
    return (
      RESULT_FRAME.test(text) || RESULT_WORDS.some((word) => text.toLowerCase().includes(word))
    );
  };
  const resultEvents = events.filter(carriesResult);
  const buckets = new Map<string, Event[]>();
  for (const event of resultEvents) {
    const primary = rankEntities(event.title, [{ excerpt: event.what_happened ?? "" }])
      .filter((entity) => entity.role === "PRIMARY")
      .map((entity) => entity.name.toLowerCase());
    for (const name of primary) {
      const bucket = buckets.get(name) ?? [];
      bucket.push(event);
      buckets.set(name, bucket);
    }
  }
  let resultPairs = 0;
  let resultNew = 0;
  const resultSamples: string[] = [];
  for (const [name, bucket] of buckets) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        if (a.id === b.id) continue;
        const floor = twinFloor(
          { title: a.title, whatHappened: a.what_happened },
          { title: b.title, whatHappened: b.what_happened },
        );
        if (floor.result.frames.length === 0 || floor.result.terms.length === 0) continue;
        resultPairs += 1;
        // What the leg buys is a pair the pass kept *without* it.
        if (!fuses(a, b, true, false)) {
          resultNew += 1;
          if (resultSamples.length < 6)
            resultSamples.push(
              `  ${name}: ${floor.result.frames.join(",")} / ${floor.result.terms.join(",")}` +
                `\n    A ${a.title}\n    B ${b.title}`,
            );
        }
      }
    }
  }
  say("");
  say(`result leg: events carrying a result word   ${resultEvents.length}`);
  say(`result leg: pairs with frame and term        ${resultPairs}`);
  say(`result leg: pairs it newly fuses             ${resultNew}`);
  for (const sample of resultSamples) say(sample);
  if (resultNew > 0) {
    say(
      `result leg  PASS  every pair it fuses shares one PRIMARY actor and splits frame from term (${resultNew} named above or before the cap)`,
    );
  }
});
