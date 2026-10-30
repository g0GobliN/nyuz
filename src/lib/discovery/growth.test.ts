import { describe, expect, it } from "vitest";
import {
  countriesForDay,
  GROWTH_COUNTRIES,
  hostKey,
  hostOf,
  isJunkHost,
  newSites,
  outboundLinks,
  outletIndexPage,
  outletLinksFromIndex,
  peerSites,
  siteRoot,
} from "./growth";

const NO_KNOWN: ReadonlySet<string> = new Set();

/* ---------------------------------------------------------------------- */
/* Hosts                                                                   */
/* ---------------------------------------------------------------------- */

describe("hostKey", () => {
  it("collapses www, m, amp and edition to one outlet", () => {
    expect(hostKey("https://www.example.com/news/1")).toBe("example.com");
    expect(hostKey("https://m.example.com/news/1")).toBe("example.com");
    expect(hostKey("https://amp.example.com/news/1")).toBe("example.com");
    expect(hostKey("https://edition.example.com/")).toBe("example.com");
  });

  it("keeps the country suffix whole", () => {
    expect(hostKey("https://www.bbc.co.uk/news")).toBe("bbc.co.uk");
    expect(hostKey("https://www.smh.com.au/politics")).toBe("smh.com.au");
    expect(hostKey("https://punchng.com/")).toBe("punchng.com");
    expect(hostKey("https://www.japantimes.co.jp/news")).toBe("japantimes.co.jp");
  });

  it("returns null for things that are not a public host", () => {
    expect(hostKey("mailto:editor@example.com")).toBeNull();
    expect(hostKey("/relative/path")).toBeNull();
    expect(hostKey("javascript:void(0)")).toBeNull();
    expect(hostKey("https://localhost/")).toBeNull();
    expect(hostKey("")).toBeNull();
  });
});

describe("hostOf", () => {
  it("strips www and lowercases", () => {
    expect(hostOf("https://WWW.Example.COM/x")).toBe("example.com");
  });

  it("rejects non-http schemes", () => {
    expect(hostOf("ftp://example.com/f")).toBeNull();
    expect(hostOf("file:///etc/passwd")).toBeNull();
  });
});

describe("siteRoot", () => {
  it("reduces an article URL to the site", () => {
    expect(siteRoot("https://www.example.com/2026/10/story.html?utm=x")).toBe(
      "https://example.com/",
    );
  });

  it("is null for a non-URL", () => {
    expect(siteRoot("not a url")).toBeNull();
  });
});

describe("isJunkHost", () => {
  it("refuses the platforms", () => {
    for (const host of [
      "facebook.com",
      "www.facebook.com",
      "x.com",
      "twitter.com",
      "youtube.com",
      "medium.com",
      "archive.org",
      "bit.ly",
      "en.wikipedia.org",
    ]) {
      expect(isJunkHost(host)).toBe(true);
    }
  });

  it("keeps a newspaper", () => {
    for (const host of ["punchng.com", "thehindu.com", "smh.com.au", "japantimes.co.jp"]) {
      expect(isJunkHost(host)).toBe(false);
    }
  });
});

/* ---------------------------------------------------------------------- */
/* Outbound links                                                          */
/* ---------------------------------------------------------------------- */

describe("outboundLinks", () => {
  const page = `
    <html><head>
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="stylesheet" href="/style.css">
    </head><body>
      <a href="https://www.peer.example/story">peer</a>
      <a href='//cdn.example.net/x'>protocol relative</a>
      <a href="/local">relative</a>
      <a href="#anchor">anchor</a>
      <a href="mailto:desk@example.com">mail</a>
      <a href="javascript:void(0)">js</a>
      <a href="https://twitter.com/example">social</a>
    </body></html>`;

  const links = outboundLinks(page, "https://origin.example/");

  it("keeps absolute, protocol-relative and declared feed links", () => {
    expect(links).toContain("https://www.peer.example/story");
    expect(links).toContain("https://cdn.example.net/x");
    expect(links).toContain("https://origin.example/local");
    expect(links).toContain("https://origin.example/feed.xml");
  });

  it("drops anchors, mailto, javascript and stylesheets", () => {
    expect(links.some((link) => link.includes("#anchor"))).toBe(false);
    expect(links.some((link) => link.startsWith("mailto:"))).toBe(false);
    expect(links.some((link) => link.startsWith("javascript:"))).toBe(false);
    expect(links.some((link) => link.includes("style.css"))).toBe(false);
  });

  it("keeps the social link here and filters it at the site level", () => {
    // Dropping it at extraction would make the filter untestable and would
    // also drop a real outlet whose domain merely contains a platform name.
    expect(links).toContain("https://twitter.com/example");
  });
});

/* ---------------------------------------------------------------------- */
/* Peer sites                                                              */
/* ---------------------------------------------------------------------- */

