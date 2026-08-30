import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Security and concurrency invariants, asserted against the migrations
 * themselves (docs/plan2.md §96, §97).
 *
 * ---------------------------------------------------------------------------
 * Why these read SQL text instead of talking to a database
 * ---------------------------------------------------------------------------
 *
 * plan2 §96 asks for tests proving a user cannot mutate global pipeline
 * state — mark a source core, alter demand counters, write a translation,
 * grant themselves a plan. The real enforcement of every one of those is a
 * Postgres policy, and this repo cannot reach a database from the test suite
 * (no DDL, no test instance; see `plan.md` stage 1).
 *
 * What CAN be checked here is the thing that actually protects those tables:
 * that they have RLS on and **no write policy at all**. That is not a
 * proxy for the guarantee, it *is* the guarantee — `database.md`: "a table
 * with RLS on and no matching policy denies by default, and that default is
 * used deliberately". A migration that added a write policy to
 * `event_translations` would break the invariant, and this test is what
 * notices.
 *
 * These are deliberately narrow. They cannot prove Postgres enforces RLS
 * correctly; they prove this codebase never asked it to stop.
 */

const DIR = "supabase/migrations";
const ALL_SQL = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(`${DIR}/${f}`, "utf8") }));

const joined = ALL_SQL.map((f) => f.sql).join("\n");

/** Every `create policy` statement across every migration. */
function policiesFor(table: string): string[] {
  const pattern = new RegExp(`create policy[^;]*?on\\s+public\\.${table}\\b[^;]*;`, "gis");
  return joined.match(pattern) ?? [];
}

function writePoliciesFor(table: string): string[] {
  return policiesFor(table).filter((p) => /for\s+(insert|update|delete|all)\b/i.test(p));
}

/**
 * Guards every other test in this file.
 *
 * Almost all of the assertions below are of the form "this table has no write
 * policy", and they are satisfied by an empty array. So a matcher that
 * silently found *nothing* — a mistyped table name, a regex broken by an
 * escaping change, a migration directory that moved — would turn this entire
 * file green while checking nothing at all.
 *
 * This is not hypothetical: while writing these tests a debugging harness did
 * exactly that, and every assertion passed vacuously. So the matcher is now
 * required to prove it can find policies that are known to exist.
 */
describe("the matcher these tests depend on actually works", () => {
  it("finds the read policies that certainly exist", () => {
    expect(policiesFor("sources").length).toBeGreaterThan(0);
    expect(policiesFor("events").length).toBeGreaterThan(0);
    expect(policiesFor("event_translations").length).toBeGreaterThan(0);
  });

  it("finds a write policy where one genuinely exists", () => {
    // `profiles` has "update own profile" (0002) and `user_custom_sources`
    // has delete/update for its owner (0030). If the write-policy filter
    // cannot see these, "no write policy" means nothing anywhere else.
    expect(writePoliciesFor("profiles").length).toBeGreaterThan(0);
    expect(writePoliciesFor("user_custom_sources").length).toBeGreaterThan(0);
  });

  it("read a non-trivial amount of SQL", () => {
    expect(ALL_SQL.length).toBeGreaterThan(20);
    expect(joined.length).toBeGreaterThan(50_000);
  });
});

describe("global pipeline tables are read-only to the browser", () => {
  // Every table the pipeline writes and readers merely see. A write policy on
  // any of these would let a reader forge shared state — a fake translation,
  // an invented impact, a source marked core.
  const readOnly = [
    "sources",
    "events",
    "articles",
    "event_topics",
    "source_topics",
    "event_impacts",
    "event_translations",
    "polling_tiers",
  ];

  for (const table of readOnly) {
    it(`${table} has no insert, update or delete policy`, () => {
      expect(writePoliciesFor(table)).toEqual([]);
    });
  }

  it("has RLS enabled on each of them", () => {
    for (const table of readOnly) {
      expect(joined).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`, "i"),
      );
    }
  });
});

describe("operational tables are unreachable from a browser entirely", () => {
  // Not even readable: no policy of any kind, so RLS denies everything.
  const invisible = ["ai_providers", "ai_model_routes", "ai_prompts", "cluster_shadow_log"];

  for (const table of invisible) {
    it(`${table} has no policy at all`, () => {
      expect(policiesFor(table)).toEqual([]);
    });
  }

  it("still enables RLS on them, so the absence of a policy denies", () => {
    // RLS off + no policy is wide open. The pairing is what matters.
    for (const table of invisible) {
      expect(joined).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`, "i"),
      );
    }
  });
});

describe("a reader cannot grant themselves anything", () => {
  it("keeps role out of profiles, which users may update", () => {
    // 0002 grants "update own profile" for all columns. A role column there
    // would be self-grantable with one PostgREST call.
    const init = ALL_SQL.find((f) => f.name.startsWith("0001"))?.sql ?? "";
    const profiles = init.slice(
      init.indexOf("create table public.profiles"),
      init.indexOf(");", init.indexOf("create table public.profiles")),
    );
    expect(profiles).not.toMatch(/\brole\b/);
  });

  it("gives user_roles no write policy", () => {
    expect(writePoliciesFor("user_roles")).toEqual([]);
  });

  it("gives subscriptions no write policy — plan comes from Stripe, not the client", () => {
    expect(writePoliciesFor("subscriptions")).toEqual([]);
  });

  it("gives user_events, digests and digest_items no write policy", () => {
    // Produced by the pipeline. A reader who could write user_events could
    // insert themselves into any event's audience.
    for (const table of ["user_events", "digests", "digest_items", "deliveries"]) {
      expect(writePoliciesFor(table)).toEqual([]);
    }
  });

  it("gives user_custom_sources no INSERT policy, so the plan cap cannot be bypassed", () => {
    // Deliberately asymmetric: select/update/delete are the reader's own, but
    // adding a follow must go through claim_custom_source where the cap is.
    const inserts = policiesFor("user_custom_sources").filter((p) =>
      /for\s+(insert|all)\b/i.test(p),
    );
    expect(inserts).toEqual([]);
  });
});

