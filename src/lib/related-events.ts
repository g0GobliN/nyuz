import {
  centralTokens,
  editorialNoise,
  normalizeSummary,
  numericKeys,
  rankEntities,
  readerSentences,
  unitTextRejection,
} from "./reader-evidence";
import { extractProducts } from "./pipeline/extract";

export type RelatedCandidate = { title: string; summary?: string; publishedAt?: string };

export function scoreRelatedEvent(
  current: RelatedCandidate,
  candidate: RelatedCandidate,
  topicOverlap = 0,
) {
  const entities = (event: RelatedCandidate) =>
    rankEntities(event.title, [{ excerpt: event.summary ?? "" }]);
  const own = entities(current);
  const other = entities(candidate);
  const shared = own.filter((a) =>
    other.some((b) => a.name.toLowerCase() === b.name.toLowerCase()),
  );
  const primary = shared.filter(
    (a) =>
      a.role === "PRIMARY" &&
      other.some((b) => b.name.toLowerCase() === a.name.toLowerCase() && b.role === "PRIMARY"),
  );
  const productNames = (event: RelatedCandidate) =>
    extractProducts(`${event.title} ${event.summary ?? ""}`, 0).map((hit) => hit.value);
  const productOverlap = productNames(current).filter((name) =>
    productNames(candidate).some((other) => other.toLowerCase() === name.toLowerCase()),
  );
  const left = centralTokens(current.title);
  const right = centralTokens(candidate.title);
  const overlap = left.filter((t) => right.includes(t));
  const lexicalSimilarity = overlap.length / Math.max(1, new Set([...left, ...right]).size);
  const age =
    current.publishedAt && candidate.publishedAt
      ? Date.parse(current.publishedAt) - Date.parse(candidate.publishedAt)
      : NaN;
  const recency = Number.isFinite(age) && age > 0 ? Math.max(0, 1 - age / (90 * 86400000)) : 0;
  const anchor =
    primary.length > 0 ||
    productOverlap.length > 0 ||
    shared.filter((e) => e.role !== "BACKGROUND" && e.role !== "REPORTING_SOURCE").length >= 2 ||
    (overlap.length >= 3 && lexicalSimilarity >= 0.5);
  const finalScore =
    primary.length * 10 +
    productOverlap.length * 8 +
    shared.length * 2 +
    lexicalSimilarity * 5 +
    recency;
  return {
    entityOverlap: shared.map((e) => e.name),
    primaryEntityOverlap: primary.map((e) => e.name),
    productOverlap,
    topicOverlap,
    lexicalSimilarity,
    recency,
    finalScore,
    accepted: anchor,
    reason: anchor
      ? "Shared central entity or specific headline facts"
      : "No strong semantic anchor; topic overlap cannot establish relatedness",
  };
}

export function relatedContext(
  current: RelatedCandidate,
  candidate: RelatedCandidate,
): string | null {
  if (
    !scoreRelatedEvent(current, candidate).accepted ||
    !candidate.summary ||
    editorialNoise(candidate.summary)
  )
    return null;
  const normalized = normalizeSummary(candidate.summary);
  if (normalized.reason !== null) return null;
  const currentTokens = new Set(centralTokens(`${current.title} ${current.summary ?? ""}`));
  const currentEntityNames = new Set(
    rankEntities(current.title, [{ excerpt: current.summary ?? "" }])
      .filter((entity) => entity.role === "PRIMARY")
      .flatMap((entity) => [entity.name, ...entity.aliases])
      .map((name) => name.toLowerCase()),
  );
  const currentNumbers = numericKeys(`${current.title} ${current.summary ?? ""}`);
  const relevant = readerSentences(normalized.text).find((sentence) => {
    if (editorialNoise(sentence) || unitTextRejection(sentence, /["“]/.test(sentence)))
      return false;
    const tokens = centralTokens(sentence);
    if (tokens.length < 4) return false;
    const namesInSentence = [...currentEntityNames].filter((name) =>
      sentence.toLowerCase().includes(name),
    );
    const tokenOverlap = tokens.filter((token) => currentTokens.has(token)).length;
    if (tokenOverlap < 2 && namesInSentence.length === 0) return false;
    const numbers = numericKeys(sentence);
    return numbers.length === 0 || numbers.some((value) => currentNumbers.includes(value));
  });
  if (!relevant) return null;
  return `Previously, ${relevant.replace(/^(The|A|An)\b/, (s) => s.toLowerCase())}`;
}
