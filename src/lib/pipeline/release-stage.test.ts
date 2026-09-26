import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  coverageTextOf,
  decideMaterialRevision,
  materialStamp,
  materialState,
  storedMaterialFingerprint,
} from "./event-version";
import {
  MARKER_PACKS,
  hasAffirmativeDealConfirmation,
  markersIn,
  releaseIdentity,
  type MarkerPack,
} from "./marker-packs";

/**
 * Release stages and version identity, in every script the product reads.
 *
 * The property: the *same* version at a *later* stage is a new material state,
 * and nothing else is. Bare `RC` has to count (it is how most projects write it),
 * a CJK release has to carry its version the way an English one does, and a
 * stage word with no version behind it -- 正式版, "announced" -- must never be
 * what moves a fingerprint.
 */

const stagesOf = (text: string) => releaseIdentity(text).stages;
const versionsOf = (text: string) => releaseIdentity(text).versions;
const fingerprint = (text: string) => storedMaterialFingerprint(text);

describe("release candidates, including a bare RC", () => {
  it.each([
    "Rust 2.0 RC",
    "Rust 2.0 rc",
    "Rust 2.0 Rc",
    "Rust 2.0 RC is out",
    "Rust 2.0 rc1",
    "Rust 2.0 RC1 is available for testing",
    "Rust 2.0rc1",
    "Rust v2.0-rc.2 tagged",
    "Rust 2.0 release candidate published",
  ])("reads %j as the 2.0 release candidate", (text) => {
    expect(stagesOf(text)).toEqual(["release_candidate"]);
    expect(versionsOf(text)).toEqual(["2.0"]);
    const stored = fingerprint(text);
    expect(stored.startsWith(`${materialStamp()}|`)).toBe(true);
    expect(stored).toContain("release_candidate");
    expect(stored).toContain("version:2.0");
  });

  it("gives the candidate a state distinct from the announcement and the release", () => {
    const announced = fingerprint("Rust 2.0 announced");
    const candidate = fingerprint("Rust 2.0 announced.\nRust 2.0 RC is out.");
    const final = fingerprint("Rust 2.0 announced.\nRust 2.0 RC is out.\nRust 2.0 released.");
    expect(new Set([announced, candidate, final]).size).toBe(3);
  });

  it("is the same state for the same candidate reported twice", () => {
    expect(fingerprint("Rust 2.0 RC is out.\nRust 2.0 RC is out.")).toBe(
      fingerprint("Rust 2.0 RC is out."),
    );
    expect(fingerprint("Rust 2.0 rc")).toBe(fingerprint("RUST 2.0 RC"));
  });

  it.each([
    ["RC Cola 2.0 launched nationwide", ["release_final"]],
    ["The RC car hobby grew 2.5 percent", []],
    ["The rc.local script in version 3.1 was removed", []],
    ["Version 3.1 rc.d scripts were removed", []],
    ["The npmrc file changed in 2.0 released today", ["release_final"]],
  ])("does not read an unrelated rc in %j as a release candidate", (text, stages) => {
    expect(stagesOf(text)).toEqual(stages);
  });
});

describe("CJK stages carry version identity, and never need an English word", () => {
  it.each([
    // Japanese
    ["Rust 2.0 を発表した。", "release_announced"],
    ["バージョン 2.0 のプレビューを公開。", "release_preview"],
    ["バージョン 2.0 のベータ版を公開。", "release_beta"],
    ["2.0 のリリース候補版を公開。", "release_candidate"],
    ["一般提供を開始した バージョン 2.0", "release_final"],
    ["バージョン２．０の正式版がリリースされた。", "release_final"],
    ["2.0 の発売予定を告知。", "release_announced"],
    // Chinese
    ["宣布推出2.0版。", "release_announced"],
    ["2.0预览版今日上线。", "release_preview"],
    ["2.0测试版开放下载。", "release_beta"],
    ["2.0候选版已推出。", "release_candidate"],
    ["版本2.0正式发布。", "release_final"],
    // Korean
    ["버전 2.0 출시 예정.", "release_announced"],
    ["2.0 미리보기 공개.", "release_preview"],
    ["2.0 베타 공개.", "release_beta"],
    ["2.0 후보 버전 배포.", "release_candidate"],
    ["버전 2.0 정식 출시.", "release_final"],
  ])("reads %j as %s of 2.0", (text, stage) => {
    expect(stagesOf(text)).toEqual([stage]);
    expect(versionsOf(text)).toEqual(["2.0"]);
    expect(fingerprint(text)).toContain("version:2.0");
  });

  it.each([
    [
      "ja",
      [
        "Rust 2.0 を発表。",
        "Rust 2.0 のベータ版を公開。",
        "Rust 2.0 のリリース候補版を公開。",
        "Rust 2.0 の正式版がリリースされた。",
      ],
    ],
    [
      "zh",
      ["宣布Rust 2.0。", "Rust 2.0测试版开放。", "Rust 2.0候选版推出。", "Rust 2.0正式发布。"],
    ],
    [
      "ko",
      ["Rust 2.0 발표.", "Rust 2.0 베타 공개.", "Rust 2.0 후보 버전 배포.", "Rust 2.0 정식 출시."],
    ],
  ])("moves the %s fingerprint at every stage of one version", (_lang, stages) => {
    const seen = new Set<string>();
    for (let i = 1; i <= stages.length; i += 1)
      seen.add(fingerprint(stages.slice(0, i).join("\n")));
    expect(seen.size).toBe(stages.length);
  });

  it.each([
    ["正式版が登場", "新製品が話題になっている。"],
    ["新製品を発表", "新製品が話題になっている。"],
    ["正式版推出", "新产品受到关注。"],
    ["정식 버전 공개 예정", "신제품이 화제다."],
  ])("does not let %j move a fingerprint with no version behind it", (stageWord, base) => {
    expect(markersIn(stageWord).filter((marker) => marker.startsWith("release_"))).toEqual([]);
    expect(fingerprint(`${base}\n${stageWord}`)).toBe(fingerprint(base));
  });

  it("treats a CJK reprint as the same state", () => {
    const story = coverageTextOf([
      { title: "Rust 2.0 のリリース候補版", excerpt: "Rust 2.0 のリリース候補版を公開した。" },
    ]);
    const reprinted = coverageTextOf([
      { title: "Rust 2.0 のリリース候補版", excerpt: "Rust 2.0 のリリース候補版を公開した。" },
      { title: "Rust 2.0 のリリース候補版", excerpt: "Rust 2.0 のリリース候補版を公開した。" },
    ]);
    expect(fingerprint(reprinted)).toBe(fingerprint(story));
  });

  it("does not regress the Latin stages", () => {
    expect(stagesOf("Rust 2.0 announced")).toEqual(["release_announced"]);
    expect(stagesOf("Rust 2.0 public beta opens")).toEqual(["release_beta"]);
    expect(stagesOf("Rust 2.0 developer preview")).toEqual(["release_preview"]);
    expect(stagesOf("Rust 2.0 released")).toEqual(["release_final"]);
    expect(stagesOf("Acme raised $2.0 billion")).toEqual([]);
    expect(versionsOf("The 2026 report was released")).toEqual([]);
  });
});

