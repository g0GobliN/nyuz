/**
 * Re-judges the language of feeds that are already in `sources`.
 *
 * The intake gate only runs once, at insert time. If the detector was wrong,
 * nothing ever looks again, and the daily source count keeps the mistake while
 * the reader gets a feed in a language they cannot read. On 2026-10-30 that is
 * exactly what happened: Icelandic and Hungarian feeds were counted as English
 * (docs/decisions/daily-source-floor.md), so the floor was met on paper and not
 * in fact.
 *
 * This is the tool that says how big that mistake is, and with `--delete` it
 * removes the feeds the current gate rejects. It reads every feed again, so it
 * costs one probe per source; run it after a wave and after any detector change.
 *
 *   npm run source:audit                       # yesterday, report only
 *   npm run source:audit -- --day 2026-10-30
 *   npm run source:audit -- --day 2026-10-30 --delete
 *   npm run source:audit -- --day 2026-10-30 --json /tmp/audit.json
 *
 * `--delete` only removes rows the current gate rejects *and* that were inserted
 * by discovery; a hand-added source is reported and left alone, because a human
 * meant it.
 */

import { writeFile } from "node:fs/promises";

import { resolveFeed } from "@/lib/discovery/feed";
import { detectTitlesLanguage, type LanguageVerdict } from "@/lib/language-detection";
import { dayWindow, operatorDay, shiftDay } from "@/lib/source-floor";

import { db, fail, heading, main, row, say } from "./lib/db";

/** Enough titles to judge a feed, and the same floor the intake gate uses. */
const MIN_ITEM_TITLES = 3;

/** Probes at once. Small enough that no outlet sees a burst from one address. */
const CONCURRENCY = 6;

type AuditedSource = {
  id: string;
  feedUrl: string | null;
  name: string | null;
  origin: string | null;
  createdAt: string;
};

type AuditResult = {
  source: AuditedSource;
  outcome: "english" | "non-english" | "unreachable" | "too-few-titles";
  reason: string;
  latinAccentRatio: number;
  titles: string[];
};

type Args = {
  day: string;
  delete: boolean;
  json: string | null;
  limit: number | null;
  urls: string[];
};

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    day: shiftDay(operatorDay(), -1),
    delete: false,
    json: null,
    limit: null,
    urls: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) fail(`${flag} needs a value`);
      index += 1;
      return next;
    };
    switch (flag) {
      case "--day":
        args.day = value();
        break;
      case "--delete":
        args.delete = true;
        break;
      case "--json":
        args.json = value();
        break;
      case "--limit":
        args.limit = Number(value());
        break;
      case "--url":
        args.urls.push(value());
        break;
      default:
        fail(`unknown flag ${flag}`);
    }
  }

  return args;
}

async function sourcesForDay(
  day: string,
  limit: number | null,
  urls: readonly string[],
): Promise<AuditedSource[]> {
  // `--url` judges feeds that are not in the table (a candidate before intake, a
  // feed whose day is long gone), so no window is computed for it.
  if (urls.length > 0) {
    return urls.map((feedUrl) => ({
      id: feedUrl,
      feedUrl,
      name: null,
      origin: "discovered",
      createdAt: new Date().toISOString(),
    }));
  }

  const window = dayWindow(day);
  let query = db()
    .from("sources")
    .select("id, feed_url, name, origin, created_at")
    .gte("created_at", window.start)
    .lt("created_at", window.end)
    .order("created_at", { ascending: true });

  if (limit !== null) query = query.limit(limit);

  const { data, error } = await query;
  if (error) fail(`sources read failed: ${error.message}`);

  return (data ?? []).map((source) => ({
    id: source.id,
    feedUrl: source.feed_url,
    name: source.name,
    origin: source.origin,
    createdAt: source.created_at,
  }));
}

