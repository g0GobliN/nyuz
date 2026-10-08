/**
 * What the next daily briefing would contain — read-only.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/briefing-preview.ts
 *
 * Replays the real selection path — `selectItems` with the thin-day 72h gate,
 * duplicate suppression, the plan cap, then the reader-readiness gate and
 * `reasonFor` for the line each card would print — over live matches. Nothing
 * is written and no delivery is queued, so this is safe to run against
 * production between scheduled sends.
 *
 * Kept because the alternative is generating the real digest to find out what
 * it looks like, which sends it.
 */

import { capFor } from "../src/lib/density";
import { suppressDeliveredDuplicates, suppressStoryTwins } from "../src/lib/pipeline/duplicates";
import { selectItems, type MatchRow } from "../src/lib/pipeline/digest";
import { reasonFor } from "../src/lib/pipeline/inclusion";
import { assessReadiness } from "../src/lib/pipeline/readiness";
import { db, heading, main, row, say } from "./lib/db.ts";

type Brief = {
  eventId: string;
  title: string;
  whatHappened: string | null;
  beforeState: string | null;
  afterState: string | null;
  sourceCount: number;
  topics: string[];
  outlet: string | null;
  tags: string[];
  eventAt: string | null;
  storedImpact: string | null;
  relevance: number;
};

