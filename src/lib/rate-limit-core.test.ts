import { describe, expect, it } from "vitest";
import { shouldCountView } from "@/lib/rate-limit-core";

describe("shouldCountView", () => {
  it("counts a visitor's first read of a post and then stops", () => {
    // The bug this pins: increment_post_view is anon-callable by design and had
    // no ceiling, so a loop could add arbitrarily many views to any post.
    expect(shouldCountView("203.0.113.1", "first-post")).toBe(true);
    for (let i = 0; i < 50; i += 1) {
      expect(shouldCountView("203.0.113.1", "first-post")).toBe(false);
    }
  });

  it("keeps separate posts on separate counters", () => {
    expect(shouldCountView("203.0.113.2", "post-a")).toBe(true);
    expect(shouldCountView("203.0.113.2", "post-b")).toBe(true);
    expect(shouldCountView("203.0.113.2", "post-a")).toBe(false);
  });

  it("keeps separate visitors on separate counters", () => {
    expect(shouldCountView("203.0.113.3", "shared-post")).toBe(true);
    expect(shouldCountView("203.0.113.4", "shared-post")).toBe(true);
  });

  it("does not collapse every unidentified visitor onto one post's counter", () => {
    // "unknown" is the fallback when no forwarding header is present. It is one
    // bucket by necessity, but it must still be per-post.
    expect(shouldCountView("unknown", "post-c")).toBe(true);
    expect(shouldCountView("unknown", "post-d")).toBe(true);
  });
});
