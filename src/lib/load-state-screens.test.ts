import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The screens, held to the one place that decides their states.
 *
 * `src/lib/load-state.ts` owns the order — content, then the wait, then a fact
 * about the reader, then the failure, then the answer that had nothing in it —
 * and `src/lib/load-state.test.ts` renders that decision to prove it. What is
 * left for these screens is that they no longer make it themselves: a panel is
 * handed to the shared component, and nothing in a route tests a loader's
 * status any more.
 *
 * That is worth asserting in source, like `src/lib/offline/offline-wiring.test.ts`,
 * because the failure mode is a route that looks right and reads right and puts
 * the wrong sentence in front of somebody on a bad connection. Eight of these
 * were found one at a time; this is what stops the ninth.
 *
 * The strings are asserted where they matter and not just that they exist:
 * every sentence about the reader's own data must sit inside a slot only an
 * answer reaches, which is what `empty` is.
 */

const read = (path: string) => readFileSync(path, "utf8");
const count = (source: string, needle: string) => source.split(needle).length - 1;

const HOME = read("src/routes/dashboard/index.tsx");
const BRIEFING = read("src/routes/dashboard/briefing.tsx");
const ALERTS = read("src/routes/dashboard/alerts/index.tsx");
const ALERT_HISTORY = read("src/routes/dashboard/alerts/history.tsx");
const HISTORY = read("src/routes/dashboard/history.tsx");
const SOURCES = read("src/routes/dashboard/sources.tsx");
const STORY = read("src/routes/dashboard/story/$id.tsx");
const COMPONENT = read("src/components/dashboard/load-state.tsx");

/** Every panel in the dashboard, and how many each file holds. */
const PANELS: Array<[string, number]> = [
  ["src/routes/dashboard/index.tsx", 1],
  ["src/routes/dashboard/briefing.tsx", 1],
  ["src/routes/dashboard/alerts/index.tsx", 1],
  ["src/routes/dashboard/alerts/history.tsx", 1],
  ["src/routes/dashboard/history.tsx", 2],
  ["src/routes/dashboard/sources.tsx", 2],
];

/**
 * The loaders each screen reads, by name.
 *
 * Named rather than counted so a *mutation*'s own state stays allowed — a
 * button that says "Checking…" while it saves is not a panel deciding whether
 * the reader's data exists.
 */
const LOADERS: Array<[string, string[]]> = [
  ["src/routes/dashboard/index.tsx", ["feed"]],
  ["src/routes/dashboard/briefing.tsx", ["todayQ", "savedQ", "shownQ"]],
  ["src/routes/dashboard/alerts/index.tsx", ["alertsQ"]],
  ["src/routes/dashboard/alerts/history.tsx", []],
  ["src/routes/dashboard/history.tsx", ["history", "results"]],
  ["src/routes/dashboard/sources.tsx", ["sources", "custom"]],
  ["src/routes/dashboard/story/$id.tsx", ["storyQ"]],
];

describe("the states are decided in one place", () => {
  it.each(PANELS)("%s hands its panel to the shared component", (path, expected) => {
    const source = read(path);
    expect(source).toContain('import { LoadState } from "@/components/dashboard/load-state"');
    expect(count(source, "<LoadState")).toBe(expected);
  });

  it.each(LOADERS)("%s tests no loader's status itself", (path, loaders) => {
    const source = read(path);
    expect(source).not.toContain(".isLoading");
    for (const loader of loaders) {
      expect(source).not.toContain(`${loader}.isPending`);
      expect(source).not.toContain(`${loader}.isError`);
    }
  });

  it("keeps the failure treatment in the component", () => {
    // The reason and the retry have one correct form; seven copies of it drifted
    // into seven failures a reader could not tell apart or act on.
    expect(COMPONENT).toContain("humanError(query.error");
    expect(COMPONENT).toContain('"Trying…"');

    for (const path of [
      "src/routes/dashboard/index.tsx",
      "src/routes/dashboard/briefing.tsx",
      "src/routes/dashboard/alerts/index.tsx",
      "src/routes/dashboard/history.tsx",
    ]) {
      const source = read(path);
      expect(source).not.toContain("humanError(");
      expect(source).not.toContain("Trying…");
    }
    // The two survivors are not panel failures: Sources' is a feed that could not
    // be added and Alert history's is a *page* that failed behind rows already on
    // screen, which says so without taking the list away.
    expect(SOURCES).toContain('humanError(e, "Could not add that feed.")');
    expect(ALERT_HISTORY).toContain('humanError(historyQ.error, "Could not load older alerts.")');
  });
});

