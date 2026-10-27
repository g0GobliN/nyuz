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

  /**
   * Zod v4 renamed every message a schema emits when nobody wrote one. These
   * are the strings measured on zod 4.6.7; the v3 forms above are kept because
   * an error serialised by an older bundle can still arrive here.
   */
  describe("zod v4's own wording", () => {
    const cases: Array<[string, string[], string]> = [
      ["Invalid input: expected string, received undefined", ["email"], "Check the email address."],
      ["Invalid input: expected number, received string", ["count"], "Check the number."],
      ['Invalid option: expected one of "on"|"off"', ["email"], "Check the email address."],
      ["Too big: expected string to have <=2048 characters", ["url"], "Check the address."],
      ["Invalid URL", ["url"], "Check the address."],
      ["Invalid email address", ["email"], "Check the email address."],
      ["Invalid input", ["unknownField"], "Some of those details are not valid."],
    ];

    for (const [message, path, expected] of cases) {
      it(`hides ${JSON.stringify(message)}`, () => {
        const json = JSON.stringify([{ code: "invalid_type", message, path }]);
        expect(humanError(new Error(json))).toBe(expected);
      });
    }

    it("still shows a message a person wrote, even beside one of its own", () => {
      const json = JSON.stringify([
        {
          code: "invalid_type",
          message: "Invalid input: expected string, received undefined",
          path: ["email"],
        },
        { code: "custom", message: "That inbox bounced last week.", path: ["email"] },
      ]);
      const out = humanError(new Error(json));
      expect(out).toContain("That inbox bounced last week");
      expect(out).not.toContain("Invalid input");
    });
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

  /**
   * The second bug: a killed worker is answered by the edge, its JSON body
   * arrives as the thrown message, and the `{` rule hid it. The reader then
   * could not tell a platform blip from their own data being wrong.
   */
  describe("a failure the platform reported", () => {
    const modern = JSON.stringify({
      cloudflare_error: true,
      error_name: "worker_exceeded_limits",
      title: "Worker exceeded resource limits",
      status: 503,
      ray_id: "a41ec4a4fdbf7d2d-NRT",
    });
    const legacy = JSON.stringify({
      result: null,
      success: false,
      errors: [{ code: 1102, message: "Worker exceeded resource limits" }],
      messages: [],
    });
    const html = `<!DOCTYPE html><html><head><title>nyuz | 1102: Worker exceeded resource limits</title></head><body><h1>Error 1102</h1><p>Worker exceeded resource limits</p><p>Ray ID: a41f2670bcd0af54</p><p>Cloudflare</p></body></html>`;

    it("names it instead of falling back", () => {
      for (const body of [modern, legacy, html]) {
        const out = humanError(new Error(body), "The request did not complete.");
        expect(out).not.toBe("The request did not complete.");
        expect(out).toContain("interrupted");
      }
    });

    it("does not describe an ordinary payload as a platform failure", () => {
      // The narrowness is the point: naming a random object would be a lie in
      // the one sentence a reader is meant to trust.
      expect(humanError(new Error('{"success":false}'), "Could not save.")).toBe("Could not save.");
      expect(humanError(new Error('{"errors":["nope"]}'), "Could not save.")).toBe(
        "Could not save.",
      );
      expect(
        humanError(
          new Error("<html><title>Cloudflare outage</title><p>Service unavailable</p></html>"),
          "Could not save.",
        ),
      ).toBe("Could not save.");
    });
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
