/** Only exact claims are collapsed. Case, numbers, units and negation survive. */
export function claimKey(text: string): string {
  return text
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!。！]$/, "");
}

export function evidenceSentences(text: string): string[] {
  return text
    .replace(/\s+/gu, " ")
    .trim()
    .split(/(?<=[.!?])\s+|(?<=[。！？])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function cleanEvidence(title: string, excerpt: string): string[] {
  const seen = new Set([claimKey(title)]);
  return evidenceSentences(excerpt).filter((sentence) => {
    const key = claimKey(sentence);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Keep citations stable even when later articles arrive or dates are corrected. */
export function orderEvidenceSources<T extends { id: string }>(sources: T[], ids: string[]): T[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...sources].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

/** Remap citations if an original article was removed; never shift it to another source. */
export function remapEvidence(value: unknown, ids: string[], sources: { id: string }[]): unknown {
  if (!ids.length) return value;
  const current = new Map(sources.map((source, index) => [source.id, index + 1]));
  function visit(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, child]) => [
        key,
        key === "evidence" && Array.isArray(child)
          ? child.flatMap((number: unknown) => {
              const id = typeof number === "number" ? ids[number - 1] : undefined;
              const mapped = id ? current.get(id) : undefined;
              return mapped === undefined ? [] : [mapped];
            })
          : visit(child),
      ]),
    );
  }
  return visit(value);
}
