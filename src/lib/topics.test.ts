import { describe, expect, it } from "vitest";
import { keepUsableTopics, topicSaveIntent } from "@/lib/coverage";
import { isValidExclusion, validateExclusionLabel } from "@/lib/exclusions";
import {
  cleanTags,
  creatableFrom,
  isValidTopic,
  MAX_TOPIC_LABEL,
  matchesTerms,
  mentions,
  normaliseText,
  topicSlug,
  topicTerms,
  validateTopicLabel,
} from "@/lib/topics";

/**
 * The rules that decide what a reader's own words mean.
 *
 * Everything here is a pure function, which is the point: an interest reaching
 * an event has to be arithmetic, because stage 5 runs once per reader per event
 * and is the only stage whose cost grows with signups. If any of these ever
 * needs a model to answer it, the cost argument has been lost.
 */

describe("canonical identity", () => {
  it("resolves spacing and case to one row", () => {
    const forms = ["Nepal", "nepal", " Nepal ", "NEPAL", "  nepal  "];
    const slugs = new Set(forms.map(topicSlug));
    expect(slugs.size).toBe(1);
    expect([...slugs][0]).toBe("nepal");
  });

  it("collapses duplicates to the first spelling the reader used", () => {
    const { kept } = keepUsableTopics(["Nepal", " nepal ", "NEPAL"]);
    expect(kept.map((t) => t.label)).toEqual(["Nepal"]);
  });

  it("does not merge subjects that merely share a word", () => {
    // The failure this guards against is invisible in production: a reader who
    // asked for one of these and quietly receives another's stories instead.
    const subjects = ["China", "India vs China", "China economy", "US-China chips"];
    const slugs = subjects.map(topicSlug);
    expect(new Set(slugs).size).toBe(subjects.length);

    const { kept } = keepUsableTopics(subjects);
    expect(kept).toHaveLength(subjects.length);
  });

  it("gives the same slug to the same words whoever types them", () => {
    // Two strangers reaching one canonical row is the whole cost argument.
    // Nothing about the identity may depend on who is asking.
    expect(topicSlug("Nepal floods")).toBe(topicSlug("  NEPAL   FLOODS  "));
  });

  it("keeps non-Latin subjects, which it used to discard", () => {
    // These slugified to the empty string and were refused outright. nyuz
    // offers Japanese and Nepali as reading languages, so refusing a Japanese
    // or Nepali subject was the product contradicting itself.
    expect(topicSlug("日本")).toBe("日本");
    expect(topicSlug("नेपाल")).toBe("नेपाल");
    expect(topicSlug(" 日本 ")).toBe(topicSlug("日本"));
  });

  it("still produces the slugs the seeded topics were created with", () => {
    // 0006, 0009 and 0012 inserted these by hand. A change to the slug rule
    // that moved any of them would orphan every existing follow.
    expect(topicSlug("Next.js")).toBe("next-js");
    expect(topicSlug("Developer tools")).toBe("developer-tools");
    expect(topicSlug("Open source")).toBe("open-source");
    expect(topicSlug("Café")).toBe("cafe");
  });
});

describe("what a topic is allowed to be", () => {
  it("refuses an empty topic", () => {
    for (const empty of ["", " ", "   ", "\t\n"]) {
      const result = validateTopicLabel(empty);
      expect(isValidTopic(result)).toBe(false);
    }
  });

  it("refuses punctuation and emoji that carry no subject", () => {
    for (const junk of ["...", "!!!", "🎉", "-", "   —   ", "\u093e\u093e"]) {
      expect(isValidTopic(validateTopicLabel(junk))).toBe(false);
    }
  });

  it("refuses a single character", () => {
    expect(isValidTopic(validateTopicLabel("a"))).toBe(false);
  });

  it("refuses an over-long topic without truncating it into a different one", () => {
    const long = "a".repeat(MAX_TOPIC_LABEL + 1);
    const result = validateTopicLabel(long);
    expect(isValidTopic(result)).toBe(false);
    expect(result).toEqual({ rejected: "too-long" });

    // Truncating would be the dangerous failure: it stores a subject nobody
    // asked for, under a canonical slug other readers then share.
    const { kept } = keepUsableTopics([long]);
    expect(kept).toEqual([]);
  });

  it("refuses safely at the size the transport schema still accepts", () => {
    // `prefsInput` allows 80 characters so this length reaches the handler.
    // Arriving and being refused with a reason is the designed path.
    const result = validateTopicLabel("x".repeat(80));
    expect(result).toEqual({ rejected: "too-long" });
  });

  it("accepts the subjects a reader would actually type", () => {
    const wanted = [
      "Nepal",
      "India vs China",
      "Japan earthquake",
      "OpenAI agents",
      "Nvidia earnings",
      "US immigration",
      "Nepal floods",
      "Apple Vision Pro",
      "Russia Ukraine",
      "Bitcoin regulation",
      "Axis camera firmware",
      "Manchester United transfers",
      "US-China chip restrictions",
      "日本",
      "नेपाल",
    ];
    for (const label of wanted) {
      expect(isValidTopic(validateTopicLabel(label)), label).toBe(true);
    }
  });

  it("preserves the reader's own spelling for display", () => {
    const result = validateTopicLabel("  OpenAI   agents  ");
    expect(isValidTopic(result) && result.label).toBe("OpenAI agents");
  });
});

