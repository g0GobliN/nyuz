import { describe, expect, it } from "vitest";
import { subInputSchema, deleteInputSchema } from "./account";

describe("push/account savePushSubscription schema", () => {
  it("accepts a valid public https endpoint", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "https://push.example.com/endpoint",
      keys: { p256dh: "key1", auth: "key2" },
      label: "My Device",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid public http endpoint", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "http://push.example.com/endpoint",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects javascript: scheme", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "javascript:alert(1)",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues[0]!.message).toBe("Must be an absolute http or https URL.");
    }
  });

  it("rejects file: scheme", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "file:///etc/passwd",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects data: scheme", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "data:text/html,<script>alert(1)</script>",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects mailto: scheme", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "mailto:test@example.com",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects ftp: scheme", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "ftp://example.com/file",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects ws: and wss: schemes", () => {
    for (const scheme of ["ws:", "wss:"]) {
      const result = subInputSchema.safeParse({
        installId: "123e4567-e89b-12d3-a456-426614174000",
        endpoint: `${scheme}//example.com/socket`,
        keys: { p256dh: "key1", auth: "key2" },
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects loopback address", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "http://127.0.0.1/endpoint",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects localhost hostname", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "https://localhost/endpoint",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects private RFC1918 addresses", () => {
    for (const host of ["10.0.0.1", "192.168.1.1", "172.16.0.1"]) {
      const result = subInputSchema.safeParse({
        installId: "123e4567-e89b-12d3-a456-426614174000",
        endpoint: `http://${host}/endpoint`,
        keys: { p256dh: "key1", auth: "key2" },
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects link-local 169.254.x.x", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "http://169.254.169.254/latest/meta-data/",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects CGNAT 100.64.x.x", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "http://100.64.0.1/endpoint",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects IPv6 loopback ::1", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "http://[::1]/endpoint",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects URLs with userinfo", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "https://user:pass@example.com/endpoint",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "//example.com/endpoint",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects bare hostnames", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "example.com/endpoint",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects endpoint exceeding 2048 chars", () => {
    const longUrl = "https://example.com/" + "a".repeat(2040);
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: longUrl,
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from endpoint", () => {
    const result = subInputSchema.safeParse({
      installId: "123e4567-e89b-12d3-a456-426614174000",
      endpoint: "  https://push.example.com/endpoint  ",
      keys: { p256dh: "key1", auth: "key2" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.endpoint).toBe("https://push.example.com/endpoint");
    }
  });
});

describe("push/account deletePushSubscription schema", () => {
  it("accepts a valid public https endpoint", () => {
    const result = deleteInputSchema.safeParse({
      endpoint: "https://push.example.com/endpoint",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid public http endpoint", () => {
    const result = deleteInputSchema.safeParse({
      endpoint: "http://push.example.com/endpoint",
    });
    expect(result.success).toBe(true);
  });

  it("rejects javascript: scheme", () => {
    const result = deleteInputSchema.safeParse({
      endpoint: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues[0]!.message).toBe("Must be an absolute http or https URL.");
    }
  });

  it("rejects file: scheme", () => {
    const result = deleteInputSchema.safeParse({
      endpoint: "file:///etc/passwd",
    });
    expect(result.success).toBe(false);
  });

  it("rejects data: scheme", () => {
    const result = deleteInputSchema.safeParse({
      endpoint: "data:text/html,<script>alert(1)</script>",
    });
    expect(result.success).toBe(false);
  });

  it("rejects loopback address", () => {
    const result = deleteInputSchema.safeParse({
      endpoint: "http://127.0.0.1/endpoint",
    });
    expect(result.success).toBe(false);
  });

  it("rejects private RFC1918 addresses", () => {
    for (const host of ["10.0.0.1", "192.168.1.1", "172.16.0.1"]) {
      const result = deleteInputSchema.safeParse({
        endpoint: `http://${host}/endpoint`,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects link-local 169.254.x.x", () => {
    const result = deleteInputSchema.safeParse({
      endpoint: "http://169.254.169.254/latest/meta-data/",
    });
    expect(result.success).toBe(false);
  });

  it("rejects endpoint exceeding 2048 chars", () => {
    const longUrl = "https://example.com/" + "a".repeat(2040);
    const result = deleteInputSchema.safeParse({
      endpoint: longUrl,
    });
    expect(result.success).toBe(false);
  });
});
