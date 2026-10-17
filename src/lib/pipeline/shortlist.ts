/**
 * Narrowing a thousand articles down to the handful a model needs to look at.
 *
 * This module is the reason stage 3 is affordable. Deciding whether two articles
 * describe the same event is a judgement, and judgement means a model call; asking
 * a model about every pair is quadratic, so a thousand articles would be half a
 * million calls. A shortlist turns that into one call per article over ten
 * candidates, and the shortlist itself is free because Postgres already has an
 * index for it.
 *
 * **The index is `articles_title_trgm_idx`**, declared in `0001_init.sql` as
 * `gin (title gin_trgm_ops)`. A GIN trigram index is what makes `title ilike
 * '%nvidia%'` an index scan rather than a sequential one — that is the whole
 * purpose of `gin_trgm_ops`, and it is why the shortlist can be expressed in
 * PostgREST's own filter language instead of needing a SQL function. Which is
 * fortunate: adding a function would mean DDL, and DDL cannot be applied from a
 * development machine here (see `docs/plan.md`).
 *
 * So the query is a disjunction of `ilike` patterns over the most distinctive
 * words in the headline, bounded by a date window, capped at ten rows. One
 * request, roughly 300ms against the live table.
 *
 * **A headline with no distinctive words costs nothing.** A version tag or a git
 * ref — `v8.2.2`, `viable/strict/1787466473` — yields no usable tokens, so no query
 * is issued and no model is called; the article simply becomes an event of its own.
 * Release feeds and CI notifications therefore pass through the expensive stage for
 * free, which is the right outcome for both the budget and the result.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

/**
 * Ordinary English scaffolding.
 *
 * Written as prose rather than as an array of two hundred quoted strings because
 * prettier formats such an array one word to a line, and a list nobody can read is
 * a list nobody will maintain.
 */
const GRAMMATICAL = `
about after again against along also among another around because been before
being below between both came come could does doing done down during each even
ever every from gets give goes going gone have here into just keep like made make
many more most much must near need next none only onto other over same should
since some still such take than that their them then there these they this those
through time under until upon very want were what when where which while will
with without would your
`;

/**
 * Words too common in a technology headline to narrow anything.
 *
 * This is the half that a general-purpose stopword list would not have, and it is
 * the half that matters: the job is not grammatical, it is to drop words appearing
 * in hundreds of the stored titles, which would return a shortlist of hundreds.
 * `announces`, `launches` and `report` are perfectly meaningful English and
 * completely useless as selectors.
 *
 * Deliberately does NOT include company or product names. `openai` appears in dozens
 * of titles and is still exactly what you want to select on, because it narrows a
 * thousand rows to dozens rather than to hundreds.
 */
const HEADLINE_FILLER = `
announce announced announces announcement available based best beta build builds
built case code coming company data deal debut developer developers everything
feature features first free full future getting help here's how-to industry
inside introducing issue know last latest launch launched launches linux looking
means million model models months news note notes open part plans platform post
power preview price product project read release released releases report
reportedly reports review rumor rumour says series service share source start
starts support team tech test thing things today tool tools update updated
updates used user users using version week weeks work working world year years
`;

export const STOPWORDS: ReadonlySet<string> = new Set(
  `${GRAMMATICAL} ${HEADLINE_FILLER}`.split(/\s+/).filter((word) => word !== ""),
);

/**
 * The shortest token worth searching for, in characters.
 *
 * Three is a hard floor rather than a preference: a trigram index cannot serve a
 * pattern with fewer than three characters between the wildcards, because there is
 * no trigram to look up, and `ilike '%ai%'` would silently degrade to a sequential
 * scan of the whole table. Four is that floor plus a margin, and it also happens to
 * drop most of the short filler a stopword list misses.
 */
const MIN_TOKEN = 4;

/** How many words to select on. */
const MAX_TOKENS = 3;

