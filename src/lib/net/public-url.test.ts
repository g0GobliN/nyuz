import { describe, expect, it } from "vitest";
import { isPublicHttpUrl } from "@/lib/net/public-url";

describe("isPublicHttpUrl", () => {
  it("accepts a public https feed", () => {
    expect(isPublicHttpUrl("https://pytorch.org/blog/feed/")).toBe(true);
  });

  it("rejects loopback, private and link-local hosts", () => {
    for (const url of [
      "http://127.0.0.1/secret",
      "https://localhost/feed",
      "http://10.0.0.4/internal",
      "http://192.168.1.1/rss",
      "http://169.254.1.1/meta",
      "http://172.16.0.1/rss",
      "http://0.0.0.0/",
      "http://100.64.0.1/meta",
      "http://2130706433/",
      "http://[::1]/rss",
      "http://user:pass@example.com/rss",
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });

  it("rejects non-http schemes", () => {
    expect(isPublicHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isPublicHttpUrl("file:///etc/passwd")).toBe(false);
  });
});
