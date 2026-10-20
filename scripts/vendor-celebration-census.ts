/**
 * The first-party celebration class — measured before anything is ruled on.
 *
 * Ruling #9 authorises excluding one measured class at a time from the home feed. Three classes have
 * landed (a deal, an enthusiast mod, a publisher's coupon page). The live dashboard read of 2026-10-19
 * left a fourth card standing: *"RTX Spark Ignites Global Celebration as New Windows PCs Arrive"*,
 * carried by NVIDIA's own blog. `audit:dashboard-classes` counted that shape as 12 sources / 179 events
 * and stopped, because the population is not one class: it holds research, engineering, changelog and
 * roundup posts beside the celebration, and a rule keyed on "the source is the vendor" would refuse both.
 *
 * This script is the measurement behind `docs/decisions/vendor-celebration-class.md`. "First-party" is the
 * stored signal the pipeline already uses for it — `sources.kind = 'company_blog'` (`FIRST_PARTY_SOURCE_KINDS`
 * in `src/lib/pipeline/readiness.ts`) — not a brand name read out of a feed URL. The population is cut by
 * measured shape:
 *
 *   celebration      the vendor announcing its own news with celebration framing (the class)
 *   engineering      research / engineering / roundup posts from the same blogs (not the class)
 *   launch           introducing / announces / now available / expands (real news, must stay)
 *   other            everything else a first-party blog carries
 *
 * It also answers the question that decides the rule's *shape*: what the celebration lexeme alone would
 * cost. Over the whole corpus it matches 29 titles, 26 of them news — a conference cancellation, a papal
 * mass, a national anniversary, sports results. The first-party precondition is what separates the class
 * from those, and the script prints both sides so the difference can be checked rather than trusted.
 *
 * Every count names its predicate. SELECTs only: nothing here writes and no rule is applied. `--all`
 * prints every match of the predicate across the corpus, with the sources that carry it.
 *
 * Usage: node --env-file=.env scripts/tsrun.mjs scripts/vendor-celebration-census.ts [--all]
 */

import {
  isVendorCelebrationTitle,
  VENDOR_CELEBRATION_ARMS,
} from "@/lib/pipeline/vendor-celebration";
import { createAdminClient } from "@/lib/supabase/admin";
import { heading, main, row, say } from "./lib/db";

const all = process.argv.includes("--all");

const FIRST_PARTY_KIND = "company_blog";

/**
 * An engineering, research or roundup post: the shape that makes "a vendor blog" unusable as a class on
 * its own. Named so the number it produces can be repeated; deliberately generous, because the point is to
 * over-count this side of the population rather than under-count it.
 */
const ENGINEERING =
  /\b(research|paper|benchmark|arxiv|dataset|evaluation|we present|technical|engineering|roundup|how we built|deep dive|architecture|security|vulnerability|open[- ]source|release notes|changelog|fellowships?|applications)\b|^v\d+\.\d+/i;

/** A product launch reported as news: the shape the ruling must leave eligible. */
const LAUNCH =
  /\b(introduc\w+|announc\w+|launch\w+|unveil\w+|now available|available (?:today|now)|expands?|debuts?|releases?|ships?|general availability|is now|are now)\b/i;

/** A repricing or price move, reported: the control for "a celebration rule must not touch prices". */
const REPRICING =
  /\b(cheaper|price cut|repricing|price drop|discount\w*|costs? less|lower(?:s|ed)? price)\b/i;

/** A partnership or acquisition, reported: the other control. */
const DEAL = /\b(partnership|partner\w*|acqui\w+|alliance|merger|joint venture)\b/i;

type EventRow = { id: string; title: string };

async function allTitles(client: ReturnType<typeof createAdminClient>): Promise<EventRow[]> {
  const out: EventRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("events")
      .select("id, title")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`events: ${error.message}`);
    const batch = (data ?? []) as EventRow[];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

/** The sources carrying each event, as `Name [kind]`, plus the first-party sources themselves. */
type Carriage = Map<string, Set<string>>;

