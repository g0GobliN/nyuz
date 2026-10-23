import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BRIEFING_READING, briefingSummaryCharactersPerLine } from "@/lib/briefing-measure";
import { STORIES } from "@/lib/sample-data";
import type { Story } from "@/lib/story";
import {
  BriefingPreview,
  briefGroupLabel,
  briefGroups,
  briefLede,
  briefOrderNote,
} from "./briefing-preview";

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
  extra?: Record<string, unknown>,
): string {
  return renderToStaticMarkup(
    createElement(BriefingPreview, {
      stories,
      variant,
      ...(fromQueue ? { fromQueue } : {}),
      ...extra,
    }),
  ).replace(/&#x27;/gu, "'");
}

/** One entry per anchor in the markup, in document order (so, reading order). */
function anchors(html: string): string[] {
  return [...html.matchAll(/<a [^>]*/gu)].map((m) => m[0]);
}

/** One entry per heading element of `tag`, in document order. */
function headings(html: string, tag: "h1" | "h2" | "h3" | "h4"): string[] {
  return [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "gu"))].map(
    (m) => m[0],
  );
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

  /** The hrefs in the order the card renders its stories — groups included. */
  function readingOrder(
    delivered: Story[],
    variant: "marketing" | "reader",
    fromQueue?: "briefing",
  ): string[] {
    const suffix = fromQueue ? "?from=briefing" : "";
    // B-03: the reader moves through groups now, so the "order they are read"
    // is the groups' sequence — the same partition the component computes,
    // flattened — and a flat day below the grouping floor stays edition order.
    const grouped = variant === "reader" ? briefGroups(delivered) : [];
    const order = grouped.flatMap((g) => g.stories);
    const listed = order.length > 0 ? order : delivered;
    return listed.map((s) => `/dashboard/story/${s.id}${suffix}`);
  }

  it("gives all 25 stories a link, in the order they are read", () => {
    const html = render(delivered, "reader");
    const hrefs = anchors(html).map((a) => /href="([^"]*)"/u.exec(a)?.[1] ?? "");
    expect(hrefs).toHaveLength(delivered.length);
    expect(hrefs).toEqual(readingOrder(delivered, "reader"));
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
    expect(hrefs).toEqual(readingOrder(delivered, "reader", "briefing"));
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
  it("caps the reader's card, and only the reader's card", () => {
    expect(render(STORIES, "reader")).toContain("max-w-[32rem]");
    expect(render(STORIES)).not.toContain("max-w-[32rem]");
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

  it("fits 65–75 characters on a line at 1280 px", () => {
    // The audit's own range for the product (the feed card sits at 94, the
    // story deck at 88); the briefing was the outlier at 144.
    expect(briefingSummaryCharactersPerLine()).toBeGreaterThanOrEqual(65);
    expect(briefingSummaryCharactersPerLine()).toBeLessThanOrEqual(75);
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
    const html = chrome({ chrome: "edition", editionTime: "07:30" });
    for (const phrase of BANNED) expect(count(html, phrase)).toBe(0);
    // The positive half: the header still says what this is and when it was
    // assembled, so the assertion above cannot pass by rendering nothing.
    expect(html).toContain("Edition · 07:30");
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

  it("falls back to the card's own time when editionTime is missing", () => {
    // A caller that passes only `chrome` still gets a true time rather than an
    // empty stamp — `time` defaults to "7:30 AM", the card's 12-hour form.
    const html = chrome({ chrome: "edition" });
    expect(html).toContain("Edition · 7:30 AM");
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
    // B-01 — state, not delivery: today's briefing is an edition under
    // assembly, not an inbox receipt.
    expect(EYEBROW).toContain("Today's edition");
  });
});

/**
 * B-01/B-02/B-06 — the chrome's sentences, read from the route source the way
 * the eyebrow test above reads it: the sub-line is a claim the reader should be
 * able to check against the page it sits on, and the chips are preferences.
 */
describe("briefing route — the sub-line and the chips tell the truth", () => {
  const ROUTE = readFileSync("src/routes/dashboard/briefing.tsx", "utf8");
  const SUB = /sub=\{([\s\S]*?)\}\s*\n/u.exec(ROUTE)?.[1] ?? "";

  it("finds the sub expression it asserts about", () => {
    expect(SUB).toContain("day");
  });

  it('names the actual day on an archive, not "today\'s" (B-02)', () => {
    expect(SUB).toContain("coverage published before ${prefs.time} on ${day.date}");
  });

  it("keeps the latest briefing's sentence about today (B-01)", () => {
    expect(SUB).toContain("today's coverage at ${prefs.time}");
  });

  it("labels the channel chips as preferences, not a status or a receipt (B-06)", () => {
    expect(ROUTE).toContain("Email · on (preference)");
    expect(ROUTE).toContain("Telegram · on (preference)");
    expect(ROUTE).not.toMatch(/Email on/u);
  });

  it("derives the order claim from the rows the page renders, not a constant (N-07)", () => {
    // The audit: the page said "Nothing here was reordered for the web." while
    // printing 01, 03, 07, 08, 13, 17 — grouping is a reorder, and the sentence
    // sits directly above a page whose order differs from arrival order. The
    // sub-line now takes that half from the same function the page groups with,
    // so a grouped page cannot print the flat sentence and a flat one cannot
    // print the grouped one.
    expect(SUB).toContain("${briefOrderNote(shown)}");
    expect(SUB).not.toContain("Nothing here was reordered");
  });
});

/**
 * N-07 — the order claim is a function of the rendered rows. Grouping is a
 * stable partition: no story overtakes the ones published around it inside its
 * own group, and the groups sort by size — so a grouped page's order is not the
 * edition's order, and the sentence it prints must say that instead of denying
 * it. An ungrouped page prints the edition verbatim, and keeps the sentence
 * that is then true.
 */
describe("briefOrderNote — the order claim matches what the page does (N-07)", () => {
  const mk = (topics: string[], id: string): Story => ({ ...STORIES[0]!, id, topics });

  /** Arrival order: the smaller group first, so the page order differs. */
  const arrival = [
    ...Array.from({ length: 4 }, (_, i) => mk(["Security"], `sec${i}`)),
    ...Array.from({ length: 6 }, (_, i) => mk(["AI"], `ai${i}`)),
  ];

  it("says what grouping did on a page whose order differs from arrival", () => {
    // The precondition, measured on the fixture: the page prints the bigger
    // group first, so a reader comparing the page to the edition sees a reorder.
    const groups = briefGroups(arrival);
    expect(groups.map((g) => g.topic)).toEqual(["AI", "Security"]);
    const note = briefOrderNote(arrival);
    expect(note).not.toContain("Nothing here was reordered");
    expect(note).toBe("Grouped by topic; the stories inside each group keep the edition's order.");
    // The claim it prints is true of the rendering: each group's stories keep
    // the edition's order inside the group.
    for (const group of groups) {
      const positions = group.stories.map((s) => arrival.findIndex((a) => a.id === s.id));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("keeps the flat sentence when the page prints the edition verbatim", () => {
    expect(briefOrderNote(arrival.slice(0, 7))).toBe("Nothing here was reordered for the web.");
    expect(briefGroups(arrival)).not.toEqual([]); // the precondition still holds for the fixture
  });
});

/**
 * S2 — the heading tree the audit measured (`docs/reader-clarity-audit-2026-10-
 * 22.md` §4, Appendix A): the reader's briefing opened on 1 h1, 1 h3, 0 h2, and
 * 25 stories that were not headings at all — a list that skipped a level and
 * gave a screen reader nothing to step through. The target after this change:
 * one h2 section head on the page, every story an `h3` whose first child is the
 * link into it, and no heading invented beyond that.
 */
describe("BriefingPreview — the heading tree (S2)", () => {
  /** The live shape: one story per line, 25 of them, unique ids. */
  const delivered: Story[] = Array.from({ length: 25 }, (_, i) => ({
    ...STORIES[i % STORIES.length]!,
    id: `6f1c9a52-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  }));

  it("renders one h2 section head and every story as an h3 containing its link", () => {
    const html = render(delivered, "reader");
    expect(headings(html, "h2")).toHaveLength(1);
    const h3s = headings(html, "h3");
    expect(h3s).toHaveLength(delivered.length);
    for (const h3 of h3s) expect(h3).toContain("<a ");
  });

  it("adds no h1 and no second h2 — the page header owns the h1", () => {
    const html = render(delivered, "reader");
    expect(html).not.toContain("<h1");
    expect(headings(html, "h2")).toHaveLength(1);
  });

  it("leaves the marketing card's heading shape untouched", () => {
    const html = render(delivered);
    expect(headings(html, "h2")).toHaveLength(0);
    expect(headings(html, "h3")).toHaveLength(1);
  });
});

/**
 * B-03 — the structure. The audit: "no sentence saying what today's briefing is
 * about, no grouping and no heading between items — 25 cards in one list." The
 * groups are the events' own primary topics (`topics[0]`), nothing invented;
 * the order inside a group is the order the edition already chose; the tail
 * collapses into "Elsewhere" so the page holds two to four groups, not ten.
 */
describe("briefGroups — the edition's own topics structure it (B-03)", () => {
  const mk = (topics: string[], id: string): Story => ({
    ...STORIES[0]!,
    id,
    topics,
  });

  it("keeps a quiet day flat", () => {
    expect(briefGroups(STORIES.slice(0, 7).map(() => mk(["AI"], "a")))).toEqual([]);
  });

  it("keeps a one-topic edition flat — one heading saying 'AI' twenty times is not a group", () => {
    expect(briefGroups(Array.from({ length: 12 }, (_, i) => mk(["AI"], `s${i}`)))).toEqual([]);
  });

  it("groups by each story's own topic, order kept inside the group", () => {
    // Interleaved on purpose: grouping must not let a story overtake the ones
    // the edition published next to it. 6 AI, 3 Security, interleaved.
    const stories = [
      mk(["AI"], "s0"),
      mk(["Security"], "s1"),
      mk(["AI"], "s2"),
      mk(["AI"], "s3"),
      mk(["Security"], "s4"),
      mk(["AI"], "s5"),
      mk(["AI"], "s6"),
      mk(["AI"], "s7"),
      mk(["Security"], "s8"),
    ];
    const groups = briefGroups(stories);
    expect(groups.map((g) => [g.topic, g.stories.length])).toEqual([
      ["AI", 6],
      ["Security", 3],
    ]);
    expect(groups[0]!.stories.map((s) => s.id)).toEqual(["s0", "s2", "s3", "s5", "s6", "s7"]);
  });

  it("keeps at most four groups, collapsing the long tail into Elsewhere", () => {
    const stories = [
      ...Array.from({ length: 6 }, (_, i) => mk(["AI"], `a${i}`)),
      ...Array.from({ length: 5 }, (_, i) => mk(["Security"], `b${i}`)),
      ...Array.from({ length: 4 }, (_, i) => mk(["Chips"], `c${i}`)),
      ...Array.from({ length: 3 }, (_, i) => mk(["Markets"], `d${i}`)),
      ...Array.from({ length: 2 }, (_, i) => mk(["Sports"], `e${i}`)),
      ...Array.from({ length: 2 }, (_, i) => mk(["Film"], `f${i}`)),
    ];
    const groups = briefGroups(stories);
    expect(groups.map((g) => g.topic)).toEqual(["AI", "Security", "Chips", "Elsewhere"]);
    // The tail keeps its own internal order: Markets before Sports before Film.
    expect(groups[3]!.stories.map((s) => s.topics[0] ?? "none")).toEqual([
      "Markets",
      "Markets",
      "Markets",
      "Sports",
      "Sports",
      "Film",
      "Film",
    ]);
  });

  it("gives four groups without Elsewhere when there are exactly four topics", () => {
    const stories = [
      ...Array.from({ length: 3 }, (_, i) => mk(["AI"], `a${i}`)),
      ...Array.from({ length: 2 }, (_, i) => mk(["Security"], `b${i}`)),
      ...Array.from({ length: 2 }, (_, i) => mk(["Chips"], `c${i}`)),
      ...Array.from({ length: 2 }, (_, i) => mk(["Markets"], `d${i}`)),
    ];
    expect(briefGroups(stories).map((g) => g.topic)).toEqual([
      "AI",
      "Security",
      "Chips",
      "Markets",
    ]);
  });

  it("labels a group with its topic and its count", () => {
    expect(
      briefGroupLabel({ topic: "AI", stories: Array.from({ length: 6 }, () => STORIES[0]!) }),
    ).toBe("AI · 6 stories");
    expect(briefGroupLabel({ topic: "Security", stories: [STORIES[0]!] })).toBe(
      "Security · 1 story",
    );
  });

  it("writes the lede from the same two facts — the top group and the next", () => {
    const stories = [
      ...Array.from({ length: 6 }, (_, i) => mk(["AI"], `a${i}`)),
      ...Array.from({ length: 3 }, (_, i) => mk(["Security"], `b${i}`)),
    ];
    const groups = briefGroups(stories);
    expect(briefLede(stories, groups)).toBe(
      "The day's through-line is AI — 6 of 9 stories — with Security (3) behind it.",
    );
  });

  it("still says something true when one topic is the whole edition", () => {
    const stories = [mk(["AI"], "a"), mk(["AI"], "b_SECOND")];
    expect(briefGroups(stories)).toEqual([]);
    expect(briefLede(stories, [])).toBe("");
  });
});

describe("BriefingPreview — the groups render as structure (B-03)", () => {
  /** 9 stories, 6 AI then interleaved Security, like the fixture above. */
  const stories: Story[] = [
    mk(["AI"], "s0"),
    mk(["Security"], "s1"),
    mk(["AI"], "s2"),
    mk(["AI"], "s3"),
    mk(["Security"], "s4"),
    mk(["AI"], "s5"),
    mk(["AI"], "s6"),
    mk(["AI"], "s7"),
    mk(["Security"], "s8"),
  ];
  function mk(topics: string[], id: string): Story {
    return { ...STORIES[0]!, id, topics };
  }

  it("renders the lede and one labelled group per topic, numbers still counting the whole edition", () => {
    const html = render(stories, "reader");
    expect(html).toContain(
      "The day's through-line is AI — 6 of 9 stories — with Security (3) behind it.",
    );
    expect(html).toContain("AI · 6 stories");
    expect(html).toContain("Security · 3 stories");
    // Item 07 is the last AI story read, wherever it sits in the page's list.
    expect(html).toContain(">07</span>");
  });

  it("renders neither a lede nor group labels on the flat, low end", () => {
    const html = render(stories.slice(0, 3), "reader");
    expect(html).not.toContain("through-line");
    expect(html).not.toContain('role="heading"');
  });
});

/**
 * X-01 — parity with the feed. Measured in the audit: the feed gives every card
 * an importance band and Read/Save; the briefing gave a headline link and
 * nothing. One card, one set of facts: the band prints on both, and the
 * briefing gets the same two actions.
 */
describe("BriefingPreview — one card, one set of facts (X-01)", () => {
  const base: Story = {
    ...STORIES[0]!,
    title: "A headline that does not contain the band word",
    importance: "High",
  };

  it("shows the importance band on the reader's card", () => {
    expect(render([base], "reader")).toContain(">High</span>");
  });

  it("gives the reader's card the feed's two actions, and knows which one is pressed", () => {
    const html = render([base], "reader", undefined, {
      savedIds: [base.id],
      onToggleSave: vi.fn(),
    });
    // Read joins the headline link, so the anchors double; the button exists
    // exactly once and says what was pressed.
    expect(anchors(html)).toHaveLength(2);
    expect(anchors(html).every((a) => a.includes(base.id))).toBe(true);
    expect(html).toContain("<button");
    expect(html).toContain("Saved");
    expect(html).toMatch(/aria-pressed="true"/u);
  });

  it("keeps the actions off surfaces that never asked for them", () => {
    // No toggle passed: the reader's card has no buttons at all.
    expect(render([base], "reader")).not.toContain("<button");
    // The marketing facsimile stays inert even if a caller passes both props —
    // a link there would send a visitor into a dashboard they have no account for.
    const marketing = render([base], "marketing", undefined, {
      savedIds: [base.id],
      onToggleSave: vi.fn(),
    });
    expect(marketing).not.toContain("<a ");
    expect(marketing).not.toContain("<button");
  });
});
