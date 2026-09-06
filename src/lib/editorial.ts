import type { Story } from "@/lib/story";
import type { Audience } from "@/lib/understand";
import {
  readEventIntelligence,
  dedupeAcrossSections,
  legacyEventIntelligence,
  type EventIntelligence,
} from "@/lib/understand";

export type ArticleBlock = {
  type:
    | "paragraph"
    | "comparison"
    | "chart"
    | "overview"
    | "timeline"
    | "audience"
    | "whatNext"
    | "conflict"
    | "perspective"
    | "unknown";
  content: string;
  evidence: number[];
};

export type MarginNote = {
  text: string;
  evidence: number[];
  position: "inline" | "margin";
};

export type Citation = {
  ref: number;
  name: string;
};

export type EndMatter = {
  citations: Citation[];
  sourceCount: number;
};

export type ArticleSection = {
  heading: string;
  blocks: ArticleBlock[];
  marginNotes: MarginNote[];
};

export type Article = {
  sections: ArticleSection[];
  blocks: ArticleBlock[];
  marginNotes: MarginNote[];
  endMatter: EndMatter;
};

function blockTypeOf(kind: string): ArticleBlock["type"] {
  switch (kind) {
    case "comparison":
      return "comparison";
    case "chart":
      return "chart";
    case "overview":
      return "overview";
    case "timeline":
      return "timeline";
    case "audience":
      return "audience";
    case "whatNext":
      return "whatNext";
    case "conflict":
      return "conflict";
    case "perspective":
      return "perspective";
    case "unknown":
      return "unknown";
    default:
      return "paragraph";
  }
}

function evidenceFor(item: { evidence?: number[] }): number[] {
  return item.evidence ?? [];
}

type DedupedIntelligence = Omit<EventIntelligence, "version" | "coverage">;

function marginNotesFor(intelligence: DedupedIntelligence, sourceNames: string[]): MarginNote[] {
  const notes: MarginNote[] = [];
  for (const ref of intelligence.numbers.flatMap((n) => n.evidence)) {
    const name = sourceNames[ref - 1];
    if (name) notes.push({ text: name, evidence: [ref], position: "margin" });
  }
  for (const item of [
    ...intelligence.newDevelopments,
    ...intelligence.context,
    ...intelligence.whatNext,
    ...intelligence.audiences,
  ]) {
    for (const ref of item.evidence) {
      const name = sourceNames[ref - 1];
      if (name && !notes.some((n) => n.text === name)) {
        notes.push({ text: name, evidence: [ref], position: "margin" });
      }
    }
  }
  return notes;
}

function endMatterFrom(intelligence: DedupedIntelligence, sourceNames: string[]): EndMatter {
  const citations: Citation[] = [];
  const seen = new Set<number>();
  for (const item of [
    ...intelligence.numbers,
    ...intelligence.newDevelopments,
    ...intelligence.context,
    ...intelligence.whatNext,
    ...intelligence.audiences,
    ...intelligence.timeline,
    ...intelligence.watchNext,
    ...intelligence.conflicts.flatMap((c) => c.reports),
    ...(intelligence.comparison?.rows ?? []),
    ...intelligence.overview,
    ...intelligence.perspectives,
  ]) {
    for (const ref of item.evidence ?? []) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const name = sourceNames[ref - 1];
      if (name) citations.push({ ref, name });
    }
  }
  return { citations, sourceCount: sourceNames.length };
}

