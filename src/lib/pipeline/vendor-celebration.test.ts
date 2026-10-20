import { describe, expect, it } from "vitest";
import {
  isFirstPartyCarriage,
  isVendorCelebrationTitle,
  VENDOR_CELEBRATION_ARMS,
  vendorCelebrationShape,
} from "./vendor-celebration";

/**
 * The first-party celebration class — the fourth dashboard class, measured 2026-10-20 on the stored
 * corpus (23,539 titles; 354 carried only by `company_blog` sources).
 *
 * The population numbers behind every sample here are printed by
 * `scripts/vendor-celebration-census.ts` and recorded in
 * `docs/decisions/vendor-celebration-class.md`. Each test pins one boundary the ruling has to hold:
 *
 *   - the class itself (3 of 354) is refused;
 *   - the same population's launches (49), engineering (46), repricing (1) and partnerships (5) are
 *     not — these are the false positives the rule has to survive;
 *   - the 26 celebration-shaped news titles are not, because their carriage is not first-party. The
 *     conference cancellation is the sharpest: a title-only rule would have refused a development.
 *
 * A test that only asserted refusals would pass on a predicate that refused everything.
 */

const FIRST_PARTY = ["company_blog"];

describe("isVendorCelebrationTitle refuses the measured first-party celebrations", () => {
  it("refuses the card that opened the class", () => {
    // The live dashboard card, 2026-10-19, #12 of 12 — NVIDIA's own blog.
    const title = "RTX Spark Ignites Global Celebration as New Windows PCs Arrive";
    expect(isVendorCelebrationTitle(title, FIRST_PARTY), title).toBe(true);
    expect(vendorCelebrationShape(title, FIRST_PARTY)).toContain("celebrat*");
  });

  it("refuses the second NVIDIA ceremony post", () => {
    const title = "Be There for the Beginning: Celebrate the Launch of NVIDIA RTX Spark";
    expect(isVendorCelebrationTitle(title, FIRST_PARTY), title).toBe(true);
  });

  it("refuses the community-recognition shape the briefing gate already refuses", () => {
    // `CELEBRATION_TITLE` in readiness.ts has refused this since 2026-10-02; the new class must subsume
    // it rather than leave two definitions of the same shape.
    const title = "Celebrating Our Newest AWS Heroes – September 2026";
    expect(isVendorCelebrationTitle(title, FIRST_PARTY), title).toBe(true);
  });

  it("keeps a celebration carried by a news source as well", () => {
    // First-party means *every* source is a company blog. One news outlet carrying it is corroboration,
    // and the corpus holds no such title — this pins the boundary rather than a measured case.
    const title = "RTX Spark Ignites Global Celebration as New Windows PCs Arrive";
    expect(isVendorCelebrationTitle(title, ["company_blog", "news"]), title).toBe(false);
  });
});

describe("the first-party precondition is what separates the class from news", () => {
  it("keeps all 26 celebration-shaped news titles measured on the corpus", () => {
    // Verbatim from the corpus census. Without the first-party arm the predicate refuses every one of
    // these — including a cancelled conference, which is a development a reader needs.
    const news = [
      "Grace Hopper Celebration canceled two weeks out as AnitaB.org runs short of funds",
      "Pope Leo celebrates open-air mass before 700,000 people in Paris",
      "In pictures: Dussehra celebrated across India as triumph of good over evil",
      "Israel marks third anniversary of 7 October Hamas attacks | First Thing",
      "Celtic celebrate heated win over Rangers in final of revived Tennent’s Sixes",
      "Microsoft celebrates end of Office 2021 LTSC with MS 365 outage",
      "An epic train chase is turning 100 — and Buster Keaton fans are celebrating",
      "‘A beacon of peace’: London’s oldest mosque celebrates centenary",
      "Sports quiz of the week: love, songs, speedy skating and celebrations",
      "'Money-grab' or celebration? NFL kicks off London series",
      "AfD celebrate projected win in Saxony-Anhalt",
      "Beveridge revisited: Simon Callow film celebrates the radical co-founder of Britain’s welfare state",
      "Oxford United apologise for launching ‘United 93’ clothing range around 9/11 anniversary",
      "BC honors Crowther on 25th anniversary of 9/11 with annual Red Bandanna Game",
      "Amy Winehouse’s Back to Black Expanded for 20th Anniversary Reissue",
      "Celebrate the late Scottish-Kenyan singer-songwriter Beldina Odenyo",
      "Celebrating the brilliant pragmatism of TCP/IP, the wiring of the world",
      "Israeli ambassador to Australia says he hopes for return to ‘traditional friendship’ on October 7 anniversary eve",
      "Australian leaders condemn pro-Palestine vigils planned for 7 October anniversary amid Jewish commemorations",
      "Israelis mourn on the anniversary of the Oct. 7 as Palestinians grapple with war it sparked",
      "Hasbro announces Transformers 40th anniversary re-release with Peter Cullen's final performance",
      "Arc Raiders is getting a free trial to celebrate its biggest update yet",
      "Most Valuable Promotions marks fifth anniversary",
      "Igalia Celebrates 25 Years Of Advancing Linux & Open-Source",
      "Quins disaster, salty celebrations and Test bolters - Prem talking points",
      "Microsoft's $899 Xbox Series X 25th anniversary bundle sold out in one minute",
    ];
    for (const title of news) {
      expect(isVendorCelebrationTitle(title, ["news"]), title).toBe(false);
    }
  });

  it("keeps a first-party post with no celebration lexeme", () => {
    // The celebration word is required too: 264 of the 354 first-party events carry neither the lexeme
    // nor a launch/engineering shape, and a source rule would have refused all of them.
    for (const title of [
      "A model guide for the GPT-6 family",
      "All Systems Go: Global PC App Ecosystem Ready for NVIDIA RTX Spark",
      "The Nordics and NVIDIA Show What’s Possible When a Region Commits to Advanced Computing",
      "Happy 20th Birthday, Amazon EC2",
    ]) {
      expect(isVendorCelebrationTitle(title, FIRST_PARTY), title).toBe(false);
    }
  });

  it("treats unknown, missing and empty carriage as not first-party", () => {
    // The same fail-open rule `assessReadiness` applies: a caller that has not loaded coverage must not be
    // read as having found a company blog. This is why the class cannot fire on the dashboard today —
    // `gateHomeFeed` passes neither kinds nor sources.
    const title = "RTX Spark Ignites Global Celebration as New Windows PCs Arrive";
    expect(isVendorCelebrationTitle(title, undefined), title).toBe(false);
    expect(isVendorCelebrationTitle(title, []), title).toBe(false);
    expect(isFirstPartyCarriage(undefined)).toBe(false);
    expect(isFirstPartyCarriage([])).toBe(false);
    expect(isFirstPartyCarriage(["company_blog"])).toBe(true);
    expect(isFirstPartyCarriage(["company_blog", "news"])).toBe(false);
  });
});

