import { extractFacts } from "./extract";
import { scoreEventV2 } from "./scoring";
import { STOPWORDS } from "./shortlist";
import {
  hasSourceMetadata,
  metadataOnlyEvidence,
  normalizeSourceText,
  providerFurniture,
} from "./source-text";
import { editorialNoise, selectReaderEvidence } from "../reader-evidence";

export type NewsArticle = {
  id: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
  source_id: string | null;
  url?: string;
};

export type Publisher = { id: string; name: string; homepage: string | null; kind: string };

export function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleWords(title: string): string[] {
  return [
    ...new Set(
      cleanText(title)
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ];
}

export function titleSimilarity(a: string, b: string): number {
  const left = new Set(titleWords(a));
  const right = new Set(titleWords(b));
  const union = new Set([...left, ...right]).size;
  return union ? [...left].filter((word) => right.has(word)).length / union : 0;
}

/**
 * Headline glue: words present in almost every headline, which therefore say
 * nothing about whether two headlines describe the same story.
 *
 * Shared by both predicates below so they cannot drift apart on what counts as
 * evidence and what counts as filler.
 */
const SCAFFOLD = new Set(["a", "an", "the", "to", "of", "in", "on", "for", "and"]);

/** Words that flip a headline's claim. One side alleging and the other denying is
 * two stories, however alike they read. */
const NEGATIONS = new Set(["not", "no", "denies", "denied", "rumor", "rumour"]);

export function sameHeadline(a: string, b: string): boolean {
  const left = titleWords(a);
  const right = titleWords(b);
  if (left.length < 4 || right.length < 4) return false;
  const identity = (words: string[]) =>
    words
      .filter((w) => /\d/.test(w))
      .sort()
      .join("|");
  if (identity(left) !== identity(right)) return false;
  if (
    left.filter((w) => !SCAFFOLD.has(w)).join(" ") !==
    right.filter((w) => !SCAFFOLD.has(w)).join(" ")
  )
    return false;
  if (
    [...left.filter((w) => !right.includes(w)), ...right.filter((w) => !left.includes(w))].some(
      (w) => !SCAFFOLD.has(w),
    )
  )
    return false;
  if (
    left
      .filter((w) => NEGATIONS.has(w))
      .sort()
      .join() !==
    right
      .filter((w) => NEGATIONS.has(w))
      .sort()
      .join()
  )
    return false;
  // Near-identical coverage only; ambiguous paraphrases remain separate events.
  return titleSimilarity(a, b) >= 0.92;
}

/**
 * Headline figures, as strings that compare across formatting.
 *
 * Every run of digits, plus the spelled-out numbers that would otherwise dodge
 * the check: `Two known vulnerabilities` and `One known vulnerability` disagree
 * exactly as `2` and `1` do, and a headline that spells a figure out is otherwise
 * indistinguishable from one that omits it. `192GB` and `192 GB` both yield
 * `192`, which is the whole point of extracting runs from inside a token: feed
 * and wire formats hyphenate and close up numbers differently, and a mismatch
 * there would reject two accounts of the same story over punctuation.
 */
const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  hundred: "100",
  thousand: "1000",
  million: "1000000",
  billion: "1000000000",
};

function figures(words: string[]): Set<string> {
  const out = new Set<string>();
  for (const word of words) {
    const folded = NUMBER_WORDS[word];
    if (folded !== undefined) {
      out.add(folded);
      continue;
    }
    for (const run of word.match(/\d+/g) ?? []) out.add(run);
  }
  return out;
}

/** Capitalised words, lowercased: a headline's proper nouns. */
export function capitalised(title: string): Set<string> {
  return new Set(
    (
      cleanText(title)
        .normalize("NFKC")
        .match(/[\p{Lu}][\p{L}\p{N}]+/gu) ?? []
    ).map((word) => word.toLowerCase()),
  );
}

/**
 * A word that mixes letters and digits, folded to its digits.
 *
 * `192GB` and `192 GB` are one figure written two ways -- feeds close up units,
 * copy desks space them -- and left alone they share nothing, which is how two
 * accounts of one product came out as separate events over a space. Only mixed
 * words are touched: a pure number is already identical on both sides or absent
 * from one, and folding letters out of `gpt` would be nonsense.
 */
const figureKey = (word: string): string =>
  /\p{L}/u.test(word) && /\d/u.test(word) ? (word.match(/\d+/gu) ?? []).join("") : word;

/** How many shared words a paraphrase needs before it is worth believing. */
const MIN_SHARED = 3;

/** Shared words that identify a story -- proper nouns, and anything the stopword
 * lists do not already mark as generic. Four of these stand on their own. */
const MIN_ANCHORS = 4;

/** With only three, the headlines must also read alike: three shared anchors is
 * what two stories about the same company look like, and similarity is what tells
 * whether they are about the same thing. */
const MIN_ANCHORS_WITH_SIMILARITY = 3;
const SIMILARITY_FLOOR = 0.4;

/** Shortest title worth comparing, in words. */
const MIN_WORDS = 5;