function buildSections(intelligence: DedupedIntelligence): ArticleSection[] {
  const sections: ArticleSection[] = [];

  if (intelligence.oneSentence) {
    sections.push({
      heading: "",
      blocks: [{ type: "paragraph", content: intelligence.oneSentence, evidence: [] }],
      marginNotes: [],
    });
  }

  if (intelligence.numbers.length > 0) {
    sections.push({
      heading: "By the numbers",
      blocks: intelligence.numbers.map((n) => ({
        type: "chart" as const,
        content: `${n.label} ${n.value}`,
        evidence: n.evidence,
      })),
      marginNotes: [],
    });
  }

  if (intelligence.newDevelopments.length > 0) {
    sections.push({
      heading: "What changed",
      blocks: intelligence.newDevelopments.map((d) => ({
        type: "paragraph" as const,
        content: d.text,
        evidence: d.evidence,
      })),
      marginNotes: [],
    });
  }

  if (intelligence.audiences.length > 0) {
    sections.push({
      heading: "Who should care",
      blocks: intelligence.audiences.map((a) => ({
        type: "audience" as const,
        content: `${a.audience}: ${a.implication}`,
        evidence: a.evidence,
      })),
      marginNotes: [],
    });
  }

  if (intelligence.context.length > 0) {
    sections.push({
      heading: "Context",
      blocks: intelligence.context.map((c) => ({
        type: "paragraph" as const,
        content: c.text,
        evidence: c.evidence,
      })),
      marginNotes: [],
    });
  }

  if (intelligence.overview.length > 0) {
    sections.push({
      heading: "What was announced",
      blocks: intelligence.overview.map((o) => ({
        type: "overview" as const,
        content: `${o.name}: ${o.detail}`,
        evidence: o.evidence,
      })),
      marginNotes: [],
    });
  }

  if (intelligence.comparison) {
    sections.push({
      heading: intelligence.comparison.caption || "Compared",
      blocks: intelligence.comparison.rows.map((r) => ({
        type: "comparison" as const,
        content: `${r.label}: ${r.left} vs ${r.right}`,
        evidence: r.evidence,
      })),
      marginNotes: [],
    });
  }

  if (intelligence.series) {
    sections.push({
      heading: intelligence.series.caption || "By the numbers",
      blocks: [
        {
          type: "chart" as const,
          content: intelligence.series.points.map((p) => `${p.label}: ${p.display}`).join(", "),
          evidence: intelligence.series.points.flatMap((p) => p.evidence),
        },
      ],
      marginNotes: [],
    });
  }

  if (intelligence.whatNext.length > 0) {
    sections.push({
      heading: "What happens next",
      blocks: intelligence.whatNext.map((w) => ({
        type: "whatNext" as const,
        content: w.text,
        evidence: w.evidence,
      })),
      marginNotes: [],
    });
  }

  if (intelligence.conflicts.length > 0) {
    sections.push({
      heading: "Reports differ",
      blocks: intelligence.conflicts.flatMap((c) =>
        c.reports.map((r) => ({
          type: "conflict" as const,
          content: `${c.topic}: ${r.text}`,
          evidence: r.evidence,
        })),
      ),
      marginNotes: [],
    });
  }

  if (intelligence.perspectives.length > 0) {
    sections.push({
      heading: "Different perspectives",
      blocks: intelligence.perspectives.map((p) => ({
        type: "perspective" as const,
        content: `${p.source}: ${p.stance}`,
        evidence: p.evidence,
      })),
      marginNotes: [],
    });
  }

  if (intelligence.unknowns.length > 0) {
    sections.push({
      heading: "Still unknown",
      blocks: intelligence.unknowns.map((u) => ({
        type: "unknown" as const,
        content: u,
        evidence: [],
      })),
      marginNotes: [],
    });
  }

  if (intelligence.timeline.length > 0) {
    sections.push({
      heading: "How this event formed",
      blocks: intelligence.timeline.map((t) => ({
        type: "timeline" as const,
        content: `${t.when}: ${t.what}`,
        evidence: t.evidence,
      })),
      marginNotes: [],
    });
  }

  if (intelligence.watchNext.length > 0) {
    sections.push({
      heading: "Watch next",
      blocks: intelligence.watchNext.map((w) => ({
        type: "whatNext" as const,
        content: `${w.label}: ${w.detail}`,
        evidence: w.evidence,
      })),
      marginNotes: [],
    });
  }

  return sections;
}

/**
 * Pure deterministic composer: transforms a Story and its reader's
 * audience into an editorial structure the renderer can consume.
 *
 * No side effects, no network calls, no randomness. Given the same
 * inputs it always returns the same Article.
 */
export function composeArticle(story: Story, audience: Audience): Article {
  const intelligence =
    story.understand ??
    readEventIntelligence(
      { what: story.what, sources: story.sourceList.map((s) => ({ excerpt: s.excerpt })) },
      story.sourceList.length,
    ) ??
    legacyEventIntelligence({ what: story.what, sources: story.sourceList });
  const deduped = dedupeAcrossSections(intelligence);
  const sourceNames = story.sourceList.map((s) => s.name);

  const blocks: ArticleBlock[] = [];
  const marginNotes = marginNotesFor(deduped, sourceNames);

  for (const section of buildSections(deduped)) {
    blocks.push(...section.blocks);
  }

  return {
    sections: buildSections(deduped),
    blocks,
    marginNotes,
    endMatter: endMatterFrom(deduped, sourceNames),
  };
}
