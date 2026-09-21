import type { Story } from "@/lib/story";
import type { ArticleParagraph, ReaderArticle } from "@/lib/reader-article";
import { legacyEventIntelligence } from "@/lib/understand";
import {
  centralTokens,
  cleanDeterministicSentence,
  deterministicFactType,
  editorialNoise,
  nearDuplicate,
  normalizeReaderSources,
  normalizedNumericKey,
  preferCleaner,
  selectReaderEvidence,
  sourceNameForEvidence,
  readerSentences,
  validDeterministicSentence,
  type DeterministicFactType,
  type ReaderFact,
} from "./reader-evidence";
import {
  hasSourceMetadata,
  isRepositorySourceName,
  malformedAttribution,
} from "./pipeline/source-text";
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
  // One statement carrying extra furniture -- a provider prefix, a source label
  // -- is the same statement. Checked before the token-set comparison, which
  // would otherwise score a decorated variant as only partly similar.
  if (nearDuplicate(left, right)) return true;
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

/** Counters for the deterministic composer. Admin/debug only -- see `composeArticleWithDiagnostics`. */
export type CompositionDiagnostics = {
  sourceNormalization: {
    removedMetadataFields: number;
    cleanedEvidence: number;
    rejectedMetadataOnly: number;
  };
  dedupe: { duplicateGroups: number; preferredCleanVariant: number };
  qualityGate: { metadataLeakWarnings: number; malformedAttributionWarnings: number };
};

function createDiagnostics(): CompositionDiagnostics {
  return {
    sourceNormalization: { removedMetadataFields: 0, cleanedEvidence: 0, rejectedMetadataOnly: 0 },
    dedupe: { duplicateGroups: 0, preferredCleanVariant: 0 },
    qualityGate: { metadataLeakWarnings: 0, malformedAttributionWarnings: 0 },
  };
}

function mergeFacts(facts: ReaderFact[], diagnostics: CompositionDiagnostics): ReaderFact[] {
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
      diagnostics.dedupe.duplicateGroups += 1;
      // Two variants of one claim merged. Keep the one carrying less furniture
      // -- and the same text regardless of which variant arrived first.
      if (preferCleaner(prior.text, fact.text)) {
        prior.text = fact.text;
        prior.score = Math.max(prior.score, fact.score);
        diagnostics.dedupe.preferredCleanVariant += 1;
      } else if (!preferCleaner(fact.text, prior.text) && fact.score > prior.score) {
        prior.text = fact.text;
        prior.score = fact.score;
      }
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
  /**
   * Only entities the source text itself supports.
   *
   * Entity ranking reads the title and the excerpts as one string, so a
   * capitalized window can span the boundary between them -- "Hijacking
   * Human-in-the-Loop Approval Human" is a title tail glued to the excerpt's
   * first word. Rewriting a sentence with a name like that attributes a claim to
   * nobody and duplicates the sentence it was spliced into.
   */
  const supportedText = story.sourceList
    .map((source) =>
      [source.excerpt ?? "", ...(source.enrichedEvidence ?? []).map((unit) => unit.text)].join(" "),
    )
    .join(" ")
    .toLowerCase();
  const entities = selection.entities.filter(
    (entity) =>
      entity.role !== "REPORTING_SOURCE" && supportedText.includes(entity.name.toLowerCase()),
  );
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
  if (isRepositorySourceName(source)) {
    return {
      text: `${researchAttribution(deterministicFactType(text))}: ${text}`,
      evidence: lead.evidence,
    };
  }
  if (/^(?:once|when|while|because|although|and|but|or)\b/i.test(text)) {
    return { text: `${source} reports that ${lowerFirst(text)}`, evidence: lead.evidence };
  }
  return { text: `According to ${source}, ${lowerFirst(text)}`, evidence: lead.evidence };
}

/**
 * How a research repository introduces a claim.
 *
 * arXiv is where a paper is posted, not a party to anything, so it can never be
 * the claimant: `According to arXiv cs.CR, ...` credits a subject category with
 * a research finding. The paper is the actor, and the form ends in a colon
 * because the sentence that follows is a complete one -- lowercasing its first
 * word would be a guess about whether that word is a proper noun.
 */
function researchAttribution(type: DeterministicFactType): string {
  if (type === "projection") return "The paper projects";
  if (type === "estimate") return "The paper estimates";
  if (type === "claim") return "The paper argues";
  return "A new paper reports";
}

function attributedFactText(text: string, evidence: number[], story: Story): string {
  const type = deterministicFactType(text);
  if (!evidence.length || !["claim", "estimate", "projection"].includes(type)) return text;
  if (
    /\b(?:according to|reports?|said|says|estimates?|projects?|found|argues?|claims?)\b/i.test(text)
  )
    return text;
  const source = sourceNameForEvidence(evidence, story.sourceList);
  if (!source) return text;
  return isRepositorySourceName(source)
    ? `${researchAttribution(type)}: ${text}`
    : `${source} reports that ${lowerFirst(text)}`;
}

export type DeterministicQualityReport = {
  factsSelected: number;
  paragraphsKept: number;
  duplicateParagraphs: number;
  malformedParagraphs: number;
  /** Sentences dropped because a provider field was still at their start. */
  metadataLeakWarnings: number;
  /** Sentences dropped because they credited a repository or category with a claim. */
  malformedAttributionWarnings: number;
  fallbackLevel: 1 | 2 | 3;
};

