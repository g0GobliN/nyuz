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
  };
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
  ];
}
