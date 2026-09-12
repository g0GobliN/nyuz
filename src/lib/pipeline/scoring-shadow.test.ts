import { describe, expect, it } from "vitest";
import {
  ALERT_FLOOR,
  admissionAt,
  orderingKey,
  promotionVerdict,
  rankingAgreement,
  shadowReport,
  type ScoredPair,
} from "./scoring-shadow";
import { scoreEvent } from "./scoring";
import { extractFacts } from "./extract";

function pair(id: string, ai: number, code: number, novelty = 0): ScoredPair {
  return {
    eventId: id,
    ai: { importance: ai, novelty },
    deterministic: { importance: code, novelty, confidence: "high" },
  };
}

describe("admission agreement counts the four cells, not one accuracy figure", () => {
  it("separates a miss from an extra", () => {
    const metrics = admissionAt(
      [
        pair("both-in", 8, 8),
        pair("both-out", 1, 1),
        pair("code-only", 1, 8), // deterministic admits, model would not
        pair("model-only", 8, 1), // model admits, deterministic drops it
      ],
      6,
      "test",
    );
    expect(metrics.truePositives).toBe(1);
    expect(metrics.trueNegatives).toBe(1);
    expect(metrics.falsePositives).toBe(1);
    expect(metrics.falseNegatives).toBe(1);
    expect(metrics.agreement).toBe(0.5);
  });

  it("reports miss rate against what the model admitted, not against the corpus", () => {
    // 99 quiet events and one important one the deterministic scorer drops.
    // Accuracy is 99%; the miss rate is 100%, and the miss rate is the truth.
    const pairs = [
      ...Array.from({ length: 99 }, (_, i) => pair(`quiet-${i}`, 1, 1)),
      pair("important", 9, 2),
    ];
    const metrics = admissionAt(pairs, ALERT_FLOOR, "alert");
    expect(metrics.agreement).toBeCloseTo(0.99, 2);
    expect(metrics.missRate).toBe(1);
  });

  it("treats the floor as inclusive, the way the product does", () => {
    // alerts.ts fires on `importance >= IMPORTANT_FLOOR`.
    const metrics = admissionAt([pair("exactly-at-floor", 6, 6)], 6, "alert");
    expect(metrics.truePositives).toBe(1);
  });
});

describe("ranking agreement", () => {
  it("is total when both scorers order identically", () => {
    const pairs = [pair("a", 9, 9), pair("b", 5, 5), pair("c", 1, 1)];
    const metrics = rankingAgreement(pairs, 3);
    expect(metrics.topNOverlap).toBe(1);
    expect(metrics.pairwiseAgreement).toBe(1);
  });

  it("does not care about score distance, only order", () => {
    // A deterministic scorer compressed into 0-3 still ranks these correctly.
    const pairs = [pair("a", 9, 3), pair("b", 5, 2), pair("c", 1, 1)];
    expect(rankingAgreement(pairs, 3).pairwiseAgreement).toBe(1);
  });

  it("catches a scorer that picks the same set but shuffles it", () => {
    const pairs = [pair("a", 9, 1), pair("b", 5, 5), pair("c", 1, 9)];
    const metrics = rankingAgreement(pairs, 3);
    // Same three events, so the set a reader sees is identical...
    expect(metrics.topNOverlap).toBe(1);
    // ...but the order is reversed, which pairwise agreement reports.
    expect(metrics.pairwiseAgreement).toBe(0);
  });

  it("counts ties as agreement, because relevanceOf produces real ties", () => {
    const pairs = [pair("a", 4, 2), pair("b", 4, 2)];
    expect(rankingAgreement(pairs, 2).pairwiseAgreement).toBe(1);
  });

  it("folds novelty in at half weight, as the ordering key does", () => {
    expect(orderingKey(4, 6)).toBe(7);
    expect(orderingKey(7, 0)).toBe(7);
  });
});

