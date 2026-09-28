/**
 * Turning whatever an error turns out to be into a sentence a customer can read.
 *
 * ---------------------------------------------------------------------------
 * The bug this exists for
 * ---------------------------------------------------------------------------
 *
 * Server functions validate with zod, and a failed `schema.parse()` throws a
 * `ZodError` whose `.message` is **the issue array, JSON-encoded**. That string
 * crosses the wire and lands in whatever `catch` block the page has, so a reader
 * who pasted a bad feed address was shown:
 *
 *     [ { "code": "custom", "message": "Must be a public http or https URL.",
 *         "path": [ "feedUrl" ] } ]
 *
 * The useful sentence is in there, wrapped in punctuation that makes the product
 * look broken. There are 47 validator call sites, so fixing this at each one
 * would be 47 chances to miss one — and the next one added would be wrong again.
 * This unwraps it at the point of display instead, which covers every site
 * including the ones nobody has written yet.
 *
 * `parseInput` in `src/lib/server/validate.ts` is the other half: it stops the
 * JSON being produced in the first place. This function is the safety net for
 * anything that still throws one.
 *
 * ---------------------------------------------------------------------------
 * The second bug, and why a platform failure gets its own sentence
 * ---------------------------------------------------------------------------
 *
 * A request the application never answers is not an application error. When a
 * worker is killed mid-request — over its CPU limit, or simply not running yet
 * while a new version deploys — the edge answers instead, with its own JSON
 * error body. That body arrives here as the thrown message, starts with `{`,
 * and the machinery rule below turned it into the same generic sentence an
 * empty error gets.
 *
 * So a platform failure and a code failure read identically: "The request did
 * not complete" for both. That makes the reader's own data look like the
 * suspect, and it leaves nothing anywhere that says which of the two happened.
 * `fromPlatformJson` names it, narrowly, so that retrying is an obviously good
 * idea rather than a superstition. Cloudflare also returns a complete HTML
 * Error 1102 page for a worker that exhausts its limits, so that shape is
 * recognized separately and just as narrowly.
 */

/**
 * A zod issue, as it survives being JSON-encoded and sent to a browser.
 *
 * Deliberately structural rather than importing zod's type: this module is
 * imported by client components, and the shape is all that matters once the
 * error has been serialised.
 */
type SerialisedIssue = {
  message?: unknown;
  path?: unknown;
};

function isIssueArray(value: unknown): value is SerialisedIssue[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "object" && v !== null && "message" in v)
  );
}

/** True for an error list whose entries are numbered, as a gateway's is. */
function hasNumberedError(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some(
    (issue) =>
      typeof issue === "object" &&
      issue !== null &&
      typeof (issue as { code?: unknown }).code === "number",
  );
}

/**
 * Field names as a reader would say them, for the few that reach a person.
 *
 * A path of `["feedUrl"]` is meaningless to somebody who has never seen the
 * schema. Anything not listed here is dropped rather than guessed at — a
 * mangled camelCase field name in a sentence is worse than no field name.
 */
const FIELD_LABELS: Record<string, string> = {
  feedUrl: "feed address",
  email: "email address",
  question: "question",
  name: "name",
  note: "note",
  url: "address",
  count: "number",
  userLimit: "account limit",
};

/** Ends a sentence, without doubling a mark that is already there. */
function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Pulls the readable part out of a serialised zod error, or returns null.
 *
 * Returns the messages joined rather than only the first: a form that failed
 * two rules should say both, and the alternative is a reader fixing one problem
 * at a time with a round trip each.
 */
function fromZodJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isIssueArray(parsed)) return null;

  const parts: string[] = [];
  for (const issue of parsed) {
    if (typeof issue.message !== "string" || issue.message.trim() === "") continue;

    // zod's own wording for a missing or mistyped field is written for a
    // developer reading a stack trace. Anything else is a `.refine()` message
    // somebody wrote deliberately, and those are already customer-facing.
    const generic = /^(required|invalid_type|expected .* received .*)$/i.test(issue.message);
    const field =
      Array.isArray(issue.path) && typeof issue.path[0] === "string"
        ? FIELD_LABELS[issue.path[0]]
        : undefined;

    if (generic) {
      parts.push(field ? `Check the ${field}` : "Some of those details are not valid");
      continue;
    }
    parts.push(
      field ? `${sentence(issue.message).slice(0, -1)} (${field}).` : sentence(issue.message),
    );
  }

  if (parts.length === 0) return null;
  return parts.map(sentence).join(" ");
}

/**
 * The sentence for a failure the platform reported, not the app.
 *
 * Deliberately narrow, and that narrowness is the point: a JSON body is only
 * read as a platform failure when it carries a marker an application payload
 * has no reason to — the edge's own field names, or its `success: false`
 * envelope. Anything else still falls through to the caller's fallback rather
 * than being described as something it is not.
 */
function fromPlatformJson(raw: string): string | null {
  if (!raw.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;

  const named =
    body["cloudflare_error"] === true ||
    typeof body["error_name"] === "string" ||
    typeof body["error_category"] === "string" ||
    typeof body["ray_id"] === "string";
  const envelope = body["success"] === false && hasNumberedError(body["errors"]);
  if (!named && !envelope) return null;

  // Says only what is true of every one of these: the request was cut off
  // before the app could answer, so retrying is reasonable and the reader's own
  // data is not implicated.
  return "Our server was interrupted before it could answer. Try again in a moment.";
}

/** The matching sentence for Cloudflare's HTML Worker resource-limit page. */
function fromPlatformHtml(raw: string): string | null {
  const cloudflareWorkerLimit =
    /(?:error\s*1102|worker exceeded resource limits)/i.test(raw) &&
    /(?:cloudflare|cf-ray|ray id)/i.test(raw);
  return cloudflareWorkerLimit
    ? "Our server was interrupted before it could answer. Try again in a moment."
    : null;
}

/**
 * The sentence to show a customer for any thrown thing.
 *
 * `fallback` is used when the error carries nothing worth showing — an empty
 * message, a raw object, a network abort. Callers pass something specific to
 * what they were doing, because "Something went wrong" on its own tells a
 * reader nothing about whether to retry or to change what they typed.
 */
export function humanError(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  const trimmed = raw.trim();
  if (trimmed === "") return fallback;

  const unwrapped = fromZodJson(trimmed);
  if (unwrapped) return unwrapped;

  const platform = fromPlatformJson(trimmed) ?? fromPlatformHtml(trimmed);
  if (platform) return platform;

  // Unrecognized HTML is still a response body, not a sentence to show a reader.
  if (/^(?:<!doctype\s+html|<html\b)/i.test(trimmed)) return fallback;

  // A message that is still JSON, or still looks like machinery, is not shown.
  // Better a plain fallback than a stack frame or a Postgres error code in
  // front of somebody who just wanted to add a feed.
  if (/^[[{]/.test(trimmed)) return fallback;
  if (/\b(TypeError|ReferenceError|SyntaxError|ECONNREFUSED|fetch failed)\b/i.test(trimmed)) {
    return fallback;
  }

  return sentence(trimmed);
}
