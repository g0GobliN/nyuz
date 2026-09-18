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
import { normaliseText, topicTerms, matchesTerms, mentionsWord } from "@/lib/topics";

// ---------------------------------------------------------------------------
// Topic keyword mapping
// ---------------------------------------------------------------------------

/**
 * What each editorial topic is recognised by, split into two strengths.
 *
 * ---------------------------------------------------------------------------
 * Why two strengths and not one list
 * ---------------------------------------------------------------------------
 *
 * A single flat list makes every keyword a sufficient condition, so the whole
 * label rests on the weakest word in it. Live examples on 2026-09-08:
 * "Germany's far-right breakthrough" came out as Politics, Music, Next.js, and
 * "Tokyo tourist hotspot bans short-term rentals" as Music, World. Nothing was
 * broken in the matcher's own terms — `Music` listed "pop" and "tour", `World`
 * listed "world", `Next.js` listed "next", and the stories contain "populist",
 * "tourist", a "World Discovery/Alamy" photo credit, and the ordinary English
 * word "next". Three separate faults produced that, and all three are fixed
 * here rather than in the examples:
 *
 *   1. **Prefix matching.** `mentions` finds "pop" at the start of "populist".
 *      Right for a reader's own words, wrong for a fixed category list — see
 *      `mentionsWord` in topics.ts, which this now uses instead.
 *
 *   2. **Words that are not evidence.** "next" is never evidence for Next.js;
 *      it is one of the commonest words in English and is simply gone. Terms
 *      that are real signal but ambiguous alone — "tour", "pop", "world",
 *      "hacker", "device" — are `weak`.
 *
 *   3. **One hit was enough.** A topic now needs one `strong` term, or two
 *      distinct `weak` ones. A single ambiguous word can no longer put a label
 *      on a story by itself, which is the property the regression tests pin.
 *
 * ---------------------------------------------------------------------------
 * Which list a term belongs in
 * ---------------------------------------------------------------------------
 *
 * `strong` is for terms that are about the topic in essentially every English
 * sentence they appear in: "semiconductor", "parliament", "ransomware",
 * "album". If you can write a plausible headline in another field containing
 * the term, it is not strong.
 *
 * `weak` is for terms that carry the topic only in company: "tour" (Music, but
 * also tourism and tournaments), "hacker" (Cybersecurity, but also the name of
 * the site half this corpus comes from), "capital" (Funding, but also every
 * capital city), "team", "round", "device", "world".
 *
 * The cost of demoting a term is recall: a real Music story mentioning only
 * "tour" loses its label. That is the trade this file is making on purpose,
 * because since 0068 these labels also decide what nyuz pays to analyse, and a
 * false topic buys an analysis for a story nobody follows.
 */
type TopicVocabulary = {
  /** One mention is evidence enough. */
  strong: readonly string[];
  /** Real signal, ambiguous alone: two distinct hits are needed. */
  weak?: readonly string[];
};

