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
});
