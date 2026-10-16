/**
 * Read-only composition diagnostic — **not** a production build or delivery.
 *
 *   npm run diagnostic:composition -- --user <id>
 *   npm run diagnostic:composition            (the most recent reader with items)
 *
 * **Why this exists.** The arbiter's 2026-10-16 ruling approved one controlled
 * production-path build (`npm run pipeline -- digest --user <id> --now --skip-send`)
 * but only after the reader's account-local date had changed, because
 * `enforce_daily_briefing` (migrations/0082) drops a second briefing for the same
 * reader on the same account-local date when the day's earlier row failed *after*
 * starting. Until then this is the substitute it authorised: it replays the build's
 * own selection and composition over today's real candidate pool and prints, per
 * item, the line the build would store.
 *
 * **What it does not establish**, and the ruling says so explicitly: that a digest
 * can be persisted, that `delivered_revision` records the right provenance, that the
 * reader's read paths consume the stored artifact, or that email or push renders it.
 * Its output must never be added to the post-deploy delivered-artifact numbers.
 *
 * **What it mirrors** (`src/lib/pipeline/digest.ts`, cited so drift is checkable):
 *
 *   `loadMatches`                             line 1347
 *   `alreadyBriefed`                          line 1399
 *   `selectItems` → `suppressDeliveredDuplicates` → `suppressStoryTwins`
 *     → `suppressDeliveredTwins(deliveredTwinTitles)`   lines 786–836
 *   `loadBriefs`                              line 1434
 *   the readiness gate and the cap            lines 845–859
 *   `composedSummaryArtifact` call            line 1030
 *
 * It is a replay, not the production path. The authoritative evidence for
 * persistence, provenance and delivery remains the controlled build itself.
 *
 * Reads only: every statement below is a `select`. No digest or delivery row is
 * written, no notification is sent, and unlike `--skip-send` there is nothing to
 * deliver afterwards.
 */

import { capFor } from "../src/lib/density";
import {
  suppressDeliveredDuplicates,
  suppressDeliveredTwins,
  suppressStoryTwins,
} from "../src/lib/pipeline/duplicates";
import { selectItems, type MatchRow } from "../src/lib/pipeline/digest";
import { assessReadiness } from "../src/lib/pipeline/readiness";
import {
  admissibleReaderSentence,
  editorialNoise,
  unresolvedContextOpening,
  type ReaderSource,
} from "../src/lib/reader-evidence";
import { composedSummaryArtifact, deliveredSummary } from "../src/lib/reader-summary";
import { db, heading, main, row, say } from "./lib/db.ts";

/** The boundary that refuses a stored line, named rather than counted. */
function refusalOf(line: string): string | null {
  if (!admissibleReaderSentence(line)) return "sentence admissibility";
  if (editorialNoise(line)) return "publisher furniture";
  if (unresolvedContextOpening(line)) return "unresolved context opening";
  return null;
}

type Brief = {
  eventId: string;
  title: string;
  whatHappened: string | null;
  beforeState: string | null;
  afterState: string | null;
  sourceCount: number;
  sources: ReaderSource[];
  sourceKinds: string[];
  publishedAt: string | null;
};

async function loadMatches(userId: string): Promise<MatchRow[]> {
  const { data, error } = await db()
    .from("user_events")
    .select(
      "event_id, relevance, matched_at, delivered_revision, events ( title, first_seen_at, material_occurrence_at, material_revision, importance, novelty )",
    )
    .eq("user_id", userId)
    .is("briefed_at", null)
    .is("expired_at", null)
    .order("relevance", { ascending: false });
  if (error) throw new Error(`reading user_events: ${error.message}`);
  return (data ?? []).map((r) => {
    const event = r.events as {
      title?: string;
      first_seen_at?: string;
      material_occurrence_at?: string | null;
      material_revision?: number;
      importance?: number;
      novelty?: number;
    } | null;
    return {
      eventId: r.event_id,
      relevance: r.relevance,
      matchedAt: r.matched_at,
      eventAt: event?.material_occurrence_at ?? event?.first_seen_at ?? null,
      importance: event?.importance ?? 0,
      novelty: event?.novelty ?? 0,
      materialRevision: event?.material_revision ?? 0,
      deliveredRevision: r.delivered_revision ?? 0,
      matchedTitle: event?.title ?? "",
    };
  });
}

