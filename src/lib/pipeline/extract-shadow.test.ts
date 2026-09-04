import { describe, it, expect } from "vitest";
import {
  extractMoney,
  extractPercentages,
  extractDates,
  extractCVEs,
  extractCVSS,
  extractVersions,
  extractCounts,
  extractCompanies,
  extractCountries,
  extractProducts,
  extractTickers,
  extractLayoffs,
  extractRegulatoryActions,
  extractFacts,
  compareExtraction,
} from "./extract";

describe("extractMoney", () => {
  it("extracts dollar amounts with units", () => {
    const results = extractMoney("The company raised $13 billion in funding.", 0);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.value).toContain("13");
  });

  it("extracts million amounts", () => {
    const results = extractMoney("The deal was worth $200 million.", 0);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.value).toContain("200");
  });

  it("returns empty for no money", () => {
    const results = extractMoney("No financial data here.", 0);
    expect(results).toEqual([]);
  });
});

describe("extractPercentages", () => {
  it("extracts percentage values", () => {
    const results = extractPercentages("The growth rate was 4.5%.", 0);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.value).toContain("4.5");
  });

  it("returns empty for no percentages", () => {
    const results = extractPercentages("No percentages mentioned.", 0);
    expect(results).toEqual([]);
  });
});

describe("extractDates", () => {
  it("extracts ISO dates", () => {
    const results = extractDates("The event occurred on 2024-01-15.", 0);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.value).toBe("2024-01-15");
  });

  it("returns empty for no dates", () => {
    const results = extractDates("No dates here.", 0);
    expect(results).toEqual([]);
  });
});

describe("extractCVEs", () => {
  it("extracts CVE IDs", () => {
    const results = extractCVEs("CVE-2024-12345 was discovered.", 0);
    expect(results.length).toBe(1);
    expect(results[0]!.value).toBe("CVE-2024-12345");
  });

  it("returns empty for no CVEs", () => {
    const results = extractCVEs("No CVEs mentioned.", 0);
    expect(results).toEqual([]);
  });
});

describe("extractCVSS", () => {
  it("extracts CVSS references", () => {
    const results = extractCVSS("CVSS 9.8 was assigned.", 0);
    expect(results.length).toBeGreaterThan(0);
  });

  it("extracts base score patterns", () => {
    const results = extractCVSS("The base score of 7.5 was high.", 0);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("extractVersions", () => {
  it("extracts semver versions", () => {
    const results = extractVersions("Version 2.1.0 is now available.", 0);
    expect(results.length).toBeGreaterThan(0);
  });

  it("extracts product versions", () => {
    const results = extractVersions("GPT-5 was released.", 0);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("extractCounts", () => {
  it("extracts count phrases", () => {
    const results = extractCounts("5 employees were affected.", 0);
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty for no counts", () => {
    const results = extractCounts("No counts mentioned.", 0);
    expect(results).toEqual([]);
  });
});

describe("extractCompanies", () => {
  it("extracts known companies", () => {
    const results = extractCompanies("OpenAI and Google announced a partnership.", 0);
    const names = results.map((r) => r.value);
    expect(names).toContain("OpenAI");
    expect(names).toContain("Google");
  });

  it("returns empty for no companies", () => {
    const results = extractCompanies("No companies mentioned.", 0);
    expect(results).toEqual([]);
  });
});

describe("extractCountries", () => {
  it("extracts known countries", () => {
    const results = extractCountries("The United States and China signed a deal.", 0);
    const names = results.map((r) => r.value);
    expect(names).toContain("United States");
    expect(names).toContain("China");
  });
});

describe("extractProducts", () => {
  it("extracts known products", () => {
    const results = extractProducts("GPT-5 and Claude 3 were released.", 0);
    const names = results.map((r) => r.value);
    expect(names).toContain("GPT-5");
    expect(names).toContain("Claude");
  });
});

describe("extractTickers", () => {
  it("extracts known tickers", () => {
    const results = extractTickers("NVDA stock rose today.", 0);
    expect(results.some((r) => r.value === "NVDA")).toBe(true);
  });
});

describe("extractLayoffs", () => {
  it("extracts layoff counts", () => {
    const results = extractLayoffs("100 jobs will be cut.", 0);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("extractRegulatoryActions", () => {
  it("extracts fines", () => {
    const results = extractRegulatoryActions("The company was fined $5 million.", 0);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("extractFacts", () => {
  it("returns all categories", () => {
    const text =
      "OpenAI raised $13 billion on 2024-01-15. CVE-2024-12345 was found. GPT-5 launched. 5 employees were laid off.";
    const facts = extractFacts(text, 0);
    expect(facts.money.length).toBeGreaterThan(0);
    expect(facts.dates.length).toBeGreaterThan(0);
    expect(facts.cves.length).toBeGreaterThan(0);
    expect(facts.versions.length).toBeGreaterThan(0);
    expect(facts.layoffs.length).toBeGreaterThan(0);
    expect(facts.companies.length).toBeGreaterThan(0);
  });
});

describe("compareExtraction", () => {
  it("returns perfect agreement for matching facts", () => {
    const codeFacts = extractFacts("OpenAI raised $13 billion.", 0);
    const aiFacts = { companies: ["OpenAI"], money: ["$13 billion"] };
    const results = compareExtraction(codeFacts, aiFacts);
    const companyResult = results.find((r) => r.category === "companies");
    expect(companyResult?.agreementRate).toBe(1.0);
  });

  it("returns zero agreement for completely different facts", () => {
    const codeFacts = extractFacts("OpenAI raised $13 billion.", 0);
    const aiFacts = { companies: ["Microsoft"], money: ["$5 million"] };
    const results = compareExtraction(codeFacts, aiFacts);
    const companyResult = results.find((r) => r.category === "companies");
    expect(companyResult?.agreementRate).toBeLessThan(1.0);
  });

  it("handles empty sets", () => {
    const codeFacts = extractFacts("No financial data.", 0);
    const aiFacts = { money: [] };
    const results = compareExtraction(codeFacts, aiFacts);
    const moneyResult = results.find((r) => r.category === "money");
    expect(moneyResult?.agreementRate).toBe(1.0);
  });
});