describe("Home", () => {
  it("keeps the failure off the two sentences that read the feed", () => {
    expect(HOME).toContain('failed="We couldn\'t load your briefing."');
    expect(HOME.indexOf("empty={() =>")).toBeLessThan(
      HOME.indexOf('title="Nothing matched your topics."'),
    );
    expect(HOME.indexOf("empty={() =>")).toBeLessThan(
      HOME.indexOf('title="Your briefing is still assembling."'),
    );
  });

  it("advises on topics whether or not the request answers", () => {
    // Having no topics is a fact about the reader, and its action still leads
    // somewhere when the feed request has failed.
    expect(HOME).toContain("given={");
    expect(HOME.indexOf("Choose my topics")).toBeLessThan(HOME.indexOf('failed="We couldn'));
  });

  it("asks the same decision for the header and the side counts", () => {
    expect(HOME).toContain("loadPhase(feed");
    // "Came back quiet" and a column of zeroes are claims about a briefing, so
    // neither is printed while the request is only asking.
    expect(HOME).toContain('"Reading today\'s briefing…"');
    expect(HOME.lastIndexOf('phase === "failed"')).toBeLessThan(
      HOME.indexOf("prefs.topics.slice(0, 6)"),
    );
  });
});

describe("Briefing", () => {
  it("names which list failed, and keeps both empty lists inside an answer", () => {
    expect(BRIEFING).toContain('"We couldn\'t load your saves."');
    expect(BRIEFING).toContain('"We couldn\'t load this briefing."');
    expect(BRIEFING.indexOf("empty={() =>")).toBeLessThan(
      BRIEFING.indexOf('title="Nothing saved yet."'),
    );
    expect(BRIEFING.indexOf("empty={() =>")).toBeLessThan(
      BRIEFING.indexOf('title="No briefing today."'),
    );
  });

  it("does not print a count it has not counted", () => {
    // "Saved · 0" beside a bookmark the reader just made is what sends them
    // looking for a story that was never gone — true of a failed shelf and of
    // one that has not answered yet.
    expect(BRIEFING).toContain(
      'const savedTally = savedQ.data !== undefined ? String(saved.length) : "—";',
    );
    expect(BRIEFING).toContain(
      'const todayTally = todayQ.data !== undefined ? String(today.length) : "—";',
    );
  });
});

describe("Alerts", () => {
  it("keeps both things it can say about the list inside an answer", () => {
    expect(ALERTS).toContain('failed="We couldn\'t read your recent alerts."');
    expect(ALERTS.indexOf("empty={() =>")).toBeLessThan(
      ALERTS.indexOf('title="No alerts sent yet."'),
    );
    // "Nothing to show while alerts are off." is not purely a fact about
    // settings: it also claims there is nothing to list.
    expect(ALERTS.indexOf("empty={() =>")).toBeLessThan(
      ALERTS.indexOf('title="Nothing to show while alerts are off."'),
    );
  });
});

