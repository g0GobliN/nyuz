import { describe, expect, it } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import { suppressDeliveredDuplicates, suppressStoryTwins } from "./duplicates";
const now = new Date("2026-09-16T12:00:00Z");
const title = "Central bank raises interest rate to 4 percent";
describe.each(["briefing", "alert"] as const)("conservative %s duplicate suppression", (kind) => {
  it("avoids repeats within a batch and across recent deliveries", async () => {
    const db = new FakeDb({
      events: [
        { id: "sent", title, first_seen_at: now.toISOString() },
        { id: "duplicate", title: title + "!", first_seen_at: now.toISOString() },
        { id: "development", title: title.replace("4", "5"), first_seen_at: now.toISOString() },
      ],
      digests: [{ digest_id: "d", user_id: "u", kind, generated_at: now.toISOString() }],
      digest_items: [{ digest_id: "d", event_id: "sent" }],
    });
    expect([
      ...(await suppressDeliveredDuplicates(
        asDb(db),
        "u",
        ["duplicate", "development"],
        now,
        kind,
      )),
    ]).toEqual(["development"]);
    db.tables["digests"] = [];
    expect([
      ...(await suppressDeliveredDuplicates(
        asDb(db),
        "u",
        ["sent", "duplicate", "development"],
        now,
        kind,
      )),
    ]).toEqual(["sent", "development"]);
  });
  it("does not hide separate dated developments or another reader's coverage", async () => {
    const db = new FakeDb({
      events: [
        { id: "old", title, first_seen_at: "2026-09-01T00:00:00Z" },
        { id: "new", title, first_seen_at: now.toISOString() },
      ],
      digests: [{ digest_id: "d", user_id: "other", kind, generated_at: now.toISOString() }],
      digest_items: [{ digest_id: "d", event_id: "new" }],
    });
    expect([
      ...(await suppressDeliveredDuplicates(asDb(db), "u", ["old", "new"], now, kind)),
    ]).toEqual(["old", "new"]);
  });
});

/* -------------------------------------------------------------------------- */
/* One story per briefing                                                      */
/* -------------------------------------------------------------------------- */

const brief = (title: string, whatHappened: string) => ({ title, whatHappened });

/**
 * Real rows from the 2026-09-30 corpus. The IPO family is the reason this
 * exists: five events, one prospectus, and `sameStory` correctly refuses every
 * pair of them because no two titles share four anchors.
 */
const IPO_FAMILY = [
  brief(
    "Anthropic's IPO pitch includes a warning about human extinction",
    "Anthropic has formally warned investors that its technology may pose existential risks to humanity in a long-awaited initial public offering prospectus circulated with a small group of partners in recent days.",
  ),
  brief(
    "Anthropic lists ‘existential risks to humanity’ as one of its risk factors in IPO prospectus",
    "Anthropic warned in its IPO prospectus that advanced AI potentially poses catastrophic or existential risks to humanity, noting it as one of the key risk factors that could affect its business.",
  ),
  brief(
    "Leaked IPO docs: Anthropic tempts investors with existential risk warning",
    "After an unusual pitch to investors, Anthropic has laid bare its challenges in becoming anything like a profitable, normal business in its IPO prospectus that was leaked to the FT on Tuesday.",
  ),
  brief(
    "Anthropic's prospectus details losses, growth, and, yes, a warning that its AI could end humanity",
    "In its prospectus, Anthropic just told investors it's losing tens of billions of dollars a year, but also growing like crazy, and its own AI might pose an existential risk to humanity.",
  ),
];

describe("one story per briefing", () => {
  it("keeps only the first telling of the IPO family", () => {
    expect(suppressStoryTwins(IPO_FAMILY).map((b) => b.title)).toEqual([IPO_FAMILY[0]!.title]);
  });

  it("collapses the same arrest phrased four ways", () => {
    const kept = suppressStoryTwins([
      brief(
        "Suspected ShinyHunters leader arrested in the Netherlands",
        "Dutch police say they arrested a 24-year-old Amsterdam man in connection with ShinyHunters, the hacking group that claimed responsibility for high-profile attacks.",
      ),
      brief(
        "Dutch Police Arrest 24-Year-Old Amsterdam Man in ShinyHunters Investigation",
        "Dutch authorities have confirmed that they arrested a 24-year-old man from Amsterdam in connection with the ShinyHunters group.",
      ),
      brief(
        "Dutch police arrest 'security pro' in ShinyHunters probe",
        "Dutch police have arrested a 24-year-old man on suspicion of involvement with the prolific ShinyHunters cybercrime group.",
      ),
      brief(
        "Dutch police arrest ShinyHunters hacker accused of planning two murders",
        "Dutch police said the hacker, arrested for being part of the ShinyHunters cybercriminal gang, had plans to organize the murder of two people on his laptop.",
      ),
      brief(
        "FBI to ShinyHunters: 'We know how to find you'",
        "The FBI's cyber chief has a message for the criminals that hacked the bureau's jobs portal last week: turn yourself in.",
      ),
    ]);
    expect(kept.map((b) => b.title)).toEqual([
      "Suspected ShinyHunters leader arrested in the Netherlands",
      "FBI to ShinyHunters: 'We know how to find you'",
    ]);
  });

  it("keeps other stories about the same company", () => {
    const kept = suppressStoryTwins([
      IPO_FAMILY[0]!,
      brief(
        "Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack",
        "The company declined to testify at the hearing on datacentre power use, citing a security incident at a partner.",
      ),
      brief(
        "Anthropic releases Sonnet 5.5, which it calls a significantly cheaper, faster work partner",
        "Anthropic has released the newest version of its mid-range model, boasting faster response times and less token burn.",
      ),
    ]);
    expect(kept).toHaveLength(3);
  });

  it("needs a third shared word before calling two launches one story", () => {
    const kept = suppressStoryTwins([
      brief(
        "OpenAI launches GPT-6.1 Sol, says it nearly matches GPT-6 Astra and costs less",
        "OpenAI says GPT-6.1 Sol delivers significant improvements over GPT-6 Sol across complex professional tasks.",
      ),
      brief(
        "OpenAI launches Dots, its Muse competitor",
        "Like Muse, OpenAI's Dots are represented by cute, customizable avatars.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("keeps everything when no summary is there to compare", () => {
    const kept = suppressStoryTwins([
      brief("Anthropic warns of AI existential risk as concerns emerge over Meta's Muse", ""),
      IPO_FAMILY[0]!,
    ]);
    expect(kept).toHaveLength(2);
  });
});
