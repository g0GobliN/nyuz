import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { PlanTier } from "@/lib/supabase/types";
import { TopicControls } from "./topic-controls";

/**
 * Static render, with the query's answer pre-seeded into the cache: the
 * component reads `loadTopicControls` through react-query, and the only thing
 * a render needs from that is rows. The save conversation itself is the server
 * function's to test; here the panel is judged on what it draws.
 */

type ControlRow = {
  topic_id: string;
  importance: string;
  keywords: string[];
  exclude_keywords: string[];
  topics: { slug: string } | null;
};

const row = (over: Partial<ControlRow> = {}): ControlRow => ({
  topic_id: "11111111-1111-4111-8111-111111111111",
  importance: "notable",
  keywords: [],
  exclude_keywords: [],
  topics: { slug: "ai" },
  ...over,
});

function render(plan: PlanTier, rows: ControlRow[] | null): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (rows) client.setQueryData(["topic-controls"], rows);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(TopicControls, { topic: "AI", plan }),
    ),
  );
}

describe("TopicControls", () => {
  it("holds the panel until the row exists, so a save cannot fire blind", () => {
    const html = render("plura", null);
    expect(html).toContain("Loading controls");
    expect(html).not.toContain("Save controls");
  });

  it("renders the ladder panel for every plan, saved terms filled in", () => {
    const html = render("plura", [
      row({ importance: "only_major", keywords: ["releases"], exclude_keywords: ["rumours"] }),
    ]);
    expect(html).toContain("Keywords to prioritize");
    expect(html).toContain("releases");
    expect(html).toContain("Keywords to exclude");
    expect(html).toContain("rumours");
    expect(html).toContain("Save controls");
    // Inside the pool, no counter: a cap you are not touching is noise.
    expect(html).not.toContain("of 50");
  });

  it("shows the importance dial only where the plan carries it", () => {
    expect(render("plura", [row()])).toContain("How much of it");
    expect(render("uno", [row()])).not.toContain("How much of it");
    // The dial is the entitlement; the words are not.
    expect(render("uno", [row()])).toContain("Keywords to prioritize");
  });

  it("tells the ladder when saved terms sit past a smaller plan's pool", () => {
    // A reader downgraded from Omni keeps their hundred terms; the panel shows
    // the boundary they now live behind rather than trimming silently.
    const many = Array.from({ length: 60 }, (_, i) => `term ${i}`);
    const html = render("plura", [row({ keywords: many })]);
    expect(html).toContain("60 of 50 · nyuz Omni allows 100");
    expect(html).toContain("/dashboard/billing");
  });
});
