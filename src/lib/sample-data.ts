import type { Story } from "@/lib/story";
export { IGNORE_POOL, TOPIC_POOL } from "@/lib/topics-pool";

export type { Story } from "@/lib/story";
export type Profile = "sports" | "music" | "politics" | "gaming" | "tech";

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
    id: "world-talks",
    org: "Reuters",
    title: "Overnight talks stall, then resume before dawn",
    what: "Negotiators walked out after midnight, then returned to the table before morning briefings went out. Several capitals issued matching statements within the hour.",
    why: "If you follow world news, this is the event the rest of the day's coverage is going to orbit.",
    importance: "High",
    score: { relevance: 93, importance: 90, novelty: 84 },
    sources: 18,
    topics: ["World", "Politics"],
    time: "06:18",
    sourceList: src(["Reuters", "BBC World", "AP", "Al Jazeera", "The Guardian"]),
    before: "Talks described as stalled.",
    after: "Session resumed; joint statements issued.",
    timeline: [
      { at: "00:40", label: "Walkout reported" },
      { at: "04:10", label: "Talks resume" },
      { at: "06:18", label: "Event scored and matched to your nyuz" },
    ],
  },
  {
    id: "sports-final",
    org: "ESPN",
    title: "Final decided in extra time, not in the last minute of regulation",
    what: "A late equaliser forced extra time. The winning goal came in the 112th minute, after two sides had already been written off in half-time columns.",
    why: "If this is your team — or the tournament you follow — yesterday's 'it's over' takes are already wrong.",
    importance: "High",
    score: { relevance: 91, importance: 86, novelty: 88 },
    sources: 14,
    topics: ["Sports"],
    time: "05:52",
    sourceList: src(["ESPN", "BBC Sport", "The Athletic", "The Guardian"]),
    before: "Match treated as decided at 80 minutes.",
    after: "Extra-time winner; result stands.",
    timeline: [
      { at: "02:15", label: "Equaliser" },
      { at: "02:40", label: "Winning goal" },
      { at: "05:52", label: "Event finalised" },
    ],
  },
  {
    id: "music-drop",
    org: "Pitchfork",
    title: "Surprise album lands at midnight with no pre-release campaign",
    what: "A full album appeared on streaming services without a single, a trailer, or a press embargo. Early reviews disagree on whether it is a turn or a return.",
    why: "If you follow this artist, the record is out — not 'coming this autumn'.",
    importance: "High",
    score: { relevance: 90, importance: 78, novelty: 92 },
    sources: 11,
    topics: ["Music"],
    time: "05:08",
    sourceList: src(["Pitchfork", "Billboard", "The Guardian", "NPR"]),
    before: "No official release date on the calendar.",
    after: "Album live on every major service.",
    timeline: [
      { at: "00:01", label: "Midnight drop" },
      { at: "01:20", label: "First reviews" },
      { at: "05:08", label: "Event finalised" },
    ],
  },
  {
    id: "politics-vote",
    org: "Politico",
    title: "Narrow vote passes after a last-hour whip operation",
    what: "A bill that was three votes short at lunch passed after two holdouts flipped. The text that actually passed is not the draft that leaked on Tuesday.",
    why: "If you follow this beat, the version that became law is the one that matters — not the version that trended.",
    importance: "High",
    score: { relevance: 92, importance: 88, novelty: 80 },
    sources: 16,
    topics: ["Politics"],
    time: "06:04",
    sourceList: src(["Politico", "Reuters", "BBC", "The Guardian"]),
    before: "Whip count showed the bill short.",
    after: "Passed; final text differs from the leak.",
    timeline: [
      { at: "14:10", label: "Count still short" },
      { at: "21:40", label: "Vote called" },
      { at: "06:04", label: "Event finalised" },
    ],
  },
  {
    id: "gaming-studio",
    org: "Polygon",
    title: "Studio delays a flagship sequel and says the date was never internal",
    what: "A widely circulated holiday window is gone. The studio says retailers and leak accounts invented it; a 2027 window is the first date it will stand behind.",
    why: "If this is the game on your list, the holiday you planned around is not happening.",
    importance: "Medium",
    score: { relevance: 87, importance: 74, novelty: 81 },
    sources: 9,
    topics: ["Gaming"],
    time: "04:36",
    sourceList: src(["Polygon", "Eurogamer", "Rock Paper Shotgun"]),
    before: "Holiday window treated as confirmed.",
    after: "Official window is 2027; earlier date disowned.",
    timeline: [
      { at: "03:00", label: "Studio statement" },
      { at: "04:36", label: "Event finalised" },
    ],
  },
  {
    id: "film-festival",
    org: "Variety",
    title: "Festival Palme goes to a film that had no US distributor yesterday",
    what: "A bidding war started in the hall. Two streamers and one studio are in it. The director's previous film never left the festival circuit.",
    why: "If you follow film, this is the title that will be in every awards conversation by winter.",
    importance: "Medium",
    score: { relevance: 84, importance: 72, novelty: 85 },
    sources: 8,
    topics: ["Film"],
    time: "04:12",
    sourceList: src(["Variety", "The Guardian", "BBC Culture"]),
    before: "No US distribution attached.",
    after: "Palme; bidding open.",
    timeline: [{ at: "04:12", label: "Event finalised" }],
  },
  {
    id: "climate-report",
    org: "The Guardian",
    title: "New temperature record set for a month that used to be the cool one",
    what: "A national weather service confirmed the warmest August in its series. The previous record was 2024. Two agencies published matching figures within an hour.",
    why: "If you follow climate, this is another data point, not a vibes piece — the agencies agree.",
    importance: "High",
    score: { relevance: 88, importance: 85, novelty: 70 },
    sources: 10,
    topics: ["Climate", "World"],
    time: "05:22",
    sourceList: src(["The Guardian", "Reuters", "BBC Science"]),
    before: "2024 held the August record.",
    after: "2026 confirmed warmer; two agencies aligned.",
    timeline: [{ at: "05:22", label: "Event finalised" }],
  },
  {
    id: "economy-rate",
    org: "Reuters",
    title: "Central bank holds, and the statement is tighter than the vote suggests",
    what: "Rates unchanged. Two members wanted a cut. The published statement still talks about 'further evidence' before any move — language the last hold did not use.",
    why: "If you follow markets or the cost of money, the vote looks dovish and the words do not.",
    importance: "High",
    score: { relevance: 89, importance: 87, novelty: 76 },
    sources: 13,
    topics: ["Economy"],
    time: "06:40",
    sourceList: src(["Reuters", "BBC Business", "The Guardian"]),
    before: "A cut was the consensus outside bet.",
    after: "Hold; tighter statement language.",
    timeline: [{ at: "06:40", label: "Event finalised" }],
  },
  {
    id: "health-trial",
    org: "NPR",
    title: "Phase 3 trial stopped early because the benefit crossed the line they set",
    what: "An independent board halted the study after a planned look at the data. The company has not filed yet. Regulators have been notified, not asked to approve.",
    why: "If you follow this disease area, the result is real and the drug is not on a shelf tomorrow.",
    importance: "Medium",
    score: { relevance: 86, importance: 83, novelty: 79 },
    sources: 7,
    topics: ["Health"],
    time: "04:58",
    sourceList: src(["NPR", "Reuters", "BBC Health"]),
    before: "Trial still recruiting through winter.",
    after: "Stopped early for benefit; filing not yet submitted.",
    timeline: [{ at: "04:58", label: "Event finalised" }],
  },
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
    topics: ["AI", "Anthropic", "Claude"],
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
  sports: {
    label: "Sports",
    topics: ["Sports", "World"],
    storyIds: ["sports-final", "world-talks"],
  },
  music: {
    label: "Music",
    topics: ["Music", "Film"],
    storyIds: ["music-drop", "film-festival"],
  },
  politics: {
    label: "Politics",
    topics: ["Politics", "World", "Economy"],
    storyIds: ["politics-vote", "world-talks", "economy-rate"],
  },
  gaming: {
    label: "Gaming",
    topics: ["Gaming", "Film"],
    storyIds: ["gaming-studio", "film-festival"],
  },
  tech: {
    label: "Tech",
    topics: ["AI", "Anthropic", "Claude", "Developer tools"],
    storyIds: ["openai-realtime", "cursor-review", "anthropic-enterprise"],
  },
};

