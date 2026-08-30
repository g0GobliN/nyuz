import { describe, expect, it } from "vitest";
import { contentVersion, readTranslations, type TranslatableEvent } from "./translate";

/**
 * The two parts of translation that can be wrong silently.
 *
 * `contentVersion` decides whether a cached translation is served or
 * regenerated. Getting it wrong in the "too stable" direction serves a
 * translation of text that has since changed; in the "too volatile"
 * direction it is a permanent cache miss that looks exactly like a cold
 * cache and quietly pays for every translation twice.
 *
 * `readTranslations` decides what reaches a reader as their story. A
 * partially-parsed reply would produce a briefing that is half Japanese and
 * half English, which reads as a bug rather than as the honest English
 * fallback that is available.
 */

const event = (over: Partial<TranslatableEvent> = {}): TranslatableEvent => ({
  eventId: "e1",
  title: "OpenAI opposes California's AI safety bill",
  whatHappened: "OpenAI sent a letter to the governor opposing SB 1047.",
  beforeState: "The bill was expected to pass without objection.",
  afterState: "The largest lab in the state is on record against it.",
  impact: "Labs now have to plan for state-level rules.",
  ...over,
});

describe("contentVersion", () => {
  it("is stable for the same text", async () => {
    expect(await contentVersion(event())).toBe(await contentVersion(event()));
  });

  it("ignores the event id — the same text under a different id is the same text", async () => {
    // The id is already part of the primary key. Including it in the hash
    // would mean two events with identical text could not share a cache
    // entry, which is not the property this is protecting.
    expect(await contentVersion(event({ eventId: "e2" }))).toBe(await contentVersion(event()));
  });

  it("changes when any translated field changes", async () => {
    const base = await contentVersion(event());
    expect(await contentVersion(event({ title: "Something else" }))).not.toBe(base);
    expect(await contentVersion(event({ whatHappened: "Different body." }))).not.toBe(base);
    expect(await contentVersion(event({ beforeState: "Different before." }))).not.toBe(base);
    expect(await contentVersion(event({ afterState: "Different after." }))).not.toBe(base);
    expect(await contentVersion(event({ impact: "Different impact." }))).not.toBe(base);
  });

  it("distinguishes a null field from an empty one, and from a moved one", async () => {
    // Without an explicit null marker, moving text between before_state and
    // after_state could hash identically — the one collision that would
    // actually matter here, because it inverts the meaning of the story.
    const before = await contentVersion(event({ beforeState: "X", afterState: null }));
    const after = await contentVersion(event({ beforeState: null, afterState: "X" }));
    expect(before).not.toBe(after);
  });

  it("is short enough to key on and long enough not to collide by accident", async () => {
    expect(await contentVersion(event())).toHaveLength(12);
  });
});

describe("readTranslations", () => {
  const ids = ["e1", "e2"];

  const reply = (over: Record<string, unknown> = {}) => ({
    items: [
      {
        event_id: "e1",
        title: "OpenAIがカリフォルニアのAI安全法案に反対",
        what_happened: "OpenAIは知事に書簡を送った。",
        before_state: "法案は異論なく可決される見込みだった。",
        after_state: "州最大のラボが公式に反対している。",
        impact: "各社は州レベルの規制を想定する必要がある。",
      },
      {
        event_id: "e2",
        title: "二番目の見出し",
        what_happened: "二番目の本文。",
        before_state: null,
        after_state: null,
        impact: null,
      },
    ],
    ...over,
  });

  it("reads one translation per requested event", () => {
    const out = readTranslations(reply(), ids);
    expect(out).not.toBeNull();
    expect(out?.get("e1")?.title).toBe("OpenAIがカリフォルニアのAI安全法案に反対");
    expect(out?.get("e2")?.whatHappened).toBe("二番目の本文。");
  });

  it("keeps a null field null rather than inventing text for it", () => {
    const out = readTranslations(reply(), ids);
    expect(out?.get("e2")?.beforeState).toBeNull();
    expect(out?.get("e2")?.impact).toBeNull();
  });

  it("refuses a reply that silently drops a story", () => {
    // Half a briefing in Japanese and half in English reads as broken. The
    // English fallback is correct and available; a partial result bypasses it.
    const partial = { items: [reply().items[0]] };
    expect(readTranslations(partial, ids)).toBeNull();
  });

  it("refuses a story whose title or body came back empty", () => {
    const emptyTitle = { items: [{ ...reply().items[0], title: "  " }, reply().items[1]] };
    expect(readTranslations(emptyTitle, ids)).toBeNull();

    const emptyBody = { items: [{ ...reply().items[0], what_happened: "" }, reply().items[1]] };
    expect(readTranslations(emptyBody, ids)).toBeNull();
  });

  it("treats the model's null-shaped words as null, not as content", () => {
    // A model told to answer null in JSON routinely answers the word
    // instead. "null" printed as a translated headline under a real story is
    // the failure this guards.
    const worded = {
      items: [{ ...reply().items[0], before_state: "null", impact: "N/A" }, reply().items[1]],
    };
    const out = readTranslations(worded, ids);
    expect(out?.get("e1")?.beforeState).toBeNull();
    expect(out?.get("e1")?.impact).toBeNull();
  });

  it("refuses anything that is not the expected envelope", () => {
    expect(readTranslations("翻訳できません", ids)).toBeNull();
    expect(readTranslations(null, ids)).toBeNull();
    expect(readTranslations({ items: "not an array" }, ids)).toBeNull();
    expect(readTranslations([reply()], ids)).toBeNull();
  });
});