describe("Alert history", () => {
  it('keeps "No alerts yet." off a page that never loaded', () => {
    expect(ALERT_HISTORY).toContain('failed="We couldn\'t read your alert history."');
    expect(ALERT_HISTORY.indexOf("empty={() => (")).toBeLessThan(
      ALERT_HISTORY.indexOf('title="No alerts yet."'),
    );
  });

  it("decides the plan's own answer in front of the panel", () => {
    // `enabled: false` for a plan without alert history, and a disabled query is
    // pending forever — so this state belongs in front of the panel, not in
    // `given`, or it is drawn behind a spinner that never stops.
    expect(ALERT_HISTORY.indexOf("!entitled ? (")).toBeLessThan(
      ALERT_HISTORY.indexOf("<LoadState"),
    );
  });

  it("lets a page that fails behind rows keep them", () => {
    const footer = ALERT_HISTORY.indexOf("Could not load older alerts.");
    expect(footer).toBeGreaterThan(ALERT_HISTORY.indexOf("months.map"));
    expect(footer).toBeGreaterThan(ALERT_HISTORY.indexOf("historyQ.isError"));
  });
});

describe("History", () => {
  it("never tells a reader their archive is empty", () => {
    expect(HISTORY).toContain('failed="We couldn\'t open your archive."');
    expect(HISTORY.indexOf("empty={() => (")).toBeLessThan(
      HISTORY.indexOf('title="No briefings yet."'),
    );
    // The eyebrow counts what the archive holds, from the same decision.
    expect(HISTORY).toContain("loadPhase(history");
    expect(HISTORY).toContain('"We couldn\'t open your archive"');
  });

  it("does not count a search that has not run", () => {
    expect(HISTORY).toContain('failed="We couldn\'t search your archive."');
    expect(HISTORY.indexOf("empty={() => (")).toBeLessThan(
      HISTORY.indexOf('title="Nothing in your archive matches that."'),
    );
    // The count is drawn in the two states that are answers — found something,
    // found nothing — and never in the wait between them.
    expect(count(HISTORY, "<SearchCount")).toBe(2);
    const wait = HISTORY.slice(HISTORY.indexOf("loading={"), HISTORY.indexOf("failed="));
    expect(wait).not.toContain("<SearchCount");
  });
});

describe("Sources", () => {
  it("does not draw a reader who follows no feeds", () => {
    expect(SOURCES).toContain('failed="We couldn\'t read your sources."');
    expect(SOURCES.indexOf("<LoadState")).toBeLessThan(SOURCES.indexOf("{groups.map((g) => ("));
    // The eyebrow and the priority count report on the same list.
    expect(SOURCES).toContain("loadPhase(sources");
    expect(SOURCES).toContain('"We couldn\'t read your feeds"');
  });

  it("owns the wait and the failure of a section that draws itself", () => {
    expect(SOURCES).toContain('failed="We couldn\'t read your own sources."');
    // The custom-source body is drawn from `data` around the panel, so the
    // panel's "something to show" state draws nothing — and must leave no box
    // behind when it does.
    expect(SOURCES).toContain("content={null}");
  });
});

describe("the story page", () => {
  it("takes the same decision, and claims only from an answer", () => {
    expect(STORY).toContain("loadPhase(storyQ");
    const waiting = STORY.indexOf('if (phase === "waiting")');
    const failed = STORY.indexOf('if (phase === "failed")');
    const claim = STORY.indexOf("This event is not in your briefing.");

    expect(waiting).toBeGreaterThan(-1);
    expect(failed).toBeGreaterThan(waiting);
    // The claim about the reader's briefing is reachable only from a load that
    // answered and returned nothing.
    expect(claim).toBeGreaterThan(failed);
    expect(STORY.indexOf("if (!story) {")).toBeGreaterThan(failed);
  });

  it("offers the retry and the reason rather than only the news", () => {
    const branch = STORY.slice(
      STORY.indexOf('if (phase === "failed")'),
      STORY.indexOf("if (!story) {"),
    );
    expect(branch).toContain("storyQ.refetch()");
    expect(branch).toContain("Trying…");
    expect(branch).toContain("humanError(storyQ.error");
  });
});
