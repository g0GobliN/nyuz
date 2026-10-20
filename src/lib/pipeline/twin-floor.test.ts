import { describe, expect, it } from "vitest";
import { FUNCTION_WORDS, floorContentWords, floorNames, twinFloor } from "./twin-floor";

/**
 * The ruling #18 floor, pinned on stored rows.
 *
 * `scripts/twin-corpus-census.ts` reads this bar over 30 days of the corpus and
 * the numbers below are the rows it reads, verbatim, so a change to the floor
 * that quietly blesses a suppression fails here where no database is needed.
 *
 * The Plex2Shell pair is the case that made the tightening necessary: the
 * delivery pass fuses it, and it does not clear the bar — two stories with no
 * shared actor, product or incident, joined by the word "Hackers" (the first
 * word of one headline, and a Title Case capital in the other) plus `hacker`,
 * `exploit`, `flaw`, `server` and `day`.
 */

const PLEX2SHELL = {
  title: "Hackers Exploit Plex2Shell Flaws to Install Crypto Miners and Linux Proxy Backdoor",
  whatHappened:
    "Threat actors have begun to exploit a chain of vulnerabilities in Plex Media Server to deploy cryptocurrency miners and reverse proxy software, a day after a proof-of-concept (PoC) went public.",
};

const BEYONDTRUST = {
  title: "China-Linked Hackers Exploited BeyondTrust Zero-Day to Take Over Remote Support Servers",
  whatHappened:
    "The China-nexus cyber espionage group tracked as Armory Castle (previously UNC5221 or Warp Panda) exploited a newly disclosed security flaw in BeyondTrust Remote Support (formerly Bomgar) as a zero-day in late August 2026.",
};

const OPENCODE = {
  title: "Hackers hit AI coding tool OpenCode, running up charges on users’ AI accounts",
  whatHappened: "Attackers abused the coding agent to run up charges on users’ AI accounts.",
};

const JOHN_DEERE = {
  title: "A hacker broke into John Deere and SharkNinja with an army of AI agents",
  whatHappened:
    "A hacker broke into more than 100 websites using an army of AI agents that mostly operated on their own, according to findings from the AI security firm Norforge.",
};

const CHINESE_HACKER = {
  title: "A Chinese hacker used AI agents to break into more than 100 company websites",
  whatHappened:
    "Fewer than 100 Chinese characters were used, yet the agents had attempted ot break into more than 1,200 different websites as of the week ending October 18, 2026.",
};

