/**
 * Fills the pool that tomorrow's source floor draws from.
 *
 *   npm run source:discover -- --countries 6 --peers 30
 *   npm run source:discover -- --dry-run --countries 2 --peers 4
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * The 2026-10-30 waves inserted 512 sources in one day off a candidate list
 * somebody had written by hand. At a 50-a-day floor that list is gone in two
 * days, so a daily wave without a daily discovery pass starves inside a week and
 * the board reports "no candidates" forever. Discovery has to run every day,
 * before the first wave, and it has to produce more than the floor consumes.
 *
 * The target is three days of headroom: `--countries 6 --peers 30` yields a few
 * hundred fresh candidates on a good day, which is what makes 50-100 a day
 * survivable on a bad one.
 *
 * ---------------------------------------------------------------------------
 * Where candidates come from
 * ---------------------------------------------------------------------------
 *
 * Two walks, no search API and no model:
 *
 *   1. Outlet indexes. English Wikipedia's `List_of_newspapers_in_<country>` page
 *      links the country's outlet homepages, and the MediaWiki API returns them
 *      in one JSON response. Countries rotate by day, so coverage widens instead
 *      of re-walking the same five.
 *
 *   2. Peer links. Catalogue sources' own homepages link to the outlets they
 *      read. Rotated by day as well, so the whole catalogue is walked over weeks.
 *
 * Neither is a crawl: one request per country, one per source homepage, no
 * recursion, and nothing is followed beyond the page that was asked for. The
 * actual feed resolution happens later, in `source-grow.ts`, with the same
 * six-request resolver the demand path uses.
 *
 * ---------------------------------------------------------------------------
 * What it writes
 * ---------------------------------------------------------------------------
 *
 * Rows in `source_candidates` with `method = 'growth'`, `status = 'discovered'`,
 * `next_attempt_at = now()`. Nothing else. It never inserts a source and never
 * touches one -- a candidate is a URL until a wave proves it is a feed.
 */

import { db, fail, heading, main, say } from "./lib/db.ts";
import {
  countriesForDay,
  hostKey,
  outletIndexPage,
  outletLinksFromIndex,
  newSites,
  peerSites,
} from "@/lib/discovery/growth";
import { fetchFeed, mapLimit } from "@/lib/pipeline/fetch";
import { dayIndexOf, operatorDay } from "@/lib/source-floor";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const PAGE_SIZE = 1000;

type Args = {
  countries: number;
  peers: number;
  concurrency: number;
  dryRun: boolean;
  day: string;
};

/**
 * A pool row, in the shape the live table has.
 *
 * Growth candidates are told apart from demand discovery's by provenance, not by
 * a `method` column: the live project's `source_candidates` predates that column,
 * and a candidate with no topic and no job is exactly one that no reader asked
 * for -- which is what "growth" means here. Adopting the discriminator instead of
 * the column keeps the daily job runnable against the database that exists.
 */
type CandidateRow = {
  url: string;
  domain: string;
  status: "discovered";
  next_attempt_at: string;
};

