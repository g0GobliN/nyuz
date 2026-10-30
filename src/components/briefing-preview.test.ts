import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BRIEFING_READING, briefingSummaryCharactersPerLine } from "@/lib/briefing-measure";
import { STORIES } from "@/lib/sample-data";
import type { Story } from "@/lib/story";
import { BriefingPreview } from "./briefing-preview";

/**
 * `Link` needs a running router, and this file is about the URL a reader's
 * browser would be handed. The stand-in resolves `to` and `params` exactly as
 * the router does — `/dashboard/story/$id` with an `id` becomes
 * `/dashboard/story/<id>` — so an assertion here reads the href, not a fixture.
 * The stand-in also appends `search` as a query string, since the briefing
 * link carries `?from=briefing` when the page that mounts it wants the story
 * page's pager to walk the reader through the briefing.
 */
vi.mock("@tanstack/react-router", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: (props: {
      to?: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      className?: string;
      children?: unknown;
    }) => {
      let href = props.to ?? "#";
      for (const [key, value] of Object.entries(props.params ?? {})) {
        href = href.replace(`$${key}`, value);
      }
      const entries = Object.entries(props.search ?? {});
      if (entries.length > 0) {
        const qs = entries
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&");
        href = `${href}?${qs}`;
      }
      return h("a", { href, className: props.className }, props.children as never);
    },
  };
});

