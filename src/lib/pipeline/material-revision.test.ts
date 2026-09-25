import { describe, expect, it } from "vitest";
import {
  contentVersion,
  coverageTextOf,
  decideMaterialRevision,
  latestPublishedAt,
  materialState,
} from "./event-version";
import { detectScripts, markersIn, releaseIdentity } from "./marker-packs";

const article = (title: string, excerpt: string) => ({ title, excerpt });

const stateOf = (title: string, excerpt: string) =>
  materialState(coverageTextOf([article(title, excerpt)]));

const at = (iso: string) => iso;

describe("a release stage is a material development (the flagship case)", () => {
  it("separates an announcement from a release candidate", () => {
    const announced = stateOf("Rust 2.0 announced", "The Rust team has announced Rust 2.0.");
    const candidate = stateOf(
      "Rust 2.0 release candidate published",
      "The first Rust 2.0 release candidate is now available to test.",
    );
    expect(announced.markers).toContain("release_announced");
    expect(candidate.markers).toContain("release_candidate");
    expect(candidate.markers).not.toStrictEqual(announced.markers);
  });

  it.each([
    ["beta", "Rust 2.0 beta published", "The Rust 2.0 beta is ready for testing."],
    ["preview", "Rust 2.0 preview build", "A developer preview of Rust 2.0 is available."],
    ["candidate", "Rust 2.0 rc1", "The first Rust 2.0 release candidate shipped today."],
    ["final", "Rust 2.0 released", "Rust 2.0 is now available to download."],
  ])("separates an announcement from a %s", (_stage, title, excerpt) => {
    const announced = stateOf("Rust 2.0 announced", "The Rust team has announced Rust 2.0.");
    const later = stateOf(title, excerpt);
    expect(later.markers).not.toStrictEqual(announced.markers);
  });

  it("does not fire release stages on ordinary headlines without a version", () => {
    expect(markersIn("The minister announced a new policy today.")).not.toContain(
      "release_announced",
    );
    expect(markersIn("Officials released a statement.")).toContain("released");
    expect(markersIn("Officials announced a statement.")).not.toContain("release_announced");
  });

  it("separates an announced acquisition from a completed one", () => {
    const announced = stateOf(
      "Acme to acquire Widget Co",
      "Acme has agreed to acquire Widget Co for $2 billion.",
    );
    const completed = stateOf(
      "Acme completes Widget Co acquisition",
      "The acquisition has completed and the deal is closed.",
    );
    expect(announced.markers).toContain("deal_agreed");
    expect(completed.markers).toContain("deal_completed");
    expect(completed.markers).not.toStrictEqual(announced.markers);
  });

  it("carries version identity", () => {
    expect(releaseIdentity("Rust 2.0 release candidate shipped.").versions).toContain("2.0");
    expect(stateOf("Rust 2.0 released", "Rust 2.0 is out.").entities).toContain("version:2.0");
  });

  it("does not read money or years as versions", () => {
    expect(releaseIdentity("Acme raised $2.0 billion in 2026.").versions).toStrictEqual([]);
    expect(releaseIdentity("The 2026 report was released.").versions).toStrictEqual([]);
  });
});