main(async () => {
  const args = parseArgs(process.argv.slice(2));
  const dayIndex = dayIndexOf(args.day);

  heading(`Source discovery — ${args.day}`);
  say(`countries ${args.countries} · peer pages ${args.peers} · concurrency ${args.concurrency}`);

  const known = await knownHosts();
  const existing = await existingCandidateUrls();
  say(`catalogue hosts ${known.size} · already-candidate URLs ${existing.size}`);

  const fromIndexes = await collectOutletIndexes(args, known, existing);
  const fromPeers = await collectPeerSites(args, known, existing);

  const fresh = new Map<string, CandidateRow>();
  for (const row of [...fromIndexes.rows, ...fromPeers.rows]) {
    if (known.has(row.domain) || existing.has(row.url) || fresh.has(row.url)) continue;
    fresh.set(row.url, row);
  }

  heading("What the walks found");
  say(
    `outlet indexes   ${fromIndexes.sites.length} sites from ${fromIndexes.countries.length}/${args.countries} countries (${fromIndexes.skipped} pages missing)`,
  );
  say(
    `peer pages       ${fromPeers.sites.length} sites from ${fromPeers.pages.length}/${args.peers} homepages (${fromPeers.failed} unreachable)`,
  );
  say(`fresh candidates ${fresh.size} after de-duplication`);

  if (fresh.size === 0) {
    say("");
    say("Nothing new. That is a discovery failure, not a quiet day — the pool");
    say("will be short tomorrow. Widen the walk: --countries 12 --peers 60.");
    return;
  }

  if (args.dryRun) {
    say("");
    say("Dry run: nothing written. First ten:");
    for (const row of [...fresh.values()].slice(0, 10)) say(`  ${row.url}`);
    return;
  }

  const rows = [...fresh.values()];
  let written = 0;
  for (const chunk of chunks(rows, 200)) {
    const { error } = await db()
      .from("source_candidates")
      .upsert(chunk, { onConflict: "url", ignoreDuplicates: true });
    if (error) fail(`inserting candidates: ${error.message}`);
    written += chunk.length;
  }

  const pool = await poolSize();
  heading("Pool");
  say(`offered  ${written}`);
  say(
    `standing ${pool.discovered} discovered · ${pool.registered} registered · ${pool.rejected} rejected`,
  );
  say("");
  say("The wave tool consumes this pool; see scripts/source-grow.ts.");
});

/* ---------------------------------------------------------------------- */
/* Walks                                                                   */
/* ---------------------------------------------------------------------- */

/**
 * The per-country outlet index walk.
 *
 * The API call is one request and the response carries every external link on
 * the page. A country whose page does not exist answers `{error: ...}` and is
 * counted as skipped rather than as a country with no newspapers.
 */
async function collectOutletIndexes(
  args: Args,
  known: ReadonlySet<string>,
  existing: ReadonlySet<string>,
): Promise<{ countries: string[]; sites: string[]; skipped: number; rows: CandidateRow[] }> {
  const countries = countriesForDay({ dayIndex: dayIndexOf(args.day), perDay: args.countries });
  let skipped = 0;

  const results = await mapLimit(countries, 3, async (country) => {
    const page = outletIndexPage(country);
    const payload = await readJson(
      `${WIKI_API}?action=parse&page=${encodeURIComponent(page.split("/wiki/")[1] ?? "")}&prop=externallinks&format=json&formatversion=2`,
    );
    const links = outletLinksFromIndex(payload);
    if (links.length === 0) {
      skipped += 1;
      return { country, sites: [] as string[] };
    }
    return { country, sites: newSites(links, { pageUrl: page, knownHosts: known, limit: 400 }) };
  });

  const sites = [...new Set(results.flatMap((result) => result.sites))].filter(
    (site) => !existing.has(site),
  );
  return {
    countries: results.filter((result) => result.sites.length > 0).map((result) => result.country),
    sites,
    skipped,
    rows: sites.map(candidateRow),
  };
}

/**
 * The peer walk: catalogue homepages, rotated by day.
 *
 * `offset` advances by `--peers` a day, so a 1,000-source catalogue is walked in
 * about a month and every source is visited. A homepage that times out is
 * counted and skipped; the next day's offset has moved past it, and the month
 * comes round again.
 */
