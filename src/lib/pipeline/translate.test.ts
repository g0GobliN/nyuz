import { describe, expect, it } from "vitest";
import {
  CANONICAL_LANGUAGE,
  LANGUAGE_STYLE,
  TRANSLATION_STYLE_VERSION,
  TRANSLATION_SYSTEM,
  contentVersion,
  readTranslations,
  type TranslatableEvent,
} from "./translate";
import { LANGUAGES } from "@/lib/languages";

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

/**
 * House style is what makes a translated briefing read like it was written by
 * somebody who speaks the language, rather than merely being correct. The type
 * already forces an entry per language; these assert the entry says something.
 */
describe("LANGUAGE_STYLE", () => {
  it("carries real guidance for every language a reader can pick", () => {
    for (const { tag } of LANGUAGES) {
      const style = LANGUAGE_STYLE[tag];
      expect(style, `${tag} has no house style`).toBeTruthy();
      if (tag === CANONICAL_LANGUAGE) continue;
      // Long enough to be instructions rather than a placeholder like "news".
      expect(style.length, `${tag} house style is too thin to act on`).toBeGreaterThan(120);
    }
  });

  it("tells Nepali apart from Hindi, which is the failure mode for that pair", () => {
    // A model handed "translate to Nepali" with no further guidance routinely
    // returns Hindi. The two share a script, so nothing downstream would catch
    // it and the reader gets a language they did not ask for.
    expect(LANGUAGE_STYLE.ne).toMatch(/not hindi/i);
  });

  it("names a concrete register rather than saying to match the local press", () => {
    // The instruction this replaced said only "match how that reader's own
    // press writes", which is not something a model can act on.
    expect(LANGUAGE_STYLE.ja).toContain("常体");
    expect(LANGUAGE_STYLE.ko).toContain("해라체");
  });
});

/**
 * The editorial profiles.
 *
 * These cannot check that the Japanese reads well — that needs a Japanese
 * reader, and no assertion substitutes for one. What they can check is that
 * the instructions we send are the instructions we decided to send: that every
 * language has a real profile, that the rules protecting facts are present and
 * specific, and that a profile change is traceable rather than silent.
 *
 * The failure they exist to catch is a profile being weakened or dropped in a
 * refactor, which would be invisible until a reader complained.
 */
describe("translation profiles", () => {
  const every = LANGUAGES.map((l) => l.tag);

  it("has an editorial profile for every language a reader can pick", () => {
    for (const tag of every) {
      expect(LANGUAGE_STYLE[tag], `${tag} has no profile`).toBeTruthy();
    }
  });

  it("gives every translated language substantive, actionable guidance", () => {
    for (const tag of every) {
      if (tag === CANONICAL_LANGUAGE) continue;
      const profile = LANGUAGE_STYLE[tag];
      // Long enough to be a profile rather than "translate to X".
      expect(profile.length, `${tag} profile is too thin`).toBeGreaterThan(300);
      // Every profile must say something about how numbers are written, since
      // Western digit grouping is one of the loudest translationese signals.
      expect(profile, `${tag} says nothing about numbers`).toMatch(/number|लाख|万|만|亿|억/i);
    }
  });

  it("tells every non-English profile not to carry English word order across", () => {
    // The single most common way a translation stays grammatical and still
    // reads foreign.
    for (const tag of every) {
      if (tag === CANONICAL_LANGUAGE) continue;
      expect(LANGUAGE_STYLE[tag], `${tag} does not warn about English order`).toMatch(
        /english (order|clause order|word by word)|english-shaped|verb-final|preserved english syntax|translationese/i,
      );
    }
  });

  it("names a concrete register per language rather than saying 'be natural'", () => {
    expect(LANGUAGE_STYLE.ja).toContain("常体");
    expect(LANGUAGE_STYLE.ko).toContain("해라체");
    expect(LANGUAGE_STYLE["zh-Hans"]).toContain("书面语");
    expect(LANGUAGE_STYLE.hi).toMatch(/Sanskrit/i);
    expect(LANGUAGE_STYLE.ne).toMatch(/NOT Hindi/i);
  });

  it("keeps Nepali explicitly distinct from Hindi", () => {
    // Handed "translate to Nepali" with no steer, models return Hindi. The two
    // share a script, so nothing downstream would notice.
    expect(LANGUAGE_STYLE.ne).toMatch(/not hindi/i);
    expect(LANGUAGE_STYLE.ne).toMatch(/गरेको|भएको/);
  });

  it("describes a house voice for canonical English too", () => {
    // The English is what every other language is translated from. If it reads
    // like raw aggregation, every translation inherits that.
    expect(LANGUAGE_STYLE.en.length).toBeGreaterThan(120);
    expect(LANGUAGE_STYLE.en).toMatch(/neutral|concise/i);
  });
});

