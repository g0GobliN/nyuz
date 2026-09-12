import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Migration 0053, asserted against the migration itself, plus the two call
 * sites whose gate cannot be driven from a unit test.
 *
 * These are text assertions, for the same reason `security-invariants.test.ts`
 * gives: this suite cannot reach a database, and the properties below are
 * properties of the SQL. They are not a substitute for running it. The
 * migration WAS run — against a real PostgreSQL 17, where the daily caps, the
 * UTC day boundary, the concurrent-reservation race, the feature tagging and
 * the three aggregation windows were each exercised. What these tests do is
 * notice if someone later edits the property back out.
 *
 * The specific failures they exist to catch, all of which were real in the
 * first draft of this migration:
 *
 *   - a daily cap read BEFORE the advisory lock, which two callers can both
 *     pass (measured: $1.20 of reservations against a $1.00 cap);
 *   - a wider function signature added beside the old one rather than
 *     replacing it, which makes every reservation fail as "not unique";
 *   - `p_model.startswith(...)`, which is not Postgres and would raise on
 *     every call;
 *   - a `p_days` argument the function never read.
 */

const SQL = readFileSync("supabase/migrations/0053_launch_cost_safety.sql", "utf8");

/**
 * The migration with its `--` comments removed.
 *
 * Needed because this file's comments quote the very shapes these tests forbid
 * ("count(*) would report...", "does not touch deterministic_cluster_skip"),
 * and a matcher that reads a comment as code passes or fails for reasons that
 * have nothing to do with what the migration does.
 */
const CODE = SQL.replace(/^\s*--.*$/gm, "");

const reserveFn = SQL.slice(
  SQL.indexOf("create function public.reserve_ai_tokens"),
  SQL.indexOf("$fn$;", SQL.indexOf("create function public.reserve_ai_tokens")),
);

describe("the daily caps cannot be passed by two callers at once", () => {
  it("takes the advisory lock before reading any budget", () => {
    const lock = reserveFn.indexOf("pg_advisory_xact_lock");
    const dailyRead = reserveFn.indexOf("into day_spent");
    const monthlyRead = reserveFn.indexOf("into global_used");
    const insert = reserveFn.indexOf("insert into public.ai_usage_ledger");

    expect(lock).toBeGreaterThan(-1);
    expect(dailyRead).toBeGreaterThan(lock);
    expect(monthlyRead).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(lock);
  });

  it("counts in-flight reservations against the day, and abandoned ones against nothing", () => {
    const dailyBlock = reserveFn.slice(
      reserveFn.indexOf("if model_prefix is not null"),
      reserveFn.indexOf("into global_used"),
    );
    // An in-flight call counts at its authorised estimate...
    expect(dailyBlock).toContain("coalesce(cost_microusd, estimated_cost_microusd, 0)");
    // ...unless it is one of 0047's abandoned reservations.
    expect(dailyBlock).toContain("created_at < stale_before");
    expect(dailyBlock).toContain("reserved_tokens > 0");
  });

  it("refuses an unpriceable call before it does any cap arithmetic", () => {
    const nullGuard = reserveFn.indexOf("p_estimated_cost_microusd is null");
    expect(nullGuard).toBeGreaterThan(-1);
    expect(nullGuard).toBeLessThan(reserveFn.indexOf("into day_spent"));
  });

  it("matches models with SQL, not with a method that does not exist in SQL", () => {
    expect(reserveFn).not.toContain("startswith");
    expect(reserveFn).toContain("p_model like 'deepseek-v4-flash%'");
    expect(reserveFn).toContain("p_model like 'deepseek-v4-pro%'");
  });

  it("measures the day in UTC, in the same expression the console reads", () => {
    const utcDay = "date_trunc('day', (now() at time zone 'UTC')) at time zone 'UTC'";
    expect(reserveFn).toContain(utcDay);
    // `admin_cost_breakdown`'s TODAY window must be the identical boundary, or
    // the operator's dashboard and the cap disagree about what day it is.
    expect(SQL.slice(SQL.indexOf("create function public.admin_cost_breakdown"))).toContain(utcDay);
  });

  it("caps each production tier against its own envelope", () => {
    expect(reserveFn).toContain("day_cap := p_daily_flash_cap_microusd");
    expect(reserveFn).toContain("day_cap := p_daily_pro_cap_microusd");
    expect(reserveFn).toContain("if day_spent + p_estimated_cost_microusd > day_cap then");
  });

  it("keeps both monthly ceilings and the reader's plan cap", () => {
    expect(reserveFn).toContain("global_used + p_reserve > p_global_monthly_cap");
    expect(reserveFn).toContain(
      "spent + p_estimated_cost_microusd > p_global_monthly_cost_microusd",
    );
    expect(reserveFn).toContain("user_used + p_reserve > p_user_monthly_cap");
  });
});

