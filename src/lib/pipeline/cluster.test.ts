import { describe, expect, it } from "vitest";
import { sameHeadline, sameIncident, sameStory, distinctNews } from "./news-signals";
describe("conservative full-headline identity", () => {
  it("accepts normalized identical reporting", () => {
    expect(
      sameHeadline("OpenAI launches NEW model today!", "OpenAI launches new model today"),
    ).toBe(true);
  });
  it.each([
    ["Apple acquires startup for $40 million", "Apple acquires startup for $400 million"],
    [
      "Apple buys startup after extended negotiations",
      "Google buys startup after extended negotiations",
    ],
    [
      "Company confirms takeover agreement after negotiations",
      "Company denies takeover agreement after negotiations",
    ],
    [
      "Flood hits northern city as thousands flee homes",
      "Flood hits southern city as thousands flee homes",
    ],
    ["Police arrest mayor after council meeting", "Mayor arrests police after council meeting"],
    [
      "New study investigates cancer treatment effects",
      "Study examines a promising cancer therapy",
    ],
  ])("separates conflicting or ambiguous reporting: %s", (a, b) => {
    expect(sameHeadline(a, b)).toBe(false);
  });
  it("suppresses only near-identical briefing candidates", () => {
    const list = [
      "Apple buys startup for 40 million dollars",
      "Apple buys startup for 40 million dollars!",
      "Apple buys startup for 50 million dollars",
    ];
    expect(distinctNews(list, (x) => x)).toHaveLength(2);
  });
});

/**
 * The paraphrase predicate, on the pairs that decided its shape.
 *
 * Every fixture below is a real pair from the live corpus: the merges are
 * events that shipped as single-source stories because no outlet reprinted
 * another's words, and the separations are pairs a looser threshold did merge
 * when the threshold was run over a week of the corpus.
 */
