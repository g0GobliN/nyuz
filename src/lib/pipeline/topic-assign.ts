/**
 * Deterministic topic and tag assignment.
 *
 * This module assigns topics and tags to events using keyword matching
 * against the topic pool. It does NOT call the AI model — it uses
 * pure string matching against the same pool that the AI model uses.
 *
 * The results are used directly in production. Shadow comparison is still
 * recorded for observability.
 *
 * See docs/track.md phase 7 for the shadow measurement framework.
 */

import { TOPIC_POOL, IGNORE_POOL } from "@/lib/topics-pool";
import { normaliseText, topicTerms, mentions, matchesTerms } from "@/lib/topics";

// ---------------------------------------------------------------------------
// Topic keyword mapping
// ---------------------------------------------------------------------------

/**
 * Keywords that indicate an event belongs to a specific topic.
 *
 * These are used for deterministic assignment when the AI model
 * would normally decide. The mapping is intentionally simple —
 * it captures the most obvious signals.
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  World: [
    "world",
    "global",
    "international",
    "foreign",
    "diplomacy",
    "geopolitics",
    "summit",
    "treaty",
    "alliance",
    "un",
  ],
  Politics: [
    "politics",
    "government",
    "election",
    "vote",
    "congress",
    "parliament",
    "senate",
    "white house",
    "president",
    "prime minister",
    "democrat",
    "republican",
    "legislation",
    "bill",
    "policy",
    "administration",
    "cabinet",
    "minister",
    "regulatory",
  ],
  Sports: [
    "sports",
    "game",
    "match",
    "tournament",
    "championship",
    "league",
    "player",
    "coach",
    "team",
    "score",
    "goal",
    "penalty",
    "olympics",
    "nba",
    "nfl",
    "mlb",
    "nhl",
    "fifa",
    "uefa",
  ],
  Music: [
    "music",
    "song",
    "album",
    "artist",
    "singer",
    "band",
    "concert",
    "tour",
    "lyrics",
    "melody",
    "rhythm",
    "genre",
    "pop",
    "rock",
    "hip hop",
    "jazz",
    "classical",
  ],
  Gaming: [
    "game",
    "gaming",
    "video game",
    "esports",
    "guild",
    "raid",
    "npc",
    "mmo",
    "rpg",
    "fps",
    "console",
    "playstation",
    "xbox",
    "nintendo",
    "steam",
    "twitch",
    "streamer",
  ],
  Film: [
    "film",
    "movie",
    "cinema",
    "director",
    "actor",
    "actress",
    "oscar",
    "academy award",
    "box office",
    "screenplay",
    "sequel",
    "franchise",
    "blockbuster",
    "premiere",
  ],
  Climate: [
    "climate",
    "weather",
    "hurricane",
    "tornado",
    "flood",
    "drought",
    "temperature",
    "emissions",
    "carbon",
    "greenhouse",
    "warming",
    "ice cap",
    "sea level",
    "renewable",
    "solar",
    "wind",
  ],
  Economy: [
    "economy",
    "market",
    "stock",
    "trade",
    "inflation",
    "recession",
    "gdp",
    "unemployment",
    "interest rate",
    "fiscal",
    "monetary",
    "supply chain",
    "tariff",
    "import",
    "export",
    "revenue",
    "profit",
    "loss",
    "quarterly",
  ],
  Health: [
    "health",
    "medical",
    "hospital",
    "doctor",
    "patient",
    "disease",
    "treatment",
    "pharmaceutical",
    "drug",
    "vaccine",
    "pandemic",
    "epidemic",
    "symptom",
    "diagnosis",
    "therapy",
    "clinical trial",
  ],
  AI: [
    "artificial intelligence",
    "ai",
    "machine learning",
    "deep learning",
    "neural network",
    "llm",
    "large language model",
    "generative",
    "prompt",
    "inference",
    "training data",
    "model parameter",
  ],
  OpenAI: ["openai", "gpt", "chatgpt", "openai gpt"],
  Anthropic: ["anthropic", "claude ai"],
  Claude: ["claude", "anthropic"],
  NVIDIA: ["nvidia", "gpu", "cuda", "rtx", "blackwell", "hopper", "tesla"],
  Cursor: ["cursor", "ai code editor"],
  React: ["react", "reactjs"],
  "Next.js": ["next.js", "nextjs", "next"],
  TypeScript: ["typescript", "ts"],
  Startups: [
    "startup",
    "startup company",
    "founder",
    "founding",
    "seed round",
    "series a",
    "series b",
    "series c",
    "venture capital",
    "vc",
    "pitch",
    "incubator",
    "accelerator",
  ],
  Cybersecurity: [
    "cybersecurity",
    "cyber security",
    "hack",
    "hacker",
    "breach",
    "vulnerability",
    "exploit",
    "malware",
    "ransomware",
    "phishing",
    "firewall",
    "encryption",
    "zero day",
    "cve",
    "cvss",
    "security",
  ],
  Funding: [
    "funding",
    "fundraise",
    "investment",
    "investor",
    "round",
    "valuation",
    "unicorn",
    "ipo",
    "acquisition",
    "merger",
    "buyout",
    "capital",
    "equity",
    "debt",
  ],
  Chips: [
    "chip",
    "semiconductor",
    "processor",
    "microchip",
    "fabrication",
    "foundry",
    "tsmc",
    "intel",
    "amd",
    "qualcomm",
    "broadcom",
    "asml",
  ],
  "Open source": [
    "open source",
    "opensource",
    "github",
    "gitlab",
    "repository",
    "pull request",
    "contributor",
    "license",
    "fork",
    "merge",
  ],
  Robotics: [
    "robot",
    "robotics",
    "autonomous",
    "drone",
    "humanoid",
    "manipulator",
    "sensor",
    "actuator",
  ],
  Linux: ["linux", "ubuntu", "debian", "fedora", "arch", "centos", "rhel", "kernel"],
  Hardware: ["hardware", "cpu", "ram", "storage", "ssd", "hdd", "motherboard", "gpu", "processor"],
  "Developer tools": [
    "developer tool",
    "ide",
    "editor",
    "compiler",
    "debugger",
    "cli",
    "terminal",
    "docker",
    "kubernetes",
    "terraform",
    "ci/cd",
    "pipeline",
    "deployment",
  ],
  "Consumer tech": [
    "consumer",
    "smartphone",
    "tablet",
    "laptop",
    "desktop",
    "wearable",
    "smart home",
    "iot",
    "device",
    "app",
    "mobile",
  ],
};

// ---------------------------------------------------------------------------
// Tag keywords
// ---------------------------------------------------------------------------

const TAG_KEYWORDS: Record<string, string[]> = {
  funding: [
    "funding",
    "investment",
    "raise",
    "valuation",
    "round",
    "unicorn",
    "ipo",
    "acquisition",
  ],
  cybersecurity: [
    "hack",
    "breach",
    "vulnerability",
    "exploit",
    "malware",
    "ransomware",
    "phishing",
    "cve",
    "zero day",
  ],
  layoffs: ["layoff", "job cuts", "workforce reduction", "reduction in force", "rif"],
  regulation: [
    "regulation",
    "fine",
    "penalty",
    "sanction",
    "ban",
    "antitrust",
    "investigation",
    "compliance",
  ],
  "product launch": [
    "launch",
    "release",
    "shipping",
    "beta",
    "general availability",
    "ga",
    "available now",
  ],
  partnership: [
    "partnership",
    "collaboration",
    "joint venture",
    "teaming",
    "integrate",
    "integrates",
  ],
  acquisition: ["acquire", "acquisition", "buy", "purchase", "takeover", "merger"],
  research: ["research", "paper", "study", "findings", "discovery", "breakthrough"],
  controversy: ["controversy", "lawsuit", "scandal", "allegations", "accusation", "investigation"],
  expansion: ["expand", "growth", "new market", "entering", "launching in", "opening"],
};

// ---------------------------------------------------------------------------
// Topic assignment
// ---------------------------------------------------------------------------

/**
 * Deterministically assign topics to an event based on its text content.
 *
 * Uses keyword matching against the TOPIC_POOL. For each topic, counts how many
 * of its associated keywords the normalised text actually mentions.
 *
 * ---------------------------------------------------------------------------
 * Why `mentions` and not `includes`
 * ---------------------------------------------------------------------------
 *
 * This used to be `normalised.includes(keyword)`, plain substring containment,
 * and the keyword lists contain two-letter entries: `ts` for TypeScript, `ai`
 * for AI, `un` for World. Substring containment finds `ts` inside "releases",
 * "protests" and "data centers", `ai` inside "chair", "said" and "maintain",
 * and `un` inside "under". Measured against 126 live events on 2026-09-08, that
 * labelled an anime round-up as Next.js and Economy, the Eiffel Tower closing
 * as AI and Developer tools, and a food-safety story as TypeScript.
 *
 * That was already wrong where these labels are shown to readers. It became
 * load-bearing when 0068 made the same function decide what nyuz pays to
 * analyse: at those rates 74% of everything ingested reaches some reader, which
 * is the "analyse the whole internet" outcome the demand gate exists to prevent.
 *
 * `mentions` from topics.ts is the word-boundary test the rest of the product
 * already matches on — exact-word for terms under three characters, word-start
 * otherwise, containment for unspaced scripts. Using it here means the
 * classifier, the matcher and the reader's own interests all agree on what it
 * means for a text to be about something.
 *
 * Returns topics sorted by confidence (number of keyword matches).
 */
