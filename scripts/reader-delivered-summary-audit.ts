/**
 * What summary lines did readers actually receive, and which boundary refuses each one?
 *
 * The denominator that matters for reader quality is the delivered surface -- `digests` +
 * `digest_items` + `deliveries` -- not the newest events. This audit exists because that measurement
 * was taken once from a scratch file and then could not be reproduced when its predicate set
 * mattered (2026-10-15: the guard built for the ruling refused fewer lines than the recorded count,
 * and there was nothing on disk to say which boundary the original count had used). Every count it
 * prints names the predicate that produced it, so a number from this file can be checked and
 * repeated.
 *
 * Usage: npm run audit:delivered-summary [--days 21]
 *
 * Measured 2026-10-15, twice, 21 days: 20 briefings delivered, 297 items delivered, 289 carrying a
 * line, **10 of those 289 withheld by the guard now in force**, 11 of 297 refused by any boundary on
 * the list (the extra one is the deck-scoped rule), 8 of the 20 briefings (40%) carrying at least one
 * such item, and 8 items (2.69%) delivered with no line at all.
 */

import { createClient } from "@supabase/supabase-js";
import {
  admissibleReaderSentence,
  editorialNoise,
  noMainClause,
  publisherSelfReference,
  unresolvedContextOpening,
} from "../src/lib/reader-evidence";
import { deliveredSummary } from "../src/lib/reader-summary";

const DAYS = (() => {
  const flag = process.argv.indexOf("--days");
  const value = flag === -1 ? 21 : Number(process.argv[flag + 1]);
  return Number.isFinite(value) && value > 0 ? value : 21;
})();

/** Every boundary a reader-facing line is held to, named so the report can attribute a refusal. */
const BOUNDARIES: { name: string; refuses: (text: string) => boolean }[] = [
  { name: "shared sentence boundary", refuses: (t) => !admissibleReaderSentence(t) },
  { name: "editorial noise", refuses: editorialNoise },
  { name: "publisher self-reference", refuses: publisherSelfReference },
  { name: "no main clause (deck boundary)", refuses: noMainClause },
  { name: "unresolved context opening (card boundary)", refuses: unresolvedContextOpening },
];

async function main() {
  // The two names `.env.example` documents; the env contract test in this repo fails a variable read
  // by the code but absent from that file, which is how this line was corrected on 2026-10-15.
  const url = process.env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const { data: digests, error: digestError } = await db
    .from("digests")
    .select("digest_id, user_id, scheduled_for")
    .eq("kind", "briefing")
    .gte("scheduled_for", since);
  if (digestError) throw new Error(`reading digests: ${digestError.message}`);
  const digestIds = (digests ?? []).map((d) => d.digest_id);

  const delivered = new Set(
    ((await db.from("deliveries").select("digest_id").in("digest_id", digestIds)).data ?? []).map(
      (d) => d.digest_id,
    ),
  );

  // The generated types declare this relation as an array while the query returns the single related
  // row as an object -- measured 2026-10-15, when the array-only accessor silently read no rows at
  // all and the audit reported zero lines. `eventOf` accepts both shapes so neither reading is
  // assumed.
  type JoinedEvent = { title: string | null; what_happened: string | null };
  type ItemRow = {
    digest_id: string;
    event_id: string;
    events: JoinedEvent | JoinedEvent[] | null;
  };
  const eventOf = (row: ItemRow): JoinedEvent | null => {
    const relation = row.events;
    if (!relation) return null;
    return Array.isArray(relation) ? (relation[0] ?? null) : relation;
  };

  const items: ItemRow[] = [];
  for (let i = 0; i < digestIds.length; i += 50) {
    const { data, error } = await db
      .from("digest_items")
      .select("digest_id, event_id, events ( title, what_happened )")
      .in("digest_id", digestIds.slice(i, i + 50));
    if (error) throw new Error(`reading digest_items: ${error.message}`);
    items.push(...(data ?? []));
  }

  const sent = items.filter((item) => delivered.has(item.digest_id));
  const refusedBy = new Map<string, string[]>();
  const refusedAny = new Set<string>();
  const withheld = new Set<string>();
  let withLine = 0;

  for (const item of sent) {
    const text = (eventOf(item)?.what_happened ?? "").trim();
    if (text === "") continue;
    withLine += 1;
    if (deliveredSummary(text) === null) withheld.add(item.event_id);
    for (const boundary of BOUNDARIES) {
      if (!boundary.refuses(text)) continue;
      refusedAny.add(item.event_id);
      const lines = refusedBy.get(boundary.name) ?? [];
      if (lines.length < 8) lines.push(`${eventOf(item)?.title ?? "(no title)"} :: ${text}`);
      refusedBy.set(boundary.name, lines);
    }
  }

  const affectedDigests = new Set(
    sent.filter((item) => refusedAny.has(item.event_id)).map((item) => item.digest_id),
  );

  console.log(`delivered surface, last ${DAYS} days (measured ${new Date().toISOString()})`);
  console.log(
    `briefings built ${digestIds.length}, delivered ${delivered.size}, items delivered ${sent.length}, items carrying a line ${withLine}`,
  );
  console.log(`withheld by the guard now in force (deliveredSummary): ${withheld.size} item(s)`);
  console.log(
    `refused by any boundary on this list: ${refusedAny.size} of ${sent.length} item(s) = ${((refusedAny.size / Math.max(sent.length, 1)) * 100).toFixed(2)}%`,
  );
  console.log(
    `briefings carrying at least one such item: ${affectedDigests.size} of ${delivered.size} = ${((affectedDigests.size / Math.max(delivered.size, 1)) * 100).toFixed(2)}%`,
  );
  console.log(
    `items delivered with no line at all: ${sent.length - withLine} = ${(((sent.length - withLine) / Math.max(sent.length, 1)) * 100).toFixed(2)}%`,
  );
  for (const [name, lines] of refusedBy) {
    console.log(`\n-- ${name} --`);
    for (const line of lines) console.log(`   ${line}`);
  }
}

await main();
