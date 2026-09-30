/**
 * One-off: merge the four events that shipped as split stories, without touching
 * a single row of delivered history.
 *
 *   node --env-file=.env ./scripts/tsrun.mjs scripts/merge-splits.ts           # dry run
 *   node --env-file=.env ./scripts/tsrun.mjs scripts/merge-splits.ts --apply
 *
 * Why this exists: `sameStory` (news-signals.ts) lets clustering join outlets
 * that describe one event in their own words, but it only ever looks at articles
 * that are still unclustered. The splits that already shipped are, by
 * definition, already clustered — each into its own event — so the matcher can
 * never reach them, and because attachment requires exactly one matching target,
 * each extra sibling is also a standing obstacle to the coverage that arrives
 * next.
 *
 * The design constraint, and the reason this is a move rather than a merge:
 * `digest_items.event_id` is `on delete cascade`, so deleting a sibling event
 * deletes its item from any briefing that already went out. Delivered history is
 * the reader's record; it does not get rewritten to tidy the event table. So:
 *
 *   - articles move to the canonical event (the one in the delivered briefing),
 *     which is what actually earns the canonical its second publisher;
 *   - the sibling event row stays, empty, with its stored title, summary,
 *     counts and digest items exactly as delivered;
 *   - the sibling's `metadata_dirty` is cleared, because its analysis is
 *     deliberately frozen: there is no coverage left to re-read, and the
 *     attachment trigger just marked work that can never succeed;
 *   - nothing is deleted anywhere.
 *
 * What it deliberately does NOT do: remove a duplicated item from a delivered
 * briefing. Two items about one story in that briefing stay two items — the only
 * way to collapse them would be to delete a digest row, and that is the trade
 * this script exists to refuse.
 *
 * After `--apply`, run analysis for the canonical events so the counts recompute
 * from their new coverage:
 *
 *   npm run pipeline analyse --event <id>
 */

import { db, heading, main, row, say } from "./lib/db.ts";
import { publisherKeyFor, type Publisher } from "@/lib/pipeline/news-signals";

type EventRow = {
  id: string;
  title: string;
  status: string;
  publisher_count: number;
  article_count: number;
  first_seen_at: string;
  metadata_dirty: boolean;
};

type ArticleRow = {
  id: string;
  title: string;
  event_id: string | null;
  source_id: string | null;
  published_at: string | null;
};

/**
 * Canonical first: the event whose id is in the delivered briefing, because that
 * is the row whose `publisher_count` the reader is looking at. Siblings are
 * given as id prefixes and resolved against the corpus, so a typo fails loudly
 * instead of moving articles somewhere unintended.
 */
const GROUPS: { story: string; canonical: string; siblings: string[] }[] = [
  {
    story: "OpenAI launches Dots",
    canonical: "24f88ced-b9ed-4cd0-b755-9f695db6e129",
    // The TechCrunch account of the same launch. The third Dots event in the
    // corpus (xAI-troll commentary) is a different story and is left alone.
    siblings: ["772d9774"],
  },
  {
    story: "AMD acquires World Labs for $8.2B",
    canonical: "6e070ff5-4aed-4fb0-be7e-a8368f1ac316",
    siblings: ["972f616d", "1b40c7f7"],
  },
  {
    story: "AMD Gorgon Halo pricing",
    canonical: "44b39ba9-38f9-4a6d-afc8-a1c8efc62779",
    siblings: ["d80c9d08"],
  },
  {
    story: "OpenAI DevDay 2026",
    canonical: "b5a22575-64fa-4bf3-b7cc-81760ccd5598",
    // The recap and the live blog. The fourth DevDay event — protesters
    // gathering at the conference — is a different story and is left alone.
    siblings: ["ad4765ab", "6caec6f3"],
  },
];

const APPLY = process.argv.includes("--apply");

/**
 * PostgREST answers with at most 1000 rows and no error, so an unpaginated read
 * silently stops there — which is how a canonical event "disappears" from a
 * fourteen-day window that holds more than a thousand events.
 */
const PAGE = 1000;

/** Distinct publishers among a set of articles, as the reader would count them. */
function publishersOf(articles: ArticleRow[], sources: Map<string, Publisher>): number {
  const keys = new Set<string>();
  for (const article of articles) {
    const known = article.source_id !== null && sources.has(article.source_id);
    keys.add(
      known && article.source_id
        ? publisherKeyFor(article.source_id, sources)
        : `?${article.source_id}`,
    );
  }
  return keys.size;
}

