/**
 * The canonicaliser, including the promises its own doc comment makes.
 *
 * Two of these tests exist to stop a future optimisation rather than to check a
 * calculation: `www.` and `m.` are deliberately *not* stripped, and a hyphen is
 * deliberately *not* treated as an outlet separator. Both would merge more rows,
 * and both would break real articles. A test is the only thing that will explain
 * that to somebody who notices the missed duplicates and reaches for the obvious
 * fix.
 */

import { describe, expect, it } from "vitest";

import { canonicalUrl, contentHash, normaliseTitle } from "./canonical";

describe("what it refuses", () => {
  it("returns null for anything a reader could not open", () => {
    for (const raw of [
      "",
      "   ",
      "not a url",
      "/relative/path",
      "javascript:alert(1)",
      "data:text/html,<h1>hi</h1>",
      "mailto:ed@example.com",
      "ftp://example.com/file",
      "https://",
    ]) {
      expect(canonicalUrl(raw), raw).toBeNull();
    }
  });
});

describe("the parts the spec calls insignificant", () => {
  it("lowercases the scheme and host but never the path", () => {
    // A path is case-sensitive on every server that serves files from a disk.
    expect(canonicalUrl("HTTPS://Example.COM/Story/A")).toBe("https://example.com/Story/A");
  });

  it("drops the default port and keeps any other", () => {
    expect(canonicalUrl("https://example.com:443/a")).toBe("https://example.com/a");
    expect(canonicalUrl("http://example.com:80/a")).toBe("http://example.com/a");
    expect(canonicalUrl("https://example.com:8443/a")).toBe("https://example.com:8443/a");
  });

  it("drops one trailing slash", () => {
    expect(canonicalUrl("https://example.com/story/")).toBe("https://example.com/story");
    // The root is a path and cannot be emptied.
    expect(canonicalUrl("https://example.com/")).toBe("https://example.com/");
    expect(canonicalUrl("https://example.com")).toBe("https://example.com/");
  });

  it("sorts the query so parameter order stops mattering", () => {
    expect(canonicalUrl("https://example.com/a?b=2&a=1")).toBe(
      canonicalUrl("https://example.com/a?a=1&b=2"),
    );
  });
});

describe("tracking parameters", () => {
  it("removes the utm_ family, including invented ones", () => {
    expect(
      canonicalUrl("https://example.com/a?utm_source=rss&utm_medium=feed&utm_pubreferrer=x"),
    ).toBe("https://example.com/a");
  });

  it("removes ad-click and marketing identifiers", () => {
    for (const param of ["fbclid=x", "gclid=x", "msclkid=x", "mc_cid=x", "_hsenc=x", "igshid=x"]) {
      expect(canonicalUrl(`https://example.com/a?${param}`), param).toBe("https://example.com/a");
    }
  });

  it("removes ref and source, which on a feed item always mean the feed", () => {
    expect(canonicalUrl("https://example.com/a?ref=rss&source=rss")).toBe("https://example.com/a");
  });

  it("keeps a parameter that selects content", () => {
    // The test for belonging on the strip list is whether removing it can change
    // which article is served. These can.
    expect(canonicalUrl("https://example.com/story?id=42&page=2")).toBe(
      "https://example.com/story?id=42&page=2",
    );
  });
});

describe("session identifiers", () => {
  it("removes the unambiguously named ones", () => {
    expect(canonicalUrl("https://example.com/a?PHPSESSID=abc123")).toBe("https://example.com/a");
    expect(canonicalUrl("https://example.com/a;jsessionid=A1B2C3/b")).toBe(
      "https://example.com/a/b",
    );
  });

  it("removes an ambiguous name only when the value looks like a token", () => {
    // `sid=1024` is a story on some sites; `sid=` a long opaque string never is.
    expect(canonicalUrl("https://example.com/a?sid=1024")).toBe("https://example.com/a?sid=1024");
    expect(canonicalUrl("https://example.com/a?sid=9f8e7d6c5b4a39281706")).toBe(
      "https://example.com/a",
    );
  });
});

