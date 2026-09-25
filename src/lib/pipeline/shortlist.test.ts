import { describe, expect, it } from "vitest";
import { isVcsRef, orFilter, STOPWORDS, titleTokens } from "./shortlist";

/**
 * The shortlist is the reason stage 3 is affordable, so what is tested here is
 * mostly about cost and about safety, not about relevance.
 *
 * Relevance is the model's job. What this module has to guarantee is narrower and
 * checkable: that every token it emits can actually use the trigram index, that a
 * headline with nothing distinctive in it produces no query at all, and that
 * nothing it produces can change the shape of a PostgREST filter.
 */

describe("titleTokens", () => {
  it("picks the distinctive words out of a real headline", () => {
    const tokens = titleTokens(
      "Cloverleaf deal is latest example of Nvidia using its war chest to patch cracks",
    );

    expect(tokens).toContain("cloverleaf");
    expect(tokens).toContain("nvidia");
    // "deal", "latest" and "using" are on the stopword list; "war" is too short.
    expect(tokens).not.toContain("deal");
    expect(tokens).not.toContain("latest");
    expect(tokens).not.toContain("using");
  });

  it("emits nothing a trigram index cannot serve", () => {
    // Every token has to be at least three characters between the wildcards, or
    // `ilike '%xx%'` silently becomes a sequential scan of the whole table. This is
    // the property the whole cost argument rests on, so it is checked over the
    // corpus's real shapes rather than one example.
    const titles = [
      "AI is here",
      "Go 1.24 is out",
      "Is it a bug or is it me",
      "OpenAI ships GPT-5 to all users",
      "Что нового в Rust 1.90",
    ];

    for (const title of titles) {
      for (const token of titleTokens(title)) {
        expect(token.length, `${title} → ${token}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("caps how many words it will search on", () => {
    const long =
      "Anthropic Cloverleaf Nvidia Microsoft Salesforce Databricks Snowflake announce interoperability";
    expect(titleTokens(long).length).toBeLessThanOrEqual(3);
  });

  it("prefers a capitalised proper noun over a longer common word", () => {
    // The case that made the length-only ranking wrong. `example` and `cracks` are
    // longer than or the same length as `nvidia` and narrow nothing; ranking by
    // length alone selected them and dropped the one word worth searching for.
    const tokens = titleTokens(
      "Cloverleaf deal is latest example of Nvidia using its war chest to patch cracks",
    );

    expect(tokens.slice(0, 2).sort()).toEqual(["cloverleaf", "nvidia"]);
  });

  it("ignores capitalisation when the headline capitalises everything", () => {
    // Title Case carries no signal, so the ranking has to fall back to length
    // rather than treating every word as a proper noun and keeping the first three
    // in the order they happen to appear. `developer` is a stopword; `center` and
    // `nvidia` tie at six characters and the alphabetical tie-break settles it,
    // which is how the same headline is guaranteed to build the same query twice.
    expect(titleTokens("Nvidia Partners With Data Center Developer Cloverleaf")).toEqual([
      "cloverleaf",
      "partners",
      "center",
    ]);
  });

  it("returns nothing for a release tag, so no model call happens", () => {
    // This is the free path. GitHub release feeds and CI notifications make up a
    // real share of the corpus, and none of them should cost a token.
    expect(titleTokens("v8.2.2")).toEqual([]);
    expect(titleTokens("viable/strict/1787466473")).toEqual([]);
    expect(titleTokens("2026.08.23")).toEqual([]);
    expect(titleTokens("")).toEqual([]);
  });

  it("returns nothing for a version-control ref, which is not a headline", () => {
    // Measured, not theoretical: thirteen of twenty-five articles in a real batch
    // were refs of this shape, published by a GitHub feed pointed at tags, and they
    // took most of the batch's token spend to conclude that unrelated commits are
    // unrelated.
    expect(titleTokens("trunk/16ee93b8a9e7e2dd215a2f5d07eada25e31ec123: [vision hash]")).toEqual(
      [],
    );
    expect(titleTokens('viable/strict/1787468606: Revert "Remove caffe2/core/timer.h"')).toEqual(
      [],
    );
  });

  it("names a CI ref so later stages can refuse it without re-deriving the regex", () => {
    expect(isVcsRef("trunk/16ee93b8a9e7e2dd215a2f5d07eada25e31ec123: [vision hash]")).toBe(true);
    expect(isVcsRef("v8.2.2")).toBe(false);
    expect(isVcsRef("AI/ML hiring is booming again")).toBe(false);
  });

  it("does not mistake a slash in a real headline for a ref", () => {
    // The rule has to be narrow enough to leave ordinary headlines alone, and the
    // hex run is what makes it narrow.
    expect(titleTokens("AI/ML hiring is booming again")).toContain("hiring");
    expect(titleTokens("Rust/C++ interop lands in 1.90")).toContain("interop");
    expect(titleTokens("openai/whisper gets a smaller sibling")).toContain("whisper");
  });

  it("keeps hyphenated and apostrophised words whole", () => {
    // Splitting `wi-fi` yields two two-character fragments, both unsearchable.
    expect(titleTokens("New wi-fi standard lands")).toContain("wi-fi");
  });

  it("does not select on the words that appear in hundreds of headlines", () => {
    for (const word of ["announces", "launches", "report", "update", "version"]) {
      expect(STOPWORDS.has(word), word).toBe(true);
    }
  });

  it("still selects on company names, which narrow usefully", () => {
    // A stopword list that swallowed "openai" would make the shortlist useless for
    // exactly the stories most likely to be double-covered.
    for (const word of ["openai", "nvidia", "google", "anthropic"]) {
      expect(STOPWORDS.has(word), word).toBe(false);
    }
  });

  it("is deterministic", () => {
    const title = "Nvidia partners with data center developer Cloverleaf";
    expect(titleTokens(title)).toEqual(titleTokens(title));
  });
});

describe("titles in scripts that do not use spaces", () => {
  /**
   * Japanese, Chinese and Korean do not put spaces between words, so
   * `titleTokens` used to read every CJK headline as an unspaced — therefore
   * machine-generated — tag and return nothing for it. A headline with no
   * tokens gets no shortlist, so it never found a sibling to cluster with, and
   * every Japanese story became a one-article event nobody could follow.
   *
   * The exception is narrow on purpose: `v8.2.2` and hex refs are still refused,
   * because they are unspaced *and* have no CJK in them.
   */
  it("tokens a Japanese headline instead of calling it a ref", () => {
    const tokens = titleTokens("東京の音楽フェスが中止になった");
    expect(tokens.length).toBeGreaterThan(0);
    // The run itself is the pattern verbatim republication shares, and it is what
    // the trigram index can serve; a shorter window would be a different story.
    expect(tokens).toContain("東京の音楽フェスが中止になった");
  });

  it("tokens a Chinese headline", () => {
    expect(titleTokens("中国音乐市场增长").length).toBeGreaterThan(0);
  });

  it("tokens a Korean headline, which does use spaces", () => {
    expect(titleTokens("한국 음악 시장이 성장하고 있다").length).toBeGreaterThan(0);
    // Hangul words are short and the Latin floor is three characters, so this
    // headline used to tokenise to nothing at all. Two-character Korean words
    // are words, and this is the case that says so.
    expect(titleTokens("한국 음악")).toEqual(expect.arrayContaining(["한국", "음악"]));
  });

  it("gives two tellings of one Korean story a shared pattern", () => {
    const first = titleTokens("한국 음악 시장이 성장하고 있다");
    const second = titleTokens("한국 음악 시장이 커졌다");
    expect(first.filter((token) => second.includes(token))).toContain("시장이");
  });

  it("clusters Korean on shared word forms, which is the whole of the rule", () => {
    // Documented rather than papered over: two words built from one Korean stem
    // with different endings (성장 / 성장하고) share no trigram, so they do not
    // cluster. Closing that needs a morphological analyser per language, which is
    // the kind of dependency this pipeline has deliberately never taken on. The
    // cost is recall inside one language's inflection; the cost of guessing wrong
    // would be two unrelated stories merged.
    const inflected = titleTokens("한국 음악 시장이 성장하고 있다");
    const stem = titleTokens("한국 음악 시장 성장");
    expect(inflected.filter((token) => stem.includes(token))).toEqual([]);
  });

  it("gives two tellings of one Japanese story a shared pattern", () => {
    // Clustering is the only thing this is for: the pair must intersect, or two
    // outlets' accounts of one event are two events.
    const first = titleTokens("東京の音楽フェスが中止になった");
    const second = titleTokens("東京の音楽フェスが中止に");
    expect(first.filter((token) => second.includes(token)).length).toBeGreaterThan(0);
  });

  it("still refuses unspaced ASCII, which is what a ref looks like", () => {
    expect(titleTokens("v8.2.2")).toEqual([]);
    expect(titleTokens("viable/strict/1787466473")).toEqual([]);
    expect(titleTokens("trunk/16ee93b8a9e7e2dd215a2f5d07eada25e31ec123")).toEqual([]);
    expect(isVcsRef("v8.2.2")).toBe(false);
  });
});

describe("orFilter", () => {
  it("builds a PostgREST disjunction", () => {
    expect(orFilter(["nvidia", "cloverleaf"])).toBe(
      "title.ilike.*nvidia*,title.ilike.*cloverleaf*",
    );
  });

  it("returns empty for no tokens, which callers read as no shortlist", () => {
    // An empty `or=()` is a PostgREST syntax error, and a filter matching
    // everything would be far worse than one matching nothing.
    expect(orFilter([])).toBe("");
  });

  it("drops anything that could change the shape of the filter", () => {
    // PostgREST parses this argument itself, so a comma or a bracket in a token
    // would add a clause rather than search for a character. titleTokens cannot
    // produce one; this is the second line of defence.
    expect(orFilter(["nvidia,title.ilike.*"])).toBe("");
    expect(orFilter(["or(id.gt.0)"])).toBe("");
    expect(orFilter(["a.b"])).toBe("");
    expect(orFilter(["ok", "no,pe"])).toBe("title.ilike.*ok*");
  });
});
