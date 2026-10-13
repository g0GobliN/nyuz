import { describe, expect, it } from "vitest";
import { composeFromSources } from "../editorial";
import { assessReadiness, marketingShape } from "./readiness";

/**
 * The 2026-09-30 briefing carried 25 stories; 6 were not news for a reader.
 * Each bad shape below is one of them, quoted or near-quoted. Each good shape
 * is a real story from the same day that must keep shipping — most importantly
 * the thin ones, because a gate that drops short real news trades visible junk
 * for invisible misses.
 */
describe("assessReadiness", () => {
  it("refuses a vendor benefit pitch from a company blog", () => {
    // Cloudflare blog, 2026-10-02. A feature advert aimed at the reader's own
    // spend; the "your X" possessive is what no third-party report carries.
    // `sourceKinds` is the precondition, not decoration: since the arbiter's
    // ruling of 2026-10-11 (D5, option (a)) a marketing shape only refuses when
    // the coverage says the publisher was speaking for itself, and this test is
    // about a benefit pitch *from a company blog*.
    const verdict = assessReadiness({
      title: "Cut your AI spend with AI Gateway's Auto Router",
      whatHappened:
        "The router picks the cheapest model that can serve each request automatically.",
      sourceCount: 1,
      sourceKinds: ["company_blog"],
    });
    expect(verdict.ready).toBe(false);
    if (!verdict.ready) expect(verdict.kind).toBe("marketing");
  });

  it("refuses a first-party post that addresses the reader's own work or data", () => {
    // Cloudflare's Pay Per Use launch and an AWS product update. Both are the
    // vendor talking to the reader about the reader's material, which a
    // third-party report of the same change would not do.
    for (const title of [
      "Pay Per Use: when AI uses your work, you should get paid",
      "Amazon Aurora PostgreSQL now supports direct querying of Apache Iceberg data in your data lake",
    ]) {
      const verdict = assessReadiness({
        title,
        whatHappened: "The feature is available in public beta for existing customers today.",
        sourceCount: 1,
        sourceKinds: ["company_blog"],
      });
      expect(verdict.ready, title).toBe(false);
      if (!verdict.ready) expect(verdict.kind, title).toBe("marketing");
    }
  });

  it("still allows third-party reporting that mentions a reader benefit", () => {
    const verdict = assessReadiness({
      title: "Cloudflare says Auto Router cuts AI costs for enterprise customers",
      whatHappened: "Early adopters reported double-digit reductions in inference spend.",
      sourceCount: 1,
    });
    expect(verdict.ready).toBe(true);
  });
  it("drops the empty Google Research item", () => {
    expect(
      assessReadiness({
        title: "How Diffusion Controller unifies and simplifies AI image generation",
        whatHappened: "",
      }),
    ).toEqual({ ready: false, kind: "empty", reason: expect.any(String) });
  });

  it("drops the llama.cpp build number and its commit-message summary", () => {
    expect(assessReadiness({ title: "b11243", whatHappened: "Some body text here." }).ready).toBe(
      false,
    );
    expect(
      assessReadiness({
        title: "llama.cpp release",
        whatHappened:
          "Ci: update the oneAPI toolkit to 2026.1 (#29273) oneDNN is removed from Intel Deep Learning Essentials.",
      }),
    ).toEqual({ ready: false, kind: "commit-message", reason: expect.any(String) });
  });

  it("drops a single-source preprint or code release from the briefing", () => {
    // Operator decision, 2026-10-08: six of the day's twenty-five shippable
    // items were single-source arXiv preprints and one was a GitHub release.
    // They stay in the feed and in history; they stop being briefing items.
    for (const item of [
      {
        title: "RAISED: Self-Distillation for Robustness to Prompt Injection in LLM Agents",
        whatHappened:
          "Prompt injection defenses degrade when an agent is fine-tuned on its own outputs.",
        sourceKinds: ["research"],
      },
      {
        title: "b11488: model : add LiquidAI/d1-omni-600M decision model (#30114)",
        whatHappened: "Adds a new omni model entry to the supported model list.",
        sourceKinds: ["github"],
      },
    ]) {
      const verdict = assessReadiness({ ...item, sourceCount: 1 });
      expect(verdict.ready, item.title).toBe(false);
      if (!verdict.ready) expect(verdict.kind, item.title).toBe("primary-source");
    }
  });

  it("keeps primary-source material once a second outlet corroborates it", () => {
    // The same rules as every other shape: the class is not a veto on the
    // subject, only on the lone document. And a news feed is never the class,
    // whatever the title looks like.
    expect(
      assessReadiness({
        title: "RAISED: Self-Distillation for Robustness to Prompt Injection in LLM Agents",
        whatHappened:
          "Prompt injection defenses degrade when an agent is fine-tuned on its own outputs.",
        sourceCount: 2,
        sourceKinds: ["research"],
      }).ready,
    ).toBe(true);
    expect(
      assessReadiness({
        title: "arXiv preprint on prompt-injection defenses draws scrutiny",
        whatHappened: "Researchers questioned the benchmark after the paper circulated this week.",
        sourceCount: 1,
        sourceKinds: ["news", "research"],
      }).ready,
    ).toBe(true);
    expect(
      assessReadiness({
        title: "Hugging Face ships a smaller vision encoder for on-device use",
        whatHappened: "The model runs inside a browser tab without a server round trip.",
        sourceCount: 1,
        sourceKinds: ["company_blog"],
      }).ready,
    ).toBe(true);
  });

  it("skips the primary-source rung when the caller has not loaded feeds", () => {
    // Same contract as the briefability rung: absent input skips the rung
    // rather than guessing at it.
    expect(
      assessReadiness({
        title: "Training Advisors for LLM Agents from Task Outcomes",
        whatHappened: "The method trains a smaller advisor model against task outcomes.",
        sourceCount: 1,
      }).ready,
    ).toBe(true);
  });

  it("drops the byline standing in for a summary", () => {
    expect(
      assessReadiness({
        title: "Driving growth on Google Play: The next era of subscriptions",
        whatHappened: "Posted by Sheenam Mittal, Senior Product Manager, Google Play.",
      }),
    ).toEqual({ ready: false, kind: "byline", reason: expect.any(String) });
  });

  it("drops the transcript cue standing in for a summary", () => {
    // Live 2026-10-13: a podcast episode's show notes reached the feed —
    // speaker, media timestamp and host chatter where the news should be.
    expect(
      assessReadiness({
        title: "Imagine there’s no Shiny Hunters – AI could make human hacking crews obsolete",
        whatHappened:
          "Brandon (00:29) So Jess, let’s start with the FBI’s continuing crusade against who seems to be its new arch nemesis, the Shiny Hunters cyber extortion crew.",
        sourceCount: 1,
      }),
    ).toEqual({ ready: false, kind: "transcript", reason: expect.any(String) });
  });

  it("keeps a real summary that merely mentions a clock time", () => {
    // The transcript rung fires on a speaker cue plus a media timestamp at
    // the opening — not on any clock time anywhere in the text.
    expect(
      assessReadiness({
        title: "Council approves night-bus extension",
        whatHappened:
          "The council approved the night-bus extension after a briefing (10:30) ended early and the vote moved without debate.",
        sourceCount: 1,
      }).ready,
    ).toBe(true);
  });

  it("drops the roundup container announcing itself, not the news", () => {
    // Live 2026-10-13: a "This week on … Premium" recap shelf reached the
    // feed — the container, not an event in the world.
    expect(
      assessReadiness({
        title:
          "This week on Tom’s Hardware Premium: September 19, 2026 — Steam Frame interview, killer AI models, and the DRAM crisis deepens",
        whatHappened:
          "Valve Steam Frame interview — why it costs up to $1,300, Snapdragon power, and 10x foveated streaming.",
        sourceCount: 1,
      }),
    ).toEqual({ ready: false, kind: "newsletter", reason: expect.any(String) });
  });

  it("drops newsletter containers and coming-soon announcements", () => {
    expect(
      assessReadiness({
        title: "The Download: climate tech companies to watch and AI's discovery problem",
        whatHappened: "With the planet nearing 1.5 °C of warming, doom and defeatism tempt.",
      }).ready,
    ).toBe(false);
    expect(
      assessReadiness({
        title: "Coming soon: Our 2026 list of Climate Tech Companies to Watch",
        whatHappened: "Big Tech is backpedaling on its climate ambitions as data centers grow.",
      }),
    ).toEqual({ ready: false, kind: "newsletter", reason: expect.any(String) });
  });

  it("drops the Newegg price promotion", () => {
    expect(
      assessReadiness({
        title:
          "Grab this 4K-ready gaming PC with a 7800X3D and RTX 5070 for under $2,000 right now, saving you $170",
        whatHappened: "Specs like this are rare to find in a PC for under $2,000 in this market.",
      }),
    ).toEqual({ ready: false, kind: "commerce", reason: expect.any(String) });
  });

  it("keeps thin-but-real launch news", () => {
    // 71 characters. The biggest story of the day; thinness is handled
    // downstream by depth widening, never by dropping.
    expect(
      assessReadiness({
        title: "OpenAI launches Dots, its Muse competitor",
        whatHappened: "Like Muse, OpenAI's Dots are represented by cute, customizable avatars.",
      }),
    ).toEqual({ ready: true });
    expect(
      assessReadiness({
        title: "OpenAI DevDay 2026: The biggest news and announcements",
        whatHappened: "OpenAI's DevDay 2026 has a date.",
      }),
    ).toEqual({ ready: true });
  });

  it("keeps money stories that merely mention a dollar amount", () => {
    expect(
      assessReadiness({
        title: "AMD bets $8.2B that worlds matter more than words in AI",
        whatHappened:
          "AMD dove deeper into AI model development with an agreement to acquire World Labs.",
      }),
    ).toEqual({ ready: true });
    expect(
      assessReadiness({
        title: "HMRC bets up to £2.4B on Salesforce for taxpayer CRM overhaul",
        whatHappened: "Salesforce has won a contract worth up to £2.4 billion including VAT.",
      }),
    ).toEqual({ ready: true });
    // 2026-10-09: `deal` sat in COMMERCE_VERBS, so money plus that one noun
    // refused this real acquisition report. The arbiter's ruling the same day:
    // no single generic noun rejects an article — the combination does.
    expect(
      assessReadiness({
        title: "TSMC taps GlobalFoundries to bolster US silicon interposer production in $2B deal",
        whatHappened: "The companies said the agreement expands domestic packaging capacity.",
      }),
    ).toEqual({ ready: true });
  });

  it("keeps ordinary reporting", () => {
    expect(
      assessReadiness({
        title: "Intel patent embeds MicroLEDs in chip packaging",
        whatHappened: "At ECTC in May, Intel showcased a 24-layer glass-core panel.",
      }),
    ).toEqual({ ready: true });
  });

  it("drops a sale that forgot its price tag", () => {
    expect(
      assessReadiness({
        title: "The best early October Prime Day deals happening now",
        whatHappened: "Discounts on laptops, headphones and smart home gear are live for October.",
      }),
    ).toEqual({ ready: false, kind: "commerce", reason: expect.any(String) });
  });

  it("drops the 2026-10-09 shopping pair, which carry no sales verb", () => {
    // Both shipped in the 07:30 JST briefing of 2026-10-09. The first prices
    // its subject as a rate ("10 cents per gigabyte") instead of an amount;
    // the second is a shop's shelf banner whose verbs — "secure", "starting
    // at" — were deliberately kept out of COMMERCE_VERBS. Each is refused by
    // a combination, not by any single word in it.
    expect(
      assessReadiness({
        title: "This is the cheapest 4TB SSD for Prime Day at only 10 cents per gigabyte",
        whatHappened:
          "The Teamgroup T-Force G50 Evo is a 4 TB drive with a PCIe 4.0 NVMe interface.",
      }),
    ).toEqual({ ready: false, kind: "commerce", reason: expect.any(String) });
    expect(
      assessReadiness({
        title:
          "Pre-orders are live on Nvidia RTX Spark devices, secure the Surface Laptop Ultra or other RTX Spark laptops here — starting at $2,599",
        whatHappened: "Best Buy has a limited lineup of devices to start.",
      }),
    ).toEqual({ ready: false, kind: "commerce", reason: expect.any(String) });
  });

  it("drops shopping-event listings without touching the event reported as news", () => {
    for (const title of [
      "Best 4TB SSD deals for Prime Day",
      "The cheapest RTX Spark deal you can buy today",
      "Save 40% on every AI subscription this week",
    ]) {
      const verdict = assessReadiness({ title, whatHappened: "Prices are live for the week." });
      expect(verdict.ready, title).toBe(false);
      if (!verdict.ready) expect(verdict.kind, title).toBe("commerce");
    }

    // The arbiter's keep cases from the same 2026-10-09 ruling, quoted: a
    // launch and a reported price cut are news, and the combinations above
    // only reject when the shelf is the subject, not when a product event is.
    for (const title of [
      "Nvidia RTX Spark launches with a $2,599 price",
      "The company cuts the RTX Spark price to $2,599",
      "Review: the $2,599 RTX Spark delivers on its promises",
    ]) {
      expect(
        assessReadiness({ title, whatHappened: "The device ships this month." }).ready,
        title,
      ).toBe(true);
    }

    // A promotion someone else is reporting is news about the promotion; the
    // news verb is what separates the two.
    expect(
      assessReadiness({
        title: "Amazon sued over Prime Day discounts",
        whatHappened: "A consumer group filed the suit in Washington state court.",
      }).ready,
    ).toBe(true);

    // The same shape, and the 2026-10-09 pool measured it both ways: the act
    // leads in the news title, while the shopping list's only news word —
    // "Picks" — sits in its trailer, so the event stays the listing's subject.
    expect(
      assessReadiness({
        title: "The Best Early Amazon Prime Day Deals 2026: WIRED-Tested Picks to Shop Now",
        whatHappened: "Our editors found the best discounts on laptops and headphones.",
      }).ready,
    ).toBe(false);

    // A comparison that is not shopping keeps its place, and a revenue story
    // wears "sales" — which the promo class deliberately excludes.
    expect(
      assessReadiness({
        title: "The cheapest way to run a 70B model on one GPU",
        whatHappened: "Benchmarks compare quantised inference across three accelerators.",
      }).ready,
    ).toBe(true);
    expect(
      assessReadiness({
        title: "Prime Day sales top $14B as shoppers front-load holiday spend",
        whatHappened: "Adobe said online spending rose 8.4% over the two-day event.",
      }).ready,
    ).toBe(true);
  });

  it("drops a title that announces a quotation instead of an event", () => {
    expect(
      assessReadiness({
        title: "Quoting Anthropic Frontier Red Team",
        whatHappened: "A single sentence lifted from a post by the team's own account.",
      }),
    ).toEqual({ ready: false, kind: "quote", reason: expect.any(String) });
  });

  it.each([
    ["Introducing Threat Signals: agentic skills for open-source threat intelligence"],
    ["Enforce positive security with Cloudflare Application Profiles"],
    ["Adaptive application security for the AI era: how Cloudflare connects controls"],
    ["We tested our own WAF with frontier AI models. Here's what we found"],
  ])("drops the vendor promotion %s", (title) => {
    expect(
      assessReadiness({
        title,
        whatHappened:
          "The vendor describes its own product in the first person and links to a trial.",
        sourceKinds: ["company_blog"],
      }),
    ).toEqual({ ready: false, kind: "marketing", reason: expect.any(String) });
  });

  it("keeps a product announcement other outlets also reported", () => {
    expect(
      assessReadiness({
        title: "Introducing Threat Signals: agentic skills for threat intelligence",
        whatHappened: "The vendor released a new capability, and two outlets covered it.",
        sourceCount: 3,
      }),
    ).toEqual({ ready: true });
  });

  it("keeps a headline that merely starts with a verb a promo would use", () => {
    expect(
      assessReadiness({
        title: "Scale AI raises $200M as demand for evaluation grows",
        whatHappened: "The funding round values the company at $5 billion, investors said.",
      }),
    ).toEqual({ ready: true });
    expect(
      assessReadiness({
        title: "OpenAI DevDay 2026: The biggest news and announcements",
        whatHappened: "Explore more than 20 announcements from OpenAI DevDay 2026.",
      }),
    ).toEqual({ ready: true });
  });
});