/** Markup escaped by React, so the assertions read as text does. */
function render(
  stories: Story[],
  variant: "marketing" | "reader" = "marketing",
  fromQueue?: "home" | "alerts" | "briefing",
): string {
  return renderToStaticMarkup(
    createElement(BriefingPreview, {
      stories,
      variant,
      ...(fromQueue ? { fromQueue } : {}),
    }),
  ).replace(/&#x27;/gu, "'");
}

/** One entry per anchor in the markup, in document order (so, reading order). */
function anchors(html: string): string[] {
  return [...html.matchAll(/<a [^>]*/gu)].map((m) => m[0]);
}

/**
 * Significance and provenance print under different headings — the arbiter's
 * ruling of 2026-10-09. `why` is the briefing's fact about the story and shows
 * under "Why it matters"; `personalization` is the reader's own follow graph
 * and keeps its own heading. Neither is allowed to stand in for the other, and
 * neither leaves an empty heading behind.
 */
describe("BriefingPreview — significance vs provenance", () => {
  const base = STORIES[0]!;
  const heading = "Why you're seeing this";

  it("separates the significance line from the follow line", () => {
    const html = render([
      {
        ...base,
        why: "The story carries a $40 billion figure.",
        personalization: { heading, explanation: "You follow AI and NVIDIA." },
      },
    ]);
    expect(html).toContain("Why it matters · ");
    expect(html).toContain("The story carries a $40 billion figure.");
    expect(html).toContain("Why you're seeing this · ");
    expect(html).toContain("You follow AI and NVIDIA.");
  });

  it("keeps provenance alone when there is no significance line", () => {
    const html = render([
      {
        ...base,
        why: "",
        personalization: { heading, explanation: "You follow Cybersecurity." },
      },
    ]);
    expect(html).not.toContain("Why it matters");
    expect(html).toContain("Why you're seeing this · ");
    expect(html).toContain("You follow Cybersecurity.");
  });

  it("prints no heading for what is not there", () => {
    const html = render([{ ...base, why: "" }]);
    expect(html).not.toContain("Why it matters");
    expect(html).not.toContain("Why you're seeing this");
  });
});

/**
 * B1, measured on the deployed product on 2026-10-21: the briefing held **25
 * stories, 0 anchors, 0 tabbable elements, 0 pointer cursors**. A reader could
 * scroll 4,236 px of their own briefing and open nothing. This is the
 * assertion that fails if that returns: every story is a link to its own page,
 * in reading order, reachable by keyboard, with a pointer and a visible ring.
 */
describe("BriefingPreview — the reader's briefing is a way in", () => {
  /** The live shape: one story per line, 25 of them. */
  const delivered: Story[] = Array.from({ length: 25 }, (_, i) => ({
    ...STORIES[i % STORIES.length]!,
    id: `6f1c9a52-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  }));

  it("gives all 25 stories a link, in the order they are read", () => {
    const html = render(delivered, "reader");
    const hrefs = anchors(html).map((a) => /href="([^"]*)"/u.exec(a)?.[1] ?? "");
    expect(hrefs).toHaveLength(delivered.length);
    expect(hrefs).toEqual(delivered.map((s) => `/dashboard/story/${s.id}`));
  });

  it("keeps every link in the tab order, with a pointer and a visible focus ring", () => {
    const html = render(delivered, "reader");
    const links = anchors(html);
    expect(links).toHaveLength(delivered.length);
    for (const link of links) {
      // An anchor with an href is tabbable; a negative tabindex is the one
      // thing that would take it back out of the keyboard's path.
      expect(link).not.toContain("tabindex");
      expect(link).toContain("cursor-pointer");
      expect(link).toContain("focus-visible:ring-2");
      expect(link).toContain("focus-visible:ring-ring");
    }
  });

  it("leaves the marketing facsimile inert", () => {
    // The landing page's stories are fixtures, and a link there would send a
    // visitor into a dashboard they have no account for. The variant is opt-in
    // precisely so the two usages cannot be confused.
    expect(render(delivered)).not.toContain("<a ");
    expect(render(delivered, "reader")).toContain("<a ");
  });

  /*
   * The pager on the story page reads `?from=` to decide which list to walk
   * the reader through. Without `from=briefing` the pager takes the feed,
   * which on the deployed origin is 24 of the briefing's 25 stories —
   * measured on 2026-10-21, "1 of 24 in your nyuz" under a 25-link briefing.
   * Today's briefing passes `fromQueue="briefing"`; the Saved tab and the
   * marketing facsimile do not, so the link stays clean and the story page
   * falls back to no pager rather than naming a list that does not match.
   */
  it("names the briefing as the queue when fromQueue is set", () => {
    const html = render(delivered, "reader", "briefing");
    const hrefs = anchors(html).map((a) => /href="([^"]*)"/u.exec(a)?.[1] ?? "");
    expect(hrefs).toHaveLength(delivered.length);
    expect(hrefs).toEqual(delivered.map((s) => `/dashboard/story/${s.id}?from=briefing`));
  });

  it("keeps the link clean when fromQueue is omitted", () => {
    // Saved tab, history view, and any future call site that hasn't decided
    // its queue: the search param is the lie, not the link itself, so the
    // default is the link without it.
    const html = render(delivered, "reader");
    const hrefs = anchors(html).map((a) => /href="([^"]*)"/u.exec(a)?.[1] ?? "");
    expect(hrefs.every((h) => !h.includes("?"))).toBe(true);
  });
});

/**
 * B2, measured on the deployed product on 2026-10-21: 13.5 px text over a
 * 911 px column inside a 969 px card — **144 characters per line**, against
 * 88–109 everywhere else in the product. The card had been sized for a 548 px
 * marketing column.
 *
 * The number this asserts is a measurement, not a taste: Manrope 400's mean
 * advance is 0.4525 em per character (measured 2026-10-21 in Chromium against
 * the app's own Google Fonts request, over the 25 delivered lines in
 * docs/live-read-2026-10-21.md §1). See `src/lib/briefing-measure.ts`.
 */
describe("BriefingPreview — the briefing sets a reading measure", () => {
  it("caps the reader's card at the dashboard's content column, and only the reader's card", () => {
    expect(render(STORIES, "reader")).toContain("max-w-[64rem]");
    expect(render(STORIES)).not.toContain("max-w-[64rem]");
  });

  it("keeps the reader's list one column at every width", () => {
    // The owner has now rejected both a narrow card and a two-column card: the
    // briefing has always been one column, and one column is what ships. The
    // guard is here so nobody reintroduces the split as a "measure" fix.
    const reader = render(STORIES, "reader");
    expect(reader).toContain("divide-y");
    expect(reader).not.toMatch(/columns-\d/u);
    // The marketing facsimile is the same single list.
    expect(render(STORIES)).toContain("divide-y");
    expect(render(STORIES)).not.toMatch(/columns-\d/u);
  });

  it("prints the summary at the size the measure was computed for", () => {
    expect(render(STORIES, "reader")).toContain(
      `text-[${BRIEFING_READING.summaryPx}px] leading-relaxed text-muted-foreground`,
    );
  });

  it("keeps the cap the characters-per-line check divides by the class it renders", () => {
    // Two numbers describe one card: the Tailwind candidate and the pixel value
    // the arithmetic uses. If only one of them moves, the check below would
    // pass while the page shipped something else.
    const rem = Number(/max-w-\[(\d+(?:\.\d+)?)rem\]/u.exec(BRIEFING_READING.cardClassName)?.[1]);
    expect(rem * 16).toBe(BRIEFING_READING.cardMaxPx);
  });

  it("sets the single column the owner asked for, not the audit's 65–75 range", () => {
    // Recorded exception (see `briefing-measure.ts`): the card is full width and
    // the list is one column, so the summary sets ~147 characters. The audit's
    // 65–75 range was met by two shapes the owner rejected — a 32 rem card and
    // a two-column card. This asserts the number the file documents so the two
    // cannot drift; it is not a claim that 147 is the typographic ideal.
    expect(briefingSummaryCharactersPerLine()).toBe(147.2);
  });
});

/**
 * S8 follow-up — the regression guard the S8 diff pin did not allow.
 *
 * S8 (`docs/decisions/briefing-channel-neutral-framing.md`) removed the
 * delivery claim from the reader's card: no sender address, no "Delivered at"
 * stamp, and the header reads `Edition · 07:30`. It shipped with no test,
 * because the ruling pinned the diff to the component and the route. That is a
 * real weakness and this block closes it: nothing below fails if the framing
 * comes back, and the default chrome is asserted too, so the scan is proven
 * able to fire.
 *
 * The claim is read case-insensitively from the rendered markup, not from the
 * source, because that is where a reader meets it — and because a phrase that
 * moves from a heading to a footer, or gains different casing, is the same
 * false claim in a new place.
 */
describe("BriefingPreview — what the chrome claims", () => {
  /** The phrases the reader's own page must never print. */
  const BANNED = ["brief@nyuz.app", "inbox", "Delivered at"] as const;

  /** Occurrences of `phrase` in `html`, ignoring case. */
  function count(html: string, phrase: string): number {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return [...html.matchAll(new RegExp(escaped, "giu"))].length;
  }

  function chrome(props: { chrome?: "email" | "edition"; editionTime?: string }): string {
    return renderToStaticMarkup(
      createElement(BriefingPreview, { stories: STORIES.slice(0, 2), variant: "reader", ...props }),
    );
  }

  it("prints none of the banned strings under edition chrome", () => {
    const html = chrome({ chrome: "edition", editionTime: "09:30" });
    for (const phrase of BANNED) expect(count(html, phrase)).toBe(0);
    // The positive half: the header still says what this is and when it was
    // assembled, so the assertion above cannot pass by rendering nothing.
    expect(html).toContain("Edition · 09:30");
  });

  it("trips the same scan under the default chrome, so the scan can fail", () => {
    // A scan that passes in both chromes proves the test is broken, not that
    // the card is honest. `email` is the default and it is the half that keeps
    // this falsifiable: both phrases below are ones the reader's page dropped,
    // printed by the chrome that deliberately keeps them.
    const defaulted = chrome({});
    expect(defaulted).toBe(chrome({ chrome: "email" }));
    expect(count(defaulted, "brief@nyuz.app")).toBe(1);
    expect(count(defaulted, "Delivered at")).toBe(1);
  });

  it("names the edition and no clock when editionTime is missing", () => {
    // Two editions a day changed what a missing stamp means. Falling back to
    // the reader's preference used to be "a true time"; now it would stamp an
    // evening edition with the morning's clock, which is a false claim about
    // when it was built. With no slot known the header says "Edition" and no
    // more, and the reader is told nothing they cannot check.
    const html = chrome({ chrome: "edition" });
    expect(html).toContain("Edition");
    expect(count(html, "Edition ·")).toBe(0);
    expect(count(html, "Delivered at")).toBe(0);
  });
});

/**
 * The eyebrow is the page's claim, not the card's, so it cannot be asserted by
 * rendering `BriefingPreview`. It is read from the route source instead — the
 * same shape `src/lib/style-tokens.test.ts` uses for `src/styles.css` — because
 * the ruling that moved it (CEO, 2026-10-22) is otherwise unguarded: it is one
 * string on one line, which is exactly what a later copy pass rewrites.
 */
describe("briefing route — the eyebrow does not claim a delivery", () => {
  const ROUTE = readFileSync("src/routes/dashboard/briefing.tsx", "utf8");
  const EYEBROW = /eyebrow=\{([\s\S]*?)\}\s*\n/u.exec(ROUTE)?.[1] ?? "";

  it("finds the expression it asserts about", () => {
    // A regex that stopped matching would leave the assertions below checking
    // an empty string — which passes, for the wrong reason.
    expect(EYEBROW).toContain("day");
  });

  it("says Edition, with the day when one is open, and never Delivered", () => {
    expect(EYEBROW).toContain("Edition · ${day.date}");
    expect(EYEBROW).not.toContain("Delivered");
  });
});