const TOPIC_KEYWORDS: Record<string, TopicVocabulary> = {
  World: {
    strong: ["geopolitics", "geopolitical", "diplomacy", "diplomatic", "treaty", "united nations"],
    weak: ["world", "global", "international", "foreign", "summit", "alliance", "un"],
  },
  Politics: {
    strong: [
      "politics",
      "political",
      "election",
      "electoral",
      "parliament",
      "congress",
      "senate",
      "white house",
      "prime minister",
      "legislation",
      "lawmaker",
      "referendum",
      "democrat",
      "republican",
      "government",
      "minister",
      "voter",
      "ballot",
      "senator",
      "governor",
    ],
    weak: ["vote", "president", "bill", "policy", "administration", "cabinet", "regulatory"],
  },
  Sports: {
    strong: [
      // "sport" singular is here for the section signal `classify.ts` folds in:
      // a "BBC Sport" feed name is the publisher stating the subject outright,
      // and is the strongest evidence available for wire copy that names only
      // clubs and players.
      "sport",
      "olympics",
      "olympic",
      "nba",
      "nfl",
      "mlb",
      "nhl",
      "fifa",
      "uefa",
      "championship",
      "tournament",
      "premier league",
      "world cup",
      "grand slam",
      "wimbledon",
      "quarter final",
      "semi final",
      "footballer",
      "midfielder",
      "striker",
      "athlete",
      "cricket",
      "rugby",
      "tennis",
      "basketball",
      "baseball",
    ],
    // "match" and "score" are absent on purpose: they are ordinary machine-
    // learning vocabulary ("matching", "score function") and together they put
    // Sports on a diffusion-model paper.
    weak: ["game", "league", "player", "coach", "team", "goal", "fixture"],
  },
  Music: {
    strong: [
      "music",
      "musician",
      "song",
      "album",
      "singer",
      "concert",
      "lyrics",
      "soundtrack",
      "spotify",
    ],
    weak: ["artist", "band", "tour", "genre", "pop", "rock", "hip hop", "jazz", "classical"],
  },
  Gaming: {
    strong: [
      "video game",
      "gaming",
      "gamer",
      "esports",
      "gameplay",
      "playstation",
      "xbox",
      "nintendo",
      "twitch",
      "speedrun",
    ],
    weak: ["game", "guild", "raid", "npc", "mmo", "rpg", "fps", "console", "steam", "streamer"],
  },
  Film: {
    strong: [
      "film",
      "movie",
      "cinema",
      "box office",
      "screenplay",
      "oscar",
      "academy award",
      "blockbuster",
    ],
    weak: ["director", "actor", "actress", "sequel", "franchise", "premiere"],
  },
  Climate: {
    strong: [
      "climate",
      "emissions",
      "greenhouse",
      "global warming",
      "sea level",
      "hurricane",
      "tornado",
      "drought",
      "wildfire",
    ],
    weak: ["weather", "flood", "temperature", "carbon", "warming", "ice cap", "renewable", "solar"],
  },
  Economy: {
    strong: [
      "economy",
      "economic",
      "inflation",
      "recession",
      "gdp",
      "unemployment",
      "interest rate",
      "tariff",
      "fiscal",
      "monetary",
    ],
    weak: [
      "market",
      "stock",
      "trade",
      "supply chain",
      "import",
      "export",
      "revenue",
      "profit",
      "quarterly",
    ],
  },
  Health: {
    strong: [
      "health",
      "medical",
      "hospital",
      "disease",
      "vaccine",
      "pandemic",
      "epidemic",
      "clinical trial",
      "pharmaceutical",
      "diagnosis",
      "cancer",
      "mental health",
      "nhs",
      "surgery",
    ],
    weak: ["doctor", "patient", "treatment", "drug", "symptom", "therapy"],
  },
  AI: {
    strong: [
      // Two letters, so `mentionsWord` matches it as a whole word only. "AI"
      // standing alone in English is the field; it is not a word otherwise.
      "ai",
      "artificial intelligence",
      "machine learning",
      "deep learning",
      "neural network",
      "llm",
      "large language model",
      "chatbot",
      // The bare word "agent" is deliberately absent -- free agent, estate
      // agent, secret agent, double agent. These phrases are unambiguous.
      "ai agent",
      "ai agents",
      "agentic ai",
      "coding agent",
    ],
    weak: ["generative", "prompt", "inference", "training data", "model parameter"],
  },
  OpenAI: { strong: ["openai", "chatgpt", "gpt"] },
  Anthropic: { strong: ["anthropic", "claude ai", "claude code"] },
  Claude: {
    // "Claude" alone is also a first name -- Claude Monet, Claude Shannon -- so
    // the bare word needs the company beside it.
    strong: ["claude ai", "claude code", "claude opus", "claude sonnet"],
    weak: ["claude", "anthropic"],
  },
  NVIDIA: {
    strong: ["nvidia", "cuda", "geforce"],
    weak: ["gpu", "rtx", "blackwell", "hopper", "tesla"],
  },
  Cursor: {
    strong: ["cursor ai", "cursor ide", "anysphere", "ai code editor"],
    weak: ["cursor"],
  },
  React: {
    // "react" is an ordinary English verb, so it cannot be strong; "reactjs"
    // and "react native" are unambiguous.
    strong: ["reactjs", "react js", "react native", "react hooks"],
    weak: ["react", "jsx"],
  },
  "Next.js": {
    // The bare word "next" used to be here. It is one of the commonest words in
    // English and labelled a German election story Next.js; it is not evidence
    // for anything and is deliberately absent.
    strong: ["nextjs", "next js", "app router"],
    weak: ["vercel"],
  },
  TypeScript: {
    strong: ["typescript"],
    weak: ["ts", "tsx", "type safety"],
  },
  Startups: {
    strong: [
      "startup",
      "founder",
      "co-founder",
      "seed round",
      "series a",
      "series b",
      "series c",
      "venture capital",
      "incubator",
      "accelerator",
      "y combinator",
    ],
    weak: ["founding", "pitch", "vc"],
  },
  Cybersecurity: {
    strong: [
      "cybersecurity",
      "cyber security",
      "malware",
      "ransomware",
      "phishing",
      "vulnerability",
      "zero day",
      "cve",
      "data breach",
      "exploit",
    ],
    // "hacker" is weak because a large share of this corpus arrives from a site
    // called Hacker News, which is not a security signal.
    weak: ["hack", "hacker", "breach", "firewall", "encryption", "cvss", "security"],
  },
  Funding: {
    strong: ["funding", "fundraise", "valuation", "ipo", "unicorn", "seed round", "series a"],
    weak: [
      "investment",
      "investor",
      "round",
      "acquisition",
      "merger",
      "buyout",
      "capital",
      "equity",
      "debt",
    ],
  },
  Chips: {
    strong: ["semiconductor", "microchip", "tsmc", "asml", "foundry", "chipmaker", "fpga"],
    weak: ["chip", "processor", "fabrication", "intel", "amd", "qualcomm", "broadcom"],
  },
  "Open source": {
    strong: ["open source", "opensource", "github", "gitlab", "pull request"],
    weak: ["repository", "contributor", "license", "fork", "merge"],
  },
  Robotics: {
    strong: ["robot", "robotics", "humanoid robot", "autonomous vehicle"],
    // A military drone story is not robotics news, so "drone" needs company.
    weak: ["drone", "autonomous", "humanoid", "manipulator", "actuator", "sensor"],
  },
  Linux: {
    strong: ["linux", "ubuntu", "debian", "fedora", "centos", "rhel", "arch linux"],
    weak: ["kernel", "arch"],
  },
  Hardware: {
    strong: ["hardware", "motherboard", "ssd", "hdd"],
    weak: ["cpu", "gpu", "ram", "storage", "processor", "device"],
  },
  "Developer tools": {
    strong: [
      "developer tool",
      "docker",
      "kubernetes",
      "terraform",
      "ci cd",
      "compiler",
      "debugger",
    ],
    // "ide" used to be found inside "identify"; it is now a whole word, and
    // still only counts alongside a second signal.
    weak: ["ide", "editor", "cli", "terminal", "pipeline", "deployment"],
  },
  "Consumer tech": {
    strong: ["smartphone", "tablet", "laptop", "wearable", "smart home", "iot"],
    weak: ["consumer", "desktop", "device", "app", "mobile"],
  },
  Transport: {
    strong: [
      "rail passenger",
      "rail passengers",
      "train service",
      "train operator",
      "train operators",
      "public transport",
      "public transportation",
      "railway",
      "metro system",
      "transit system",
    ],
    // Bare "station", "line" and "route" are deliberately absent -- none of
    // them are evidence for Transport on their own.
    weak: ["commuter", "subway", "tram", "bus route", "train station"],
  },
  Automotive: {
    strong: [
      "electric vehicle",
      "electric vehicles",
      "ev charger",
      "ev chargers",
      "ev charging",
      "car manufacturer",
      "car manufacturers",
      "automaker",
      "automakers",
      "vehicle recall",
    ],
    weak: ["carmaker", "dealership", "combustion engine", "hybrid vehicle"],
  },
  Energy: {
    strong: [
      "power grid",
      "renewable energy",
      "energy market",
      "electricity prices",
      "solar power",
      "wind power",
      "oil production",
      "gas supply",
      "energy crisis",
    ],
    // Bare "power" and "energy" are deliberately absent -- "political power"
    // and "high-energy performance" are not Energy news.
    weak: ["utility company", "power plant", "fossil fuel", "battery storage"],
  },
  Crime: {
    strong: [
      "murder investigation",
      "stabbing",
      "robbery",
      "armed robbery",
      "arrested",
      "police investigation",
      "criminal charges",
      "homicide",
      "manslaughter",
      "burglary",
      "sexual assault",
    ],
    // "crime" alone stays weak: "crime novel" and "true crime podcast" are not
    // Crime news, so it never carries the topic without a second signal.
    weak: ["suspect", "detective", "crime scene", "prosecutor", "crime"],
  },
  Military: {
    strong: [
      "armed forces",
      "defence ministry",
      "defense ministry",
      "court martial",
      "war crimes",
      "military coup",
      "air force",
      "airstrike",
      "air strikes",
    ],
    // "army", "navy", "military" and "soldier" are all real English words with
    // common non-military senses -- "an army of volunteers", "navy blue",
    // "soldier on", "military-grade encryption" -- so none of them is strong.
    weak: ["army", "navy", "military", "soldier", "soldiers", "troops", "veteran"],
  },
  Education: {
    strong: [
      "university",
      "universities",
      "tuition fees",
      "education ministry",
      "school funding",
      "student loan",
      "student loans",
    ],
    // "college" (as in Electoral College) and bare "student" are ambiguous.
    weak: ["college", "professor", "curriculum", "classroom", "scholarship", "student"],
  },
  Travel: {
    strong: [
      "tourism",
      "tourist",
      "tourists",
      "travel restrictions",
      "visa-free travel",
      "airline passenger",
      "airline passengers",
      "holiday destination",
      "hotel industry",
    ],
    // Bare "travel" is deliberately absent -- "data packets travel across the
    // network" is not Travel news.
    weak: ["visa", "resort", "itinerary", "vacation"],
  },
};

