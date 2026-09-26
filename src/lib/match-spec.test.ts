import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROMOTION_MIN_MATCHES,
  type MatchSpec,
  type TermEvidence,
  deriveSpec,
  deriveSpecFromTerms,
  evaluateSpec,
  promoteTerms,
  promotionCandidates,
  specForTopic,
} from "@/lib/match-spec";
import { matchesTerms, normaliseText, topicTerms } from "@/lib/topics";

/**
 * The interest's meaning, and the one property that matters most about it.
 *
 * ---------------------------------------------------------------------------
 * The property this file exists for
 * ---------------------------------------------------------------------------
 *
 * `match-spec.ts` replaces the call every custom topic used to make —
 * `matchesTerms(signal, terms)`, an AND over derived terms — with an evaluator
 * that can also express "any of these names". Widening a matcher is how a
 * product quietly starts showing people things they did not ask for, so the
 * first suite below is not a set of examples: it is an equivalence check over a
 * corpus, and it fails if the new rule admits *anything* the old rule refused.
 *
 * The corpus is deliberately ordinary. It contains topics and coverage from
 * software, football, music, science, transport and three non-Latin scripts,
 * because the second property this file asserts is that the rule has no opinion
 * about the domain it is applied to.
 */

/* -------------------------------------------------------------------------- */
/* Equivalence with the rule it replaces                                       */
/* -------------------------------------------------------------------------- */

/** Coverage as the shared signal looks after one normalisation. */
const SIGNALS = [
  "arsenal beat tottenham in the north london derby",
  "the gunners sign a midfielder from a bundesliga club",
  "rust 2 0 release candidate published for testing",
  "the rust compiler team published a roadmap",
  "nvidia partners with data center developer cloverleaf",
  "india and china held border talks in beijing",
  "nepal floods wash out the kathmandu valley",
  "tokyo underground club announces a new label night",
  "日本の音楽シーンは新しい時代に入った",
  "東京の音楽フェスが中止になった",
  "한국 음악 시장이 성장하고 있다",
  "नेपाल मा बाढी आयो",
  "sustainable architecture prize goes to a mass timber tower",
  "a new bus route opens between the two cities",
  "the musician released an album about the sea",
];

/** Labels a reader could type, and term lists as the database stores them. */
const TERM_LISTS: string[][] = [
  [],
  [""],
  ["", "nepal"],
  ["nepal"],
  ["nepal", "floods"],
  ["india", "china"],
  ["rust"],
  ["nvidia"],
  ["next", "js"],
  ["日本"],
  ["日本の音楽"],
  ["한국"],
  ["नेपाल"],
  ["architecture"],
  ["bus", "route"],
];

