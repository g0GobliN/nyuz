import { describe, expect, it } from "vitest";
import { authEntryUrl, safeAuthDestination } from "./auth-redirect";

describe("authentication redirects", () => {
  it("keeps an internal path, query and fragment", () => {
    expect(safeAuthDestination("/dashboard/story/one?from=briefing#sources")).toBe(
      "/dashboard/story/one?from=briefing#sources",
    );
  });

  it.each([
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "/\\attacker.example/steal",
    "dashboard",
    "/auth?next=/auth",
  ])("rejects unsafe or recursive destination %s", (destination) => {
    expect(safeAuthDestination(destination)).toBe("/dashboard");
  });

  it("encodes a safe return destination for the auth entry", () => {
    expect(authEntryUrl("/dashboard/settings?tab=email")).toBe(
      "/auth?next=%2Fdashboard%2Fsettings%3Ftab%3Demail",
    );
  });
});