/**
 * How many distinct `weak` terms stand in for one `strong` one.
 *
 * Two, not three: three would cost the label on short wire copy, which is most
 * of what arrives, and two already rules out every case in the report — each of
 * Music, Next.js and World on those stories rested on exactly one word.
 */
const WEAK_TERMS_FOR_EVIDENCE = 2;

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
 * The rule, in full: a topic is assigned when the text mentions one of its
 * `strong` terms, or `WEAK_TERMS_FOR_EVIDENCE` distinct `weak` ones. Matching is
 * `mentionsWord` — whole words with regular inflections, never word prefixes.
 * `TOPIC_KEYWORDS` explains at length why both halves of that are necessary and
 * what shipped without them.
 *
 * Ordering is by evidence: strong hits first, then the number of terms matched,
 * then alphabetically so the result is stable for a given text. Callers take the
 * first few, so the strongest-evidence labels are the ones that survive the cut.
 *
 * This is the only place topics are decided. `classify.ts` calls it to write
 * `event_topic_candidates`, which is what the demand gate spends money on, and
 * `analyse.ts` calls it to write `event_topics`, which is what the reader is
 * matched on and sees. There is no second implementation to drift from it and
 * no model in the path, which is what makes the regression tests in
 * topic-assign.test.ts binding rather than indicative.
 */
