import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { capitalised, sameHeadline } from "./news-signals";
import { STOPWORDS } from "./shortlist";

type News = { id: string; title: string; first_seen_at: string };

/**
 * Which of these events may be delivered, having already been delivered before.
 *
 * Two rules, and they are about different things:
 *
 *   - **The same event again.** A duplicate unless the event has materially
 *     moved since the revision the reader received. That comparison is only
 *     possible when the caller passes `materialRevisionOf` -- the alert path
 *     does not, because re-entry is a briefing event and not an interruption --
 *     and behaves exactly as the id-only rule did before when it does not.
 *   - **A different event that is the same story.** Unchanged, including the
 *     48-hour window: two outlets, two events, one story.
 *
 * The revision half reads `digest_items.delivered_revision`, so a story the
 * reader received at revision N is still recognised as received after the
 * digest itself has been purged.
 */
export async function suppressDeliveredDuplicates(
  db: SupabaseClient<Database>,
  userId: string,
  ids: string[],
  now: Date,
  kind: "briefing" | "alert",
  materialRevisionOf?: ReadonlyMap<string, number>,
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const since = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const [events, digests] = await Promise.all([
    db.from("events").select("id,title,first_seen_at").in("id", ids),
    db
      .from("digests")
      .select("digest_id")
      .eq("user_id", userId)
      .eq("kind", kind)
      .gte("generated_at", since),
  ]);
  if (events.error || digests.error) throw new Error("Duplicate coverage check unavailable");
  const digestIds = (digests.data ?? []).map((d) => d.digest_id);
  const seen: News[] = [];
  const deliveredRevision = new Map<string, number>();
  if (digestIds.length) {
    const previous = await db
      .from("digest_items")
      .select("event_id, delivered_revision")
      .in("digest_id", digestIds);
    if (previous.error) throw new Error(previous.error.message);
    for (const item of previous.data ?? []) {
      deliveredRevision.set(
        item.event_id,
        Math.max(deliveredRevision.get(item.event_id) ?? 0, item.delivered_revision ?? 0),
      );
    }
    const previousIds = (previous.data ?? []).map((item) => item.event_id);
    if (previousIds.length) {
      const delivered = await db
        .from("events")
        .select("id,title,first_seen_at")
        .in("id", previousIds);
      if (delivered.error) throw new Error(delivered.error.message);
      seen.push(...delivered.data);
    }
  }
  const byId = new Map((events.data ?? []).map((e) => [e.id, e]));
  const keep = new Set<string>();
  for (const id of ids) {
    const e = byId.get(id);
    if (!e) continue;
    const currentRevision = materialRevisionOf?.get(id) ?? 0;
    if (
      seen.some((s) => {
        if (s.id === e.id) {
          // The same event. With no revision information this is the duplicate
          // it always was; with it, the event is a duplicate only while the
          // reader's delivered revision still covers the current one.
          if (materialRevisionOf === undefined) return true;
          return (deliveredRevision.get(s.id) ?? 0) >= currentRevision;
        }
        return (
          Math.abs(Date.parse(s.first_seen_at) - Date.parse(e.first_seen_at)) <= 48 * 3_600_000 &&
          sameHeadline(s.title, e.title)
        );
      })
    )
      continue;
    seen.push(e);
    keep.add(id);
  }
  return keep;
}

/* -------------------------------------------------------------------------- */
/* One story per briefing                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Event markers, grouped by the kind of event they announce, and matched as a
 * group rather than as a word.
 *
 * `ipo`, `prospectus` and `initial public offering` are one event written three
 * ways, and a rule that needed the literal word would miss exactly the pairs it
 * exists for: the Anthropic IPO arrived as five events and no two of their
 * titles shared more than two content words. The group is what makes four
 * phrasings comparable; the title and entity checks below are what keep it from
 * claiming two unrelated stories about the same company.
 *
 * `generic` marks a marker that a hundred different stories about a company can
 * carry — a launch, a breach, a ban. Those need a third shared title word.
 */
