import { describe, expect, it } from "vitest";
import { storyPush } from "./payload";

describe("storyPush", () => {
  it("keeps each story addressable by its event id", () => {
    const n = storyPush({
      title: "Talks resume",
      why: "This is the event the rest of the day will orbit.",
      href: "https://nyuz.app/dashboard/story/1",
      eventId: "1",
    });
    expect(n.tag).toBe("1");
    expect(n.url).toContain("/dashboard/story/1");
    expect(n.title).toBe("Talks resume");
  });

  it("marks a breaking alert without folding it into a briefing", () => {
    expect(
      storyPush({
        title: "Vote passes",
        why: "The text that became law is not the leak.",
        href: "https://nyuz.app/dashboard/story/x",
        eventId: "x",
        breaking: true,
      }).title,
    ).toMatch(/^Breaking · /);
  });
});