export function auditDeterministicArticle(article: ReaderArticle): DeterministicQualityReport {
  let duplicateParagraphs = 0;
  let malformedParagraphs = 0;
  let metadataLeakWarnings = 0;
  let malformedAttributionWarnings = 0;
  const kept: ArticleParagraph[] = [];
  for (const paragraph of article.paragraphs) {
    if (!validDeterministicSentence(paragraph.text)) {
      malformedParagraphs++;
      continue;
    }
    if (kept.some((prior) => similarEnough(prior.text, paragraph.text))) duplicateParagraphs++;
    else kept.push(paragraph);
  }
  for (const text of [article.deck.text, ...article.paragraphs.map((part) => part.text)]) {
    if (hasSourceMetadata(text)) metadataLeakWarnings++;
    if (malformedAttribution(text)) malformedAttributionWarnings++;
  }
  const fallbackLevel = kept.length === 0 ? (article.deck.text ? 2 : 3) : 1;
  return {
    factsSelected:
      article.deck.evidence.length +
      article.paragraphs.reduce((sum, paragraph) => sum + paragraph.evidence.length, 0),
    paragraphsKept: kept.length,
    duplicateParagraphs,
    malformedParagraphs,
    metadataLeakWarnings,
    malformedAttributionWarnings,
    fallbackLevel,
  };
}

/** The identical-comparison key the gate uses, punctuation-insensitive. */
function sentenceKeyOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%$€£]+/gu, " ")
    .trim();
}

/**
 * The final deterministic check before prose ships.
 *
 * It refuses three things the composer is not allowed to publish even if they
 * reach it: a sentence still carrying a provider field, an attribution that
 * credits a repository or subject category with a claim, and a sentence that
 * only restates the deck. Provenance is never dropped with the text -- the
 * duplicate's evidence is folded into the copy that survives.
 */
function qualityGate(article: ReaderArticle, diagnostics: CompositionDiagnostics): ReaderArticle {
  const sentencesWithEvidence: { text: string; evidence: number[] }[] = [];
  const index = new Map<string, number>();
  const deck = article.deck;
  const mergeInto = (target: { evidence: number[] }, evidence: number[]) => {
    target.evidence = [...new Set([...target.evidence, ...evidence])];
  };
  const deckKey = sentenceKeyOf(deck.text);
  if (deckKey && validDeterministicSentence(deck.text)) index.set(deckKey, -1);
  for (const paragraph of article.paragraphs) {
    const parts =
      paragraph.text.split(/\s+/).length <= 140
        ? [paragraph.text]
        : readerSentences(paragraph.text);
    for (const part of parts) {
      if (!validDeterministicSentence(part)) continue;
      if (hasSourceMetadata(part)) {
        diagnostics.qualityGate.metadataLeakWarnings += 1;
        continue;
      }
      if (malformedAttribution(part)) {
        diagnostics.qualityGate.malformedAttributionWarnings += 1;
        continue;
      }
      // A paragraph that only restates the deck is the deck, not a paragraph.
      if (nearDuplicate(deck.text, part)) {
        mergeInto(deck, paragraph.evidence);
        continue;
      }
      const key = sentenceKeyOf(part);
      if (key === "") continue;
      const existing = index.get(key);
      if (existing === undefined) {
        index.set(key, sentencesWithEvidence.length);
        sentencesWithEvidence.push({ text: part, evidence: [...paragraph.evidence] });
        continue;
      }
      const target = existing < 0 ? deck : sentencesWithEvidence[existing];
      if (target) mergeInto(target, paragraph.evidence);
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
    deck,
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
  return composeArticleWithDiagnostics(story).article;
}

/**
 * The same composition, plus the counters behind it.
 *
 * Only admin surfaces and tests read the counters: how much provider metadata
 * normalization removed, how many duplicate claims merged and which variant
 * won, and what the quality gate refused. Users never see any of it.
 */
export function composeArticleWithDiagnostics(story: Story): {
  article: ReaderArticle;
  diagnostics: CompositionDiagnostics;
} {
  const diagnostics = createDiagnostics();
  if (story.understand?.article) return { article: story.understand.article, diagnostics };

  if (!story.understand) {
    // Normalize the source list first: this branch also reads excerpts directly
    // for entity context, and that text has to be the same clean text the
    // evidence selection sees. The quality gate is the backstop, not the fix.
    const { sources, normalization } = normalizeReaderSources(story.sourceList);
    diagnostics.sourceNormalization = { ...normalization };
    const cleanStory: Story = { ...story, sourceList: sources };
    const selection = selectReaderEvidence(story.title, sources);
    const fallback = !editorialNoise(story.what) ? story.what.trim() : "";
    const facts = mergeFacts(
      [...selection.facts, ...supplementalEntityFacts(cleanStory, selection)],
      diagnostics,
    );
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
      const sourceIndex = sources.findIndex((source) =>
        (source.excerpt ?? "").toLowerCase().includes(entity.name.toLowerCase()),
      );
      const raw =
        sourceIndex < 0
          ? undefined
          : readerSentences(sources[sourceIndex]?.excerpt ?? "").find((part) =>
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
    const gated = qualityGate(
      {
        deck,
        paragraphs: paragraphs.slice(0, facts.length <= 3 ? 2 : paragraphs.length),
      },
      diagnostics,
    );

    return { article: gated, diagnostics };
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
  return { article: qualityGate({ deck, paragraphs: cleanParagraphs }, diagnostics), diagnostics };
}
