import type { Story } from "@/lib/story";

/**
 * What the offline archive keeps, and what it deliberately throws away.
 *
 * ---------------------------------------------------------------------------
 * Why not the service worker's cache
 * ---------------------------------------------------------------------------
 *
 * The obvious implementation is to let `public/sw.js` cache the server-function
 * responses. It cannot: `loadStory` is a POST whose payload is in the body, and
 * the Cache API has no way to hold a POST response. The others are GETs, but
 * their bodies are per-account while any HTTP cache is shared by every account
 * on the device — one reader's briefing served to the next person to open the
 * app is not a tolerable bug. So the archive is explicit: written by the app,
 * keyed by account, cleared on sign-out and on account switch.
 *
 * ---------------------------------------------------------------------------
 * Two kinds of record, and the difference is on purpose
 * ---------------------------------------------------------------------------
 *
 * A **list** row is enough to open the app offline and read the cards. It is
 * slimmed on the way in (`slimListPayload`): the shared analysis and the
 * per-article evidence are dropped, because a card does not render them and they
 * are the overwhelming majority of the bytes. A briefing list is not a reading
 * payload, and caching one as if it were is how an offline feature turns into a
 * full copy of the archive on every device.
 *
 * A **story** row is the whole story as the story page renders it, and exists
 * only for stories the reader opened or deliberately saved. Opening a card with
 * no story row offline says so rather than rendering half a page.
 *
 * Every function here is pure. The IndexedDB half lives in archive.ts, so keys,
 * caps and pruning can be tested without a database.
 */

/** Bounds, in one place, because these are the only thing between this and a leak. */
export const ARCHIVE_LIMITS = {
  /** Full story payloads kept per account. */
  stories: 40,
  /** List snapshots kept per account: home, saved, and a week of days. */
  lists: 9,
  /** Age at which anything is dropped, whatever the counts say. */
  days: 7,
} as const;

/**
 * One row, whatever it holds.
 *
 * `payload` is `unknown` on purpose: the store is one table with two kinds of
 * value, and pretending otherwise would mean either two stores or a cast per
 * read. Every read goes through a named accessor that knows what it asked for.
 */
export type ArchiveRow = {
  /** `${userId}:${kind}:${id}` — the account is in the key, not beside it. */
  key: string;
  kind: "list" | "story";
  userId: string;
  /** A list key or a story id. */
  id: string;
  savedAt: number;
  payload: unknown;
};

/**
 * The queries worth keeping, addressed by the same key React Query uses.
 *
 * A whitelist rather than a rule, so a query added later does not silently start
 * writing account data to the disk. Anything absent here is never archived.
 */
export function listKeyForQuery(queryKey: readonly unknown[]): string | null {
  const [group, name, variant] = queryKey;
  if (group !== "briefing") return null;
  // `loadHomeFeed`'s key: the whole feed as one entry.
  if (name === "home") return "home";
  // The reader's own shelf. Story rows are warmed from this list.
  if (name === "saved") return "saved";
  // `["briefing", "today", digestId | "latest"]`. Keyed by digest so two days
  // cannot overwrite each other and the newest is what survives the cap.
  if (name === "today") return `today:${typeof variant === "string" ? variant : "latest"}`;
  return null;
}

/** The story id a cache key addresses, or null when it is not a story query. */
export function storyIdForQuery(queryKey: readonly unknown[]): string | null {
  const [group, name, id] = queryKey;
  if (group !== "briefing" || name !== "story") return null;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function archiveRowKey(userId: string, kind: "list" | "story", id: string): string {
  return `${userId}:${kind}:${id}`;
}

/**
 * The card subset, as a structurally valid `Story`.
 *
 * Every required field survives, so this is not a partial object pretending to
 * be a story. What goes is exactly the material only the story page renders —
 * the shared analysis (`understand`), the related-event background, and the
 * per-article excerpts and structured evidence inside `sourceList`. Those are
 * the reading payload.
 *
 * `sourceList` itself stays, reduced to what identifies a source, because it is
 * a required field of the type and the card's source count is built from it.
 */
export function forOfflineList(story: Story): Story {
  return {
    id: story.id,
    org: story.org,
    title: story.title,
    what: story.what,
    why: story.why,
    importance: story.importance,
    score: story.score,
    sources: story.sources,
    topics: story.topics,
    time: story.time,
    publishedAt: story.publishedAt,
    ...(story.updatedAt ? { updatedAt: story.updatedAt } : {}),
    sourceList: story.sourceList.map((source) => ({
      name: source.name,
      at: source.at,
      ...(source.articleId ? { articleId: source.articleId } : {}),
      ...(source.url ? { url: source.url } : {}),
      ...(source.headline ? { headline: source.headline } : {}),
    })),
    before: story.before,
    after: story.after,
    timeline: story.timeline,
    ...(story.personalization ? { personalization: story.personalization } : {}),
    ...(story.matched ? { matched: story.matched } : {}),
  };
}

/** True for a payload shaped like `HomeFeed`, the one list that is not an array. */
export function isFeedPayload(payload: unknown): payload is { stories: Story[] } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { stories?: unknown }).stories)
  );
}

/**
 * The bounded copy of a list payload, whatever shape that list has.
 *
 * `home` is a feed object; the briefing and saved lists are bare arrays. Both are
 * slimmed per story, and anything unrecognised is returned untouched rather than
 * guessed at.
 */
export function slimListPayload<T>(payload: T): T {
  if (isFeedPayload(payload)) {
    return { ...payload, stories: payload.stories.map(forOfflineList) } as T;
  }
  if (Array.isArray(payload)) {
    return payload.map((story) => forOfflineList(story as Story)) as T;
  }
  return payload;
}

/**
 * The rows worth keeping: newest first, capped in both directions.
 *
 * Age and count are separate limits because they fail differently. The count is
 * what stops a reader who opens forty briefings in a day from filling the disk;
 * the age is what stops a reader who opens one a month from reading a
 * two-month-old briefing and believing it is current.
 */
export function pruneRows(rows: ArchiveRow[], now: number): ArchiveRow[] {
  const cutoff = now - ARCHIVE_LIMITS.days * 86_400_000;
  const byNewest = (a: ArchiveRow, b: ArchiveRow) => b.savedAt - a.savedAt;
  const fresh = rows.filter((row) => row.savedAt >= cutoff);

  return [
    ...fresh
      .filter((row) => row.kind === "list")
      .sort(byNewest)
      .slice(0, ARCHIVE_LIMITS.lists),
    ...fresh
      .filter((row) => row.kind === "story")
      .sort(byNewest)
      .slice(0, ARCHIVE_LIMITS.stories),
  ];
}

/** Which row keys a prune would delete, given everything currently stored. */
export function rowKeysToDrop(rows: ArchiveRow[], now: number): string[] {
  const keep = new Set(pruneRows(rows, now).map((row) => row.key));
  return rows.filter((row) => !keep.has(row.key)).map((row) => row.key);
}
