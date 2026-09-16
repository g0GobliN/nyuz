import { extractFacts } from "./extract";
import { scoreEventV2 } from "./scoring";

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
  const scaffolding = new Set(["a", "an", "the", "to", "of", "in", "on", "for", "and"]);
  if (
    left.filter((w) => !scaffolding.has(w)).join(" ") !==
    right.filter((w) => !scaffolding.has(w)).join(" ")
  )
    return false;
  if (
    [...left.filter((w) => !right.includes(w)), ...right.filter((w) => !left.includes(w))].some(
      (w) => !scaffolding.has(w),
    )
  )
    return false;
  const negatives = new Set(["not", "no", "denies", "denied", "rumor", "rumour"]);
  if (
    left
      .filter((w) => negatives.has(w))
      .sort()
      .join() !==
    right
      .filter((w) => negatives.has(w))
      .sort()
      .join()
  )
    return false;
  // Near-identical coverage only; ambiguous paraphrases remain separate events.
  return titleSimilarity(a, b) >= 0.92;
}

export function publisherKey(article: NewsArticle, sources: Map<string, Publisher>): string {
  const source = article.source_id ? sources.get(article.source_id) : undefined;
  try {
    let host = new URL(source?.homepage || article.url || "").hostname
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
  return source?.name.trim().toLowerCase() || article.source_id || "unknown";
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
    what_happened: short,
    importance: score.importanceEstimate,
    novelty,
    article_count: articles.length,
    publisher_count: groups.size,
  };
}

export function distinctNews<T>(items: readonly T[], title: (item: T) => string): T[] {
  return items.filter(
    (item, index) =>
      !items.slice(0, index).some((earlier) => sameHeadline(title(earlier), title(item))),
  );
}