describe("cross-outlet paraphrase matching", () => {
  it.each([
    [
      "OpenAI launches Dots, its Muse competitor",
      "OpenAI launches Dots, its bubbly agentic avatar",
    ],
    [
      "AMD will acquire Fei-Fei Li's World Labs for $8.2 billion",
      "AMD is acquiring AI company World Labs in a deal worth more than $8 billion",
    ],
    [
      "Early AMD 'Gorgon Halo' AI mini-PC packs 192GB RAM for an eye-watering $7,099",
      "AMD's 192 GB Gorgon Halo prices might leave you petrified",
    ],
    [
      "Six Flags permanently shuts down X2 rollercoaster after claims of brain injuries",
      "Six Flags shuts down X2 rollercoaster after hundreds allege brain injuries",
    ],
    [
      "Mexico's Baja California braces for Hurricane Polo as Hurricane Nolo threatens Hawaii",
      "Hurricane Nolo still threatens Hawaii as Mexico's Baja braces for major Hurricane Polo",
    ],
    [
      "TikTok to pay Alabama $100m and limit teenage use in first state settlement",
      "TikTok agrees to pay at least $100M in Alabama settlement",
    ],
    [
      "Harvey Weinstein sentenced to 15 years after sexual assault conviction",
      "Harvey Weinstein sentenced to 15 years in prison for sexual assault",
    ],
    [
      "Meta Connect 2026: The 7 biggest announcements",
      "Meta Connect 2026: The biggest news and announcements",
    ],
    // One arrest in two outlets' own words. No three content words are shared;
    // the actor and the figure are what identify the incident, and the reader
    // saw this pair print as two cards before the shape test existed.
    [
      "Californian accused of shipping $300M worth of Nvidia chips to China without Uncle Sam's approval",
      "California tech CEO arrested, faces up to 20 years in prison for smuggling $300 million in Nvidia AI servers to China",
    ],
    [
      "Amazon's $1B plan to combat data center backlash draws more backlash",
      "Shut up and take our money: Amazon plows $1B into quashing datacenter dissent",
    ],
  ])("merges two accounts of one event: %s", (a, b) => {
    expect(sameStory(a, b)).toBe(true);
  });

  it.each([
    // One model benched, another launched: same company, same version number,
    // different events. This is the trap an entity-overlap rule falls into.
    [
      "OpenAI benches GPT-6.1 Astra for overstepping the mark",
      "OpenAI launches GPT-6.1 Sol, says it nearly matches GPT-6 Astra and costs less",
    ],
    // Different advisories from one template, with the count spelled out.
    [
      "CISA Adds Two Known Exploited Vulnerabilities to Catalog",
      "CISA Adds One Known Exploited Vulnerability to Catalog",
    ],
    // A round-up is not one story's headline, however much it overlaps one.
    [
      "Trump weakens fuel efficiency standards. And, Cornell fraternity rape case reopened",
      "US prosecutors reopen case of alleged gang rape at Cornell University",
    ],
    [
      "Microsoft quietly drops Copilot+ branding from new laptops",
      "Microsoft thinks its new Copilot 'super app' will be as influential as Office",
    ],
    // A figure one side omits: one outlet's two listicle announcements, of
    // which only one is dated.
    [
      "The Download: climate tech companies to watch and AI's discovery problem",
      "Coming soon: Our 2026 list of Climate Tech Companies to Watch",
    ],
    [
      "Even Americans who use AI every day are worried about it",
      "Americans are confused and worried about elections. Will that impact turnout?",
    ],
    [
      "Supreme Court blocks Trump-backed Missouri congressional map",
      "Supreme Court allows Trump to use controversial database to check voter citizenship",
    ],
    [
      "Lula says Trump wants to 'colonise' and capture Brazil's resources by meddling in election",
      "Brazil's Lula bans online gambling ahead of presidential election",
    ],
    // A category shared by half of arXiv, with nothing else in common.
    [
      "Stepwise Intrinsic Rewards for Reasoning in Large Language Models",
      "Attribution Bias in Large Language Models",
    ],
    [
      "Grab this 4K-ready RTX 5070 Ti gaming PC from HP for under $1,900 right now",
      "Sadly, this $1,549 RTX 5070-equipped gaming PC is a very good deal",
    ],
    // Too little to say anything: one product name is not a story.
    ["Introducing dots", "OpenAI launches Dots, its Muse competitor"],
    [
      "Company denies takeover agreement after negotiations",
      "Company confirms takeover agreement after negotiations",
    ],
    // The same actor and two different sums: the DGX Spark's launch price and
    // the other outlet's account of the same product with no figure at all.
    // The figure is what makes "same incident" a claim about the world instead
    // of a claim about a company name.
    [
      "Nvidia debuts $4,999 DGX Spark with half the RAM and storage, amid memory crunch",
      "NVIDIA DGX Spark 64GB Gives Developers More Ways to Build and Scale Local AI",
    ],
    // One actor, two different figures: a launch price and a currency figure
    // that belong to different stories.
    [
      "Nvidia debuts $4,999 DGX Spark with half the RAM and storage, amid memory crunch",
      "Nvidia's $5 billion AI bet faces a memory crunch",
    ],
    // The same event kind and the same percentage, two different subjects.
    [
      "Component shortages drive Raspberry Pi prices up by up to 23%",
      "DRAM contract prices rose by up to 23% in the third quarter",
    ],
  ])("keeps distinct stories apart: %s", (a, b) => {
    expect(sameStory(a, b)).toBe(false);
  });

  it("does not weaken the verbatim predicate it sits beside", () => {
    // The paraphrase test is a second route to an attach, not a loosening of
    // the first: `sameHeadline` must still refuse what it always refused, or
    // `duplicates.ts` loosens with it.
    expect(
      sameHeadline(
        "OpenAI launches Dots, its Muse competitor",
        "OpenAI launches Dots, its bubbly agentic avatar",
      ),
    ).toBe(false);
    expect(
      sameHeadline(
        "Apple acquires startup for $40 million",
        "Apple acquires startup for $400 million",
      ),
    ).toBe(false);
  });

  it("joins two accounts of one release by their shared bare magnitude", () => {
    // Audit 27's counterfactual: of the 322 same-actor residual pairs that share
    // no currency or percentage figure, this was the one true event -- and the
    // only one the magnitude vocabulary joins.
    expect(
      sameIncident(
        "The G7 will release 100 million reserve barrels of diesel fuel over the next 4 months",
        "G7 to release 100 million barrels of oil and diesel after Trump export ban threat",
      ),
    ).toBe(true);
    // Different magnitudes are different releases; the identity vocabulary is
    // still a match, not a threshold.
    expect(
      sameIncident(
        "Acme to ship 100 million widgets to Brazil",
        "Acme to ship 200 million widgets to Brazil",
      ),
    ).toBe(false);
  });

  it("needs an entity and a figure on both sides of the paraphrase test", () => {
    // A headline with no named actor is not an identity, however many of its
    // words the other side repeats: the shape requires a primary entity on
    // both sides before the paragraph is even compared.
    expect(
      sameIncident(
        "Californian accused of shipping $300M worth of Nvidia chips to China",
        "accused of shipping $300m worth of chips to china",
      ),
    ).toBe(false);
    expect(
      sameIncident(
        "Californian accused of shipping $300M worth of Nvidia chips to China",
        "Nvidia accused of shipping chips to China",
      ),
    ).toBe(false);
  });
});
