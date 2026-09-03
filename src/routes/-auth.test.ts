import { describe, expect, it } from "vitest";
import { authErrorMessage } from "@/lib/auth-errors";

describe("authentication errors", () => {
  it("does not expose provider errors", () => {
    expect(authErrorMessage("unsupported provider", "github")).toBe(
      "GitHub authentication is not available.",
    );
  });

  it("makes an expired code actionable", () => {
    expect(authErrorMessage("otp_expired")).toBe("That code has expired. Request a new one.");
  });

  it("does not expose raw invalid-code errors", () => {
    expect(authErrorMessage("Token has been invalidated")).toBe(
      "That code isn't right. Try again.",
    );
  });

  it("uses a concise message for network failures", () => {
    expect(authErrorMessage("Failed to fetch")).toContain("Check your connection");
  });
});