describe("peerSites", () => {
  const html = `
    <a href="https://www.peer-one.example/a">1</a>
    <a href="https://peer-one.example/b">same site, different page</a>
    <a href="https://www.known.example/">already in the catalogue</a>
    <a href="https://facebook.com/known">social</a>
    <a href="https://origin.example/about">ourselves</a>
    <a href="https://peer-two.example/">2</a>
    <a href="https://unknown-scheme.example:99999/">broken</a>`;

  const known = new Set(["known.example"]);

  it("returns new peers as roots, deduplicated, in page order", () => {
    expect(peerSites({ html, pageUrl: "https://origin.example/", knownHosts: known })).toEqual([
      "https://peer-one.example/",
      "https://peer-two.example/",
    ]);
  });

  it("caps the result", () => {
    const many = Array.from(
      { length: 60 },
      (_, index) => `<a href="https://p${index}.example/">x</a>`,
    ).join("");
    expect(
      peerSites({
        html: many,
        pageUrl: "https://origin.example/",
        knownHosts: NO_KNOWN,
        limit: 10,
      }),
    ).toHaveLength(10);
  });

  it("returns nothing for a page of self links and junk", () => {
    const boring = `<a href="https://origin.example/a">a</a><a href="https://x.com/b">b</a>`;
    expect(
      peerSites({ html: boring, pageUrl: "https://origin.example/", knownHosts: NO_KNOWN }),
    ).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- */
/* Outlet indexes                                                          */
/* ---------------------------------------------------------------------- */

describe("outletLinksFromIndex", () => {
  it("reads the externallinks array", () => {
    const payload = {
      parse: {
        title: "List of newspapers in Nigeria",
        externallinks: ["https://punchng.com/", "https://www.vanguardngr.com/"],
      },
    };
    expect(outletLinksFromIndex(payload)).toEqual([
      "https://punchng.com/",
      "https://www.vanguardngr.com/",
    ]);
  });

  it("is empty for a page that does not exist", () => {
    expect(outletLinksFromIndex({ error: { code: "missingtitle" } })).toEqual([]);
  });

  it("is empty for junk payloads", () => {
    expect(outletLinksFromIndex(null)).toEqual([]);
    expect(outletLinksFromIndex("nope")).toEqual([]);
    expect(outletLinksFromIndex({ parse: { externallinks: "nope" } })).toEqual([]);
    expect(
      outletLinksFromIndex({ parse: { externallinks: [1, 2, "https://a.example/"] } }),
    ).toEqual(["https://a.example/"]);
  });
});

describe("outletIndexPage", () => {
  it("builds the Wikipedia page for a country", () => {
    expect(outletIndexPage("Nigeria")).toBe(
      "https://en.wikipedia.org/wiki/List_of_newspapers_in_Nigeria",
    );
    expect(outletIndexPage("New_Zealand")).toBe(
      "https://en.wikipedia.org/wiki/List_of_newspapers_in_New_Zealand",
    );
  });
});

describe("newSites", () => {
  it("filters junk, known hosts, the index's own site and duplicates", () => {
    const links = [
      "https://en.wikipedia.org/wiki/Nigeria",
      "https://punchng.com/",
      "https://www.punchng.com/latest",
      "https://known.example/",
      "https://x.com/someone",
      "https://vanguardngr.com/",
    ];
    expect(
      newSites(links, {
        pageUrl: "https://en.wikipedia.org/wiki/List_of_newspapers_in_Nigeria",
        knownHosts: new Set(["known.example"]),
      }),
    ).toEqual(["https://punchng.com/", "https://vanguardngr.com/"]);
  });

  it("respects the limit", () => {
    const links = Array.from({ length: 500 }, (_, index) => `https://s${index}.example/`);
    expect(newSites(links, { knownHosts: NO_KNOWN, limit: 150 })).toHaveLength(150);
  });
});

/* ---------------------------------------------------------------------- */
/* Rotation                                                                */
/* ---------------------------------------------------------------------- */

describe("countriesForDay", () => {
  const countries = ["A", "B", "C", "D", "E"];

  it("walks the list without repeats inside a day", () => {
    expect(countriesForDay({ dayIndex: 0, perDay: 2, countries })).toEqual(["A", "B"]);
    expect(countriesForDay({ dayIndex: 1, perDay: 2, countries })).toEqual(["C", "D"]);
  });

  it("moves the window forward by a whole day's worth", () => {
    // Day 2 starts at index (2 * 3) % 5 = 1 and walks three, wrapping.
    expect(countriesForDay({ dayIndex: 2, perDay: 3, countries })).toEqual(["B", "C", "D"]);
    expect(countriesForDay({ dayIndex: 3, perDay: 3, countries })).toEqual(["E", "A", "B"]);
  });

  it("is deterministic in the day", () => {
    expect(countriesForDay({ dayIndex: 7, perDay: 3, countries })).toEqual(
      countriesForDay({ dayIndex: 7, perDay: 3, countries }),
    );
  });

  it("covers every country before it repeats", () => {
    const seen = new Set<string>();
    for (let dayIndex = 0; dayIndex < countries.length; dayIndex += 1) {
      for (const country of countriesForDay({ dayIndex, perDay: 1, countries })) seen.add(country);
    }
    expect(seen.size).toBe(countries.length);
  });

  it("asks for nothing when the day is not moving", () => {
    expect(countriesForDay({ dayIndex: 3, perDay: 0, countries })).toEqual([]);
    expect(countriesForDay({ dayIndex: 3, perDay: 2, countries: [] })).toEqual([]);
  });

  it("never asks for more countries than exist", () => {
    expect(countriesForDay({ dayIndex: 0, perDay: 10, countries })).toHaveLength(countries.length);
  });

  it("ships a rotation long enough for months", () => {
    expect(GROWTH_COUNTRIES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(GROWTH_COUNTRIES).size).toBe(GROWTH_COUNTRIES.length);
  });
});
