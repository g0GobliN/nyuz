import { describe, expect, it } from "vitest";
import { composeArticleWithDiagnostics } from "@/lib/editorial";
import { contextDependent } from "@/lib/reader-evidence";
import type { Story } from "@/lib/story";

/**
 * Reader-clarity audit 2026-10-22 §5: I-03 and its generalisation into H-14
 * and H-11's shapes (docs/reader-clarity-audit-2026-10-22.md).
 *
 * The fixtures reproduce the events' stored rows — The Register's excerpt for
 * the OT story, Tom's Hardware's for Terafab and the H-11 card — so the tests
 * judge the composer on the data a reader's briefing is actually built from,
 * not on the audit's own paraphrase.
 */

const OT_EXCERPT =
  'When it comes to cyberattacks that shut down power grids, drinking-water systems, and other critical infrastructure, AI doesn’t – yet – turn script kiddies into sophisticated, nation-state attackers. But “the potential is there,” according to operational technology (OT) security experts. "One thing that we\'ve relied on for years is security by obscurity when it comes to utilities," said Steve Swick, former chief information security officer at American Electric Power. "The knowledge needed to do some of that stuff is getting less likely to be necessary," Swick added during a media panel ahead of the publication of Frenos\' State of AI in Security report. AI makes it easier and faster for human attackers to target critical infrastructure, gain access to utilities and manufacturing plants, and perform OT system reconnaissance. “Basic access can recon documentation, and distill through that documentation very quickly to find out critical design features of your plant and facility,” said Paul Shaver, head of OT at Armadin, during the panel. Armadin is Kevin Mandia’s new security startup that uses swarms of autonomous AI agents to simulate real-world cyberattacks. Plus, as AI lowers the technical barriers to would-be OT hackers, “it advances the timeline,” said Harry Thomas, chief technology officer and co-founder of Frenos, a security company that does AI pentesting for OT environments.';

const ASML_EXCERPT =
  "Elon Musk says ASML and other critical semiconductor equipment suppliers have expedited shipments for the ambitious Terafab semiconductor manufacturing facility. ASML, the world's sole commercial supplier of the $400 million EUV lithography systems required for high-volume, leading-edge chip production, is perhaps the project's most critical partner. Terafab will utilize traditional extreme ultraviolet (EUV) lithography systems utilizing Intel's 14A manufacturing node technology.";

function fixtureStory(title: string, excerpt: string, evidence: string[] = []): Story {
  return {
    id: "fixture",
    org: "nyuz",
    title,
    what: excerpt,
    why: "",
    importance: "Medium",
    score: { relevance: 80, importance: 60, novelty: 40 },
    sources: 1,
    topics: ["Cybersecurity"],
    time: "10:00",
    publishedAt: "2026-10-21T10:00:00Z",
    sourceList: [
      {
        name: "The Register",
        at: "2026-10-21T09:00:00Z",
        excerpt,
        enrichedEvidence: evidence.map((text) => ({ text, kind: "fact" }) as never),
      },
    ],
    before: "",
    after: "",
    timeline: [],
  };
}

function pageOf(story: Story) {
  const { article, diagnostics } = composeArticleWithDiagnostics(story);
  return {
    article,
    page: [article.deck.text, ...article.paragraphs.map((p) => p.text)].join("\n"),
    diagnostics,
  };
}