main(async () => {
  const now = new Date();

  // The reader: `--user <id>` when an operator has one in mind, otherwise the
  // account that received the most recent briefing worth reading.
  const userFlag = process.argv.indexOf("--user");
  const flagUser = userFlag === -1 ? undefined : process.argv[userFlag + 1];
  const { data: recent, error: rErr } = await db()
    .from("digests")
    .select("user_id,item_count")
    .eq("kind", "briefing")
    .order("scheduled_for", { ascending: false })
    .limit(50);
  if (rErr) throw new Error(rErr.message);
  const userId =
    flagUser === undefined
      ? ((recent ?? []).find((d) => (d.item_count ?? 0) > 0)?.user_id ?? (recent ?? [])[0]?.user_id)
      : ((recent ?? []).find((d) => d.user_id.startsWith(flagUser))?.user_id ?? flagUser);
  if (!userId) throw new Error("no briefing reader found");

  const [{ data: pref }, { data: sub }] = await Promise.all([
    db().from("notification_preferences").select("density").eq("user_id", userId).maybeSingle(),
    db().from("subscriptions").select("plan").eq("user_id", userId).maybeSingle(),
  ]);
  const density = pref?.density ?? 3;
  const plan = sub?.plan ?? "uno";
  const cap = capFor(density, plan);

  // --- matches, exactly as loadMatches reads them --------------------------
  const { data: matchRows, error: mErr } = await db()
    .from("user_events")
    .select(
      "event_id, relevance, matched_at, delivered_revision, events ( first_seen_at, material_occurrence_at, material_revision, importance, novelty )",
    )
    .eq("user_id", userId)
    .is("briefed_at", null)
    .is("expired_at", null)
    .order("relevance", { ascending: false });
  if (mErr) throw new Error(mErr.message);

  const matches: MatchRow[] = (matchRows ?? []).map((row2) => {
    const event = row2.events as {
      first_seen_at?: string;
      material_occurrence_at?: string | null;
      material_revision?: number;
      importance?: number;
      novelty?: number;
    } | null;
    return {
      eventId: row2.event_id,
      relevance: row2.relevance,
      matchedAt: row2.matched_at,
      eventAt: event?.material_occurrence_at ?? event?.first_seen_at ?? null,
      importance: event?.importance ?? 0,
      novelty: event?.novelty ?? 0,
      materialRevision: event?.material_revision ?? 0,
      deliveredRevision: row2.delivered_revision ?? 0,
    };
  });

  // --- already delivered ---------------------------------------------------
  const { data: prior, error: pErr } = await db()
    .from("digests")
    .select("digest_id")
    .eq("user_id", userId)
    .in("status", ["ready", "sent", "generating"]);
  if (pErr) throw new Error(pErr.message);
  const already = new Map<string, number>();
  const priorIds = (prior ?? []).map((d) => d.digest_id);
  if (priorIds.length > 0) {
    const { data: items, error: iErr } = await db()
      .from("digest_items")
      .select("event_id, delivered_revision")
      .in("digest_id", priorIds);
    if (iErr) throw new Error(iErr.message);
    for (const item of items ?? []) {
      const revision = item.delivered_revision ?? 0;
      already.set(item.event_id, Math.max(already.get(item.event_id) ?? 0, revision));
    }
  }

  // --- selection -----------------------------------------------------------
  const ranked = selectItems(matches, already, matches.length, now, "daily");
  const distinct = await suppressDeliveredDuplicates(
    db(),
    userId,
    ranked.map((r) => r.eventId),
    now,
    "briefing",
    new Map(ranked.map((r) => [r.eventId, r.materialRevision] as const)),
  );
  // The same headroom generation takes: twins and the gate drop items after the
  // cap, and the next story takes their place rather than shortening the list.
  const picked = ranked.filter((r) => distinct.has(r.eventId)).slice(0, cap + 12);

  heading(`Next briefing (reader ${userId.slice(0, 8)}, cap ${cap})`);
  say(
    row(
      "  ",
      `${matches.length} matches → ${ranked.length} eligible → ${distinct.size} distinct → ${picked.length} picked`,
      110,
    ),
  );
  if (picked.length === 0) {
    say(row("  ", "nothing to send", 110));
    return;
  }

  // --- brief material, as loadBriefs reads it -------------------------------
  const ids = picked.map((p) => p.eventId);
  const [{ data: events }, { data: links }, { data: coverage }, { data: impacts }] =
    await Promise.all([
      db()
        .from("events")
        .select(
          "id, title, what_happened, after_state, importance, publisher_count, first_seen_at, tags",
        )
        .in("id", ids),
      db().from("event_topics").select("event_id, topics ( label )").in("event_id", ids),
      db().from("articles").select("event_id, source_id, sources ( name )").in("event_id", ids),
      db()
        .from("event_impacts")
        .select("event_id, status, text")
        .in("event_id", ids)
        .eq("status", "complete"),
    ]);

  const byId = new Map((events ?? []).map((e) => [e.id, e]));
  const topicsOf = new Map<string, string[]>();
  for (const link of links ?? []) {
    const label = (link.topics as { label?: string } | null)?.label;
    if (!label) continue;
    topicsOf.set(link.event_id, [...(topicsOf.get(link.event_id) ?? []), label]);
  }
  const outletsOf = new Map<string, Set<string>>();
  const outletNamesOf = new Map<string, Set<string>>();
  for (const art of coverage ?? []) {
    if (!art.event_id) continue;
    const seen = outletsOf.get(art.event_id) ?? new Set<string>();
    seen.add(art.source_id ?? "unknown");
    outletsOf.set(art.event_id, seen);
    const name = (art.sources as { name?: string } | null)?.name;
    if (!name) continue;
    const named = outletNamesOf.get(art.event_id) ?? new Set<string>();
    named.add(name);
    outletNamesOf.set(art.event_id, named);
  }
  const impactOf = new Map(
    (impacts ?? []).map((i) => [i.event_id, (i as { text?: string | null }).text ?? null]),
  );

  const allBriefs: Brief[] = picked.flatMap((row3) => {
    const event = byId.get(row3.eventId);
    if (!event) return [];
    const named = outletNamesOf.get(row3.eventId);
    return [
      {
        eventId: row3.eventId,
        title: event.title,
        whatHappened: event.what_happened,
        beforeState: (event as { before_state?: string | null }).before_state ?? null,
        afterState: (event as { after_state?: string | null }).after_state ?? null,
        sourceCount:
          (event as { publisher_count?: number }).publisher_count ||
          outletsOf.get(row3.eventId)?.size ||
          0,
        topics: topicsOf.get(row3.eventId) ?? [],
        outlet: named && named.size === 1 ? ([...named][0] ?? null) : null,
        tags: (event as { tags?: string[] }).tags ?? [],
        eventAt: (event as { first_seen_at?: string }).first_seen_at ?? null,
        storedImpact: impactOf.get(row3.eventId) ?? null,
        relevance: row3.relevance,
      },
    ];
  });

  // One story per briefing, exactly as generation applies it.
  const briefs = suppressStoryTwins(allBriefs);

  // The three rungs reasonFor can climb, counted so a silent briefing says why.
  const { data: allImpacts } = await db()
    .from("event_impacts")
    .select("event_id,status")
    .in("event_id", ids);
  const impactStatuses = new Map<string, string>();
  for (const row4 of allImpacts ?? [])
    impactStatuses.set(row4.event_id, (row4 as { status?: string }).status ?? "?");
  const withAfter = briefs.filter((b) => (b.afterState ?? "").trim() !== "").length;
  const withImpact = briefs.filter((b) => (b.storedImpact ?? "").trim() !== "").length;
  say(
    row(
      "  ",
      `rungs: stored impact ${withImpact}/${briefs.length} ` +
        `(rows: ${[...impactStatuses.values()].filter((s) => s === "complete").length} complete, ` +
        `${[...impactStatuses.values()].filter((s) => s !== "complete").length} other), ` +
        `after-state ${withAfter}/${briefs.length}`,
      110,
    ),
  );

  // --- the two gates a reader never sees ------------------------------------
  const ready: Brief[] = [];
  const withheld: { brief: Brief; kind: string }[] = [];
  for (const brief of briefs) {
    const verdict = assessReadiness({
      title: brief.title,
      whatHappened: brief.whatHappened,
      sourceCount: brief.sourceCount,
    });
    if (verdict.ready) ready.push(brief);
    else withheld.push({ brief, kind: verdict.kind });
  }
  if (ready.length > cap) ready.splice(cap);

  heading(`Ships (${ready.length})`);
  // The ladder reads the event's own stored fields only — no reader inputs,
  // since 2026-10-08 (inclusion.ts). What this prints is what generation
  // would store, for this reader's pool.
  let multi = 0;
  let withLine = 0;
  const rungs = new Map<string, number>();
  const lines: string[] = [];
  for (const brief of ready) {
    const why = reasonFor({
      storedImpact: brief.storedImpact,
      beforeState: brief.beforeState,
      afterState: brief.afterState,
      sourceCount: brief.sourceCount,
      title: brief.title,
      whatHappened: brief.whatHappened,
    });
    const text = why.text;
    rungs.set(why.source, (rungs.get(why.source) ?? 0) + 1);
    if (text !== "") lines.push(text);
    if (brief.sourceCount > 1) multi += 1;
    if (text !== "") withLine += 1;
    const src = `${brief.sourceCount} src`;
    const time = brief.eventAt === null ? "??" : brief.eventAt.slice(11, 16);
    say(row(" ", `${src} ${time}  ${brief.title.slice(0, 72)}`, 110));
    say(row(" ", `        ${text === "" ? "(no why-line)" : text}`, 110));
  }
  say();
  say(row("  ", `multi-source ${multi}/${ready.length}`, 110));
  say(row("  ", `with a why-line ${withLine}/${ready.length}`, 110));
  say(row("  ", `distinct why-lines ${new Set(lines).size}/${withLine}`, 110));
  say(row("  ", `rungs: ${[...rungs.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`, 110));

  if (withheld.length > 0) {
    heading(`Withheld by the readiness gate (${withheld.length})`);
    for (const { brief, kind } of withheld)
      say(row(" ", `[${kind}] ${brief.title.slice(0, 84)}`, 110));
  }
});