describe("nothing that is not a development moves the state", () => {
  it("is unchanged when another outlet reprints the same facts", () => {
    const first = stateOf(
      "Acme in talks to buy Widget Co",
      "Acme is in talks to acquire Widget Co.",
    );
    const reprinted = stateOf(
      "Acme in talks to buy Widget Co",
      "Acme is in talks to acquire Widget Co.",
    );
    expect(reprinted).toStrictEqual(first);
  });

  it("is unchanged by coverage volume, which is not a source count in the state", () => {
    const one = materialState("Acme has confirmed the acquisition.");
    const many = materialState(
      [
        "Acme has confirmed the acquisition.",
        "Acme has confirmed the acquisition.",
        "Acme has confirmed the acquisition.",
      ].join("\n---\n"),
    );
    expect(many).toStrictEqual(one);
  });

  it("is unchanged when a second outlet reports the same facts", async () => {
    const line = "The council is considering plans for a new library.";
    const before = coverageTextOf([article("Library plans considered", line)]);
    const after = coverageTextOf([
      article("Library plans considered", line),
      // A different publisher, the same facts. Source identity is not an input
      // and a second outlet is not a development.
      article("City weighs new library", line),
    ]);
    expect(materialState(after)).toStrictEqual(materialState(before));
    expect(await contentVersion(after)).toBe(await contentVersion(before));
  });

  it("does move when a second outlet reports something the coverage did not say", () => {
    const before = coverageTextOf([
      article("Acme confirms deal", "Acme confirmed the $2 billion deal."),
    ]);
    const after = coverageTextOf([
      article("Acme confirms deal", "Acme confirmed the $2 billion deal."),
      article("Regulator clears Acme deal", "The sale was approved by the regulator."),
    ]);
    // This is not "a new publisher changed the fingerprint"; it is "the story
    // now contains a transition it did not contain". The new outlet is how the
    // sentence arrived, not why the state moved.
    expect(materialState(after).markers).toContain("regulator_approved");
  });

  it("is unchanged by publisher_count and article_count, which live in metadata only", () => {
    // `finalizeMetadata` writes article_count/publisher_count onto the event;
    // `materialState` has no such parameters and this test is the guard that
    // nobody adds them.
    const text = "Acme has confirmed the acquisition.";
    expect(materialState(text)).toStrictEqual(materialState(text));
  });

  it("keeps a corrected figure in the same magnitude bucket", () => {
    const early = stateOf("Quake", "At least 12 people were killed.");
    const corrected = stateOf("Quake", "At least 14 people were killed.");
    expect(corrected.magnitudes).toStrictEqual(early.magnitudes);
  });

  it("does change on an order-of-magnitude casualty move", () => {
    const early = stateOf("Quake", "At least 12 people were killed.");
    const later = stateOf("Quake", "At least 4000 people were killed.");
    expect(later.magnitudes).not.toStrictEqual(early.magnitudes);
  });

  /**
   * Known bucket behaviour, documented rather than accidentally changed: the
   * bucket is a power of ten, so $1.1B -> $1.3B is the same state (correct) and
   * $1.1B -> $4B is *also* the same bucket (a false negative, and the reason
   * magnitudes alone are never the only signal).
   */
  it("documents the bucket boundaries for money", () => {
    const a = materialState("The deal is worth $1.1 billion.");
    const b = materialState("The deal is worth $4 billion.");
    expect(b.magnitudes).toStrictEqual(a.magnitudes);
    const small = materialState("The deal is worth $40 million.");
    expect(small.magnitudes).not.toStrictEqual(a.magnitudes);
  });
});

describe("Japanese and Chinese coverage is not invisible", () => {
  it("detects the scripts a story is written in", () => {
    expect(detectScripts("日本の音楽シーン")).toContain("ja");
    expect(detectScripts("中国音乐市场")).toContain("zh");
    expect(detectScripts("한국 음악 시장")).toContain("ko");
  });

  it("fires a Japanese development marker no English regex can see", async () => {
    const before = coverageTextOf([
      article("新アルバムを発表", "アーティストが新アルバムを発表した。"),
    ]);
    const after = coverageTextOf([
      article("新アルバムを発表", "アーティストが新アルバムを発表した。"),
      article("新アルバムをリリース", "新アルバムが本日リリースされた。"),
    ]);
    expect(await contentVersion(after)).not.toBe(await contentVersion(before));
    expect(materialState(after).markers).toContain("released");
  });

  it("fires a Chinese release marker", async () => {
    const before = coverageTextOf([article("新产品预告", "该公司公布了新产品计划。")]);
    const after = coverageTextOf([
      article("新产品预告", "该公司公布了新产品计划。"),
      article("新产品正式发布", "新产品今日正式发布。"),
    ]);
    expect(await contentVersion(after)).not.toBe(await contentVersion(before));
  });

  it("does not read a negated Japanese confirmation as a confirmation", () => {
    const state = materialState("買収はまだ確認されていない。");
    expect(state.markers).not.toContain("deal_confirmed");
  });

  it("fires a Korean marker", () => {
    expect(materialState("신제품이 오늘 출시되었다.").markers).toContain("released");
  });
});