export function assignTopics(text: string, title = ""): string[] {
  const normalised = normaliseText(text).toLowerCase();
  const scored: { topic: string; strong: number; total: number }[] = [];

  for (const topic of TOPIC_POOL) {
    const vocabulary = TOPIC_KEYWORDS[topic];
    if (!vocabulary) continue;

    const strong = countMentions(normalised, vocabulary.strong);
    const weak = countMentions(normalised, vocabulary.weak ?? []);
    if (strong === 0 && weak < WEAK_TERMS_FOR_EVIDENCE) continue;

    scored.push({ topic, strong, total: strong + weak });
  }

  scored.sort((a, b) => b.strong - a.strong || b.total - a.total || a.topic.localeCompare(b.topic));

  const labels = scored.map((s) => s.topic);
  return (title ? rankEventTopics(title, "", labels) : labels).slice(0, MAX_ASSIGNED_TOPICS);
}

/** Display order is a central-event decision, never a database row order. */
export function rankEventTopics(title: string, lead: string, labels: string[]): string[] {
  const central = (text: string): string | undefined => {
    if (
      /\b(?:breach|ransomware|data (?:exposure|leak)|accessible outside)\b|\b(?:test|staging) environment\b.*\b(?:access|exposed|customer data)\b/i.test(
        text,
      )
    )
      return "Cybersecurity";
    if (
      /(?:[$€£]\s*[\d,.]+[^.!?]{0,35}\b(?:backing|funding|investment)|\b(?:raised|raises|secured|pledges|donations)\b[^.!?]{0,70}[$€£])/i.test(
        text,
      )
    )
      return "Funding";
    if (/\b(?:election|parliament|senate|legislation|referendum)\b/i.test(text)) return "Politics";
    return undefined;
  };
  const dominant = central(title) ?? central(lead);
  const candidates = [...new Set([...labels, ...(dominant ? [dominant] : [])])];
  const score = (label: string) => {
    const vocabulary = TOPIC_KEYWORDS[label];
    const hits = (text: string) =>
      vocabulary
        ? countMentions(normaliseText(text).toLowerCase(), vocabulary.strong) * 3 +
          countMentions(normaliseText(text).toLowerCase(), vocabulary.weak ?? [])
        : 0;
    return (dominant === label ? 100 : 0) + hits(title) * 8 + hits(lead) * 3;
  };
  return candidates.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

/** How many of these terms the text mentions. Distinct terms, not occurrences. */
function countMentions(normalised: string, terms: readonly string[]): number {
  let hits = 0;
  for (const term of terms) {
    // Terms are normalised the same way the text is. Without this a keyword
    // holding punctuation could never match at all: "next.js" is "next js"
    // after normalisation, and "ci/cd" is "ci cd", so both used to be dead
    // entries -- which is how Next.js came to rest entirely on the bare word
    // "next".
    if (mentionsWord(normalised, normaliseText(term).toLowerCase())) hits++;
  }
  return hits;
}

/** Matches `MAX_TOPICS` in analyse.ts, which slices this again on write. */
const MAX_ASSIGNED_TOPICS = 5;

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
      // Whole words, for the reason `TOPIC_KEYWORDS` documents at length: with
      // prefix matching "ban" reached "bank" and tagged every banking story as
      // regulation. Single-tier rather than strong/weak because a tag is a
      // description of one concrete thing that happened, not a category claim
      // -- and unlike a topic, a tag does not decide what gets analysed.
      if (mentionsWord(normalised, normaliseText(keyword).toLowerCase())) {
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