describe("terms", () => {
  it("drops the connective and keeps both sides of a rivalry", () => {
    expect(topicTerms("India vs China")).toEqual(["india", "china"]);
    expect(topicTerms("Russia Ukraine")).toEqual(["russia", "ukraine"]);
  });

  it("keeps a single-word interest as wide as it was asked for", () => {
    expect(topicTerms("Nepal")).toEqual(["nepal"]);
  });

  it("never produces an empty list, which would select everything", () => {
    // A label made only of stopwords falls back to itself rather than to
    // nothing: `matchesTerms([])` is false, but a caller that skipped the
    // check would otherwise have a topic that admits the entire corpus.
    expect(topicTerms("the of and")).toEqual(["the of and"]);
    expect(matchesTerms("anything at all", [])).toBe(false);
  });

  it("cannot be turned into a firehose by a single stopword", () => {
    // The fallback above is only safe for a PHRASE. For one stopword it emits
    // that bare word as a term, and `mentions` reads a three-character term as
    // a word PREFIX — so "the" reaches every sentence of English prose,
    // including the `what_happened` paragraph stage 5 matches against. Measured
    // through `decide` over a day of headlines, following "the" selected 20 of
    // 20: a free account had bought the whole corpus with three topics.
    for (const stopword of ["the", "and", "in", "of", "to", "on", "with", "by", "at", "for"]) {
      expect(isValidTopic(validateTopicLabel(stopword)), stopword).toBe(false);
      expect(isValidTopic(validateTopicLabel(`  ${stopword}  `)), stopword).toBe(false);
    }

    // The mirror image, on the "Never send me" side. `related` floors a
    // two-character term out, but "the" is three, so it was a plain substring
    // test over the whole signal and vetoed every event the matcher produced —
    // a reader's next briefing came back empty with nothing to explain it.
    for (const stopword of ["the", "and", "in", "of", "to", "with"]) {
      expect(isValidExclusion(validateExclusionLabel(stopword)), stopword).toBe(false);
    }

    // A reader who meant "the news" is not blocked: "the" is dropped and the
    // subject that is actually in the label is what gets stored and matched.
    expect(topicTerms("the news")).toEqual(["news"]);
    expect(isValidTopic(validateTopicLabel("The News")), "The News").toBe(true);
    // "The Simpsons" is a subject, not connective tissue.
    expect(isValidTopic(validateTopicLabel("The Simpsons")), "The Simpsons").toBe(true);
  });

  it("keeps refusing an all-stopword list through the reader's whole save", () => {
    // The selector refuses each one individually, but a hand-made request can
    // still name three of them at once, and they must all be refused together.
    const { kept, refused } = keepUsableTopics(["the", "and", "in"]);
    expect(kept).toEqual([]);
    expect(refused.map((r) => r.reason)).toEqual(["unusable", "unusable", "unusable"]);
  });

  it("gives different subjects different terms", () => {
    expect(topicTerms("China economy")).not.toEqual(topicTerms("China"));
    expect(topicTerms("US-China chip restrictions")).toEqual([
      "us",
      "china",
      "chip",
      "restrictions",
    ]);
  });
});

describe("what counts as a mention", () => {
  const signal = normaliseText(
    "Monsoon rains kill 200 in the Kathmandu valley. " +
      "Nepal's government declared a state of emergency after flooding.",
  );

  it("reaches an event through the shared concept signal, not the headline", () => {
    expect(matchesTerms(signal, topicTerms("Nepal"))).toBe(true);
    expect(matchesTerms(signal, topicTerms("Nepal floods"))).toBe(true);
  });

  it("matches an inflected form of a term", () => {
    expect(mentions(normaliseText("severe flooding continues"), "flood")).toBe(true);
    expect(mentions(normaliseText("the floods receded"), "flood")).toBe(true);
  });

  it("requires every term, so a rivalry is not satisfied by one side", () => {
    const aboutChinaOnly = normaliseText("China raised export tariffs on rare earths");
    expect(matchesTerms(aboutChinaOnly, topicTerms("China"))).toBe(true);
    expect(matchesTerms(aboutChinaOnly, topicTerms("India vs China"))).toBe(false);

    const aboutBoth = normaliseText(
      "India and China agreed to resume border patrols after four years",
    );
    expect(matchesTerms(aboutBoth, topicTerms("India vs China"))).toBe(true);
  });

  it("does not let a short term match the inside of a word", () => {
    // Without the length floor a two-letter interest matches nearly everything,
    // which is how a matcher quietly turns back into "show me all of it".
    expect(mentions(normaliseText("she said nothing"), "ai")).toBe(false);
    expect(mentions(normaliseText("ai models shipped"), "ai")).toBe(true);
  });

  it("matches scripts written without spaces by containment", () => {
    expect(mentions(normaliseText("日本の地震で被害"), "日本")).toBe(true);
    expect(mentions(normaliseText("インドの選挙"), "日本")).toBe(false);
  });

  it("matches Devanagari on word boundaries, since it uses spaces", () => {
    expect(mentions(normaliseText("नेपाल में बाढ़"), "नेपाल")).toBe(true);
  });
});

