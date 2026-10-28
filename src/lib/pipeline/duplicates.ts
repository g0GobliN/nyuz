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
const MARKER_GROUPS: readonly {
  key: string;
  words: readonly string[];
  generic?: boolean;
  /** Only a hit in the headline counts (see `security-access` below). */
  titleOnly?: boolean;
}[] = [
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
    /**
     * The break-in vocabulary ruling #18 (2026-10-20) added, as its own marker.
     *
     * The measured duplicate is the delivered 2026-10-19 pair — Tom's Hardware's
     * "A Chinese hacker used AI agents to break into more than 100 company
     * websites" and The Verge's "A hacker broke into John Deere and SharkNinja
     * with an army of AI agents". Neither title carried a word from `security`,
     * so the overlap test below was never reached. This group is the
     * **delivery pass's** vocabulary only: `news-signals.ts` keeps the narrower
     * clustering class, because a wrong merge is permanent and visible on every
     * surface while a suppressed card is one story the reader does not see
     * twice.
     *
     * `titleOnly` is the constraint the corpus measured: the pair carries
     * `hacker` / `broke into` in **both headlines**, and a summary-only hit is a
     * weaker signal. The arrest of a ShinyHunters member and the FBI's message
     * to the same group share the entity and three content words, and only a
     * summary on one side mentions a break-in — counting that would suppress a
     * distinct story, which is exactly the cost the ruling weighs.
     */
    key: "security-access",
    words: ["hack", "hacker", "hacking", "break in", "break into", "broke into"],
    generic: true,
    titleOnly: true,
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

/**
 * The title as one lowercased string, possessive-stripped and space-padded.
 *
 * This is where a name meets a Title Case headline (see the leg in `areTwins`):
 * `namePairs` cannot read names out of a Title Case title, but that same title
 * can still be searched for the name the *other* card proves. The padding makes
 * the boundaries part of the match, so `ai` cannot meet `said`, and `jensen
 * huang` cannot meet the tail of a longer word.
 */
const nameFlat = (title: string): string => {
  const tokens = (title.normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019]*/gu) ?? []).map(
    (word) => word.replace(/['\u2019]s$/u, "").toLowerCase(),
  );
  return ` ${tokens.join(" ")} `;
};

/**
 * The disclosure vocabulary (B-05, 2026-10-23): words that say an incident *is* a
 * published vulnerability, rather than a story that happens to mention one.
 *
 * Bounded, so `debug` and `dispatch` cannot meet `bug`, and `cve-2026` is the
 * identifier form a disclosure writes. Read from the title *and* the summary,
 * because the measured pairs split the vocabulary across them: one card says
 * "Security Release" in its headline and "the vulnerabilities" in its summary,
 * the other says nothing in the headline and "critical vulnerabilities" in its
 * summary.
 */
const DISCLOSURE = /\b(?:vulnerabilit(?:y|ies)|flaws?|bugs?|security release|cve-\d{4})\b/iu;

/**
 * The kind of event a card names (B-05, 2026-10-23): a thing that happens once,
 * on a date, with coverage that arrives in several shapes — a round-up, a report
 * from the room, a preview.
 *
 * This is deliberately not a marker group: a marker group fuses on its own, and
 * `keynote` alone fused a GTC liveblog with an unrelated summit liveblog (both
 * headline "Live Updates"). It only ever counts *together* with a shared name.
 */
const EVENT_NOUN =
  /\b(?:keynote|conference|summit|unveil(?:s|ed)?|launch(?:es|ed)?|debuts?|introduc(?:es|ed))\b/iu;

/**
 * A headline that announces the *next* turn of a saga (B-05, 2026-10-23).
 *
 * The disclosure leg's job is one story told twice; its failure mode is the
 * follow-up. Measured in the stored corpus, the PHP2Shell release has a second
 * day: "URGENT - PHP Warns of **Another** Unpatched RCE **Two Days After**
 * Emergency PHP2Shell Patches" against "PHP2Shell: Two Unpatched Critical PHP
 * RCE Flaws (CVSS 9.2) Trigger Emergency Security Alert". Same subject, same
 * disclosure vocabulary, same PRIMARY — and a genuinely different development,
 * which the task's third condition says is two cards.
 *
 * Read off the **headline only**. A summary says "two days after" while
 * restating the original event all the time; a headline that says it is making
 * the progression the claim. Keeping the guard on the headline is also what
 * leaves the two audited pairs alone: neither "PHP blames supply chain security
 * biz Chainguard…" nor "World leaders warn of security flaws found in PHP…"
 * carries a progression word.
 */
const PROGRESSION =
  /\b(?:another|again|second|third|follow[- ]?up|surges?|surged|resumes?|after|later|next|imminent)\b/iu;

const markersOf = (title: string, summary: string, options: TwinOptions = {}): Set<string> => {
  const titleText = title.toLowerCase();
  const text = `${title} ${summary}`.toLowerCase();
  const out = new Set<string>();
  for (const group of MARKER_GROUPS) {
    // The census's "before" column runs the pass without ruling #18's group.
    if (options.securityAccess === false && group.key === "security-access") continue;
    const haystack = group.titleOnly === true ? titleText : text;
    if (group.words.some((word) => haystack.includes(word))) out.add(group.key);
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
  /** Words that announce a financial result ("beat", "expectations", "guidance"). */
  resultFrames: Set<string>;
  /** Words that name a financial result ("revenue", "earnings", "q3"). */
  resultTerms: Set<string>;
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
  /** The same title, lowercased and possessive-stripped, padded — see `nameFlat`. */
  flat: string;
  /** Whether either side names the incident a disclosure (B-05). */
  disclosure: boolean;
  /** Whether either side names the kind of event it is (B-05). */
  event: boolean;
  /** Whether either headline announces the next turn of a saga (B-05). */
  progression: boolean;
  /** Title and summary as written, so a name can be read as a proper noun. */
  raw: string;
};

/**
 * Whether `name` (lowercased) is written as a proper noun somewhere in `text`.
 *
 * The disclosure leg needs this because PRIMARY is not always an actor: the
 * entity ranker also promotes concept words, and `bug fixes` is PRIMARY on every
 * patch note in the corpus. Measured 2026-10-23, the leg without this test fused
 * 358 pairs over 30 days and 313 of them fail ruling #18's floor — one release
 * note against an unrelated vendor's flaw, joined by `bug fixes` or `security`.
 * A named subject is written the way a name is written: `PHP` in "PHP Security
 * Release" and in "PHP: The three letters…", `Jensen Huang` in both keynote
 * cards. A concept word is not, so it never satisfies this and never fuses.
 */
const properIn = (text: string, name: string): boolean => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
  for (const match of text.matchAll(pattern)) {
    const word = match[0];
    if (word !== word.toLowerCase()) return true;
  }
  return false;
};

/** Whether both briefs name this PRIMARY as a proper noun. */
const sharesProperName = (a: Shape, b: Shape): boolean => {
  for (const name of a.primary) {
    if (!b.primary.has(name)) continue;
    if (properIn(a.raw, name) && properIn(b.raw, name)) return true;
  }
  return false;
};

/**
 * Ruling #18's vocabulary, as a switch for the **census only**.
 *
 * The ruling widened the delivery pass's marker vocabulary and put a floor on
 * what the widening may suppress. Measuring that needs the counterfactual — what
 * the same corpus would have fused *before* the widening — and the honest way to
 * get it is the same function under the old vocabulary rather than a second
 * implementation of the comparison in the instrument. Production callers pass
 * nothing and get the widened pass (see `suppressStoryTwins`'s signature); the
 * census in `scripts/twin-corpus-census.ts` passes `false` for the "before"
 * column, exactly as `audit:delivered-line` prints its pre-ruling counts.
 */
export type TwinOptions = {
  securityAccess?: boolean;
  /** The result leg (2026-10-21), as a switch for the census's "before" column. */
  resultFrames?: boolean;
  /**
   * B-05's two legs (2026-10-23) — the disclosure leg and the name a Title Case
   * headline cannot contribute — as the same kind of switch, so the census can
   * print what the corpus looked like before them.
   */
  b05Rules?: boolean;
};

/**
 * Whether the two cards carry the same name, in the same order — allowing the
 * side whose headline is sentence case to prove it and the Title Case side to
 * confirm the words sit next to each other (see the leg in `areTwins`).
 */
const sharesName = (a: Shape, b: Shape): boolean => {
  for (const name of a.names) if (b.names.has(name) || b.flat.includes(` ${name} `)) return true;
  for (const name of b.names) if (a.flat.includes(` ${name} `)) return true;
  return false;
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
function areTwins(a: Shape, b: Shape, options: TwinOptions = {}): boolean {
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
  // One side proving the name is enough — when the two cards also name the kind of
  // event (B-05, 2026-10-23).
  //
  // `namePairs` refuses a Title Case headline on purpose — when most words are
  // capitalised, capitalisation no longer says which word is a name. But refusing
  // to *read* a name there is not the same as refusing the other card's proof of
  // it: the sentence-case side still names the product or the person, and the
  // Title Case side can be asked whether those words sit next to each other in it.
  // That is the delivered 2026-10-21 pair, cards #04 and #07 — "GTC Berlin 2026:
  // Live Updates From NVIDIA CEO Jensen Huang's Keynote" (Title Case, so it
  // contributed no names at all) against "Jensen Huang sends in the robot ducks…"
  // (sentence case, so it proves `jensen huang`) — and the pass kept both.
  //
  // The event word is the second half, and it is what keeps this from fusing two
  // announcements of one product: a shared name alone is not one story. The corpus
  // holds the counter-example the suite already pins — "Nvidia debuts $4,999 DGX
  // Spark with half the RAM and storage" against "NVIDIA DGX Spark 64GB Gives
  // Developers More Ways to Build and Scale Local AI" — two SKUs, two
  // announcements, one product name. Only one of those cards names a kind of event
  // ("debuts"), so the pair survives. A keynote round-up and a keynote report name
  // it on both sides.
  //
  // Two Title Case headlines contribute no names at all, so there is nothing to
  // look up and the leg cannot fire: a GTC liveblog and a summit liveblog stay two
  // cards even though both say "Live Updates" and both mention a keynote.
  if (options.b05Rules !== false && a.event && b.event && sharesName(a, b)) return true;
  // Two accounts of one financial result (2026-10-21): the same PRIMARY actor,
  // one side framing the result and the other naming it. Read before the word
  // tests because the measured pair shares one content word, and it needs no
  // marker because the frame/term split *is* the event.
  if (resultLeg(a, b)) return true;
  // The same disclosure about the same subject (B-05, 2026-10-23).
  //
  // The delivered 2026-10-21 and 2026-10-22 briefings each carried one PHP
  // security release twice, four cards over two editions, each card its own
  // `events` row with one stored article:
  //
  //   - "Today's PHP Security Release, and How We're Strengthening PHP Security"
  //     against "PHP: The three letters that shut down sites all over the
  //     internet today";
  //   - "PHP blames supply chain security biz Chainguard for putting huge chunks
  //     of the web at risk" against "World leaders warn of security flaws found
  //     in PHP programming language".
  //
  // No marker group held the words that make them comparable (`release` is a
  // stopword, so "security release" announced nothing, and `security` holds
  // break-in words), and the overlap is two and three content words. What both
  // pairs do share is the **subject** — `PHP`, as the PRIMARY entity on both
  // sides — plus both accounts calling the incident a vulnerability, a flaw, a
  // bug or a security release.
  //
  // PRIMARY is what makes this safe. The loose version, a "vulnerability"
  // marker group on the word tests, measured 507 newly fused pairs over 30 days
  // and fused "Critical GitLab Flaw (CVSS 10.0)…" with "Critical FortiSIEM Flaw
  // Gets Public Exploit PoC…" — two different products' disclosures joined by the
  // noun `critical` and the noun `flaw`. Two vendors' flaws share the vocabulary
  // and not the subject; two accounts of one release share both.
  //
  // `progression` is the other boundary: a headline that says "another" or "two
  // days after" is the next development, not a retelling — see `PROGRESSION`.
  if (
    options.b05Rules !== false &&
    a.disclosure &&
    b.disclosure &&
    !a.progression &&
    !b.progression
  ) {
    if (sharesProperName(a, b)) return true;
  }
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

/**
 * A financial result, written two ways.
 *
 * The delivered 2026-10-20 briefing carried the same SpaceX quarterly release
 * twice, back to back: *"SpaceX's AI business is beating expectations"*
 * (TechCrunch) and *"SpaceX says big AI growth fueled revenue jump"* (The
 * Verge). The pass kept both, and the measurement says why none of its existing
 * legs could see the pair:
 *
 *   - the marker groups hold no financial vocabulary at all, so the marker leg
 *     never fired on either side — and adding a group would not have fused it
 *     either, because `areTwins` requires the *same marker on both sides* and
 *     only the Verge headline says `revenue`;
 *   - the word overlap is one content word (`spacex`; `ai` is below the
 *     three-character floor), against the two the marker leg needs and the three
 *     the floor asks for;
 *   - the two accounts share no figure: one stored line is *"AI was the engine."*
 *
 * So the leg is a **frame and a term**: one account of the release frames it as
 * beating or missing expectations, the other names the number (revenue,
 * earnings, quarterly, Q3). Both sides of the pair must serve a different role,
 * which is what keeps the leg from fusing two stories that merely mention the
 * same company's money: a launch announcement with `revenue` in its summary
 * carries no frame, and a frame with no term has nothing to be the same release
 * as. The actor must be the same PRIMARY entity on both sides, so `SpaceX`
 * paying customers is not `SpaceX` selling rockets.
 */
const RESULT_FRAME =
  /\b(?:beat|beats|beating|missed|misses|missing|topped|topping|exceeded|surpassed|above)\s+(?:expectations|estimates|forecasts|guidance|consensus)\b/iu;
const RESULT_TERM = new Set(
  `revenue revenues earnings income profit profits sales quarter quarters quarterly margin margins results q1 q2 q3 q4`
    .split(/\s+/)
    .filter((word) => word !== ""),
);

/** Lowercased words, unstemmed: the financial vocabulary has to read literally. */
const plainWords = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word !== ""),
  );

const wordsIn = (words: ReadonlySet<string>, vocabulary: ReadonlySet<string>): Set<string> => {
  const out = new Set<string>();
  for (const word of words) if (vocabulary.has(word)) out.add(word);
  return out;
};

/**
 * The result leg: one account frames a result, the other names it, and both are
 * about the same PRIMARY entity.
 *
 * The frame is a **phrase**, not a word: "beating expectations", "topped
 * estimates". A bare `beat` or `misses` is ordinary English in a hundred other
 * headlines (`beat AT&T`, `near-misses with Starlink`, `topping $1B valuation`),
 * and the first draft of this leg measured 78 newly fused pairs of which one was
 * the delivered duplicate and the rest were unrelated stories joined by a verb.
 * With the phrase required, the leg reads what an earnings headline actually
 * says.
 *
 * Exported because the corpus census measures this leg on its own population:
 * the marker-vocabulary switch (`TwinOptions`) cannot express a leg that reads
 * two different vocabularies, and a second implementation in the instrument
 * would drift from this one.
 */
function resultLeg(a: Shape, b: Shape): boolean {
  if (sharedCount(a.primary, b.primary) === 0) return false;
  return (
    (a.resultFrames.size > 0 && b.resultTerms.size > 0) ||
    (b.resultFrames.size > 0 && a.resultTerms.size > 0)
  );
}

/** The result leg over two whole briefs, for the census and for its fixtures. */
export function resultTwin(a: TwinBrief, b: TwinBrief, options: TwinOptions = {}): boolean {
  return resultLeg(shapeOf(a, options), shapeOf(b, options));
}

const shapeOf = (brief: TwinBrief, options: TwinOptions = {}): Shape => {
  const summary = brief.whatHappened ?? "";
  return {
    words: new Set([...contentWords(brief.title), ...contentWords(summary)]),
    entities: capitalised(brief.title),
    markers: markersOf(brief.title, summary, options),
    primary: new Set(
      rankEntities(brief.title, [{ excerpt: summary }])
        .filter((entity) => entity.role === "PRIMARY")
        .map((entity) => entity.name.toLowerCase()),
    ),
    // Both anchors are read off the **headline**, never the summary. Measured on
    // the 30-day corpus (2026-10-21): with the summary allowed, the leg fused the
    // delivered duplicate *and* a merger story whose summary happened to mention
    // revenue; with the headline only, it fuses the duplicate alone. The ruling's
    // cost boundary for the marker vocabulary is the same shape — a summary-only
    // hit is the weaker signal.
    resultFrames:
      options.resultFrames === false
        ? new Set()
        : new Set((brief.title.match(RESULT_FRAME) ?? []).map((phrase) => phrase.toLowerCase())),
    resultTerms:
      options.resultFrames === false ? new Set() : wordsIn(plainWords(brief.title), RESULT_TERM),
    figures: new Set([
      ...numericKeys(`${brief.title} ${summary}`),
      ...magnitudeKeys(`${brief.title} ${summary}`),
    ]),
    names: namePairs(brief.title),
    flat: nameFlat(brief.title),
    disclosure: DISCLOSURE.test(`${brief.title} ${summary}`),
    event: EVENT_NOUN.test(`${brief.title} ${summary}`),
    progression: PROGRESSION.test(brief.title),
    raw: `${brief.title} ${summary}`,
  };
};

export function suppressStoryTwins<T extends TwinBrief>(
  briefs: readonly T[],
  options: TwinOptions = {},
): T[] {
  const shape = briefs.map((brief) => shapeOf(brief, options));
  const kept: T[] = [];
  const keptAt: number[] = [];
  for (let i = 0; i < briefs.length; i += 1) {
    const current = shape[i]!;
    if (keptAt.some((j) => areTwins(current, shape[j]!, options))) continue;
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
