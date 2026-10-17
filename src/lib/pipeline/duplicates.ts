import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { magnitudeKeys, numericKeys, rankEntities } from "@/lib/reader-evidence";
import { capitalised, sameHeadline } from "./news-signals";
import { STOPWORDS, TITLE_CASE_RATIO } from "./shortlist";

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
  {
    key: "disruption",
    words: ["banned", "outage", "recall", "strike"],
    generic: true,
  },
  {
    key: "policy",
    words: [
      "executive order",
      "accord",
      "agreement",
      "pledge",
      "regulation",
      "regulations",
      "rules",
      "policy",
      "summit",
      "signed",
      "signs",
    ],
  },
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

/**
 * The names a title carries: adjacent capitalised content tokens, in order.
 *
 * This is the identity signal the marker groups cannot see. A marker answers
 * *what happened* — an arrest, a launch, a funding round — which is the right
 * question for two accounts of one incident. A product review announces no
 * event at all, and its identity lives in the name instead: "RTX Spark" is
 * written the same way in a benchmark, a week-long diary and a laptop review,
 * so two of the three shared content words were not enough.
 *
 * Adjacency is what makes it a name rather than a coincidence. `RTX` next to
 * `Spark` is a product; `Trump` and `Iran` scattered through a headline are two
 * facts about two actors, and two stories that share them are not one story.
 * Stopwords are excluded so a sentence's furniture cannot form a name, and a
 * Title Case headline contributes nothing: when most words are capitalised,
 * capitalisation no longer says which word is a name.
 *
 * Ruled by the arbiter on 2026-10-17 ([decisions/story-twins.md]) after three
 * reviews of one laptop reached the same briefing as three cards.
 */
