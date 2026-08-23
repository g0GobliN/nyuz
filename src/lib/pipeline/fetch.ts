/**
 * Fetching a feed over HTTP, with the failure modes named.
 *
 * Shared by the ingester and by `npm run check:feeds`, so that what the operator
 * tool reports and what the scheduled run experiences are the same thing. A
 * liveness checker that fetched differently from the ingester would be worse than
 * none: it would clear feeds that then keep failing, and condemn feeds that work.
 *
 * `fetch` is the only transport available on Workers, which is fine — this needs
 * nothing else. The parts that matter are the headers and the distinction between
 * a transient failure and a permanent one.
 */

/**
 * Identifying the fetcher is not politeness, it is self-interest. A request with
 * no user agent, or with a bare `node`, is refused outright by Cloudflare-fronted
 * publishers — several of the feeds in the 0006 seed sit behind exactly that. A
 * named agent gets served.
 */
export const USER_AGENT = "nyuz/1.0 (automated feed reader)";

/**
 * Content negotiation matters more than it looks. Ask only for the wildcard type
 * and some publishers answer an RSS URL with the HTML page, because that is what
 * a browser would want. Naming the feed types first gets XML.
 */
const ACCEPT =
  "application/rss+xml, application/atom+xml, application/feed+json;q=0.5, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1";

/** Fifteen seconds. A feed slower than that is a feed that stalls a whole run. */
export const FETCH_TIMEOUT_MS = 15_000;

/**
 * Two megabytes. Some "feeds" are the publisher's entire archive, and a run that
 * pulls thirty of those into a Worker's memory dies with no useful error.
 */
const MAX_BYTES = 2 * 1024 * 1024;

export type FeedFetch =
  | {
      ok: true;
      status: number;
      /** After redirects. Differs from the request URL more often than you would think. */
      finalUrl: string;
      contentType: string | null;
      body: string;
    }
  | {
      ok: false;
      /** null when the request never got a response at all. */
      status: number | null;
      reason: string;
      /**
       * Whether trying again later is worth anything.
       *
       * A 404 or a 410 is the publisher saying the feed is gone, and no amount of
       * patience changes it. A 429, a 503 or a timeout is a bad moment. The
       * ingester counts both against a source but only the permanent ones justify
       * an operator going and looking at the URL.
       */
      retryable: boolean;
    };

export async function fetchFeed(
  url: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<FeedFetch> {
  const timeout = options.timeoutMs ?? FETCH_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: ACCEPT },
      redirect: "follow",
      signal: options.signal ?? AbortSignal.timeout(timeout),
    });
  } catch (error) {
    // DNS failure, TLS failure, connection reset, timeout. All transient as far
    // as one run can tell — a domain that has genuinely gone will keep producing
    // this and the failure count will pass the threshold on its own.
    return {
      ok: false,
      status: null,
      reason: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: `HTTP ${response.status} ${response.statusText}`.trim(),
      // 408 and 429 are explicitly "later"; 5xx is the server's problem, not the
      // URL's. Everything else in 4xx is about this address being wrong.
      retryable:
        response.status === 408 ||
        response.status === 429 ||
        (response.status >= 500 && response.status < 600),
    };
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) {
    return {
      ok: false,
      status: response.status,
      reason: `Feed is ${Math.round(length / 1024)}KB, over the ${MAX_BYTES / 1024}KB limit`,
      retryable: false,
    };
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      reason: error instanceof Error ? error.message : "Could not read the response body",
      retryable: true,
    };
  }

  // Checked after reading as well: `content-length` is absent on chunked
  // responses, which is most of them.
  if (body.length > MAX_BYTES) {
    return {
      ok: false,
      status: response.status,
      reason: `Feed body is ${Math.round(body.length / 1024)}KB, over the ${MAX_BYTES / 1024}KB limit`,
      retryable: false,
    };
  }

  return {
    ok: true,
    status: response.status,
    finalUrl: response.url || url,
    contentType: response.headers.get("content-type"),
    body,
  };
}

/**
 * Runs `work` over `items`, `limit` at a time, preserving input order.
 *
 * Sixty-six feeds sequentially is sixty-six round trips of latency; sixty-six at
 * once is a burst that gets the fetcher rate-limited and, on Workers, runs into
 * the concurrent-subrequest ceiling. A small window is both faster and better
 * behaved.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await work(item, index);
    }
  });

  await Promise.all(workers);
  return results;
}