describe("the new signatures replace the old ones rather than joining them", () => {
  it("drops both older reserve_ai_tokens overloads first", () => {
    expect(SQL).toContain(
      "drop function if exists public.reserve_ai_tokens(\n  uuid, text, text, integer, integer, integer\n)",
    );
    expect(SQL).toContain(
      "drop function if exists public.reserve_ai_tokens(\n  uuid, text, text, integer, integer, integer, bigint, bigint\n)",
    );
    expect(SQL.indexOf("drop function if exists public.reserve_ai_tokens")).toBeLessThan(
      SQL.indexOf("create function public.reserve_ai_tokens"),
    );
  });

  it("drops the five-argument settle_ai_tokens first", () => {
    expect(SQL).toContain(
      "drop function if exists public.settle_ai_tokens(uuid, integer, integer, integer, bigint)",
    );
    expect(SQL.indexOf("drop function if exists public.settle_ai_tokens")).toBeLessThan(
      SQL.indexOf("create function public.settle_ai_tokens"),
    );
  });

  it("settles by uuid, which is the type the column is", () => {
    const settle = SQL.slice(SQL.indexOf("create function public.settle_ai_tokens"));
    expect(settle).toContain("p_id uuid");
    expect(settle).not.toContain("p_id text");
  });

  it("keeps 0043's clamps when settling", () => {
    const settle = SQL.slice(SQL.indexOf("create function public.settle_ai_tokens"));
    expect(settle).toContain("greatest(0, p_prompt_tokens)");
    expect(settle).toContain("least(p_prompt_tokens, p_cached_prompt_tokens)");
  });

  it("revokes from PUBLIC and grants to service_role on every new signature", () => {
    for (const fn of [
      "reserve_ai_tokens",
      "settle_ai_tokens",
      "admin_cost_breakdown",
      "admin_cost_by_model",
    ]) {
      expect(SQL).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\b[^;]*from public\\b`, "is"),
      );
      expect(SQL).toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\b[^;]*to service_role`, "is"),
      );
    }
  });
});

describe("every row records why it spent", () => {
  it("constrains the feature column to the six call sites plus unknown", () => {
    for (const feature of [
      "cluster",
      "analyse",
      "enrich",
      "translate",
      "impact",
      "ask",
      "unknown",
    ]) {
      expect(SQL).toMatch(new RegExp(`ai_usage_ledger_feature_check[\\s\\S]*'${feature}'`));
    }
  });

  it("backfills existing rows as unknown rather than guessing", () => {
    expect(SQL).toContain("set feature = 'unknown'\n where feature is null");
  });

  it("tags the reservation, not only the settlement", () => {
    // The row that matters most is the one that never settles.
    expect(reserveFn).toContain("p_feature text default 'unknown'");
    expect(reserveFn).toContain("resolved_feature");
    expect(reserveFn.slice(reserveFn.indexOf("insert into public.ai_usage_ledger"))).toContain(
      "resolved_feature",
    );
  });

  it("degrades an unrecognised feature instead of failing the write", () => {
    expect(reserveFn).toContain("else 'unknown'");
    expect(SQL.slice(SQL.indexOf("create function public.settle_ai_tokens"))).toContain(
      "else feature",
    );
  });
});

