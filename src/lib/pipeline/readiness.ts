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

export type ArtifactKind =
  | "empty"
  | "build-number"
  | "commit-message"
  | "byline"
  | "newsletter"
  | "commerce"
  | "marketing"
  | "quote";

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
  /^(?:introducing|announcing|meet|getting started|how to|why we|what we(?:'|’)ve|we (?:tested|built|rewrote|migrated|learned|ran)|learn how|discover|explore|enforce|secure|protect|accelerate|boost|simplify|unlock|supercharge|streamline|scale|deploy|transform|build|drive)\b/i;

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

export function assessReadiness(input: {
  title: string;
  whatHappened: string | null | undefined;
  sourceCount?: number;
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

  // Corroboration vetoes both: a promotion or a first-party post that other
  // outlets reported is news about the company, not the company's own copy.
  if ((input.sourceCount ?? 1) < 2 && !NEWS_VERB.test(title)) {
    if (MARKETING_TITLE.test(title)) {
      return { ready: false, kind: "marketing", reason: "title is an imperative promotion" };
    }
    if (MARKETING_TRAILER.test(title)) {
      return { ready: false, kind: "marketing", reason: "title is a vendor how-to" };
    }
  }

  return { ready: true };
}