/**
 * The briefability contract, measured over 200 live events on 2026-10-03.
 *
 * The audit counted 76 of 200 stories composing no paragraph at all, which read
 * as a 39% product failure. Re-running the same corpus *through the existing
 * readiness gate first* moved the number to 35 of the 134 that would actually
 * ship — the other 41 were already refused, mostly live-blog entries whose only
 * coverage is a photo credit. So the defect is real but a quarter the size the
 * raw count suggests, and the fix belongs at selection rather than in the
 * composer.
 *
 * The predicate is a count of facts the evidence pass accepts, and the count
 * that matters is two: the lead fact is spent on the deck, so a story with one
 * accepted fact has a deck and nothing else. Every case below is quoted from the
 * corpus, including the four that were the closest calls.
 */
describe("assessReadiness — briefability", () => {
  it("refuses a story no fact can open, rather than showing an unresolved opening", () => {
    // The arbiter's deck-opening ruling of 2026-10-10. A deck has no block before
    // it, so its opening has to stand on its own: the composer will not lead with
    // a reference the page never establishes, and it walks the ranked facts for
    // one that can open the story. Here none can -- and the stored summary is held
    // to the same test -- so the article has no deck at all.
    //
    // The production case was 'Pure insanity': Mathematicians will need years to
    // make sense of OpenAI's latest drop, whose deck read "Those were among the
    // descriptions more than three dozen mathematicians reached for ..." while no
    // page the reader had contained a single description.
    const verdict = assessReadiness({
      title: "OpenAI drops a flood of mathematical results",
      whatHappened: "Those were among the descriptions mathematicians reached for this week.",
      sourceCount: 1,
      sources: [
        {
          name: "The Verge",
          excerpt:
            "Those were among the descriptions mathematicians reached for in conversations this week. This changes how the field reads every result.",
        },
      ],
    });
    expect(verdict).toEqual({
      ready: false,
      kind: "unbriefable",
      reason: expect.stringContaining("published no deck"),
    });
  });

  it("refuses a story whose evidence yields one fact, which is only a deck", () => {
    // Reuters, via the 2026-10-03 corpus. A single-sentence excerpt: real news,
    // correctly summarised, and enough for the deck. There is no second fact,
    // so the Read page would render a title, a deck and no article.
    const verdict = assessReadiness({
      title: "DoorDash launches an AI agent you can text to order food",
      whatHappened: "DoorDash launched an AI agent you can text to order food.",
      sourceCount: 1,
      sources: [
        {
          name: "Reuters",
          excerpt: "DoorDash launched an AI agent you can text to order food.",
        },
      ],
    });
    expect(verdict).toEqual({
      ready: false,
      kind: "unbriefable",
      reason: expect.any(String),
    });
  });

  it("keeps a story with two accepted facts, however short each one is", () => {
    // The same shape, one sentence longer. Nothing about the second sentence is
    // better prose than the first; there is simply something for the body to
    // be made of, which is the whole contract.
    const verdict = assessReadiness({
      title: "UK-France 'one in, one out' migrant scheme scrapped",
      whatHappened: "The government has scrapped the one-in, one-out migrant scheme.",
      sourceCount: 1,
      sources: [
        {
          name: "Reuters",
          excerpt:
            "The government has scrapped the one-in, one-out migrant scheme. Ministers said the pilot had cost too much and returned too few results.",
        },
      ],
    });
    expect(verdict).toEqual({ ready: true });
  });

  it("refuses a story whose only coverage is a photo credit", () => {
    // 18 of the 35 empty stories were live-blog entries carrying exactly this:
    // a Guardian or BBC photo caption as the entire excerpt, and an empty
    // summary. The 20-character summary rung cannot see them, because there is
    // no summary -- the gap this closes.
    const verdict = assessReadiness({
      title: "Eastern Spain braces for torrential rain and flooding",
      whatHappened: "Heavy rain is forecast to bring flooding across eastern Spain this week.",
      sourceCount: 1,
      sources: [{ name: "The Guardian", excerpt: "Photograph: Josep Lago/AFP/Getty Images" }],
    });
    expect(verdict).toEqual({
      ready: false,
      kind: "unbriefable",
      reason: expect.any(String),
    });
  });

  it("counts accepted facts, not sentences the composer would go on to refuse", () => {
    // The 16 stories with several sentences and one accepted fact. The extra
    // sentences are a publisher solicitation and a newsletter sign-off, so a
    // rule that counted sentences would admit this and the composer would
    // still publish no body. Counting what survived is the only version of this
    // that cannot be wrong.
    const verdict = assessReadiness({
      title: "The ugly economics of consumer AI",
      whatHappened: "Consumer AI services cost more to run than the subscriptions charge.",
      sourceCount: 1,
      sources: [
        {
          name: "The Verge",
          excerpt:
            "Consumer AI services cost more to run than the subscriptions charge. Subscribe to The Verge for more.",
        },
      ],
    });
    expect(verdict).toEqual({
      ready: false,
      kind: "unbriefable",
      reason: expect.any(String),
    });
  });

  it("leaves a caller that has not loaded coverage to the other rungs", () => {
    // `briefing-preview.ts` and the digest tests call the gate without
    // coverage. Skipping the rung is the honest answer there; refusing every
    // story for material the caller never fetched would be a gate that
    // measures the caller's laziness.
    expect(
      assessReadiness({
        title: "Intel patent embeds MicroLEDs in chip packaging",
        whatHappened: "At ECTC in May, Intel showcased a 24-layer glass-core panel.",
      }),
    ).toEqual({ ready: true });
  });

  it("reports the more specific reason when a story fails both rungs", () => {
    // The marketing rungs run first, so a vendor advert that also has no body
    // is withheld as marketing. An operator reading the withheld note learns
    // what to fix about the source, not merely that it was thin.
    expect(
      assessReadiness({
        title: "Cut your AI spend with AI Gateway's Auto Router",
        whatHappened: "The router picks the cheapest model for each request.",
        sourceCount: 1,
        sourceKinds: ["company_blog"],
        sources: [{ name: "Cloudflare", excerpt: "The router picks the cheapest model." }],
      }),
    ).toEqual({ ready: false, kind: "marketing", reason: expect.any(String) });
  });
});

