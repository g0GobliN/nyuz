import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import { enrich } from "./enrich";

afterEach(() => vi.unstubAllGlobals());

const ARTICLE_HTML = `<html><body><article>
  <p>Nvidia announced Monday it has agreed to acquire Hugging Face for $13 billion in cash and stock, the companies said in a joint statement.</p>
  <p>The deal is expected to close in the first quarter of next year, pending regulatory approval from both US and EU competition regulators.</p>
  <p>Hugging Face will continue operating as an independent subsidiary after the deal closes, according to the announcement published on the company's blog.</p>
  <p>Analysts said the acquisition represents a significant bet on open-source AI infrastructure, and could reshape competition among cloud providers in the coming years.</p>
</article></body></html>`;

const THIN_HTML = `<html><body><p>Please log in to continue reading this article.</p></body></html>`;

function source(id: string, allowed: boolean | null = true, failureCount = 0) {
  return {
    id,
    homepage: "https://example.com",
    enrichment_allowed: allowed,
    enrichment_failure_count: failureCount,
  };
}

function article(id: string, url: string, src: ReturnType<typeof source>) {
  return {
    id,
    url,
    event_id: "e1",
    published_at: new Date().toISOString(),
    sources: src,
  };
}

function fixture(opts: { flagEnabled?: boolean } = {}) {
  return new FakeDb({
    feature_flags: [{ key: "article_enrichment_enabled", enabled: opts.flagEnabled ?? true }],
    articles: [],
    article_evidence: [],
  });
}

