import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFeed } from "@/lib/pipeline/fetch";

/**
 * The transport's two obligations, both of them security obligations.
 *
 * `fetchFeed` is the only way feed bytes enter this process, and since source
 * discovery it fetches URLs derived from reader-typed interests. So the tests
 * that matter are not "does it parse" -- `feed.test.ts` owns that -- but the two
 * ceilings that bound what a hostile or broken destination can cost: how far a
 * redirect chain may lead the fetch, and how much of an address it will accept.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function feed(): Response {
  return new Response('<?xml version="1.0"?><rss><channel><title>t</title></channel></rss>', {
    status: 200,
    headers: { "content-type": "application/rss+xml" },
  });
}

describe("redirects", () => {
  it("follows a short public chain and reports where it landed", async () => {
    let hop = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        hop += 1;
        if (hop <= 2) {
          return new Response(null, {
            status: 301,
            headers: { location: `https://example.com/hop${hop}` },
          });
        }
        return feed();
      }),
    );

    const result = await fetchFeed("https://example.com/start");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalUrl).toBe("https://example.com/hop2");
  });

  it("refuses a chain longer than the cap instead of chasing it", async () => {
    // Three hops, so a fourth is one too many. The point is not the exact number
    // but that the fetch has a number at all: an unbounded chain is a request
    // whose length the destination chooses.
    let hop = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        hop += 1;
        return new Response(null, {
          status: 301,
          headers: { location: `https://example.com/hop${hop}` },
        });
      }),
    );

    const result = await fetchFeed("https://example.com/start");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too many times/);
  });

  it("refuses a hop that points at a private address, on the way", async () => {
    // The hop after a public one is where a link-local or metadata address would
    // appear, so the check runs per hop rather than once on the submitted URL.
    let hop = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        hop += 1;
        return new Response(null, {
          status: 302,
          headers: {
            location:
              hop === 1 ? "http://169.254.169.254/latest/meta-data/" : "https://example.com/",
          },
        });
      }),
    );

    const result = await fetchFeed("https://example.com/start");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/non-public/);
  });
});

describe("the submitted address", () => {
  it("is refused before any request when it is not public", async () => {
    const spy = vi.fn(async () => feed());
    vi.stubGlobal("fetch", spy);

    for (const url of [
      "http://127.0.0.1:8080/feed",
      "http://10.0.0.5/feed",
      "http://[::1]/feed",
      "http://localhost/feed",
      "file:///etc/passwd",
    ]) {
      const result = await fetchFeed(url);
      expect(result.ok, url).toBe(false);
    }
    // Not one request was made: the guard is before the transport, not after it.
    expect(spy).not.toHaveBeenCalled();
  });

  it("is accepted when it is an ordinary public https URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => feed()),
    );
    expect((await fetchFeed("https://example.com/feed")).ok).toBe(true);
  });
});
