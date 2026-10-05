import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A bookmark and the shelf it lands on are two different cache entries.
 *
 * The card the reader taps writes `saved_stories`; the shelf they check next
 * reads `["briefing", "saved"]`, an entry filled when they last opened that chip.
 * The invalidation below is the only thing that connects the two, and nothing
 * about its absence is visible in a type or a render: the shelf does not come
 * back empty, it comes back full of a minute ago — so a story saved and looked
 * at immediately reads as a save that did not work.
 *
 * Source text, because the hook needs a React renderer the unit suite has no
 * environment for — the same reasoning as
 * `src/lib/install/install-wiring.test.ts` and
 * `src/lib/offline/offline-wiring.test.ts`.
 */

const STORE = readFileSync("src/lib/feedback-store.ts", "utf8");

describe("a save reaches the shelf", () => {
  it("updates the saved list cache before the network write", () => {
    expect(STORE).toContain("queryClient.setQueryData<Story[]>(SAVED_QUERY_KEY");
    expect(STORE).toContain("const request = previous");
    expect(STORE.indexOf("setQueryData<Story[]>(SAVED_QUERY_KEY")).toBeLessThan(
      STORE.indexOf("const request = previous"),
    );
  });

  it("invalidates the saved list after a successful write", () => {
    expect(STORE).toContain("queryClient.invalidateQueries({ queryKey: SAVED_QUERY_KEY })");
    expect(STORE.indexOf("invalidateQueries")).toBeGreaterThan(
      STORE.indexOf("const request = previous"),
    );
  });

  it("accepts the full story so the shelf can render it immediately", () => {
    expect(STORE).toContain("(story: Story)");
    expect(STORE).toContain("return [story,");
  });

  it("keeps the key the shelf actually fetches under", () => {
    // A key that does not match marks an entry nobody reads, and the result looks
    // identical to working code until a reader checks the shelf.
    expect(readFileSync("src/routes/dashboard/briefing.tsx", "utf8")).toContain(
      'queryKey: ["briefing", "saved"]',
    );
  });
});

describe("failed bookmarks are visible and reversible", () => {
  it("rolls back both the feedback state and the shelf cache", () => {
    expect(STORE).toContain("setSaveErrors");
    expect(STORE).toContain("humanError(");
    expect(STORE).toContain("Could not save this story. Try again.");
    expect(STORE).toContain("if (nowSaved) return current?.filter((item) => item.id !== id);");
  });

  it("serializes repeated toggles for one story", () => {
    expect(STORE).toContain("saveChains.current");
    expect(STORE).toContain("const request = previous");
    // A rejected earlier write must not stall the next one.
    expect(STORE).toContain(".catch(() => undefined)");
  });
});

describe("the shelf shows a save before the server has confirmed it", () => {
  it("keeps unconfirmed saves somewhere a route change cannot drop them", () => {
    // `useFeedback` is mounted once per route, so a map on a `useRef` forgets a
    // bookmark at the exact moment the reader navigates to look for it.
    expect(STORE).toContain(
      "const pendingSaves = new Map<string, { saved: boolean; story: Story }>();",
    );
    expect(STORE).not.toContain("useRef(new Map<string, boolean>())");
  });

  it("merges them over the list the server returned", () => {
    // A response that overlapped the tap cannot contain it, and the shelf draws
    // whatever came back — so the merge has to happen where the shelf renders,
    // not only in the cache the response overwrites.
    expect(STORE).toContain("export function withPendingSaved");
    expect(readFileSync("src/routes/dashboard/briefing.tsx", "utf8")).toContain(
      "withPendingSaved(savedQ.data ?? [])",
    );
  });

  it("retires the hold only after the authoritative refetch lands", () => {
    const success = STORE.slice(
      STORE.indexOf(".then(() => {"),
      STORE.indexOf(".catch((error: unknown)"),
    );
    expect(success).toContain("invalidateQueries({ queryKey: SAVED_QUERY_KEY })");
    expect(success.indexOf("invalidateQueries")).toBeLessThan(
      success.indexOf("pendingSaves.delete(id)"),
    );
  });
});

describe("a failed bookmark is told, not only undone", () => {
  it("renders the message where the reader tapped", () => {
    for (const file of [
      "src/components/dashboard/story-card.tsx",
      "src/components/dashboard/story-article.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("saveError");
      expect(source).toContain('role="alert"');
    }
  });

  it("hands it to both screens that can save", () => {
    expect(readFileSync("src/routes/dashboard/index.tsx", "utf8")).toContain(
      "saveError={saveErrors[story.id]}",
    );
    expect(readFileSync("src/routes/dashboard/story/$id.tsx", "utf8")).toContain(
      "saveError={story ? saveErrors[story.id] : undefined}",
    );
  });
});

describe("a mute persists what the button showed", () => {
  it("decides muted-or-not from the state snapshot before sending", () => {
    // React 18 runs a setState updater at the next render, so a value assigned
    // inside it is not yet visible to the statement that follows. muteTopic
    // used to post `muted: false` on every click — the server agreed to do
    // nothing, the feed hid the cards, and the mute was gone on the next load.
    // Measured live in production: POST 200, table empty, reload restored the
    // cards. The save must read `state.mutedTopics` before setState, the way
    // toggleSaved reads `state.saved`.
    const mute = STORE.slice(STORE.indexOf("const muteTopic"), STORE.indexOf("const reset"));
    expect(mute).toContain("const nowMuted = !state.mutedTopics.includes(topic)");
    expect(mute.indexOf("const nowMuted")).toBeLessThan(mute.indexOf("saveMutedTopic"));
    expect(mute).not.toContain("let nowMuted = false");
  });

  it("sends the decision the button made", () => {
    const mute = STORE.slice(STORE.indexOf("const muteTopic"), STORE.indexOf("const reset"));
    expect(mute).toContain("saveMutedTopic({ data: { topic, muted: nowMuted } })");
  });
});

describe("the shelf does not rely on that one call", () => {
  it("is fetched again every time the page opens", () => {
    // Saves also happen on other devices and in other tabs, which no
    // invalidation here can see. `staleTime: 0` is what makes opening the shelf
    // an answer rather than a copy of the last answer.
    const briefing = readFileSync("src/routes/dashboard/briefing.tsx", "utf8");
    const saved = briefing.slice(briefing.indexOf('queryKey: ["briefing", "saved"]'));
    const query = saved.slice(0, saved.indexOf("});"));
    expect(query).toContain("staleTime: 0");
  });
});
