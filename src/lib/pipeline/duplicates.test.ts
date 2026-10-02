import { describe, expect, it } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import {
  suppressDeliveredDuplicates,
  suppressDeliveredTwins,
  suppressStoryTwins,
} from "./duplicates";
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

  it("collapses one policy story told three ways", () => {
    // Real headlines from the 2026-10-01 briefing, where the same White House
    // announcement shipped as three cards at positions 5, 11 and 16. No pair
    // shared enough bare title overlap for the old predicate; the policy
    // marker group is what catches the pair that names the action, and the
    // triple word overlap catches the summit pair.
    const kept = suppressStoryTwins([
      brief(
        "Trump administration gets Big Tech to sign weak, non-binding, AI regulations",
        "To address that matter, on Tuesday, Trump signed an executive order requiring federal government agencies to use the term “Super Intelligence” in official correspondence.",
      ),
      brief(
        "Three takeaways from Trump's 'Super Intelligence' summit",
        "The meeting at the White House came as some tech bosses and experts have called for tighter rules around AI.",
      ),
      brief(
        "Trump says top tech firms have signed accord to 'self-police' AI development",
        "President Trump on Tuesday said that he and a large group of leaders of artificial intelligence companies had signed a voluntary accord.",
      ),
    ]);
    expect(kept).toHaveLength(1);
  });

  it("does not let the policy marker fuse unrelated stories about the same actor", () => {
    // Two genuine policy events on one day, sharing the actor and the marker.
    // Two content words in common (trump, ai) and nothing else — the third
    // shared word is what keeps the marker honest.
    const kept = suppressStoryTwins([
      brief(
        "Trump orders US government to call AI ‘Super Intelligence’",
        "The executive order also directs agencies to prefer the term in public communications.",
      ),
      brief(
        "Trump launches America.gov with AI chatbots at its core",
        "The new portal answers citizen questions with model-generated text.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("suppresses a reworded story the reader was already sent", () => {
    // The ShinyHunters arrest shipped on 2026-10-01 and was set to ship again
    // on 10-02 as a different event with a reworded headline.
    // `suppressDeliveredDuplicates` correctly passes both (different events);
    // only the twin test against the delivered titles catches the repeat.
    const kept = suppressDeliveredTwins(
      [
        {
          eventId: "fresh",
          title: "Dutch Police Arrest ‘Reformed’ Hacker in Shiny Hunters Investigation",
          whatHappened: "Officers detained the suspect in a nationwide fraud probe.",
        },
        {
          eventId: "other",
          title: "Ex-soldier's telecom hacking spree earns him 70 months",
          whatHappened: "The sentence follows ayears-long investigation into SIM swaps.",
        },
      ],
      [
        {
          title: "Dutch police arrest 'security pro' in ShinyHunters probe",
          whatHappened:
            "Dutch police have arrested a 24-year-old man on suspicion of involvement with the prolific ShinyHunters cybercrime group.",
        },
      ],
    );
    expect(kept.map((b) => b.eventId)).toEqual(["other"]);
  });

  it("leaves fresh stories alone when delivery history is empty", () => {
    const briefs = [
      {
        eventId: "a",
        title: "AMD acquires World Labs AI startup",
        whatHappened: "The deal closes by the end of the year.",
      },
    ];
    expect(suppressDeliveredTwins(briefs, [])).toEqual(briefs);
  });
});