async function collectPeerSites(
  args: Args,
  known: ReadonlySet<string>,
  existing: ReadonlySet<string>,
): Promise<{ pages: string[]; sites: string[]; failed: number; rows: CandidateRow[] }> {
  const total = await homepageCount();
  if (total === 0 || args.peers === 0) {
    return { pages: [], sites: [], failed: 0, rows: [] };
  }

  const offset = (dayIndexOf(args.day) * args.peers) % total;
  const { data, error } = await db()
    .from("sources")
    .select("homepage")
    .not("homepage", "is", null)
    .eq("active", true)
    .order("id", { ascending: true })
    .range(offset, offset + args.peers - 1);
  if (error) fail(`listing homepages: ${error.message}`);

  const pages = (data ?? [])
    .map((row) => row.homepage)
    .filter((homepage): homepage is string => typeof homepage === "string" && homepage !== "");
  let failed = 0;

  const results = await mapLimit(pages, args.concurrency, async (homepage) => {
    const response = await fetchFeed(homepage);
    if (!response.ok) {
      failed += 1;
      return [] as string[];
    }
    return peerSites({
      html: response.body,
      pageUrl: response.finalUrl || homepage,
      knownHosts: known,
      limit: 40,
    });
  });

  const sites = [...new Set(results.flat())].filter((site) => !existing.has(site));
  return { pages, sites, failed, rows: sites.map(candidateRow) };
}

/* ---------------------------------------------------------------------- */
/* Database reads                                                          */
/* ---------------------------------------------------------------------- */

/** Every host the catalogue already holds, as `hostKey` sees it. */
async function knownHosts(): Promise<Set<string>> {
  const hosts = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db()
      .from("sources")
      .select("feed_url,homepage")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) fail(`reading sources: ${error.message}`);
    for (const row of data ?? []) {
      for (const url of [row.feed_url, row.homepage]) {
        if (typeof url !== "string") continue;
        const key = hostKey(url);
        if (key !== null) hosts.add(key);
      }
    }
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return hosts;
}

/** Candidate URLs already in the registry, so a re-run offers no duplicates. */
async function existingCandidateUrls(): Promise<Set<string>> {
  const urls = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db()
      .from("source_candidates")
      .select("url")
      .order("url", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) fail(`reading candidates: ${error.message}`);
    for (const row of data ?? []) if (typeof row.url === "string") urls.add(row.url);
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return urls;
}

/** How many sources have a homepage to walk. */
async function homepageCount(): Promise<number> {
  const { count, error } = await db()
    .from("sources")
    .select("id", { count: "exact" })
    .not("homepage", "is", null)
    .eq("active", true)
    .limit(1);
  if (error) fail(`counting homepages: ${error.message}`);
  return count ?? 0;
}

/** The pool as the floor report reads it. */
async function poolSize(): Promise<{ discovered: number; registered: number; rejected: number }> {
  const one = async (status: "discovered" | "registered" | "rejected") => {
    const { count, error } = await db()
      .from("source_candidates")
      .select("id", { count: "exact" })
      .is("first_topic_id", null)
      .is("first_job_id", null)
      .eq("status", status)
      .limit(1);
    if (error) fail(`counting pool: ${error.message}`);
    return count ?? 0;
  };
  return {
    discovered: await one("discovered"),
    registered: await one("registered"),
    rejected: await one("rejected"),
  };
}

/* ---------------------------------------------------------------------- */
/* Plumbing                                                                */
/* ---------------------------------------------------------------------- */

function candidateRow(url: string): CandidateRow {
  return {
    url,
    domain: hostKey(url) ?? url,
    status: "discovered",
    next_attempt_at: new Date().toISOString(),
  };
}

/** One JSON request, with a bounded wait and a named user agent. */
async function readJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "nyuz/1.0 (+https://nyuz.grgvishal-gurung17.workers.dev; source discovery)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    countries: 6,
    peers: 30,
    concurrency: 6,
    dryRun: false,
    day: operatorDay(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--countries":
        args.countries = numberOr(value, args.countries, flag);
        index += 1;
        break;
      case "--peers":
        args.peers = numberOr(value, args.peers, flag);
        index += 1;
        break;
      case "--concurrency":
        args.concurrency = numberOr(value, args.concurrency, flag);
        index += 1;
        break;
      case "--day":
        args.day = value ?? args.day;
        index += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        if (flag !== undefined && flag.startsWith("--")) fail(`unknown flag ${flag}`);
    }
  }

  return args;
}

function numberOr(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) fail(`${flag} needs a number, got ${raw}`);
  return parsed;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}