async function auditOne(source: AuditedSource): Promise<AuditResult> {
  const base = { source, latinAccentRatio: 0, titles: [] as string[] };
  if (!source.feedUrl) {
    return { ...base, outcome: "unreachable", reason: "no feed_url" };
  }

  const resolution = await resolveFeed(source.feedUrl);
  if (!resolution.ok) {
    return { ...base, outcome: "unreachable", reason: resolution.reason };
  }

  const { feed } = resolution;
  const titles = feed.itemTitles.slice(0, 10);
  if (titles.length < MIN_ITEM_TITLES) {
    return { ...base, outcome: "too-few-titles", reason: `${titles.length} titles`, titles };
  }

  const verdict: LanguageVerdict = detectTitlesLanguage(titles);
  return {
    source,
    outcome: verdict.english ? "english" : "non-english",
    reason: verdict.reason,
    latinAccentRatio: verdict.latinAccentRatio,
    titles,
  };
}

/** Runs `work` over `items` with at most `limit` in flight, preserving order. */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runner = async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await work(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}

main(async () => {
  const args = parseArgs(process.argv.slice(2));
  const sources = await sourcesForDay(args.day, args.limit, args.urls);

  heading(`language audit · ${args.day} · ${sources.length} source(s)`);
  say();

  if (sources.length === 0) {
    say("nothing was inserted that day");
    return;
  }

  const results = await mapPool(sources, CONCURRENCY, auditOne);

  const english = results.filter((result) => result.outcome === "english");
  const nonEnglish = results.filter((result) => result.outcome === "non-english");
  const unreachable = results.filter((result) => result.outcome === "unreachable");
  const tooFew = results.filter((result) => result.outcome === "too-few-titles");

  say(row("english", english.length));
  say(row("non-english", nonEnglish.length));
  say(row("unreachable", unreachable.length));
  say(row("too few titles", tooFew.length));
  say();

  const byReason = new Map<string, number>();
  for (const result of nonEnglish) {
    const key = result.reason.replace(/ ratio .*$/, "").replace(/ hits .*$/, "");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    say(row(`  ${reason}`, count, 30));
  }
  if (byReason.size > 0) say();

  const latinAccentRatios = english.map((result) => result.latinAccentRatio);
  if (latinAccentRatios.length > 0) {
    say(
      row(
        "accent ratio p05/p50",
        `${percentile(latinAccentRatios, 0.05).toFixed(2)} / ${percentile(latinAccentRatios, 0.5).toFixed(2)}`,
        30,
      ),
    );
    say();
  }

  for (const result of nonEnglish.slice(0, 12)) {
    say(`${result.reason}`);
    say(`  ${result.source.feedUrl}`);
    say(`  ${result.titles.slice(0, 3).join(" · ").slice(0, 160)}`);
  }
  if (nonEnglish.length > 12) say(`  … and ${nonEnglish.length - 12} more`);

  if (args.json) {
    await writeFile(
      args.json,
      JSON.stringify(
        results.map((result) => ({
          id: result.source.id,
          feedUrl: result.source.feedUrl,
          name: result.source.name,
          origin: result.source.origin,
          outcome: result.outcome,
          reason: result.reason,
          latinAccentRatio: result.latinAccentRatio,
          titles: result.titles,
        })),
        null,
        2,
      ),
    );
    say();
    say(`wrote ${args.json}`);
  }

  if (!args.delete) return;

  // Only what discovery inserted, and only what the current gate rejects. A
  // hand-added source is reported above and left in place: a human meant it.
  const removable = nonEnglish.filter((result) => result.source.origin === "discovered");
  say();
  heading(`delete ${removable.length} discovered non-English source(s)`);
  if (removable.length === 0) return;

  for (const result of removable) {
    const { error } = await db().from("sources").delete().eq("id", result.source.id);
    if (error) fail(`delete ${result.source.id} failed: ${error.message}`);
    say(`  removed ${result.source.feedUrl ?? result.source.id}`);
  }
});
