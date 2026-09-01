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
  const invisible = [
    "ai_providers",
    "ai_model_routes",
    "ai_prompts",
    "ai_usage_ledger",
    "billing_ledger",
    "operating_cost_settings",
    "cluster_shadow_log",
    "source_probe_log",
  ];

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
    "claim_source_probe",
    "purge_expired_corpus",
    "pending_events_with_demand",
    "release_ai_reservation",
    "claim_subscription_checkout",
    "release_subscription_checkout",
    "claim_delivery",
    "create_alert_delivery",
    "record_ops_status",
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

describe("launch repair concurrency and recovery", () => {
  const repair = readFileSync("supabase/migrations/0045_launch_blocker_repair.sql", "utf8");

  it("selects demanded pending events before applying the batch limit", () => {
    const start = repair.indexOf("pending_events_with_demand");
    const fn = repair.slice(start, repair.indexOf("$fn$;", start));
    expect(start).toBeGreaterThan(-1);
    expect(fn.indexOf("exists (")).toBeGreaterThan(-1);
    expect(fn.indexOf("exists (")).toBeLessThan(fn.indexOf("limit greatest"));

    const analysis = readFileSync("src/lib/pipeline/analyse.ts", "utf8");
    expect(analysis).toContain('db.rpc("pending_events_with_demand"');
    expect(analysis).not.toMatch(/pending_events_with_demand[\s\S]{0,500}events_with_demand/);
  });

  it("persists capacity deferrals and makes them due automatically", () => {
    expect(repair).toMatch(
      /analysis_deferred_until is null or e\.analysis_deferred_until <= now\(\)/,
    );
    const analysis = readFileSync("src/lib/pipeline/analyse.ts", "utf8");
    expect(analysis).toContain('status: "pending"');
    expect(analysis).toContain("analysis_deferred_until: retryAt.toISOString()");
    expect(analysis).toContain("analysis_deferred_until.lte");
  });

  it("uses recoverable delivery leases and transactional alert creation", () => {
    expect(repair).toMatch(/create or replace function public\.claim_delivery/);
    expect(repair).toMatch(/processing_started_at < now\(\) - make_interval/);
    expect(repair).toMatch(/create or replace function public\.create_alert_delivery/);
    expect(repair).toMatch(/admission := public\.claim_alert/);
    expect(repair).toMatch(/insert into public\.digest_items/);
    expect(repair).toMatch(/insert into public\.deliveries/);
  });

  it("releases only an unused AI reservation", () => {
    expect(repair).toMatch(/create or replace function public\.release_ai_reservation/);
    expect(repair).toMatch(/cost_microusd is null/);
    expect(repair).toMatch(/prompt_tokens = 0/);
    expect(repair).toMatch(/completion_tokens = 0/);
  });
});

