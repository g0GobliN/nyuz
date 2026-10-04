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

  it("collapses one incident told in two outlets' own words, by actor and figure", () => {
    // The live pair the owner found in the briefing: The Register's account of
    // an arrest against Tom's Hardware's. They share no marker word -- one says
    // "accused", the other "arrested" -- and only two content words, so the
    // word tests keep both. The actor and the $300 million say it is one story.
    const kept = suppressStoryTwins([
      brief(
        "Californian accused of shipping $300M worth of Nvidia chips to China without Uncle Sam's approval",
        "Greg Lui, 38, allegedly tried to export around $300 million worth of Nvidia kit via US-based freight businesses.",
      ),
      brief(
        "California tech CEO arrested, faces up to 20 years in prison for smuggling $300 million in Nvidia AI servers to China",
        "A California man has been arrested for smuggling over $300 million worth of restricted Nvidia chips to China.",
      ),
    ]);
    expect(kept.map((b) => b.title)).toEqual([
      "Californian accused of shipping $300M worth of Nvidia chips to China without Uncle Sam's approval",
    ]);
  });

  it("keeps two stories about one company apart when no figure is shared", () => {
    // The DGX Spark pair from the corpus: same actor, and only one side carries
    // a figure, so neither the shape test nor the marker test may fuse them.
    const kept = suppressStoryTwins([
      brief(
        "Nvidia debuts $4,999 DGX Spark with half the RAM and storage, amid memory crunch",
        "The desktop AI machine ships with 128 GB of unified memory.",
      ),
      brief(
        "NVIDIA DGX Spark 64GB Gives Developers More Ways to Build and Scale Local AI",
        "The company said the compact machine runs local models for developers.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("collapses a price change the two desks hedged differently", () => {
    // The corpus pair the structural path caught at delivery: one title carries
    // the percentage, the other the dollar figure, and only the summaries make
    // the shared figure visible. Titles alone keep them apart, which is why
    // this test builds the briefs the way a briefing does.
    const kept = suppressStoryTwins([
      brief(
        "Component shortages drive Raspberry Pi prices up by up to 23%",
        "Following the latest price adjustments, the cost of the Raspberry Pi 4 2GB jumps to $67.50, a 23% increase.",
      ),
      brief(
        "Once a $35 computer, the 2 GB Raspberry Pi 4 now costs $67.50",
        "Raspberry Pi has raised prices for the 2 GB Pi 4 and Pi 5, citing rapidly rising memory costs.",
      ),
    ]);
    expect(kept.map((b) => b.title)).toEqual([
      "Component shortages drive Raspberry Pi prices up by up to 23%",
    ]);
  });

  it("does not fuse two companies by a shared figure", () => {
    const kept = suppressStoryTwins([
      brief(
        "Amazon commits $1B to community grants near its data centers",
        "The five-year fund is aimed at the towns hosting its campuses.",
      ),
      brief(
        "Microsoft commits $1B to community grants near its data centers",
        "The five-year fund is aimed at the towns hosting its campuses.",
      ),
    ]);
    expect(kept).toHaveLength(2);
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

  it("keeps a generic marker honest when the pair shares too little else", () => {
    // Both titles carry a generic marker (a launch) and the same actor, but only
    // two content words in common, which is one short of what a generic marker
    // needs. The pair falls all the way through `areTwins` and both survive --
    // this is the branch that stops "launches" fusing two unrelated launches by
    // one company.
    const kept = suppressStoryTwins([
      brief("Acme launches a phone in Europe", "The handset ships in March."),
      brief("Acme launches a laptop in Japan", "The notebook arrives in April."),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("ignores a marker only one side carries", () => {
    // The inner `continue` in the marker loop, and the reason it is reachable at
    // all: the left brief carries the non-generic `deal` marker and the right
    // one carries no marker, so the loop advances instead of deciding. Getting
    // here needs a pair with real word overlap, a shared entity and *no* shared
    // figure — with a figure the structural test returns first and this arm is
    // never reached, which is exactly what the magnitude fix changed.
    const kept = suppressStoryTwins([
      brief("Acme completes takeover of Beta Systems", "The deal closes next week."),
      brief("Acme completes purchase of Beta Systems", "The transaction closes next week."),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("collapses one incident inside a single briefing when only a magnitude is shared", () => {
    // The in-batch half of the same fix: two accounts of the G7 release in one
    // morning's list, sharing no currency figure at all.
    const kept = suppressStoryTwins([
      brief(
        "The G7 will release 100 million reserve barrels of diesel fuel",
        "The world's wealthiest nations say they will release 100 million barrels of oil and diesel fuel in their reserves.",
      ),
      brief(
        "G7 to release 100 million barrels of oil and diesel after Trump export ban",
        "The coordinated release is aimed at heading off further price spikes and avoiding a ban on US diesel exports.",
      ),
    ]);
    expect(kept).toHaveLength(1);
  });

  it("suppresses one incident whose only shared figure is a bare magnitude", () => {
    // The G7 oil release, measured in the 30-day evaluation window as two
    // cards. Neither headline names a currency figure, so `numericKeys` alone
    // could not see the pair; the identity vocabulary is what joins it.
    const kept = suppressDeliveredTwins(
      [
        {
          eventId: "g7-b",
          title: "G7 to release 100 million barrels of oil and dampen prices",
          whatHappened: "Members agreed to release reserves from emergency stockpiles.",
        },
      ],
      [
        {
          title: "The G7 will release 100 million reserve barrels to calm markets",
          whatHappened: "The group said the release would be coordinated across members.",
        },
      ],
    );
    expect(kept).toEqual([]);
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

  it("treats a missing summary as empty rather than as a crash", () => {
    // `whatHappened` is nullable on the delivered-history side: `digest_items`
    // does not carry a summary, so a caller passing the delivered titles through
    // hands over `null`. The shape has to read that as "no summary", not throw.
    const kept = suppressDeliveredTwins(
      [{ eventId: "fresh", title: "Acme ships a thing", whatHappened: null }],
      [{ title: "Unrelated story about something else entirely", whatHappened: null }],
    );
    expect(kept.map((entry) => entry.eventId)).toEqual(["fresh"]);
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
