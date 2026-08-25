import type { Story } from "@/lib/story";
export { IGNORE_POOL, TOPIC_POOL } from "@/lib/topics-pool";

export type { Story } from "@/lib/story";
export type Profile = "developer" | "founder" | "investor" | "researcher";

const src = (names: string[]): { name: string; at: string }[] =>
  names.map((n, i) => ({ name: n, at: `0${4 + i}:${(11 + i * 7) % 60}`.padEnd(5, "0") }));

/**
 * Today, at the clock time a fixture carries.
 *
 * The fixtures are presented as *this morning's* briefing, so their dates are
 * built from the current day rather than frozen into the file. A hard-coded
 * date would have the sample dashboard advertising a week-old briefing by next
 * week — precisely the confusion the date was added to remove.
 *
 * Evaluated once when the module loads. These are demo fixtures; a tab left
 * open across midnight is not worth a ticking clock.
 */
function todayAt(time: string): string {
  const [h, m] = time.split(":");
  const d = new Date();
  d.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
  return d.toISOString();
}

const STORY_FIXTURES: Omit<Story, "publishedAt">[] = [
  {
    id: "openai-realtime",
    org: "OpenAI",
    title: "OpenAI ships a lower-latency realtime model tier",
    what: "OpenAI made a faster realtime tier generally available, with streaming audio and tool calls in the same session. Pricing moves to a per-minute model for audio.",
    why: "If you build voice or agent features, latency budgets and cost per session both change.",
    importance: "High",
    score: { relevance: 94, importance: 91, novelty: 87 },
    sources: 12,
    topics: ["AI", "OpenAI", "Developer Tools"],
    time: "06:12",
    sourceList: src([
      "OpenAI blog",
      "Hacker News",
      "TechCrunch",
      "The Verge",
      "Ars Technica",
      "Simon Willison",
    ]),
    before: "Realtime access limited, latency variable, audio billed per token.",
    after: "General availability, lower latency tier, per-minute audio pricing.",
    timeline: [
      { at: "04:02", label: "Changelog entry appears" },
      { at: "04:40", label: "First reports published" },
      { at: "05:58", label: "12 sources clustered into one event" },
      { at: "06:12", label: "Event scored and matched to your nyuz" },
    ],
  },
  {
    id: "cursor-review",
    org: "Cursor",
    title: "Cursor adds background agents that review pull requests",
    what: "Cursor introduced agents that run against a repository and leave review comments before a human opens the diff. It runs on your existing model provider keys.",
    why: "This changes where review time is spent in a team workflow.",
    importance: "High",
    score: { relevance: 92, importance: 84, novelty: 90 },
    sources: 8,
    topics: ["Developer Tools", "AI", "Cursor"],
    time: "05:41",
    sourceList: src(["Cursor changelog", "Hacker News", "X threads", "TechCrunch"]),
    before: "Assistance inside the editor only.",
    after: "Repository-level agents that comment on pull requests.",
    timeline: [
      { at: "03:20", label: "Changelog published" },
      { at: "04:15", label: "Discussion picks up" },
      { at: "05:41", label: "Event finalised" },
    ],
  },
  {
    id: "react-compiler",
    org: "React",
    title: "React compiler reaches a stable release line",
    what: "The React team moved the compiler out of release-candidate status and documented the migration path for existing memoized components.",
    why: "Manual memoization in your codebase can start coming out.",
    importance: "Medium",
    score: { relevance: 88, importance: 76, novelty: 71 },
    sources: 6,
    topics: ["React", "Developer Tools"],
    time: "05:02",
    sourceList: src(["React blog", "GitHub releases", "Hacker News"]),
    before: "Compiler behind a flag, RC status.",
    after: "Stable line with documented migration.",
    timeline: [
      { at: "02:50", label: "Release tagged on GitHub" },
      { at: "05:02", label: "Event finalised" },
    ],
  },
  {
    id: "anthropic-enterprise",
    org: "Anthropic",
    title: "Anthropic expands long-context tooling for enterprise workloads",
    what: "New retrieval and caching primitives cut repeated context costs for long-running assistants, alongside stricter workspace-level controls.",
    why: "Context caching directly affects the cost model of assistant products.",
    importance: "Medium",
    score: { relevance: 86, importance: 80, novelty: 68 },
    sources: 9,
    topics: ["AI", "Anthropic"],
    time: "04:48",
    sourceList: src(["Anthropic news", "Reuters", "The Information", "Hacker News"]),
    before: "Context re-sent per request.",
    after: "Cached context with workspace controls.",
    timeline: [
      { at: "03:10", label: "Announcement posted" },
      { at: "04:48", label: "Event finalised" },
    ],
  },
  {
    id: "nvidia-supply",
    org: "NVIDIA",
    title: "NVIDIA signals shifting allocation for next-generation accelerators",
    what: "Supply commentary points to earlier availability for mid-tier accelerator SKUs, with data-centre allocations still constrained.",
    why: "Availability shifts change training and inference planning.",
    importance: "Notable",
    score: { relevance: 79, importance: 82, novelty: 64 },
    sources: 15,
    topics: ["Chips", "AI", "NVIDIA"],
    time: "04:20",
    sourceList: src(["NVIDIA newsroom", "Reuters", "Bloomberg", "SemiAnalysis"]),
    before: "Mid-tier SKUs quoted with long lead times.",
    after: "Earlier availability signalled for mid-tier parts.",
    timeline: [
      { at: "01:40", label: "Supply chain reports" },
      { at: "04:20", label: "Event finalised" },
    ],
  },
  {
    id: "ts-perf",
    org: "TypeScript",
    title: "TypeScript lands a large type-checking performance change",
    what: "A rewrite of a hot path in the checker reduces cold check times on large monorepos in the team's published benchmarks.",
    why: "Editor responsiveness and CI time on big repos are affected.",
    importance: "Notable",
    score: { relevance: 81, importance: 70, novelty: 66 },
    sources: 5,
    topics: ["TypeScript", "Developer Tools"],
    time: "03:55",
    sourceList: src(["TypeScript blog", "GitHub", "Hacker News"]),
    before: "Cold checks slow on large monorepos.",
    after: "Measured reduction in cold check time.",
    timeline: [{ at: "03:55", label: "Event finalised" }],
  },
];

