import { describe, expect, it } from "vitest";
import { humanError } from "@/lib/errors";

/**
 * The bug these lock down: a reader who pasted a bad feed address was shown
 * the ZodError's `.message`, which is the issue array JSON-encoded —
 * `[ { "code": "custom", "message": "...", "path": [ "feedUrl" ] } ]`.
 *
 * The sentence somebody wrote deliberately was in there, wrapped in enough
 * punctuation to make the product look broken.
 */
describe("humanError", () => {
  const zodJson = JSON.stringify([
    { code: "custom", message: "Must be a public http or https URL.", path: ["feedUrl"] },
  ]);

  it("unwraps a serialised zod error into the sentence inside it", () => {
    const out = humanError(new Error(zodJson));
    expect(out).not.toContain("{");
    expect(out).not.toContain("path");
    expect(out).toContain("Must be a public http or https URL");
  });

  it("names the field in words a reader would recognise", () => {
    // "feedUrl" means nothing to somebody who has never seen the schema.
    expect(humanError(new Error(zodJson))).toContain("feed address");
  });

  it("reports every failed rule rather than only the first", () => {
    const two = JSON.stringify([
      { code: "custom", message: "Must be a public http or https URL.", path: ["feedUrl"] },
      { code: "too_big", message: "That address is too long.", path: ["feedUrl"] },
    ]);
    const out = humanError(new Error(two));
    expect(out).toContain("public http");
    expect(out).toContain("too long");
  });

  it("replaces zod's developer wording with something actionable", () => {
    const generic = JSON.stringify([
      { code: "invalid_type", message: "Required", path: ["email"] },
    ]);
    expect(humanError(new Error(generic))).toBe("Check the email address.");
  });

  it("passes a plain message through, punctuated", () => {
    expect(humanError(new Error("You have asked a lot today"))).toBe("You have asked a lot today.");
    expect(humanError(new Error("Wait a moment before asking again."))).toBe(
      "Wait a moment before asking again.",
    );
  });

  it("hides machinery behind the fallback", () => {
    // A stack frame or a connection string in front of a customer is worse
    // than a generic sentence.
    expect(humanError(new Error("TypeError: x is not a function"), "Could not save.")).toBe(
      "Could not save.",
    );
    expect(humanError(new Error("fetch failed"), "Could not save.")).toBe("Could not save.");
  });

  it("falls back for JSON that is not a zod error", () => {
    expect(humanError(new Error('{"trace":"deep"}'), "Could not save.")).toBe("Could not save.");
  });

  it("falls back for an empty or non-error throw", () => {
    expect(humanError(new Error(""), "Could not add that feed.")).toBe("Could not add that feed.");
    expect(humanError(undefined, "Could not add that feed.")).toBe("Could not add that feed.");
    expect(humanError({ weird: true }, "Could not add that feed.")).toBe(
      "Could not add that feed.",
    );
  });

  it("accepts a bare string, which is what some callers throw", () => {
    expect(humanError("That is not a usable feed address.")).toBe(
      "That is not a usable feed address.",
    );
  });
});
