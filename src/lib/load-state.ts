/**
 * Which of the five states a request-backed panel is in.
 *
 * Every panel in the dashboard asks one question and can be in one of five
 * states, and each one used to work that out for itself with a chain of
 * ternaries. The chains drifted: one screen put "your briefing is still
 * assembling" in front of a request that had died, another put "no alerts sent
 * yet" above the reason the list could not be read, a third made "No briefings
 * yet" reachable from an archive that never opened. The `undefined` a failure
 * leaves behind is the same `undefined` a request that has not answered leaves
 * behind, so none of those mistakes is visible in a type — and none of them is
 * visible at all until a reader is on a bad connection.
 *
 * The order is the whole point, so it lives in one function rather than in
 * seven files:
 *
 * 1. `content` — there is something to show. This wins over everything,
 *    including a request that is failing behind it: an apology must never take
 *    away content that is already on screen.
 * 2. `waiting` — no answer yet. `isPending`, not `isLoading`: React Query calls
 *    a query between two retry attempts neither pending-and-fetching nor
 *    settled for a beat, and reading that beat as an answer is how a retry gap
 *    turned into a claim about the reader's briefing.
 * 3. `given` — a sentence that follows from the reader's own settings and is
 *    true whether or not this request ever answers ("you haven't chosen any
 *    topics"). It sits above the failure because it is still true and its
 *    action still leads somewhere. Only put a sentence here if it is true
 *    *without* an answer: "nothing has been sent yet" claims something about
 *    the list, and belongs in `empty`.
 * 4. `failed` — nothing to show, and the request failed. Reachable only when
 *    there is nothing on screen to protect.
 * 5. `empty` — an answer that had nothing in it. This is the only state in
 *    which a sentence about the reader's own data may be printed.
 *
 * A query that is disabled (`enabled: false`) stays `pending` forever, so a
 * state that makes the request moot — "alerts aren't on your plan" — belongs in
 * front of the panel rather than in `given`, or it is drawn behind a spinner
 * that never stops.
 */
export type LoadPhase = "content" | "waiting" | "given" | "failed" | "empty";

/** What `loadPhase` needs to read, and what the failure state needs to retry. */
export type LoadQuery<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: () => unknown;
};

/**
 * The state of one panel.
 *
 * `query` is the whole query result rather than three booleans, so a call site
 * cannot pair one request's data with another's status. `hasContent` is the
 * screen's one judgement: whether the panel has anything worth showing, which
 * only the screen knows — a list of zero groups is content on one page and
 * nothing to draw on another.
 */
export function loadPhase(
  query: Pick<LoadQuery<unknown>, "data" | "isPending" | "isError">,
  state: { hasContent: boolean; hasGiven?: boolean },
): LoadPhase {
  if (state.hasContent) return "content";
  if (query.isPending) return "waiting";
  if (state.hasGiven) return "given";
  if (query.isError) return "failed";
  if (query.data !== undefined) return "empty";
  // Not pending, not failed, no data: React Query does not produce this
  // combination. Waiting is the one answer that claims nothing about the reader.
  return "waiting";
}
