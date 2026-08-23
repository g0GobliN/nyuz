/**
 * Fetches every feed in the database and reports which ones actually work.
 *
 *   npm run check:feeds                 active sources only
 *   npm run check:feeds -- --all        including ones already switched off
 *   npm run check:feeds -- --disable    switch off everything that failed
 *
 * `supabase/migrations/0006_sources.sql` states plainly that its sixty-six feed
 * URLs were written from knowledge with no network available, and tells the
 * operator to run this before trusting the list. This is that command.
 *
 * It uses the same `fetchFeed` and `parseFeed` the ingester uses, so a feed that
 * passes here will parse there. A checker with its own HTTP client would clear
 * feeds that then keep failing.
 *
 * Reading is safe and free. `--disable` writes, and only for the two states that
 * mean the address itself is wrong: a permanent HTTP failure, and HTML served
 * where a feed should be. A timeout is a bad moment, and a valid feed with no
 * entries in it is a live URL — neither is grounds for switching a source off, and
 * the ingester's failure count exists to catch the ones that keep failing. Each
 * change records one `admin_audit_log` row, so a feed that vanishes from the
 * pipeline has a reason attached to it. Redirects are never rewritten
 * automatically — a feed URL that moved is a decision for a person, because
 * "moved" and "now serving somebody else's content" look identical here.
 */

import { parseFeed } from "@/lib/pipeline/feed";
import { fetchFeed, mapLimit } from "@/lib/pipeline/fetch";
import { db, heading, main, say } from "./lib/db.ts";

/** Eight at a time: fast enough to finish in under a minute, polite enough not to be blocked. */
const CONCURRENCY = 8;

type Verdict = {
  id: string;
  name: string;
  feedUrl: string;
  active: boolean;
  state: "ok" | "paused" | "empty" | "unparsed" | "failed";
  detail: string;
  items: number;
  /** Set when the final URL differs from the one in the database. */
  movedTo: string | null;
  newest: string | null;
  /**
   * Whether this is the feed's address being wrong, as opposed to a bad moment or
   * an empty-but-live feed. `--disable` acts on this and nothing else.
   */
  dead: boolean;
};

main(async () => {
  const args = process.argv.slice(2);
  const includeInactive = args.includes("--all");
  const disable = args.includes("--disable");

  let query = db().from("sources").select("*").order("name");
  if (!includeInactive) query = query.eq("active", true);

  const { data: sources, error } = await query;
  if (error) throw new Error(`Read sources: ${error.message}`);
  if (!sources || sources.length === 0) {
    say("No sources to check. Run `npm run db:seed` first.");
    return;
  }

  heading(`Checking ${sources.length} feeds`);
  say();

  const verdicts = await mapLimit(sources, CONCURRENCY, async (source) => {
    const verdict = await check(source);
    say(line(verdict));
    return verdict;
  });

  report(verdicts);

  if (disable) await disableFailures(verdicts);
  else if (verdicts.some((v) => v.dead && v.active)) {
    say();
    say("Re-run with --disable to switch off the ones whose address is wrong.");
  }

  say();
});

async function check(source: {
  id: string;
  name: string;
  feed_url: string;
  active: boolean;
}): Promise<Verdict> {
  const base = {
    id: source.id,
    name: source.name,
    feedUrl: source.feed_url,
    active: source.active,
    items: 0,
    movedTo: null,
    newest: null,
    dead: false,
  };

  const response = await fetchFeed(source.feed_url);
  if (!response.ok) {
    // A retryable failure is a bad moment — a timeout, a 503, a reset connection.
    // The URL may be perfectly good. Only a permanent status condemns it.
    return { ...base, state: "failed", detail: response.reason, dead: !response.retryable };
  }

  const feed = parseFeed(response.body);
  const moved =
    normalise(response.finalUrl) === normalise(source.feed_url) ? null : response.finalUrl;

  if (feed.items.length === 0) {
    // A 200 with no items is nearly always an HTML page served in place of the
    // feed — a moved URL, or a soft 404. Saying which of the two it looks like
    // saves the operator opening it.
    const looksLikeHtml = /<html[\s>]/i.test(response.body.slice(0, 2000));
    if (looksLikeHtml) {
      return {
        ...base,
        state: "unparsed",
        movedTo: moved,
        dead: true,
        detail: `HTML, not a feed (${response.contentType ?? "no content-type"})`,
      };
    }

    // A well-formed channel with nothing in it, on a day the publisher told us it
    // does not publish. arXiv does exactly this every Saturday and Sunday. Nothing
    // is wrong and nothing should be switched off.
    const today = WEEKDAYS[new Date().getUTCDay()];
    if (today && feed.skipDays.includes(today)) {
      return {
        ...base,
        state: "paused",
        movedTo: moved,
        detail: `no entries — the feed declares skipDays including ${today}`,
      };
    }

    return {
      ...base,
      state: "empty",
      movedTo: moved,
      detail: `${feed.format} with no entries${feed.dropped > 0 ? `, ${feed.dropped} unusable` : ""}`,
    };
  }

  const newest = feed.items
    .map((item) => item.publishedAt)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1);

  return {
    ...base,
    state: "ok",
    items: feed.items.length,
    movedTo: moved,
    newest: newest ?? null,
    detail: `${feed.format}${feed.dropped > 0 ? `, ${feed.dropped} unusable` : ""}`,
  };
}