describe("the create action the selector offers", () => {
  it("offers to follow something no existing topic covers", () => {
    expect(creatableFrom("Nepal", ["ai", "politics", "world"])).toEqual({
      label: "Nepal",
      slug: "nepal",
    });
    expect(creatableFrom("India vs China", [])).toEqual({
      label: "India vs China",
      slug: "india-vs-china",
    });
  });

  it("does not offer a duplicate when the canonical topic already exists", () => {
    expect(creatableFrom("Nepal", ["nepal", "nepal-politics"])).toBeNull();
    // Including when they typed it differently — the slug is the identity.
    expect(creatableFrom("  NEPAL  ", ["nepal"])).toBeNull();
  });

  it("still offers to create a narrower subject than one that exists", () => {
    // "Nep" and "Nepal politics" are not "Nepal". Suppressing these would be
    // the product deciding a reader meant something else.
    expect(creatableFrom("Nepal politics", ["nepal"])).not.toBeNull();
    expect(creatableFrom("Nep", ["nepal"])).not.toBeNull();
  });

  it("offers nothing for text that cannot become a topic", () => {
    expect(creatableFrom("", [])).toBeNull();
    expect(creatableFrom("   ", [])).toBeNull();
    expect(creatableFrom("x".repeat(200), [])).toBeNull();
  });
});

describe("shared concept tags", () => {
  it("normalises on write so the database and the matcher agree", () => {
    expect(cleanTags(["Nepal", "  Kathmandu  ", "Monsoon Flooding"])).toEqual([
      "nepal",
      "kathmandu",
      "monsoon flooding",
    ]);
  });

  it("is bounded, deduplicated and refuses a sentence", () => {
    expect(cleanTags(["ai", "AI", " ai "])).toEqual(["ai"]);
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `tag${i}`))).toHaveLength(8);
    expect(cleanTags(["a".repeat(60)])).toEqual([]);
  });

  it("survives a model that returns something other than an array of strings", () => {
    expect(cleanTags(null)).toEqual([]);
    expect(cleanTags("nepal")).toEqual([]);
    expect(cleanTags([1, null, { slug: "nepal" }, "nepal"])).toEqual(["nepal"]);
  });
});

describe("what saving a whole topic list should do", () => {
  // `replaceTopics` used to branch on `kept.length === 0` alone, so every one of
  // these reached the same `delete from user_topics` as an empty list -- and
  // still answered `{ ok: true }`. A stale tab holding one mangled label, or a
  // hand-made request, unsubscribed the reader from everything with no error
  // and no way back.
  const refuseAll = ["!!", "   ", "🎉", "!!!", "???"];
  it.each([["!!"], ["🎉"], ["   "], ["!!!", "???"], ["💩"], ["the"], ["x".repeat(80)]])(
    "refuses and changes nothing when every entry is unusable: %s",
    (...labels) => {
      const list = labels.flat();
      expect(topicSaveIntent(list, keepUsableTopics(list))).toBe("refuse");
    },
  );

  it("clears only when the reader genuinely sent an empty list", () => {
    // Following nothing is a real state the dashboard has words for, so it must
    // keep working: `[]` is the reader asking for it, not a failed save.
    expect(topicSaveIntent([], keepUsableTopics([]))).toBe("clear");
  });

  it("replaces when at least one topic survives", () => {
    // The lenient path the comment describes: one bad entry among ten must not
    // fail the other nine, and must never delete.
    expect(topicSaveIntent(["Nepal", "!!", "the"], keepUsableTopics(["Nepal", "!!", "the"]))).toBe(
      "replace",
    );
    expect(topicSaveIntent(["Nepal"], keepUsableTopics(["Nepal"]))).toBe("replace");
  });

  it("cannot be talked into deleting by sending nothing useful twice", () => {
    // Whitespace is what an uninitialised field serialises to, and it is the
    // shape most likely to arrive by accident rather than on purpose.
    for (const list of [["", ""], ["", "  ", "\n"], ["\t"], ["   ", "!!"]]) {
      expect(topicSaveIntent(list, keepUsableTopics(list)), list.join("|")).toBe("refuse");
    }
  });

  it("treats a stringified undefined as the subject it spells, not as nothing", () => {
    // Worth pinning because it is the opposite of what a reader might expect:
    // a client bug that serialised `undefined` into the array mints a real
    // canonical topic called "undefined" rather than being refused. That is
    // still strictly better than the alternative -- minting one junk row the
    // daily brake counts, rather than deleting a reader's configuration -- but
    // it is a row somebody has to clean up, so it is written down here.
    expect(topicSaveIntent(["undefined"], keepUsableTopics(["undefined"]))).toBe("replace");
    expect(topicSaveIntent(["null"], keepUsableTopics(["null"]))).toBe("replace");
  });
});