describe("AMP", () => {
  it("removes the suffix from the path", () => {
    for (const path of ["/story/amp", "/story/amp/", "/story.amp", "/story/amp.html"]) {
      expect(canonicalUrl(`https://example.com${path}`), path).toBe("https://example.com/story");
    }
  });

  it("removes a parameter asking for the AMP rendering", () => {
    expect(canonicalUrl("https://example.com/a?amp=1")).toBe("https://example.com/a");
    expect(canonicalUrl("https://example.com/a?output=amp")).toBe("https://example.com/a");
  });

  it("keeps amp=0, which is a publisher asking for the real page", () => {
    expect(canonicalUrl("https://example.com/a?amp=0")).toBe("https://example.com/a?amp=0");
  });

  it("recovers the publisher's own URL from Google's cache", () => {
    // The path carries the real origin, so this is recovered exactly rather than
    // guessed — and the reader gets sent to the publisher, not to Google.
    expect(canonicalUrl("https://example-com.cdn.ampproject.org/c/s/example.com/story")).toBe(
      "https://example.com/story",
    );
    expect(canonicalUrl("https://example-com.cdn.ampproject.org/c/example.com/story")).toBe(
      "http://example.com/story",
    );
  });

  it("leaves an ampproject URL it cannot read alone rather than mangling it", () => {
    const odd = "https://example-com.cdn.ampproject.org/wrong/example.com/story";
    expect(canonicalUrl(odd)).toBe(odd);
  });
});

describe("fragments", () => {
  it("drops a position on the page", () => {
    expect(canonicalUrl("https://example.com/a#comments")).toBe("https://example.com/a");
  });

  it("keeps a hashbang route, which is the only thing naming the article", () => {
    expect(canonicalUrl("https://example.com/#!/story/1")).toBe("https://example.com/#!/story/1");
    expect(canonicalUrl("https://example.com/#/story/1")).toBe("https://example.com/#/story/1");
  });
});

describe("what it deliberately does not merge", () => {
  it("leaves www. alone", () => {
    // Stripping it would merge more rows and occasionally produce a host that
    // does not answer. A dead link costs more than a duplicate row, and the
    // duplicate costs one trigram comparison in stage 3.
    expect(canonicalUrl("https://www.example.com/a")).toBe("https://www.example.com/a");
    expect(canonicalUrl("https://www.example.com/a")).not.toBe(
      canonicalUrl("https://example.com/a"),
    );
  });

  it("leaves m. alone", () => {
    expect(canonicalUrl("https://m.example.com/a")).toBe("https://m.example.com/a");
  });
});

describe("the five forms of one article", () => {
  it("collapses the example from the module doc to two rows, not five", () => {
    const forms = [
      "https://example.com/story?utm_source=rss&utm_medium=feed",
      "https://example.com/story/",
      "https://example.com/story/amp/",
      "https://example-com.cdn.ampproject.org/c/s/example.com/story",
      "https://example.com/story#comments",
    ];

    const canonical = new Set(forms.map((f) => canonicalUrl(f)));
    expect([...canonical]).toEqual(["https://example.com/story"]);
  });
});

describe("normaliseTitle", () => {
  it("folds the typographic characters a CMS swaps overnight", () => {
    expect(normaliseTitle("Apple’s “new” thing — today…")).toBe('apple\'s "new" thing - today...');
  });

  it("collapses whitespace", () => {
    expect(normaliseTitle("  GPT-5\n\tships  now ")).toBe("gpt-5 ships now");
  });

  it("removes a trailing outlet name after a pipe or bullet", () => {
    expect(normaliseTitle("GPT-5 ships | Ars Technica")).toBe("gpt-5 ships");
    expect(normaliseTitle("GPT-5 ships • TechCrunch")).toBe("gpt-5 ships");
  });

  it("never cuts at a hyphen, because headlines contain hyphens", () => {
    // A rule that cut at the last dash would truncate hundreds of real headlines.
    expect(normaliseTitle("GPT-5 ships - what changed")).toBe("gpt-5 ships - what changed");
  });

  it("does not treat a long tail after a pipe as an outlet name", () => {
    const long = "A | " + "x".repeat(60);
    expect(normaliseTitle(long)).toBe(long.toLowerCase());
  });
});

describe("contentHash", () => {
  it("is stable and hex", async () => {
    const hash = await contentHash("https://example.com/a", "A title");

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await contentHash("https://example.com/a", "A title")).toBe(hash);
  });

  it("ignores a title change that is only typography", async () => {
    expect(await contentHash("https://example.com/a", "Apple’s thing")).toBe(
      await contentHash("https://example.com/a", "Apple's thing"),
    );
  });

  it("changes when the publisher rewrites the headline", async () => {
    // This is the one thing the hash does that the unique URL does not.
    expect(await contentHash("https://example.com/a", "First wording")).not.toBe(
      await contentHash("https://example.com/a", "Corrected wording"),
    );
  });

  it("cannot be confused by moving a character between the url and the title", async () => {
    // What the newline separator is for. Without it these two would collide.
    expect(await contentHash("https://example.com/a", "bc")).not.toBe(
      await contentHash("https://example.com/ab", "c"),
    );
  });
});