describe("paid shared work cannot be bought twice", () => {
  // plan2 §70: two workers must never purchase the same reusable result.
  // Each of these is a conditional update or a lock, evaluated by Postgres
  // rather than assumed by a process.
  it("claims events before analysing them", () => {
    const analyse = readFileSync("src/lib/pipeline/analyse.ts", "utf8");
    expect(analyse).toContain('status: "analysing"');
    expect(analyse).toMatch(/\.is\("analysed_at", null\)/);
  });

  it("claims shared impacts before generating them", () => {
    const digest = readFileSync("src/lib/pipeline/digest.ts", "utf8");
    expect(digest).toContain('status: "generating"');
    expect(digest).toContain("claimImpacts");
  });

  it("claims translations before generating them", () => {
    const translate = readFileSync("src/lib/pipeline/translate.ts", "utf8");
    expect(translate).toContain('status: "generating"');
    // Keyed on content_version too, so a claim cannot cover the wrong text.
    expect(translate).toContain("content_version");
  });

  it("serialises a reader's own concurrent custom-source adds with a lock", () => {
    const sql = ALL_SQL.find((f) => f.name.startsWith("0030"))?.sql ?? "";
    expect(sql).toContain("pg_advisory_xact_lock");
  });
});

describe("expensive functions are not callable from a browser", () => {
  /**
   * **`from anon, authenticated` is not enough, and this test used to accept
   * it.**
   *
   * `CREATE FUNCTION` grants EXECUTE to PUBLIC by default, and both `anon`
   * and `authenticated` inherit it. Revoking from those two roles removes a
   * grant they never held directly and leaves the PUBLIC grant intact — the
   * line reads like a lock and does nothing.
   *
   * Verified live on 2026-08-30: ten functions were callable by an
   * unauthenticated anon client, including `claim_custom_source`, which
   * wrote a row into another user's account. `0036` fixes them.
   *
   * The earlier version of this test asserted the revoke line *existed*. It
   * did exist. No test that reads SQL as text can tell a working revoke from
   * a useless one — which is why `npm run verify:live` executes the calls
   * instead. This assertion now requires the form that actually works, so
   * the next function added cannot repeat the mistake silently.
   */
  const mustBeRevoked = [
    "admin_daily_counts",
    "admin_source_stats",
    "admin_source_demand",
    "admin_cost_intelligence",
    "cluster_shadow_summary",
    "sources_to_collect",
    "events_with_demand",
    "refresh_source_demand",
    "recompute_polling_tiers",
    "claim_custom_source",
  ];

  for (const fn of mustBeRevoked) {
    it(`${fn} is revoked from PUBLIC, not merely from anon`, () => {
      expect(joined).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\b[^;]*from public\\b`, "is"),
      );
    });

    it(`${fn} is granted back to service_role`, () => {
      // Revoking from PUBLIC removes the pipeline's access too. Without this
      // grant the fix would break every legitimate caller.
      expect(joined).toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\b[^;]*to service_role`, "is"),
      );
    });
  }

  it("keeps increment_post_view reachable, deliberately", () => {
    // A signed-out visitor must be able to increment a blog post's counter,
    // and a policy cannot express "may update one column, only upward".
    // Documented in database.md; asserted so a future sweep does not "fix" it.
    expect(joined).not.toMatch(/revoke all on function public\.increment_post_view/i);
  });
});

describe("failure is bounded, not retried forever", () => {
  // plan2 §71: never "cron sees failed -> pay again forever".
  it("excludes failed events from scheduled analysis", () => {
    const analyse = readFileSync("src/lib/pipeline/analyse.ts", "utf8");
    expect(analyse).toContain('options.retryFailed === true ? "pending,failed" : "pending"');
  });

  it("does not reclaim a failed impact or translation on the ordinary path", () => {
    // Only 'pending' and stale 'generating' are reclaimed. 'failed' is left
    // for a deliberate retry, so an unwritable one cannot bill on every run.
    for (const file of ["src/lib/pipeline/digest.ts", "src/lib/pipeline/translate.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("status.eq.pending,and(status.eq.generating,updated_at.lt.");
    }
  });
});

describe("gates fail in the direction that keeps the product working", () => {
  it("runs analysis normally when the demand gate cannot be evaluated", () => {
    // Fail open: a broken gate must not silently stop all analysis.
    const analyse = readFileSync("src/lib/pipeline/analyse.ts", "utf8");
    expect(analyse).toContain("running without it this pass");
  });

  it("collects everything when demand or cadence cannot be evaluated", () => {
    const ingest = readFileSync("src/lib/pipeline/ingest.ts", "utf8");
    expect(ingest).toContain("collecting everything");
    expect(ingest).toContain("uniform cadence");
  });

  it("keeps asking the model when the cluster skip cannot be evaluated", () => {
    // Fail closed here, and that is the correct direction: the risk is a
    // wrong merge, so the fallback is the behaviour that has always been safe.
    const cluster = readFileSync("src/lib/pipeline/cluster.ts", "utf8");
    expect(cluster).toContain("Fails closed");
  });
});
