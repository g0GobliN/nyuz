import { z } from "zod";

/**
 * Runs a schema and throws something a person can read.
 *
 * `schema.parse(input)` throws a `ZodError` whose `.message` is the issue array
 * JSON-encoded, and that string is what reaches the browser — so a reader who
 * typed a bad feed address was shown a fragment of our schema. This throws a
 * plain `Error` carrying the first real message instead.
 *
 * Use it in place of `.parse()` in every `.validator()`:
 *
 *     .validator((input: unknown) => parseInput(z.object({ feedUrl }), input))
 *
 * `humanError` in `src/lib/errors.ts` unwraps the JSON form as well, so a call
 * site that has not been converted still displays correctly. Both exist because
 * neither alone is sufficient: this one cannot help an error thrown by a
 * validator somebody writes later, and that one cannot help a message that was
 * never customer-facing to begin with.
 */
export function parseInput<T>(schema: z.ZodType<T, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const issue = result.error.issues.find((i) => i.message.trim() !== "");
  // Falls back to a generic line rather than to zod's own wording: "Required"
  // and "Expected string, received number" are written for whoever wrote the
  // schema, not for whoever filled in the form.
  throw new Error(issue ? issue.message : "Those details are not valid.");
}