function html(body: string) {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

describe("enrich", () => {
  it("does nothing when the feature flag is off", async () => {
    const db = fixture({ flagEnabled: false });
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1")));
    const spy = vi.fn(async () => html(ARTICLE_HTML));
    vi.stubGlobal("fetch", spy);

    const report = await enrich(asDb(db));

    expect(report.considered).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("enriches an eligible article and stores only structured evidence, never raw HTML", async () => {
    const db = fixture();
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", true)));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db));

    expect(report.enriched).toBe(1);
    expect(report.evidenceUnits).toBeGreaterThan(0);

    const row = db.rows("article_evidence").find((r) => r["article_id"] === "a1");
    expect(row?.["status"]).toBe("enriched");
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("<p>");
    expect(stored).not.toContain("<article>");
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ["article_id", "attempts", "evidence", "extracted_at", "source_word_count", "status"].sort(),
    );
  });

  it("checks robots.txt once per source domain and caches the decision", async () => {
    const db = fixture();
    db.rows("sources").push(source("s1", null));
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", null)));
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push(url);
        if (url.endsWith("/robots.txt")) {
          return new Response("User-agent: *\nDisallow: /admin\n", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        return html(ARTICLE_HTML);
      }),
    );

    await enrich(asDb(db));

    expect(calls.some((u) => u.endsWith("/robots.txt"))).toBe(true);
    const updatedSource = db.rows("sources").find((r) => r["id"] === "s1");
    expect(updatedSource?.["enrichment_allowed"]).toBe(true);
    expect(updatedSource?.["robots_checked_at"]).toBeTruthy();
  });

  it("blocks an article whose source disallows it via robots.txt, without fetching the page", async () => {
    const db = fixture();
    db.rows("sources").push(source("s1", null));
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", null)));
    const pageFetch = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/robots.txt")) {
          return new Response("User-agent: *\nDisallow: /\n", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        pageFetch();
        return html(ARTICLE_HTML);
      }),
    );

    const report = await enrich(asDb(db));

    expect(report.blocked).toBe(1);
    expect(pageFetch).not.toHaveBeenCalled();
    const row = db.rows("article_evidence").find((r) => r["article_id"] === "a1");
    expect(row?.["status"]).toBe("blocked");
  });

  it("marks an article unavailable when the page fetch fails", async () => {
    const db = fixture();
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", true)));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection reset");
      }),
    );

    const report = await enrich(asDb(db));

    expect(report.unavailable).toBe(1);
    const row = db.rows("article_evidence").find((r) => r["article_id"] === "a1");
    expect(row?.["status"]).toBe("unavailable");
  });

  it("marks an article unavailable when there is not enough extractable text (paywall-like page)", async () => {
    const db = fixture();
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", true)));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(THIN_HTML)),
    );

    const report = await enrich(asDb(db));

    expect(report.unavailable).toBe(1);
    expect(report.outcomes[0]?.detail).toMatch(/paywall/i);
  });

  it("never reprocesses an article that already has an evidence row", async () => {
    const db = fixture();
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", true)));
    db.rows("article_evidence").push({
      article_id: "a1",
      status: "enriched",
      evidence: [],
      source_word_count: 80,
      attempts: 1,
      extracted_at: new Date().toISOString(),
    });
    const spy = vi.fn(async () => html(ARTICLE_HTML));
    vi.stubGlobal("fetch", spy);

    const report = await enrich(asDb(db));

    expect(report.considered).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not throw when every fetch fails, so the pipeline can continue", async () => {
    const db = fixture();
    db.rows("articles").push(
      article("a1", "https://one.example.com/story", source("s1", true)),
      article("a2", "https://two.example.com/story", source("s2", true)),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const report = await enrich(asDb(db));

    expect(report.considered).toBe(2);
    expect(report.enriched).toBe(0);
  });

  it("respects the limit option", async () => {
    const db = fixture();
    db.rows("articles").push(
      article("a1", "https://example.com/1", source("s1", true)),
      article("a2", "https://example.com/2", source("s1", true)),
      article("a3", "https://example.com/3", source("s1", true)),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.considered).toBe(1);
  });

  it("an explicit --article target bypasses the feature flag", async () => {
    const db = fixture({ flagEnabled: false });
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", true)));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { articleId: "a1" });

    expect(report.enriched).toBe(1);
  });

  it("a dry run decides but writes nothing, the same convention cluster/analyse use", async () => {
    const db = fixture();
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", true)));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { dryRun: true });

    expect(report.enriched).toBe(1);
    expect(db.rows("article_evidence")).toHaveLength(0);
  });

  it("checks robots.txt at most once per source within a single run, even when several articles share it", async () => {
    const db = fixture();
    db.rows("sources").push(source("s1", null));
    db.rows("articles").push(
      article("a1", "https://example.com/story-1", source("s1", null)),
      article("a2", "https://example.com/story-2", source("s1", null)),
      article("a3", "https://example.com/story-3", source("s1", null)),
    );
    let robotsCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/robots.txt")) {
          robotsCalls += 1;
          return new Response("User-agent: *\n", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        return html(ARTICLE_HTML);
      }),
    );

    const report = await enrich(asDb(db), { limit: 3 });

    expect(robotsCalls).toBe(1);
    expect(report.enriched).toBe(3);
  });

  it("does not fetch the article page when robots permission is ambiguous, and does not cache a negative", async () => {
    const db = fixture();
    db.rows("sources").push(source("s1", null));
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", null)));
    const pageFetch = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/robots.txt")) throw new Error("robots.txt fetch timed out");
        pageFetch();
        return html(ARTICLE_HTML);
      }),
    );

    const report = await enrich(asDb(db));

    expect(pageFetch).not.toHaveBeenCalled();
    expect(report.blocked).toBe(1);
    expect(report.outcomes[0]?.reason).toBe("robots_unknown");
    const updatedSource = db.rows("sources").find((r) => r["id"] === "s1");
    expect(updatedSource?.["enrichment_allowed"]).toBeNull();
    expect(updatedSource?.["robots_checked_at"]).toBeFalsy();
  });

  it("skips a source's articles once its enrichment failure count crosses the threshold, without fetching", async () => {
    const db = fixture();
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", true, 5)));
    const spy = vi.fn(async () => html(ARTICLE_HTML));
    vi.stubGlobal("fetch", spy);

    const report = await enrich(asDb(db));

    expect(spy).not.toHaveBeenCalled();
    expect(report.skipped).toBe(1);
    expect(report.outcomes[0]?.reason).toBe("source_backoff");
    expect(db.rows("article_evidence")).toHaveLength(0);
  });

  it("increments the source's enrichment failure count when a fetch fails", async () => {
    const db = fixture();
    db.rows("sources").push(source("s1", true, 2));
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", true, 2)));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection reset");
      }),
    );

    await enrich(asDb(db));

    const updatedSource = db.rows("sources").find((r) => r["id"] === "s1");
    expect(updatedSource?.["enrichment_failure_count"]).toBe(3);
  });

  it("resets the source's enrichment failure count after a successful enrichment", async () => {
    const db = fixture();
    db.rows("sources").push(source("s1", true, 3));
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", true, 3)));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    await enrich(asDb(db));

    const updatedSource = db.rows("sources").find((r) => r["id"] === "s1");
    expect(updatedSource?.["enrichment_failure_count"]).toBe(0);
  });

  it("tallies outcomes by reason for a go/no-go breakdown", async () => {
    const db = fixture();
    db.rows("articles").push(
      article("a1", "https://one.example.com/story", source("s1", true)),
      article("a2", "https://two.example.com/story", source("s2", false)),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 2 });

    expect(report.reasons["success"]).toBe(1);
    expect(report.reasons["robots_blocked"]).toBe(1);
  });
});