main(async () => {
  say(
    APPLY ? "APPLYING — articles move, nothing is deleted." : "DRY RUN — nothing will be written.",
  );

  const since = new Date(Date.now() - 14 * 24 * 3_600_000).toISOString();
  const events: EventRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: eventRows, error: eErr } = await db()
      .from("events")
      .select("id,title,status,publisher_count,article_count,first_seen_at,metadata_dirty")
      .gte("first_seen_at", since)
      .order("id")
      .range(from, from + PAGE - 1);
    if (eErr) throw new Error(eErr.message);
    const batch = (eventRows ?? []) as EventRow[];
    events.push(...batch);
    if (batch.length < PAGE) break;
  }

  const { data: sourceRows, error: sErr } = await db()
    .from("sources")
    .select("id,name,homepage,kind");
  if (sErr) throw new Error(sErr.message);
  const sources = new Map((sourceRows ?? []).map((s) => [s.id, s as Publisher]));

  const byPrefix = (prefix: string): EventRow => {
    const hits = events.filter((e) => e.id.startsWith(prefix));
    if (hits.length !== 1) throw new Error(`prefix ${prefix} matched ${hits.length} events`);
    return hits[0]!;
  };

  const plans: { story: string; canonical: EventRow; siblings: EventRow[] }[] = [];
  for (const group of GROUPS) {
    const canonical = events.find((e) => e.id === group.canonical);
    if (!canonical) throw new Error(`canonical ${group.canonical} not found in the last 14 days`);
    const siblings = group.siblings.map(byPrefix);
    plans.push({ story: group.story, canonical, siblings });
  }

  // Which delivered briefings would render an emptied sibling card. Nothing is
  // removed from them — this is here so the change is visible before it happens.
  const siblingIds = plans.flatMap((p) => p.siblings.map((s) => s.id));
  const { data: items, error: iErr } = await db()
    .from("digest_items")
    .select("event_id,digest_id")
    .in("event_id", siblingIds);
  if (iErr) throw new Error(iErr.message);
  const digestIds = [...new Set((items ?? []).map((i) => i.digest_id))];
  const { data: digests, error: dErr } = await db()
    .from("digests")
    .select("digest_id,kind,status,scheduled_for")
    .in("digest_id", digestIds);
  if (dErr) throw new Error(dErr.message);
  const digestById = new Map((digests ?? []).map((d) => [String(d.digest_id), d]));

  // Matched rows are the other place an emptied sibling stays visible: the home
  // feed and history render from `user_events`, and those cards keep their
  // stored title, summary and source count but lose the coverage list.
  const { data: matches, error: mErr } = await db()
    .from("user_events")
    .select("event_id")
    .in("event_id", siblingIds);
  if (mErr) throw new Error(mErr.message);
  const matchedCount = new Map<string, number>();
  for (const m of matches ?? [])
    matchedCount.set(m.event_id, (matchedCount.get(m.event_id) ?? 0) + 1);

  const moved: { eventId: string; count: number }[] = [];

  for (const plan of plans) {
    const allIds = [plan.canonical.id, ...plan.siblings.map((s) => s.id)];
    const { data: articleRows, error: aErr } = await db()
      .from("articles")
      .select("id,title,event_id,source_id,published_at")
      .in("event_id", allIds);
    if (aErr) throw new Error(aErr.message);
    const articles = (articleRows ?? []) as ArticleRow[];
    const current = (id: string) => articles.filter((a) => a.event_id === id);

    heading(plan.story);
    say(
      row(
        "canonical",
        `${plan.canonical.id.slice(0, 8)} src=${plan.canonical.publisher_count} art=${plan.canonical.article_count} ${plan.canonical.title.slice(0, 58)}`,
        100,
      ),
    );
    const combined = [...current(plan.canonical.id)];
    for (const sibling of plan.siblings) {
      const theirs = current(sibling.id);
      combined.push(...theirs);
      say(
        row(
          "  sibling",
          `${sibling.id.slice(0, 8)} src=${sibling.publisher_count} art=${sibling.article_count} (${theirs.length} live) ${sibling.title.slice(0, 54)}`,
          100,
        ),
      );
      const matched = matchedCount.get(sibling.id) ?? 0;
      if (matched > 0)
        say(
          row(
            "    in feeds",
            `${matched} reader match(es) — card keeps its stored counts, source list empties`,
            100,
          ),
        );
      const inDigests = (items ?? []).filter((i) => i.event_id === sibling.id);
      for (const item of inDigests) {
        const digest = digestById.get(String(item.digest_id));
        say(
          row(
            "    in briefing",
            `${String(item.digest_id).slice(0, 8)} ${digest?.status ?? "?"} ${String(digest?.scheduled_for ?? "").slice(0, 16)} (row kept, card keeps its stored counts)`,
            100,
          ),
        );
      }
    }
    const after = publishersOf(combined, sources);
    say(row("  publishers after", `${plan.canonical.publisher_count} -> ${after}`));
    say(row("  articles after", `${current(plan.canonical.id).length} -> ${combined.length}`));

    if (!APPLY) continue;

    for (const sibling of plan.siblings) {
      const { error } = await db()
        .from("articles")
        .update({ event_id: plan.canonical.id })
        .eq("event_id", sibling.id);
      if (error) throw new Error(`moving articles from ${sibling.id}: ${error.message}`);
      moved.push({ eventId: sibling.id, count: current(sibling.id).length });

      // The attachment trigger marked the emptied sibling as work that can never
      // succeed: its analysis is frozen as delivered, and there is no coverage
      // left to read. Clearing the flag is the point, not a side effect.
      const { error: clearErr } = await db()
        .from("events")
        .update({ metadata_dirty: false })
        .eq("id", sibling.id);
      if (clearErr) throw new Error(`clearing dirty on ${sibling.id}: ${clearErr.message}`);
    }
  }

  if (!APPLY) {
    heading("Next");
    say("Re-run with --apply to move the articles, then analysis per canonical event:");
    for (const plan of plans) say(`  npm run pipeline analyse --event ${plan.canonical.id}`);
    return;
  }

  heading("Moved");
  for (const m of moved) say(row(m.eventId.slice(0, 8), m.count));
  say();
  say("Now recompute counts for each canonical:");
  for (const plan of plans) say(`  npm run pipeline analyse --event ${plan.canonical.id}`);
});
