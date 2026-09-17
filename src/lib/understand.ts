import { readReaderArticle, type ReaderArticle } from "@/lib/reader-article";
import {
  extractMoney,
  extractPercentages,
  extractCompanies,
  extractProducts,
} from "./pipeline/extract";

export type CoverageDepth = "thin" | "normal" | "rich";
export type StatementKind = "reported" | "context" | "analysis";

export type SupportedStatement = {
  text: string;
  evidence: number[];
  kind: StatementKind;
};

export type KeyNumber = {
  value: string;
  label: string;
  evidence: number[];
};

export type TimelinePoint = {
  when: string;
  what: string;
  evidence: number[];
};

/** A real audience and what changes for them, not a restatement of who was mentioned. */
export type Audience = {
  audience: string;
  implication: string;
  evidence: number[];
};

export type EvidenceConflict = {
  topic: string;
  reports: { text: string; evidence: number[] }[];
};

export type RelationshipNode = {
  id: string;
  label: string;
  type?: string;
};

export type RelationshipEdge = {
  from: string;
  to: string;
  label?: string;
  evidence: number[];
};

/**
 * The structure the event turns on, as a small graph rather than one sentence.
 * Gated to genuinely multi-entity events -- see `relationshipsOf`.
 */
export type RelationshipMap = {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
};

export type ComparisonRow = {
  label: string;
  left: string;
  right: string;
  evidence: number[];
};

/** Two comparable states or entities, side by side. */
export type Comparison = {
  caption: string;
  leftLabel: string;
  rightLabel: string;
  rows: ComparisonRow[];
};

export type SeriesPoint = {
  label: string;
  value: number;
  display: string;
  evidence: number[];
};

/** Comparable numbers across periods or entities. Only ever drawn, never invented. */
export type NumericSeries = {
  caption: string;
  shape: "bar" | "line";
  points: SeriesPoint[];
};

/** One of several things announced together. */
export type OverviewItem = {
  name: string;
  kind: string;
  detail: string;
  evidence: number[];
};

/** A named source's stance, only meaningful next to at least one other. */
export type Perspective = {
  source: string;
  stance: string;
  evidence: number[];
};

/** A specific, checkable future development worth returning for. */
export type WatchItem = {
  label: string;
  detail: string;
  evidence: number[];
};

/** Either a real prior state to contrast, or what's new when there is none to fabricate. */
export type Change =
  | { mode: "before_now"; before: string; now: string }
  | { mode: "new"; items: SupportedStatement[] };

/**
 * How much evidence this document was actually generated from, so a reader-
 * facing "N sources" count that grows after analysis never gets credited to
 * text that never saw the extra sources. Written by the pipeline, not the
 * model -- never part of the JSON reply, always attached deterministically
 * from the real article count shown to it.
 */
export type AnalysisMeta = {
  sourceCountAtAnalysis: number;
  sourceArticleIds?: string[];
  coverageCountAtAnalysis?: number;
  /** Set once this document has already had its one material-enrichment refresh. */
  refreshedAfterEnrichment?: boolean;
};

/**
 * The global, reusable explanation of one event.
 *
 * Arrays are always present after parsing, even though every field in the model
 * reply is optional. That keeps the renderer deterministic: an empty array means
 * the evidence did not justify that block, so the block does not exist.
 *
 * Every claim belongs in exactly one section here. The prompt asks the model to
 * pick the single best home for each fact; `dedupeAcrossSections` is the
 * deterministic backstop for when it doesn't, since wording alone is not
 * reliable enough to promise a reader nothing repeats.
 */
export type EventIntelligence = {
  version: 2;
  /** Connected reader prose; absent on older analyses. */
  article?: ReaderArticle;
  coverage: CoverageDepth;
  oneSentence: string;
  numbers: KeyNumber[];
  newDevelopments: SupportedStatement[];
  relationships: RelationshipMap | null;
  audiences: Audience[];
  whatNext: SupportedStatement[];
  context: SupportedStatement[];
  perspectives: Perspective[];
  unknowns: string[];
  watchNext: WatchItem[];
  timeline: TimelinePoint[];
  conflicts: EvidenceConflict[];
  comparison: Comparison | null;
  series: NumericSeries | null;
  overview: OverviewItem[];
  /** Absent for every document written before this existed -- see `AnalysisMeta`. */
  analysisMeta?: AnalysisMeta;
};

type RecordValue = Record<string, unknown>;

const NULLISH = /^(null|none|unknown|n\/a|not (stated|specified|reported))\.?$/i;

function record(value: unknown): RecordValue | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as RecordValue;
}

function field(row: RecordValue, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean === "" || NULLISH.test(clean)) return null;
  return clean.slice(0, max);
}

function evidenceRefs(value: unknown, evidenceCount: number): number[] {
  if (!Array.isArray(value) || evidenceCount <= 0) return [];
  const out: number[] = [];
  for (const entry of value) {
    const ref = typeof entry === "number" ? entry : Number.parseInt(String(entry), 10);
    if (!Number.isInteger(ref) || ref < 1 || ref > evidenceCount || out.includes(ref)) continue;
    out.push(ref);
    if (out.length >= 8) break;
  }
  return out;
}