async function carriage(
  client: ReturnType<typeof createAdminClient>,
): Promise<{ byEvent: Carriage; firstParty: { id: string; name: string }[] }> {
  const { data: sources, error: sourceError } = await client
    .from("sources")
    .select("id, name, kind");
  if (sourceError) throw new Error(`sources: ${sourceError.message}`);

  const firstParty = (sources ?? [])
    .filter((source) => source.kind === FIRST_PARTY_KIND)
    .map((source) => ({ id: source.id, name: source.name }));
  const nameOf = new Map((sources ?? []).map((source) => [source.id, source.name] as const));
  const kindOf = new Map(
    (sources ?? []).map((source) => [source.id, source.kind as string] as const),
  );

  // Two passes rather than one over every article: the first-party links are a few thousand rows and
  // name the candidate events; the second reads the full coverage of only those events. One pass over the
  // whole article table answers the same question after reading 48k rows.
  const candidates = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id")
      .in(
        "source_id",
        firstParty.map((source) => source.id),
      )
      .not("event_id", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`articles (first-party): ${error.message}`);
    const batch = (data ?? []) as { event_id: string | null }[];
    for (const link of batch) if (link.event_id) candidates.add(link.event_id);
    if (batch.length < 1000) break;
  }

  const byEvent: Carriage = new Map();
  const ids = [...candidates];
  for (let from = 0; from < ids.length; from += 200) {
    const { data, error } = await client
      .from("articles")
      .select("event_id, source_id")
      .in("event_id", ids.slice(from, from + 200));
    if (error) throw new Error(`articles (coverage): ${error.message}`);
    for (const link of (data ?? []) as { event_id: string | null; source_id: string | null }[]) {
      if (!link.event_id || !link.source_id) continue;
      const name = nameOf.get(link.source_id);
      if (!name) continue;
      const set = byEvent.get(link.event_id) ?? new Set<string>();
      set.add(`${name} [${kindOf.get(link.source_id) ?? "?"}]`);
      byEvent.set(link.event_id, set);
    }
  }

  return { byEvent, firstParty };
}

function kindsOf(byEvent: Carriage, id: string): string[] {
  const entries = [...(byEvent.get(id) ?? [])];
  return [...new Set(entries.map((entry) => entry.slice(entry.lastIndexOf("[") + 1, -1)))];
}

function share(part: number, whole: number): string {
  return whole === 0 ? "0.0%" : `${((part / whole) * 100).toFixed(1)}%`;
}