/**
 * Above this share of capitalised words, capitalisation is treated as meaningless.
 *
 * A sentence-case headline capitalises its proper nouns and nothing else, which is
 * the single best free signal of which word is worth searching for. A Title Case
 * headline capitalises everything and so says nothing at all. Both are common in
 * the corpus, so the signal is used only where it discriminates.
 */
export const TITLE_CASE_RATIO = 0.6;

/**
 * A version-control ref wearing a headline's clothes.
 *
 * `trunk/16ee93b8a9e7e2dd215a2f5d07eada25e31ec123: [vision hash update]` and
 * `viable/strict/1787468606: Revert "Remove caffe2/core/timer.h"` are branch names
 * with a commit subject attached, published by a GitHub feed that returns tags
 * rather than releases. They have whitespace, so the rule above does not catch them,
 * and they tokenise to real-looking words — `trunk`, `revert`, `remove` — which
 * shortlist against each other and cost a model call each.
 *
 * That was measured, not guessed: in a batch of twenty-five real articles, thirteen
 * were refs of this shape and they took most of the token spend, to conclude almost
 * every time that two unrelated commits were unrelated.
 *
 * A ref is `<something>/<something containing a hex run>`, which is specific enough
 * not to catch `AI/ML hiring is booming` and general enough to cover any repository
 * feed pointed at tags. The cost of the rule is that two refs which genuinely are
 * the same commit under two branch names now become two events instead of one —
 * both of which are noise either way.
 *
 * This is a mitigation, not the fix. The fix is that the feed is the wrong URL, and
 * that is recorded in `docs/plan.md` as a source-quality decision for a human.
 */
const VCS_REF = /^[^\s/]+\/\S*\b[0-9a-f]{6,}\b/i;

/**
 * Scripts that do not separate words with spaces.
 *
 * Used for two decisions in this module: whether an unspaced title is a headline
 * (it is) and whether a token should be searched whole or in windows.
 */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Shortest run of an unspaced script worth searching.
 *
 * Two characters, where `MIN_TOKEN` is three. The Latin floor is about
 * informativeness -- a two-letter token like `ai` matches half the corpus -- and
 * it is not a fact about language. In Han, Hangul and kana two characters is
 * already a word: 東京, 韓国, 音楽, 시장. Applying the Latin floor here dropped
 * every two-character Japanese and Korean word, which is most of them, and the
 * result was a shortlist of the longest three or four words in the headline.
 */
const MIN_UNSPACED_TOKEN = 2;

/**
 * Tokens for a run of unspaced characters.
 *
 * The whole run first, because verbatim republication is the common case and one
 * exact pattern matches it -- and it is also the most specific pattern available,
 * since the trigram index is consulted on the pattern rather than the run.
 *
 * Then three-character windows, as many as the run affords: two outlets rarely
 * phrase one story identically, and a window is the shortest span that is likely
 * to survive both rephrasings. A run of exactly three characters already is its
 * own window, and the caller de-duplicates, so nothing is emitted twice.
 */
function cjkTokens(run: string): string[] {
  const chars = [...run];
  if (chars.length < MIN_UNSPACED_TOKEN) return [];

  const tokens = [run];
  for (let i = 0; i + 3 <= chars.length && tokens.length < MAX_TOKENS + 2; i += 1) {
    tokens.push(chars.slice(i, i + 3).join(""));
  }
  return tokens;
}

/**
 * A CI branch tag wearing a headline's clothes.
 *
 * Distinct from a version tag (`v8.2.2`), which is real news from a release feed.
 * Those have no whitespace and cost nothing to cluster; they are still worth
 * storing. This shape is not: it is a commit subject published by a tags feed,
 * and analysing it has already burned a fifth of the analysis bill.
 */
export function isVcsRef(title: string): boolean {
  return VCS_REF.test(title.trim());
}

