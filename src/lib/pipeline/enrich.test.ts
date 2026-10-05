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
    // The probe's history read filters on this column; the fake does not
    // derive it from the embedded source.
    source_id: src.id,
    published_at: new Date().toISOString(),
    sources: src,
  };
}

function fixture(opts: { flagEnabled?: boolean } = {}) {
  return new FakeDb({
    feature_flags: [{ key: "article_enrichment_enabled", enabled: opts.flagEnabled ?? true }],
    articles: [],
    article_evidence: [],
    user_events: [],
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

  it("enriches a reader-visible story ahead of a newer article nobody matched", async () => {
    // The whole point of the stage: `article_evidence` is only read while
    // hydrating a view a reader can reach, so a fetch spent on an article on no
    // reader's matched event is a fetch that cannot deepen anything. Recency
    // alone pointed at the corpus, and on 2026-09-30 none of the day's 25
    // briefing stories had an enriched body.
    const db = fixture();
    db.rows("articles").push(
      {
        ...article("aMatched", "https://matched.example.com/story", source("s1", true)),
        event_id: "eMatched",
        // Two days old: it would lose a recency contest outright.
        published_at: new Date(Date.now() - 48 * 3600e3).toISOString(),
      },
      {
        ...article("aFresh", "https://fresh.example.com/story", source("s1", true)),
        event_id: "eUnmatched",
        published_at: new Date().toISOString(),
      },
    );
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eMatched",
      matched_at: new Date().toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    const done = db.rows("article_evidence").find((r) => r["status"] === "enriched");
    expect(done?.["article_id"]).toBe("aMatched");
  });

  it("enriches an article whose event a reader was delivered but whose match day has passed", async () => {
    // Audit 29: the priority arm read only the last 24h of matches, so an event
    // matched once, delivered, then left alone fell out of that arm — and out
    // of the 72h recency fallback, its articles now too old — and could never
    // be enriched by any later run. 145 events in the 30-day window were
    // stranded exactly this way, 60 of them delivered with zero evidence.
    const db = fixture();
    db.rows("articles").push({
      ...article("aDelivered", "https://delivered.example.com/story", source("s1", true)),
      event_id: "eDelivered",
      // Four days old: outside `activeCutoff`, so the fallback arm cannot see it.
      published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
    });
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eDelivered",
      // Three days ago: outside the arm's old 24h window.
      matched_at: new Date(Date.now() - 72 * 3600e3).toISOString(),
    });
    db.rows("deliveries").push({
      digest_id: "d1",
      // Two days ago: the touch that must keep the event enrichable.
      delivered_at: new Date(Date.now() - 48 * 3600e3).toISOString(),
    });
    db.rows("digest_items").push({ digest_id: "d1", event_id: "eDelivered" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    const done = db.rows("article_evidence").find((r) => r["status"] === "enriched");
    expect(done?.["article_id"]).toBe("aDelivered");
  });

  it("does not reach back past the seven-day touch window", async () => {
    // The arm anchors to reader visibility, not to the corpus: an event whose
    // last touch is eight days old has fallen out of every reader surface, and
    // its articles are for the recency fallback to judge on their own merits.
    const db = fixture();
    db.rows("articles").push(
      {
        ...article("aStale", "https://stale.example.com/story", source("s1", true)),
        event_id: "eStale",
        published_at: new Date(Date.now() - 8 * 24 * 3600e3).toISOString(),
      },
      {
        ...article("aFresh", "https://fresh.example.com/story", source("s1", true)),
        event_id: "eUnmatched",
        published_at: new Date().toISOString(),
      },
    );
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eStale",
      matched_at: new Date(Date.now() - 8 * 24 * 3600e3).toISOString(),
    });
    db.rows("deliveries").push({
      digest_id: "d1",
      delivered_at: new Date(Date.now() - 8 * 24 * 3600e3).toISOString(),
    });
    db.rows("digest_items").push({ digest_id: "d1", event_id: "eStale" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    const done = db.rows("article_evidence").find((r) => r["status"] === "enriched");
    expect(done?.["article_id"]).toBe("aFresh");
  });

  it("orders the priority set by the most recent touch across both arms", async () => {
    // Two events, both reader-visible, both with articles too old for the
    // recency fallback. The one touched most recently — here by a match an
    // hour ago, against a delivery three days ago — is the one the reader is
    // still looking at, so it goes first.
    const db = fixture();
    db.rows("articles").push(
      {
        ...article("aRecent", "https://recent.example.com/story", source("s1", true)),
        event_id: "eRecent",
        published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
      },
      {
        ...article("aOld", "https://old.example.com/story", source("s2", true)),
        event_id: "eOld",
        published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
      },
    );
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eRecent",
      matched_at: new Date(Date.now() - 1 * 3600e3).toISOString(),
    });
    db.rows("deliveries").push({
      digest_id: "d1",
      delivered_at: new Date(Date.now() - 72 * 3600e3).toISOString(),
    });
    db.rows("digest_items").push({ digest_id: "d1", event_id: "eOld" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 2 });

    expect(report.enriched).toBe(2);
    const first = db.rows("article_evidence").find((r) => r["article_id"] === "aRecent");
    const second = db.rows("article_evidence").find((r) => r["article_id"] === "aOld");
    expect(first?.["status"]).toBe("enriched");
    expect(second?.["status"]).toBe("enriched");
    // The most recent touch claims the first fetch of the run.
    expect(report.outcomes[0]?.articleId).toBe("aRecent");
  });

  it("keeps the newest touch when a reader touched the same event twice", async () => {
    // A repeat match and a repeat delivery both arrive newest-first, and a
    // delivery that is older than a match must not drag the event's priority
    // timestamp backwards — with the stale 2.5h touch kept, the 90-minute
    // competitor would win this race.
    const db = fixture();
    db.rows("articles").push(
      {
        ...article("aA", "https://a.example.com/story", source("s1", true)),
        event_id: "eA",
        published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
      },
      {
        ...article("aB", "https://b.example.com/story", source("s2", true)),
        event_id: "eB",
        published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
      },
    );
    db.rows("user_events").push(
      {
        user_id: "u1",
        event_id: "eA",
        matched_at: new Date(Date.now() - 1 * 3600e3).toISOString(),
      },
      {
        user_id: "u1",
        event_id: "eA",
        matched_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
      },
      {
        user_id: "u1",
        event_id: "eB",
        matched_at: new Date(Date.now() - 1.5 * 3600e3).toISOString(),
      },
    );
    db.rows("deliveries").push(
      { digest_id: "d1", delivered_at: new Date(Date.now() - 3 * 3600e3).toISOString() },
      { digest_id: "d1", delivered_at: new Date(Date.now() - 2.5 * 3600e3).toISOString() },
    );
    db.rows("digest_items").push({ digest_id: "d1", event_id: "eA" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    expect(report.outcomes[0]?.articleId).toBe("aA");
  });

  it("breaks ordering ties deterministically by event id", async () => {
    // Two events touched in the same millisecond cannot be ordered by recency;
    // the tie-break falls to the event id so the priority set is reproducible
    // run over run instead of depending on map iteration order.
    const db = fixture();
    const hourAgo = new Date(Date.now() - 1 * 3600e3).toISOString();
    db.rows("articles").push(
      {
        ...article("aC", "https://c.example.com/story", source("s1", true)),
        event_id: "eC",
        published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
      },
      {
        ...article("aD", "https://d.example.com/story", source("s2", true)),
        event_id: "eD",
        published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
      },
    );
    db.rows("user_events").push(
      { user_id: "u1", event_id: "eD", matched_at: hourAgo },
      { user_id: "u1", event_id: "eC", matched_at: hourAgo },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 2 });

    expect(report.enriched).toBe(2);
    expect(report.outcomes[0]?.articleId).toBe("aC");
    expect(report.outcomes[1]?.articleId).toBe("aD");
  });

  it("reaches eligible articles past a dead head of done rows", async () => {
    // Audit 29-B: at a twelve-row window filled with finished evidence rows,
    // the tick considered its dead head forever and never reached the healthy
    // article behind it. Sixty rows with the done set filtered before the slice
    // rotates the window instead of locking it. The eligible article here is
    // four days old — outside the recency fallback — so only the priority arm
    // can reach it, and it sits at position thirteen.
    const db = fixture();
    const articleIds: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const id = `aDone${i}`;
      articleIds.push(id);
      db.rows("articles").push({
        ...article(id, `https://done${i}.example.com/story`, source("s1", true)),
        event_id: `eDone${i}`,
        published_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
      });
      db.rows("user_events").push({
        user_id: "u1",
        event_id: `eDone${i}`,
        matched_at: new Date().toISOString(),
      });
      db.rows("article_evidence").push({
        article_id: id,
        status: "enriched",
        attempts: 1,
        evidence: [],
        extracted_at: new Date().toISOString(),
        source_word_count: 100,
      });
    }
    db.rows("articles").push({
      ...article("aEligible", "https://eligible.example.com/story", source("s1", true)),
      event_id: "eEligible",
      published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
    });
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eEligible",
      matched_at: new Date().toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    const done2 = db.rows("article_evidence").find((r) => r["article_id"] === "aEligible");
    expect(done2?.["status"]).toBe("enriched");
  });

  it("keeps the starvation-first window across a chunked arm read", async () => {
    // Audit 32: the arm caps at 400 reader-visible events, and 400 uuids do not
    // fit one `.in()` URL, so the read is chunked 2×200 and merged. The merge
    // must re-sort: the oldest article on an event at the far end of the arm
    // (second chunk) has to outrank the newer articles of the first chunk, not
    // lose to them because of which side of a chunk boundary it sits on.
    const db = fixture();
    for (let i = 1; i <= 250; i += 1) {
      const isNewest = i === 250;
      db.rows("articles").push({
        ...article(`aArm${i}`, `https://arm${i}.example.com/story`, source("s1", true)),
        event_id: `eArm${i}`,
        published_at: isNewest
          ? new Date().toISOString()
          : new Date(Date.now() - (i + 6) * 3600e3).toISOString(),
      });
      // Touch time orders the arm: event i is touched i MINUTES ago — all 250
      // stay inside the seven-day touch window, so event 249 — whose article is
      // the oldest in the arm — sits at the far end of the arm, in the second
      // chunk, and event 250's brand-new article must lose to it.
      db.rows("user_events").push({
        user_id: "u1",
        event_id: `eArm${i}`,
        matched_at: new Date(Date.now() - i * 60_000).toISOString(),
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    const done = db.rows("article_evidence").find((r) => r["status"] === "enriched");
    expect(done?.["article_id"]).toBe("aArm249");
  });

  it("caps the arm at four hundred reader-visible events", async () => {
    // The 401st-touched event falls off the cap. Its article is four days old,
    // outside the recency fallback, so if the cap leaked past 400 it would be
    // enriched and this test would fail — the cap is the only thing hiding it.
    const db = fixture();
    for (let i = 1; i <= 401; i += 1) {
      const offArm = i === 401;
      db.rows("articles").push({
        ...article(`aCap${i}`, `https://cap${i}.example.com/story`, source("s1", true)),
        event_id: `eCap${i}`,
        published_at: offArm
          ? new Date(Date.now() - 96 * 3600e3).toISOString()
          : new Date(Date.now() - 80 * 3600e3).toISOString(),
      });
      db.rows("user_events").push({
        user_id: "u1",
        event_id: `eCap${i}`,
        // Minutes, so every touch stays inside the seven-day window and the
        // cap — not the window — is what drops event 401 off the arm.
        matched_at: new Date(Date.now() - i * 60_000).toISOString(),
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    const done = db.rows("article_evidence").find((r) => r["status"] === "enriched");
    expect(done?.["article_id"]).not.toBe("aCap401");
  });

  it("walks the window backward past sixty done rows", async () => {
    // The closing fix of Audit 29-B: a fixed newest-60 prefix never rotates on
    // its own, because done rows STAY in it — sixty finished articles pin the
    // window and the backlog behind it waits for new arrivals. The tick now
    // re-reads the arm excluding the done ids, so the three healthy articles
    // behind sixty dead ones are this tick's work, not next week's.
    const db = fixture();
    for (let i = 0; i < 60; i += 1) {
      const id = `aDone${i}`;
      db.rows("articles").push({
        ...article(id, `https://done${i}.example.com/story`, source("s1", true)),
        event_id: `eDone${i}`,
        published_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
      });
      db.rows("user_events").push({
        user_id: "u1",
        event_id: `eDone${i}`,
        matched_at: new Date().toISOString(),
      });
      db.rows("article_evidence").push({
        article_id: id,
        status: "enriched",
        attempts: 1,
        evidence: [],
        extracted_at: new Date().toISOString(),
        source_word_count: 100,
      });
    }
    db.rows("articles").push(
      {
        ...article("aBacklog1", "https://backlog1.example.com/story", source("s1", true)),
        event_id: "eBacklog1",
        published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
      },
      {
        ...article("aBacklog2", "https://backlog2.example.com/story", source("s2", true)),
        event_id: "eBacklog2",
        published_at: new Date(Date.now() - 97 * 3600e3).toISOString(),
      },
      {
        ...article("aBacklog3", "https://backlog3.example.com/story", source("s3", true)),
        event_id: "eBacklog3",
        published_at: new Date(Date.now() - 98 * 3600e3).toISOString(),
      },
    );
    for (const event of ["eBacklog1", "eBacklog2", "eBacklog3"]) {
      db.rows("user_events").push({
        user_id: "u1",
        event_id: event,
        matched_at: new Date().toISOString(),
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 3 });

    expect(report.enriched).toBe(3);
    const enrichedIds = report.outcomes
      .filter((o) => o.decision === "enriched")
      .map((o) => o.articleId)
      .sort();
    expect(enrichedIds).toEqual(["aBacklog1", "aBacklog2", "aBacklog3"]);
  });

  it("opens the fallback when the priority window survives filtering empty", async () => {
    // The gate used to read `rows.length < limit` — the raw window size — so a
    // window holding one done article inerted the recency arm even though no
    // eligible work existed. It now reads the post-filter count (Audit 29-B).
    const db = fixture();
    db.rows("articles").push(
      {
        ...article("aDone", "https://done.example.com/story", source("s1", true)),
        event_id: "eTouched",
        published_at: new Date().toISOString(),
      },
      {
        ...article("aFresh", "https://fresh.example.com/story", source("s1", true)),
        event_id: "eUnmatched",
        published_at: new Date(Date.now() - 60_000).toISOString(),
      },
    );
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eTouched",
      matched_at: new Date().toISOString(),
    });
    db.rows("article_evidence").push({
      article_id: "aDone",
      status: "enriched",
      attempts: 1,
      evidence: [],
      extracted_at: new Date().toISOString(),
      source_word_count: 100,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    // The tick's own outcome names aFresh — aDone's pre-seeded row is not
    // evidence of anything this run did.
    expect(report.outcomes[0]?.articleId).toBe("aFresh");
    expect(report.outcomes[0]?.decision).toBe("enriched");
  });

  it("ignores reader-touch rows that do not name an event", async () => {
    // Defensive guards the arm carries because the schema allows both columns
    // to be null: a match row with no event, a delivery item with no event,
    // and an item whose digest id was rewritten out from under its delivery.
    // None of the three may crash the arm or leak into the priority set.
    const db = fixture();
    db.rows("articles").push({
      ...article("aFresh", "https://fresh.example.com/story", source("s1", true)),
      event_id: "eUnmatched",
      published_at: new Date().toISOString(),
    });
    db.rows("user_events").push({ user_id: "u1", matched_at: new Date().toISOString() });
    db.rows("deliveries").push({ digest_id: "d1", delivered_at: new Date().toISOString() });
    db.rows("digest_items").push({ digest_id: "d1", event_id: null });
    db.hooks.afterSelect = (table, rows) => {
      if (table === "digest_items") for (const row of rows) row["digest_id"] = "dRewritten";
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    // The priority set came out empty, so the stage fell back to recency and
    // enriched the unmatched fresh article rather than crashing.
    expect(report.enriched).toBe(1);
    const done = db.rows("article_evidence").find((r) => r["status"] === "enriched");
    expect(done?.["article_id"]).toBe("aFresh");
  });

  it("falls back to the recency window when the priority read fails", async () => {
    // The arms are an improvement, never a requirement: a database error on
    // any of their three reads degrades the tick to what recency alone would
    // have done, instead of costing the run. The touched event's article is
    // four days old — priority could reach it, recency cannot — so the tick
    // lands on the fresh unmatched article instead.
    const makeDb = (failing: string) => {
      const db = fixture();
      db.hooks.failSelect = (table) => (table === failing ? "connection refused" : null);
      db.rows("articles").push(
        {
          ...article("aStale", "https://stale.example.com/story", source("s1", true)),
          event_id: "eTouched",
          published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
        },
        {
          ...article("aFresh", "https://fresh.example.com/story", source("s2", true)),
          event_id: "eUnmatched",
          published_at: new Date().toISOString(),
        },
      );
      db.rows("deliveries").push({
        digest_id: "d1",
        delivered_at: new Date(Date.now() - 1 * 3600e3).toISOString(),
      });
      db.rows("digest_items").push({ digest_id: "d1", event_id: "eTouched" });
      return db;
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    for (const failing of ["user_events", "deliveries", "digest_items"]) {
      const db = makeDb(failing);
      const report = await enrich(asDb(db), { limit: 1 });
      expect(report.enriched, `failed read: ${failing}`).toBe(1);
      const done = db.rows("article_evidence").find((r) => r["status"] === "enriched");
      expect(done?.["article_id"]).toBe("aFresh");
    }
  });

  it("treats a thrown priority read like a failed one", async () => {
    // A throw from inside the arm is caught and answered with "no priority",
    // the same contract an error result gets.
    const db = fixture();
    db.hooks.afterSelect = (table) => {
      if (table === "user_events") throw new Error("socket hung up");
    };
    db.rows("articles").push({
      ...article("aFresh", "https://fresh.example.com/story", source("s1", true)),
      event_id: "eUnmatched",
      published_at: new Date().toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    const done = db.rows("article_evidence").find((r) => r["status"] === "enriched");
    expect(done?.["article_id"]).toBe("aFresh");
  });

  it("reclaims a claim an earlier run died holding", async () => {
    // Production held 93 `pending` rows, the oldest from 2026-09-17, each one a
    // run that crashed between the claim and the finish. Any row counted as
    // done, so those articles could never be enriched by any later run.
    const db = fixture();
    db.rows("articles").push(article("a1", "https://example.com/story", source("s1", true)));
    db.rows("article_evidence").push({
      article_id: "a1",
      status: "pending",
      attempts: 0,
      evidence: [],
      extracted_at: null,
      source_word_count: 0,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db));

    expect(report.enriched).toBe(1);
    const row = db.rows("article_evidence").find((r) => r["article_id"] === "a1");
    expect(row?.["status"]).toBe("enriched");
  });

  it("filters backoff rows out before the arm is sliced, so they cost no tick supply", async () => {
    // Audit 31: sixty window slots measured at 32 done + 28 source-backoff and
    // zero eligible — the backoff rows consumed window capacity they could
    // never return, because the refill pass excluded done ids only. Filtering
    // both before the slice means an old eligible article behind a wall of
    // backoff sources is still this tick's work.
    const db = fixture();
    for (let i = 0; i < 30; i += 1) {
      const id = `aBackoff${i}`;
      // Newer than the eligible article, so under the old newest-first window
      // these thirty rows would have taken the slots and starved it.
      db.rows("articles").push({
        ...article(id, `https://backoff${i}.example.com/story`, source(`sBackoff${i}`, true, 5)),
        event_id: `eBackoff${i}`,
        published_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
      });
      db.rows("user_events").push({
        user_id: "u1",
        event_id: `eBackoff${i}`,
        matched_at: new Date().toISOString(),
      });
    }
    db.rows("articles").push({
      ...article("aEligible", "https://eligible.example.com/story", source("sEligible", true)),
      event_id: "eEligible",
      published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
    });
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eEligible",
      matched_at: new Date().toISOString(),
    });
    const pageFetch = vi.fn(async () => html(ARTICLE_HTML));
    vi.stubGlobal("fetch", pageFetch);

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    // The backoff rows are still reported as skipped — thirty of them — but
    // they no longer consume the tick's supply: the eligible article got its
    // slot despite being the oldest article in the arm.
    expect(report.skipped).toBe(30);
    const done = db.rows("article_evidence").find((r) => r["article_id"] === "aEligible");
    expect(done?.["status"]).toBe("enriched");
  });

  it("enriches the oldest eligible article first, not the newest", async () => {
    // Audit 32's ordering rule: among eligible candidates there is no
    // last-attempt variance to sort on, so article age is the starvation
    // signal. A brand-new arrival must not outrank an older story a reader is
    // still seeing and that has waited longer for evidence.
    const db = fixture();
    for (const [id, hoursAgo] of [
      ["aOld", 48],
      ["aMid", 12],
      ["aNew", 1],
    ] as const) {
      db.rows("articles").push({
        ...article(id, `https://${id}.example.com/story`, source(`s_${id}`, true)),
        event_id: `e_${id}`,
        published_at: new Date(Date.now() - hoursAgo * 3600e3).toISOString(),
      });
      db.rows("user_events").push({
        user_id: "u1",
        event_id: `e_${id}`,
        matched_at: new Date().toISOString(),
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    const done = db.rows("article_evidence").find((r) => r["status"] === "enriched");
    expect(done?.["article_id"]).toBe("aOld");
  });

  it("gives the tick one starved slot and two productive ones, never the whole tick", async () => {
    // Audit 33: the first post-deploy census measured the arm's oldest eligible
    // cohort (72-96h) yielding zero evidence units on every attempt while 192
    // extractable 24-48h candidates queued behind it — a whole tick spent on
    // proving old pages were old. Old work keeps a guaranteed share of every
    // tick, but never the whole tick: one starved slot, two productive ones.
    const db = fixture();
    for (const [id, hoursAgo] of [
      ["aStarved1", 96],
      ["aStarved2", 90],
      ["aProd1", 40],
      ["aProd2", 30],
      ["aProd3", 20],
    ] as const) {
      db.rows("articles").push({
        ...article(id, `https://${id}.example.com/story`, source(`s_${id}`, true)),
        event_id: `e_${id}`,
        published_at: new Date(Date.now() - hoursAgo * 3600e3).toISOString(),
      });
      db.rows("user_events").push({
        user_id: "u1",
        event_id: `e_${id}`,
        matched_at: new Date().toISOString(),
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db));

    expect(report.enriched).toBe(3);
    const worked = db
      .rows("article_evidence")
      .map((r) => String(r["article_id"]))
      .sort();
    // The starved band contributes its oldest one; the productive band its two
    // oldest. The second starved article waits for the next tick.
    expect(worked).toEqual(["aProd1", "aProd2", "aStarved1"]);
  });

  it("surrenders the starved slot to productive work once the old band runs dry", async () => {
    // A band that runs dry must not leave capacity idle: with no candidate over
    // the band boundary, the tick behaves exactly as strict oldest-first would.
    const db = fixture();
    for (const [id, hoursAgo] of [
      ["aYoung1", 10],
      ["aYoung2", 8],
      ["aYoung3", 6],
    ] as const) {
      db.rows("articles").push({
        ...article(id, `https://${id}.example.com/story`, source(`s_${id}`, true)),
        event_id: `e_${id}`,
        published_at: new Date(Date.now() - hoursAgo * 3600e3).toISOString(),
      });
      db.rows("user_events").push({
        user_id: "u1",
        event_id: `e_${id}`,
        matched_at: new Date().toISOString(),
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(ARTICLE_HTML)),
    );

    const report = await enrich(asDb(db));

    expect(report.enriched).toBe(3);
    const worked = db
      .rows("article_evidence")
      .map((r) => String(r["article_id"]))
      .sort();
    expect(worked).toEqual(["aYoung1", "aYoung2", "aYoung3"]);
  });

  it("probes one backed-off article only when a slot went spare, and a success reopens the source", async () => {
    // Audit 36: the failure backoff is a one-way latch -- `classify` excludes
    // sources at the threshold before any attempt, so the reset path in
    // `recordSourceOutcome` is unreachable for them. The arbiter's ruling: a
    // recovery probe may consume idle capacity, never compete for slots. Here
    // the tick has one normal candidate and a limit of two, so one slot went
    // spare; the parked source has a lifetime success (its recovery signal)
    // and its newest failure is three days old, past the cooldown. The probe
    // flows through `enrichOne`, so the success resets the counter and the
    // source re-enters the normal pool with no duplicate reset logic.
    const db = fixture();
    const probeSource = source("sProbe", true, 5);
    db.rows("sources").push(probeSource);
    db.rows("articles").push(
      article("aYoung", "https://young.example.com/story", source("sYoung", true)),
      {
        ...article("aProbe", "https://probe.example.com/story", probeSource),
        event_id: "eProbe",
      },
      {
        ...article("aHistoryOk", "https://probe.example.com/older-1", probeSource),
        event_id: "eProbe",
        published_at: new Date(Date.now() - 4 * 24 * 3600e3).toISOString(),
        // The fake does not perform embeds: seed the history read's answer.
        article_evidence: {
          status: "enriched",
          extracted_at: new Date(Date.now() - 3 * 24 * 3600e3).toISOString(),
        },
      },
      {
        ...article("aHistoryFail", "https://probe.example.com/older-2", probeSource),
        event_id: "eProbe",
        published_at: new Date(Date.now() - 4 * 24 * 3600e3).toISOString(),
        article_evidence: {
          status: "failed",
          extracted_at: new Date(Date.now() - 3 * 24 * 3600e3).toISOString(),
        },
      },
    );
    // Attempted articles have evidence rows in production, so the done-filter
    // keeps them out of the backoff tally; the probe read sees their outcome
    // through its own embed above.
    db.rows("article_evidence").push(
      {
        article_id: "aHistoryOk",
        status: "enriched",
        evidence: [],
        source_word_count: 120,
        attempts: 1,
        extracted_at: new Date(Date.now() - 3 * 24 * 3600e3).toISOString(),
      },
      {
        article_id: "aHistoryFail",
        status: "failed",
        evidence: [],
        source_word_count: 0,
        attempts: 1,
        extracted_at: new Date(Date.now() - 3 * 24 * 3600e3).toISOString(),
      },
    );
    db.rows("user_events").push(
      { user_id: "u1", event_id: "eYoung", matched_at: new Date().toISOString() },
      { user_id: "u1", event_id: "eProbe", matched_at: new Date().toISOString() },
    );
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        fetched.push(typeof input === "string" ? input : input.toString());
        return html(ARTICLE_HTML);
      }),
    );

    const report = await enrich(asDb(db), { limit: 2 });

    expect(report.enriched).toBe(2);
    // The probe takes the source's only unattempted article -- the history
    // rows are already finished and are the recovery signal, not the work.
    expect(fetched.some((u) => u.includes("probe.example.com/story"))).toBe(true);
    // The success resets the parked source through the existing path.
    const updated = db.rows("sources").find((r) => r["id"] === "sProbe");
    expect(updated?.["enrichment_failure_count"]).toBe(0);
  });

  it("never spends a normal slot on the probe", async () => {
    // The same fixture as the probe-fires test, but the limit is one and the
    // normal candidate needs it: recovery work may not displace productive
    // work, so the probe must not fire and the parked source stays parked.
    const db = fixture();
    const probeSource = source("sProbe", true, 5);
    db.rows("sources").push(probeSource);
    db.rows("articles").push(
      article("aYoung", "https://young.example.com/story", source("sYoung", true)),
      {
        ...article("aProbe", "https://probe.example.com/story", probeSource),
        event_id: "eProbe",
      },
      {
        ...article("aHistoryOk", "https://probe.example.com/older-1", probeSource),
        event_id: "eProbe",
        published_at: new Date(Date.now() - 4 * 24 * 3600e3).toISOString(),
        article_evidence: {
          status: "enriched",
          extracted_at: new Date(Date.now() - 3 * 24 * 3600e3).toISOString(),
        },
      },
    );
    db.rows("user_events").push(
      { user_id: "u1", event_id: "eYoung", matched_at: new Date().toISOString() },
      { user_id: "u1", event_id: "eProbe", matched_at: new Date().toISOString() },
    );
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        fetched.push(typeof input === "string" ? input : input.toString());
        return html(ARTICLE_HTML);
      }),
    );

    const report = await enrich(asDb(db), { limit: 1 });

    expect(report.enriched).toBe(1);
    expect(fetched.some((u) => u.includes("probe.example.com"))).toBe(false);
    expect(db.rows("sources").find((r) => r["id"] === "sProbe")?.["enrichment_failure_count"]).toBe(
      5,
    );
  });

  it("does not probe at all when normal selection fills the tick", async () => {
    // The census measured 40 of 40 recent ticks at full 3-slot selection: the
    // probe is dormant insurance while the pool is healthy. Four candidates
    // and a limit of three mean no slot went spare, so the ready-to-recover
    // parked source behind them must not be touched either.
    const db = fixture();
    const probeSource = source("sProbe", true, 5);
    db.rows("sources").push(probeSource);
    for (const [id, hoursAgo] of [
      ["aN1", 6],
      ["aN2", 8],
      ["aN3", 10],
      ["aN4", 12],
    ] as const) {
      db.rows("articles").push({
        ...article(id, `https://${id}.example.com/story`, source(`s_${id}`, true)),
        event_id: `e_${id}`,
        published_at: new Date(Date.now() - hoursAgo * 3600e3).toISOString(),
      });
      db.rows("user_events").push({
        user_id: "u1",
        event_id: `e_${id}`,
        matched_at: new Date().toISOString(),
      });
    }
    db.rows("articles").push({
      ...article("aProbe", "https://probe.example.com/story", probeSource),
      event_id: "eProbe",
      published_at: new Date(Date.now() - 10 * 3600e3).toISOString(),
    });
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eProbe",
      matched_at: new Date().toISOString(),
    });
    db.rows("articles").push({
      ...article("aHistory", "https://probe.example.com/older", probeSource),
      event_id: "eProbe",
      published_at: new Date(Date.now() - 4 * 24 * 3600e3).toISOString(),
      article_evidence: {
        status: "enriched",
        extracted_at: new Date(Date.now() - 3 * 24 * 3600e3).toISOString(),
      },
    });
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        fetched.push(typeof input === "string" ? input : input.toString());
        return html(ARTICLE_HTML);
      }),
    );

    const report = await enrich(asDb(db), { limit: 3 });

    expect(report.enriched).toBe(3);
    expect(fetched.some((u) => u.includes("probe.example.com"))).toBe(false);
  });

  it("never probes a source with no lifetime enrichment success", async () => {
    // The arbiter's gate: a source that has never enriched one article keeps
    // its park no matter how much capacity is idle -- a probe there is a
    // gamble the history has already lost (Tom's Hardware: 519 articles, zero
    // successes). With no spare-capacity-eligible source, nothing fetches.
    const db = fixture();
    const deadSource = source("sDead", true, 5);
    db.rows("sources").push(deadSource);
    db.rows("articles").push({
      ...article("aProbe", "https://dead.example.com/story", deadSource),
      event_id: "eProbe",
    });
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eProbe",
      matched_at: new Date().toISOString(),
    });
    const spy = vi.fn(async () => html(ARTICLE_HTML));
    vi.stubGlobal("fetch", spy);

    const report = await enrich(asDb(db), { limit: 3 });

    expect(spy).not.toHaveBeenCalled();
    expect(report.enriched).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it("waits out the cooldown before probing the same source again", async () => {
    // A failed probe must not be retried immediately: the source's newest
    // failed attempt (two hours ago) is inside the 24h cooldown, so the spare
    // slot stays idle. The cooldown is derived from the newest failed or
    // unavailable evidence row -- no schema column records it.
    const db = fixture();
    const probeSource = source("sProbe", true, 5);
    db.rows("sources").push(probeSource);
    db.rows("articles").push(
      {
        ...article("aProbe", "https://probe.example.com/story", probeSource),
        event_id: "eProbe",
      },
      {
        ...article("aHistoryOk", "https://probe.example.com/older-1", probeSource),
        event_id: "eProbe",
        published_at: new Date(Date.now() - 4 * 24 * 3600e3).toISOString(),
        article_evidence: {
          status: "enriched",
          extracted_at: new Date(Date.now() - 5 * 24 * 3600e3).toISOString(),
        },
      },
      {
        ...article("aHistoryFail", "https://probe.example.com/older-2", probeSource),
        event_id: "eProbe",
        published_at: new Date(Date.now() - 4 * 24 * 3600e3).toISOString(),
        article_evidence: {
          status: "failed",
          extracted_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
        },
      },
    );
    db.rows("article_evidence").push(
      {
        article_id: "aHistoryOk",
        status: "enriched",
        evidence: [],
        source_word_count: 120,
        attempts: 1,
        extracted_at: new Date(Date.now() - 5 * 24 * 3600e3).toISOString(),
      },
      {
        article_id: "aHistoryFail",
        status: "failed",
        evidence: [],
        source_word_count: 0,
        attempts: 1,
        extracted_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
      },
    );
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eProbe",
      matched_at: new Date().toISOString(),
    });
    const spy = vi.fn(async () => html(ARTICLE_HTML));
    vi.stubGlobal("fetch", spy);

    const report = await enrich(asDb(db), { limit: 3 });

    expect(spy).not.toHaveBeenCalled();
    expect(report.enriched).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it("keeps the tick alive when the probe's history read fails", async () => {
    // Recovery work never costs the tick: the probe read failing must leave a
    // quiet, empty report -- not an exception the cron has to absorb. The
    // probe's history read is the third `articles` select -- after the arm
    // read and the recency fallback -- so that is the one the hook refuses.
    const db = fixture();
    const probeSource = source("sProbe", true, 5);
    db.rows("sources").push(probeSource);
    db.rows("articles").push(
      {
        ...article("aProbe", "https://probe.example.com/story", probeSource),
        event_id: "eProbe",
      },
      {
        ...article("aHistoryOk", "https://probe.example.com/older", probeSource),
        event_id: "eProbe",
        published_at: new Date(Date.now() - 4 * 24 * 3600e3).toISOString(),
        article_evidence: {
          status: "enriched",
          extracted_at: new Date(Date.now() - 3 * 24 * 3600e3).toISOString(),
        },
      },
    );
    db.rows("article_evidence").push({
      article_id: "aHistoryOk",
      status: "enriched",
      evidence: [],
      source_word_count: 120,
      attempts: 1,
      extracted_at: new Date(Date.now() - 3 * 24 * 3600e3).toISOString(),
    });
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eProbe",
      matched_at: new Date().toISOString(),
    });
    let articleSelects = 0;
    db.hooks.failSelect = (table) => {
      if (table === "articles") {
        articleSelects += 1;
        return articleSelects === 3 ? "probe history read refused" : null;
      }
      return null;
    };
    const spy = vi.fn(async () => html(ARTICLE_HTML));
    vi.stubGlobal("fetch", spy);

    const report = await enrich(asDb(db), { limit: 3 });

    expect(report.enriched).toBe(0);
    expect(report.skipped).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not probe articles older than the productive band the scheduler trusts", async () => {
    // Audit 33 measured the starved band yielding zero evidence units on
    // every attempt; the probe holds itself to the same 72h floor rather than
    // spending recovery slots re-proving that old pages are old.
    const db = fixture();
    const probeSource = source("sProbe", true, 5);
    db.rows("sources").push(probeSource);
    db.rows("articles").push(
      {
        ...article("aProbe", "https://probe.example.com/story", probeSource),
        event_id: "eProbe",
        published_at: new Date(Date.now() - 96 * 3600e3).toISOString(),
      },
      {
        ...article("aHistoryOk", "https://probe.example.com/older", probeSource),
        event_id: "eProbe",
        published_at: new Date(Date.now() - 5 * 24 * 3600e3).toISOString(),
      },
    );
    db.rows("user_events").push({
      user_id: "u1",
      event_id: "eProbe",
      matched_at: new Date().toISOString(),
    });
    db.rows("article_evidence").push({
      article_id: "aHistoryOk",
      status: "enriched",
      evidence: [],
      source_word_count: 120,
      attempts: 1,
      extracted_at: new Date(Date.now() - 6 * 24 * 3600e3).toISOString(),
    });
    const spy = vi.fn(async () => html(ARTICLE_HTML));
    vi.stubGlobal("fetch", spy);

    const report = await enrich(asDb(db), { limit: 3 });

    expect(spy).not.toHaveBeenCalled();
    expect(report.enriched).toBe(0);
    expect(report.skipped).toBe(1);
  });
});
