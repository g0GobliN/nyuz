import { describe, expect, it } from "vitest";
import { isPublicHttpUrl } from "@/lib/net/public-url";

describe("isPublicHttpUrl", () => {
  it("accepts a public https feed", () => {
    expect(isPublicHttpUrl("https://pytorch.org/blog/feed/")).toBe(true);
  });

  it("accepts a public http feed", () => {
    expect(isPublicHttpUrl("http://example.com/feed.xml")).toBe(true);
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

  it("rejects IPv4 addresses dressed as IPv6, in the hex form WHATWG rewrites them to", () => {
    // `new URL()` normalises a dotted mapped tail to hex before the predicate
    // sees the host — `[::ffff:127.0.0.1]` arrives as `::ffff:7f00:1` — so a
    // dotted-tail test alone allowed every mapped address. These four were
    // measured 4/4 ALLOWED before the octets were read back.
    for (const url of [
      "http://[::ffff:127.0.0.1]/secret",
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[::ffff:c0a8:101]/rss",
      "http://[::ffff:10.0.0.5]/internal",
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
    // The same address in its dotted form, and a mapped public address, still read true.
    expect(isPublicHttpUrl("http://[::ffff:8.8.8.8]/feed")).toBe(true);
  });

  it("rejects non-http schemes", () => {
    expect(isPublicHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isPublicHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isPublicHttpUrl("mailto:test@example.com")).toBe(false);
    expect(isPublicHttpUrl("ftp://example.com/file")).toBe(false);
    expect(isPublicHttpUrl("ws://example.com/socket")).toBe(false);
    expect(isPublicHttpUrl("wss://example.com/socket")).toBe(false);
  });

  it("rejects protocol-relative and bare hostnames", () => {
    expect(isPublicHttpUrl("//example.com/feed")).toBe(false);
    expect(isPublicHttpUrl("example.com/feed")).toBe(false);
  });

  it("rejects URLs with userinfo", () => {
    expect(isPublicHttpUrl("https://user:pass@example.com/feed")).toBe(false);
    expect(isPublicHttpUrl("http://user@example.com/feed")).toBe(false);
  });
});