describe("the promotion verdict refuses on the expensive error", () => {
  it("blocks on a high alert miss rate even when overall agreement is excellent", () => {
    const pairs = [
      ...Array.from({ length: 200 }, (_, i) => pair(`quiet-${i}`, 0, 0)),
      ...Array.from({ length: 10 }, (_, i) => pair(`important-${i}`, 8, 0)),
    ];
    const verdict = promotionVerdict(shadowReport(pairs));
    expect(verdict.ready).toBe(false);
    expect(verdict.blockers.join(" ")).toMatch(/Alert miss rate/);
  });

  it("tolerates extra admissions, which only cost the reader an extra story", () => {
    const pairs = Array.from({ length: 100 }, (_, i) =>
      // Deterministic scores everything a little high: lots of false positives,
      // no misses anywhere.
      i < 10 ? pair(`hot-${i}`, 8, 9) : pair(`warm-${i}`, 3, 6),
    );
    const verdict = promotionVerdict(shadowReport(pairs));
    expect(verdict.ready).toBe(true);
  });

  it("passes a scorer that reproduces the decisions", () => {
    const pairs = Array.from({ length: 100 }, (_, i) =>
      i < 10 ? pair(`hot-${i}`, 8, 7) : pair(`quiet-${i}`, 2, 2),
    );
    expect(promotionVerdict(shadowReport(pairs)).ready).toBe(true);
  });
});

describe("scoreEvent is evaluated at a caller-supplied clock", () => {
  // Five sources and a money figure, so the score sits well clear of the zero
  // floor. A single-source event cannot demonstrate this: it scores -1 fresh
  // and -2 stale, and `Math.max(0, …)` renders both as 0 — which is itself the
  // finding in the block below.
  const text = "Microsoft confirmed a $2 billion investment in the project.";
  const articles = Array.from({ length: 5 }, (_, i) => ({
    title: `Outlet ${i}: Microsoft confirms $2 billion investment`,
    excerpt: text,
    published_at: "2026-01-10T00:00:00Z",
  }));
  const facts = extractFacts(text, 0);
  const atAnalysis = new Date("2026-01-10T02:00:00Z");
  const today = new Date("2026-09-12T00:00:00Z");

  it("calls an event breaking when scored at its own analysis time", () => {
    expect(scoreEvent(articles, facts, atAnalysis).reasons).toContain("breaking");
  });

  it("calls the same event old when scored months later", () => {
    // The bug this parameter exists to prevent: replaying history against
    // today's clock marks every event stale and manufactures a disagreement
    // the scorer never actually had.
    const replayed = scoreEvent(articles, facts, today);
    expect(replayed.reasons).toContain("old");
    expect(replayed.importanceEstimate).toBeLessThan(
      scoreEvent(articles, facts, atAnalysis).importanceEstimate,
    );
  });
});

describe("the corpus-level finding this harness produced (2026-09-12)", () => {
  /**
   * Regression guard for the measurement itself, not for the scorer.
   *
   * The shadow run over 1,257 labelled events found the deterministic scorer
   * scoring 1,076 of them zero, because `single source` (-1) and `thin coverage`
   * (-1) fire on ~85% and ~81% of the corpus and the positive signals it knows
   * about (CVE, regulatory) fire on under 1%. These cases encode that shape so a
   * future scorer change that fixes it is visible as a test going green.
   */
  it("scores a mass-casualty story zero, having no signal for it", () => {
    const articles = [
      {
        title: "47 killed, dozens kidnapped in gang attack near Port-au-Prince",
        excerpt: "At least 47 people were killed in an attack on Friday.",
        published_at: "2026-01-10T00:00:00Z",
      },
    ];
    const signals = scoreEvent(
      articles,
      extractFacts("At least 47 people were killed in an attack.", 0),
      new Date("2026-01-10T02:00:00Z"),
    );
    // Single source (-1) + thin (-1) + breaking (+1) = -1, floored to 0.
    expect(signals.importanceEstimate).toBe(0);
    expect(signals.importanceEstimate).toBeLessThan(ALERT_FLOOR);
  });

  it("scores a head-of-government resignation zero for the same reason", () => {
    const articles = [
      {
        title: "Keir Starmer to stand down as MP, triggering byelection",
        excerpt: "The prime minister will leave parliament at the next election.",
        published_at: "2026-01-10T00:00:00Z",
      },
    ];
    const signals = scoreEvent(
      articles,
      extractFacts("The prime minister will leave parliament.", 0),
      new Date("2026-01-10T02:00:00Z"),
    );
    expect(signals.importanceEstimate).toBe(0);
  });
});
