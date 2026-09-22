import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SW_CACHE,
  SW_NEVER_CACHE,
  SW_OFFLINE_HTML,
  SW_PRECACHE,
  SW_SKIP_WAITING,
  SW_URL,
} from "@/lib/sw-config";

/**
 * The worker is copied to the deploy verbatim, so it cannot import the constants
 * it shares with the app — they exist twice, and this file is what keeps the two
 * copies equal. It reads the worker as text, in the spirit of
 * `src/lib/security-invariants.test.ts`, because the failures worth catching here
 * are the ones no runtime test would notice until a real device was offline or
 * mid-deploy.
 */

/**
 * The worker's code, with its comments removed.
 *
 * The comments here are unusually load-bearing — the header explains why install
 * must not skip waiting, in those words — so an assertion that read them would
 * fail on the explanation of the rule rather than on a breach of it.
 */
const sw = readFileSync("public/sw.js", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** The body of one event listener, so assertions can be scoped to it. */
function listenerBlock(event: string): string {
  const start = sw.indexOf(`addEventListener("${event}"`);
  if (start < 0) return "";
  const end = sw.indexOf("addEventListener(", start + 10);
  return sw.slice(start, end < 0 ? undefined : end);
}

describe("the worker agrees with its constants", () => {
  it("uses the same cache generation", () => {
    expect(sw).toContain(`const CACHE = "${SW_CACHE}"`);
  });

  it("serves from the same url the app registers", () => {
    // The file has to exist where it is registered, and it has to be at the root
    // for the scope the app asks for.
    expect(SW_URL).toBe("/sw.js");
    expect(sw).toContain(`const SKIP_WAITING = "${SW_SKIP_WAITING}"`);
  });

  it("precaches every file the config promises", () => {
    // A precache list that has drifted is an install that never caches the icon
    // an installed app is launched for.
    for (const url of SW_PRECACHE) expect(sw).toContain(`"${url}"`);
  });

  it("knows the same offline document", () => {
    // Compared on the parts that carry meaning rather than byte-for-byte: the
    // copy could be rewritten here without the offline page changing what it
    // says.
    const heading = SW_OFFLINE_HTML.match(/<h1>(.*?)<\/h1>/)?.[1];
    expect(heading).toBeTruthy();
    expect(sw).toContain(heading as string);
    expect(sw).toContain('lang="en"');
    expect(sw).toContain("location.reload()");
  });
});

describe("per-account responses are never stored", () => {
  it("lists the same prefixes", () => {
    for (const path of SW_NEVER_CACHE) expect(sw).toContain(`"${path}"`);
  });

  it("checks the denylist before it touches a cache or the network", () => {
    const fetchBlock = listenerBlock("fetch");
    expect(fetchBlock).toContain("NEVER_CACHE.some");
    // The guard has to come before either strategy is chosen, or a
    // server-function response could be cached by the document path.
    expect(fetchBlock.indexOf("NEVER_CACHE.some")).toBeLessThan(
      fetchBlock.indexOf("networkFirstDocument"),
    );
    expect(fetchBlock.indexOf("NEVER_CACHE.some")).toBeLessThan(
      fetchBlock.indexOf("staleWhileRevalidate"),
    );
  });

  it("leaves non-GET requests alone entirely", () => {
    // `loadStory` is a POST. Nothing in this worker may try to store one.
    const fetchBlock = listenerBlock("fetch");
    expect(fetchBlock).toMatch(/request\.method !== "GET"/);
  });

  it("never claims to cache a cache-first response without checking it exists", () => {
    // staleWhileRevalidate's cache-first branch must fall through to the network
    // when the cache misses; a bare `return cache.match(...)` would resolve the
    // response promise with undefined.
    expect(sw).toMatch(/if \(cached\) return cached;/);
  });
});

describe("an update waits for the reader", () => {
  it("does not activate itself on install", () => {
    // The bug this whole arrangement exists to avoid: skipWaiting in install
    // swaps the asset set under a running app and can leave a lazily imported
    // chunk missing. Activated only on a SKIP_WAITING message, or on the next
    // cold start once the last old window has closed.
    expect(listenerBlock("install")).not.toContain("skipWaiting");
    expect(listenerBlock("message")).toContain("skipWaiting");
  });

  it("only skips waiting for its own message", () => {
    expect(listenerBlock("message")).toContain(SW_SKIP_WAITING);
  });

  it("prunes caches from other generations and keeps its own", () => {
    const activate = listenerBlock("activate");
    expect(activate).toContain("caches.keys()");
    expect(activate).toContain("startsWith(CACHE)");
    expect(activate).toContain("caches.delete");
  });
});

describe("what the worker handles", () => {
  it("serves documents network-first and assets cache-first", () => {
    const fetchBlock = listenerBlock("fetch");
    expect(fetchBlock).toMatch(/request\.mode === "navigate"/);
    expect(fetchBlock).toContain("networkFirstDocument(request)");
    expect(fetchBlock).toContain("isStaticAsset(url.pathname)");
    expect(fetchBlock).toContain("staleWhileRevalidate(request)");
  });

  it("leaves push alone", () => {
    // The notification path is older than all of this and is not being changed
    // by it: an alert that opens the right story is the feature the worker was
    // written for in the first place.
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).toContain("showNotification");
  });
});