describe("launch cost and privacy boundaries", () => {
  it("keeps a finite AI budget when the deployment binding is forgotten", () => {
    const budget = readFileSync("src/lib/ai/budget.ts", "utf8");
    expect(budget).toContain("DEFAULT_AI_MONTHLY_TOKEN_BUDGET = 500_000");
    expect(budget).toContain("DEFAULT_AI_MONTHLY_COST_USD = 10");

    const config = readFileSync("src/lib/ai/config.ts", "utf8");
    expect(config).toMatch(/configured \? Number\(configured\) : DEFAULT_AI_MONTHLY_TOKEN_BUDGET/);
    expect(config).toMatch(
      /configuredCost \? Number\(configuredCost\) : DEFAULT_AI_MONTHLY_COST_USD/,
    );
    expect(config).not.toContain("if (!configured) return null");
  });

  it("caps spend in money as well as tokens, and refuses on either ceiling", () => {
    // A token ceiling cannot bound an invoice: the same token count costs
    // thirtyfold more on one route than another. Both ceilings must reach the
    // reservation, and the reservation is the only place that can refuse — once
    // the provider has been called the money is already gone.
    const config = readFileSync("src/lib/ai/config.ts", "utf8");
    expect(config).toContain("p_global_monthly_cost_microusd");
    expect(config).toContain("p_estimated_cost_microusd");
    expect(config).toContain("throw new AiBudgetExceededError()");

    const migration = readFileSync("supabase/migrations/0044_ai_cost_ceiling.sql", "utf8");
    // The pre-ceiling overload must not survive beside the new one, or
    // PostgREST could resolve to an uncapped path.
    expect(migration).toContain(
      "drop function if exists public.reserve_ai_tokens(uuid, text, text, integer, integer, integer)",
    );
    expect(migration).toMatch(/revoke all on function public\.reserve_ai_tokens\(/);
    expect(migration).toMatch(/revoke all on function public\.ai_spend_this_month\(\)/);
  });

  it("does not send the reader-specific match reason to Ask AI", () => {
    const briefing = readFileSync("src/lib/server/briefing.ts", "utf8");
    const askHandler = briefing.slice(briefing.indexOf("export const askStory"));
    expect(askHandler).not.toContain("story.why");
  });

  it("ships browser hardening headers from the outer response boundary", () => {
    const server = readFileSync("src/server.ts", "utf8");
    for (const header of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Permissions-Policy",
    ]) {
      expect(server).toContain(header);
    }
  });

  it("does not mistake a claimed Stripe event for a completed one", () => {
    const webhook = readFileSync("src/lib/server/stripe/webhook.ts", "utf8");
    expect(webhook).toContain("processing_started_at");
    expect(webhook).toContain("processed_at");
    expect(webhook).toContain("completeEvent");
  });

  it("does not expose operational settings and flags through anonymous PostgREST", () => {
    const launch = ALL_SQL.find((f) => f.name === "0042_launch_capacity.sql")?.sql ?? "";
    expect(launch).toContain('drop policy if exists "site settings readable"');
    expect(launch).toContain('drop policy if exists "flags readable"');
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

/**
 * Capacity, the waitlist and maintenance (0038).
 *
 * The waitlist is the most sensitive table added since the audit log: it holds
 * the address of everybody who ever asked for an account, none of whom have
 * one. And `invited_at` is effectively a permission — a row carrying it is
 * what admits an address past a full cap — so a reader able to write this
 * table could let themselves in.
 */
describe("access control (0038)", () => {
  it("gives the waitlist no policy at all", () => {
    // Not "no write policy" — no policy. A select policy would expose every
    // applicant's email to any signed-in account.
    expect(policiesFor("waitlist")).toHaveLength(0);
    expect(joined).toMatch(/alter table public\.waitlist enable row level security/i);
  });

  it("enforces the cap in a trigger on auth.users, not in application code", () => {
    // The reason this is a trigger: OAuth signup never reaches a server
    // function we wrote. If this assertion ever fails, the cap is bypassable
    // by clicking "Continue with Google".
    const sql = ALL_SQL.find((f) => f.name === "0038_access_control.sql")?.sql ?? "";
    expect(sql).toMatch(/create trigger enforce_signups_open/i);
    expect(sql).toMatch(/before insert on auth\.users/i);
    expect(sql).toMatch(/raise exception 'nyuz is at capacity'/i);
  });

  it("takes the seat count under a lock", () => {
    // Without this, two signups racing for one seat both read the old count
    // and both succeed.
    const sql = ALL_SQL.find((f) => f.name === "0038_access_control.sql")?.sql ?? "";
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
  });

  it("spends an invitation rather than leaving it reusable", () => {
    // A permanent bypass for one address would be a way past the cap forever.
    const sql = ALL_SQL.find((f) => f.name === "0038_access_control.sql")?.sql ?? "";
    expect(sql).toMatch(/update public\.waitlist\s+set signed_up_at = now\(\)/i);
  });

  it("revokes the access helper from PUBLIC, not only from anon", () => {
    // 0036's lesson: revoking from `anon, authenticated` leaves the default
    // PUBLIC grant in place and reads like a lock while doing nothing.
    const sql = ALL_SQL.find((f) => f.name === "0038_access_control.sql")?.sql ?? "";
    expect(sql).toMatch(
      /revoke all on function public\.admin_access_state\(\) from public, anon, authenticated/i,
    );
  });
});

/**
 * Source visibility (0039).
 *
 * The specific thing being protected: `sources` became reader-writable in 0030,
 * so one account's private feed is a row in the table every account reads. If
 * these fail, one reader's local paper or employer feed is visible to every
 * other reader — through the source page, or by querying PostgREST directly
 * with their own token.
 */
describe("source visibility (0039)", () => {
  const raw = () => ALL_SQL.find((f) => f.name === "0039_source_visibility.sql")?.sql ?? "";
  // Comments in this migration discuss `created_by_user_id` and `coverage_mode`
  // at length, precisely to explain why neither is used. Asserting against the
  // raw text therefore matches the explanation rather than the code.
  const sql = () => raw().replace(/^\s*--.*$/gm, "");

  it("replaces the blanket read policy on sources", () => {
    // 0002 granted `using (true)`. That is the leak.
    expect(sql()).toMatch(/drop policy if exists "sources readable" on public\.sources/i);
    const policies = policiesFor("sources");
    const latest = policies[policies.length - 1] ?? "";
    expect(latest).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("limits a reader to the catalogue plus their own follows", () => {
    const latest = policiesFor("sources").at(-1) ?? "";
    expect(latest).toMatch(/listed/);
    expect(latest).toMatch(/user_custom_sources/);
    expect(latest).toMatch(/auth\.uid\(\)/);
  });

  it("still gives readers no way to write a source", () => {
    // Adding one has to stay behind `claim_custom_source`, which holds the cap.
    expect(writePoliciesFor("sources")).toHaveLength(0);
  });

  it("defaults new sources to unlisted", () => {
    // A reader-submitted feed must be private until somebody promotes it. A
    // default of true would publish every submission the moment it was made.
    expect(sql()).toMatch(/listed\s+boolean\s+not null\s+default\s+false/i);
  });

  it("keeps the existing catalogue visible after the migration", () => {
    // Everything seeded before 0039 is curated, so the backfill must list it.
    // Without this line the migration silently empties every reader's source
    // page.
    expect(sql()).toMatch(/update public\.sources set listed = true, origin = 'curated'/i);
  });

  it("does not reuse coverage_mode as visibility", () => {
    // 27 curated sources are `demand`. Filtering the catalogue on coverage
    // would hide all of them from the readers who asked for those subjects.
    const listedPredicates = sql().match(/listed\s*=\s*coverage_mode|coverage_mode[^;]*listed/gi);
    expect(listedPredicates).toBeNull();
  });

  it("records provenance without naming an owner", () => {
    // Ownership is many-to-many in `user_custom_sources` — one canonical source,
    // many followers. A `created_by_user_id` would describe only whoever was
    // first and would go stale when they left.
    expect(sql()).toMatch(/create type public\.source_origin as enum \('curated', 'user'\)/i);
    expect(sql()).not.toMatch(/created_by_user_id/i);
    // And the explanation for that choice is still in the file.
    expect(raw()).toMatch(/created_by_user_id/i);
  });

  it("bounds the reader source list in SQL rather than in the caller", () => {
    // The bug was an unbounded `select * from sources`. A limit applied in
    // TypeScript would still transfer the whole table.
    expect(sql()).toMatch(/create or replace function public\.reader_sources/i);
    expect(sql()).toMatch(/limit greatest\(0, least\(coalesce\(p_limit/i);
  });

  it("scopes both reader functions to the caller and revokes them from PUBLIC", () => {
    expect(sql()).toMatch(
      /revoke all on function public\.reader_sources\(uuid, integer, integer\)\s*\n?\s*from public, anon, authenticated/i,
    );
    expect(sql()).toMatch(
      /revoke all on function public\.search_reader_sources\(uuid, text, integer\)\s*\n?\s*from public, anon, authenticated/i,
    );
  });

  it("keeps search inside the catalogue plus own sources", () => {
    // Discovery is wider than the topic-filtered list, but not wider than the
    // visibility rule — otherwise search becomes the way to enumerate every
    // reader's private feeds.
    const fn = sql().slice(sql().indexOf("search_reader_sources"));
    expect(fn).toMatch(/s\.listed/);
    expect(fn).toMatch(/user_custom_sources/);
  });
});
