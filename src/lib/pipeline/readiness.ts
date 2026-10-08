/**
 * The reader-readiness gate.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * On 2026-09-30 the briefing carried 25 stories and 6 of them were not news
 * for a reader: a llama.cpp build number (`b11243`) with a CI commit message
 * as its summary, a Google Research item with a 19-character excerpt and no
 * summary at all, a Google Play marketing post whose "summary" was its byline,
 * two newsletter/announcement items, and a Newegg price drop. Every one of
 * them had already passed clustering, analysis and matching — render-time code
 * cannot recover from a story whose underlying material is not a story, so the
 * gate stands at selection time in `digest.ts`, operating on exactly what the
 * reader would see: the title and the summary.
 *
 * ---------------------------------------------------------------------------
 * Narrow on purpose
 * ---------------------------------------------------------------------------
 *
 * The gate rejects only provably non-news shapes: empty summaries, machine
 * identifiers as headlines, commit messages, bylines, newsletter/announcement
 * titles, and commerce posts. It does NOT grade length — a 71-character
 * summary of a real launch (OpenAI Dots, same day) is thin but real, and
 * thin-but-real is handled downstream by depth widening, never by dropping.
 * A gate that drops short real news would trade visible junk for invisible
 * misses, which is the worse failure.
 *
 * Deterministic and dependency-free, so the digest tests can pin every shape
 * without a database.
 */

import { selectReaderEvidence, type ReaderSource } from "../reader-evidence";

export type ArtifactKind =
  | "empty"
  | "build-number"
  | "commit-message"
  | "byline"
  | "newsletter"
  | "commerce"
  | "marketing"
  | "quote"
  | "primary-source"
  | "unbriefable";

export type ReadinessVerdict =
  { ready: true } | { ready: false; kind: ArtifactKind; reason: string };

/** A headline that is a machine identifier rather than a headline. */
const BUILD_NUMBER_TITLE = /^\s*(?:b|v|build|r)?\d+(?:\.\d+)*(?:[-_][a-z0-9]+)?\s*$/i;

/** Conventional-commit / CI scope prefixes on the summary or title. */
const COMMIT_PREFIX = /^(?:ci|fix|feat|chore|docs|refactor|test|build|perf|style)\s*:/i;