/**
 * A headline that stitches several stories into one line: NPR's
 * `Trump weakens fuel efficiency standards. And, Cornell fraternity rape case
 * reopened`, or a `This | That` digest.
 *
 * Such a headline is not the title of one event, so attaching it would hang a
 * multi-story line on a single story's event -- and then render as that event's
 * title if it outranked the alternatives. The shape is a sentence break followed
 * by a conjunction, or a pipe. Deliberately not an em dash: `Google confirms
 * ChromeOS phase out in 2034 -- 10-year support lifetime cut short` is one story
 * with a subordinate clause, and it is a real merge.
 */
const ROUNDUP = /\.\s+(?:and|but|plus|also)\b|\s\|\s/i;

/**
 * Same story, worded differently -- the cross-outlet companion to `sameHeadline`.
 *
 * `sameHeadline` asks whether two outlets printed the *same words*: it is the
 * right test for a wire copy reprinted verbatim, and useless for the thing that
 * actually fragments events, which is two outlets describing one event in their
 * own words. That is why every event in the corpus has a single article and
 * `publisher_count` is 1 for 446 of 446 recent events: the conservative predicate
 * never fires, so corroboration never has anything to corroborate.
 *
 * This is deliberately a different, and deliberately still conservative, test.
 * Four conditions, each rejecting a failure mode measured on the live corpus:
 *
 * **Figures must not conflict.** If either headline names a number, they must
 * share one. `CISA Adds Two Known Exploited Vulnerabilities` and `CISA Adds One`
 * are different advisories; a round-up with no figure and a story with one are
 * usually different stories. A figure only one side has is the single most
 * reliable signal that the two headlines are about different things.
 *
 * **Negation must match**, for the reason `sameHeadline` requires it.
 *
 * **They must share at least three words** beyond scaffolding -- otherwise the
 * two headlines have nothing to talk about.
 *
 * **Those words must identify a story.** Generic words are shared by every
 * headline in a category: `language models`, `supreme court`, `model`, `case`
 * pair off constantly between unrelated stories, which is what the corpus shows
 * when this test is run over a week of it. So a shared word counts only if it is
 * not on the stopword/filler lists, or if both outlets capitalise it -- a
 * capitalised word is a proper noun *here*, a name rather than a category, and
 * that is what lets `World Labs` count even though `world` is filler. Four such
 * anchors are enough on their own; three need the headlines to be broadly alike
 * as well (`titleSimilarity >= 0.4`), because three shared anchors is exactly
 * what two different stories about one company share.
 *
 * What this does NOT establish is editorial independence -- `publisher_count`
 * still decides what the reader is told, and `cluster.ts` only applies this
 * predicate across two *different* publishers, so a templated feed pairing off
 * with itself (`CISA` advisories, arXiv listings, a wire's own rewrites) is out of
 * scope for this function by construction.
 */
export function sameStory(left: string, right: string): boolean {
  const a = titleWords(left);
  const b = titleWords(right);
  if (a.length < MIN_WORDS || b.length < MIN_WORDS) return false;
  if (ROUNDUP.test(cleanText(left)) || ROUNDUP.test(cleanText(right))) return false;

  const figuresA = figures(a);
  const figuresB = figures(b);
  if ((figuresA.size > 0 || figuresB.size > 0) && ![...figuresA].some((f) => figuresB.has(f)))
    return false;

  const negationKey = (words: string[]) =>
    words
      .filter((w) => NEGATIONS.has(w))
      .sort()
      .join("|");
  if (negationKey(a) !== negationKey(b)) return false;

  const contentA = new Set(a.filter((word) => !SCAFFOLD.has(word)).map(figureKey));
  const contentB = new Set(b.filter((word) => !SCAFFOLD.has(word)).map(figureKey));
  const shared = [...contentA].filter((word) => contentB.has(word));
  if (shared.length < MIN_SHARED) return false;

  const capsA = capitalised(left);
  const capsB = capitalised(right);
  const anchors = shared.filter(
    (word) => word.length >= 3 && (!STOPWORDS.has(word) || (capsA.has(word) && capsB.has(word))),
  );
  if (anchors.length >= MIN_ANCHORS) return true;
  return (
    anchors.length >= MIN_ANCHORS_WITH_SIMILARITY &&
    titleSimilarity(left, right) >= SIMILARITY_FLOOR
  );
}

export function publisherKey(article: NewsArticle, sources: Map<string, Publisher>): string {
  return publisherKeyFor(article.source_id, sources, article.url);
}

/**
 * The publisher key for a source row alone.
 *
 * `publisherKey` above with no article in the way, for callers that hold two
 * source ids and only need to know whether they are the same outlet -- notably
 * `cluster.ts`, which will not attach across outlets that share a homepage.
 */