describe("the controls the ruling names — kept, though they sit in the same population", () => {
  it("keeps product launches from first-party blogs", () => {
    for (const title of [
      "Introducing GPT-6 Sol and Luna",
      "Microsoft and Nvidia launch Surface Laptop Ultra with RTX Spark",
      "NVIDIA Launches DSX Ready to Qualify Power and Cooling Products for AI Factories",
      "Introducing the AndroidX Security State Libraries: A Unified View of Device Security",
      "Introducing Gemini 3.8 Live with Live Avatar",
    ]) {
      expect(isVendorCelebrationTitle(title, FIRST_PARTY), title).toBe(false);
    }
  });

  it("keeps a repricing from a first-party blog", () => {
    const title =
      "Introducing Clef-omni with full multimodality, plus a faster Clef and a cheaper Clef-flash";
    expect(isVendorCelebrationTitle(title, FIRST_PARTY), title).toBe(false);
  });

  it("keeps a partnership or acquisition from a first-party blog", () => {
    for (const title of [
      "Atlassian and OpenAI expand partnership to turn enterprise knowledge into action",
      "CrowdStrike and NVIDIA announce SafeMind agentic cybersecurity system",
      "Emerald AI, Google and NVIDIA Launch Alliance to Advance Flexible AI Data Centers",
    ]) {
      expect(isVendorCelebrationTitle(title, FIRST_PARTY), title).toBe(false);
    }
  });

  it("keeps engineering and research posts from the same vendor blogs", () => {
    for (const title of [
      "Open and Emergent Problems in Agentic Privacy and Security: A Contextual Angle",
      "AWS Weekly Roundup: Prime Day 2026 by the numbers, Claude Haiku 5.5, Amazon Nova 2.5 Sonic, and more (October 13, 2026)",
      "How we found 24 Android vulnerabilities using our open source AI security agent",
      "Introducing TorchNeuron: Native PyTorch backend for AWS Trainium",
      "NVIDIA Isaac ROS 5.0 Advances Agentic, Open Source Robotics Development",
    ]) {
      expect(isVendorCelebrationTitle(title, FIRST_PARTY), title).toBe(false);
    }
  });
});

describe("the arms are named, so an audit can attribute a number to each", () => {
  it("carries the four measured arms and no unmeasured one", () => {
    expect(VENDOR_CELEBRATION_ARMS.map((arm) => arm.name)).toEqual([
      "celebrat*",
      "anniversary",
      "jubilee",
      "festivities",
    ]);
  });

  it("names the arm that fired", () => {
    expect(
      vendorCelebrationShape("Celebrating Our Newest AWS Heroes – September 2026", FIRST_PARTY),
    ).toContain("celebrat*");
    // The anniversary arm is stored at 0 first-party / 10 corpus titles today, so there is no measured
    // first-party sample; this pins the arm itself without pretending the corpus contains one.
    expect(
      vendorCelebrationShape("Acme marks its ten-year anniversary of building widgets", [
        "company_blog",
      ]),
    ).toContain("anniversary");
  });
});