describe("the cost breakdown answers the question it was asked", () => {
  const breakdown = SQL.slice(
    SQL.indexOf("create function public.admin_cost_breakdown"),
    SQL.indexOf("$fn$;", SQL.indexOf("create function public.admin_cost_breakdown")),
  );

  it("has no argument, rather than one it ignores", () => {
    expect(SQL).toContain("create function public.admin_cost_breakdown()");
    expect(breakdown).not.toContain("p_days");
  });

  it("reports today, seven days and thirty days", () => {
    expect(breakdown).toContain("'today'");
    expect(breakdown).toContain("'7_days'");
    expect(breakdown).toContain("'30_days'");
  });

  it("cross joins every feature into every window, so a disabled one reads as zero", () => {
    expect(breakdown).toContain("cross join (values");
    for (const feature of [
      "cluster",
      "analyse",
      "enrich",
      "translate",
      "impact",
      "ask",
      "unknown",
    ]) {
      expect(breakdown).toContain(`('${feature}')`);
    }
    expect(breakdown).toContain("left join live l");
  });

  it("counts a joined column, so an empty window is zero calls and not one", () => {
    expect(breakdown).toContain("count(l.id)::bigint as calls");
    expect(breakdown.replace(/^\s*--.*$/gm, "")).not.toMatch(/count\(\*\)/);
  });

  it("excludes abandoned reservations from what it reports as spend", () => {
    expect(breakdown).toContain("created_at < now() - interval '1 hour'");
  });
});

