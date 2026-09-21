import type { Story } from "@/lib/story";
import type { ArticleParagraph, ReaderArticle } from "@/lib/reader-article";
import { legacyEventIntelligence } from "@/lib/understand";
import {
  centralTokens,
  cleanDeterministicSentence,
  deterministicFactType,
  editorialNoise,
  normalizedNumericKey,
  selectReaderEvidence,
  sourceNameForEvidence,
  readerSentences,
  validDeterministicSentence,
  type ReaderFact,
} from "./reader-evidence";
import { relatedContext } from "./related-events";
import { repeats } from "./understand";

function sentence(text: string): string {
  const clean = cleanDeterministicSentence(text);
  return clean && !/[.!?…]["”]?$/.test(clean) ? `${clean}.` : clean;
}

function lowerFirst(text: string): string {
  if (!text) return text;
  return /^(?:The|A|An)\b/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

function similarEnough(left: string, right: string): boolean {
  if (normalizedNumericKey(left) === normalizedNumericKey(right)) return true;
  const a = new Set(centralTokens(left));
  const b = new Set(centralTokens(right));
  if (Math.min(a.size, b.size) < 4) return repeats(left, right);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.max(a.size, b.size) >= 0.88;
}

function citationRefs(facts: ReaderFact[]): number[] {
  return [...new Set(facts.flatMap((fact) => fact.evidence))].sort((a, b) => a - b);
}

function mergeEvidenceIntoDeck(
  deck: { text: string; evidence: number[] },
  items: { text: string; evidence: number[] }[],
): void {
  for (const item of items) {
    if (repeats(deck.text, item.text))
      deck.evidence = [...new Set([...deck.evidence, ...item.evidence])];
  }
}

function mergeFacts(facts: ReaderFact[]): ReaderFact[] {
  const kept: ReaderFact[] = [];
  for (const fact of facts) {
    if (!validDeterministicSentence(fact.text) || editorialNoise(fact.text)) continue;
    const normalized = normalizedNumericKey(fact.text);
    const prior = kept.find(
      (item) =>
        similarEnough(item.text, fact.text) ||
        (normalized.length > 20 && normalizedNumericKey(item.text) === normalized),
    );
    if (prior) {
      prior.evidence = [...new Set([...prior.evidence, ...fact.evidence])];
      if (fact.score > prior.score) prior.text = fact.text;
    } else {
      kept.push({ ...fact, evidence: [...fact.evidence] });
    }
  }
  return kept.sort(
    (a, b) =>
      Number(a.quote) - Number(b.quote) || b.score - a.score || a.sourceOrder - b.sourceOrder,
  );
}

function supplementalEntityFacts(
  story: Story,
  selection: ReturnType<typeof selectReaderEvidence>,
): ReaderFact[] {
  const facts: ReaderFact[] = [];
  const entities = selection.entities.filter((entity) => entity.role !== "REPORTING_SOURCE");
  story.sourceList.forEach((source, sourceIndex) => {
    for (const raw of readerSentences(source.excerpt ?? "")) {
      const entity = entities.find((candidate) => {
        const surname = candidate.name.split(" ").at(-1);
        return (
          surname &&
          new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(raw)
        );
      });
      if (!entity) continue;
      const surname = entity.name.split(" ").at(-1);
      const normalizedRaw = raw
        .replace(/^As we write,\s*/i, "")
        .replace(/^It's less than three weeks since we wrote about\s+/i, "The article describes ");
      const text = cleanDeterministicSentence(
        surname &&
          !new RegExp(`\\b${entity.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(
            normalizedRaw,
          )
          ? normalizedRaw.replace(new RegExp(`\\b${surname}\\b`, "i"), entity.name)
          : normalizedRaw,
      );
      if (validDeterministicSentence(text) && !editorialNoise(text)) {
        facts.push({
          text,
          evidence: [sourceIndex + 1],
          origin: "rss",
          score: 1,
          quote: false,
          uncertain: false,
          sourceOrder: 10_000 + facts.length,
        });
      }
      if (facts.length >= 32) return;
    }
  });
  return facts;
}

function safeLead(
  lead: ReaderFact | undefined,
  story: Story,
  sourceCount: number,
): { text: string; evidence: number[] } {
  if (!lead) return { text: "", evidence: [] };
  const text = sentence(lead.text);
  if (sourceCount !== 1) return { text, evidence: lead.evidence };
  const source = sourceNameForEvidence(lead.evidence, story.sourceList);
  if (
    !source ||
    new RegExp(`^${source.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(text)
  ) {
    return { text, evidence: lead.evidence };
  }
  if (/^(?:once|when|while|because|although|and|but|or)\b/i.test(text)) {
    return { text: `${source} reports that ${lowerFirst(text)}`, evidence: lead.evidence };
  }
  return { text: `According to ${source}, ${lowerFirst(text)}`, evidence: lead.evidence };
}

function attributedFactText(text: string, evidence: number[], story: Story): string {
  const type = deterministicFactType(text);
  if (!evidence.length || !["claim", "estimate", "projection"].includes(type)) return text;
  if (
    /\b(?:according to|reports?|said|says|estimates?|projects?|found|argues?|claims?)\b/i.test(text)
  )
    return text;
  const source = sourceNameForEvidence(evidence, story.sourceList);
  return source ? `${source} reports that ${lowerFirst(text)}` : text;
}

export type DeterministicQualityReport = {
  factsSelected: number;
  paragraphsKept: number;
  duplicateParagraphs: number;
  malformedParagraphs: number;
  fallbackLevel: 1 | 2 | 3;
};

export function auditDeterministicArticle(article: ReaderArticle): DeterministicQualityReport {
  let duplicateParagraphs = 0;
  let malformedParagraphs = 0;
  const kept: ArticleParagraph[] = [];
  for (const paragraph of article.paragraphs) {
    if (!validDeterministicSentence(paragraph.text)) {
      malformedParagraphs++;
      continue;
    }
    if (kept.some((prior) => similarEnough(prior.text, paragraph.text))) duplicateParagraphs++;
    else kept.push(paragraph);
  }
  const fallbackLevel = kept.length === 0 ? (article.deck.text ? 2 : 3) : 1;
  return {
    factsSelected:
      article.deck.evidence.length +
      article.paragraphs.reduce((sum, paragraph) => sum + paragraph.evidence.length, 0),
    paragraphsKept: kept.length,
    duplicateParagraphs,
    malformedParagraphs,
    fallbackLevel,
  };
}

function qualityGate(article: ReaderArticle): ReaderArticle {
  const sentencesWithEvidence: { text: string; evidence: number[] }[] = [];
  const seen = new Set<string>();
  for (const paragraph of article.paragraphs) {
    const parts =
      paragraph.text.split(/\s+/).length <= 140
        ? [paragraph.text]
        : readerSentences(paragraph.text);
    for (const part of parts) {
      if (!validDeterministicSentence(part)) continue;
      const key = part
        .toLowerCase()
        .replace(/[^\p{L}\p{N}%$€£]+/gu, " ")
        .trim();
      if (seen.has(key)) continue;
      seen.add(key);
      sentencesWithEvidence.push({ text: part, evidence: paragraph.evidence });
    }
  }
  const paragraphs: ArticleParagraph[] = [];
  for (const part of sentencesWithEvidence) {
    const prior = paragraphs.at(-1);
    const size = (prior?.text.split(/\s+/).length ?? 0) + part.text.split(/\s+/).length;
    if (prior && size <= 75 && prior.evidence.some((ref) => part.evidence.includes(ref))) {
      prior.text += ` ${part.text}`;
      prior.evidence = [...new Set([...prior.evidence, ...part.evidence])];
    } else {
      paragraphs.push({ text: part.text, evidence: [...part.evidence] });
    }
  }
  return {
    deck: article.deck,
    paragraphs: paragraphs.slice(0, sentencesWithEvidence.length > 12 ? 8 : 6),
  };
}

function deterministicParagraphs(facts: ReaderFact[], story: Story): ArticleParagraph[] {
  const groups: ReaderFact[][] = [];
  for (const fact of facts) {
    const type = deterministicFactType(fact.text, fact.quote);
    const target =
      type === "fact" || type === "claim" || type === "estimate" || type === "projection"
        ? 0
        : type === "future_action"
          ? 3
          : type === "background" || type === "comparison"
            ? 2
            : 1;
    const prior = groups[target];
    if (
      prior &&
      prior.length < 8 &&
      (prior.some((item) => item.evidence.some((ref) => fact.evidence.includes(ref))) ||
        prior.length === 0)
    )
      prior.push(fact);
    else if (!prior) groups[target] = [fact];
    else groups.push([fact]);
  }
  return groups
    .filter((group): group is ReaderFact[] => !!group?.length)
    .map((group) => {
      const parts = group
        .map((fact) => sentence(attributedFactText(fact.text, fact.evidence, story)))
        .filter(validDeterministicSentence);
      return { text: parts.join(" "), evidence: citationRefs(group) };
    })
    .filter((paragraph) => paragraph.text.split(/\s+/).length >= 8);
}

/**
 * Prefer authored prose. Without it, build a deterministic article from the
 * source excerpts and related coverage already attached to the story -- this
 * is what renders when AI never ran, is unavailable, or hasn't finished yet,
 * so Read never depends on a live model call.
 */
export function composeArticle(story: Story): ReaderArticle {
  if (story.understand?.article) return story.understand.article;

  if (!story.understand) {
    const selection = selectReaderEvidence(story.title, story.sourceList);
    const fallback = !editorialNoise(story.what) ? story.what.trim() : "";
    const facts = mergeFacts([...selection.facts, ...supplementalEntityFacts(story, selection)]);
    const lead = selection.lead && facts.includes(selection.lead) ? selection.lead : facts[0];
    const independentSources = new Set(
      story.sourceList.map((source) => source.name.trim().toLowerCase()).filter(Boolean),
    ).size;
    const leadText = lead ? safeLead(lead, story, independentSources).text : fallback;
    const deck = { text: leadText, evidence: lead ? [...lead.evidence] : [] };
    mergeEvidenceIntoDeck(
      deck,
      selection.facts.filter((fact) => !lead || repeats(lead.text, fact.text)),
    );
    const primaryNames = selection.entities
      .filter((entity) => entity.role !== "REPORTING_SOURCE")
      .flatMap((entity) => [entity.name, ...entity.aliases]);
    const priorityFacts = facts.filter(
      (fact) =>
        fact !== lead &&
        primaryNames.some((name) =>
          new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(
            fact.text,
          ),
        ),
    );
    const remaining = [
      ...priorityFacts,
      ...facts.filter((fact) => fact !== lead && !priorityFacts.includes(fact)),
    ];
    const paragraphs = [
      ...deterministicParagraphs(remaining, story),
      ...priorityFacts
        .filter((fact) => !remaining.slice(0, 8).includes(fact))
        .slice(0, 3)
        .map((fact) => ({
          text: sentence(attributedFactText(fact.text, fact.evidence, story)),
          evidence: fact.evidence,
        })),
    ];
    const composedText = paragraphs.map((paragraph) => paragraph.text).join(" ");
    for (const entity of selection.entities.filter((item) => item.role !== "REPORTING_SOURCE")) {
      if (composedText.includes(entity.name) || !entity.name.includes(" ")) continue;
      const sourceIndex = story.sourceList.findIndex((source) =>
        (source.excerpt ?? "").toLowerCase().includes(entity.name.toLowerCase()),
      );
      const raw =
        sourceIndex < 0
          ? undefined
          : readerSentences(story.sourceList[sourceIndex]?.excerpt ?? "").find((part) =>
              part.toLowerCase().includes(entity.name.toLowerCase()),
            );
      const text = raw
        ? cleanDeterministicSentence(
            raw
              .replace(/^As we write,\s*/i, "")
              .replace(
                /^It's less than three weeks since we wrote about\s+/i,
                "The article describes ",
              ),
          )
        : "";
      if (text && validDeterministicSentence(text) && !editorialNoise(text))
        paragraphs.unshift({ text: sentence(text), evidence: [sourceIndex + 1] });
      if (paragraphs.length >= 8) break;
    }
    for (const candidate of story.relatedEvents ?? []) {
      const context = relatedContext({ title: story.title, summary: leadText }, candidate);
      if (context && validDeterministicSentence(context))
        paragraphs.push({ text: sentence(context), evidence: [] });
    }
    // Thin evidence should remain thin; rich evidence is capped at four useful blocks.
    const gated = qualityGate({
      deck,
      paragraphs: paragraphs.slice(0, facts.length <= 3 ? 2 : paragraphs.length),
    });

    return gated;
  }

  const intel =
    story.understand ??
    legacyEventIntelligence({
      what: story.what,
      sources: story.sourceList,
      ...(story.relatedEvents ? { relatedEvents: story.relatedEvents } : {}),
    });
  const deck = { text: story.what.trim() || intel.oneSentence || "", evidence: [] as number[] };
  const paragraphs: ArticleParagraph[] = [];
  const seen: { text: string; evidence: number[] }[] = [
    { text: deck.text, evidence: deck.evidence },
  ];
  const add = (items: { text: string; evidence: number[] }[]) => {
    const kept: string[] = [];
    const evidence: number[] = [];
    const paragraph = { text: "", evidence };
    for (const item of items) {
      const text = sentence(attributedFactText(item.text, item.evidence, story));
      if (!validDeterministicSentence(text) || editorialNoise(text)) continue;
      const existing = seen.find((candidate) => repeats(candidate.text, text));
      if (existing) {
        existing.evidence = [...new Set([...existing.evidence, ...item.evidence])];
        continue;
      }
      seen.push({ text, evidence: item.evidence });
      kept.push(text);
      for (const ref of item.evidence) if (!evidence.includes(ref)) evidence.push(ref);
    }
    if (kept.length) {
      paragraph.text = kept.join(" ");
      paragraphs.push(paragraph);
    }
  };
  const plain = (text: string) => ({ text, evidence: [] as number[] });

  const deckItems = [plain(intel.oneSentence), ...intel.newDevelopments, ...intel.context];
  mergeEvidenceIntoDeck(
    deck,
    deckItems.filter((item) => repeats(deck.text, item.text)),
  );
  add([plain(story.before), plain(story.after), ...intel.newDevelopments]);
  {
    add([...intel.context]);
    add(
      intel.numbers.flatMap((n) =>
        selectReaderEvidence(story.title, [{ excerpt: n.label }])
          .facts.filter((f) => f.text.includes(n.value))
          .map((f) => ({ text: f.text, evidence: n.evidence })),
      ),
    );
    add(intel.overview.map((o) => ({ text: `${o.name}: ${o.detail}`, evidence: o.evidence })));
    if (intel.comparison) {
      const comparison = intel.comparison;
      add(
        comparison.rows.map((r) => ({
          text: `${r.label}: ${comparison.leftLabel}, ${r.left}; ${comparison.rightLabel}, ${r.right}`,
          evidence: r.evidence,
        })),
      );
    }
    if (intel.series) {
      const series = intel.series;
      add([
        {
          text: `${series.caption}: ${series.points.map((p) => `${p.label}, ${p.display}`).join("; ")}`,
          evidence: series.points.flatMap((p) => p.evidence),
        },
      ]);
    }
    if (intel.relationships) {
      const { nodes, edges } = intel.relationships;
      add(
        edges
          .filter((edge) => edge.label)
          .map((edge) => ({
            text: `${nodes.find((n) => n.id === edge.from)?.label ?? edge.from} ${edge.label} ${nodes.find((n) => n.id === edge.to)?.label ?? edge.to}`,
            evidence: edge.evidence,
          })),
      );
    }
    add(
      intel.audiences.map((a) => ({
        text: `For ${a.audience}: ${a.implication}`,
        evidence: a.evidence,
      })),
    );
    for (const conflict of intel.conflicts) {
      add(
        conflict.reports.map((r) => ({
          text: `${conflict.topic}: ${r.text}`,
          evidence: r.evidence,
        })),
      );
    }
    add(
      intel.perspectives.map((p) => ({ text: `${p.source}: ${p.stance}`, evidence: p.evidence })),
    );
    add(intel.unknowns.map(plain));
    add(intel.timeline.map((t) => ({ text: `${t.when}: ${t.what}`, evidence: t.evidence })));
    add([
      ...intel.whatNext,
      ...intel.watchNext.map((w) => ({
        text: `${w.label}: ${w.detail}`,
        evidence: w.evidence,
      })),
    ]);
  }
  const cleanParagraphs = paragraphs
    .filter((paragraph) => paragraph.text.split(/\s+/).length >= 3)
    .reduce<ArticleParagraph[]>((out, paragraph) => {
      const duplicate = out.find((prior) => similarEnough(prior.text, paragraph.text));
      if (duplicate)
        duplicate.evidence = [...new Set([...duplicate.evidence, ...paragraph.evidence])];
      else out.push(paragraph);
      return out;
    }, []);
  return qualityGate({ deck, paragraphs: cleanParagraphs });
}