/**
 * The distinctive words in a headline, most distinctive first.
 *
 * Ranked by two signals, in order.
 *
 * **Capitalisation, where it means something.** In a sentence-case headline the
 * capitalised words are the proper nouns — the companies, products and places — and
 * those are exactly what a shortlist should select on. It is free: the information
 * is in the title already, and only thrown away by lowercasing before ranking. It
 * is also unreliable in one specific way, so `TITLE_CASE_RATIO` turns it off for
 * headlines that capitalise everything.
 *
 * **Then length.** Crude, and it works: in a technology headline the long words are
 * the specifics ("antigravity", "quick-commerce") and the short ones are the
 * scaffolding. It is a poor substitute for counting how rare a word actually is in
 * the stored corpus, which would need a table to hold the counts and is worth
 * building only if the shortlist proves to be missing matches.
 *
 * The two together matter more than either. Ranking "Cloverleaf deal is latest
 * example of Nvidia using its war chest" by length alone selects `cloverleaf`,
 * `example` and `cracks` — losing `nvidia`, which is the most useful selector in
 * the sentence, to a word that appears in a hundred headlines and narrows nothing.
 *
 * **A title with no whitespace is not a headline** and returns nothing at all. In
 * this corpus those are version tags, git refs and dates — `v8.2.2`,
 * `viable/strict/1787466473` — and they arrive by the dozen from release feeds. The
 * cost of the rule is a genuinely one-word headline (a product launch called simply
 * "Antigravity") becoming its own event even where another outlet used the same one
 * word. That is the cheap direction to be wrong in, and a single word is thin
 * evidence of sameness in any case.
 *
 * Hyphens and apostrophes are kept inside a word, so `gpt-5` and `wi-fi` survive as
 * single tokens rather than splintering into fragments too short to search. Purely
 * numeric tokens are dropped: a year narrows nothing, and a build number narrows to
 * exactly one row that URL uniqueness has already excluded.
 */