function namePairs(title: string): Set<string> {
  const words = title.normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019]*/gu) ?? [];
  const proper = words.filter((word) => /^\p{Lu}/u.test(word)).length;
  if (words.length === 0 || proper / words.length > TITLE_CASE_RATIO) return new Set();
  const names = new Set<string>();
  let previous: string | null = null;
  for (const word of words) {
    const isName = /^\p{Lu}/u.test(word);
    // The possessive is grammar, not part of the name: "Nvidia's RTX Spark"
    // must still meet "RTX Spark" in a headline that has no apostrophe.
    const token = word.replace(/['\u2019]s$/u, "").toLowerCase();
    const usable = isName && token.length >= 2 && !STOPWORDS.has(token);
    if (usable && previous !== null) names.add(`${previous} ${token}`);
    previous = usable ? token : null;
  }
  return names;
}

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
/** The twin shape of one brief: the signals a pair is compared on. */
type Shape = {
  words: Set<string>;
  entities: Set<string>;
  markers: Set<string>;
  /** PRIMARY entity names: the actor a claim is about, not merely a capital. */
  primary: Set<string>;
  /**
   * Figures, so two accounts of one incident can meet without shared words.
   *
   * `numericKeys` **plus** `magnitudeKeys`, which is the identity vocabulary
   * `sameIncident` already uses — a bare "100 million barrels" is an anchor two
   * accounts of one release keep, while it is too weak to be trusted as a
   * *conflict*, so the figure-conflict guard keeps the conservative set.
   *
   * Without the magnitudes this pass could not see the G7 pair at all: both
   * headlines say "100 million" and neither says a currency figure, so the
   * shared-figure test failed and two cards for one oil release reached the
   * reader. Measured over the 30-day evaluation window, `numericKeys` alone left
   * the G7 pair and the "17,000ft"/"64GB" shapes joined by nothing.
   */
  figures: Set<string>;
  /** Adjacent capitalised content pairs in the title — a product or a person. */
  names: Set<string>;
};

/**
 * Whether two briefs tell one story, by exactly the conditions
 * `suppressStoryTwins` documents. Extracted so the delivered-history pass and
 * the in-batch pass cannot drift apart: a pair that is twins inside one briefing
 * must be twins across two days too, or the reader who got the first telling
 * yesterday receives the second today anyway.
 *
 * The word overlap reads titles *and* summaries. Titles alone left the 2026-10-01
 * policy triple half-collapsed: "Three takeaways from Trump's 'Super Intelligence'
 * summit" shares one title word with "Trump administration gets Big Tech to sign
 * … AI regulations" but the summaries share six. The marker + entity requirements
 * are what keep the wider net precise — two unrelated stories still need to share
 * the kind of event and the actor, not just filler.
 */
function areTwins(a: Shape, b: Shape): boolean {
  // The shape of one incident: the same actor and the same figure. Two desks
  // describing one arrest share neither wording nor marker -- "accused of
  // shipping" against "arrested for smuggling" -- and the word tests below
  // cannot see them, so the reader got one arrest as three cards. Checked
  // first, because it exists precisely for the pairs the word tests reject.
  // The 48-hour window is the caller's: one morning's list, or the delivered
  // history `suppressDeliveredDuplicates` already bounds.
  if (sharedCount(a.primary, b.primary) > 0 && sharedCount(a.figures, b.figures) > 0) return true;
  // The same name, in the same order, in both titles: a product or a person.
  // Ruled 2026-10-17 — no event marker is required for this pair, because a
  // review announces nothing and its identity is entirely in the name.
  for (const name of a.names) if (b.names.has(name)) return true;
  const overlap = sharedCount(a.words, b.words);
  if (overlap < 2) return false;
  if (sharedCount(a.entities, b.entities) === 0) return false;
  for (const marker of a.markers) {
    if (!b.markers.has(marker)) continue;
    if (!GENERIC_MARKERS.has(marker) || overlap >= 3) return true;
  }
  return false;
}

const GENERIC_MARKERS = new Set(
  MARKER_GROUPS.filter((group) => group.generic === true).map((group) => group.key),
);

const shapeOf = (brief: TwinBrief): Shape => {
  const summary = brief.whatHappened ?? "";
  return {
    words: new Set([...contentWords(brief.title), ...contentWords(summary)]),
    entities: capitalised(brief.title),
    markers: markersOf(brief.title, summary),
    primary: new Set(
      rankEntities(brief.title, [{ excerpt: summary }])
        .filter((entity) => entity.role === "PRIMARY")
        .map((entity) => entity.name.toLowerCase()),
    ),
    figures: new Set([
      ...numericKeys(`${brief.title} ${summary}`),
      ...magnitudeKeys(`${brief.title} ${summary}`),
    ]),
    names: namePairs(brief.title),
  };
};

export function suppressStoryTwins<T extends TwinBrief>(briefs: readonly T[]): T[] {
  const shape = briefs.map(shapeOf);
  const kept: T[] = [];
  const keptAt: number[] = [];
  for (let i = 0; i < briefs.length; i += 1) {
    const current = shape[i]!;
    if (keptAt.some((j) => areTwins(current, shape[j]!))) continue;
    kept.push(briefs[i]!);
    keptAt.push(i);
  }
  return kept;
}

/**
 * Which already-delivered stories make these briefs repeats.
 *
 * `suppressDeliveredDuplicates` catches the same event and near-identical
 * headlines; what it cannot see is yesterday's *different* event about the same
 * story — the corpus split one story across events and the reader already
 * received one of them. This is the same twin test run against the titles the
 * reader has already been sent, so a second telling of a delivered story waits
 * for the next briefing even though it is a fresh event row.
 *
 * Returns the surviving subset of `briefs`, ranked order preserved.
 */
export function suppressDeliveredTwins<T extends TwinBrief & { eventId: string }>(
  briefs: readonly T[],
  delivered: readonly { title: string; whatHappened?: string | null }[],
): T[] {
  if (delivered.length === 0) return [...briefs];
  const seen = delivered.map((row) =>
    shapeOf({ title: row.title, whatHappened: row.whatHappened ?? "" }),
  );
  return briefs.filter((brief) => {
    const shape = shapeOf(brief);
    return !seen.some((prior) => areTwins(shape, prior));
  });
}