describe("composer first-use acronym expansion (audit I-03)", () => {
  it("expands the audited OT on its first use, from the story's own evidence", () => {
    const { page } = pageOf(
      fixtureStory(
        "AI has 'potential' to turn script kiddies into sophisticated infrastructure attackers",
        OT_EXCERPT,
      ),
    );
    // The first occurrence of the acronym on the page carries the full form,
    // inline, in the sentence where it first appears.
    const firstUse = page.search(/\bOT\b/);
    expect(firstUse).toBeGreaterThanOrEqual(0);
    const preceding = page.slice(Math.max(0, firstUse - 30), firstUse);
    expect(preceding).toContain("operational technology (");
  });

  it("expands an acronym the audit did not quote (EAG), from the H-11 story's own evidence", () => {
    const evidence = [
      "AMD says the move to unify these efforts under oneDNN was recommended by the x86 Ecosystem Advisory Group (EAG), which is a joint initiative that primarily exists between Intel and AMD and was established in 2024.",
    ];
    const { page } = pageOf(
      fixtureStory(
        "AMD and Intel will work together to create a single PyTorch code path for AI inference on CPUs",
        "Intel and AMD are integrating their CPU optimizations for PyTorch into a unified library, offering tuning for both AMD and Intel chips, the companies say.",
        evidence,
      ),
    );
    expect(page).toContain("Ecosystem Advisory Group (EAG)");
  });

  it("carries the story's stored explanation of its own head noun (I-03's shape)", () => {
    // Same defect, different acronym: the Register story's page once printed
    // "perform OT system reconnaissance" after the picker moved the source's
    // "operational technology (OT)" away. A page that names ZenDNN without the
    // sentence its own evidence carries to explain it is I-03 in kind.
    const evidence = [
      "Intel has long worked on tuning their oneDNN neural network library for their hardware and saw its adoption by PyTorch and other AI frameworks.",
      "AMD has maintained a downstream version of oneDNN called ZenDNN, which is now moving into the open-source oneDNN, published by the UXL Foundation and driven by Intel.",
    ];
    const { page } = pageOf(
      fixtureStory(
        "AMD and Intel will work together to create a single PyTorch code path for AI inference on CPUs",
        "Intel and AMD are integrating their CPU optimizations for PyTorch into a unified library, offering tuning for both AMD and Intel chips through the oneDNN library.",
        evidence,
      ),
    );
    const firstZen = page.search(/\bZenDNN\b/);
    expect(firstZen).toBeGreaterThanOrEqual(0);
    // ...and the page must be readable there: ZenDNN's place arrives with it,
    // not paragraphs later.
    const clause = page.slice(Math.max(0, firstZen - 60), firstZen + 120);
    expect(clause).toContain("downstream");
    // An acronym without a stored expansion stays bare; nothing is invented.
    expect(page).not.toContain("Deep Neural Network");
  });

  it("leaves an acronym without a stored expansion alone (oneDNN)", () => {
    const excerpt =
      "The oneDNN backend is used for CPU inference, and it's built to accelerate that workload for the latest Intel chips in frameworks like PyTorch. Intel and AMD are integrating their CPU optimizations for PyTorch into a unified library.";
    const { page } = pageOf(
      fixtureStory(
        "AMD and Intel will work together to create a single PyTorch code path for AI inference on CPUs",
        excerpt,
      ),
    );
    expect(page).toContain("oneDNN backend");
    expect(page).not.toContain("Deep Neural Network");
  });
});

describe("the body's admissibility guard consults the title (audit H-14)", () => {
  // Measured on the live row: the ASML explainer was refused as
  // `unresolved_context` although the delivered headline names ASML, so the
  // reader met "ASML" and "Terafab" with neither ever placed.
  const ASML_TITLE =
    "ASML and other critical semiconductor equipment suppliers expedite shipments to Musk's Terafab";

  it("publishes the sentence that places ASML under the title that names it", () => {
    const { page, diagnostics } = pageOf(fixtureStory(ASML_TITLE, ASML_EXCERPT));
    expect(page).toContain("world's sole commercial supplier of the $400 million");
    expect(
      diagnostics.facts.unrendered.some((entry) => entry.text.startsWith("ASML, the world's")),
    ).toBe(false);
  });

  it("still refuses the same sentence without a title to establish it", () => {
    // The guard's own contract (ruling #17): a caller without the title gets
    // the stricter answer.
    expect(contextDependent("ASML, the world's sole commercial supplier", null)).toBe(true);
    expect(contextDependent("ASML, the world's sole commercial supplier")).toBe(true);
    expect(contextDependent("ASML, the world's sole commercial supplier", ASML_TITLE)).toBe(false);
  });

  it("places Terafab out of the story's own data, not a glossary", () => {
    const { page } = pageOf(fixtureStory(ASML_TITLE, ASML_EXCERPT));
    expect(page).toContain("Terafab semiconductor manufacturing facility");
  });
});