export const STORIES: Story[] = STORY_FIXTURES.map((s) => ({
  ...s,
  publishedAt: todayAt(s.time),
}));

export const storyById = (id: string) => STORIES.find((s) => s.id === id);

export const NOISE_LINES = [
  "Transfer confirmed overnight",
  "Someone ranked the best airports",
  "10 albums you must hear this week",
  "Thread: why this changes everything",
  "Fixture list for a league you don't follow",
  "Is this artist overrated? A poll",
  "Newsletter #418 is out",
  "Weekly digest of weekly digests",
  "Hot take on a vote that already happened",
  "Preview: a match that kicked off yesterday",
  "Election result certified in one state",
  "Yet another listicle about productivity",
  "Rumour: a signing that clubs deny",
  "Podcast episode 212",
  "A very long thread with no sources",
  "Blog: my 2026 morning routine",
  "Awards-season prediction, week of May",
  "Live: a keynote you will not watch",
  "Surprise album out at midnight",
  "Comment section disagreement",
  "Weather graphic with no numbers",
  "Recap of a recap of last night",
];

export const SOURCE_GROUPS = [
  {
    group: "Wire and world",
    count: 48,
    items: ["Reuters", "AP", "BBC World", "Al Jazeera"],
  },
  { group: "News sites", count: 62, items: ["The Guardian", "Politico", "NPR", "The Verge"] },
  { group: "Sports", count: 28, items: ["ESPN", "BBC Sport", "The Athletic"] },
  { group: "Music and film", count: 22, items: ["Pitchfork", "Billboard", "Variety"] },
  { group: "Gaming", count: 18, items: ["Polygon", "Eurogamer", "Rock Paper Shotgun"] },
  { group: "Official blogs", count: 84, items: ["OpenAI", "NVIDIA", "GitHub", "Stripe"] },
];

export const HISTORY = [
  { date: "August 22", weekday: "Friday", count: 6, headline: "Overnight talks resume" },
  { date: "August 21", weekday: "Thursday", count: 8, headline: "Final decided in extra time" },
  { date: "August 20", weekday: "Wednesday", count: 4, headline: "Surprise album at midnight" },
  { date: "August 19", weekday: "Tuesday", count: 0, headline: "Nothing important for your nyuz" },
  { date: "August 18", weekday: "Monday", count: 7, headline: "Narrow vote passes overnight" },
];

export const WATCHING = [
  { topic: "Sports", weight: 100 },
  { topic: "Music", weight: 82 },
  { topic: "Politics", weight: 54 },
  { topic: "World", weight: 41 },
  { topic: "Gaming", weight: 28 },
];
