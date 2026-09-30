/**
 * Merge cross-outlet splits that `sameStory` says are one story.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/merge-story-splits.ts
 *   node --env-file=.env scripts/tsrun.mjs scripts/merge-story-splits.ts --apply
 *   node --env-file=.env scripts/tsrun.mjs scripts/merge-story-splits.ts --hours 72
 *
 * `cluster` only ever revisits *unclustered* articles, so an event pair that was
 * split before the paraphrase predicate existed stays split forever — the second
 * outlet's article is already part of another event. This is the backfill:
 * the same two gates the clusterer applies (`crossOutlet` and `sameStory`),
 * evaluated over events instead of over a queue.
 *
 * It moves articles and nothing else. Sibling event rows stay in place, empty
 * of live articles but still holding their stored title, summary and counts, so
 * no `digest_items` row — a delivered briefing — loses its target:
 * `digest_items.event_id` cascades on delete, and deleting an event would
 * silently rewrite briefings already sent.
 *
 * A component touching a delivered briefing item is merged *into* the delivered
 * event when only one side is delivered, so the card a reader already has gains
 * sources rather than losing them. When both sides are delivered the pair is
 * reported and skipped unless `--force-delivered` is passed: two sent cards
 * cannot be unsent, and quietly emptying one of them is not this script's call.
 *
 * Dry run by default. After `--apply` the canonical events need a pinned
 * `analyse` to recompute `publisher_count`; the script prints the exact
 * commands.
 */

import { publisherKeyFor, sameStory, type Publisher } from "../src/lib/pipeline/news-signals";
import { db, heading, main, row, say } from "./lib/db.ts";

type EventRow = {
  id: string;
  title: string;
  first_seen_at: string;
  publisher_count: number;
  article_count: number;
};

type ArticleRow = { id: string; event_id: string | null; source_id: string | null };