export const PROFILE_BRIEFS: Record<
  Profile,
  { label: string; topics: string[]; storyIds: string[] }
> = {
  developer: {
    label: "Developer",
    topics: ["AI", "React", "TypeScript", "GitHub", "Developer tools"],
    storyIds: ["openai-realtime", "cursor-review", "react-compiler", "ts-perf"],
  },
  founder: {
    label: "Founder",
    topics: ["Startups", "Funding", "Competitors", "AI", "SaaS"],
    storyIds: ["anthropic-enterprise", "openai-realtime", "nvidia-supply", "cursor-review"],
  },
  investor: {
    label: "Investor",
    topics: ["Companies", "Funding", "Acquisitions", "Markets", "Technology"],
    storyIds: ["nvidia-supply", "anthropic-enterprise", "openai-realtime"],
  },
  researcher: {
    label: "AI Researcher",
    topics: ["Papers", "Models", "Benchmarks", "Labs"],
    storyIds: ["anthropic-enterprise", "openai-realtime", "nvidia-supply"],
  },
};

export const STORIES: Story[] = STORY_FIXTURES.map((s) => ({
  ...s,
  publishedAt: todayAt(s.time),
}));

export const storyById = (id: string) => STORIES.find((s) => s.id === id);

export const NOISE_LINES = [
  "OpenAI updates its changelog",
  "Someone rewrote their blog in Rust",
  "10 VS Code extensions you must try",
  "Thread: why this changes everything",
  "GitHub release v3.4.1",
  "Reddit: is React dead yet?",
  "Newsletter #418 is out",
  "Weekly digest of weekly digests",
  "Hot take on AI regulation",
  "NVIDIA earnings preview",
  "Anthropic posts a research note",
  "Yet another JS framework",
  "Show HN: my side project",
  "Startup raises undisclosed round",
  "Podcast episode 212",
  "TypeScript 5.x beta notes",
  "A very long Twitter thread",
  "Blog: my 2026 dev setup",
  "Cursor changelog updated",
  "Live: keynote streaming now",
  "Rumour: new chip in spring",
  "Comment section disagreement",
];

export const SOURCE_GROUPS = [
  {
    group: "Official company blogs",
    count: 84,
    items: ["OpenAI", "Anthropic", "NVIDIA", "Vercel", "Cursor", "Stripe"],
  },
  { group: "News sites", count: 62, items: ["Reuters", "TechCrunch", "The Verge", "Ars Technica"] },
  { group: "RSS", count: 96, items: ["Personal blogs", "Engineering blogs", "Changelog feeds"] },
  { group: "GitHub", count: 41, items: ["Releases", "RFCs", "Changelogs"] },
  { group: "Research", count: 28, items: ["arXiv", "Lab publications"] },
  { group: "Product announcements", count: 16, items: ["Launch pages", "Status pages"] },
];

export const HISTORY = [
  { date: "August 22", weekday: "Friday", count: 6, headline: "OpenAI realtime tier goes GA" },
  { date: "August 21", weekday: "Thursday", count: 8, headline: "Cursor background review agents" },
  { date: "August 20", weekday: "Wednesday", count: 4, headline: "React compiler stable line" },
  { date: "August 19", weekday: "Tuesday", count: 0, headline: "Nothing important for your nyuz" },
  { date: "August 18", weekday: "Monday", count: 7, headline: "NVIDIA allocation commentary" },
];

export const WATCHING = [
  { topic: "AI", weight: 100 },
  { topic: "Developer Tools", weight: 82 },
  { topic: "Startups", weight: 54 },
  { topic: "React", weight: 41 },
  { topic: "Chips", weight: 28 },
];
