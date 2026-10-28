import { describe, expect, it } from "vitest";
import { saveInputSchema } from "./blog";

describe("blog saveInput schema - coverUrl validation", () => {
  it("accepts a valid https cover URL", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "https://example.com/image.png",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid http cover URL", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "http://example.com/image.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null coverUrl", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts undefined coverUrl (optional)", () => {
    const result = saveInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects javascript: scheme", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues[0]!.message).toBe("Must be an absolute http or https URL.");
    }
  });

  it("rejects file: scheme", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "file:///etc/passwd",
    });
    expect(result.success).toBe(false);
  });

  it("rejects data: scheme", () => {
    const result = saveInputSchema.safeParse({
      coverUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    });
    expect(result.success).toBe(false);
  });

  it("rejects mailto: scheme", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "mailto:test@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects ftp: scheme", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "ftp://example.com/image.png",
    });
    expect(result.success).toBe(false);
  });

  it("rejects ws: and wss: schemes", () => {
    for (const scheme of ["ws:", "wss:"]) {
      const result = saveInputSchema.safeParse({
        coverUrl: `${scheme}//example.com/socket`,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects protocol-relative URLs", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "//example.com/image.png",
    });
    expect(result.success).toBe(false);
  });

  it("rejects bare hostnames", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "example.com/image.png",
    });
    expect(result.success).toBe(false);
  });

  it("rejects coverUrl exceeding 2000 chars", () => {
    const longUrl = "https://example.com/" + "a".repeat(1990);
    const result = saveInputSchema.safeParse({
      coverUrl: longUrl,
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from coverUrl", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "  https://example.com/image.png  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.coverUrl).toBe("https://example.com/image.png");
    }
  });

  it("accepts coverUrl with query parameters and fragments", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "https://example.com/image.png?width=800&height=600#main",
    });
    expect(result.success).toBe(true);
  });

  it("accepts coverUrl with port numbers", () => {
    const result = saveInputSchema.safeParse({
      coverUrl: "https://example.com:8443/image.png",
    });
    expect(result.success).toBe(true);
  });

  it("accepts coverUrl with IP address (no private IP blocking for images)", () => {
    // Images can be hosted on any public IP, including private ranges if user wants
    for (const host of ["1.2.3.4", "8.8.8.8", "151.101.1.140"]) {
      const result = saveInputSchema.safeParse({
        coverUrl: `https://${host}/image.png`,
      });
      expect(result.success).toBe(true);
    }
  });
});