const MARKER_GROUPS: readonly { key: string; words: readonly string[]; generic?: boolean }[] = [
  { key: "ipo", words: ["ipo", "prospectus", "public offering", "filing"] },
  {
    key: "arrest",
    words: ["arrest", "arrested", "custody", "detained", "charged", "indictment"],
  },
  { key: "deal", words: ["acquisition", "acquired", "merger", "takeover", "takeovers"] },
  { key: "funding", words: ["funding", "raised", "raises", "valuation"] },
  {
    key: "court",
    words: ["verdict", "sentencing", "guilty", "convicted", "mistrial", "lawsuit"],
  },
  { key: "layoffs", words: ["layoff", "layoffs", "job cuts"] },
  {
    key: "launch",
    words: ["launch", "launched", "unveiled", "debut", "released"],
    generic: true,
  },
  {
    key: "security",
    words: ["breach", "breached", "hacked", "ransomware", "leak", "leaked"],
    generic: true,
  },
  { key: "disruption", words: ["banned", "outage", "recall", "strike"], generic: true },
];

/** Crude, comparison-only stemming: enough that `arrest` meets `arrested`. */
const stem = (word: string): string => {
  if (word.length <= 4) return word;
  if (word.endsWith("ing")) return word.slice(0, -3);
  if (word.endsWith("ed")) return word.slice(0, -2);
  if (word.endsWith("es")) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
};

const contentWords = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
      .map(stem),
  );

const sharedCount = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared;
};

const markersOf = (title: string, summary: string): Set<string> => {
  const text = `${title} ${summary}`.toLowerCase();
  const out = new Set<string>();
  for (const group of MARKER_GROUPS) {
    if (group.words.some((word) => text.includes(word))) out.add(group.key);
  }
  return out;
};

export type TwinBrief = { title: string; whatHappened: string | null };

/**
 * Which of these briefs tell the same story as one kept above them.
 *
 * `sameStory` answers this for *clustering* and refuses the Anthropic IPO family
 * — four outlets, one prospectus, not enough words in common — because a wrong
 * merge there is permanent and visible everywhere. This runs once, at selection,
 * over a list that is about to be printed: dropping a card that turns out to be
 * a cousin costs the reader one duplicate-looking story they would rather not
 * see twice, so it can read the summaries as well as the titles.
 *
 * Three conditions, all of them required:
 *
 *   1. at least two shared content words in the titles,
 *   2. at least one proper noun capitalised on both sides — the entity that
 *      makes "the same story" a claim about the world rather than about words,
 *   3. a shared event marker group, and for a generic marker (a launch, a
 *      breach) a third shared title word on top.
 *
 * Ranked order is preserved and the first telling of a story is the one kept,
 * because the list is ordered by what the reader should read first.
 */
export function suppressStoryTwins<T extends TwinBrief>(briefs: readonly T[]): T[] {
  const shape = briefs.map((brief) => {
    const summary = brief.whatHappened ?? "";
    return {
      title: contentWords(brief.title),
      entities: capitalised(brief.title),
      markers: markersOf(brief.title, summary),
    };
  });
  const generic = new Set(
    MARKER_GROUPS.filter((group) => group.generic === true).map((group) => group.key),
  );

  const kept: T[] = [];
  const keptAt: number[] = [];
  for (let i = 0; i < briefs.length; i += 1) {
    const current = shape[i]!;
    const twin = keptAt.some((j) => {
      const prior = shape[j]!;
      const overlap = sharedCount(current.title, prior.title);
      if (overlap < 2) return false;
      if (sharedCount(current.entities, prior.entities) === 0) return false;
      for (const marker of current.markers) {
        if (!prior.markers.has(marker)) continue;
        if (!generic.has(marker) || overlap >= 3) return true;
      }
      return false;
    });
    if (twin) continue;
    kept.push(briefs[i]!);
    keptAt.push(i);
  }
  return kept;
}
