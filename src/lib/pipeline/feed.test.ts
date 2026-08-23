/**
 * The parser against feeds that are broken.
 *
 * A real ingestion run proves it handles 64 feeds that work. This proves the part
 * the plan actually claims — "RSS and Atom parsing that survives malformed feeds"
 * — which no live run can demonstrate, because a publisher whose feed is broken in
 * an interesting way is not obliged to stay broken.
 *
 * Cases here are things feeds really do, not invented pathology. Where a case came
 * from a specific publisher, it says so.
 */

import { describe, expect, it } from "vitest";

import { parseFeed, toIso } from "./feed";

const RSS = (items: string, channel = "") => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example</title>${channel}${items}</channel></rss>`;

const ATOM = (entries: string) => `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Example</title>${entries}</feed>`;

describe("format detection", () => {
  it("reads RSS, Atom and RDF", () => {
    expect(parseFeed(RSS("")).format).toBe("rss");
    expect(parseFeed(ATOM("")).format).toBe("atom");
    expect(parseFeed(`<rdf:RDF xmlns:rdf="x"><channel/></rdf:RDF>`).format).toBe("rdf");
  });

  it("sees past a byte-order mark and leading whitespace", () => {
    // Both stop a naive `startsWith("<?xml")` sniff, and both are common enough
    // that getting this wrong loses whole publishers rather than single entries.
    expect(parseFeed(`\uFEFF${RSS("")}`).format).toBe("rss");
    expect(parseFeed(`\n\n  ${RSS("")}`).format).toBe("rss");
  });

  it("calls an HTML error page unknown rather than guessing", () => {
    const html = "<!doctype html><html><body><h1>404 Not Found</h1></body></html>";
    const feed = parseFeed(html);

    expect(feed.format).toBe("unknown");
    expect(feed.items).toEqual([]);
  });
});

describe("surviving breakage", () => {
  it("does not throw on any of the ways a document can end badly", () => {
    const broken = [
      "",
      "   ",
      "<rss><channel><item><title>Unclosed",
      "<rss><channel><item><title>A</title><link>https://e.com/a</link>",
      "</item></channel></rss>",
      "<rss><channel><item></item></channel></rss>",
      "not xml at all, just prose",
      "<<<>>><<",
      RSS("<item><title>A & B</title><link>https://e.com/a</link></item>"),
    ];

    for (const xml of broken) expect(() => parseFeed(xml)).not.toThrow();
  });

  it("keeps the good entries in a feed with bad ones", () => {
    // The point of the whole design: one unusable entry must not cost the others.
    const feed = parseFeed(
      RSS(`
        <item><title>Missing a link</title></item>
        <item><link>https://e.com/b</link></item>
        <item><title>Fine</title><link>https://e.com/c</link></item>
      `),
    );

    expect(feed.items.map((i) => i.title)).toEqual(["Fine"]);
    expect(feed.dropped).toBe(2);
  });

  it("reads an unescaped ampersand as text", () => {
    const feed = parseFeed(RSS("<item><title>M&S & Co</title><link>https://e.com/a</link></item>"));
    expect(feed.items[0]?.title).toBe("M&S & Co");
  });

  it("is not fooled by a closing tag inside CDATA", () => {
    // The classic failure of a regex-only parser: it closes the item early and
    // loses every entry after it.
    const feed = parseFeed(
      RSS(`
        <item>
          <title>First</title>
          <link>https://e.com/a</link>
          <description><![CDATA[Read more </item></channel> here]]></description>
        </item>
        <item><title>Second</title><link>https://e.com/b</link></item>
      `),
    );

    expect(feed.items.map((i) => i.title)).toEqual(["First", "Second"]);
  });

  it("closes on the right tag when an element nests inside itself", () => {
    const feed = parseFeed(
      RSS(`<item>
        <title>A</title><link>https://e.com/a</link>
        <content>outer <content>inner</content> tail</content>
      </item>`),
    );

    expect(feed.items[0]?.excerpt).toBe("outer inner tail");
  });
});

describe("links", () => {
  it("prefers rel=alternate over the first link in the entry", () => {
    // Blogger orders these the other way round. Taking the first one subscribes
    // the reader to a comment thread instead of the article.
    const feed = parseFeed(
      ATOM(`<entry><title>A</title>
        <link rel="replies" href="https://e.com/a/comments"/>
        <link rel="alternate" href="https://e.com/a"/>
      </entry>`),
    );

    expect(feed.items[0]?.link).toBe("https://e.com/a");
  });

  it("falls back to id or guid when there is no usable link", () => {
    expect(
      parseFeed(ATOM("<entry><title>A</title><id>https://e.com/a</id></entry>")).items[0]?.link,
    ).toBe("https://e.com/a");

    expect(
      parseFeed(RSS('<item><title>A</title><guid isPermaLink="true">https://e.com/a</guid></item>'))
        .items[0]?.link,
    ).toBe("https://e.com/a");
  });

  it("refuses a relative link and a scheme that is not http", () => {
    // `articles.url` has to be something a reader can click.
    const relative = parseFeed(RSS("<item><title>A</title><link>/story/a</link></item>"));
    const script = parseFeed(RSS("<item><title>A</title><link>javascript:void 0</link></item>"));

    expect(relative.items).toEqual([]);
    expect(script.items).toEqual([]);
  });
});

describe("authors", () => {
  it("unwraps the Atom author element and the RSS email convention", () => {
    expect(
      parseFeed(
        ATOM(
          "<entry><title>A</title><id>https://e.com/a</id><author><name>Jane Doe</name></author></entry>",
        ),
      ).items[0]?.author,
    ).toBe("Jane Doe");

    expect(
      parseFeed(
        RSS(
          "<item><title>A</title><link>https://e.com/a</link><author>ed@e.com (Jane Doe)</author></item>",
        ),
      ).items[0]?.author,
    ).toBe("Jane Doe");
  });

  it("prefers dc:creator to an author holding an email address", () => {
    const feed = parseFeed(
      RSS(`<item><title>A</title><link>https://e.com/a</link>
        <author>ed@e.com</author><dc:creator>Jane Doe</dc:creator></item>`),
    );

    expect(feed.items[0]?.author).toBe("Jane Doe");
  });
});

describe("skipDays", () => {
  it("reads the days the publisher says it does not publish", () => {
    // arXiv, verbatim. Without this, a Sunday liveness check switches off five
    // working feeds because they correctly served an empty channel.
    const feed = parseFeed(RSS("", "<skipDays><day>Saturday</day><day>Sunday</day></skipDays>"));

    expect(feed.skipDays).toEqual(["saturday", "sunday"]);
    expect(feed.items).toEqual([]);
  });

  it("ignores a day element inside an entry", () => {
    const feed = parseFeed(
      RSS("<item><title>A</title><link>https://e.com/a</link><day>Monday</day></item>"),
    );

    expect(feed.skipDays).toEqual([]);
  });

  it("is empty for the feeds that say nothing, which is nearly all of them", () => {
    expect(parseFeed(RSS("")).skipDays).toEqual([]);
  });
});

describe("toIso", () => {
  it("takes RFC 822 and ISO 8601", () => {
    expect(toIso("Tue, 12 Aug 2025 09:00:00 GMT")).toBe("2025-08-12T09:00:00.000Z");
    expect(toIso("2025-08-12T09:00:00Z")).toBe("2025-08-12T09:00:00.000Z");
  });

  it("maps the named zones V8 rejects outright", () => {
    // `new Date("… EST")` is Invalid Date in V8. Feeds emit it anyway.
    expect(toIso("Tue, 12 Aug 2025 09:00:00 EST")).toBe("2025-08-12T14:00:00.000Z");
    expect(toIso("Tue, 12 Aug 2025 09:00:00 PDT")).toBe("2025-08-12T16:00:00.000Z");
  });

  it("rejects a date far in the future", () => {
    // A typo'd year would otherwise pin the article to the top of every briefing
    // for as long as the product exists.
    expect(toIso("Tue, 12 Aug 2525 09:00:00 GMT")).toBeNull();
  });

  it("rejects a formatted zero timestamp", () => {
    expect(toIso("Thu, 01 Jan 1970 00:00:00 GMT")).toBeNull();
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(toIso("")).toBeNull();
    expect(toIso("last Tuesday")).toBeNull();
  });
});
