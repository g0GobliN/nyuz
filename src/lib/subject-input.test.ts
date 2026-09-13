import { describe, expect, it } from "vitest";
import { validateTopicLabel, isValidTopic } from "./topics";
import {
  validateExclusionLabel,
  isValidExclusion,
  keepUsableExclusions,
  addExclusion,
  removeExclusion,
  MAX_EXCLUSIONS,
} from "./exclusions";

describe("subject input safeguards", () => {
  it.each(["aaa", "bbb", "aaa bbb", "ａａａ", "asdf", "qwerty", "!!!", "😀", "crypto\u200b"])(
    "rejects obvious junk: %s",
    (label) => {
      expect(isValidTopic(validateTopicLabel(label))).toBe(false);
      expect(isValidExclusion(validateExclusionLabel(label))).toBe(false);
    },
  );
  it.each(["AI", "BBC", "OpenAI", "日本", "नेपाल", "Elon Musk", "Formula 1", "AAA games"])(
    "preserves legitimate subjects: %s",
    (label) => {
      expect(isValidTopic(validateTopicLabel(label))).toBe(true);
      expect(isValidExclusion(validateExclusionLabel(label))).toBe(true);
    },
  );
  it("caps distinct exclusions and still permits removal", () => {
    const labels = Array.from({ length: MAX_EXCLUSIONS }, (_, i) => `Subject ${i}`);
    expect(addExclusion(labels, "Football")).toBe(labels);
    expect(keepUsableExclusions([...labels, "Football"]).refused).toEqual([
      { label: "Football", reason: "limit" },
    ]);
    expect(addExclusion(removeExclusion(labels, "Subject 0"), "Football")).toHaveLength(
      MAX_EXCLUSIONS,
    );
    expect(keepUsableExclusions([...labels, "SUBJECT 0"]).refused).toEqual([]);
  });
});
