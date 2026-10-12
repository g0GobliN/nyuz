/**
 * The 69 and the 413, attributed one by one — the ruling's step 2.
 *
 *   npm run audit:backlog
 *
 * Why this exists. The 2026-10-12 arbitration ruled that the two reader-backlog
 * counts must **not** be merged into one number: each of the 413 built-then-
 * discarded items is to be attributed as correctly refused under policy, lost
 * through execution failure, lost through a scheduling or expiry defect, or
 * another attributable reason — and the 69 briefed items with no
 * `why_it_matters` are to be audited against the existing reader-quality rules
 * with confirmed violations blocked. The target is _"not to force all 413 items
 * to ship"_ but _"every disposition is correct and explainable"_. A single
 * total cannot answer that; this prints the disposition of every row it counts,
 * so the number and its evidence arrive together.
 *
 * Read-only. Every query is a SELECT against the live project.
 */

import { db, fail, heading, main, row, say } from "./lib/db.ts";
import { digestDisposition, legCause } from "./lib/disposition.ts";

type Item = {
  digest_id: string;
  event_id: string;
  position: number;
  why_it_matters: string | null;
};

type Digest = {
  digest_id: string;
  user_id: string;
  scheduled_for: string;
  status: string;
  kind: string;
  item_count: number;
  generation_failure_reason: string | null;
};

type Delivery = {
  digest_id: string;
  channel: string;
  status: string;
  attempts: number;
  last_error: string | null;
};

/** The page size PostgREST returns by default; paging keeps big tables honest. */
const PAGE = 1000;

async function emptyWhyItems(): Promise<Item[]> {
  const out: Item[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("digest_items")
      .select("digest_id, event_id, position, why_it_matters")
      .or("why_it_matters.is.null,why_it_matters.eq.")
      .range(from, from + PAGE - 1);
    if (error) fail(`reading digest_items: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function expiredDigests(): Promise<Digest[]> {
  const out: Digest[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("digests")
      .select(
        "digest_id, user_id, scheduled_for, status, kind, item_count, generation_failure_reason",
      )
      .like("generation_failure_reason", "%briefing slot expired%")
      .range(from, from + PAGE - 1);
    if (error) fail(`reading digests: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function itemsOf(digestIds: string[]): Promise<Item[]> {
  const out: Item[] = [];
  for (const id of digestIds) {
    const { data, error } = await db()
      .from("digest_items")
      .select("digest_id, event_id, position, why_it_matters")
      .eq("digest_id", id);
    if (error) fail(`reading items of ${id}: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}

async function deliveriesOf(digestIds: string[]): Promise<Delivery[]> {
  const out: Delivery[] = [];
  for (const id of digestIds) {
    const { data, error } = await db()
      .from("deliveries")
      .select("digest_id, channel, status, attempts, last_error")
      .eq("digest_id", id);
    if (error) fail(`reading deliveries of ${id}: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}

main(async () => {
  // ── The 69: briefed items that shipped with no why_it_matters ──────────────
  const empty = await emptyWhyItems();
  const eventIds = [...new Set(empty.map((item) => item.event_id))];
  const impactRows = new Set<string>();
  const impacts = new Map<string, { status: string; text: string | null }>();
  for (let from = 0; from < eventIds.length || from === 0; from += 200) {
    const chunk = eventIds.slice(from, from + 200);
    if (chunk.length === 0) break;
    const { data, error } = await db()
      .from("event_impacts")
      .select("event_id, status, text")
      .in("event_id", chunk);
    if (error) fail(`reading event_impacts: ${error.message}`);
    for (const impact of data ?? []) {
      impactRows.add(impact.event_id);
      const text = (impact.text ?? "").trim();
      if (text) impacts.set(impact.event_id, { status: impact.status, text });
    }
  }

  heading("The 69 — briefed items with an empty why_it_matters");
  say(`items found                 ${empty.length}`);
  say(`distinct events             ${eventIds.length}`);
  say("");
  // The reader-quality rule the audit is against: a shipped item carries a
  // why-it-matters line, because the reader-facing contract shows one on every
  // item. Two attributable causes, and they are not the same defect:
  //   no explanation exists  -> the shared explanation was never produced;
  //   explanation exists     -> the composer dropped a line it had.
  // The first is split again by whether the explanation row exists at all,
  // because "never attempted" and "attempted and produced nothing" are
  // different failures even though a reader sees the same missing line.
  const noImpact = empty.filter((item) => !impacts.has(item.event_id));
  const dropped = empty.filter((item) => impacts.has(item.event_id));
  say(row("no explanation produced", noImpact.length));
  say(row("  row never written", noImpact.filter((item) => !impactRows.has(item.event_id)).length));
  say(
    row(
      "  row written, text empty",
      noImpact.filter((item) => impactRows.has(item.event_id)).length,
    ),
  );
  say(row("explanation dropped", dropped.length));
  say("");
  for (const item of dropped) {
    say(`  dropped  ${item.digest_id} #${item.position} event ${item.event_id}`);
  }

  // ── The 413: built items discarded with their digest ──────────────────────
  const expired = await expiredDigests();
  const expiredIds = expired.map((digest) => digest.digest_id);
  const items = await itemsOf(expiredIds);
  const deliveries = await deliveriesOf(expiredIds);

  const byDigest = new Map<string, Delivery[]>();
  for (const delivery of deliveries) {
    const list = byDigest.get(delivery.digest_id) ?? [];
    list.push(delivery);
    byDigest.set(delivery.digest_id, list);
  }

  // The ruling's four classes, resolved per digest because the digest is the
  // unit that was disposed of: the legs decide the class, the items inherit it.
  const classes = new Map<
    string,
    { items: number; digests: number; causes: Map<string, number> }
  >();
  const bump = (kind: string, itemCount: number, cause: string) => {
    const entry = classes.get(kind) ?? { items: 0, digests: 0, causes: new Map<string, number>() };
    entry.items += itemCount;
    entry.digests += 1;
    entry.causes.set(cause, (entry.causes.get(cause) ?? 0) + 1);
    classes.set(kind, entry);
  };

  heading("The 413 — built items discarded with their digest");
  say(`digests                     ${expired.length}`);
  say(`items                       ${items.length}`);
  say("");
  for (const digest of expired) {
    const legs = byDigest.get(digest.digest_id) ?? [];
    const itemCount = items.filter((item) => item.digest_id === digest.digest_id).length;
    const sent = legs.filter((leg) => leg.status === "sent");
    const failed = legs.filter((leg) => leg.status !== "sent");
    const cause =
      sent.length > 0
        ? `sent on ${sent.map((leg) => leg.channel).join("+")}`
        : legs.length === 0
          ? "no delivery leg was ever created"
          : [
              ...new Set(
                failed.map(
                  (leg) =>
                    `${legCause(leg.last_error ?? "")}: ${leg.last_error ?? "no reason recorded"}`,
                ),
              ),
            ].join(" | ");
    const kind = digestDisposition(legs);
    bump(kind, itemCount, cause);
    say(
      `  ${digest.digest_id}  ${digest.scheduled_for.slice(0, 10)}  ` +
        `${itemCount} items  ${legs.length} legs  → ${kind}  (${cause})`,
    );
  }

  say("");
  for (const [kind, entry] of classes) {
    say(row(kind, `${entry.items} items / ${entry.digests} digests`));
    for (const [cause, count] of entry.causes) {
      say(`      ${count}× ${cause}`);
    }
  }
});