describe("twin-floor", () => {
  it("does not clear the Plex2Shell / BeyondTrust pair", () => {
    const verdict = twinFloor(PLEX2SHELL, BEYONDTRUST);
    // The entity leg is what refuses it. `Hackers` is the first word of one
    // headline and a Title Case capital in the other, so neither side offers a
    // capitalisation that selects anything.
    expect(verdict.entities).toEqual([]);
    // The words it shares are real content words; the floor still refuses the
    // pair, which is the point — five generic security words are not a story.
    expect(verdict.words).toEqual(["day", "exploit", "flaw", "hacker", "server"]);
    expect(verdict.clears).toBe(false);
  });

  it("clears the pair ruling #18 bought", () => {
    // The delivered 2026-10-19 pair: Tom's Hardware and The Verge on one
    // break-in. If the tightening ever refuses this, it has refused the widening
    // the ruling paid for and the fixture is what says so.
    const verdict = twinFloor(CHINESE_HACKER, JOHN_DEERE);
    expect(verdict.entities).toEqual(["ai"]);
    expect(verdict.words).toEqual(["100", "agent", "hacker", "websit"]);
    expect(verdict.clears).toBe(true);
  });

  it("does not count a conjunction as a content word", () => {
    // These two are different stories and the pass fuses them on exactly
    // `hacker`, `agent` and `and`. `and` is not content, so the pair is two
    // shared words and does not clear the bar.
    const verdict = twinFloor(OPENCODE, JOHN_DEERE);
    expect(verdict.words).toEqual(["agent", "hacker"]);
    expect(verdict.words).not.toContain("and");
    expect(verdict.clears).toBe(false);
  });

  it("excludes every conjunction, article and preposition from the content words", () => {
    // The audit the tightening owes `and`: its siblings are named here so that
    // dropping one from the set is a failing test rather than a silent
    // loosening. Each word is measured inside a sentence that would otherwise
    // offer it as a shared token.
    const furniture = [
      "and",
      "the",
      "for",
      "but",
      "nor",
      "or",
      "from",
      "into",
      "over",
      "under",
      "between",
      "during",
      "with",
      "without",
      "than",
      "then",
      "them",
      "they",
      "this",
      "that",
      "these",
      "those",
      "what",
      "when",
      "where",
      "which",
      "while",
      "who",
      "how",
      "why",
      "all",
      "also",
      "any",
      "anyone",
      "each",
      "enough",
      "even",
      "ever",
      "every",
      "none",
      "nothing",
      "several",
      "some",
      "one",
      "only",
      "just",
      "very",
      "can",
      "could",
      "may",
      "might",
      "must",
      "shall",
      "should",
      "will",
      "would",
      "has",
      "had",
      "was",
      "were",
      "are",
      "its",
      "his",
      "her",
      "our",
      "your",
      "their",
    ];
    for (const word of furniture) {
      expect(FUNCTION_WORDS.has(word), `${word} must be a function word`).toBe(true);
      expect(
        floorContentWords(`hackers ${word} servers breached`).has(word),
        `${word} must not count as content`,
      ).toBe(false);
    }
    // The set is a grammar, not a vocabulary of every short word: real anchors
    // in the same shape still count.
    const words = floorContentWords("hackers behind servers breached");
    expect(words.has("hacker")).toBe(true);
    expect(words.has("server")).toBe(true);
    expect(words.has("breach")).toBe(true);
  });

  it("keeps counting a name the other side capitalises mid-title", () => {
    // The tightening must not become "ignore capitalisation": one headline opens
    // on Australia, the other names it mid-sentence, and that is a real shared
    // name. Refusing this would report a legitimate twin as a violation.
    const verdict = twinFloor(
      {
        title: "Australia to investigate if OpenAI hack of government health website broke the law",
        whatHappened:
          "The government said it would investigate whether the breach of a health website broke the law.",
      },
      {
        title:
          "AI hack of Medicare exposes Australia’s vulnerabilities and experts warn ‘there is more of this to come’",
        whatHappened:
          "Experts said the breach of the Medicare systems exposed long-standing vulnerabilities.",
      },
    );
    expect(verdict.entities).toContain("australia");
    expect(verdict.clears).toBe(true);
  });

  it("does not read a name out of a Title Case headline", () => {
    // Both headlines capitalise every word, so `Hackers` and `Backdoor` are not
    // names. A per-side "drop the first word" rule still cleared this pair on
    // `Backdoor`; the title-case guard is what stops it.
    const verdict = twinFloor(PLEX2SHELL, {
      title:
        "Hackers Backdoor Nextcloud Servers Through Critical Flaw in Collabora’s Built-in CODE App",
      whatHappened:
        "The flaw lets an authenticated user run code on servers running the Collabora built-in CODE app.",
    });
    expect(verdict.entities).toEqual([]);
    expect(verdict.words).toContain("backdoor");
    expect(verdict.clears).toBe(false);
  });

  it("clears a pair whose identity is a name and no event", () => {
    // The review triple ruling 2026-10-17 collapsed lives on the name, not on a
    // marker, and the floor must not refuse it: the product is written the same
    // way in both headlines and the shared words are real.
    const verdict = twinFloor(
      {
        title:
          "Benchmarked: Nvidia's RTX Spark notebook delivers serious local AI compute, at a price",
        whatHappened: "The laptop runs local models on a GB10 chip.",
      },
      {
        title: "A week with RTX Spark: everything we've learned using Nvidia's new laptops",
        whatHappened: "After seven days of daily use, the battery and the fan noise stand out.",
      },
    );
    expect(verdict.entities).toEqual(["nvidia", "rtx", "spark"]);
    expect(verdict.clears).toBe(true);
  });

  it("does not treat a capitalised function word as a name", () => {
    // `Why` after a colon is a sentence starting, not a name. Without the
    // function-word filter the floor could claim two unrelated headlines share
    // the entity *why*.
    const names = floorNames("Hack the World: Why hackathons are still the best place to learn");
    expect(names.has("why")).toBe(false);
    expect(names.has("world")).toBe(true);
  });
});
