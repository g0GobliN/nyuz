import { describe, expect, it } from "vitest";
import { classifySignificanceItem } from "@/lib/pipeline/significance-leg-a";

/**
 * The Leg A funnel's controls — where a delivered "Why it matters" line dies.
 *
 * The classifier answers one question per delivered briefing item, from the
 * same inputs the digest build read:
 *
 *   composed            a rung other than coverage justified a line from
 *                       stored facts
 *   no-evidence         nothing is stored for the ladder to quote (zero
 *                       enriched evidence units, no stored impact, no
 *                       before/after state)
 *   no-shape            evidence is stored but no unit carries a shape the
 *                       ladder may print
 *   rung-refused        a shape exists in the stored evidence but the ladder
 *                       refused it (the clause guards, the standalone guards,
 *                       or the why-vs-what gate)
 *
 * A coverage-count line is NOT a composed line for Leg A (the ruling of
 * 2026-10-23 on the audited edition: a source count dressed as significance,
 * printed above "Based on N sources"). It is still recorded, as
 * `coverageEligible`, because coverage is measurable without being eligible.
 */

describe("classifySignificanceItem", () => {
  it("composes a line when a money consequence is stored", () => {
    const classified = classifySignificanceItem({
      sourceCount: 1,
      whatHappened: "A court ruled against the vendor this week.",
      evidence: ["The filing asks for damages of more than $250 million and names two suppliers."],
    });
    expect(classified.stage).toBe("composed");
    expect(classified.justified).toBe(true);
    expect(classified.rung).toBe("consequence");
    expect(classified.ladderLine).toContain("$250 million");
  });

  it("composes a line when an effective binding change is stored", () => {
    const classified = classifySignificanceItem({
      sourceCount: 1,
      whatHappened: "Meta updated its terms for WhatsApp Business.",
      evidence: [
        "Kicking in on October 30, the TOS update won’t allow businesses to opt out of the new terms.",
      ],
    });
    expect(classified.stage).toBe("composed");
    expect(classified.rung).toBe("binding");
  });

  it("reports nothing stored when there is no evidence and one publisher", () => {
    const classified = classifySignificanceItem({
      sourceCount: 1,
      title: "A vendor ships a feature",
      whatHappened: "A vendor shipped a feature on Tuesday.",
      evidence: [],
    });
    expect(classified.stage).toBe("no-evidence");
    expect(classified.justified).toBe(false);
    expect(classified.evidenceUnits).toBe(0);
    expect(classified.ladderLine).toBe("");
  });

  it("reports stored-but-admission-dead evidence when units exist and no shape fires", () => {
    const classified = classifySignificanceItem({
      sourceCount: 1,
      title: "A spec sheet story",
      whatHappened: "The vendor published new benchmark numbers for its card.",
      evidence: ["The card ships with 12 gigabytes of memory and a 250 watt power limit."],
    });
    expect(classified.stage).toBe("no-shape");
    expect(classified.evidenceUnits).toBe(1);
  });

  it("reports a refused rung when a money clause exists but the guards refuse it", () => {
    const classified = classifySignificanceItem({
      sourceCount: 1,
      title: "A claim reduced to a fragment",
      whatHappened: "A court made a ruling in a long-running dispute.",
      // The money + consequence words live in the same unit, but the clause the
      // slice produces is a fragment (`But the settlement was not`) — the
      // clause guard refuses it and the ladder stays silent.
      evidence: ["But the settlement was not $10 million as the paper claimed."],
    });
    expect(classified.stage).toBe("rung-refused");
    expect(classified.candidates.length).toBeGreaterThan(0);
    expect(classified.candidates.some((c) => c.rung === "consequence" && c.refusal !== null)).toBe(
      true,
    );
  });

  it("records the why-vs-what gate as the refusal when a candidate restates the paragraph", () => {
    const candidate =
      "The filing asks for damages of more than $250 million and names two suppliers.";
    const classified = classifySignificanceItem({
      sourceCount: 1,
      title: "A damages story",
      whatHappened: candidate,
      evidence: [candidate],
    });
    expect(classified.stage).toBe("rung-refused");
    expect(
      classified.candidates.some(
        (c) => c.rung === "consequence" && c.refusal === "restates-the-paragraph",
      ),
    ).toBe(true);
  });

  it("never counts a coverage line as a justified line", () => {
    const classified = classifySignificanceItem({
      sourceCount: 4,
      title: "A multi-outlet story",
      whatHappened: "Both companies have reported downtime for a second day.",
      evidence: [],
    });
    expect(classified.rung).toBe("coverage");
    expect(classified.stage).toBe("no-evidence");
    expect(classified.justified).toBe(false);
    expect(classified.ladderLine).toBe("Four publishers reported this.");
    expect(classified.coverageEligible).toBe(true);
  });

  it("agrees marks whether the delivered row carries what the ladder now produces", () => {
    const line = "The filing asks for damages of more than $250 million and names two suppliers.";
    const agree = classifySignificanceItem({
      sourceCount: 1,
      whatHappened: "A court ruled against the vendor.",
      evidence: [line],
      deliveredLine: line,
    });
    expect(agree.deliveredCarried).toBe(true);
    expect(agree.deliveredAgrees).toBe(true);

    const silent = classifySignificanceItem({
      sourceCount: 1,
      title: "A vendor ships",
      whatHappened: "A vendor shipped.",
      evidence: [],
      deliveredLine: "",
    });
    expect(silent.deliveredCarried).toBe(false);
    expect(silent.deliveredAgrees).toBe(null);
  });

  it("still composes when stored fields carry the line (no evidence needed)", () => {
    const classified = classifySignificanceItem({
      sourceCount: 2,
      afterState: "The company now owns the smaller rival outright.",
      whatHappened: "An acquisition closed this week.",
    });
    expect(classified.stage).toBe("composed");
    expect(classified.rung).toBe("after-state");
  });

  it("marks stored fields with unusable prose as no-shape when no rung fires", () => {
    // A stored state of fewer than 20 characters is refused by the ladder's
    // own prose gate (`sentence`); evidence and coverage cannot rescue it.
    const classified = classifySignificanceItem({
      sourceCount: 1,
      afterState: "Now applies.",
      title: "A stub",
      whatHappened: "",
    });
    expect(classified.stage).toBe("no-shape");
  });
});