async function alreadyBriefed(userId: string): Promise<Map<string, number>> {
  const { data, error } = await db()
    .from("digests")
    .select("digest_id")
    .eq("user_id", userId)
    .in("status", ["ready", "sent", "generating"]);
  if (error) throw new Error(`reading prior digests: ${error.message}`);
  const ids = (data ?? []).map((d) => d.digest_id);
  const found = new Map<string, number>();
  if (ids.length === 0) return found;
  const { data: items, error: itemError } = await db()
    .from("digest_items")
    .select("event_id, delivered_revision")
    .in("digest_id", ids);
  if (itemError) throw new Error(`reading prior digest_items: ${itemError.message}`);
  for (const item of items ?? []) {
    found.set(item.event_id, Math.max(found.get(item.event_id) ?? 0, item.delivered_revision ?? 0));
  }
  return found;
}

/** `deliveredTwinTitles`, digest.ts 1174 — titles this reader was sent in 48h. */
async function deliveredTwinTitles(
  userId: string,
): Promise<{ title: string; whatHappened: string | null }[]> {
  const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const { data, error } = await db()
    .from("digests")
    .select("digest_id")
    .eq("user_id", userId)
    .eq("kind", "briefing")
    .gte("generated_at", since);
  if (error) return [];
  const digestIds = (data ?? []).map((d) => d.digest_id);
  if (digestIds.length === 0) return [];
  const { data: items, error: itemsError } = await db()
    .from("digest_items")
    .select("events ( title, what_happened )")
    .in("digest_id", digestIds);
  if (itemsError) return [];
  return (items ?? []).flatMap((r) => {
    const event = r.events as { title?: string; what_happened?: string | null } | null;
    return event?.title ? [{ title: event.title, whatHappened: event.what_happened ?? null }] : [];
  });
}

/** `loadBriefs`, digest.ts 1434 — the same selects, in the same shape. */
async function loadBriefs(picked: MatchRow[]): Promise<Brief[]> {
  const ids = picked.map((p) => p.eventId);
  const { data, error } = await db()
    .from("events")
    .select(
      "id, title, what_happened, before_state, after_state, importance, novelty, publisher_count, tags, first_seen_at, material_occurrence_at",
    )
    .in("id", ids);
  if (error) throw new Error(`reading events: ${error.message}`);

  const { data: coverage, error: coverageError } = await db()
    .from("articles")
    .select("id, event_id, source_id, title, excerpt, sources ( name, kind )")
    .in("event_id", ids);
  if (coverageError) throw new Error(`reading coverage: ${coverageError.message}`);

  const outlets = new Map<string, Set<string>>();
  const sources = new Map<string, ReaderSource[]>();
  const kinds = new Map<string, Set<string>>();
  for (const article of coverage ?? []) {
    if (!article.event_id) continue;
    const seen = outlets.get(article.event_id) ?? new Set<string>();
    seen.add(article.source_id ?? "unknown");
    outlets.set(article.event_id, seen);

    const kind = (article.sources as { kind?: string } | null)?.kind;
    if (kind) {
      const here = kinds.get(article.event_id) ?? new Set<string>();
      here.add(kind);
      kinds.set(article.event_id, here);
    }

    const list = sources.get(article.event_id) ?? [];
    list.push({
      name: (article.sources as { name?: string } | null)?.name ?? "Unattributed",
      ...(article.title ? { headline: article.title } : {}),
      ...(article.excerpt ? { excerpt: article.excerpt } : {}),
    });
    sources.set(article.event_id, list);
  }

  const byId = new Map((data ?? []).map((e) => [e.id, e] as const));
  return picked.flatMap((p) => {
    const event = byId.get(p.eventId);
    if (!event) return [];
    return [
      {
        eventId: p.eventId,
        title: event.title,
        whatHappened: event.what_happened,
        beforeState: event.before_state,
        afterState: event.after_state,
        sourceCount: event.publisher_count || outlets.get(p.eventId)?.size || 0,
        sources: sources.get(p.eventId) ?? [],
        sourceKinds: [...(kinds.get(p.eventId) ?? [])],
        publishedAt: event.material_occurrence_at ?? event.first_seen_at ?? null,
      },
    ];
  });
}

