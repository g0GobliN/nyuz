import { describe, expect, it } from "vitest";
import {
  ON_DEMAND_LIMIT,
  type PendingEvent,
  WINDOW_HOURS,
  worthAnalysing,
} from "@/lib/pipeline/backfill";
import type { Reader, ReaderTopic } from "@/lib/pipeline/match";

/**
 * Stage 6 is stage 5 with two arguments filled in, so almost nothing here is
 * about matching — `match.test.ts` owns those rules and this stage adds none.
 *
 * What is new, and what these tests are for, is the one decision stage 6 makes
 * that costs money: which unanalysed events a brand-new reader is worth paying
 * to understand. Everything else in the stage is free and idempotent; this is
 * the part that has a bill attached, so it is the part with a specification.
 */

function topic(label: string, extra: Partial<ReaderTopic> = {}): ReaderTopic {
  return {
    topicId: `topic:${label}`,
    slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label,
    kind: "predefined",
    terms: [],
    importance: "notable",
    weight: 1,
    keywords: [],
    excludeKeywords: [],
    ...extra,
  };
}

function reader(topics: ReaderTopic[], exclusions: string[] = []): Reader {
  return {
    userId: "reader",
    density: 35,
    topics,
    exclusions,
    sourcePrefs: new Map(),
  };
}

function event(id: string, title: string): PendingEvent {
  return { id, title };
}

describe("what a new reader is worth paying to analyse", () => {
  it("takes an event whose headline names a followed topic", () => {
    const chosen = worthAnalysing(
      [event("a", "OpenAI ships a new reasoning model"), event("b", "A phone trade-in guide")],
      reader([topic("OpenAI")]),
      ON_DEMAND_LIMIT,
    );

    expect(chosen.map((e) => e.id)).toEqual(["a"]);
  });

  it("pays for nothing when no headline names anything the reader follows", () => {
    const chosen = worthAnalysing(
      [event("a", "A phone trade-in guide"), event("b", "The best games of the year")],
      reader([topic("Kubernetes")]),
      ON_DEMAND_LIMIT,
    );

    // The quiet-day promise, at the point where breaking it would cost money.
    expect(chosen).toEqual([]);
  });

  it("matches on a keyword the reader added to a topic", () => {
    const chosen = worthAnalysing(
      [event("a", "Anthropic releases Claude Code for the terminal")],
      reader([topic("AI", { keywords: ["Anthropic"] })]),
      ON_DEMAND_LIMIT,
    );

    expect(chosen.map((e) => e.id)).toEqual(["a"]);
  });

  it("matches on a topic's slug as well as its label", () => {
    const chosen = worthAnalysing(
      [event("a", "A developer-tools roundup")],
      reader([topic("Developer Tools")]),
      ON_DEMAND_LIMIT,
    );

    expect(chosen.map((e) => e.id)).toEqual(["a"]);
  });

  it("refuses to pay for an event the reader's exclusions veto", () => {
    const chosen = worthAnalysing(
      [event("a", "Nvidia and OpenAI announce a data-centre deal")],
      reader([topic("OpenAI")], ["Nvidia"]),
      ON_DEMAND_LIMIT,
    );

    // An exclusion beats a topic at match time, so buying the analysis first
    // would be paying to produce a row the next gate throws away.
    expect(chosen).toEqual([]);
  });

  it("applies a topic's own exclude_keywords, not only the global list", () => {
    const chosen = worthAnalysing(
      [event("a", "OpenAI hiring spree continues")],
      reader([topic("OpenAI", { excludeKeywords: ["hiring"] })]),
      ON_DEMAND_LIMIT,
    );

    expect(chosen).toEqual([]);
  });

  it("stops at the limit, newest first", () => {
    const chosen = worthAnalysing(
      [
        event("a", "OpenAI one"),
        event("b", "OpenAI two"),
        event("c", "OpenAI three"),
        event("d", "OpenAI four"),
      ],
      reader([topic("OpenAI")]),
      ON_DEMAND_LIMIT,
    );

    expect(chosen.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(chosen).toHaveLength(ON_DEMAND_LIMIT);
  });

  it("does not let a two-letter topic buy the whole corpus", () => {
    // `related` refuses loose containment below three characters. Without that
    // floor a reader who typed "ML" would be billed for every headline holding
    // those letters — the same failure that turns a matcher into "show all",
    // except this one has an invoice.
    const chosen = worthAnalysing(
      [event("a", "HTML tooling gets a rewrite"), event("b", "A calmer approach to email")],
      reader([topic("ML")]),
      ON_DEMAND_LIMIT,
    );

    expect(chosen).toEqual([]);
  });

  it("requires every term of a custom topic before buying analysis", () => {
    const custom = topic("India vs China", {
      kind: "custom",
      terms: ["india", "china"],
    });
    const chosen = worthAnalysing(
      [
        event("a", "China changes rare-earth export rules"),
        event("b", "India and China resume border talks"),
      ],
      reader([custom]),
      ON_DEMAND_LIMIT,
    );

    expect(chosen.map((e) => e.id)).toEqual(["b"]);
  });

  it("spends nothing for a reader who follows nothing", () => {
    const chosen = worthAnalysing(
      [event("a", "OpenAI ships a new reasoning model")],
      reader([]),
      ON_DEMAND_LIMIT,
    );

    expect(chosen).toEqual([]);
  });
});

describe("the day-one budget", () => {
  it("is smaller than the scheduled stage's hourly budget", () => {
    // ANALYSE_LIMIT in cron.ts is 6. Day one answers one page load rather than
    // draining a backlog, so it must not be the more expensive of the two.
    expect(ON_DEMAND_LIMIT).toBeLessThan(6);
  });

  it("looks back three days, as the plan decided", () => {
    expect(WINDOW_HOURS).toBe(72);
  });
});