export function assignTopics(text: string): string[] {
  const normalised = normaliseText(text).toLowerCase();
  const scored: { topic: string; score: number }[] = [];

  for (const topic of TOPIC_POOL) {
    const keywords = TOPIC_KEYWORDS[topic];
    if (!keywords) continue;

    let score = 0;
    for (const keyword of keywords) {
      if (mentions(normalised, keyword.toLowerCase())) {
        score++;
      }
    }

    if (score > 0) {
      scored.push({ topic, score });
    }
  }

  // Sort by score descending, then alphabetically for stability
  scored.sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic));

  // Return top topics, max 5
  return scored.slice(0, 5).map((s) => s.topic);
}

/**
 * Deterministically assign tags to an event based on its text content.
 *
 * Uses keyword matching against TAG_KEYWORDS.
 */
export function assignTags(text: string): string[] {
  const normalised = normaliseText(text).toLowerCase();
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    for (const keyword of keywords) {
      // Word boundaries, for the reason `assignTopics` documents at length.
      if (mentions(normalised, keyword.toLowerCase())) {
        if (!seen.has(tag)) {
          seen.add(tag);
          tags.push(tag);
        }
        break;
      }
    }
  }

  return tags.slice(0, 8);
}

/**
 * Assign topics using the same matching logic as `matchesTerms` from topics.ts.
 *
 * This provides a more rigorous check that mirrors how the selector
 * matches topics against reader interests.
 */
