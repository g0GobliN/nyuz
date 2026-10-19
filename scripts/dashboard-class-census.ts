/**
 * The dashboard's remaining classes, counted before anything is ruled on.
 *
 * Ruling #9 authorised excluding one measured class at a time from the home feed. Two landed on
 * 2026-10-18 (`isReaderDealTitle`: a discount marker AND an acquisition verb; `isReaderModTitle`: an
 * enthusiast modification). The 2026-10-19 read of the live dashboard found three cards those rules do
 * not touch -- a price card, a discount card and a first-party celebration -- and the checklist records
 * them as "the measured population for the next class ruling". This script is that measurement.
 *
 * It answers one question and refuses the tempting shortcut. The shortcut is "widen the deal rule to
 * price shapes without an acquisition verb"; the answer is that the width is not one class:
 *
 *   coupon / promo-code page        a publisher's affiliate page -- not a development at all
 *   explicit discount deal          "% off", "$N off", "all-time low" -- the observed card lives here
 *   price movement as the news      "goes on sale in the UK", "is cheaper, less restrictive" -- real news
 *   review / buying advice          a review, which the ruling deliberately does not touch
 *
 * so a rule keyed on "price" alone would sweep product-launch news, and the population above is what a
 * ruling has to cut rather than a number to hand over as a class. The vendor-owned-blog shape is counted
 * the same way, and it is not a class either: the 88 events include research and engineering posts.
 *
 * Every count names its predicate, so a number from this file can be checked and repeated. SELECTs only.
 *
 * Usage: npm run audit:dashboard-classes [-- --limit <n>]
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { isReaderDealTitle, isReaderModTitle } from "@/lib/pipeline/alert-floor";
import { heading, main, row, say } from "./lib/db";

const limitArg = process.argv.indexOf("--limit");
const SAMPLE = limitArg === -1 ? 8 : Math.max(1, Number(process.argv[limitArg + 1]) || 8);

/**
 * A price or discount *shape* in the headline -- deliberately wider than the landed rule, because the
 * question here is what lies outside it. Named predicates, not vibes: each bucket below prints the count
 * its own expression produced.
 */
const PRICE_SHAPE =
  /\b(all[- ]time low|low(?:est)? pric\w+|pric\w+ (?:drop|cut|slash)|discount\w*|cheaper|half off|hundreds? off|\d+% off|\$\d[\d,]* off|clearance|on sale|price tag)\b/i;
const ACQUISITION_VERB = /\b(grab|snag|buy|order|pre-?order|pick up|claim|get|save|score)\b/i;

/** The buckets a rule could name, in the order they are tested; the first match claims the title. */
const BUCKETS: { name: string; test: RegExp }[] = [
  { name: "coupon / promo-code page", test: /\b(promo ?code|coupon|discount code|voucher)\b/i },
  {
    name: "explicit discount deal (% off, $N off, all-time low)",
    test: /\b(\d+\s*% off|\$\d[\d,]* off|all[- ]time low|half price|hundreds? off)\b/i,
  },
  {
    name: "price movement as the news (on sale, cheaper, price cut)",
    test: /\b(goes? on sale|on sale|is cheaper|cheaper than|pric\w+ (?:drop|cut)|discounts?|slashed)\b/i,
  },
  { name: "review / buying advice", test: /\b(review|best .* (?:deals|picks)|buying guide)\b/i },
];

/** The vendors whose own blog is in the corpus; the celebration class has to be cut out of these. */
const VENDOR_BLOG = /nvidia|microsoft|apple|google|amazon|samsung|intel|amd|openai|anthropic/i;

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

function sample(label: string, rows: readonly EventRow[]): void {
  say(row(label.slice(0, 62), rows.length, 62));
  for (const item of rows.slice(0, SAMPLE)) say(`      ${item.title.slice(0, 112)}`);
  if (rows.length > SAMPLE) say(`      … ${rows.length - SAMPLE} more`);
}

main(async () => {
  const client = createAdminClient();
  const events = await allTitles(client);

  heading(`Stored corpus — ${events.length} event titles`);
  const dealRefused = events.filter((event) => isReaderDealTitle(event.title));
  const modRefused = events.filter((event) => isReaderModTitle(event.title));
  say(row("refused by isReaderDealTitle", dealRefused.length, 62));
  say(row("refused by isReaderModTitle", modRefused.length, 62));

  const priceShaped = events.filter((event) => PRICE_SHAPE.test(event.title));
  const withVerb = priceShaped.filter((event) => ACQUISITION_VERB.test(event.title));
  const withoutVerb = priceShaped.filter((event) => !ACQUISITION_VERB.test(event.title));
  heading("Price/discount shapes, and what the landed rule already takes");
  say(row("price/discount-shaped titles", priceShaped.length, 62));
  say(row("  with an acquisition verb (landed rule)", withVerb.length, 62));
  say(row("  without one (outside the landed rule)", withoutVerb.length, 62));

  heading("The ones outside the rule, cut by shape — this is what a class is");
  const claimed = new Set<string>();
  for (const bucket of BUCKETS) {
    const rows = withoutVerb.filter((event) => {
      if (claimed.has(event.id) || !bucket.test.test(event.title)) return false;
      claimed.add(event.id);
      return true;
    });
    sample(`${bucket.name}`, rows);
  }
  sample(
    "unclassified by the buckets above",
    withoutVerb.filter((event) => !claimed.has(event.id)),
  );

  heading("Vendor-owned blogs — a source shape, which is not yet a class");
  const { data: sources, error: sourceError } = await client
    .from("sources")
    .select("id, name, feed_url");
  if (sourceError) throw new Error(`sources: ${sourceError.message}`);
  const vendorIds = (sources ?? [])
    .filter((row) => VENDOR_BLOG.test(row.feed_url))
    .map((row) => row.id);
  say(row("vendor-owned sources in the corpus", vendorIds.length, 62));
  if (vendorIds.length) {
    const { data: links, error: linkError } = await client
      .from("articles")
      .select("event_id")
      .not("event_id", "is", null)
      .in("source_id", vendorIds);
    if (linkError) throw new Error(`articles: ${linkError.message}`);
    const ids = new Set((links ?? []).map((rowLink) => rowLink.event_id as string));
    const carried = events.filter((event) => ids.has(event.id));
    say(row("events carried by one of them", carried.length, 62));
    for (const item of carried.slice(0, SAMPLE)) say(`      ${item.title.slice(0, 112)}`);
    if (carried.length > SAMPLE) say(`      … ${carried.length - SAMPLE} more`);
  }

  say();
  say("Nothing here is refused: a class is not widened by a population count, and two of these");
  say("buckets contain real news. The counts are the evidence a ruling cuts against.");
  say();
});