/**
 * Readability is the coverage's question, not the summary's (2026-10-10).
 *
 * The frozen 200-event corpus measured the rung this replaces: 26 stories whose
 * `what_happened` was never written but whose own coverage composes 3-6
 * paragraphs were withheld as "unreadable" — 13% of the corpus, invisible to
 * the reader. The arbiter's ruling draws the line at whether the caller loaded
 * coverage at all, and demands the distinction between *no* evidence and an
 * explicitly empty list be tested rather than assumed.
 */
describe("assessReadiness — the summary rung and the evidence", () => {
  it("keeps a story with no summary whose own coverage composes a body", () => {
    // The shape of eight of the 26: a Guardian event whose summary was never
    // written, and whose first two paragraphs carry the story (FDNY, the nine
    // treated, the woman pronounced dead at Jacobi).
    expect(
      assessReadiness({
        title: "One person killed and nine injured in chain-reaction crash in New York City",
        whatHappened: "",
        sourceCount: 1,
        sources: [
          {
            name: "The Guardian",
            excerpt:
              "The New York fire department said emergency crews treated nine people after the crash. One woman was pronounced dead at Jacobi medical center.",
          },
        ],
      }),
    ).toEqual({ ready: true });
  });

  it("refuses on the summary when the caller has loaded no coverage", () => {
    // Unchanged behaviour, and the reason the rung stays: this caller cannot
    // answer the readability question any other way.
    expect(
      assessReadiness({ title: "Parties prepare for a byelection", whatHappened: "" }),
    ).toEqual({ ready: false, kind: "empty", reason: "summary below 20 characters" });
  });

  it("reads an explicitly empty source list as evidence that there is nothing to read", () => {
    // Not the same case as an absent list. A caller that loaded the coverage and
    // found none has established that the story has no body, and must not fall
    // back to the summary rung — which would report "unreadable" for a reason
    // the caller already disproved.
    expect(
      assessReadiness({
        title: "Two Latvians arrested at RAF base",
        whatHappened: "",
        sources: [],
      }),
    ).toEqual({ ready: false, kind: "unbriefable", reason: expect.any(String) });
  });

  it("still withholds a story whose coverage cannot make a body", () => {
    // The other 22 of the 44: the refusal moves from the summary rung to the
    // evidence rung, and the reader's outcome is the same — no card.
    expect(
      assessReadiness({
        title: "Ed Davey faces growing revolt against leadership",
        whatHappened: "",
        sourceCount: 1,
        sources: [{ name: "The Guardian", excerpt: "Photograph: Dan Kitwood/Getty Images" }],
      }),
    ).toEqual({ ready: false, kind: "unbriefable", reason: expect.any(String) });
  });

  it("refuses a story that passes the fact floor and publishes no paragraph", () => {
    // The delivery breach of 2026-10-10, on the live corpus, and the arbiter's
    // hard condition: paragraph publication is a readiness condition regardless
    // of the selected fact count. Three facts are accepted here, the composer
    // then refuses both non-deck sentences as `stacked_quotes`, and the reader
    // would have received a headline, a 31-word deck and no article.
    //
    // This is the test that must fail against the old behaviour: the premise
    // below (>= 2 accepted facts, 0 paragraphs) is exactly what the old
    // fact-count rung admitted.
    const title = "Microsoft barred from sponsoring foreign workers for US residency";
    const sources = [
      {
        name: "Ars Technica",
        headline: title,
        excerpt:
          "Donald Trump’s administration has temporarily banned Microsoft, Adobe, and several other tech companies from sponsoring workers for permanent US residency, claiming they abused immigration programs at the expense of American citizens. Vice-president JD Vance said on Thursday that the H-1B visa programme for highly skilled foreign workers had “become rife with fraud” and that over-reliance on such schemes was “a fundamental insult to the American worker.” He added that “no company in the US” had “abused this system” more than Microsoft. Read full article. Comments",
      },
    ];

    const { article, selectedFacts, refusedFacts } = composeFromSources(title, sources);
    expect(selectedFacts).toBeGreaterThanOrEqual(2);
    expect(article.paragraphs).toHaveLength(0);
    expect(refusedFacts).toBeGreaterThan(0);

    expect(assessReadiness({ title, whatHappened: "", sourceCount: 1, sources })).toEqual({
      ready: false,
      kind: "unbriefable",
      reason: expect.stringContaining("the composer refused the body"),
    });
  });

  it("allows a deck-only candidate the floor admits, because nothing was refused", () => {
    // The arbiter's clarification of D1: "no paragraph, no briefing" is too
    // broad. A composition with a single usable fact publishes its deck and
    // refuses nothing -- an allowed deck-only outcome, which the existing floor
    // governs and this condition must not override. Only a body that existed and
    // was refused (above), or an emptiness no rule explains, fails readiness.
    const title = "OpenAI ships a reasoning model";
    const sources = [
      {
        name: "The Verge",
        headline: title,
        excerpt:
          "OpenAI released a reasoning model this morning, published alongside API documentation and a pricing page. The lab said the model is available to existing customers today.",
      },
    ];

    const { article, selectedFacts, refusedFacts } = composeFromSources(title, sources);
    // The floor is met on the evidence count (2), the composition has one
    // usable fact, and nothing was refused: this is the deck-only shape exactly.
    expect(selectedFacts).toBe(1);
    expect(refusedFacts).toBe(0);
    expect(article.paragraphs).toHaveLength(0);
    expect(assessReadiness({ title, whatHappened: "", sourceCount: 1, sources })).toEqual({
      ready: true,
    });
  });

  it("leaves the deck-only contract to the fact floor, not to the paragraph condition", () => {
    // Arbiter's ruling, criterion 3: a one-fact story intentionally eligible for
    // deck-only publication is not a defect and is not refused by the new
    // condition — it is refused by the floor that has always refused it, and the
    // reason says which. A reader outcome that is identical for two different
    // reasons is how a rule stops being readable.
    const title = "Valve confirms Steam Machine pricing for the holiday season";
    const sources = [
      {
        name: "The Verge",
        excerpt: "Valve confirmed the Steam Machine will cost $549 when it ships in December.",
      },
    ];

    const { article, selectedFacts } = composeFromSources(title, sources);
    expect(selectedFacts).toBeLessThan(2);
    expect(article.paragraphs).toHaveLength(0);

    expect(assessReadiness({ title, whatHappened: "", sourceCount: 1, sources })).toEqual({
      ready: false,
      kind: "unbriefable",
      reason: `${selectedFacts} accepted fact(s); a body needs 2`,
    });
  });

  it("still admits a story the composer turns into a real body", () => {
    // The over-withholding guard. The new condition may only refuse stories the
    // composer cannot publish; a normal two-sentence story must keep shipping.
    const title = "Nvidia agrees to acquire Hugging Face for $13 billion";
    const sources = [
      {
        name: "Reuters",
        excerpt:
          "Nvidia announced Monday it has agreed to acquire Hugging Face for $13 billion in cash and stock. The deal is expected to close in the first quarter, pending regulatory approval.",
      },
      {
        name: "Bloomberg",
        excerpt:
          "The purchase price represents a 40% premium over Hugging Face's last private valuation. Both boards have approved the transaction.",
      },
    ];

    const { article } = composeFromSources(title, sources);
    expect(article.paragraphs.length).toBeGreaterThan(0);
    expect(assessReadiness({ title, whatHappened: "", sourceCount: 2, sources })).toEqual({
      ready: true,
    });
  });

  it("composes with the event's date, so an anchored fact is not lost", () => {
    // The audit caught this the moment the gate started composing: this story's
    // only body fact carries a relative time ("this year"), which the composer
    // anchors to the event's date. Composed without the date it is refused, the
    // deck is all that is left, and the gate withholds a story the reader's page
    // publishes -- over-withholding, which is invisible to the reader and was
    // 19 -> 20 on the frozen corpus before this was fixed.
    const title = "Why American investors love European defense startups";
    const sources = [
      {
        name: "NPR News",
        headline: title,
        excerpt:
          "As European defense spending takes off, just about half of the funding in Europe's defense tech industry is coming from American investors this year. One reason why: European investment firms have restrictions on how they can invest.",
      },
    ];

    const dated = composeFromSources(title, sources, {
      publishedAt: "2026-10-09T11:00:00+00:00",
    });
    expect(dated.article.paragraphs.length).toBeGreaterThan(0);
    expect(
      assessReadiness({
        title,
        whatHappened: "",
        sourceCount: 1,
        sources,
        publishedAt: "2026-10-09T11:00:00+00:00",
      }),
    ).toEqual({ ready: true });

    // Without the clock the same story degrades to its deck: still a publishable
    // deck-only outcome, so still ready, but the body the reader's page
    // publishes is gone. That difference -- an article versus a deck -- is why
    // the date is an input to the gate rather than decoration.
    const undated = composeFromSources(title, sources);
    expect(undated.article.paragraphs).toHaveLength(0);
    expect(assessReadiness({ title, whatHappened: "", sourceCount: 1, sources })).toEqual({
      ready: true,
    });
  });

  it("withholds an event promotion whose incentive carries a deadline", () => {
    // 2026-10-10 pool. It escaped every commerce rung above and was withheld
    // only by accident, by the summary rung this change fixes.
    expect(
      assessReadiness({
        title:
          "TechCrunch Disrupt 2026 starts in 4 days — lock in your pass savings of up to $100 before prices rise",
        whatHappened: "",
        sourceCount: 1,
        sources: [
          {
            name: "TechCrunch",
            excerpt:
              "Ticket savings of up to $100 will end when doors open on October 13. The Expo Hall opens at 8 a.m.",
          },
        ],
      }),
    ).toEqual({ ready: false, kind: "commerce", reason: expect.any(String) });
  });

  it("judges the relationship, so one part alone is not a promotion", () => {
    // The 2026-10-10 ruling: a ticket noun, an incentive, and a clock are each
    // ordinary reporting on their own. Every case below is a real corpus title
    // (or its shape) that must keep shipping.
    for (const item of [
      {
        title: "Nvidia RTX Spark launches with a $2,599 price",
        whatHappened: "The card ships this month.",
      },
      {
        title: "Prime Day sales top $14B as shoppers front-load holiday spend",
        whatHappened: "Adobe reported the figure.",
      },
      {
        title: "Ticket prices rise before the World Cup final",
        whatHappened: "Resale sites reported the increase.",
      },
      {
        title: "TechCrunch Disrupt 2026: Gamma's Grant Lee on landing your first 1,000 customers",
        whatHappened: "A session at the conference.",
      },
    ]) {
      expect(assessReadiness({ ...item, sourceCount: 1 }).ready, item.title).toBe(true);
    }
  });
});

