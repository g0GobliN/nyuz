import { describe, expect, it } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import { capitalised } from "./news-signals";
import { STOPWORDS } from "./shortlist";
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

  it("collapses the delivered 03/04 pair by the break-in vocabulary", () => {
    // The measured duplicate of the delivered 2026-10-19 briefing (ruling #18,
    // 2026-10-20). Tom's Hardware's account and The Verge's are one incident:
    // both titles say a hacker broke into sites with AI agents. Neither title
    // carries the old security vocabulary (`breach`, `hacked`, `leak`), so
    // before the ruling the pair never reached the overlap test. The first
    // telling is kept because the list is in reading order.
    const kept = suppressStoryTwins([
      brief(
        "A Chinese hacker used AI agents to break into more than 100 company websites",
        "Fewer than 100 Chinese characters were used, yet the agents had attempted ot break into more than 1,200 different websites as of the week ending October 18, 2026.",
      ),
      brief(
        "A hacker broke into John Deere and SharkNinja with an army of AI agents",
        "A hacker broke into more than 100 websites using an army of AI agents that mostly operated on their own, according to findings from the AI security firm Norforge.",
      ),
    ]);
    expect(kept.map((b) => b.title)).toEqual([
      "A Chinese hacker used AI agents to break into more than 100 company websites",
    ]);
  });

  it("collapses the delivered 2026-10-20 SpaceX earnings pair by the result leg", () => {
    // Scout read the delivered `3fcbb21c` briefing as a stranger and found the
    // same quarterly release twice, back to back: TechCrunch's framing and The
    // Verge's numbers. None of the pass's existing legs can see the pair — no
    // marker group holds financial vocabulary, the two titles share one content
    // word (`spacex`; `ai` is below the floor), and the stored lines share no
    // figure. The frame/term leg is what fuses them, and the first telling wins
    // because the list is in reading order.
    const kept = suppressStoryTwins([
      brief("SpaceX’s AI business is beating expectations", "AI was the engine."),
      brief(
        "SpaceX says big AI growth fueled revenue jump",
        "SpaceX announced revenues of $14.6 billion in its Q3 earnings on Tuesday, which it says was a growth of 161 percent year-over-year.",
      ),
    ]);
    expect(kept.map((b) => b.title)).toEqual(["SpaceX’s AI business is beating expectations"]);
  });

  it("keeps a result frame and a result term apart when the actor is not the same", () => {
    // The leg's actor condition: two companies' quarterly numbers are two
    // stories, however alike the wording.
    const kept = suppressStoryTwins([
      brief(
        "Apple beats expectations as services grow",
        "Apple reported quarterly results on Thursday.",
      ),
      brief(
        "SpaceX says big AI growth fueled revenue jump",
        "SpaceX announced revenues of $14.6 billion.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("keeps a framed result apart from a story that never names a result", () => {
    // The leg needs a frame on one side *and* a term on the other. A launch with
    // no financial vocabulary is not the same story as an earnings beat.
    const kept = suppressStoryTwins([
      brief("SpaceX’s AI business is beating expectations", "AI was the engine."),
      brief("SpaceX launches a new Starlink tier for boats", "The tier costs $250 a month."),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("keeps two accounts that both name the result and neither frames it", () => {
    // Two `revenue` headlines with no frame are not the leg: a summary that
    // mentions revenue in passing is what the ruling's cost boundary protects.
    const kept = suppressStoryTwins([
      brief("SpaceX revenue jumps on Starlink growth", "SpaceX said revenue rose."),
      brief(
        "SpaceX says big AI growth fueled revenue jump",
        "SpaceX announced revenues of $14.6 billion.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("keeps a break-in word in a summary from fusing two stories about one group", () => {
    // The constraint ruling #18 put on the widening: a pair may only be
    // suppressed when the word is in the headline on both sides. This arrest and
    // the FBI's message to the same group share the entity and three content
    // words, and one summary mentions a hacked portal; counting that would
    // suppress a distinct story.
    const kept = suppressStoryTwins([
      brief(
        "Dutch police arrest ShinyHunters hacker accused of planning two murders",
        "Dutch police said the hacker, arrested for being part of the ShinyHunters cybercriminal gang, had plans to organize the murder of two people on his laptop.",
      ),
      brief(
        "FBI to ShinyHunters: 'We know how to find you'",
        "The FBI's cyber chief has a message for the criminals that hacked the bureau's jobs portal last week: turn yourself in.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("holds the corpus floor: every fused pair shares an entity and three words", () => {
    // Ruling #18's constraint, frozen as a sample: `npm run audit:twin-corpus`
    // runs it over all 16,715 stored events of a 30-day window, and this pins the
    // invariant in the suite on five verbatim headlines that carry the widened
    // vocabulary, so loosening a marker group or the overlap test fails here even
    // where no database is reachable. Every pair the pass fuses has to share a
    // capitalised entity and three content words; a pair that shares less is a
    // story the reader would not see twice, which is the cost the ruling weighs.
    //
    // The delivered pair is in the sample (it must fuse). The two Plex
    // headlines are the control that keeps the sample from being all one story.
    const CORPUS = [
      "PSA: Patch your Plex media server before someone hacks it",
      "Hackers hit AI coding tool OpenCode, running up charges on users’ AI accounts",
      "Hackers Exploit Plex2Shell Flaws to Install Crypto Miners and Linux Proxy Backdoor",
      "A Chinese hacker used AI agents to break into more than 100 company websites",
      "A hacker broke into John Deere and SharkNinja with an army of AI agents",
    ];
    const stem = (word: string): string => {
      if (word.length <= 4) return word;
      if (word.endsWith("ing")) return word.slice(0, -3);
      if (word.endsWith("ed")) return word.slice(0, -2);
      if (word.endsWith("es")) return word.slice(0, -2);
      if (word.endsWith("s")) return word.slice(0, -1);
      return word;
    };
    const contentWords = (text: string): Set<string> =>
      new Set(
        text
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
          .map(stem),
      );
    const shared = (a: string, b: string): number => {
      const other = contentWords(b);
      return [...contentWords(a)].filter((word) => other.has(word)).length;
    };
    for (let i = 0; i < CORPUS.length; i += 1) {
      for (let j = i + 1; j < CORPUS.length; j += 1) {
        const a = CORPUS[i]!;
        const b = CORPUS[j]!;
        const pair = [brief(a, ""), brief(b, "")];
        if (suppressStoryTwins(pair).length !== 1) continue;
        const entity = [...capitalised(a)].some((word) => capitalised(b).has(word));
        expect(entity, `${a} || ${b} shares no capitalised entity`).toBe(true);
        expect(
          shared(a, b),
          `${a} || ${b} shares ${shared(a, b)} content words`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  /**
   * Pinned in the direction the ruling has not yet taken.
   *
   * The tightened floor in `twin-floor.test.ts` refuses this pair and the
   * delivery pass above still fuses it, on the *stored* rows: `Hackers` (the
   * first word of one headline, a Title Case capital in the other) plus
   * `hacker`, `exploit`, `flaw`, `server` and `day`, under the `security-access`
   * marker. Two stories lose a card. Changing the pass is a ruling, not an
   * implementer's call, so the two instruments are pinned pointing opposite ways
   * and this is the tripwire: the day the pass starts keeping both, this test
   * begins to fail and whoever fixed it flips `it.fails` to `it`.
   */
  it.fails("keeps the Plex2Shell and BeyondTrust stories apart", () => {
    const kept = suppressStoryTwins([
      brief(
        "Hackers Exploit Plex2Shell Flaws to Install Crypto Miners and Linux Proxy Backdoor",
        "Threat actors have begun to exploit a chain of vulnerabilities in Plex Media Server to deploy cryptocurrency miners and reverse proxy software, a day after a proof-of-concept (PoC) went public.",
      ),
      brief(
        "China-Linked Hackers Exploited BeyondTrust Zero-Day to Take Over Remote Support Servers",
        "The China-nexus cyber espionage group tracked as Armory Castle (previously UNC5221 or Warp Panda) exploited a newly disclosed security flaw in BeyondTrust Remote Support (formerly Bomgar) as a zero-day in late August 2026.",
      ),
    ]);
    expect(kept).toHaveLength(2);
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
    // The target is one token on purpose. "Beta Systems" is an adjacent
    // capitalised pair, so since 2026-10-17 that pair alone is what decides the
    // two titles are one story (decisions/story-twins.md) and this arm could no
    // longer be reached. A single-word target keeps the fixture testing the
    // marker loop rather than the new rule.
    const kept = suppressStoryTwins([
      brief("Acme completes takeover of Betacorp", "The deal closes next week."),
      brief("Acme completes purchase of Betacorp", "The transaction closes next week."),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("collapses three reviews of one product that announce no event", () => {
    // The 2026-10-17 reader's briefing, verbatim: three outlets, one laptop,
    // three cards in a seven-card brief. They share two content words and the
    // capitalised entities, but no event marker -- a review announces nothing --
    // so the marker test kept all three. "RTX Spark" adjacent in every title is
    // the name, and the name is the story (decision 2026-10-17).
    const kept = suppressStoryTwins([
      brief(
        "Benchmarked: Nvidia's RTX Spark notebook delivers serious local AI compute, at a price",
        "The laptop runs local models on a GB10 chip and is priced above the previous generation.",
      ),
      brief(
        "A week with RTX Spark: everything we've learned using Nvidia's new laptops",
        "After seven days of daily use, the battery and the fan noise are the two things worth reporting.",
      ),
      brief(
        "Microsoft Surface Laptop Ultra review: RTX Spark in a straight-up beautiful Windows laptop",
        "The Surface Laptop Ultra ships with the same chip and a higher-resolution display.",
      ),
    ]);
    expect(kept.map((b) => b.title)).toEqual([
      "Benchmarked: Nvidia's RTX Spark notebook delivers serious local AI compute, at a price",
    ]);
  });

  it("does not fuse two stories that share only a company name", () => {
    // One capitalised token is not a name pair. The arbiter's condition was two
    // adjacent tokens; a company alone stays what it always was -- an entity,
    // not a story.
    const kept = suppressStoryTwins([
      brief(
        "Microsoft raises Azure prices across Europe",
        "The increase takes effect in January for enterprise customers.",
      ),
      brief(
        "Microsoft opens a data centre outside Tokyo",
        "The site will serve customers in Japan from next spring.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("does not fuse two actors a title keeps apart", () => {
    // Trump and Iran are both capitalised in both titles and neither pair is
    // adjacent, which is the difference between a name and two facts.
    const kept = suppressStoryTwins([
      brief("Trump warns Iran over its nuclear programme", "The warning came after talks stalled."),
      brief("Iran rejects Trump's nuclear deal offer", "Tehran said the terms were unacceptable."),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("does not read a name out of a Title Case headline", () => {
    // When most words are capitalised, capitalisation says nothing about which
    // word is a name, so the pair signal is skipped -- the same threshold the
    // shortlist uses for its query tokens.
    const kept = suppressStoryTwins([
      brief("Nvidia DGX Spark Review Roundup", "The machine is fast and the software is early."),
      brief(
        "Nvidia DGX Spark Benchmarks Revealed",
        "The chip beats the previous model by a wide margin.",
      ),
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

describe("one story, one card (B-05, 2026-10-23)", () => {
  // Every fixture below is quoted from a delivered briefing — the title and the
  // stored `events.what_happened` of each card, in the order the briefing carried
  // it — because the defect was measured on delivered data, not invented. Each
  // pair was two `events` rows with one stored article each: the pipeline saw four
  // events where the reader saw two stories. Sources are named in the comments,
  // never in the fixture, so the pass is tested on what it is given.

  it("carries the 2026-10-21 GTC Berlin keynote once (cards #04 and #07)", () => {
    // blogs.nvidia.com against theregister.com. The first headline is Title Case,
    // so it offers no name of its own; the second proves `jensen huang` and the
    // first confirms those words side by side.
    const kept = suppressStoryTwins([
      brief(
        "GTC Berlin 2026: Live Updates From NVIDIA CEO Jensen Huang’s Keynote",
        "Here, journalists, analysts and partners have gathered for the main event: NVIDIA founder and CEO Jensen Huang’s keynote.",
      ),
      brief(
        "Jensen Huang sends in the robot ducks to sell Nvidia's AI-everywhere vision",
        "Cute robots stole the show at Nvidia's GTC keynote in Berlin, where Jensen Huang pitched a future powered by AI agents – and, naturally, plenty of his company's hardware.",
      ),
    ]);
    expect(kept.map((b) => b.title)).toEqual([
      "GTC Berlin 2026: Live Updates From NVIDIA CEO Jensen Huang’s Keynote",
    ]);
  });

  it("carries the 2026-10-21 PHP security release once (cards #06 and #09)", () => {
    // simonwillison.net against theverge.com: one says "Security Release" in the
    // headline, the other only the noun "vulnerabilities" in its summary.
    const kept = suppressStoryTwins([
      brief(
        "Today's PHP Security Release, and How We're Strengthening PHP Security",
        "August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.",
      ),
      brief(
        "PHP: The three letters that shut down sites all over the internet today",
        'The "critical vulnerabilities" were discovered in the PHP programming language, which underpins much of the internet, including any site built on WordPress.',
      ),
    ]);
    expect(kept.map((b) => b.title)).toEqual([
      "Today's PHP Security Release, and How We're Strengthening PHP Security",
    ]);
  });

  it("carries the same disclosure twice a day later as one card (cards #09 and #10)", () => {
    // The Register against Al Jazeera, the 2026-10-22 briefing. Same subject,
    // "bugs" on one side and "flaws" on the other, so no marker group could have
    // seen it and only two content words are shared.
    const kept = suppressStoryTwins([
      brief(
        "PHP blames supply chain security biz Chainguard for putting huge chunks of the web at risk",
        "PHP developers have accused software supply chain security shop Chainguard of effectively revealing critical bugs in the open-source scripting language ahead of a planned official disclosure.",
      ),
      brief(
        "World leaders warn of security flaws found in PHP programming language",
        "AI was used to pinpoint two vulnerabilities in the PHP language, used by about 70 percent of websites.",
      ),
    ]);
    expect(kept.map((b) => b.title)).toEqual([
      "PHP blames supply chain security biz Chainguard for putting huge chunks of the web at risk",
    ]);
  });

  it("reproduces the measured defect with B-05's legs off", () => {
    // The "before" column of the census, pinned: on the pass as it stood before
    // this change, every one of the three audited pairs is two cards. Without
    // this the after-numbers could be the tree's own doing rather than the legs'.
    const pairs = [
      [
        brief(
          "GTC Berlin 2026: Live Updates From NVIDIA CEO Jensen Huang’s Keynote",
          "Here, journalists, analysts and partners have gathered for the main event: NVIDIA founder and CEO Jensen Huang’s keynote.",
        ),
        brief(
          "Jensen Huang sends in the robot ducks to sell Nvidia's AI-everywhere vision",
          "Cute robots stole the show at Nvidia's GTC keynote in Berlin, where Jensen Huang pitched a future powered by AI agents – and, naturally, plenty of his company's hardware.",
        ),
      ],
      [
        brief(
          "Today's PHP Security Release, and How We're Strengthening PHP Security",
          "August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.",
        ),
        brief(
          "PHP: The three letters that shut down sites all over the internet today",
          'The "critical vulnerabilities" were discovered in the PHP programming language, which underpins much of the internet, including any site built on WordPress.',
        ),
      ],
      [
        brief(
          "PHP blames supply chain security biz Chainguard for putting huge chunks of the web at risk",
          "PHP developers have accused software supply chain security shop Chainguard of effectively revealing critical bugs in the open-source scripting language ahead of a planned official disclosure.",
        ),
        brief(
          "World leaders warn of security flaws found in PHP programming language",
          "AI was used to pinpoint two vulnerabilities in the PHP language, used by about 70 percent of websites.",
        ),
      ],
    ];
    for (const pair of pairs) {
      expect(suppressStoryTwins(pair, { b05Rules: false })).toHaveLength(2);
    }
  });

  it("keeps two publishers on one story to one card, not two", () => {
    // The acceptance in the opposite direction: the same story from two outlets is
    // one card. Neither pair above is one publisher repeating itself — each is two
    // newsrooms — so the pass must read a second telling as a second telling.
    const kept = suppressStoryTwins([
      brief(
        "GTC Berlin 2026: Live Updates From NVIDIA CEO Jensen Huang’s Keynote",
        "Here, journalists, analysts and partners have gathered for the main event: NVIDIA founder and CEO Jensen Huang’s keynote.",
      ),
      brief(
        "Jensen Huang sends in the robot ducks to sell Nvidia's AI-everywhere vision",
        "Cute robots stole the show at Nvidia's GTC keynote in Berlin.",
      ),
      brief(
        "Nvidia woos wary Europeans with sovereign AI pitch at Berlin summit",
        "The company argued that governments want control over their own models.",
      ),
    ]);
    expect(kept.map((b) => b.title)).toEqual([
      "GTC Berlin 2026: Live Updates From NVIDIA CEO Jensen Huang’s Keynote",
      "Nvidia woos wary Europeans with sovereign AI pitch at Berlin summit",
    ]);
  });

  it("keeps two developments on one subject apart", () => {
    // The 2026-10-21 briefing carried both of these and both belong: Terafab's
    // suppliers moving, and a merger under discussion. One actor, two stories.
    const kept = suppressStoryTwins([
      brief(
        "ASML and other critical semiconductor equipment suppliers expedite shipments to Musk's Terafab",
        "Elon Musk says ASML and other critical semiconductor equipment suppliers have expedited shipments for the ambitious Terafab semiconductor manufacturing facility, supporting his aggressive timeline for the joint megaproject between Tesla and SpaceX.",
      ),
      brief(
        "Musk confirms SpaceX and Tesla exploring merger",
        "Elon Musk says SpaceX and Tesla are considering a merger that would form a $3.5 trillion mega company.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("keeps the next day of a saga apart", () => {
    // Stored in `events`, both about PHP2Shell: the emergency release, and the
    // day-two card that announces *another* way in. Same subject, same
    // disclosure vocabulary, same PRIMARY — and a new development, which the
    // task's third condition says is two cards. Without the headline guard the
    // disclosure leg fuses this pair, and a reader loses the follow-up.
    const kept = suppressStoryTwins([
      brief(
        "PHP2Shell: Two Unpatched Critical PHP RCE Flaws (CVSS 9.2) Trigger Emergency Security Alert",
        "PHP will ship an out-of-cycle security release at 14:00 UTC today, October 21, for two critical vulnerabilities that its security team has rated 9.2 on the CVSS v4.0 scale but has not described.",
      ),
      brief(
        "URGENT - PHP Warns of Another Unpatched RCE Two Days After Emergency PHP2Shell Patches",
        "PHP has warned of another way an attacker could run code on a web server, two days after it shipped emergency fixes for the critical PHP2Shell flaws.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("keeps two different vendors' disclosures apart", () => {
    // Both sides are vendor disclosures, so the B-05 vocabulary leg sees them;
    // neither headline names the other's subject, and the two PRIMARY actors —
    // curl and Siemens — are different. Delivered in the 2026-10-20 briefing
    // (cards #01 and #07) and kept apart by both passes, so the anti-fusion
    // direction is measured on delivered data, not asserted from taste.
    const kept = suppressStoryTwins([
      brief(
        "Swamped curl maintainers take low-level flaws public to survive vulnerability 'avalanche'",
        'An "avalanche of vulnerability reports" is forcing curl to move lower-severity cases into public view, reserving private handling for high and critical flaws.',
      ),
      brief(
        "ClickFix Attackers Exploit Siemens Software Center Flaw to Deploy Remote Access Trojan",
        "Siemens has addressed a DLL sideloading vulnerability impacting Siemens Software Center that it said has been exploited in ClickFix attacks.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("does not fuse two Title Case round-ups that share furniture", () => {
    // Why the conference words are not a marker group: `keynote` alone fused these
    // two, because both headlines are Title Case (so both said "Live Updates") and
    // both bodies mention a keynote. Their people are different, so the name leg
    // has nothing to work with.
    const kept = suppressStoryTwins([
      brief(
        "GTC Berlin 2026: Live Updates From NVIDIA CEO Jensen Huang’s Keynote",
        "Here, journalists, analysts and partners have gathered for the main event: NVIDIA founder and CEO Jensen Huang’s keynote.",
      ),
      brief(
        "NDTV World Summit 2026 LIVE Updates: German, Italian, Australian And EU Envoys Decode The New Transatlantic Order",
        "Envoys from four governments spoke in the opening keynote session about trade and defence.",
      ),
    ]);
    expect(kept).toHaveLength(2);
  });
});