describe("latestPublishedAt", () => {
  it("reads the newest publication time and ignores undated evidence", () => {
    expect(
      latestPublishedAt([
        { published_at: "2026-09-01T00:00:00Z" },
        { published_at: null },
        { published_at: "2026-09-07T00:00:00Z" },
        { published_at: "not a date" },
      ]),
    ).toBe("2026-09-07T00:00:00Z");
  });

  it("returns null when nothing is dated", () => {
    expect(latestPublishedAt([{ published_at: null }])).toBeNull();
  });
});

describe("decideMaterialRevision", () => {
  const fingerprint = "v2|m=released|n=|e=version:2.0";

  it("adopts the first finalization without advancing a revision", () => {
    const decision = decideMaterialRevision({
      storedFingerprint: null,
      storedOccurrenceAt: null,
      nextFingerprint: fingerprint,
      latestPublishedAt: at("2026-09-01T00:00:00Z"),
      now: new Date("2026-09-25T00:00:00Z"),
    });
    expect(decision.changed).toBe(false);
    expect(decision.fingerprint).toBe(fingerprint);
    expect(decision.occurrenceAt).toBe("2026-09-01T00:00:00Z");
    expect(decision.reason).toBe("first_finalization");
  });

  it("advances on a material change with newer evidence", () => {
    const decision = decideMaterialRevision({
      storedFingerprint: "v2|m=|n=|e=version:2.0",
      storedOccurrenceAt: at("2026-09-01T00:00:00Z"),
      nextFingerprint: fingerprint,
      latestPublishedAt: at("2026-09-07T00:00:00Z"),
      now: new Date("2026-09-07T12:00:00Z"),
    });
    expect(decision.changed).toBe(true);
    expect(decision.reason).toBe("material_change");
    expect(decision.occurrenceAt).toBe("2026-09-07T00:00:00Z");
  });

  it("does nothing when the state did not move", () => {
    const decision = decideMaterialRevision({
      storedFingerprint: fingerprint,
      storedOccurrenceAt: at("2026-09-07T00:00:00Z"),
      nextFingerprint: fingerprint,
      latestPublishedAt: at("2026-09-08T00:00:00Z"),
      now: new Date("2026-09-08T00:00:00Z"),
    });
    expect(decision.changed).toBe(false);
    expect(decision.reason).toBe("unchanged");
    expect(decision.fingerprint).toBeNull();
  });

  it("rejects a rehash discovered today: the state moved on evidence we already had", () => {
    const decision = decideMaterialRevision({
      storedFingerprint: "v2|m=|n=|e=version:2.0",
      storedOccurrenceAt: at("2026-09-07T00:00:00Z"),
      nextFingerprint: fingerprint,
      // Published before the state we already recorded, even though Nyuz is
      // only seeing it now.
      latestPublishedAt: at("2026-09-02T00:00:00Z"),
      now: new Date("2026-09-25T00:00:00Z"),
    });
    expect(decision.changed).toBe(false);
    expect(decision.reason).toBe("stale_evidence");
    expect(decision.occurrenceAt).toBeNull();
  });

  it("rejects evidence published at exactly the same instant as the current state", () => {
    const decision = decideMaterialRevision({
      storedFingerprint: "v2|m=|n=|e=version:2.0",
      storedOccurrenceAt: at("2026-09-07T00:00:00Z"),
      nextFingerprint: fingerprint,
      latestPublishedAt: at("2026-09-07T00:00:00Z"),
      now: new Date("2026-09-25T00:00:00Z"),
    });
    expect(decision.changed).toBe(false);
    expect(decision.reason).toBe("stale_evidence");
  });

  it("is decided by evidence, never by wall-clock time", () => {
    const input = {
      storedFingerprint: "v2|m=|n=|e=version:2.0",
      storedOccurrenceAt: at("2026-09-01T00:00:00Z"),
      nextFingerprint: fingerprint,
      latestPublishedAt: at("2026-09-07T00:00:00Z"),
    };
    expect(
      decideMaterialRevision({ ...input, now: new Date("2026-09-08T00:00:00Z") }),
    ).toStrictEqual(decideMaterialRevision({ ...input, now: new Date("2027-01-01T00:00:00Z") }));
  });
});