describe("one canonical marker source", () => {
  it("defines no marker rules in event-version.ts", () => {
    const source = readFileSync("src/lib/pipeline/event-version.ts", "utf8");
    expect(source).not.toMatch(/DEVELOPMENT_MARKERS/);
    expect(source).not.toMatch(/\bmarker:\s*"/);
    expect(source).not.toMatch(/hasAffirmativeDealConfirmation\s*\(/);
  });

  it("derives an event's markers from markersIn and nothing else", () => {
    for (const text of [
      "The deal was confirmed by both boards.",
      "The deal has not been confirmed.",
      "Rust 2.0 RC is out. 3 people were killed.",
      "買収に合意した。Rust 2.0 の正式版がリリースされた。",
      "법원이 판결했다. 2.0 베타 공개.",
      "新产品正式发布。已确认。",
    ]) {
      expect(materialState(text).markers).toEqual(markersIn(text));
    }
  });

  it("evaluates every rule it is given -- nothing is defined and skipped", () => {
    const calls: string[] = [];
    const pack: MarkerPack = {
      lang: "latin",
      rules: [
        { marker: "deal_confirmed", pattern: /always/ },
        {
          marker: "released",
          test: (text) => {
            calls.push(text);
            return true;
          },
        },
      ],
    };
    expect(markersIn("always", [pack])).toEqual(["deal_confirmed", "released"]);
    expect(calls).toEqual(["always"]);
  });

  it("reaches English deal confirmation through its affirmative test", () => {
    expect(markersIn("The acquisition was confirmed on Monday.")).toContain("deal_confirmed");
    expect(markersIn("The acquisition has not been confirmed.")).not.toContain("deal_confirmed");
    expect(hasAffirmativeDealConfirmation("Could the merger be confirmed?")).toBe(false);
    const latin = MARKER_PACKS.find((pack) => pack.lang === "latin");
    expect(latin?.rules.find((rule) => rule.marker === "deal_confirmed")).toHaveProperty("test");
  });

  it("keeps release stages out of the ungated packs, in every language", () => {
    // Stages come only from `releaseIdentity`, which demands a version. A stage
    // rule inside a pack would fire on any sentence that used the word.
    for (const pack of MARKER_PACKS) {
      expect(pack.rules.filter((rule) => rule.marker.startsWith("release_"))).toEqual([]);
    }
  });
});

describe("a change to the rules is a re-baseline, never a revision", () => {
  it("adopts today's reading when the stored fingerprint was measured under other rules", () => {
    const decision = decideMaterialRevision({
      storedFingerprint: "v2|m=|n=|e=version:2.0",
      storedOccurrenceAt: "2026-09-01T00:00:00Z",
      nextFingerprint: fingerprint("Rust 2.0 RC is out"),
      latestPublishedAt: "2026-09-20T00:00:00Z",
      now: new Date("2026-09-20T01:00:00Z"),
    });
    expect(decision).toEqual({
      changed: false,
      fingerprint: fingerprint("Rust 2.0 RC is out"),
      occurrenceAt: null,
      reason: "rules_changed",
    });
  });

  it("advances normally once both sides are measured under the same rules", () => {
    const decision = decideMaterialRevision({
      storedFingerprint: fingerprint("Rust 2.0 announced"),
      storedOccurrenceAt: "2026-09-01T00:00:00Z",
      nextFingerprint: fingerprint("Rust 2.0 announced.\nRust 2.0 RC is out."),
      latestPublishedAt: "2026-09-20T00:00:00Z",
      now: new Date("2026-09-20T01:00:00Z"),
    });
    expect(decision.reason).toBe("material_change");
    expect(decision.changed).toBe(true);
  });
});