export function titleTokens(title: string): string[] {
  const text = title.trim();

  // A title with no whitespace is usually a version tag or a git ref -- except
  // when it is Japanese, Chinese or Korean, none of which puts spaces between
  // words. That exception is the whole of this branch: treating an unspaced CJK
  // headline as a ref meant CJK coverage never got a shortlist, so it never
  // clustered and every story became its own one-article event.
  const unspacedScript = UNSPACED_SCRIPT.test(text);
  if (!/\s/.test(text) && !unspacedScript) return [];
  if (isVcsRef(text)) return [];

  const words: { word: string; proper: boolean }[] = [];
  const seen = new Set<string>();

  // Anything that is not a letter, digit, hyphen or apostrophe is a separator.
  // Non-ASCII letters are kept: a headline naming a non-English product should
  // still be searchable on it.
  for (const raw of title.split(/[^\p{L}\p{N}'’-]+/u)) {
    const trimmed = raw.replace(/^[-'’]+|[-'’]+$/g, "");
    const word = trimmed.toLowerCase();

    if (UNSPACED_SCRIPT.test(word)) {
      // An unspaced run is one "word" to the splitter and a sentence to a
      // reader. It takes its own token rule -- whole run plus three-character
      // windows -- because whitespace carries no word boundaries here, and the
      // Latin length floor would delete every two-character word in the title.
      for (const token of cjkTokens(word)) {
        if (seen.has(token)) continue;
        seen.add(token);
        words.push({ word: token, proper: false });
      }
      continue;
    }

    if (word.length < MIN_TOKEN) continue;
    if (STOPWORDS.has(word)) continue;
    // Not purely digits, separators or a decimal-looking version fragment.
    if (!/\p{L}/u.test(word)) continue;
    if (seen.has(word)) continue;

    seen.add(word);
    words.push({ word, proper: /^\p{Lu}/u.test(trimmed) });
  }

  const capitalised = words.filter((w) => w.proper).length;
  const useCase = words.length > 0 && capitalised / words.length <= TITLE_CASE_RATIO;

  const ranked = [...words].sort((a, b) => {
    if (useCase && a.proper !== b.proper) return a.proper ? -1 : 1;
    // Falling back to the word itself keeps equal lengths in a stable order, so
    // the same headline always produces the same query.
    return b.word.length - a.word.length || a.word.localeCompare(b.word);
  });

  return ranked.slice(0, MAX_TOKENS).map((w) => w.word);
}

/**
 * The tokens as one PostgREST `or=` argument.
 *
 * Returns `""` when there is nothing to search for, which callers must treat as
 * "no shortlist" rather than as an empty filter — an empty `or=()` is a syntax
 * error, and a filter that matched everything would be far worse than one that
 * matched nothing.
 *
 * PostgREST parses this argument itself, so a token containing a comma, a bracket
 * or a period would change the shape of the query rather than the value being
 * searched for. `titleTokens` cannot produce one, and this refuses anyway: the
 * cost of being wrong is a malformed query at best and a filter bypass at worst,
 * and the check is one regex.
 */
export function orFilter(tokens: string[]): string {
  const safe = tokens.filter((token) => /^[\p{L}\p{N}'’-]+$/u.test(token));
  return safe.map((token) => `title.ilike.*${token}*`).join(",");
}

export type Candidate = {
  id: string;
  title: string;
  event_id: string | null;
  published_at: string | null;
  /**
   * Who published it. Returned because the caller needs to know whether a
   * candidate is *another outlet's* account of the same event or the same
   * outlet's next take -- only the former is corroboration, and only the former
   * `cluster.ts` will attach on a paraphrase.
   */
  source_id: string | null;
};

export type ShortlistOptions = {
  /** Days either side of the article's own publication date. */
  windowDays?: number | undefined;
  /** Maximum candidates to return. */
  size?: number | undefined;
};

const WINDOW_DAYS = 2;
const SIZE = 10;

/**
 * Articles that might be about the same event as this one.
 *
 * Bounded three ways, each for a different reason. **Words**, so the query uses
 * the trigram index instead of reading the table. **Time**, because coverage of
 * one event arrives within days of it and an article three weeks later reporting
 * something similar is reporting something else. **Count**, because the shortlist
 * becomes a prompt, and a prompt has to stay small to stay cheap.
 *
 * Ordered with already-clustered articles first. That ordering is doing real work:
 * when the cap bites, it spends the ten slots on candidates that can be *attached
 * to* rather than on ones that would have to be grouped into something new. Since
 * attaching to an already-analysed event costs no tokens at all in stage 4 and
 * creating a second event for the same story costs a full analysis, preferring
 * them is the difference between the shared-analysis property holding and quietly
 * eroding.
 */
export async function shortlist(
  db: Db,
  article: { id: string; title: string; published_at: string | null },
  options: ShortlistOptions = {},
): Promise<Candidate[]> {
  const filter = orFilter(titleTokens(article.title));
  if (filter === "") return [];

  const windowDays = options.windowDays ?? WINDOW_DAYS;
  const size = options.size ?? SIZE;

  let query = db
    .from("articles")
    .select("id, title, event_id, published_at, source_id")
    .neq("id", article.id)
    .or(filter);

  // Every stored article has a publication date today, but the column is nullable
  // and a feed that omits one is entirely legal, so the window is applied only
  // when there is a date to centre it on.
  if (article.published_at !== null) {
    const centre = new Date(article.published_at).getTime();
    const span = windowDays * 24 * 60 * 60 * 1000;
    query = query
      .gte("published_at", new Date(centre - span).toISOString())
      .lte("published_at", new Date(centre + span).toISOString());
  }

  const { data, error } = await query
    .order("event_id", { nullsFirst: false })
    .order("published_at", { ascending: false })
    .limit(size);

  if (error) throw new Error(`shortlist for ${article.id}: ${error.message}`);
  return data ?? [];
}