export function assignTopicsByTerms(text: string): string[] {
  const normalised = normaliseText(text);
  const assigned: string[] = [];

  for (const topic of TOPIC_POOL) {
    const terms = topicTerms(topic);
    if (terms.length > 0 && matchesTerms(normalised, terms)) {
      assigned.push(topic);
    }
  }

  return assigned.slice(0, 5);
}

/**
 * Compare code-assigned topics against AI-assigned topics.
 *
 * Returns comparison metrics for shadow mode.
 */
export interface TopicComparisonResult {
  category: string;
  codeCount: number;
  aiCount: number;
  exactMatches: number;
  partialMatches: number;
  falsePositives: number;
  falseNegatives: number;
  agreementRate: number;
}

export function compareTopics(codeTopics: string[], aiTopics: string[]): TopicComparisonResult {
  const codeSet = new Set(codeTopics.map((t) => t.toLowerCase().trim()));
  const aiSet = new Set(aiTopics.map((t) => t.toLowerCase().trim()));

  let exactMatches = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const t of codeSet) {
    if (aiSet.has(t)) exactMatches++;
    else falseNegatives++;
  }
  for (const t of aiSet) {
    if (!codeSet.has(t)) falsePositives++;
  }

  const totalCompared = Math.max(codeSet.size, aiSet.size);
  const agreementRate = totalCompared > 0 ? exactMatches / totalCompared : 1.0;

  return {
    category: "topics",
    codeCount: codeSet.size,
    aiCount: aiSet.size,
    exactMatches,
    partialMatches: 0,
    falsePositives,
    falseNegatives,
    agreementRate,
  };
}

export function compareTags(codeTags: string[], aiTags: string[]): TopicComparisonResult {
  const codeSet = new Set(codeTags.map((t) => t.toLowerCase().trim()));
  const aiSet = new Set(aiTags.map((t) => t.toLowerCase().trim()));

  let exactMatches = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const t of codeSet) {
    if (aiSet.has(t)) exactMatches++;
    else falseNegatives++;
  }
  for (const t of aiSet) {
    if (!codeSet.has(t)) falsePositives++;
  }

  const totalCompared = Math.max(codeSet.size, aiSet.size);
  const agreementRate = totalCompared > 0 ? exactMatches / totalCompared : 1.0;

  return {
    category: "tags",
    codeCount: codeSet.size,
    aiCount: aiSet.size,
    exactMatches,
    partialMatches: 0,
    falsePositives,
    falseNegatives,
    agreementRate,
  };
}