/** Trailers and references that only ever appear in commit messages. */
const COMMIT_MARKERS = /(?:assisted-by:|signed-off-by:|co-authored-by:|closes #\d+|\(#\d{3,}\))/i;

/** A byline standing where the news should be. */
const BYLINE_SUMMARY =
  /^(?:posted by|by)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+,?\s+(?:senior|staff|principal|product|engineering|developer|technology).{0,80}$/i;

/** Titles that announce the container rather than the news. */
const NEWSLETTER_TITLE =
  /(?:\bthe download\b|^coming soon:|\bweek in review\b|\bnewsletter\b|\bmorning briefing\b|\bdaily digest\b|\bwhat to read\b)/i;

/**
 * A quote post wearing a headline: the title announces that a quotation
 * follows rather than that something happened.
 */
const QUOTE_TITLE = /^(?:quoting|quote:)\b/i;

/**
 * A vendor's own marketing post shaped as a headline.
 *
 * Two shapes only, because the failure mode of a broader rule is dropping a
 * product announcement that is genuinely the news: an imperative opener
 * ("Enforce positive security with…", "Introducing Threat Signals") and the
 * trailer that turns a headline into a how-to ("…for the AI era: how Cloudflare
 * connects…", "Here's what we found").
 */
const MARKETING_TITLE =
  /^(?:introducing|announcing|meet|getting started|how to|why we|what we(?:'|’)ve|we (?:tested|built|rewrote|migrated|learned|ran)|learn how|discover|explore|enforce|secure|protect|accelerate|boost|simplify|unlock|supercharge|streamline|scale|deploy|transform|build|drive|cut|save|reduce|identify)\b/i;

/**
 * Community-recognition filler: the vendor celebrating its own users.
 * "Celebrating Our Newest AWS Heroes" shipped in the 2026-10-02 preview — an
 * award post about customers, not an event in the world. The shape is the
 * celebratory verb plus a first-person possessive, which no third-party
 * news headline about the company would carry.
 */
const CELEBRATION_TITLE =
  /\b(?:celebrating|congratulations|honoring)\b.*\b(?:our|the newest|this year's)\b/i;

/**
 * A benefit pitch: the vendor telling you what its product will do for *your*
 * bill, workflow or spend. "Cut your AI spend with AI Gateway's Auto Router"
 * (Cloudflare blog, 2026-10-02) is an advert with a feature name in it — a
 * second person pronoun or possessive aimed at the reader is the tell no
 * third-party report of the product carries.
 */
const BENEFIT_TITLE =
  /\b(?:your)\s+(?:AI\s+|cloud\s+|security\s+)?(?:spend|costs?|workflow|bills?|data|apps?|team|work|content|usage|traffic|account|infrastructure)\b/i;

/**
 * A themed week/campaign banner: "AI Chip Design Week", "Partner Day".
 * A recurring marketing container, not something that happened.
 */
const CAMPAIGN_TITLE = /\b(?:week|day|month|summit series)\b\s*$/i;

const MARKETING_TRAILER = /(?:\bhere(?:'|’)s what we found\b|\bfor the [a-z-]+ era\b|:\s+how\s)/i;

/**
 * Anything that happened to a company. Present, the marketing shapes above are
 * a product launch wearing a slogan; absent, they are a vendor describing its
 * own work. Without this guard the rule would eat "Scale AI raises $200M" and
 * "Build a bear…", which start with the same words as an imperative promo.
 */
const NEWS_VERB =
  /\b(?:launch(?:es|ed)?|unveil(?:s|ed)?|announce(?:s|d)?|acquir(?:e|es|ed)|rais(?:e|es|ed)|win(?:s|ned)?|sign(?:s|ed)?|cut(?:s)?|slashed?|halt(?:s|ed)?|paus(?:e|es|ed)|delay(?:s|ed)?|shelv(?:e|es|ed)|s(?:ue|ues|ued)|charg(?:e|es|ed)|arrest(?:s|ed)?|die(?:s|d)|kill(?:s|ed)?|fold(?:s|ed)?|shut(?:s)?|shutter(?:s|ed)?|lays? off|merg(?:e|es|ed)|debuts?|shipp?(?:ed|s)|rolls? out|ban(?:s|ned)?|block(?:s|ed)?|fail(?:s|ed)?|pass(?:es|ed)?|approv(?:e|es|ed)|reject(?:s|ed)?|names|named|picks|picked|set to|to acquire|will acquire)\b/i;

/** A price promotion. Requires money and a sales verb. */
const COMMERCE_TITLE = /\$\s*[\d,]+(?:\.\d{2})?/;

const COMMERCE_VERBS =
  /(?:grab this|save(?:ing)? you|right now|% off|\bdeal\b|\bdeals\b|on sale|price drop|lowest price)/i;

/**
 * A promotion that forgot its price. "The best early October Prime Day deals
 * happening now" shipped on 2026-09-30 with no dollar figure in the headline,
 * so the money rule above never saw it — it needs a promo noun and a clock.
 */
const COMMERCE_PROMO = /\b(?:deals?|coupons?|discounts?)\b/i;

const COMMERCE_URGENCY =
  /(?:happening now|right now|ends? (?:today|tonight)|today only|\d+% off|save \$?\d)/i;

/**
 * Facts a story needs before the composer has a body to publish.
 *
 * One is the deck. The lead fact is spent on the deck, so a story whose
 * evidence yields a single accepted fact has nothing left for a paragraph —
 * which is the 34 "deck only" stories the 2026-10-03 audit counted, and they
 * are indistinguishable to a reader from a story that failed to load.
 *
 * Two is therefore the floor, and it is a floor rather than a target: the
 * composer will not manufacture a third paragraph to reach one, and a story
 * carrying two facts that merge into one is still one paragraph. Measured over
 * 200 live events this rule separated perfectly — 99 stories kept, none of them
 * empty, 35 withheld, none of them carrying a body — so it is a contract
 * between selection and composition rather than a guess at quality.
 */
const MIN_BODY_FACTS = 2;

/**
 * Feeds that publish their own material rather than reporting on someone
 * else's: preprints and code releases. A single-source item from one of these
 * is a primary document, not a briefing story — and the ladder cannot write a
 * significance line for an abstract that states no development, which is why
 * 23 of 25 items on 2026-10-08 resolved to silence.
 *
 * `sources.kind` decides this, not the outlet's name: the enum already
 * separates `research` and `github` from `news`, `company_blog` and the
 * catch-all `rss`. A vendor blog is not in the class on purpose — its posts
 * are announcements the product does brief (Microsoft Research, 2026-10-07),
 * and the marketing shapes above already handle the ones that are adverts.
 */
const PRIMARY_SOURCE_KINDS: ReadonlySet<string> = new Set(["research", "github"]);

export function assessReadiness(input: {
  title: string;
  whatHappened: string | null | undefined;
  sourceCount?: number;
  /**
   * Every feed this event came from, by `sources.kind`.
   *
   * The operator's decision of 2026-10-08: a briefing does not carry a
   * single-source preprint or code release. Those items keep their place in
   * the dashboard feed and in history — they are still collected, matched and
   * readable — they just stop being briefing candidates until a second outlet
   * corroborates them, at which point they are news like anything else.
   *
   * Omitted by callers that have not loaded coverage; the rung is skipped
   * rather than guessed at, exactly like the briefability rung below.
   */
  sourceKinds?: readonly string[] | undefined;
  /**
   * The story's own source evidence, as the composer will receive it.
   *
   * Omitted by callers that have not loaded coverage, which skips the
   * briefability rung rather than guessing at it. `loadBriefs` in `digest.ts`
   * passes it, so the real selection path always applies this.
   */
  sources?: ReaderSource[];
}): ReadinessVerdict {
  const title = (input.title ?? "").replace(/\s+/gu, " ").trim();
  const what = (input.whatHappened ?? "").replace(/\s+/gu, " ").trim();

  // Rung 1: there has to be a summary. A 19-character excerpt with no summary
  // is #22 — a headline, a source rail, and nothing to read.
  if (what.length < 20) {
    return { ready: false, kind: "empty", reason: "summary below 20 characters" };
  }

  if (BUILD_NUMBER_TITLE.test(title)) {
    return { ready: false, kind: "build-number", reason: `headline is an identifier: ${title}` };
  }

  if (COMMIT_PREFIX.test(what) || COMMIT_PREFIX.test(title) || COMMIT_MARKERS.test(what)) {
    return { ready: false, kind: "commit-message", reason: "summary reads as a commit message" };
  }

  if (BYLINE_SUMMARY.test(what)) {
    return { ready: false, kind: "byline", reason: "summary is a byline, not news" };
  }

  if (NEWSLETTER_TITLE.test(title)) {
    return {
      ready: false,
      kind: "newsletter",
      reason: "title announces the container, not the news",
    };
  }

  if (COMMERCE_TITLE.test(title) && COMMERCE_VERBS.test(title)) {
    return { ready: false, kind: "commerce", reason: "title is a price promotion" };
  }

  if (COMMERCE_PROMO.test(title) && COMMERCE_URGENCY.test(title)) {
    return { ready: false, kind: "commerce", reason: "title is a sale with a clock on it" };
  }

  if (QUOTE_TITLE.test(title)) {
    return { ready: false, kind: "quote", reason: "title announces a quotation, not an event" };
  }

  // Primary-source material on its own is not a briefing story. Corroboration
  // overrides: the same preprint covered by a second outlet is news about it.
  if (
    input.sourceKinds !== undefined &&
    input.sourceKinds.length > 0 &&
    (input.sourceCount ?? 1) < 2 &&
    input.sourceKinds.every((kind) => PRIMARY_SOURCE_KINDS.has(kind))
  ) {
    return {
      ready: false,
      kind: "primary-source",
      reason: `single-source ${input.sourceKinds.join("/")} item`,
    };
  }

  // Corroboration vetoes both: a promotion or a first-party post that other
  // outlets reported is news about the company, not the company's own copy.
  // The NEWS_VERB exemption above covers "Cut 200 jobs" — real news whose verb
  // happens to be a marketing verb too. It must not cover a verb aimed at the
  // reader's own situation: "Cut your AI spend with …" (Cloudflare blog,
  // 2026-10-02) is an advert whose first word is a news verb by coincidence.
  // The benefit-shape check therefore runs on the raw title regardless of the
  // verb exemption, and only for single-source first-party posts.
  if (BENEFIT_TITLE.test(title) && (input.sourceCount ?? 1) < 2) {
    return { ready: false, kind: "marketing", reason: "title pitches a benefit to the reader" };
  }

  // Last, because it is the only rung that needs the evidence and the only one
  // that can be wrong about a story that is real news. A story with no
  // publishable body is not a briefing item, and this is where that is decided:
  // the composer will not pad one out of the scraps of a refused sentence, and
  // "nyuz did not brief this" costs the reader less than "nyuz said this is
  // what the story says".
  if (input.sources !== undefined) {
    const { composedFactCount } = selectReaderEvidence(title, input.sources);
    if (composedFactCount < MIN_BODY_FACTS) {
      return {
        ready: false,
        kind: "unbriefable",
        reason: `${composedFactCount} accepted fact(s); a body needs ${MIN_BODY_FACTS}`,
      };
    }
  }
  if ((input.sourceCount ?? 1) < 2 && !NEWS_VERB.test(title)) {
    if (MARKETING_TITLE.test(title)) {
      return { ready: false, kind: "marketing", reason: "title is an imperative promotion" };
    }
    if (MARKETING_TRAILER.test(title)) {
      return { ready: false, kind: "marketing", reason: "title is a vendor how-to" };
    }
    if (CELEBRATION_TITLE.test(title)) {
      return {
        ready: false,
        kind: "marketing",
        reason: "title celebrates the vendor's own community",
      };
    }
    if (
      CAMPAIGN_TITLE.test(title) &&
      /\b(?:design|partner|innovation|developer|customer)\s/i.test(title)
    ) {
      return {
        ready: false,
        kind: "marketing",
        reason: "title is a themed campaign banner",
      };
    }
  }

  return { ready: true };
}
