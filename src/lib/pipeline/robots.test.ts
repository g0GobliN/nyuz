import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRobotsPermission } from "./robots";

afterEach(() => vi.unstubAllGlobals());

const robots = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain" } });

describe("checkRobotsPermission", () => {
  it("allows a path when robots.txt has no matching disallow", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => robots("User-agent: *\nDisallow: /admin\n")),
    );
    const result = await checkRobotsPermission("https://example.com", "/story/1");
    expect(result).toEqual({ decision: "allowed", definitive: true });
  });

  it("blocks a path disallowed for the wildcard agent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => robots("User-agent: *\nDisallow: /\n")),
    );
    const result = await checkRobotsPermission("https://example.com", "/story/1");
    expect(result).toEqual({ decision: "blocked", definitive: true });
  });

  it("prefers a group matching our own agent token over the wildcard group", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        robots("User-agent: *\nDisallow: /\n\nUser-agent: nyuz\nAllow: /\nDisallow: /paywalled\n"),
      ),
    );
    const open = await checkRobotsPermission("https://example.com", "/story/1");
    expect(open).toEqual({ decision: "allowed", definitive: true });

    const closed = await checkRobotsPermission("https://example.com", "/paywalled/story");
    expect(closed).toEqual({ decision: "blocked", definitive: true });
  });

  it("lets a longer, more specific Allow override a shorter Disallow", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => robots("User-agent: *\nDisallow: /news\nAllow: /news/public\n")),
    );
    const result = await checkRobotsPermission("https://example.com", "/news/public/story");
    expect(result).toEqual({ decision: "allowed", definitive: true });
  });

  it("treats a missing robots.txt (404) as unrestricted, per the standard convention", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => robots("not found", 404)),
    );
    const result = await checkRobotsPermission("https://example.com", "/story/1");
    expect(result).toEqual({ decision: "allowed", definitive: true });
  });

  it("does not cache a decision when the fetch fails ambiguously", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );
    const result = await checkRobotsPermission("https://example.com", "/story/1");
    expect(result).toEqual({ decision: "unknown", definitive: false });
  });

  it("does not cache a decision on a server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => robots("", 503)),
    );
    const result = await checkRobotsPermission("https://example.com", "/story/1");
    expect(result).toEqual({ decision: "unknown", definitive: false });
  });

  it("blocks a private-address origin before fetching (SSRF)", async () => {
    const spy = vi.fn(async () => robots("User-agent: *\n"));
    vi.stubGlobal("fetch", spy);
    const result = await checkRobotsPermission("http://127.0.0.1", "/x");
    expect(result).toEqual({ decision: "unknown", definitive: false });
    expect(spy).not.toHaveBeenCalled();
  });
});
