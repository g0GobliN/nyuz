import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchArticlePage, MAX_ARTICLE_BYTES } from "./article-fetch";

afterEach(() => vi.unstubAllGlobals());

const html = (body = "<p>Some article text here.</p>") =>
  new Response(`<html><body>${body}</body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

describe("fetchArticlePage", () => {
  it("fetches a public HTML page successfully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html()),
    );
    const result = await fetchArticlePage("https://example.com/story");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain("Some article text");
  });

  it("blocks a private/loopback address before ever calling fetch (SSRF)", async () => {
    const spy = vi.fn(async () => html());
    vi.stubGlobal("fetch", spy);
    const result = await fetchArticlePage("http://127.0.0.1/admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocks the cloud metadata address", async () => {
    const spy = vi.fn(async () => html());
    vi.stubGlobal("fetch", spy);
    const result = await fetchArticlePage("http://169.254.169.254/latest/meta-data");
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("re-validates a redirect target and blocks one that points at a private address", async () => {
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://example.com/story") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://10.0.0.5/internal" },
        });
      }
      return html();
    });
    vi.stubGlobal("fetch", spy);
    const result = await fetchArticlePage("https://example.com/story");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/non-public/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("follows a public redirect chain up to the limit", async () => {
    let hop = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        hop += 1;
        if (hop <= 6) {
          return new Response(null, {
            status: 301,
            headers: { location: `https://example.com/hop${hop}` },
          });
        }
        return html();
      }),
    );
    const result = await fetchArticlePage("https://example.com/start");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too many times/);
  });

  it("rejects a non-HTML response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    const result = await fetchArticlePage("https://example.com/api.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Not HTML/);
  });

  it("rejects a page over the size limit via content-length", async () => {
    // Relative to the constant, not a literal: the bound moved once already
    // (Audit 39, 1.5MB to 3MB) and a hardcoded body would have silently stopped
    // testing the guard rather than failing loudly.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html></html>", {
            status: 200,
            headers: {
              "content-type": "text/html",
              "content-length": String(MAX_ARTICLE_BYTES + 1),
            },
          }),
      ),
    );
    const result = await fetchArticlePage("https://example.com/huge");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/over the/);
  });

  it("accepts a page in the measured band between the old cap and the bound (Audit 39)", async () => {
    // The fetch survey that produced the ruling measured Tom's Hardware's pages
    // at 1.79-1.95MB with clean extraction, so a page in that band has to pass
    // the guard: the previous 1.5MB cap is what parked 784 unattempted
    // articles, and this pins the bound above the measured range.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html><body><p>Measured band page.</p></body></html>", {
            status: 200,
            headers: {
              "content-type": "text/html",
              "content-length": String(1.95 * 1024 * 1024),
            },
          }),
      ),
    );
    const result = await fetchArticlePage("https://example.com/measured-band");
    expect(result.ok).toBe(true);
  });

  it("treats a thrown network error (e.g. a timeout) as retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      }),
    );
    const result = await fetchArticlePage("https://example.com/slow");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });

  it("marks a 404 as not retryable and a 503 as retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const notFound = await fetchArticlePage("https://example.com/gone");
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.retryable).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const down = await fetchArticlePage("https://example.com/down");
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.retryable).toBe(true);
  });
});