const argValue = (flag: string, fallback: number): number => {
  const index = process.argv.indexOf(flag);
  const raw = index === -1 ? undefined : process.argv[index + 1];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

main(async () => {
  const apply = process.argv.includes("--apply");
  const forceDelivered = process.argv.includes("--force-delivered");
  const hours = argValue("--hours", 48);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  heading(`Merge story splits (last ${hours}h)${apply ? "" : " — dry run"}`);

  // Events in the window, paginated: PostgREST caps a read at 1000 rows and
  // says nothing when it truncates.
  const events: EventRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("events")
      .select("id,title,first_seen_at,publisher_count,article_count")
      .gte("first_seen_at", since)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as EventRow[];
    events.push(...batch);
    if (batch.length < 1000) break;
  }
  const eventIds = new Set(events.map((e) => e.id));
  say(row("  ", `${events.length} events in window`, 110));

  const { data: srcRows, error: sErr } = await db().from("sources").select("id,name,homepage,kind");
  if (sErr) throw new Error(sErr.message);
  const publishers = new Map<string, Publisher>((srcRows ?? []).map((s) => [s.id, s as Publisher]));

  // Articles for exactly these events, in slices small enough to stay a GET.
  const ids = events.map((e) => e.id);
  const articles: ArticleRow[] = [];
  for (let from = 0; from < ids.length; from += 100) {
    const { data, error } = await db()
      .from("articles")
      .select("id,event_id,source_id")
      .in("event_id", ids.slice(from, from + 100));
    if (error) throw new Error(error.message);
    articles.push(...((data ?? []) as ArticleRow[]));
  }
  say(row("  ", `${articles.length} articles across them`, 110));

  const sourceIdsOf = new Map<string, Set<string>>();
  const withArticles = new Set<string>();
  for (const article of articles) {
    if (article.event_id) withArticles.add(article.event_id);
    if (!article.event_id || !article.source_id) continue;
    const seen = sourceIdsOf.get(article.event_id) ?? new Set<string>();
    seen.add(article.source_id);
    sourceIdsOf.set(article.event_id, seen);
  }

  const publisherOf = (sourceId: string): string | null =>
    publishers.has(sourceId) ? publisherKeyFor(sourceId, publishers) : null;

  /** Both sides carry coverage, and not from the same outlet — cluster.ts's rule. */
  const crossOutlet = (left: string, right: string): boolean => {
    const a = [...(sourceIdsOf.get(left) ?? [])]
      .map(publisherOf)
      .filter((p): p is string => p !== null);
    const b = [...(sourceIdsOf.get(right) ?? [])]
      .map(publisherOf)
      .filter((p): p is string => p !== null);
    if (a.length === 0 || b.length === 0) return false;
    return a.some((p) => !b.includes(p)) && b.some((p) => !a.includes(p));
  };

  // Union-find, because one story can arrive as a chain: A~B and B~C with A and
  // C never directly matching (the Madrid eviction had three).
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    if (root !== id) {
      root = find(root);
      parent.set(id, root);
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const byId = new Map(events.map((e) => [e.id, e]));
  const accepted: [EventRow, EventRow][] = [];
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (!a) continue;
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      if (!b) continue;
      if (!crossOutlet(a.id, b.id)) continue;
      if (!sameStory(a.title, b.title)) continue;
      accepted.push([a, b]);
      union(a.id, b.id);
    }
  }

  // An event with no live article is a ghost: it has a stored title and summary
  // but no reporting behind it, so its story page would open with no sources. A
  // non-briefed match on one keeps selecting it — beside the event that inherited
  // its articles — so those matches expire here. Matches already briefed are left
  // alone: history is history.
  const expireGhosts = async (extra: Iterable<string>): Promise<number> => {
    const empty = new Set<string>(extra);
    for (const id of eventIds) if (!withArticles.has(id)) empty.add(id);
    let expired = 0;
    for (const id of empty) {
      const { data: open, error } = await db()
        .from("user_events")
        .select("event_id")
        .eq("event_id", id)
        .is("briefed_at", null);
      if (error) throw new Error(`reading matches for ${id}: ${error.message}`);
      if (!open || open.length === 0) continue;
      const { error: expireErr } = await db()
        .from("user_events")
        .update({ expired_at: new Date().toISOString() })
        .eq("event_id", id)
        .is("briefed_at", null);
      if (expireErr) throw new Error(`expiring matches for ${id}: ${expireErr.message}`);
      expired += open.length;
    }
    return expired;
  };

  if (accepted.length === 0) {
    say(row("  ", "no cross-outlet splits to merge", 110));
    if (apply) {
      const expired = await expireGhosts([]);
      say(row("  ", `${expired} stale match(es) on empty events expired`, 110));
    }
    return;
  }

  const components = new Map<string, string[]>();
  for (const [a, b] of accepted) {
    const root = find(a.id);
    const members = components.get(root) ?? [];
    if (!members.includes(a.id)) members.push(a.id);
    if (!members.includes(b.id)) members.push(b.id);
    components.set(root, members);
  }

  // Delivered history, so a card a reader already has is never the one emptied.
  const { data: digests, error: dErr } = await db()
    .from("digests")
    .select("digest_id")
    .in("kind", ["briefing", "alert"]);
  if (dErr) throw new Error(dErr.message);
  const digestIds = (digests ?? []).map((d) => d.digest_id);
  const deliveredTo = new Map<string, number>();
  for (let from = 0; from < digestIds.length; from += 400) {
    const { data, error } = await db()
      .from("digest_items")
      .select("digest_id,event_id")
      .in("digest_id", digestIds.slice(from, from + 400));
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      if (!item.event_id) continue;
      deliveredTo.set(item.event_id, (deliveredTo.get(item.event_id) ?? 0) + 1);
    }
  }

  // Reader matches, so a card someone already follows is the one that keeps its
  // articles: an event emptied of coverage renders a story page with no sources.
  const readerMatches = new Map<string, number>();
  for (let from = 0; from < ids.length; from += 100) {
    const { data, error } = await db()
      .from("user_events")
      .select("event_id,user_id,relevance,matched_at,briefed_at")
      .in("event_id", ids.slice(from, from + 100));
    if (error) throw new Error(error.message);
    for (const match of data ?? []) {
      if (!match.event_id) continue;
      readerMatches.set(match.event_id, (readerMatches.get(match.event_id) ?? 0) + 1);
    }
  }

  heading(`Components (${components.size})`);
  const moves: { from: string; to: string }[] = [];
  const skipped: string[] = [];
  const canonicals = new Set<string>();

  for (const members of components.values()) {
    const group = members.map((id) => byId.get(id)).filter((e): e is EventRow => e !== undefined);
    if (group.length < 2) continue;

    const delivered = group.filter((e) => (deliveredTo.get(e.id) ?? 0) > 0);
    const read = group.filter((e) => (readerMatches.get(e.id) ?? 0) > 0);
    let canonical: EventRow;
    if (delivered.length === 1 && delivered[0]) {
      canonical = delivered[0];
    } else if (delivered.length > 1) {
      if (!forceDelivered) {
        skipped.push(
          `both sides delivered: ${group.map((e) => `${e.id.slice(0, 8)} "${e.title.slice(0, 44)}"`).join("  |  ")}`,
        );
        continue;
      }
      canonical = [...group].sort((a, b) => b.article_count - a.article_count)[0]!;
    } else if (read.length === 1 && read[0]) {
      // The side a reader already points at keeps the articles; moving matches
      // is riskier than choosing the target that needs none.
      canonical = read[0];
    } else {
      canonical = [...group].sort((a, b) => b.article_count - a.article_count)[0]!;
    }

    say(
      row(
        " ",
        `${canonical.id.slice(0, 8)} ← ${group.length - 1} sibling(s)  ${canonical.title.slice(0, 64)}`,
        110,
      ),
    );
    for (const member of group) {
      if (member.id === canonical.id) continue;
      say(
        row(
          "  ",
          `drop ${member.id.slice(0, 8)} (${member.article_count} art, ${deliveredTo.get(member.id) ?? 0} delivered, ${readerMatches.get(member.id) ?? 0} readers) ${member.title.slice(0, 56)}`,
          110,
        ),
      );
      moves.push({ from: member.id, to: canonical.id });
    }
    canonicals.add(canonical.id);
  }

  say();
  say(row("  ", `${moves.length} siblings to empty into ${canonicals.size} canonical events`, 110));
  for (const line of skipped) say(row("  SKIP ", line, 130));

  if (!apply) {
    say();
    say(row("  ", "dry run — pass --apply to move the articles", 110));
    return;
  }

  const movedIds = new Set(moves.map((m) => m.from));
  const articleIds = articles.filter((a) => a.event_id && movedIds.has(a.event_id));
  say();
  say(row("  ", `moving ${articleIds.length} articles`, 110));
  for (const move of moves) {
    const idsForEvent = articleIds.filter((a) => a.event_id === move.from).map((a) => a.id);
    if (idsForEvent.length === 0) continue;
    const { error } = await db()
      .from("articles")
      .update({ event_id: move.to })
      .in("id", idsForEvent);
    if (error) throw new Error(`moving ${move.from}: ${error.message}`);
  }

  // Reader matches follow the story. The one case that cannot move is a reader
  // who already matched the canonical event: (user_id, event_id) is the primary
  // key, and their existing match is the better one anyway.
  let movedReaders = 0;
  let keptReaders = 0;
  for (const move of moves) {
    const { data: matches, error: matchErr } = await db()
      .from("user_events")
      .select("user_id")
      .eq("event_id", move.from);
    if (matchErr) throw new Error(`reading matches for ${move.from}: ${matchErr.message}`);
    for (const match of matches ?? []) {
      if (!match.user_id) continue;
      const { data: clash } = await db()
        .from("user_events")
        .select("event_id")
        .eq("event_id", move.to)
        .eq("user_id", match.user_id)
        .maybeSingle();
      if (clash) {
        keptReaders += 1;
        continue;
      }
      const { error: moveErr } = await db()
        .from("user_events")
        .update({ event_id: move.to })
        .eq("event_id", move.from)
        .eq("user_id", match.user_id);
      if (moveErr) throw new Error(`moving match ${match.user_id}: ${moveErr.message}`);
      movedReaders += 1;
    }
  }
  say(row("  ", `reader matches: ${movedReaders} moved, ${keptReaders} kept`, 110));

  // Siblings keep their stored analysis — a delivered card still needs a title
  // and a summary — but must not be re-analysed as if they still had coverage.
  const { error: clearErr } = await db()
    .from("events")
    .update({ metadata_dirty: false })
    .in("id", [...movedIds]);
  if (clearErr) throw new Error(clearErr.message);

  const expired = await expireGhosts(movedIds);
  say(row("  ", `${expired} stale match(es) on empty events expired`, 110));

  heading("Run these to recompute publisher_count");
  for (const id of canonicals) say(row("  ", `npm run pipeline analyse --event ${id}`, 110));
});
