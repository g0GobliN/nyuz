import type { Story } from "@/lib/story";
import type { ArticleParagraph, ReaderArticle } from "@/lib/reader-article";

function sentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean && !/[.!?…]$/.test(clean) ? `${clean}.` : clean;
}

/** Prefer authored prose. Older events retain their facts without analytical UI. */
export function composeArticle(story: Story): ReaderArticle {
  if (story.understand?.article) return story.understand.article;

  const intel = story.understand;
  const deck = { text: story.what.trim() || intel?.oneSentence || "", evidence: [] as number[] };
  const paragraphs: ArticleParagraph[] = [];
  const seen = new Map<string, { evidence: number[] }>([[sentence(deck.text).toLowerCase(), deck]]);
  const add = (items: { text: string; evidence: number[] }[]) => {
    const kept: string[] = [];
    const evidence: number[] = [];
    const paragraph = { text: "", evidence };
    for (const item of items) {
      const text = sentence(item.text);
      if (!text) continue;
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

  add([plain(story.before), plain(story.after), ...(intel?.newDevelopments ?? [])]);
  if (intel) {
    add([plain(intel.oneSentence), ...intel.context]);
    add(intel.numbers.map((n) => ({ text: `${n.label}: ${n.value}`, evidence: n.evidence })));
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