describe("the degenerate spec is the rule it replaced, term for term", () => {
  it("admits exactly what `matchesTerms` admitted, over the whole corpus", () => {
    // The equivalence is the acceptance criterion for the migration: a topic
    // that has never been given a specification must receive the same events
    // tomorrow as it did yesterday, for every signal and every term list, or
    // 0100 has silently rewritten what existing readers follow.
    //
    // Both sides take normalised input, because that is what the pipeline
    // actually passes: the signal through `normaliseText`, and the terms as
    // `topicTerms` stored them. Comparing against raw text instead would test a
    // contract neither caller has -- and would fail on Korean, whose syllables
    // NFKD-decompose, for a reason that exists only in the test.
    for (const raw of TERM_LISTS) {
      const terms = raw.map(normaliseText);
      for (const signal of SIGNALS) {
        const normalised = normaliseText(signal);
        expect(
          evaluateSpec(deriveSpecFromTerms(terms), normalised).matched,
          `${JSON.stringify(terms)} vs "${normalised}"`,
        ).toBe(matchesTerms(normalised, terms));
      }
    }
  });

  it("admits exactly what it admitted for a derived label, too", () => {
    for (const label of [
      "Arsenal",
      "Nepal floods",
      "India vs China",
      "Rust",
      "NVIDIA",
      "日本の音楽",
    ]) {
      for (const signal of SIGNALS) {
        expect(
          evaluateSpec(deriveSpec(label), normaliseText(signal)).matched,
          `"${label}" vs "${signal}"`,
        ).toBe(matchesTerms(normaliseText(signal), topicTerms(label)));
      }
    }
  });

  it("selects nothing when nothing is required", () => {
    // `matchesTerms([])` was false, and an empty term list is what a malformed
    // topic row looks like. Vacuous truth here would hand the reader the corpus.
    expect(evaluateSpec(deriveSpecFromTerms([]), "anything at all").matched).toBe(false);
    expect(deriveSpec("").require).toEqual([]);
    expect(evaluateSpec(deriveSpec(""), "anything at all").matched).toBe(false);
  });

  it("keeps a term that normalises to nothing as an unmatchable constraint", () => {
    // Dropping it as tidying would turn `["", "nepal"]` -- never matchable before
    // -- into `["nepal"]`, which matches. A loosening dressed as a cleanup.
    const withEmpty = deriveSpecFromTerms(["", "nepal"]);
    expect(withEmpty.require).toHaveLength(2);
    const nepal = "nepal floods wash out the kathmandu valley";
    expect(evaluateSpec(withEmpty, nepal).matched).toBe(false);
    expect(evaluateSpec(deriveSpecFromTerms(["nepal"]), nepal).matched).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* What the widening actually buys                                             */
/* -------------------------------------------------------------------------- */

describe("a group is one subject wearing several names", () => {
  const arsenal: MatchSpec = {
    v: 1,
    require: [[{ text: "Arsenal" }, { text: "Gunners" }, { text: "North London derby" }]],
  };

  it("reaches the subject under a name the reader never typed", () => {
    expect(evaluateSpec(arsenal, normaliseText("The Gunners sign a midfielder")).matched).toBe(
      true,
    );
    expect(evaluateSpec(arsenal, normaliseText("North London derby ends level")).matched).toBe(
      true,
    );
    expect(evaluateSpec(arsenal, normaliseText("Arsenal beat Tottenham")).matched).toBe(true);
  });

  it("does not reach the subject's absence", () => {
    // "Arsenal" is also a word in other subjects' coverage. The group is what
    // makes the alias safe: it is one constraint with alternatives, not a free
    // pass for every term anyone added.
    expect(evaluateSpec(arsenal, normaliseText("A museum opens in the city")).matched).toBe(false);
  });
});

describe("groups are ANDed, alternatives inside a group are ORed", () => {
  it("still needs both halves of a relationship", () => {
    // The behaviour `topicTerms("India vs China")` has always had: a story about
    // either country alone is not a story about the relationship.
    const relationship: MatchSpec = {
      v: 1,
      require: [[{ text: "india" }], [{ text: "china" }]],
    };
    const both = normaliseText("India and China held border talks");
    const one = normaliseText("India holds a general election");
    expect(evaluateSpec(relationship, both).matched).toBe(true);
    expect(evaluateSpec(relationship, one).matched).toBe(false);
  });

  it("lets a two-name group stand in for one of those halves", () => {
    const spec: MatchSpec = {
      v: 1,
      require: [
        [{ text: "japanese" }, { text: "japan" }, { text: "tokyo" }],
        [{ text: "electronic music" }, { text: "techno" }],
      ],
    };
    // The subject is named three ways and the form twice. One city's scene is
    // enough, and one country's interest rates are not.
    const scene = normaliseText("Tokyo techno scene grows");
    const japanOnly = normaliseText("Japan raises interest rates");
    expect(evaluateSpec(spec, scene).matched).toBe(true);
    expect(evaluateSpec(spec, japanOnly).matched).toBe(false);
  });
});

describe("optional terms boost and never admit", () => {
  const spec: MatchSpec = {
    v: 1,
    require: [[{ text: "rust" }]],
    optional: [{ text: "compiler" }, { text: "cargo" }],
  };

  it("does not let a guess become the reason an event is admitted", () => {
    // `compiler` alone is not Rust. If optional terms admitted, every enrichment
    // guess would silently widen the reader's interest -- and, worse, the guess
    // would be validated by the matches it caused.
    expect(evaluateSpec(spec, normaliseText("The compiler team published a roadmap")).matched).toBe(
      false,
    );
  });

  it("ranks a covered alias above a bare hit", () => {
    const bare = evaluateSpec(spec, normaliseText("Rust 2.0 release candidate published"));
    const withAlias = evaluateSpec(
      spec,
      normaliseText("Rust compiler 2.0 release candidate published"),
    );
    expect(bare.matched).toBe(true);
    expect(withAlias.matched).toBe(true);
    expect(withAlias.strength).toBeGreaterThan(bare.strength);
  });
});

describe("promotion needs evidence from outside the term's own matches", () => {
  const spec: MatchSpec = {
    v: 1,
    require: [[{ text: "rust" }]],
    optional: [{ text: "borrow checker" }],
  };

  /** Evidence keyed the way the evaluator normalises a term. */
  function evidence(matchedEvents: number, engaged = false): Map<string, TermEvidence> {
    return new Map([["borrow checker", { matchedEvents, engaged }]]);
  }

  it("refuses a guess that has been seen once", () => {
    // One match is the guess restated. Acting on it would change what the reader
    // receives on the strength of a coincidence.
    expect(promotionCandidates(spec, evidence(1))).toEqual([]);
    expect(promotionCandidates(spec, evidence(PROMOTION_MIN_MATCHES - 1))).toEqual([]);
  });

  it("promotes a term the coverage independently kept confirming", () => {
    // The counted events are ones the *rest* of the spec already selected, so
    // promotion cannot bootstrap itself: the evidence exists before the term can
    // admit anything.
    const promoted = promotionCandidates(spec, evidence(PROMOTION_MIN_MATCHES));
    expect(promoted.map((t) => t.text)).toEqual(["borrow checker"]);
    const next = promoteTerms(spec, promoted);
    // Promoted to an alternative name of the group it aliases -- an OR inside the
    // one constraint -- never a new AND group. Appending it as its own group (the
    // previous behaviour, which this test used to bless) narrowed the interest:
    // every Rust story that did not mention the borrow checker stopped reaching
    // the people following Rust.
    expect(next.require).toEqual([[{ text: "rust" }, { text: "borrow checker" }]]);
    expect(next.optional).toEqual([]);
    expect(evaluateSpec(next, normaliseText("Rust 1.90 ships a faster linker")).matched).toBe(true);
    expect(evaluateSpec(next, normaliseText("The borrow checker got simpler")).matched).toBe(true);
    expect(evaluateSpec(spec, normaliseText("The borrow checker got simpler")).matched).toBe(false);
  });

  it("promotes immediately when the reader engaged with the subject", () => {
    expect(promotionCandidates(spec, evidence(1, true)).map((t) => t.text)).toEqual([
      "borrow checker",
    ]);
  });

  it("is a no-op when there is nothing to promote", () => {
    expect(promoteTerms(spec, [])).toBe(spec);
  });
});

describe("exclusions veto, whatever else matched", () => {
  it("refuses an event the topic has excluded", () => {
    const spec: MatchSpec = {
      v: 1,
      require: [[{ text: "arsenal" }, { text: "gunners" }]],
      exclude: [{ text: "transfer rumour" }],
    };
    const rumour = normaliseText("Gunners transfer rumour roundup");
    expect(evaluateSpec(spec, rumour).matched).toBe(false);
    expect(evaluateSpec(spec, rumour).strength).toBe(0);
    expect(evaluateSpec(spec, normaliseText("Gunners win away")).matched).toBe(true);
  });

  it("holds an exact phrase to the whole phrase", () => {
    // How a high-precision alias is written without loosening the rest: the
    // phrase has to appear as written, and nothing else about the spec changes.
    const spec: MatchSpec = {
      v: 1,
      require: [[{ text: "bus route", kind: "exact-phrase" }]],
    };
    expect(evaluateSpec(spec, normaliseText("A new bus route opens")).matched).toBe(true);
    expect(evaluateSpec(spec, normaliseText("The bus changed its route")).matched).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Language                                                                    */
/* -------------------------------------------------------------------------- */

describe("terms in scripts without spaces survive as themselves", () => {
  it("matches Japanese coverage, which ASCII folding would have deleted", () => {
    // `relate.ts`'s old `norm` collapsed everything outside `[a-z0-9]`, so a
    // Japanese interest normalised to the empty string and matched nothing, ever.
    const spec: MatchSpec = {
      v: 1,
      require: [
        [
          { text: "東京", lang: "ja" },
          { text: "日本", lang: "ja" },
        ],
        [{ text: "音楽", lang: "ja" }],
      ],
    };
    expect(evaluateSpec(spec, normaliseText("東京の音楽フェスが中止になった")).matched).toBe(true);
    expect(evaluateSpec(spec, normaliseText("日本の音楽シーンは新しい時代に入った")).matched).toBe(
      true,
    );
    expect(evaluateSpec(spec, normaliseText("東京の交通網が拡張された")).matched).toBe(false);
  });

  it("matches Chinese and Korean coverage through the same evaluator", () => {
    const chinese: MatchSpec = {
      v: 1,
      require: [[{ text: "中国", lang: "zh" }], [{ text: "音乐", lang: "zh" }]],
    };
    expect(evaluateSpec(chinese, normaliseText("中国音乐市场增长")).matched).toBe(true);
    expect(evaluateSpec(chinese, normaliseText("中国汽车出口增长")).matched).toBe(false);

    const korean: MatchSpec = {
      v: 1,
      require: [[{ text: "한국", lang: "ko" }], [{ text: "음악", lang: "ko" }]],
    };
    expect(evaluateSpec(korean, normaliseText("한국 음악 시장이 성장하고 있다")).matched).toBe(
      true,
    );
    expect(evaluateSpec(korean, normaliseText("한국 반도체 수출이 늘었다")).matched).toBe(false);
  });

  it("keeps a Devanagari term's marks", () => {
    // Vowel signs are combining marks. A rule that stripped them would match a
    // different word, which is worse than matching none.
    const spec: MatchSpec = { v: 1, require: [[{ text: "नेपाल", lang: "ne" }]] };
    expect(evaluateSpec(spec, normaliseText("नेपाल मा बाढी आयो")).matched).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The stored spec                                                             */
/* -------------------------------------------------------------------------- */

describe("`{}` means derive, and anything else means itself", () => {
  const terms = ["rust", "compiler"];

  it("derives when the column is empty or absent", () => {
    expect(specForTopic({ terms })).toEqual(deriveSpecFromTerms(terms));
    expect(specForTopic({ terms, match_spec: {} })).toEqual(deriveSpecFromTerms(terms));
  });

  it("uses a stored specification, whichever shape carries it", () => {
    // The column is `match_spec`; the reader projection shortens it to `spec`.
    // Accepting both means a caller cannot pass its own spec and silently get the
    // derived one instead.
    const stored: MatchSpec = {
      v: 1,
      require: [[{ text: "Arsenal" }, { text: "Gunners" }]],
      optional: [{ text: "Emirates" }],
    };
    expect(specForTopic({ terms, match_spec: stored })).toEqual(stored);
    expect(specForTopic({ terms, spec: stored })).toEqual(stored);
  });

  it("derives from the terms, which is the value that was actually matching", () => {
    // Deriving from `label` instead could differ, because `MAX_TERMS` clips a
    // long one. Silently changing an existing reader's matches is the thing this
    // migration must not do.
    const clipped = ["nepal", "floods", "rescue", "monsoon"];
    expect(specForTopic({ terms: clipped, match_spec: {} })).toEqual(deriveSpecFromTerms(clipped));
  });
});

/* -------------------------------------------------------------------------- */
/* Domain neutrality                                                           */
/* -------------------------------------------------------------------------- */

describe("the same rule serves every domain, with no branch on any of them", () => {
  /**
   * Interests and their coverage, one per domain, all handled by one evaluator.
   *
   * The fixture is the specification: software, football, music, science,
   * transport and a profession are in here precisely so that a future change
   * that needs a domain-specific shortcut has somewhere to fail.
   */
  const CASES: { interest: MatchSpec; hit: string; miss: string }[] = [
    {
      interest: {
        v: 1,
        require: [[{ text: "rust" }], [{ text: "release" }, { text: "compiler" }]],
      },
      hit: normaliseText("Rust release candidate published"),
      miss: normaliseText("A new bridge opens in Kyoto"),
    },
    {
      interest: { v: 1, require: [[{ text: "arsenal" }, { text: "gunners" }]] },
      hit: normaliseText("Gunners win at home"),
      miss: normaliseText("The museum reopens"),
    },
    {
      interest: {
        v: 1,
        require: [
          [{ text: "japanese" }, { text: "東京" }],
          [{ text: "music" }, { text: "音楽" }],
        ],
      },
      hit: normaliseText("東京の音楽フェスが中止になった"),
      miss: normaliseText("Tokyo opens a new metro line"),
    },
    {
      interest: {
        v: 1,
        require: [[{ text: "sustainable architecture" }, { text: "mass timber" }]],
      },
      hit: normaliseText("A mass timber tower wins the prize"),
      miss: normaliseText("Bond yields rose again"),
    },
    {
      interest: { v: 1, require: [[{ text: "bus route" }], [{ text: "tokyo" }]] },
      hit: normaliseText("A new bus route opens in Tokyo"),
      miss: normaliseText("A new bus route opens in Osaka"),
    },
    {
      interest: {
        v: 1,
        require: [[{ text: "neuroscience" }], [{ text: "preprint" }, { text: "study" }]],
      },
      hit: normaliseText("A neuroscience study is published"),
      miss: normaliseText("The company filed its accounts"),
    },
    {
      interest: { v: 1, require: [[{ text: "a very obscure local technology project" }]] },
      hit: normaliseText("A very obscure local technology project shipped version two"),
      miss: normaliseText("Something entirely unrelated happened"),
    },
  ];

  it("serves every domain from the same evaluator", () => {
    for (const { interest, hit, miss } of CASES) {
      expect(evaluateSpec(interest, hit).matched, hit).toBe(true);
      expect(evaluateSpec(interest, miss).matched, miss).toBe(false);
    }
  });

  it("has no domain vocabulary in the matcher to branch on", () => {
    // The rule the architecture turns on, asserted against the source: the
    // evaluator may not know what a domain is. Words like these appearing in
    // `match-spec.ts` or the matching branch of `match.ts` would mean someone
    // answered a domain question with a domain list -- which is the one thing
    // that makes the next interest unservable.
    const domains =
      /\b(sports?|football|soccer|music|musician|technolog|software|developer|politic|financ|econom|science|scientist|health|transport(ation)?)\b/i;
    for (const file of ["src/lib/match-spec.ts", "src/lib/pipeline/match.ts"]) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        // Comments are allowed to name a domain -- the header of this very file
        // does. Code is not: a branch that knows what football is, is a branch
        // that only works for football.
        .filter(({ line }) => !/^(\/\/|\*|\/\*)/.test(line));
      expect(
        offenders
          .filter(({ line }) => domains.test(line))
          .map(({ number, line }) => `${file}:${number} ${line}`),
      ).toEqual([]);
    }
  });
});