describe("what 0053 switches on, and what it leaves alone", () => {
  it("adds exactly four feature flags, every one of them off", () => {
    const inserted = [...SQL.matchAll(/^\s{2}\(\s*\n\s{4}'([a-z_]+)',/gm)].map((m) => m[1]);
    expect(inserted).toEqual([
      "ai_kill_switch",
      "ask_nyuz_enabled",
      "story_translation_enabled",
      "enrichment_pass_enabled",
    ]);

    const flagBlock = SQL.slice(
      SQL.indexOf("insert into public.feature_flags"),
      SQL.indexOf("on conflict (key) do update"),
    );
    expect(flagBlock).not.toContain("true,");
    expect([...flagBlock.matchAll(/^\s{4}false,$/gm)]).toHaveLength(4);
  });

  it("does not re-enable a flag an operator has switched off", () => {
    // `enabled` is deliberately absent from the conflict update: re-running a
    // migration must not undo an operator's decision.
    const conflict = SQL.slice(SQL.indexOf("on conflict (key) do update"));
    expect(conflict.slice(0, conflict.indexOf(";"))).not.toContain("enabled");
  });

  it("adds the two daily-cap settings without overwriting existing ones", () => {
    expect(SQL).toContain("'ai.daily_flash_cap_microusd'");
    expect(SQL).toContain("'ai.daily_pro_cap_microusd'");
    expect(SQL).toContain("on conflict (key) do nothing");
  });

  it("does not touch either deterministic clustering flag", () => {
    // The load-bearing one. Enabling `deterministic_cluster_skip` here would
    // change what the pipeline buys, silently, in a migration about budgets.
    const statements = CODE.split(";").filter((s) =>
      /insert into public\.feature_flags|update public\.feature_flags/i.test(s),
    );
    for (const statement of statements) {
      expect(statement).not.toContain("deterministic_cluster_v2");
      expect(statement).not.toContain("deterministic_cluster_skip");
    }
  });

  it("still has deterministic_cluster_skip off in the migration that created it", () => {
    const skipMigration = readFileSync("supabase/migrations/0034_cluster_skip_flag.sql", "utf8");
    const enabling = skipMigration.match(
      /update public\.feature_flags set enabled = true where key = 'deterministic_cluster_skip'/i,
    );
    expect(enabling).toBeNull();
  });
});

describe("the gates that cannot be driven from a unit test", () => {
  /**
   * Ask is a TanStack server function behind `signedInOnly` and a rate-limit
   * middleware, so invoking it here would mean standing up a request context
   * rather than testing the gate. What is asserted instead is the property that
   * makes the gate a gate: it returns before the two things that cost money.
   *
   * The behaviour it depends on — a refused or absent reservation meaning no
   * provider call — is executed for real in `budget-gates.test.ts`.
   */
  it("keeps Ask disabled without a claim or provider path", () => {
    const briefing = readFileSync("src/lib/server/briefing.ts", "utf8");
    const handler = briefing.slice(
      briefing.indexOf("export const askStory"),
      briefing.indexOf("export const", briefing.indexOf("export const askStory") + 1),
    );
    expect(handler).toContain('reason: "disabled"');
    expect(handler).not.toContain('rpc("claim_ask"');
    expect(handler).not.toContain("completeRouted");
    expect(handler).not.toContain("ask_nyuz_enabled");
    expect(handler).toContain(".middleware([aiRateLimit])");
  });

  it("checks the kill switch before writing a reservation", () => {
    const config = readFileSync("src/lib/ai/config.ts", "utf8");
    const reserve = config.slice(config.indexOf("async function reserveUsage"));
    expect(reserve.indexOf('.eq("key", "ai_kill_switch")')).toBeLessThan(
      reserve.indexOf('rpc("reserve_ai_tokens"'),
    );
  });
});

describe("0054: a core source is not a reader", () => {
  const DEMAND_SQL = readFileSync("supabase/migrations/0054_demand_only_analysis.sql", "utf8");
  /** Comments only name what the migration leaves alone; matchers read code. */
  const DEMAND_CODE = DEMAND_SQL.replace(/^\s*--.*$/gm, "");

  const fn = (name: string) =>
    DEMAND_SQL.slice(
      DEMAND_SQL.indexOf(`create or replace function public.${name}`),
      DEMAND_SQL.indexOf("$fn$;", DEMAND_SQL.indexOf(`create or replace function public.${name}`)),
    );

  for (const name of ["events_with_demand", "pending_events_with_demand"]) {
    it(`${name} no longer treats coverage_mode as demand`, () => {
      const body = fn(name);
      expect(body.length).toBeGreaterThan(0);
      expect(body).not.toContain("coverage_mode");
    });

    it(`${name} still counts a topic follower and a custom-source follower`, () => {
      // Both branches, and all four reachability conditions in each: an
      // unmuted topic, an account that is not auto-paused, briefings that are
      // not paused, and a login that is not banned.
      const body = fn(name);
      expect(body).toContain("public.user_topics");
      expect(body).toContain("public.user_custom_sources");
      expect(body).toContain("ut.muted = false");
      expect(body).toContain("ucs.active = true");
      expect([...body.matchAll(/auto_paused_at is null/g)]).toHaveLength(2);
      expect([...body.matchAll(/np\.paused = false/g)]).toHaveLength(2);
      expect([...body.matchAll(/banned_until is null/g)]).toHaveLength(2);
    });
  }

  it("leaves coverage_mode meaning what it meant everywhere else", () => {
    // 0054 must not touch collection, polling or the console's reporting —
    // core sources are still fetched, ingested and clustered.
    expect(DEMAND_CODE).not.toContain("sources_to_collect");
    expect(DEMAND_CODE).not.toContain("admin_source_demand");
    expect(DEMAND_CODE).not.toContain("alter table public.sources");
    expect(DEMAND_CODE).not.toMatch(/update public\.sources/i);
  });

  it("does not mark anything failed or delete anything", () => {
    // An event with no reader stays pending and becomes eligible when one
    // appears; an analysed event keeps its analysis.
    expect(DEMAND_CODE).not.toMatch(/\bdelete from\b/i);
    expect(DEMAND_CODE).not.toMatch(/update public\.events\b/i);
  });

  it("keeps both functions revoked from PUBLIC and granted to service_role", () => {
    for (const name of ["events_with_demand", "pending_events_with_demand"]) {
      expect(DEMAND_SQL).toMatch(
        new RegExp(`revoke all on function public\\.${name}\\b[^;]*from public\\b`, "is"),
      );
      expect(DEMAND_SQL).toMatch(
        new RegExp(`grant execute on function public\\.${name}\\b[^;]*to service_role`, "is"),
      );
    }
  });

  it("still has the gate itself switched on, which is what makes it a gate", () => {
    // With `pre_analysis_demand_gate` off, analyse.ts falls back to the legacy
    // selector and demand is not consulted at all. 0027 turns it on; nothing
    // since has turned it off.
    const all = ["0027_enable_flags.sql"].map((f) =>
      readFileSync(`supabase/migrations/${f}`, "utf8"),
    );
    expect(all[0]).toContain(
      "update public.feature_flags set enabled = true where key = 'pre_analysis_demand_gate'",
    );
  });
});
