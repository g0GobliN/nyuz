import { isPublicHttpUrl } from "@/lib/net/public-url";

/**
 * Fetching one article's own public page, for enrichment only.
 *
 * Deliberately a separate function from `fetchFeed` rather than a shared
 * parameterisation of it: `fetchFeed` runs on every scheduled ingest tick and
 * is load-bearing for the whole pipeline, so this stays independent to keep
 * that path's blast radius at zero. The defensive shape is the same on
 * purpose -- SSRF blocking, redirect re-validation per hop, a size cap, a
 * timeout, a named user agent -- because that shape is already audited
 * (`fetch.ts`, reused again for custom sources in 0030) and a second
 * implementation of it would be a second thing to get wrong.
 *
 * This targets only URLs the pipeline already collected from a configured
 * source's own feed. It never discovers a URL by crawling, never sends
 * cookies or credentials, never executes JavaScript, and never retries past a
 * source's own robots.txt or a paywall -- see `robots.ts` for the permission
 * check that runs before this.
 */

const ARTICLE_USER_AGENT = "nyuz/1.0 (+https://nyuz.app/legal/contact; automated evidence reader)";
export const ARTICLE_FETCH_TIMEOUT_MS = 10_000;
/** 1.5MB. An article page, not a publisher's SPA bundle or an archive dump. */
const MAX_ARTICLE_BYTES = 1.5 * 1024 * 1024;
/**
 * Two hops, not `fetchFeed`'s five: this stage's whole per-run subrequest
 * budget is proven safe against this constant (see `enrich.ts`'s worst-case
 * accounting), and a page needing more than two redirects to resolve is
 * unusual enough that failing it is the safer default.
 */
const MAX_REDIRECTS = 2;

/** Coarse reason a fetch failed, for per-run observability -- see `describeEnrich`. */
export type FetchFailureKind =
  | "unsafe_url"
  | "too_many_redirects"
  | "redirect_unsafe"
  | "http_error"
  | "not_html"
  | "too_large"
  | "timeout"
  | "network_error"
  | "read_error";

export type ArticlePageFetch =
  | { ok: true; status: number; finalUrl: string; html: string }
  | {
      ok: false;
      status: number | null;
      reason: string;
      retryable: boolean;
      kind: FetchFailureKind;
    };

function isTimeout(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

export async function fetchArticlePage(
  url: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ArticlePageFetch> {
  const timeout = options.timeoutMs ?? ARTICLE_FETCH_TIMEOUT_MS;
  const signal = options.signal ?? AbortSignal.timeout(timeout);

  if (!isPublicHttpUrl(url)) {
    return {
      ok: false,
      status: null,
      reason: "URL is not a public http(s) address",
      retryable: false,
      kind: "unsafe_url",
    };
  }

  let current = url;
  let response: Response;
  try {
    for (let hop = 0; ; hop++) {
      response = await fetch(current, {
        headers: { "user-agent": ARTICLE_USER_AGENT, accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location || hop >= MAX_REDIRECTS) {
        return {
          ok: false,
          status: response.status,
          reason: "Redirected too many times",
          retryable: false,
          kind: "too_many_redirects",
        };
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return {
          ok: false,
          status: response.status,
          reason: "Redirected to an unusable URL",
          retryable: false,
          kind: "redirect_unsafe",
        };
      }
      if (!isPublicHttpUrl(next.href)) {
        return {
          ok: false,
          status: response.status,
          reason: "Redirected to a non-public address",
          retryable: false,
          kind: "redirect_unsafe",
        };
      }
      current = next.href;
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      reason: error instanceof Error ? error.message : String(error),
      retryable: true,
      kind: isTimeout(error) ? "timeout" : "network_error",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: `HTTP ${response.status} ${response.statusText}`.trim(),
      retryable:
        response.status === 408 ||
        response.status === 429 ||
        (response.status >= 500 && response.status < 600),
      kind: "http_error",
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    return {
      ok: false,
      status: response.status,
      reason: `Not HTML (${contentType || "unknown"})`,
      retryable: false,
      kind: "not_html",
    };
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_ARTICLE_BYTES) {
    return {
      ok: false,
      status: response.status,
      reason: `Page is ${Math.round(length / 1024)}KB, over the ${Math.round(MAX_ARTICLE_BYTES / 1024)}KB limit`,
      retryable: false,
      kind: "too_large",
    };
  }

  let html: string;
  try {
    html = await response.text();
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      reason: error instanceof Error ? error.message : "Could not read the response body",
      retryable: true,
      kind: "read_error",
    };
  }
  if (html.length > MAX_ARTICLE_BYTES) {
    return {
      ok: false,
      status: response.status,
      reason: `Page body is ${Math.round(html.length / 1024)}KB, over the ${Math.round(MAX_ARTICLE_BYTES / 1024)}KB limit`,
      retryable: false,
      kind: "too_large",
    };
  }

  return { ok: true, status: response.status, finalUrl: response.url || current, html };
}
