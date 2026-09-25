import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoadState } from "@/components/dashboard/load-state";
import { loadPhase, type LoadQuery } from "@/lib/load-state";

/**
 * The one place the five states of a request-backed panel are decided.
 *
 * These are rendered rather than read, because the thing being tested *is* the
 * decision — which slot a reader ends up under for a given request. A source
 * assertion could not tell the difference between a branch that is ordered
 * correctly and one that merely mentions the right strings, and the bug this
 * replaced was exactly a branch in the wrong place.
 *
 * The screens themselves are held to the rule in
 * `src/lib/load-state-screens.test.ts`.
 */

/** A query result in the shape the panel reads, without React Query. */
function q(
  partial: { data: string | undefined } & Partial<
    Pick<LoadQuery<string>, "isPending" | "isError" | "error" | "isFetching" | "refetch">
  >,
): LoadQuery<string> {
  return {
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: () => {},
    ...partial,
  };
}

type Slots = {
  hasContent?: boolean;
  content?: ReactNode;
  loading?: ReactNode;
  given?: ReactNode;
  failed?: string;
  empty?: (data: string) => ReactNode;
  className?: string;
};

/** The panel, drawn, with the slots a test does not care about filled in. */
function draw(query: LoadQuery<string>, slots: Slots = {}): string {
  // `in` rather than `??`, so a test can pass `content: null` and mean it.
  const props: Parameters<typeof LoadState<string>>[0] = {
    query,
    hasContent: slots.hasContent ?? false,
    content: "content" in slots ? slots.content : "CONTENT",
    loading: slots.loading ?? "LOADING",
    failed: slots.failed ?? "We couldn't load your briefing.",
  };
  // `exactOptionalPropertyTypes` is on, so an absent slot is omitted rather than
  // passed as undefined.
  if (slots.given !== undefined) props.given = slots.given;
  if (slots.empty !== undefined) props.empty = slots.empty;
  if (slots.className !== undefined) props.className = slots.className;
  return renderToStaticMarkup(createElement(LoadState<string>, props));
}

describe("the panel a request-backed section draws", () => {
  it("waits while the request has not answered", () => {
    const html = draw(q({ data: undefined, isPending: true }));
    expect(html).toContain("LOADING");
    expect(html).not.toContain("CONTENT");
    expect(html).not.toContain("We couldn't load your briefing.");
  });

  it("reports the failure, its reason and the way out", () => {
    const html = draw(
      q({ data: undefined, isError: true, error: new Error("Session expired. Sign in again.") }),
    );
    // The apostrophe is escaped in markup, so the assertion names the words.
    expect(html).toContain("load your briefing.");
    // The reason, so the screen is diagnosable from a screenshot.
    expect(html).toContain("Session expired");
    expect(html).toContain("Try again");
    expect(html).not.toContain("CONTENT");
  });

  it("says it is trying while the retry is in flight", () => {
    const html = draw(q({ data: undefined, isError: true, isFetching: true }));
    expect(html).toContain("Trying…");
    expect(html).toContain("disabled");
  });

  it("never takes away what is already on screen", () => {
    const html = draw(q({ data: "answered", isError: true, isFetching: true }), {
      hasContent: true,
    });
    expect(html).toContain("CONTENT");
    expect(html).not.toContain("load your briefing");
  });

  it("reaches the empty slot only with an answer in hand", () => {
    const empty = vi.fn((data: string) => `EMPTY:${data}`);

    expect(draw(q({ data: undefined, isPending: true }), { empty })).not.toContain("EMPTY");
    expect(draw(q({ data: undefined, isError: true }), { empty })).not.toContain("EMPTY");
    expect(empty).not.toHaveBeenCalled();

    // The answer itself — including an answer that had nothing in it, which is
    // the only state a sentence about the reader's data may be printed in.
    expect(draw(q({ data: "" }), { empty })).toContain("EMPTY:");
    expect(empty).toHaveBeenCalledWith("");
  });

  it("draws a fact about the reader above a failure", () => {
    const html = draw(q({ data: undefined, isError: true }), { given: "YOU HAVE NO TOPICS" });
    expect(html).toContain("YOU HAVE NO TOPICS");
    expect(html).not.toContain("load your briefing");
  });

  it("still waits before drawing that fact", () => {
    const html = draw(q({ data: undefined, isPending: true }), { given: "YOU HAVE NO TOPICS" });
    expect(html).toContain("LOADING");
    expect(html).not.toContain("YOU HAVE NO TOPICS");
  });

  it("leaves nothing behind when a slot draws nothing", () => {
    // The custom-source section draws its own body around this panel, so a panel
    // whose content is nothing must not leave a box carrying its margins.
    const html = draw(q({ data: "answered" }), {
      hasContent: true,
      content: null,
      className: "mt-6",
    });
    expect(html).toBe("");
  });
});

describe("loadPhase", () => {
  const asking = { data: undefined, isPending: true, isError: false };
  const dead = { data: undefined, isPending: false, isError: true };
  const answered = { data: [], isPending: false, isError: false };

  it("shows content over a refetch failing behind it", () => {
    expect(loadPhase({ data: ["a"], isPending: false, isError: true }, { hasContent: true })).toBe(
      "content",
    );
  });

  it("asks before it claims", () => {
    // A query between two retry attempts is pending with no error recorded yet,
    // and the chains this replaced read that beat as a settled answer.
    expect(loadPhase(asking, { hasContent: false })).toBe("waiting");
    expect(
      loadPhase({ data: undefined, isPending: true, isError: true }, { hasContent: false }),
    ).toBe("waiting");
  });

  it("gives the reader's own fact the failure's turn", () => {
    expect(loadPhase(dead, { hasContent: false, hasGiven: true })).toBe("given");
  });

  it("reports a failure only when there is nothing to protect", () => {
    expect(loadPhase(dead, { hasContent: false })).toBe("failed");
  });

  it("treats an empty answer as an answer", () => {
    expect(loadPhase(answered, { hasContent: false })).toBe("empty");
  });

  it("waits on a combination React Query does not produce", () => {
    // No data, not asking, no error. Waiting is the one answer that claims
    // nothing about the reader.
    expect(
      loadPhase({ data: undefined, isPending: false, isError: false }, { hasContent: false }),
    ).toBe("waiting");
  });
});
