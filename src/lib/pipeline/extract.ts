/**
 * Deterministic entity and number extraction.
 *
 * This module extracts verifiable facts from article coverage text using
 * regex patterns and dictionaries. It does NOT interpret meaning — it only
 * extracts what is objectively present in the text.
 *
 * Originally shadow-mode only, compared against AI-extracted values (see
 * docs/track.md phase 7). Money/percentage/company/product/country extraction
 * is now also used directly by the deterministic Read composer
 * (understand.ts, evidence-extract.ts) -- promoted deliberately, since these
 * categories are simple dictionary/regex matches with low ambiguity risk, not
 * because the shadow comparison concluded anything about AI-extraction parity.
 */

// Keep entity spelling stable across sources with different casing.
function canonicalLookup(known: readonly string[]): Map<string, string> {
  return new Map(known.map((name) => [name.toLowerCase(), name]));
}

// ---------------------------------------------------------------------------
// Money values
// ---------------------------------------------------------------------------

/**
 * Matches monetary amounts in article text.
 *
 * Handles: $13B, $1.3 billion, $200 million, $4bn, $300m, €50M, £1.2B
 * Does NOT match: bare numbers without currency context, stock prices
 * (those are tickers, handled separately).
 */
const MONEY_RE = /\$[\s]*([\d,]+\.?\d*)\s*(billion|b|bn|million|m|mn|M|trillion|t|tn)?/gi;
const EURO_RE = /€\s*([\d,]+\.?\d*)\s*(million|m|bn|b|billion)?/gi;
const POUND_RE = /£\s*([\d,]+\.?\d*)\s*(million|m|bn|b|billion)?/gi;

export interface ExtractedMoney {
  value: string;
  label: string;
  evidence: number[];
}