main(async () => {
  const client = createAdminClient();
  const events = await allTitles(client);
  const { byEvent, firstParty } = await carriage(client);

  /** Every source that carries the event is first-party — the readiness gate's own definition. */
  const carriedOnlyByVendor = (id: string): boolean => {
    const kinds = kindsOf(byEvent, id);
    return kinds.length > 0 && kinds.every((kind) => kind === FIRST_PARTY_KIND);
  };
  const carriedByAnyVendor = (id: string): boolean =>
    kindsOf(byEvent, id).includes(FIRST_PARTY_KIND);
  const refused = (event: EventRow): boolean =>
    isVendorCelebrationTitle(event.title, kindsOf(byEvent, event.id));

  const vendorOnly = events.filter((event) => carriedOnlyByVendor(event.id));
  const byTitle = (test: RegExp) => (rows: EventRow[]) =>
    rows.filter((event) => test.test(event.title));

  const celebration = vendorOnly.filter(refused);
  const engineering = byTitle(ENGINEERING)(vendorOnly);
  const launch = byTitle(LAUNCH)(vendorOnly);
  const repricing = byTitle(REPRICING)(vendorOnly);
  const deal = byTitle(DEAL)(vendorOnly);
  const neither = vendorOnly.filter(
    (event) => !refused(event) && !ENGINEERING.test(event.title) && !LAUNCH.test(event.title),
  );
  const overlap = celebration.filter((event) => ENGINEERING.test(event.title));

  heading(`First-party blogs — ${vendorOnly.length} events carried only by company_blog sources`);
  say(row("company_blog sources", firstParty.length, 44));
  say(
    row(
      "events any company_blog carries",
      events.filter((e) => carriedByAnyVendor(e.id)).length,
      44,
    ),
  );
  say(row("events carried only by them", vendorOnly.length, 44));
  say(row("  celebration (the predicate)", celebration.length, 44));
  say(row("  engineering / research / roundup", engineering.length, 44));
  say(row("  launch / announcement (kept)", launch.length, 44));
  say(row("  repricing (kept)", repricing.length, 44));
  say(row("  partnership / acquisition (kept)", deal.length, 44));
  say(row("  none of those", neither.length, 44));
  say(row("celebration ∩ engineering", overlap.length, 44));
  say(row("celebration ∩ launch", celebration.filter((e) => LAUNCH.test(e.title)).length, 44));

  heading("First-party sources, by events carried alone");
  const counts = new Map<string, number>();
  for (const event of vendorOnly) {
    for (const source of byEvent.get(event.id) ?? [])
      counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  for (const [source, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    say(`  ${source.padEnd(42)} ${String(count).padStart(4)}`);
  }

  heading("Celebration, first-party — every one the predicate refuses");
  for (const event of celebration) {
    say(`  ${event.title}`);
    say(`      ${[...(byEvent.get(event.id) ?? [])].join(" · ")}`);
  }

  heading("The celebration lexeme without the first-party arm — what the title alone would cost");
  for (const arm of VENDOR_CELEBRATION_ARMS) {
    const corpus = events.filter((event) => arm.test.test(event.title));
    const first = corpus.filter((event) => carriedOnlyByVendor(event.id));
    say(row(`  ${arm.name}: corpus`, corpus.length, 44));
    say(row(`  ${arm.name}: first-party`, first.length, 44));
  }

  const lexemeOnly = events.filter((event) =>
    VENDOR_CELEBRATION_ARMS.some((arm) => arm.test.test(event.title)),
  );
  say(row("celebration lexeme, all sources", lexemeOnly.length, 44));
  say(
    row(
      "  of those, first-party carriage",
      lexemeOnly.filter((e) => carriedOnlyByVendor(e.id)).length,
      44,
    ),
  );
  say(
    row(
      "  of those, not first-party (news)",
      lexemeOnly.filter((e) => !carriedOnlyByVendor(e.id)).length,
      44,
    ),
  );

  heading("Controls — first-party titles the predicate must leave eligible");
  const controls = [
    { name: "launch", rows: launch },
    { name: "repricing", rows: repricing },
    { name: "partnership / acquisition", rows: deal },
    { name: "engineering / research", rows: engineering },
  ];
  for (const control of controls) {
    const refusedControl = control.rows.filter(refused);
    say(row(`${control.name}: in the population`, control.rows.length, 44));
    say(row(`${control.name}: refused by the predicate`, refusedControl.length, 44));
    for (const event of refusedControl.slice(0, 5)) say(`      REFUSED: ${event.title}`);
  }

  heading("Corpus-wide");
  const corpusRefused = events.filter(refused);
  say(row("refused by isVendorCelebrationTitle", corpusRefused.length, 44));
  say(row("share of the first-party population", share(celebration.length, vendorOnly.length), 44));
  if (all) {
    heading("Every corpus refusal, with its sources");
    for (const event of corpusRefused) {
      say(`  ${event.title}`);
      say(`      ${[...(byEvent.get(event.id) ?? [])].join(" · ").slice(0, 200)}`);
    }
    heading(
      "Every celebration-lexeme title that is NOT first-party (the news the title arm would refuse)",
    );
    for (const event of lexemeOnly.filter((e) => !carriedOnlyByVendor(e.id))) {
      say(`  ${event.title}`);
    }
  }

  heading("The delivered surface — the newest briefings");
  const titleOf = new Map(events.map((event) => [event.id, event.title] as const));
  const { data: digests, error: digestError } = await client
    .from("digests")
    .select("digest_id, user_id, scheduled_for, status")
    .eq("kind", "briefing")
    .in("status", ["sent", "ready"])
    .order("scheduled_for", { ascending: false })
    .limit(3);
  if (digestError) throw new Error(`digests: ${digestError.message}`);
  for (const digest of digests ?? []) {
    const { data: items, error: itemError } = await client
      .from("digest_items")
      .select("event_id, position")
      .eq("digest_id", digest.digest_id)
      .order("position", { ascending: true });
    if (itemError) throw new Error(`digest_items: ${itemError.message}`);
    const rows = (items ?? []) as { event_id: string; position: number }[];
    const refusedItems = rows.filter((item) =>
      isVendorCelebrationTitle(titleOf.get(item.event_id) ?? "", kindsOf(byEvent, item.event_id)),
    );
    say(
      `  ${digest.scheduled_for.slice(0, 10)}  ${digest.status.padEnd(6)}  ` +
        `${String(rows.length).padStart(3)} cards  ${refusedItems.length} refused  ${digest.digest_id.slice(0, 8)}`,
    );
    for (const item of refusedItems)
      say(`      #${item.position} ${titleOf.get(item.event_id) ?? ""}`);
  }

  heading("This reader's matched set");
  const byReader = new Map<string, EventRow[]>();
  let matchedRows = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("user_events")
      .select("event_id, user_id")
      .order("user_id")
      .range(from, from + 999);
    if (error) throw new Error(`user_events: ${error.message}`);
    const batch = (data ?? []) as { event_id: string; user_id: string }[];
    matchedRows += batch.length;
    for (const link of batch) {
      const title = titleOf.get(link.event_id);
      if (!title) continue;
      byReader.set(link.user_id, [
        ...(byReader.get(link.user_id) ?? []),
        { id: link.event_id, title },
      ]);
    }
    if (batch.length < 1000) break;
  }
  const biggest = [...byReader.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (biggest) {
    const [reader, rows] = biggest;
    const refusedRows = rows.filter(refused);
    say(
      `  reader ${reader.slice(0, 8)} — ${rows.length} matched titles, ${refusedRows.length} refused`,
    );
    for (const event of refusedRows) say(`      ${event.title}`);
  }
  say(`  matched rows read: ${matchedRows}`);

  say();
  say(
    "Read this as a population, not a verdict: the engineering, launch, repricing and deal columns are",
  );
  say(
    "the false positives the predicate has to survive, and the last block is what a title-only rule costs.",
  );
  say();
});
