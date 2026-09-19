import type { Story } from "@/lib/story";
import type { ArticleParagraph, ReaderArticle } from "@/lib/reader-article";
import { legacyEventIntelligence } from "@/lib/understand";
import { editorialNoise, selectReaderEvidence } from "./reader-evidence";
import { relatedContext } from "./related-events";

function sentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean && !/[.!?…]["”]?$/.test(clean) ? `${clean}.` : clean;
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
    const lead = selection.lead;
    const fallback = !editorialNoise(story.what) ? story.what.trim() : "";
    const outlet = new Set(story.sourceList.map((s) => s.name.trim().toLowerCase()));
    const name = lead ? story.sourceList[lead.evidence[0]! - 1]?.name : undefined;
    const leadText = lead?.text ?? fallback;
    const deck = {
      text:
        lead && outlet.size === 1 && name
          ? `According to ${name}, ${leadText.replace(/^(The|A|An)\b/, (s) => s.toLowerCase())}`
          : leadText,
      evidence: lead?.evidence ?? [],
    };
    const paragraphs: ArticleParagraph[] = [];
    let words = leadText.split(/\s+/).length;
    // Compose bounded evidence blocks rather than printing every selected
    // sentence as its own paragraph. Blocks were grouped only on shared claims
    // or shared citations, so this cannot invent a relationship between facts.
    const blocks = selection.blocks
      .map((block) => ({ ...block, facts: block.facts.filter((fact) => fact !== lead) }))
      .filter((block) => block.facts.length > 0);
    for (const block of blocks) {
      const text = block.facts.map((fact) => sentence(fact.text)).join(" ");
      const size = text.split(/\s+/).length;
      if (words + size > 850) continue;
      const evidence = [...new Set(block.facts.flatMap((fact) => fact.evidence))];
      const prior = paragraphs.at(-1);
      if (prior && prior.text.split(/\s+/).length + size <= 110 && block.role === "context") {
        prior.text += ` ${text}`;
        prior.evidence = [...new Set([...prior.evidence, ...evidence])];
      } else {
        paragraphs.push({ text, evidence });
      }
      words += size;
    }
    for (const candidate of story.relatedEvents ?? []) {
      const context = relatedContext({ title: story.title, summary: leadText }, candidate);
      if (context) paragraphs.push({ text: sentence(context), evidence: [] });
    }
    return { deck, paragraphs };
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
  const seen = new Map<string, { evidence: number[] }>([[sentence(deck.text).toLowerCase(), deck]]);
  const add = (items: { text: string; evidence: number[] }[]) => {
    const kept: string[] = [];
    const evidence: number[] = [];
    const paragraph = { text: "", evidence };
    for (const item of items) {
      const text = sentence(item.text);
      if (!text || editorialNoise(text)) continue;
      const key = text.toLowerCase();
      const existing = seen.get(key);
      if (existing) {
        for (const ref of item.evidence) {
          if (!existing.evidence.includes(ref)) existing.evidence.push(ref);
        }
        continue;
      }
      seen.set(key, paragraph);
      kept.push(text);
      for (const ref of item.evidence) if (!evidence.includes(ref)) evidence.push(ref);
    }
    if (kept.length) {
      paragraph.text = kept.join(" ");
      paragraphs.push(paragraph);
    }
  };
  const plain = (text: string) => ({ text, evidence: [] as number[] });

  add([plain(story.before), plain(story.after), ...intel.newDevelopments]);
  {
    add([plain(intel.oneSentence), ...intel.context]);
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
  return { deck, paragraphs };
}