export function extractMoney(text: string, articleIndex: number): ExtractedMoney[] {
  const results: ExtractedMoney[] = [];
  const seen = new Set<string>();

  for (const regex of [MONEY_RE, EURO_RE, POUND_RE]) {
    let match;
    const re = new RegExp(regex.source, regex.flags);
    while ((match = re.exec(text)) !== null) {
      const amount = match[1]?.replace(/,/g, "") ?? "";
      const unit = (match[2] ?? "").toLowerCase();
      const label = unit ? `${amount} ${unit}` : amount;
      const key = `${label}-${articleIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ value: label, label, evidence: [articleIndex + 1] });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Percentages
// ---------------------------------------------------------------------------

const PERCENTAGE_RE = /(\d+(?:\.\d+)?)\s*%/g;
const PERCENTAGE_ALT_RE = /(\d+(?:\.\d+)?)\s*percent/gi;

export interface ExtractedPercentage {
  value: string;
  label: string;
  evidence: number[];
}

export function extractPercentages(text: string, articleIndex: number): ExtractedPercentage[] {
  const results: ExtractedPercentage[] = [];
  const seen = new Set<string>();

  for (const regex of [PERCENTAGE_RE, PERCENTAGE_ALT_RE]) {
    let match;
    const re = new RegExp(regex.source, regex.flags);
    while ((match = re.exec(text)) !== null) {
      const key = `${match[1]}-${articleIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ value: `${match[1]}%`, label: `${match[1]}%`, evidence: [articleIndex + 1] });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/g;
const US_DATE_RE =
  /\b(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/gi;
const SHORT_DATE_RE = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;

export interface ExtractedDate {
  value: string;
  label: string;
  evidence: number[];
}

export function extractDates(text: string, articleIndex: number): ExtractedDate[] {
  const results: ExtractedDate[] = [];
  const seen = new Set<string>();

  for (const regex of [ISO_DATE_RE, US_DATE_RE, SHORT_DATE_RE]) {
    let match;
    const re = new RegExp(regex.source, regex.flags);
    while ((match = re.exec(text)) !== null) {
      const key = `${match[1]}-${articleIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ value: match[1] ?? "", label: match[1] ?? "", evidence: [articleIndex + 1] });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CVE IDs
// ---------------------------------------------------------------------------

const CVE_RE = /CVE-\d{4}-\d{4,7}/g;

export interface ExtractedCVE {
  value: string;
  label: string;
  evidence: number[];
}

export function extractCVEs(text: string, articleIndex: number): ExtractedCVE[] {
  const results: ExtractedCVE[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = CVE_RE.exec(text)) !== null) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    results.push({ value: match[0], label: match[0], evidence: [articleIndex + 1] });
  }

  return results;
}

// ---------------------------------------------------------------------------
// CVSS Scores
// ---------------------------------------------------------------------------

const CVSS_RE = /CVSS\s+[\d.]+/gi;
const CVSS_BASE_RE = /base\s+score\s+of\s+(\d+(?:\.\d+)?)/gi;

export interface ExtractedCVSS {
  value: string;
  label: string;
  evidence: number[];
}

export function extractCVSS(text: string, articleIndex: number): ExtractedCVSS[] {
  const results: ExtractedCVSS[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = CVSS_RE.exec(text)) !== null) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    results.push({ value: match[0], label: match[0], evidence: [articleIndex + 1] });
  }

  // Also catch "base score of X.X" patterns
  while ((match = CVSS_BASE_RE.exec(text)) !== null) {
    const key = `cvss-${match[1]}-${articleIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      value: match[1] ?? "",
      label: `CVSS ${match[1] ?? ""}`,
      evidence: [articleIndex + 1],
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

const VERSION_RE = /v?\d+\.\d+(\.\d+)?/g;
const SEMVER_RE = /\b\d+\.\d+\.\d+\b/g;
const PRODUCT_VERSION_RE =
  /\b(GPT|Gemini|Claude|Sonnet|Haiku|Mixtral|Llama|Android|iOS|macOS|Windows|Linux)\s*[\s-]*v?\d+(\.\d+)?/gi;

export interface ExtractedVersion {
  value: string;
  label: string;
  evidence: number[];
}

export function extractVersions(text: string, articleIndex: number): ExtractedVersion[] {
  const results: ExtractedVersion[] = [];
  const seen = new Set<string>();

  // Product-specific versions first (higher confidence)
  let match;
  const productRe = new RegExp(PRODUCT_VERSION_RE.source, PRODUCT_VERSION_RE.flags);
  while ((match = productRe.exec(text)) !== null) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    results.push({ value: match[0], label: match[0], evidence: [articleIndex + 1] });
  }

  // Generic semver
  const semverRe = new RegExp(SEMVER_RE.source, SEMVER_RE.flags);
  while ((match = semverRe.exec(text)) !== null) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    results.push({ value: match[0], label: match[0], evidence: [articleIndex + 1] });
  }

  // Generic version patterns
  const verRe = new RegExp(VERSION_RE.source, VERSION_RE.flags);
  while ((match = verRe.exec(text)) !== null) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    results.push({ value: match[0], label: match[0], evidence: [articleIndex + 1] });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

const COUNT_RE =
  /(\d+)\s+(article|articles|source|sources|outlet|outlets|job|jobs|position|positions|employee|employees|staff|worker|workers|user|users|customer|customers|member|members|subscriber|subscribers|reader|readers|view|views|visit|visits|download|downloads|install|installs|download|downloads)\b/gi;

export interface ExtractedCount {
  value: string;
  label: string;
  evidence: number[];
}

export function extractCounts(text: string, articleIndex: number): ExtractedCount[] {
  const results: ExtractedCount[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = COUNT_RE.exec(text)) !== null) {
    const key = `${match[1] ?? ""}-${(match[2] ?? "").toLowerCase()}-${articleIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      value: `${match[1] ?? ""} ${match[2] ?? ""}`,
      label: `${match[1] ?? ""} ${match[2] ?? ""}`,
      evidence: [articleIndex + 1],
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Companies (named entity dictionary)
// ---------------------------------------------------------------------------

const KNOWN_COMPANIES = [
  "OpenAI",
  "Anthropic",
  "Google",
  "Alphabet",
  "Microsoft",
  "Amazon",
  "AWS",
  "Meta",
  "Facebook",
  "Apple",
  "Nvidia",
  "Tesla",
  "SpaceX",
  "xAI",
  "DeepSeek",
  "Mistral",
  "Cohere",
  "Databricks",
  "Stripe",
  "Cloudflare",
  "Hugging Face",
  "Anthropic",
  "Perplexity",
  "Notion",
  "Figma",
  "Linear",
  "Vercel",
  "Supabase",
  "PlanetScale",
  "Neon",
  "Railway",
  "Render",
  "Circle",
  "Coinbase",
  "PayPal",
  "Square",
  "Block",
  "Robinhood",
  "JPMorgan",
  "Goldman Sachs",
  "Morgan Stanley",
  "Citigroup",
  "Reuters",
  "Bloomberg",
  "AP",
  "NYT",
  "Washington Post",
  "WSJ",
  "The Verge",
  "TechCrunch",
  "Wired",
  "Ars Technica",
  "The Information",
  "Semiconductor",
  "TSMC",
  "Intel",
  "AMD",
  "Qualcomm",
  "Broadcom",
  "Samsung",
  "SK Hynix",
  "Micron",
  "ASML",
  "Tokyo Electron",
];

const COMPANY_RE = new RegExp(
  `\\b(${KNOWN_COMPANIES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi",
);
const COMPANY_NAMES = canonicalLookup(KNOWN_COMPANIES);

export interface ExtractedCompany {
  value: string;
  label: string;
  evidence: number[];
}

export function extractCompanies(text: string, articleIndex: number): ExtractedCompany[] {
  const results: ExtractedCompany[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = COMPANY_RE.exec(text)) !== null) {
    const name = COMPANY_NAMES.get(match[0].toLowerCase())!;
    if (seen.has(name)) continue;
    seen.add(name);
    results.push({ value: name, label: name, evidence: [articleIndex + 1] });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

const KNOWN_COUNTRIES = [
  "United States",
  "America",
  "US",
  "USA",
  "United Kingdom",
  "UK",
  "Britain",
  "China",
  "Japan",
  "Germany",
  "France",
  "India",
  "Canada",
  "Australia",
  "Brazil",
  "Russia",
  "South Korea",
  "Taiwan",
  "Israel",
  "Iran",
  "European Union",
  "EU",
  "European Commission",
  "California",
  "Texas",
  "New York",
  "Washington",
  "London",
  "Tokyo",
  "Beijing",
  "Shanghai",
  "Seoul",
  "Berlin",
  "Paris",
  "Mumbai",
  "Nigeria",
  "Kenya",
  "South Africa",
  "Mexico",
  "Argentina",
  "Chile",
  "Saudi Arabia",
  "UAE",
  "Singapore",
  "Hong Kong",
];

const COUNTRY_RE = new RegExp(
  `\\b(${KNOWN_COUNTRIES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi",
);
const COUNTRY_NAMES = canonicalLookup(KNOWN_COUNTRIES);

export interface ExtractedCountry {
  value: string;
  label: string;
  evidence: number[];
}

export function extractCountries(text: string, articleIndex: number): ExtractedCountry[] {
  const results: ExtractedCountry[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = COUNTRY_RE.exec(text)) !== null) {
    const name = COUNTRY_NAMES.get(match[0].toLowerCase())!;
    if (seen.has(name)) continue;
    seen.add(name);
    results.push({ value: name, label: name, evidence: [articleIndex + 1] });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const KNOWN_PRODUCTS = [
  "GPT-5",
  "GPT-4",
  "GPT-4o",
  "GPT-4 Turbo",
  "Claude",
  "Claude 3",
  "Claude 3.5",
  "Claude 3 Opus",
  "Claude 3 Sonnet",
  "Claude 3 Haiku",
  "Gemini",
  "Gemini Ultra",
  "Gemini Pro",
  "Gemini Flash",
  "DeepSeek",
  "DeepSeek-V3",
  "DeepSeek-R1",
  "DeepSeek-V4",
  "Llama",
  "Llama 3",
  "Llama 3.1",
  "Llama 4",
  "Mistral",
  "Mistral Large",
  "Mixtral",
  "Cursor",
  "Copilot",
  "GitHub Copilot",
  "React",
  "Next.js",
  "TypeScript",
  "Node.js",
  "Python",
  "Android",
  "iOS",
  "macOS",
  "Windows",
  "Linux",
  "Chrome",
  "Firefox",
  "Safari",
  "Edge",
  "AWS",
  "Azure",
  "GCP",
  "Google Cloud",
  "S3",
  "Lambda",
  "EC2",
  "Cloudflare Workers",
  "Stripe",
  "PayPal",
  "Square",
  "Tesla",
  "Model S",
  "Model 3",
  "Model X",
  "Model Y",
  "iPhone",
  "iPad",
  "MacBook",
  "Mac Studio",
  "Vision Pro",
  "Apple Vision",
  "ChatGPT",
  "Perplexity",
  "Notion",
  "Figma",
  "Linear",
  "Jira",
  "Slack",
  "Zoom",
  "Teams",
  "Discord",
  "GitHub",
  "GitLab",
  "Bitbucket",
  "Docker",
  "Kubernetes",
  "Terraform",
  "Ansible",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "Nvidia",
  "RTX",
  "H100",
  "H200",
  "B200",
  "Blackwell",
  "CUDA",
  "TensorFlow",
  "PyTorch",
  "JAX",
];

const PRODUCT_RE = new RegExp(
  `\\b(${[...KNOWN_PRODUCTS]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})\\b`,
  "gi",
);
const PRODUCT_NAMES = canonicalLookup(KNOWN_PRODUCTS);

export interface ExtractedProduct {
  value: string;
  label: string;
  evidence: number[];
}

export function extractProducts(text: string, articleIndex: number): ExtractedProduct[] {
  const results: ExtractedProduct[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = PRODUCT_RE.exec(text)) !== null) {
    const name = PRODUCT_NAMES.get(match[0].toLowerCase())!;
    if (seen.has(name)) continue;
    seen.add(name);
    results.push({ value: name, label: name, evidence: [articleIndex + 1] });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Tickers
// ---------------------------------------------------------------------------

const TICKER_RE = /\$\b([A-Z]{1,5})\b/g;
const KNOWN_TICKERS = [
  "NVDA",
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "META",
  "TSLA",
  "AVGO",
  "JPM",
  "GS",
  "MS",
  "C",
  "WFC",
  "BAC",
  "BRK",
  "V",
  "MA",
  "PYPL",
  "NFLX",
  "DIS",
  "CMCSA",
  "ADBE",
  "CRM",
  "ORCL",
  "IBM",
  "INTC",
  "AMD",
  "QCOM",
  "TXN",
  "MU",
  "AMAT",
  "LRCX",
  "ASML",
  "TSM",
  "COIN",
  "HOOD",
  "SQ",
  "STRIPE",
  "CRWD",
  "PANW",
  "ZS",
  "DDOG",
  "MDB",
  "SNOW",
  "PLTR",
  "UBER",
  "LYFT",
  "ABNB",
  "BKNG",
];

const TICKER_KNOWN_RE = new RegExp(`\\b(${KNOWN_TICKERS.join("|")})\\b`, "g");

export interface ExtractedTicker {
  value: string;
  label: string;
  evidence: number[];
}

export function extractTickers(text: string, articleIndex: number): ExtractedTicker[] {
  const results: ExtractedTicker[] = [];
  const seen = new Set<string>();

  // Known tickers first
  let match;
  while ((match = TICKER_KNOWN_RE.exec(text)) !== null) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    results.push({ value: match[0], label: match[0], evidence: [articleIndex + 1] });
  }

  // $TICKER patterns
  const dollarRe = new RegExp(TICKER_RE.source, TICKER_RE.flags);
  while ((match = dollarRe.exec(text)) !== null) {
    const ticker = match[1] ?? "";
    if (KNOWN_TICKERS.includes(ticker)) continue; // already caught above
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    results.push({ value: ticker, label: ticker, evidence: [articleIndex + 1] });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Layoff counts
// ---------------------------------------------------------------------------

const LAYOFF_RE =
  /(\d+)\s+(?:job|jobs|position|positions|employee|employees|staff|worker|workers|role|roles)\s+(?:will be|were|have been|are being|cut|eliminated|reduced|laid off|lost)/gi;
const LAYOFF_ALT_RE =
  /(?:layoff|laid off|job cuts|workforce reduction)\s*(?:of|affecting)?\s*(\d+)/gi;

export interface ExtractedLayoff {
  value: string;
  label: string;
  evidence: number[];
}

export function extractLayoffs(text: string, articleIndex: number): ExtractedLayoff[] {
  const results: ExtractedLayoff[] = [];
  const seen = new Set<string>();

  for (const regex of [LAYOFF_RE, LAYOFF_ALT_RE]) {
    let match;
    const re = new RegExp(regex.source, regex.flags);
    while ((match = re.exec(text)) !== null) {
      const count = match[1] ?? match[0];
      if (seen.has(count)) continue;
      seen.add(count);
      results.push({ value: count, label: `${count} jobs`, evidence: [articleIndex + 1] });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Government/regulatory actions
// ---------------------------------------------------------------------------

const REGULATORY_RE =
  /(fine|penalty|sanction|ruling|ban|prohibition|regulation|executive order|bill|law|act|court ruling|antitrust|investigation|compliance|violation|settlement)\s+(?:of|for|against|on|by|with)\s+(\$?[\d,.]+\s*(?:million|billion|m|b)?|\w+)/gi;
const FINE_RE = /(?:fined|fine|penalty)\s+(\$?[\d,.]+\s*(?:million|billion|m|b)?)/gi;

export interface ExtractedRegulatory {
  value: string;
  label: string;
  evidence: number[];
}

export function extractRegulatoryActions(
  text: string,
  articleIndex: number,
): ExtractedRegulatory[] {
  const results: ExtractedRegulatory[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = FINE_RE.exec(text)) !== null) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    results.push({ value: match[0], label: match[0], evidence: [articleIndex + 1] });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Master extraction function
// ---------------------------------------------------------------------------

export interface ExtractedFacts {
  money: ExtractedMoney[];
  percentages: ExtractedPercentage[];
  dates: ExtractedDate[];
  cves: ExtractedCVE[];
  cvss: ExtractedCVSS[];
  versions: ExtractedVersion[];
  counts: ExtractedCount[];
  companies: ExtractedCompany[];
  countries: ExtractedCountry[];
  products: ExtractedProduct[];
  tickers: ExtractedTicker[];
  layoffs: ExtractedLayoff[];
  regulatoryActions: ExtractedRegulatory[];
}

export function extractFacts(text: string, articleIndex: number): ExtractedFacts {
  return {
    money: extractMoney(text, articleIndex),
    percentages: extractPercentages(text, articleIndex),
    dates: extractDates(text, articleIndex),
    cves: extractCVEs(text, articleIndex),
    cvss: extractCVSS(text, articleIndex),
    versions: extractVersions(text, articleIndex),
    counts: extractCounts(text, articleIndex),
    companies: extractCompanies(text, articleIndex),
    countries: extractCountries(text, articleIndex),
    products: extractProducts(text, articleIndex),
    tickers: extractTickers(text, articleIndex),
    layoffs: extractLayoffs(text, articleIndex),
    regulatoryActions: extractRegulatoryActions(text, articleIndex),
  };
}

/**
 * Compare extracted facts against AI-extracted facts.
 *
 * Returns agreement metrics for each category.
 */
export interface ComparisonResult {
  category: string;
  codeCount: number;
  aiCount: number;
  exactMatches: number;
  partialMatches: number;
  falsePositives: number;
  falseNegatives: number;
  agreementRate: number;
}

export function compareExtraction(
  codeFacts: ExtractedFacts,
  aiFacts: Record<string, string[]>,
): ComparisonResult[] {
  const categories: { key: keyof ExtractedFacts; label: string }[] = [
    { key: "money", label: "money" },
    { key: "percentages", label: "percentages" },
    { key: "dates", label: "dates" },
    { key: "cves", label: "CVE IDs" },
    { key: "cvss", label: "CVSS scores" },
    { key: "versions", label: "versions" },
    { key: "counts", label: "counts" },
    { key: "companies", label: "companies" },
    { key: "countries", label: "countries" },
    { key: "products", label: "products" },
    { key: "tickers", label: "tickers" },
    { key: "layoffs", label: "layoffs" },
    { key: "regulatoryActions", label: "regulatory actions" },
  ];

  return categories.map(({ key, label }) => {
    const codeValues = new Set(
      (codeFacts[key] as unknown as { value: string }[]).map((v) => v.value.toLowerCase().trim()),
    );
    const aiValues = new Set((aiFacts[key] ?? []).map((v) => v.toLowerCase().trim()));

    if (codeValues.size === 0 && aiValues.size === 0) {
      return {
        category: label,
        codeCount: 0,
        aiCount: 0,
        exactMatches: 0,
        partialMatches: 0,
        falsePositives: 0,
        falseNegatives: 0,
        agreementRate: 1.0,
      };
    }

    let exactMatches = 0;
    let partialMatches = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    const allValues = new Set([...codeValues, ...aiValues]);

    for (const v of allValues) {
      const inCode = codeValues.has(v);
      const inAI = aiValues.has(v);
      if (inCode && inAI) exactMatches++;
      else if (inCode && !inAI) falseNegatives++;
      else if (!inCode && inAI) falsePositives++;
    }

    // Partial match: one contains the other
    for (const cv of codeValues) {
      for (const av of aiValues) {
        if (cv !== av && (cv.includes(av) || av.includes(cv))) {
          partialMatches++;
        }
      }
    }

    const totalCompared = Math.max(codeValues.size, aiValues.size);
    const agreementRate = totalCompared > 0 ? (exactMatches + partialMatches) / totalCompared : 1.0;

    return {
      category: label,
      codeCount: codeValues.size,
      aiCount: aiValues.size,
      exactMatches,
      partialMatches,
      falsePositives,
      falseNegatives,
      agreementRate,
    };
  });
}
