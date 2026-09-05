import { describe, it, expect } from "vitest";
import { scoreEvent, type EventSignals } from "@/lib/pipeline/scoring";

function article(
  overrides: Partial<{ title: string; excerpt: string | null; published_at: string | null }> = {},
) {
  const now = new Date().toISOString();
  return {
    title: "Test article",
    excerpt: "This is a test excerpt about a routine update.",
    published_at: now,
    ...overrides,
  };
}

describe("scoreEvent", () => {
  it("scores a routine single-source CI ref as low importance", () => {
    const signals = scoreEvent([article({ title: "v1.2.3 released", excerpt: "Patch release." })], {
      cves: [],
      cvss: [],
      money: [],
      companies: [],
      countries: [],
      products: [],
      tickers: [],
      layoffs: [],
      percentages: [],
      counts: [],
      regulatoryActions: [],
      versions: [],
      dates: [],
    });

    expect(signals.importanceEstimate).toBeLessThanOrEqual(3);
    expect(signals.confidence).toBe("high");
  });

  it("scores a multi-source CVE with high CVSS as high importance", () => {
    const signals = scoreEvent(
      [
        article({ title: "Critical RCE in OpenSSH", excerpt: "CVSS 9.8" }),
        article({ title: "OpenSSH patch released", excerpt: "Update now" }),
        article({ title: "CISA warns on OpenSSH", excerpt: "Act now" }),
      ],
      {
        cves: [{ value: "CVE-2024-9999", label: "CVE-2024-9999", evidence: [1] }],
        cvss: [{ value: "9.8", label: "CVSS 9.8", evidence: [1] }],
        money: [],
        companies: [{ value: "OpenSSH", label: "OpenSSH", evidence: [1] }],
        countries: [],
        products: [{ value: "OpenSSH", label: "OpenSSH", evidence: [1] }],
        tickers: [],
        layoffs: [],
        percentages: [],
        counts: [],
        regulatoryActions: [],
        versions: [],
        dates: [],
      },
    );

    expect(signals.importanceEstimate).toBeGreaterThanOrEqual(5);
    expect(signals.reasons).toContain("CVE");
    expect(signals.reasons).toContain("high CVSS");
  });

  it("boosts importance for regulatory actions and acquisitions", () => {
    const base = {
      cves: [] as Array<{ value: string; label: string; evidence: number[] }>,
      cvss: [] as Array<{ value: string; label: string; evidence: number[] }>,
      money: [] as Array<{ value: string; label: string; evidence: number[] }>,
      companies: [] as Array<{ value: string; label: string; evidence: number[] }>,
      countries: [] as Array<{ value: string; label: string; evidence: number[] }>,
      products: [] as Array<{ value: string; label: string; evidence: number[] }>,
      tickers: [] as Array<{ value: string; label: string; evidence: number[] }>,
      layoffs: [] as Array<{ value: string; label: string; evidence: number[] }>,
      percentages: [] as Array<{ value: string; label: string; evidence: number[] }>,
      counts: [] as Array<{ value: string; label: string; evidence: number[] }>,
      regulatoryActions: [] as Array<{ value: string; label: string; evidence: number[] }>,
      versions: [] as Array<{ value: string; label: string; evidence: number[] }>,
      dates: [] as Array<{ value: string; label: string; evidence: number[] }>,
    };

    const regulatory = scoreEvent(
      [article({ title: "EU passes AI Act", excerpt: "New rules for AI" })],
      { ...base, regulatoryActions: [{ value: "passed", label: "passed", evidence: [1] }] },
    );
    const acquisition = scoreEvent(
      [article({ title: "Google buys startup", excerpt: "$500M deal" })],
      {
        ...base,
        companies: [{ value: "Google", label: "Google", evidence: [1] }],
        money: [{ value: "$500M", label: "$500M", evidence: [1] }],
      },
    );

    expect(regulatory.importanceEstimate).toBeGreaterThanOrEqual(1);
    expect(regulatory.reasons).toContain("regulatory action");
    expect(acquisition.importanceEstimate).toBeGreaterThanOrEqual(1);
    expect(acquisition.reasons).toContain("financial figure");
  });

  it("reduces importance for old and single-source events", () => {
    const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const signals = scoreEvent(
      [article({ title: "Routine update", excerpt: "Nothing new.", published_at: oldDate })],
      {
        cves: [],
        cvss: [],
        money: [],
        companies: [],
        countries: [],
        products: [],
        tickers: [],
        layoffs: [],
        percentages: [],
        counts: [],
        regulatoryActions: [],
        versions: [],
        dates: [],
      },
    );

    expect(signals.importanceEstimate).toBeLessThanOrEqual(2);
    expect(signals.reasons).toContain("old");
    expect(signals.reasons).toContain("single source");
  });

  it("boosts novelty for breaking events", () => {
    const now = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 minutes ago
    const signals = scoreEvent(
      [article({ title: "BREAKING: Major outage", excerpt: "Services down", published_at: now })],
      {
        cves: [],
        cvss: [],
        money: [],
        companies: [],
        countries: [],
        products: [],
        tickers: [],
        layoffs: [],
        percentages: [],
        counts: [],
        regulatoryActions: [],
        versions: [],
        dates: [],
      },
    );

    expect(signals.noveltyEstimate).toBeGreaterThanOrEqual(1);
    expect(signals.reasons).toContain("breaking");
  });

  it("clamps scores to 0-10", () => {
    const manyArticles = Array.from({ length: 10 }, (_, i) =>
      article({
        title: `Article ${i}`,
        excerpt: "Financial figure CVE regulatory acquisition funding",
      }),
    );
    const signals = scoreEvent(manyArticles, {
      cves: Array.from({ length: 5 }, (_, i) => ({
        value: `CVE-${i}`,
        label: `CVE-${i}`,
        evidence: [1],
      })),
      cvss: Array.from({ length: 5 }, (_, i) => ({ value: "9.9", label: "9.9", evidence: [1] })),
      money: Array.from({ length: 5 }, (_, i) => ({ value: "$1B", label: "$1B", evidence: [1] })),
      companies: Array.from({ length: 5 }, (_, i) => ({
        value: `Company${i}`,
        label: `Company${i}`,
        evidence: [1],
      })),
      countries: [],
      products: Array.from({ length: 5 }, (_, i) => ({
        value: `Product${i}`,
        label: `Product${i}`,
        evidence: [1],
      })),
      tickers: [],
      layoffs: [],
      percentages: [],
      counts: [],
      regulatoryActions: Array.from({ length: 5 }, (_, i) => ({
        value: "fined",
        label: "fined",
        evidence: [1],
      })),
      versions: [],
      dates: [],
    });

    expect(signals.importanceEstimate).toBeLessThanOrEqual(10);
    expect(signals.importanceEstimate).toBeGreaterThanOrEqual(0);
  });
});