/**
 * A marketing-shaped title is evidence of a promotion, not proof of one.
 *
 * Arbiter's ruling, 2026-10-11 (D5, option (a)). Measured on the frozen 200, the
 * marketing rungs refused three single-source *newsroom* stories -- a BBC feature
 * with a `: how` subject-and-question headline, a Register analysis with the same
 * trailer, and a BBC news story that opens with `Meet` -- while correctly dropping
 * two Cloudflare launch posts. Between them the three newsroom stories were 968
 * words of composed reporting that no reader received, so the shapes now fire only
 * when the coverage says the publisher was speaking for itself.
 *
 * The five live cases are below, verbatim from that corpus, plus the two source
 * kinds that must never qualify. The title patterns and their reasons are
 * unchanged; only the precondition is new.
 */
describe("a vendor shape only refuses when the source is the vendor", () => {
  const NEWSROOM = [
    {
      title: "Nord Stream trial: How German police followed the evidence - to Ukraine",
      what: "After four years, a Ukrainian man is set to stand trial in Hamburg.",
    },
    {
      title: "Growing pains: how distributed AI training changes the network between datacenters",
      what: "Operators describe where the bottleneck moves once training spans sites.",
    },
    {
      title: "Meet India's feisty Gen Z protester who is taking on Modi",
      what: "She has spent two years organising against a party that has governed for a decade.",
    },
  ];

  it.each(NEWSROOM)("delivers the newsroom story $title", ({ title, what }) => {
    expect(
      assessReadiness({ title, whatHappened: what, sourceCount: 1, sourceKinds: ["news"] }),
    ).toEqual({ ready: true });
  });

  it.each([
    ["Introducing Clef-omni with full multimodality, plus a faster Clef and a cheaper Clef-flash"],
    [
      "Introducing on-demand CPU and memory profiling with flamegraphs for Workers and Durable Objects",
    ],
  ])("still drops the vendor launch post %s", (title) => {
    expect(
      assessReadiness({
        title,
        whatHappened: "The vendor announces the feature on its own blog and links to the docs.",
        sourceCount: 1,
        sourceKinds: ["company_blog"],
      }),
    ).toEqual({ ready: false, kind: "marketing", reason: expect.any(String) });
  });

  it("keeps the shape predicate and the gate's own refusal in step", () => {
    // `marketingShape` exists so the audit can ask the shape question on a window
    // whose kinds are unknown, which means it and the gate must agree about what
    // a marketing shape is. A shape added to one and not the other fails here
    // rather than drifting; the shaped titles below include a newsroom headline,
    // because the shape is a property of the title and the source is what gates
    // it.
    const SHAPED = [
      "Cut your AI spend with AI Gateway's Auto Router",
      "Introducing Clef-omni with full multimodality, plus a faster Clef and a cheaper Clef-flash",
      "Adaptive application security for the AI era: how Cloudflare connects controls",
      "Celebrating Our Newest AWS Heroes",
      "Nord Stream trial: How German police followed the evidence - to Ukraine",
    ];
    const UNSHAPED = [
      "Cloudflare says Auto Router cuts AI costs for enterprise customers",
      "Nvidia RTX Spark launches with a $2,599 price",
      "Prime Day sales top $14B as shoppers front-load holiday spend",
    ];
    for (const title of SHAPED) {
      expect(
        assessReadiness({
          title,
          whatHappened: "The vendor describes its own product in the first person.",
          sourceCount: 1,
          sourceKinds: ["company_blog"],
        }),
        title,
      ).toEqual({ ready: false, kind: "marketing", reason: expect.any(String) });
      expect(marketingShape(title), title).not.toBeNull();
    }
    for (const title of UNSHAPED) {
      expect(marketingShape(title), title).toBeNull();
      expect(
        assessReadiness({
          title,
          whatHappened: "Outlets reported the change on the day it was announced.",
          sourceCount: 1,
          sourceKinds: ["company_blog"],
        }).ready,
        title,
      ).toBe(true);
    }
  });

  it("does not read a generic feed, or a missing kind, as the publisher speaking for itself", () => {
    // The risk the ruling named: a vendor announcement syndicated through a
    // generic feed arrives as `rss`, and the gate must not treat that as proof of
    // self-promotion. Missing kinds are the same answer -- unknown is not
    // first-party -- which is why the rung is skipped rather than guessed at.
    const title = "Meet India's feisty Gen Z protester who is taking on Modi";
    for (const sourceKinds of [["rss"], ["other"], ["product"], [], ["news", "rss"], undefined]) {
      expect(
        assessReadiness({
          title,
          whatHappened: "She has spent two years organising against the governing party.",
          sourceCount: 1,
          sourceKinds,
        }).ready,
        JSON.stringify(sourceKinds),
      ).toBe(true);
    }
  });
});