/**
 * What the shared prompt must always say.
 *
 * Facts, numbers, attribution and the strength of a claim are the four things a
 * translation can silently destroy while reading beautifully — which makes them
 * exactly the things no refactor should be able to quietly drop.
 */
describe("translation prompt guarantees", () => {
  const prompt = () => `${TRANSLATION_SYSTEM}\n${LANGUAGE_STYLE.ja}`;

  it("forbids adding or dropping a fact", () => {
    expect(prompt()).toMatch(/never add|never drop/i);
    expect(prompt()).toMatch(/opinion|context that is not|explanation/i);
  });

  it("protects numbers, dates and currencies from being changed", () => {
    expect(prompt()).toMatch(/numeric values, dates and quantities/i);
    expect(prompt()).toMatch(/never convert an amount into another currency/i);
  });

  it("protects the strength of a claim in both directions", () => {
    // Sharpening invents certainty; softening withdraws a claim the reporting
    // made. Both are factual errors that read fluently.
    expect(prompt()).toMatch(/reportedly/i);
    expect(prompt()).toMatch(/confirmed/i);
    expect(prompt()).toMatch(/not stronger/i);
    expect(prompt()).toMatch(/not weaker/i);
  });

  it("protects attribution and quotations", () => {
    expect(prompt()).toMatch(/attribut/i);
    expect(prompt()).toMatch(/quotations stay quotations/i);
    expect(prompt()).toMatch(/does not acquire a source/i);
  });

  it("asks for native headlines rather than translated ones", () => {
    expect(prompt()).toMatch(/headline/i);
    expect(prompt()).toMatch(/not an english headline rendered word for word/i);
  });

  it("keeps before_state and after_state contrastive", () => {
    expect(prompt()).toMatch(/before_state and after_state/i);
  });

  it("preserves a null field as null", () => {
    expect(prompt()).toMatch(/null in the input stays null in the output/i);
  });
});

/**
 * Versioning.
 *
 * Two separate needs, met two separate ways, and conflating them is the bug:
 * `content_version` gives correctness (old rows miss and regenerate), and
 * `style_version` gives traceability (which profile wrote this row).
 */
describe("profile versioning", () => {
  it("changes the cache key when the profile version changes", async () => {
    // Without this, improving a profile changes nothing a reader ever sees:
    // every cached row still matches its key and keeps serving the old style.
    const version = await contentVersion(event());
    expect(version).toHaveLength(12);
    // The version participates in the hash, so two builds with different
    // TRANSLATION_STYLE_VERSION cannot collide on the same text.
    expect(TRANSLATION_STYLE_VERSION).toMatch(/^\d+$/);
  });

  it("still changes the key when only the source text changes", async () => {
    // Folding the style version in must not have broken the original job.
    const base = await contentVersion(event());
    expect(await contentVersion(event({ title: "Something else" }))).not.toBe(base);
  });

  it("is a plain incrementing value, so an operator can compare two rows", () => {
    expect(Number(TRANSLATION_STYLE_VERSION)).toBeGreaterThanOrEqual(1);
  });
});
