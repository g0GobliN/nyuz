import { describe, expect, it } from "vitest";
import { sourceSignalsFrom, topicsFor, type TopicRow } from "./classify";
import { topicTerms } from "@/lib/topics";

/**
 * Topics as the LIVE taxonomy stores them.
 *
 * The distinction these fixtures encode is the one that broke the demand gate:
 * every `predefined` row really does have `terms: []` in production, because
 * terms were added in 0049 for reader-created interests and the editorial
 * vocabulary reaches events through the keyword pool instead. A fixture that
 * gave predefined topics terms would pass while production found nothing.
 */
function predefined(id: string, label: string): TopicRow {
  return { id, slug: label.toLowerCase().replaceAll(" ", "-"), label, terms: [] };
}

function custom(id: string, label: string): TopicRow {
  return { id, slug: label.toLowerCase(), label, terms: topicTerms(label) };
}

const AI = predefined("t-ai", "AI");
const CYBER = predefined("t-cyber", "Cybersecurity");
const LINUX = predefined("t-linux", "Linux");
const SPORTS = predefined("t-sports", "Sports");
const HEALTH = predefined("t-health", "Health");
const GAMING = predefined("t-gaming", "Gaming");
const NEPAL = custom("t-nepal", "nepal");
const TAXONOMY = [AI, CYBER, LINUX, SPORTS, HEALTH, GAMING, NEPAL];

describe("topicsFor", () => {
  it("reads the story rather than the publisher", () => {
    // The whole point of 0068. Wired publishes both of these; a publisher-level
    // mapping has to answer the same way for each, and that is the defect that
    // starved analysis of every fresh event on 2026-09-08.
    const aiStory = topicsFor(
      { title: "Inside the AI lab betting everything on one model" },
      ["Wired"],
      TAXONOMY,
    );
    const shoeStory = topicsFor(
      { title: "The best running shoes of the year" },
      ["Wired"],
      TAXONOMY,
    );

    expect(aiStory).toContain(AI.id);
    expect(shoeStory).not.toContain(AI.id);
  });

  it("reaches a category topic no headline states literally", () => {
    // A match report is Sports and contains no word "sports". Matching the
    // label literally returns nothing, which is why this goes through the
    // keyword pool rather than through the terms.
    const matched = topicsFor(
      { title: "Late goal sends the team into the league final" },
      [],
      TAXONOMY,
    );
    expect(matched).toContain(SPORTS.id);
  });

  it("takes a section feed at its word", () => {
    // The one case where the publisher really does state the subject. This is
    // the mapping `source_topics` was supposed to hold for BBC Health, Guardian
    // Film and the rest, and mostly did not.
    const matched = topicsFor(
      { title: "A food safety officer went viral" },
      ["BBC Health"],
      TAXONOMY,
    );
    expect(matched).toContain(HEALTH.id);
  });

  it("finds the subject in the coverage when the headline is coy", () => {
    // Event titles are the first article's headline, which is often a pun. The
    // articles' own text is what rescues it — and over-admitting costs one
    // analysis, while under-admitting costs a reader a story they follow.
    const matched = topicsFor(
      { title: "Everything, everywhere, all at once" },
      ["Torvalds merges the Linux kernel scheduler rework"],
      TAXONOMY,
    );
    expect(matched).toContain(LINUX.id);
  });

  it("matches a reader's own interest on its terms, as stage 5 does", () => {
    expect(topicsFor({ title: "Floods displace thousands in Nepal" }, [], TAXONOMY)).toContain(
      NEPAL.id,
    );
    expect(topicsFor({ title: "Floods displace thousands in Peru" }, [], TAXONOMY)).not.toContain(
      NEPAL.id,
    );
  });

  it("can put one event under several topics", () => {
    const matched = topicsFor(
      { title: "AI-generated malware targets Linux servers" },
      ["Researchers describe the security vulnerability and the exploit"],
      TAXONOMY,
    );
    expect(matched).toEqual(expect.arrayContaining([AI.id, LINUX.id, CYBER.id]));
  });

  it("returns nothing for an event about nothing in the taxonomy", () => {
    expect(topicsFor({ title: "Local bakery wins award" }, [], TAXONOMY)).toEqual([]);
  });

  it("returns nothing rather than everything when there is no text", () => {
    expect(topicsFor({ title: "" }, [], TAXONOMY)).toEqual([]);
    expect(topicsFor({ title: "   " }, [], TAXONOMY)).toEqual([]);
  });

  it("never links a termless topic to the whole corpus", () => {
    // `matchesTerms` uses `every`, which is vacuously true on an empty list, and
    // EVERY predefined row in production has an empty list. Without the length
    // guard in `topicsFor`, the first such row would match every event ever
    // clustered and put the entire corpus into demand — which is precisely the
    // cost model this stage exists to protect.
    const unknown = predefined("t-unknown", "Something Not In The Pool");
    expect(topicsFor({ title: "Local bakery wins award" }, [], [unknown])).toEqual([]);
  });

  it("keeps the cost model: an unfollowed subject still yields no demand", () => {
    // Gaming is in the taxonomy, so the event is labelled — but labelling is not
    // demand. Demand is the join against what a reader follows, and that join is
    // the database's job in `event_has_demand`. This asserts the labelling half
    // is specific enough for that join to mean something.
    const gaming = topicsFor({ title: "Persona remakes are coming to PlayStation" }, [], TAXONOMY);
    expect(gaming).toContain(GAMING.id);
    expect(gaming).not.toContain(AI.id);
    expect(gaming).not.toContain(HEALTH.id);
  });
});

describe("sourceSignalsFrom", () => {
  it("folds a section feed into a signal the way loadSourceSignals always has", () => {
    // The exact scenario Sports' "sport" strong term exists for: wire copy that
    // names only clubs and players, reachable only through the publisher
    // stating the subject in its section feed.
    const signals = sourceSignalsFrom([
      { id: "s1", name: "BBC Sport", feed_url: "https://bbc.co.uk/sport/rss.xml" },
    ]);
    expect(signals.get("s1")).toContain("BBC Sport");
    expect(signals.get("s1")).toContain("sport");
  });

  it("gives analyse.ts's independent recompute the same reach classify.ts has", () => {
    // Neither the title nor a plausible excerpt says "sport"; only the section
    // feed does. Before the analyse.ts parity fix, this text alone (what
    // analyse.ts built) would miss Sports even though classify.ts, folding the
    // same signal in, would not -- the two writers of an event's topics would
    // disagree on the same event.
    const signals = sourceSignalsFrom([
      { id: "s1", name: "BBC Sport", feed_url: "https://bbc.co.uk/sport/rss.xml" },
    ]);
    const title = "Griezmann scores twice as Atletico win at home";
    expect(topicsFor({ title }, [signals.get("s1") ?? ""], [SPORTS])).toContain(SPORTS.id);
  });
});
