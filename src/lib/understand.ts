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

export type AffectedGroup = {
  group: string;
  effect: string;
  basis: "reported" | "analysis";
  evidence: number[];
};

export type EvidenceConflict = {
  topic: string;
  reports: { text: string; evidence: number[] }[];
};

/** Who did what to whom. One line, drawn rather than written. */
export type Relationship = {
  subject: string;
  relation: string;
  object: string;
  detail: string;
  evidence: number[];
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

/**
 * The global, reusable explanation of one event.
 *
 * Arrays are always present after parsing, even though every field in the model
 * reply is optional. That keeps the renderer deterministic: an empty array means
 * the evidence did not justify that block, so the block does not exist.
 */
export type EventIntelligence = {
  version: 1;
  coverage: CoverageDepth;
  summary: string;
  facts: SupportedStatement[];
  keyNumbers: KeyNumber[];
  context: SupportedStatement[];
  timeline: TimelinePoint[];
  affectedGroups: AffectedGroup[];
  whatNext: SupportedStatement[];
  unknowns: string[];
  conflicts: EvidenceConflict[];
  relationship: Relationship | null;
  comparison: Comparison | null;
  series: NumericSeries | null;
  overview: OverviewItem[];
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

/**
 * A relationship is only drawable when all three parts of the sentence survive.
 * A subject with no object is a fact, and belongs in prose.
 */
function relationshipOf(value: unknown, evidenceCount: number): Relationship | null {
  const row = record(value);
  if (!row) return null;
  const subject = boundedText(row["subject"], 60);
  const relation = boundedText(row["relation"], 40);
  const object = boundedText(row["object"], 60);
  const evidence = evidenceRefs(row["evidence"], evidenceCount);
  if (!subject || !relation || !object || evidence.length === 0) return null;
  if (subject.toLowerCase() === object.toLowerCase() || repeats(subject, object)) return null;
  return { subject, relation, object, detail: boundedText(row["detail"], 40) ?? "", evidence };
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
 * Parse either the snake_case model reply or the camelCase document stored in
 * Postgres. Invalid optional blocks disappear; an invalid core returns null.
 */
export function readEventIntelligence(
  value: unknown,
  evidenceCount: number,
): EventIntelligence | null {
  const raw = record(value);
  if (!raw) return null;

  const summary = boundedText(raw["summary"], 700);
  const coverage = raw["coverage"];
  if (!summary || (coverage !== "thin" && coverage !== "normal" && coverage !== "rich")) {
    return null;
  }

  const keyNumbers: KeyNumber[] = [];
  const rawNumbers = field(raw, "keyNumbers", "key_numbers");
  if (Array.isArray(rawNumbers)) {
    for (const entry of rawNumbers) {
      const row = record(entry);
      if (!row) continue;
      const numberValue = boundedText(row["value"], 80);
      const label = boundedText(row["label"], 100);
      const evidence = evidenceRefs(row["evidence"], evidenceCount);
      if (!numberValue || !label || evidence.length === 0) continue;
      keyNumbers.push({ value: numberValue, label, evidence });
      if (keyNumbers.length >= 6) break;
    }
  }

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

  const affectedGroups: AffectedGroup[] = [];
  const rawGroups = field(raw, "affectedGroups", "affected_groups");
  if (Array.isArray(rawGroups)) {
    for (const entry of rawGroups) {
      const row = record(entry);
      if (!row) continue;
      const group = boundedText(row["group"], 100);
      const effect = boundedText(row["effect"], 320);
      const basis = row["basis"];
      const evidence = evidenceRefs(row["evidence"], evidenceCount);
      if (
        !group ||
        !effect ||
        (basis !== "reported" && basis !== "analysis") ||
        evidence.length === 0
      ) {
        continue;
      }
      affectedGroups.push({ group, effect, basis, evidence });
      if (affectedGroups.length >= 6) break;
    }
  }

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

  return {
    version: 1,
    coverage,
    summary,
    facts: statements(raw["facts"], evidenceCount, "reported", 8),
    keyNumbers,
    context: statements(raw["context"], evidenceCount, "context", 5),
    timeline,
    affectedGroups,
    whatNext: statements(field(raw, "whatNext", "what_next"), evidenceCount, "reported", 5),
    unknowns,
    conflicts,
    relationship: relationshipOf(raw["relationship"], evidenceCount),
    comparison: comparisonOf(raw["comparison"], evidenceCount),
    series: seriesOf(raw["series"], evidenceCount),
    overview: overviewOf(raw["overview"], evidenceCount),
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

function repeats(a: string, b: string): boolean {
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

function sentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text])
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
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
 * A personalised "why it matters" is frequently the summary re-stated with one
 * new clause attached. Dropping the whole paragraph loses the clause; keeping it
 * whole prints the same three sentences twice. So the filter runs per sentence.
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

export function understandMinutes(texts: string[]): "<1 min" | "1 min" | "2 min" {
  const words = texts.reduce((total, text) => total + wordCount(text), 0);
  if (words < 120) return "<1 min";
  if (words < 260) return "1 min";
  return "2 min";
}

export type LegacyEvidence = { excerpt?: string | undefined };

/**
 * Evidence-aware fallback for events analysed before structured intelligence
 * existed. It deliberately produces fewer blocks rather than inventing depth.
 */
export function legacyEventIntelligence(input: {
  what: string;
  sources: LegacyEvidence[];
}): EventIntelligence {
  const summary =
    briefingText(input.what) || "The available sources do not contain a usable summary.";
  const excerptFacts = input.sources.flatMap((source, index) =>
    sentences(source.excerpt ?? "")
      .filter((text) => text.length >= 40)
      .slice(0, 3)
      .map((text) => ({
        text: text.slice(0, 320),
        evidence: [index + 1],
        kind: "reported" as const,
      })),
  );
  const facts = dedupeStatements(excerptFacts).slice(0, 8);
  const usableWords =
    wordCount(summary) + facts.reduce((total, fact) => total + wordCount(fact.text), 0);
  const coverage: CoverageDepth =
    facts.length >= 8 && input.sources.length >= 3 && usableWords >= 350
      ? "rich"
      : facts.length >= 4 && usableWords >= 100
        ? "normal"
        : "thin";

  // Add context from longer excerpts that don't qualify as facts
  const context = input.sources.flatMap((source, index) =>
    sentences(source.excerpt ?? "")
      .filter((text) => text.length >= 60 && text.length < 200)
      .slice(0, 2)
      .map((text) => ({
        text: text.slice(0, 320),
        evidence: [index + 1],
        kind: "context" as const,
      })),
  );

  // No timeline: source counts are not dates. A legacy event either has the
  // pipeline's own event timeline (which the page falls back to) or it has no
  // timeline at all — manufacturing one from "N sources covered this" would be
  // filler dressed as evidence.

  return {
    version: 1,
    coverage,
    summary,
    facts,
    keyNumbers: [],
    context: dedupeStatements(context).slice(0, 6),
    timeline: [],
    affectedGroups: [],
    whatNext: [],
    unknowns: [],
    conflicts: [],
    relationship: null,
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
    intelligence.summary,
    ...intelligence.facts.map((item) => item.text),
    ...intelligence.context.map((item) => item.text),
    ...intelligence.timeline.map((item) => `${item.when} ${item.what}`),
    ...intelligence.affectedGroups.map((item) => `${item.group} ${item.effect}`),
    ...intelligence.whatNext.map((item) => item.text),
    ...intelligence.unknowns,
    ...intelligence.conflicts.flatMap((item) => item.reports.map((report) => report.text)),
    ...(intelligence.comparison
      ? intelligence.comparison.rows.map((row) => `${row.label} ${row.left} ${row.right}`)
      : []),
    ...intelligence.overview.map((item) => `${item.name} ${item.kind} ${item.detail}`),
  ];
}