export function publisherKeyFor(
  sourceId: string | null,
  sources: Map<string, Publisher>,
  url?: string,
): string {
  const source = sourceId ? sources.get(sourceId) : undefined;
  try {
    let host = new URL(source?.homepage || url || "").hostname
      .toLowerCase()
      .replace(/^(www\d*|feeds?|rss)\./, "");
    const aliases: Record<string, string> = {
      "bbc.co.uk": "bbc.com",
      "reutersagency.com": "reuters.com",
      "ap.org": "apnews.com",
    };
    for (const publisher of [...sources.values()]) {
      try {
        const parent = new URL(publisher.homepage ?? "").hostname.replace(/^www\./, "");
        if (host.endsWith("." + parent)) host = parent;
      } catch {
        /* Ignore sources without a homepage. */
      }
    }
    host = aliases[host] ?? host;
    if (host) return host;
  } catch {
    /* Missing publisher URL falls back to its curated name. */
  }
  return source?.name.trim().toLowerCase() || sourceId || "unknown";
}

export function finalizeMetadata(
  articles: NewsArticle[],
  sources: Map<string, Publisher>,
  firstSeenAt: string,
  now: Date,
) {
  const groups = new Map<string, NewsArticle>();
  for (const article of articles) {
    const key = publisherKey(article, sources);
    const prior = groups.get(key);
    if (!prior || (article.excerpt?.length ?? 0) > (prior.excerpt?.length ?? 0))
      groups.set(key, article);
  }
  const quality = (article: NewsArticle) => {
    const kind = article.source_id ? sources.get(article.source_id)?.kind : undefined;
    const title = cleanText(article.title);
    const representative =
      articles.reduce((sum, other) => sum + titleSimilarity(title, other.title), 0) /
      articles.length;
    return (
      representative * 3 +
      (kind === "news" || kind === "company_blog" ? 1 : 0) +
      (title.length >= 25 && title.length <= 160 ? 1 : 0) -
      (/\b(?:subscribe|watch live|daily roundup)\b/i.test(title) ? 3 : 0)
    );
  };
  const ranks = new Map([...groups.values()].map((a) => [a.id, quality(a)]));
  const ranked = [...groups.values()].sort(
    (a, b) => (ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0) || a.id.localeCompare(b.id),
  );
  const title = cleanText(ranked[0]?.title ?? "Untitled event");
  const excerpt = ranked
    .map((a) => cleanText(a.excerpt ?? ""))
    .find(
      (text) =>
        text.length >= 40 &&
        !/^(?:subscribe|sign up|enable javascript|access denied)\b/i.test(text),
    );
  const short = excerpt
    ? (excerpt.match(/^.{40,280}?[.!?](?:\s|$)/)?.[0]?.trim() ??
      excerpt.slice(0, 280).replace(/\s+\S*$/, ""))
    : title;
  const representatives = [...groups.values()];
  const text = representatives.map((a) => `${a.title}\n${a.excerpt ?? ""}`).join("\n");
  const score = scoreEventV2(representatives, extractFacts(text, 0), now);
  const age = Math.max(0, (now.getTime() - Date.parse(firstSeenAt)) / 3_600_000);
  const novelty = age < 6 ? 7 : age < 24 ? 5 : age < 72 ? 3 : 1;
  return {
    title,
    what_happened: summaryFor(
      title,
      selectReaderEvidence(
        title,
        ranked.map((a) => ({ excerpt: a.excerpt ?? "" })),
      ).lead?.text ?? short,
    ),
    importance: score.importanceEstimate,
    novelty,
    article_count: articles.length,
    publisher_count: groups.size,
  };
}

/**
 * The event summary every reader-facing consumer reads: the briefing card, the
 * digest, and -- for a story with no extractable evidence -- the article deck.
 *
 * It has to be prose, because everything downstream assumes it is. This value is
 * written straight from a feed's `description` field, and that field is not
 * always an article: it is also where providers put media credits, `git`
 * trailers and release-page label lists. Nothing in the read path used to ask
 * whether it was a sentence, so "Photograph: Alexandra Topping/The Guardian."
 * became the paragraph under a headline.
 *
 * Normalization runs first, at the boundary, for the same reason it does for
 * source excerpts: a `Label:` prefix is not a grammar error, so it passes every
 * later check, and by then the distinction between furniture and a sentence is
 * gone. A candidate that is furniture, bare metadata, an empty container, or the
 * headline said again is refused rather than stored -- and an empty summary is a
 * legitimate outcome, because headline plus sources is a better page than a
 * credit line presented as news.
 */
function summaryFor(title: string, candidate: string): string {
  const normalized = normalizeSourceText(undefined, candidate);
  if (normalized.metadataOnly) return "";
  const text = normalized.text;
  if (metadataOnlyEvidence(text)) return "";
  if (providerFurniture(text) || hasSourceMetadata(text)) return "";
  if (editorialNoise(text)) return "";
  // The headline is already the headline. Storing it here is what made every
  // such story's deck a duplicate of its own title.
  if (cleanText(text).toLowerCase() === cleanText(title).toLowerCase()) return "";
  return text;
}

export function distinctNews<T>(items: readonly T[], title: (item: T) => string): T[] {
  return items.filter(
    (item, index) =>
      !items.slice(0, index).some((earlier) => sameHeadline(title(earlier), title(item))),
  );
}