/**
 * How many of the reader's live matches the pool scan reads.
 *
 * The ranking's own pool is unbounded (a long-silent reader accumulates matches), and
 * `.in("id", …)` puts every id in the URL, so the scan is bounded and says so rather
 * than failing on a long reader or silently truncating one.
 */
const POOL_SCAN = 200;

main(async () => {
  const now = new Date();
  const flag = process.argv.indexOf("--user");
  const flagUser = flag === -1 ? undefined : process.argv[flag + 1];

  const { data: recent, error: recentError } = await db()
    .from("digests")
    .select("user_id,item_count")
    .eq("kind", "briefing")
    .order("scheduled_for", { ascending: false })
    .limit(50);
  if (recentError) throw new Error(recentError.message);
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

  const matches = await loadMatches(userId);
  const already = await alreadyBriefed(userId);
  const ranked = selectItems(matches, already, matches.length, now, "daily");
  const distinct = await suppressDeliveredDuplicates(
    db(),
    userId,
    ranked.map((r) => r.eventId),
    now,
    "briefing",
    new Map(ranked.map((r) => [r.eventId, r.materialRevision] as const)),
  );
  const considered = ranked.filter((r) => distinct.has(r.eventId)).slice(0, cap + 12);
  const loaded = considered.length === 0 ? [] : await loadBriefs(considered);
  const briefs = suppressDeliveredTwins(
    suppressStoryTwins(loaded),
    await deliveredTwinTitles(userId),
  );

  const ready: Brief[] = [];
  const withheld: { title: string; kind: string }[] = [];
  for (const brief of briefs) {
    const verdict = assessReadiness({
      title: brief.title,
      whatHappened: brief.whatHappened,
      sourceCount: brief.sourceCount,
      sources: brief.sources,
      sourceKinds: brief.sourceKinds,
      publishedAt: brief.publishedAt,
    });
    if (verdict.ready) ready.push(brief);
    else withheld.push({ title: brief.title, kind: verdict.kind });
  }
  if (ready.length > cap) ready.splice(cap);

  heading(`Read-only composition diagnostic — reader ${userId.slice(0, 8)} (cap ${cap})`);
  say(
    row(
      "  ",
      `${matches.length} matches → ${ranked.length} eligible → ${distinct.size} distinct → ` +
        `${considered.length} considered → ${loaded.length} loaded → ${briefs.length} after twins`,
      120,
    ),
  );
  say(row("  ", `${ready.length} ship, ${withheld.length} withheld by the readiness gate`, 120));
  say();

  let refused = 0;
  let composed = 0;
  let empty = 0;
  let admissible = 0;
  let index = 0;
  for (const brief of ready) {
    index += 1;
    const line = (brief.whatHappened ?? "").trim();
    const verdict = refusalOf(line);
    say(
      ` ${String(index).padStart(2)}. [${brief.eventId.slice(0, 8)}] ${brief.title.slice(0, 78)}`,
    );
    if (verdict === null && deliveredSummary(line) !== null) {
      admissible += 1;
      say(row("     ", `admitted — the stored line is what the reader sees`, 120));
      say(row("     ", `${line}`, 120));
      say();
      continue;
    }
    if (line === "") empty += 1;
    else refused += 1;
    say(row("     ", `stored line refused: ${verdict ?? "no stored line"}`, 120));
    if (line !== "") say(row("     ", `${line}`, 120));
    const artifact = composedSummaryArtifact({
      title: brief.title,
      sources: brief.sources,
      publishedAt: brief.publishedAt,
      whatHappened: brief.whatHappened,
    });
    if (artifact === null) {
      say(row("     ", `artifact: NOTHING — the item ships with no line`, 120));
    } else {
      composed += 1;
      say(row("     ", `artifact: ${artifact}`, 120));
    }
    say();
  }

  if (withheld.length > 0) {
    heading(`Withheld by the readiness gate (${withheld.length})`);
    for (const entry of withheld) say(row(" ", `[${entry.kind}] ${entry.title.slice(0, 84)}`, 120));
  }

  // The question the checkpoint actually asks: does today's pool exercise the
  // composition path at all? A refused line that the readiness gate withholds is
  // not an item, so only a refused line that ships would store an artifact.
  heading(`Pool scan — the ${Math.min(matches.length, POOL_SCAN)} most relevant live matches`);
  const scanPicked = matches.slice(0, POOL_SCAN);
  const scanBriefs = scanPicked.length === 0 ? [] : await loadBriefs(scanPicked);
  const consideredIds = new Set(considered.map((c) => c.eventId));
  const briefIds = new Set(briefs.map((b) => b.eventId));
  const rankOf = new Map(ranked.map((r, i) => [r.eventId, i + 1] as const));
  let scanRefused = 0;
  let scanEmpty = 0;
  let scanCompose = 0;
  for (const brief of scanBriefs) {
    const line = (brief.whatHappened ?? "").trim();
    // An empty stored line is "no stored line", not a refusal with a class -- the
    // distinction the build makes (`deliveredSummary` refuses both, and composition
    // treats both the same, but a report that calls empty a "sentence" refusal is
    // telling the reader of this report something untrue).
    const refusedHere = line === "" ? null : refusalOf(line);
    if (line === "") scanEmpty += 1;
    if (deliveredSummary(line) === null) {
      if (refusedHere !== null) scanRefused += 1;
      const rank = rankOf.get(brief.eventId);
      const where =
        rank === undefined
          ? "not eligible today"
          : briefIds.has(brief.eventId)
            ? `in the shipping set (rank ${rank})`
            : consideredIds.has(brief.eventId)
              ? `considered, dropped as a twin (rank ${rank})`
              : `beyond the headroom (rank ${rank} of ${considered.length} considered)`;
      const verdict = assessReadiness({
        title: brief.title,
        whatHappened: brief.whatHappened,
        sourceCount: brief.sourceCount,
        sources: brief.sources,
        sourceKinds: brief.sourceKinds,
        publishedAt: brief.publishedAt,
      });
      if (verdict.ready) {
        scanCompose += 1;
        const artifact = composedSummaryArtifact({
          title: brief.title,
          sources: brief.sources,
          publishedAt: brief.publishedAt,
          whatHappened: brief.whatHappened,
        });
        say(
          row(
            " ",
            `[${brief.eventId.slice(0, 8)}] ${refusedHere ?? "no stored line"}, shippable — ${where}`,
            120,
          ),
        );
        say(row(" ", `   stored: ${line.slice(0, 150)}`, 120));
        say(row(" ", `   artifact: ${artifact ?? "NOTHING — would ship with no line"}`, 120));
      } else {
        say(
          row(
            " ",
            `[${brief.eventId.slice(0, 8)}] ${refusedHere ?? "no stored line"}, withheld: ${verdict.kind}`,
            120,
          ),
        );
      }
    }
  }
  say();
  say(row("  ", `items the build would compose for    ${scanRefused + scanEmpty}`, 120));
  say(row("  ", `  refused stored lines               ${scanRefused}`, 120));
  say(row("  ", `  no stored line at all              ${scanEmpty}`, 120));
  say(row("  ", `  shippable, so an artifact is stored ${scanCompose}`, 120));

  heading("Summary — diagnostic, not a build");
  say(row("  ", `shipping items                     ${ready.length}`, 120));
  say(row("  ", `stored line admitted (unchanged)   ${admissible}`, 120));
  say(row("  ", `stored line refused                ${refused}`, 120));
  say(row("  ", `no stored line at all              ${empty}`, 120));
  say(row("  ", `would store a composed artifact    ${composed}`, 120));
  say(row("  ", `would store nothing                ${refused + empty - composed}`, 120));
  say(row("  ", `raw fallbacks                      0 (by construction)`, 120));
});
