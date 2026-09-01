import { describe, expect, it } from "vitest";
import { passwordRecoveryError } from "./auth";

describe("password recovery errors", () => {
  it("gives an actionable message for expired links", () => {
    expect(passwordRecoveryError("Auth session missing")).toContain("invalid or has expired");
  });

  it("does not encourage repeated requests while rate limited", () => {
    expect(passwordRecoveryError("email rate limit exceeded")).toContain("Wait a few minutes");
  });
});
