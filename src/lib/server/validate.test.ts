import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseInput } from "@/lib/server/validate";

/**
 * `parseInput` throws the first issue message that a person wrote. Zod v4
 * changed every message a schema emits when nobody wrote one — v3's "Required"
 * became "Invalid input: expected string, received undefined" — so the guard
 * against developer wording has to recognise the new phrasing, or readers get a
 * stack-trace fragment in the place the migration is supposed to keep clean.
 */

describe("parseInput", () => {
  it("returns the parsed value when the input is valid", () => {
    const schema = z.object({ count: z.number().int() });
    expect(parseInput(schema, { count: 3 })).toEqual({ count: 3 });
  });

  it("throws the message somebody wrote on purpose", () => {
    const schema = z.object({
      feedUrl: z.string().refine((v) => v.startsWith("https://"), {
        message: "Must be a public http or https URL.",
      }),
    });
    expect(() => parseInput(schema, { feedUrl: "ftp://nope" })).toThrow(
      "Must be a public http or https URL.",
    );
  });

  it("does not throw zod v4's wording for a missing field", () => {
    // The measured string: "Invalid input: expected string, received undefined".
    const schema = z.object({ feedUrl: z.string() });
    expect(() => parseInput(schema, {})).toThrow("Those details are not valid.");
  });

  it("does not throw zod v4's wording for a mistyped field", () => {
    const schema = z.object({ count: z.number() });
    expect(() => parseInput(schema, { count: "three" })).toThrow("Those details are not valid.");
  });

  it("does not throw zod v4's constraint wording", () => {
    // "Too big: expected string to have <=8 characters" — machinery too.
    const schema = z.object({ name: z.string().max(8) });
    expect(() => parseInput(schema, { name: "a very long name" })).toThrow(
      "Those details are not valid.",
    );
  });

  it("prefers a written message over the developer wording beside it", () => {
    // Two rules fail: one typed wrong, one refused deliberately. A reader can
    // act on the second; the first is noise.
    const schema = z.object({
      count: z.number().refine((v) => v < 10, { message: "Ten at most, please." }),
    });
    expect(() => parseInput(schema, { count: 50 })).toThrow("Ten at most, please.");
  });
});