/** Trailing slashes and the scheme are not a move. */
function normalise(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** `getUTCDay()` order, matching the names RSS uses in `<skipDays>`. */
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const MARK: Record<Verdict["state"], string> = {
  ok: "ok    ",
  paused: "quiet ",
  empty: "empty ",
  unparsed: "html  ",
  failed: "FAIL  ",
};

function line(v: Verdict): string {
  const age = v.newest ? ` newest ${v.newest.slice(0, 10)}` : "";
  const items = v.state === "ok" ? String(v.items).padStart(3) : "  -";
  const moved = v.movedTo ? `\n         → redirected to ${v.movedTo}` : "";
  return `${MARK[v.state]}${items}  ${v.name.padEnd(24)} ${v.detail}${age}${moved}`;
}

function report(verdicts: Verdict[]): void {
  const by = (state: Verdict["state"]) => verdicts.filter((v) => v.state === state);

  heading("Summary");
  say(`working        ${by("ok").length}`);
  say(`quiet today    ${by("paused").length}`);
  say(`no entries     ${by("empty").length}`);
  say(`html, not xml  ${by("unparsed").length}`);
  say(`unreachable    ${by("failed").length}`);
  say(`articles seen  ${verdicts.reduce((sum, v) => sum + v.items, 0)}`);

  const moved = verdicts.filter((v) => v.movedTo !== null && v.state === "ok");
  if (moved.length > 0) {
    heading("Working, but redirected");
    say("Left alone on purpose. A redirect that is a permanent move wants the URL");
    say("updated in the console; one that lands on a paywall or an aggregator does");
    say("not, and the two are indistinguishable from here.");
    say();
    for (const v of moved) say(`  ${v.name}\n    ${v.feedUrl}\n    → ${v.movedTo}`);
  }

  const quiet = by("paused");
  if (quiet.length > 0) {
    heading("Quiet today, on purpose");
    say("These served a valid feed with nothing in it, on a day they told us they");
    say("do not publish. Nothing is wrong with them.");
    say();
    for (const v of quiet) say(`  ${v.name.padEnd(24)} ${v.detail}`);
  }

  const waiting = verdicts.filter((v) => v.state !== "ok" && v.state !== "paused" && !v.dead);
  if (waiting.length > 0) {
    heading("Failed, but not condemned");
    say("A bad moment rather than a bad address: a timeout, a server error, or a");
    say("live feed that happens to be empty. Left active — if it keeps happening,");
    say("the ingester's failure count will catch it.");
    say();
    for (const v of waiting) say(`  ${v.name.padEnd(24)} ${v.detail}\n    ${v.feedUrl}`);
  }

  const dead = verdicts.filter((v) => v.dead);
  if (dead.length > 0) {
    heading("Wrong address");
    for (const v of dead) say(`  ${v.name.padEnd(24)} ${v.detail}\n    ${v.feedUrl}`);
  }
}

async function disableFailures(verdicts: Verdict[]): Promise<void> {
  const targets = verdicts.filter((v) => v.dead && v.active);
  if (targets.length === 0) {
    heading("Nothing to disable");
    say("Nothing failed in a way that means its address is wrong.");
    return;
  }

  heading(`Disabling ${targets.length} feeds`);

  for (const v of targets) {
    const { error } = await db().from("sources").update({ active: false }).eq("id", v.id);
    if (error) {
      say(`  ${v.name}: could not disable — ${error.message}`);
      continue;
    }

    // Every mutating console action writes an audit row; a script that mutates
    // the same table is not exempt. `actor_id` is null because no person did
    // this, and the email records what did.
    await db()
      .from("admin_audit_log")
      .insert({
        actor_id: null,
        actor_email: "script:check-feeds",
        action: "source.disable",
        target_type: "source",
        target_id: v.id,
        meta: { reason: v.detail, state: v.state, feed_url: v.feedUrl },
      });

    say(`  ${v.name}: off — ${v.detail}`);
  }
}