function statements(
  value: unknown,
  evidenceCount: number,
  kind: StatementKind,
  limit: number,
): SupportedStatement[] {
  if (!Array.isArray(value)) return [];
  const out: SupportedStatement[] = [];
  for (const entry of value) {
    const row = record(entry);
    if (!row) continue;
    const text = boundedText(row["text"], 420);
    const evidence = evidenceRefs(row["evidence"], evidenceCount);
    if (!text || evidence.length === 0) continue;
    out.push({ text, evidence, kind });
    if (out.length >= limit) break;
  }
  return dedupeStatements(out);
}

function numbersOf(value: unknown, evidenceCount: number): KeyNumber[] {
  if (!Array.isArray(value)) return [];
  const out: KeyNumber[] = [];
  for (const entry of value) {
    const row = record(entry);
    if (!row) continue;
    const numberValue = boundedText(row["value"], 80);
    const label = boundedText(row["label"], 100);
    const evidence = evidenceRefs(row["evidence"], evidenceCount);
    if (!numberValue || !label || evidence.length === 0) continue;
    out.push({ value: numberValue, label, evidence });
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * A node graph, not a sentence with arrows. The single subject-relation-object
 * triple this replaced repeated whatever the summary already said; requiring
 * either a second edge or a third node is what makes this a map worth drawing
 * instead of a fact drawn twice.
 */
function relationshipsOf(value: unknown, evidenceCount: number): RelationshipMap | null {
  const row = record(value);
  if (!row) return null;
  if (!Array.isArray(row["nodes"])) return null;

  const nodes: RelationshipNode[] = [];
  const ids = new Set<string>();
  for (const entry of row["nodes"]) {
    const node = record(entry);
    if (!node) continue;
    const id = boundedText(node["id"], 40);
    const label = boundedText(node["label"], 60);
    if (!id || !label || ids.has(id)) continue;
    const type = boundedText(node["type"], 30);
    nodes.push(type ? { id, label, type } : { id, label });
    ids.add(id);
    if (nodes.length >= 8) break;
  }
  if (nodes.length < 2 || !Array.isArray(row["edges"])) return null;

  const edges: RelationshipEdge[] = [];
  for (const entry of row["edges"]) {
    const edge = record(entry);
    if (!edge) continue;
    const from = boundedText(edge["from"], 40);
    const to = boundedText(edge["to"], 40);
    const evidence = evidenceRefs(edge["evidence"], evidenceCount);
    if (!from || !to || from === to || !ids.has(from) || !ids.has(to) || evidence.length === 0) {
      continue;
    }
    const label = boundedText(edge["label"], 40);
    edges.push(label ? { from, to, label, evidence } : { from, to, evidence });
    if (edges.length >= 10) break;
  }

  if (edges.length < 2 && nodes.length < 3) return null;
  return { nodes, edges };
}

/** An implication is only worth a reader's attention when it's grounded and specific. */
function audiencesOf(value: unknown, evidenceCount: number): Audience[] {
  if (!Array.isArray(value)) return [];
  const out: Audience[] = [];
  for (const entry of value) {
    const row = record(entry);
    if (!row) continue;
    const audience = boundedText(row["audience"] ?? row["group"], 100);
    const implication = boundedText(row["implication"] ?? row["effect"], 320);
    const evidence = evidenceRefs(row["evidence"], evidenceCount);
    if (!audience || !implication || evidence.length === 0) continue;
    out.push({ audience, implication, evidence });
    if (out.length >= 6) break;
  }
  return out;
}

/** A single viewpoint is a fact with a byline. Disagreement needs at least two. */
function perspectivesOf(value: unknown, evidenceCount: number): Perspective[] {
  if (!Array.isArray(value)) return [];
  const out: Perspective[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const row = record(entry);
    if (!row) continue;
    const source = boundedText(row["source"], 60);
    const stance = boundedText(row["stance"], 240);
    const evidence = evidenceRefs(row["evidence"], evidenceCount);
    if (!source || !stance || evidence.length === 0) continue;
    const key = source.toLowerCase();
    if (seen.has(key)) continue;
    out.push({ source, stance, evidence });
    seen.add(key);
    if (out.length >= 4) break;
  }
  return out.length >= 2 ? out : [];
}

function watchNextOf(value: unknown, evidenceCount: number): WatchItem[] {
  if (!Array.isArray(value)) return [];
  const out: WatchItem[] = [];
  for (const entry of value) {
    const row = record(entry);
    if (!row) continue;
    const label = boundedText(row["label"], 60);
    const detail = boundedText(row["detail"], 240);
    if (!label || !detail) continue;
    out.push({ label, detail, evidence: evidenceRefs(row["evidence"], evidenceCount) });
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * A comparison needs two sides that differ. Rows whose halves say the same thing
 * are the paraphrase problem in table form, so they are dropped; if that empties
 * the table, there was no comparison to draw.
 */
function comparisonOf(value: unknown, evidenceCount: number): Comparison | null {
  const row = record(value);
  if (!row) return null;
  const leftLabel = boundedText(field(row, "leftLabel", "left_label"), 40);
  const rightLabel = boundedText(field(row, "rightLabel", "right_label"), 40);
  if (!leftLabel || !rightLabel || !Array.isArray(row["rows"])) return null;

  const rows: ComparisonRow[] = [];
  for (const entry of row["rows"]) {
    const cells = record(entry);
    if (!cells) continue;
    const label = boundedText(cells["label"], 60);
    const left = boundedText(cells["left"], 90);
    const right = boundedText(cells["right"], 90);
    const evidence = evidenceRefs(cells["evidence"], evidenceCount);
    if (!label || !left || !right || evidence.length === 0) continue;
    if (left.toLowerCase() === right.toLowerCase()) continue;
    rows.push({ label, left, right, evidence });
    if (rows.length >= 5) break;
  }
  if (rows.length === 0) return null;
  return { caption: boundedText(row["caption"], 80) ?? "", leftLabel, rightLabel, rows };
}

/** Numbers a chart can honestly carry: at least three points, and not all equal. */
function seriesOf(value: unknown, evidenceCount: number): NumericSeries | null {
  const row = record(value);
  if (!row) return null;
  if (!Array.isArray(row["points"])) return null;

  const points: SeriesPoint[] = [];
  for (const entry of row["points"]) {
    const cells = record(entry);
    if (!cells) continue;
    const label = boundedText(cells["label"], 40);
    const display = boundedText(cells["display"], 40);
    const evidence = evidenceRefs(cells["evidence"], evidenceCount);
    const value = typeof cells["value"] === "number" ? cells["value"] : Number(cells["value"]);
    if (!label || !Number.isFinite(value) || evidence.length === 0) continue;
    points.push({ label, value, display: display ?? String(value), evidence });
    if (points.length >= 12) break;
  }

  // Two numbers are a comparison, not a trend, and one number is a key number.
  // A flat line of identical values communicates nothing a sentence would not.
  if (points.length < 3) return null;
  if (new Set(points.map((point) => point.value)).size < 2) return null;
  if (points.every((point) => point.value <= 0)) return null;

  const shape = row["shape"] === "line" ? "line" : "bar";
  return { caption: boundedText(row["caption"], 80) ?? "", shape, points };
}

/** An overview of one thing is a fact. Two or more is a list worth structuring. */
function overviewOf(value: unknown, evidenceCount: number): OverviewItem[] {
  if (!Array.isArray(value)) return [];
  const out: OverviewItem[] = [];
  for (const entry of value) {
    const row = record(entry);
    if (!row) continue;
    const name = boundedText(row["name"], 60);
    const evidence = evidenceRefs(row["evidence"], evidenceCount);
    if (!name || evidence.length === 0) continue;
    if (out.some((item) => item.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({
      name,
      kind: boundedText(row["kind"], 40) ?? "",
      detail: boundedText(row["detail"], 90) ?? "",
      evidence,
    });
    if (out.length >= 6) break;
  }
  return out.length >= 2 ? out : [];
}

/**
 * Read back, never trusted from a model reply -- this only ever appears in a
 * document the pipeline itself wrote. A malformed or missing value is simply
 * absent rather than defaulted, so a document with no real analysis metadata
 * (every document written before this existed) never looks eligible for
 * anything that depends on it.
 */
function analysisMetaOf(value: unknown): AnalysisMeta | undefined {
  const row = record(value);
  if (!row) return undefined;
  const sourceCountAtAnalysis = row["sourceCountAtAnalysis"];
  if (typeof sourceCountAtAnalysis !== "number" || !Number.isInteger(sourceCountAtAnalysis)) {
    return undefined;
  }
  if (sourceCountAtAnalysis < 0) return undefined;
  const refreshed = row["refreshedAfterEnrichment"];
  const ids = row["sourceArticleIds"];
  const coverageCount = row["coverageCountAtAnalysis"];
  return {
    sourceCountAtAnalysis,
    ...(typeof coverageCount === "number" &&
    Number.isInteger(coverageCount) &&
    coverageCount >= sourceCountAtAnalysis
      ? { coverageCountAtAnalysis: coverageCount }
      : {}),
    ...(refreshed === true ? { refreshedAfterEnrichment: true } : {}),
    ...(Array.isArray(ids) && ids.every((id) => typeof id === "string")
      ? { sourceArticleIds: ids as string[] }
      : {}),
  };
}

function claimText<T>(items: T[], textOf: (item: T) => string, claimed: string[]): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const text = textOf(item);
    if (claimed.some((existing) => repeats(existing, text))) continue;
    claimed.push(text);
    kept.push(item);
  }
  return kept;
}

/**
 * One claim, one section. The prompt asks the model to pick a single best home
 * for each fact, but that alone is not reliable enough to promise a reader
 * nothing repeats -- this is the deterministic backstop. Sections are walked in
 * a fixed priority order and anything that already appeared upstream, even
 * paraphrased, is dropped rather than printed again further down the page.
 *
 * Structural sections (relationships, timeline, comparison, series, overview)
 * are left alone: their rows are already internally deduplicated by their own
 * validators above, and a graph edge or a chart point is not prose that can
 * quietly restate a sentence.
 */
export function dedupeAcrossSections(
  intel: Omit<EventIntelligence, "version" | "coverage">,
): Omit<EventIntelligence, "version" | "coverage"> {
  const claimed: string[] = [intel.oneSentence];

  const numbers = claimText(intel.numbers, (n) => `${n.label} ${n.value}`, claimed);
  const newDevelopments = claimText(intel.newDevelopments, (s) => s.text, claimed);
  const audiences = claimText(intel.audiences, (a) => a.implication, claimed);
  const whatNext = claimText(intel.whatNext, (s) => s.text, claimed);
  const context = claimText(intel.context, (s) => s.text, claimed);
  let perspectives = claimText(intel.perspectives, (p) => p.stance, claimed);
  if (perspectives.length < 2) perspectives = [];
  const unknowns = claimText(intel.unknowns, (u) => u, claimed);
  const watchNext = claimText(intel.watchNext, (w) => w.detail, claimed);

  return {
    ...intel,
    numbers,
    newDevelopments,
    audiences,
    whatNext,
    context,
    perspectives,
    unknowns,
    watchNext,
  };
}

/**
 * Parse either the snake_case model reply or the camelCase document stored in
 * Postgres. Invalid optional blocks disappear; an invalid core returns null.
 *
 * Also the read-time home for events analysed before this shape (`version: 1`,
 * `summary`/`keyNumbers`/`affectedGroups`/a singular `relationship`): their
 * fields are mapped into the new names losslessly. No migration runs; a legacy
 * document just renders fewer of the new blocks (`newDevelopments`,
 * `perspectives`, `watchNext`) it was never generated with, and its singular
 * `relationship` triple has no second edge to offer so `relationships` stays
 * null -- the richness gate does that suppression for free.
 */
export function readEventIntelligence(
  value: unknown,
  evidenceCount: number,
): EventIntelligence | null {
  const raw = record(value);
  if (!raw) return null;

  const oneSentence =
    boundedText(raw["oneSentence"] ?? raw["one_sentence"], 320) ?? boundedText(raw["summary"], 500);
  const coverage = raw["coverage"];
  if (!oneSentence || (coverage !== "thin" && coverage !== "normal" && coverage !== "rich")) {
    return null;
  }

  const numbers = numbersOf(
    field(raw, "numbers", "numbers") ?? field(raw, "keyNumbers", "key_numbers"),
    evidenceCount,
  );

  const timeline: TimelinePoint[] = [];
  if (Array.isArray(raw["timeline"])) {
    for (const entry of raw["timeline"]) {
      const row = record(entry);
      if (!row) continue;
      const when = boundedText(row["when"], 80);
      const what = boundedText(row["what"], 240);
      const evidence = evidenceRefs(row["evidence"], evidenceCount);
      if (!when || !what || evidence.length === 0) continue;
      timeline.push({ when, what, evidence });
      if (timeline.length >= 8) break;
    }
  }

  const audiences = audiencesOf(
    field(raw, "audiences", "audiences") ?? field(raw, "affectedGroups", "affected_groups"),
    evidenceCount,
  );

  const unknowns: string[] = [];
  if (Array.isArray(raw["unknowns"])) {
    for (const entry of raw["unknowns"]) {
      const text = boundedText(entry, 240);
      if (!text || unknowns.includes(text)) continue;
      unknowns.push(text);
      if (unknowns.length >= 6) break;
    }
  }

  const conflicts: EvidenceConflict[] = [];
  if (Array.isArray(raw["conflicts"])) {
    for (const entry of raw["conflicts"]) {
      const row = record(entry);
      if (!row) continue;
      const topic = boundedText(row["topic"], 160);
      if (!topic || !Array.isArray(row["reports"])) continue;
      const reports: EvidenceConflict["reports"] = [];
      for (const report of row["reports"]) {
        const reportRow = record(report);
        if (!reportRow) continue;
        const text = boundedText(reportRow["text"], 280);
        const evidence = evidenceRefs(reportRow["evidence"], evidenceCount);
        if (!text || evidence.length === 0) continue;
        reports.push({ text, evidence });
        if (reports.length >= 4) break;
      }
      if (reports.length < 2) continue;
      conflicts.push({ topic, reports });
      if (conflicts.length >= 3) break;
    }
  }

  // A legacy document's singular `relationship` triple never clears the
  // richness gate on its own (one edge), so it is simply not translated --
  // the field just reads as absent, which is the correct rendering for it.
  const relationships = relationshipsOf(raw["relationships"], evidenceCount);

  const deduped = dedupeAcrossSections({
    oneSentence,
    numbers,
    newDevelopments: statements(field(raw, "newDevelopments", "new"), evidenceCount, "reported", 8),
    relationships,
    audiences,
    whatNext: statements(field(raw, "whatNext", "what_next"), evidenceCount, "reported", 5),
    context: statements(raw["context"], evidenceCount, "context", 5),
    perspectives: perspectivesOf(raw["perspectives"], evidenceCount),
    unknowns,
    watchNext: watchNextOf(field(raw, "watchNext", "watch_next"), evidenceCount),
    timeline,
    conflicts,
    comparison: comparisonOf(raw["comparison"], evidenceCount),
    series: seriesOf(raw["series"], evidenceCount),
    overview: overviewOf(raw["overview"], evidenceCount),
  });

  const analysisMeta = analysisMetaOf(raw["analysisMeta"]);
  const article = readReaderArticle(raw["article"], evidenceCount);

  return {
    version: 2,
    coverage,
    ...deduped,
    ...(article ? { article } : {}),
    ...(analysisMeta ? { analysisMeta } : {}),
  };
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "from",
  "this",
  "into",
  "has",
  "have",
  "was",
  "were",
  "will",
  "its",
  "their",
  "they",
  "are",
  "but",
  "not",
]);

const CANONICAL: Record<string, string> = {
  acquired: "acquire",
  acquiring: "acquire",
  acquisition: "acquire",
  buy: "acquire",
  buys: "acquire",
  bought: "acquire",
  purchase: "acquire",
  purchased: "acquire",
  agreement: "agree",
  agreed: "agree",
  announced: "announce",
  announcement: "announce",
  transaction: "deal",
  valued: "value",
  worth: "value",
  billion: "bn",
  million: "mn",
};

function tokens(text: string): Set<string> {
  const clean = text
    .toLowerCase()
    .replace(/\$\s*(\d+(?:\.\d+)?)\s*b(?:illion)?\b/g, "$1bn")
    .replace(/\$\s*(\d+(?:\.\d+)?)\s*m(?:illion)?\b/g, "$1mn");
  const out = new Set<string>();
  for (const raw of clean.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const token = CANONICAL[raw] ?? raw;
    if (token.length < 3 || STOP.has(token)) continue;
    out.add(token);
  }
  return out;
}

export function repeats(a: string, b: string): boolean {
  const left = tokens(a);
  const right = tokens(b);
  const smaller = Math.min(left.size, right.size);
  if (smaller === 0) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return smaller >= 3 && shared / smaller >= 0.8;
}

export function dedupeStatements<T extends { text: string }>(items: T[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (out.some((existing) => repeats(existing.text, item.text))) continue;
    out.push(item);
  }
  return out;
}

/** A decimal point, protected so a figure like "$2.5 billion" never splits into "2." and "5 billion". */
const DECIMAL_POINT_PLACEHOLDER = "\uE000";

export function sentences(text: string): string[] {
  const protectedText = text.replace(/(\d)\.(\d)/g, `$1${DECIMAL_POINT_PLACEHOLDER}$2`);
  return (protectedText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [protectedText])
    .map((sentence) =>
      sentence.replace(new RegExp(DECIMAL_POINT_PLACEHOLDER, "g"), ".").replace(/\s+/g, " ").trim(),
    )
    .filter((sentence) => sentence.length > 0);
}

function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

/** A bounded, de-duplicated briefing body for both new and legacy events. */
export function briefingText(text: string, maxWords = 90): string {
  const unique = dedupeStatements(sentences(text).map((sentence) => ({ text: sentence })));
  const selected: string[] = [];
  let words = 0;
  for (const item of unique) {
    const count = wordCount(item.text);
    if (selected.length > 0 && words + count > maxWords) break;
    selected.push(item.text);
    words += count;
  }
  return selected.join(" ");
}

/**
 * The part of `text` that says something the supplied statements do not.
 *
 * Several places need "the novel part of a paragraph that otherwise restates
 * known facts" -- a personalised note is frequently the summary re-stated with
 * one new clause attached. Dropping the whole paragraph loses the clause;
 * keeping it whole prints the same sentences twice. So the filter runs per
 * sentence.
 */
export function novelSentences(text: string, against: string[]): string {
  const seen = [...against];
  const kept: string[] = [];
  for (const sentence of sentences(text)) {
    if (seen.some((existing) => repeats(existing, sentence))) continue;
    seen.push(sentence);
    kept.push(sentence);
  }
  return kept.join(" ");
}

/**
 * What the page can truthfully say about how many sources fed this document.
 *
 * `analysisMeta` is absent for every document written before it existed --
 * absence is not evidence the current count and the analysed count match, so
 * the only honest fallback is the current count alone, same as the page said
 * before this existed. Once metadata exists, a gap between what was analysed
 * and what is now attached is stated plainly rather than rounded up to the
 * live number: the generated text never saw the sources that arrived after
 * it was written. The gap closes on its own once a material-enrichment
 * refresh succeeds and `sourceCountAtAnalysis` catches up -- nothing here
 * needs to know whether that has happened, only compare the two numbers.
 */
export function sourceCountLabel(
  analysisMeta: AnalysisMeta | undefined,
  currentSourceCount: number,
): string {
  const plural = (n: number) => (n === 1 ? "source" : "sources");
  if (!analysisMeta || analysisMeta.sourceCountAtAnalysis === currentSourceCount) {
    return `${currentSourceCount} ${plural(currentSourceCount)}`;
  }
  const { sourceCountAtAnalysis } = analysisMeta;
  return `${sourceCountAtAnalysis} ${plural(sourceCountAtAnalysis)} analyzed · ${currentSourceCount} currently`;
}

export type ReaderQuality = "thin" | "adequate" | "rich";

/**
 * An internal quality signal for the deterministic reader, never shown to
 * users -- word count alone conflates "long" with "good", so this weighs
 * evidence breadth (facts + context, already deduped) and source count too.
 * `relatedEventCount` gets a modest, capped boost: real background prose,
 * but not a substitute for evidence about the event itself.
 */
export function readerQuality(
  intel: Pick<EventIntelligence, "newDevelopments" | "context">,
  sourceCount: number,
  relatedEventCount = 0,
): ReaderQuality {
  const evidenceCount = intel.newDevelopments.length + intel.context.length;
  const words =
    intel.newDevelopments.reduce((total, item) => total + wordCount(item.text), 0) +
    intel.context.reduce((total, item) => total + wordCount(item.text), 0) +
    Math.min(relatedEventCount, 2) * 15;
  if (evidenceCount >= 8 && sourceCount >= 2 && words >= 250) return "rich";
  if (evidenceCount >= 3 && words >= 80) return "adequate";
  return "thin";
}

export function understandMinutes(texts: string[]): "<1 min" | "1 min" | "2 min" {
  const words = texts.reduce((total, text) => total + wordCount(text), 0);
  if (words < 120) return "<1 min";
  if (words < 260) return "1 min";
  return "2 min";
}

/**
 * The Before/Now block, or "New in this announcement" when there is no clean
 * prior state to contrast.
 *
 * `before`/`now` come from the event's own `before_state`/`after_state` -- shared
 * top-level fields the analysis pass already writes, not a second copy asked
 * for inside `understand` -- so a legacy event (analysed long before this
 * redesign) gets this block exactly like a new one. `newDevelopments` is the
 * fallback for when the coverage never supported a real prior state: never
 * fabricate one just to fill the shape.
 */
export function deriveChange(
  before: string | null | undefined,
  after: string | null | undefined,
  newDevelopments: SupportedStatement[],
  oneSentence: string,
): Change | null {
  const b = boundedText(before, 300);
  const a = boundedText(after, 300);
  if (b && a && b.toLowerCase() !== a.toLowerCase() && !repeats(b, a)) {
    return { mode: "before_now", before: b, now: a };
  }
  const items = newDevelopments.filter((item) => !repeats(item.text, oneSentence));
  return items.length > 0 ? { mode: "new", items } : null;
}

/**
 * One short, evidence-cited fact deterministically extracted from an
 * article's own public page (0090's `article_evidence.evidence`), or `null`
 * for a source that was never enriched -- see `evidence-extract.ts` for how
 * these are selected and `enrich.ts` for where the fetch happens. Never a
 * copy of the source's phrasing beyond one bounded sentence.
 */
export type EvidenceUnit = {
  kind: "fact" | "quote" | "uncertain";
  text: string;
  entities?: string[];
  /** Speaker name, for a `quote` unit only. */
  attribution?: string;
};

export type LegacyEvidence = {
  excerpt?: string | undefined;
  name?: string | undefined;
  enrichedEvidence?: EvidenceUnit[] | undefined;
};

/**
 * Like `dedupeStatements`, but a near-duplicate's evidence is folded into the
 * survivor instead of discarded -- three sources reporting the same fact reads
 * as one fact backed by three citations, not one fact backed by whichever
 * source happened to come first. Used where "N sources say the same thing"
 * needs to stay knowable after dedup, unlike the AI-authored path's dedup
 * (`dedupeAcrossSections`), which only ever needs to know a claim already has
 * a home.
 */
function dedupeMergingEvidence<T extends { text: string; evidence: number[] }>(items: T[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    const existing = out.find((o) => repeats(o.text, item.text));
    if (existing) {
      for (const ref of item.evidence)
        if (!existing.evidence.includes(ref)) existing.evidence.push(ref);
      continue;
    }
    out.push({ ...item, evidence: [...item.evidence] });
  }
  return out;
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * The text to scan for entities/numbers: an enriched source's own extracted
 * facts when it has them (richer, already fact-dense), else its RSS excerpt.
 * Quotes are excluded -- a quote's money/entity mentions are the speaker's
 * words, already carried verbatim in the quote itself.
 */
function combinedText(source: LegacyEvidence): string {
  if (source.enrichedEvidence?.length) {
    return source.enrichedEvidence
      .filter((u) => u.kind !== "quote")
      .map((u) => u.text)
      .join(" ");
  }
  return source.excerpt ?? "";
}

/** Named companies/products the sources actually mention, as one sentence rather than a tag list. */
function entityMentions(sources: LegacyEvidence[]): SupportedStatement | null {
  const seen = new Map<string, number[]>();
  sources.forEach((source, index) => {
    const text = combinedText(source);
    if (!text) return;
    for (const hit of [...extractCompanies(text, index), ...extractProducts(text, index)]) {
      seen.set(hit.value, [...(seen.get(hit.value) ?? []), index + 1]);
    }
  });
  const names = [...seen.keys()].slice(0, 4);
  if (names.length === 0) return null;
  const evidence = [...new Set(names.flatMap((n) => seen.get(n) ?? []))].slice(0, 8);
  return { text: `The coverage centers on ${joinNames(names)}.`, evidence, kind: "context" };
}

/**
 * Money amounts and percentages actually present in the sources, via
 * `extract.ts`'s regex matcher -- not attributed to a currency, since a
 * combined money match does not say which of $/€/£ it came from, and a wrong
 * symbol would be worse than none.
 */
function extractedNumbers(sources: LegacyEvidence[]): KeyNumber[] {
  const out: KeyNumber[] = [];
  const seen = new Set<string>();
  const push = (value: string, label: string, evidence: number) => {
    const key = `${label}:${value}`.toLowerCase();
    if (seen.has(key) || out.length >= 6) return;
    seen.add(key);
    out.push({ value, label, evidence: [evidence] });
  };
  sources.forEach((source, index) => {
    const text = combinedText(source);
    if (!text) return;
    for (const hit of extractMoney(text, index)) push(hit.value, "Amount mentioned", index + 1);
    for (const hit of extractPercentages(text, index)) {
      push(hit.value, "Percentage mentioned", index + 1);
    }
  });
  return out;
}

const EXCERPT_STATEMENTS_PER_SOURCE = 4;
const ENRICHED_STATEMENTS_PER_SOURCE = 8;

/**
 * One source's contribution to `newDevelopments`/`unknowns` -- its enriched
 * evidence units when it has them (already selected and fact-scored at
 * enrichment time, so a higher cap is safe), else sentences split from its
 * RSS excerpt exactly as before enrichment existed.
 */
function statementsFor(
  source: LegacyEvidence,
  ref: number,
): { statements: SupportedStatement[]; unknowns: string[] } {
  const enriched = source.enrichedEvidence;
  if (enriched && enriched.length > 0) {
    const statements: SupportedStatement[] = [];
    const unknowns: string[] = [];
    let kept = 0;
    for (const unit of enriched) {
      if (unit.kind === "quote") {
        if (!unit.attribution) continue;
        statements.push({
          text: `${unit.attribution} said: "${unit.text}"`,
          evidence: [ref],
          kind: "reported",
        });
        continue;
      }
      if (unit.kind === "uncertain") {
        unknowns.push(unit.text);
        continue;
      }
      if (kept >= ENRICHED_STATEMENTS_PER_SOURCE) continue;
      statements.push({ text: unit.text, evidence: [ref], kind: "reported" });
      kept += 1;
    }
    return { statements, unknowns };
  }
  const statements = sentences(source.excerpt ?? "")
    .filter((text) => text.length >= 40)
    .slice(0, EXCERPT_STATEMENTS_PER_SOURCE)
    .map((text) => ({ text: text.slice(0, 320), evidence: [ref], kind: "reported" as const }));
  return { statements, unknowns: [] };
}

/**
 * Deterministic fallback article for any event without model-authored prose --
 * a legacy analysis written before structured intelligence existed, a fresh
 * event whose on-demand generation never ran, or one opened while every AI
 * provider was unavailable. Built entirely from the source excerpts already
 * fetched, using `extract.ts`'s regex facts rather than a model, so it never
 * blocks on a provider and never requires one to exist. Deliberately produces
 * fewer blocks than an authored article rather than inventing depth: length
 * follows how much real evidence the excerpts hold, never a target.
 */
export function legacyEventIntelligence(input: {
  what: string;
  sources: LegacyEvidence[];
  relatedEvents?: { title: string }[];
}): EventIntelligence {
  const oneSentence =
    briefingText(input.what) || "The available sources do not contain a usable summary.";

  const anyEnriched = input.sources.some((s) => (s.enrichedEvidence?.length ?? 0) > 0);
  const perSource = input.sources.map((source, index) => statementsFor(source, index + 1));
  const rawStatements = perSource.flatMap((p) => p.statements);
  const rawUnknowns = perSource.flatMap((p) => p.unknowns);

  const newDevelopments = dedupeMergingEvidence(rawStatements)
    .filter((item) => !repeats(item.text, oneSentence))
    .slice(0, anyEnriched ? 28 : 12);

  const unknowns = [...new Set(rawUnknowns)]
    .filter((text) => !repeats(text, oneSentence))
    .slice(0, 6);

  // Longer excerpts that don't qualify as new-development facts.
  const excerptContext = input.sources.flatMap((source, index) =>
    sentences(source.excerpt ?? "")
      .filter((text) => text.length >= 60 && text.length < 200)
      .slice(0, 3)
      .map((text) => ({
        text: text.slice(0, 320),
        evidence: [index + 1],
        kind: "context" as const,
      })),
  );

  // How many distinct outlets, not how many articles -- syndicated copies of
  // one wire story must not read as independent confirmation. Only stated
  // when there is an actual fact to attach it to, never as filler on its own.
  const outlets = new Set(
    input.sources.map((s) => s.name?.trim().toLowerCase()).filter((n): n is string => Boolean(n)),
  );
  const hasFacts = newDevelopments.length > 0 || excerptContext.length > 0;
  const coverageStatement: SupportedStatement | null =
    hasFacts && outlets.size > 1
      ? {
          text: `${outlets.size} outlets are currently reporting on this development.`,
          evidence: [...new Set(newDevelopments.flatMap((s) => s.evidence))].slice(0, 8),
          kind: "context",
        }
      : null;

  // Genuinely related prior coverage, looked up deterministically by shared
  // topics -- see `relatedEventsFor` in briefing.ts. Never fetched just to
  // pad length; a caller only supplies this when a real relationship exists.
  const related = (input.relatedEvents ?? []).slice(0, 2);
  const relatedStatement: SupportedStatement | null =
    related.length > 0
      ? {
          text: `nyuz has also covered related developments: ${joinNames(related.map((r) => r.title))}.`,
          evidence: [],
          kind: "context",
        }
      : null;

  const entities = entityMentions(input.sources);
  const context = dedupeMergingEvidence([
    ...excerptContext,
    ...(entities ? [entities] : []),
    ...(coverageStatement ? [coverageStatement] : []),
    ...(relatedStatement ? [relatedStatement] : []),
  ])
    .filter((item) => !repeats(item.text, oneSentence))
    .slice(0, 8);

  const numbers = extractedNumbers(input.sources);

  const usableWords =
    wordCount(oneSentence) +
    newDevelopments.reduce((total, item) => total + wordCount(item.text), 0) +
    context.reduce((total, item) => total + wordCount(item.text), 0) +
    numbers.length * 3;
  const coverage: CoverageDepth =
    newDevelopments.length >= 6 && outlets.size >= 2 && usableWords >= 350
      ? "rich"
      : newDevelopments.length >= 3 && usableWords >= 100
        ? "normal"
        : "thin";

  // No timeline: source counts are not dates. A legacy event either has the
  // pipeline's own event timeline (which the page falls back to) or it has no
  // timeline at all -- manufacturing one from "N sources covered this" would be
  // filler dressed as evidence.

  return {
    version: 2,
    coverage,
    oneSentence,
    numbers,
    newDevelopments,
    relationships: null,
    audiences: [],
    whatNext: [],
    context,
    perspectives: [],
    unknowns,
    watchNext: [],
    timeline: [],
    conflicts: [],
    comparison: null,
    series: null,
    overview: [],
  };
}

/**
 * Collapse a timeline down to the stages that actually differ.
 *
 * `story.timeline` is one row per article — "Engadget published", three times
 * over for three Engadget pieces about one announcement. That is crawler
 * history, not how the event developed, so repeated stages fold into their first
 * appearance and near-paraphrases fold into each other.
 */
export function collapseTimeline(points: TimelinePoint[]): TimelinePoint[] {
  const out: TimelinePoint[] = [];
  for (const point of points) {
    const seen = out.find(
      (existing) =>
        existing.what.toLowerCase() === point.what.toLowerCase() ||
        repeats(existing.what, point.what),
    );
    if (seen) {
      for (const ref of point.evidence) if (!seen.evidence.includes(ref)) seen.evidence.push(ref);
      continue;
    }
    out.push({ ...point, evidence: [...point.evidence] });
  }
  return out;
}

/**
 * The timeline worth drawing: the analysed event stages when they exist, else
 * the collapsed publication record. Fewer than two distinct stages is not a
 * progression, and drawing a one-item timeline implies development that the
 * evidence does not show.
 */
export function eventTimeline(
  intelligence: EventIntelligence,
  fallback: TimelinePoint[],
): TimelinePoint[] {
  const source = intelligence.timeline.length > 0 ? intelligence.timeline : fallback;
  const collapsed = collapseTimeline(source);
  return collapsed.length >= 2 ? collapsed : [];
}

/**
 * How many distinct outlets stand behind a statement.
 *
 * Counted by source name, so eight syndicated copies of one wire story do not
 * read as eight independent confirmations.
 */
export function corroboration(evidence: number[], sourceNames: string[]): number {
  const outlets = new Set<string>();
  for (const ref of evidence) {
    const name = sourceNames[ref - 1];
    if (name) outlets.add(name.trim().toLowerCase());
  }
  return outlets.size;
}

export function intelligenceText(intelligence: EventIntelligence): string[] {
  return [
    intelligence.oneSentence,
    ...intelligence.numbers.map((item) => `${item.label} ${item.value}`),
    ...intelligence.newDevelopments.map((item) => item.text),
    ...intelligence.audiences.map((item) => `${item.audience} ${item.implication}`),
    ...intelligence.whatNext.map((item) => item.text),
    ...intelligence.context.map((item) => item.text),
    ...intelligence.perspectives.map((item) => `${item.source} ${item.stance}`),
    ...intelligence.timeline.map((item) => `${item.when} ${item.what}`),
    ...intelligence.unknowns,
    ...intelligence.watchNext.map((item) => `${item.label} ${item.detail}`),
    ...intelligence.conflicts.flatMap((item) => item.reports.map((report) => report.text)),
    ...(intelligence.comparison
      ? intelligence.comparison.rows.map((row) => `${row.label} ${row.left} ${row.right}`)
      : []),
    ...intelligence.overview.map((item) => `${item.name} ${item.kind} ${item.detail}`),
  ];
}
