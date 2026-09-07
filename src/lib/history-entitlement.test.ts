import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The history entitlement, asserted against the migration that enforces it.
 *
 * ---------------------------------------------------------------------------
 * What a text test can and cannot prove here
 * ---------------------------------------------------------------------------
 *
 * Same rule as `security-invariants.test.ts`: this repo cannot reach a
 * database from the test suite, so nothing below proves Postgres behaves. What
 * it proves is that this codebase never asked Postgres for the wrong thing —
 * that the window is on the digests policy, that grace is in the purge cutoff
 * and *not* in the access boundary, and that no per-user cleanup reaches a
 * shared table.
 *
 * Those are exactly the properties that would be quiet to break and expensive
 * to discover: an entitlement that stops being enforced looks identical to one
 * that is, right up until someone downgrades and keeps everything.
 */

const SQL = readFileSync("supabase/migrations/0067_history_entitlement.sql", "utf8");

/** The body of one `create or replace function`, dollar-quoted `$fn$`. */
function body(name: string): string {
  const pattern = new RegExp(
    `create or replace function public\\.${name}\\b[\\s\\S]*?\\$fn\\$([\\s\\S]*?)\\$fn\\$;`,
    "i",
  );
  const found = pattern.exec(SQL);
  // A renamed or deleted function must fail loudly rather than vacuously pass
  // every assertion made about an empty string.
  if (!found?.[1]) throw new Error(`0067 does not define public.${name}`);
  return found[1];
}

/** Every `create policy` for a table, across this migration. */
function policy(table: string): string {
  const pattern = new RegExp(`create policy[^;]*?on\\s+public\\.${table}\\b[^;]*;`, "is");
  const found = pattern.exec(SQL);
  if (!found) throw new Error(`0067 does not create a policy on public.${table}`);
  return found[0];
}

describe("the guard against a vacuous file", () => {
  it("finds the migration and its functions", () => {
    expect(SQL.length).toBeGreaterThan(1000);
    expect(body("history_window_start")).toContain("plan_history_days");
    expect(() => body("no_such_function")).toThrow();
  });
});

describe("7 / 90 / 365 is written down exactly once", () => {
  it("puts the numbers in plan_history_days", () => {
    const days = body("plan_history_days");
    expect(days).toMatch(/'omni'\s+then\s+365/i);
    expect(days).toMatch(/'plura'\s+then\s+90/i);
    expect(days).toMatch(/else\s+7/i);
  });

  it("has no other function restating them", () => {
    // Anything else spelling 90 or 365 is a second copy of the entitlement,
    // and a second copy is the one that gets missed when a number changes.
    for (const fn of ["history_window_start", "history_months", "purge_expired_digests"]) {
      expect(body(fn)).not.toMatch(/\b(90|365)\b/);
    }
  });
});

describe("access is the current plan, and grace never widens it", () => {
  it("computes the window from the plan on the subscription right now", () => {
    const window = body("history_window_start");
    expect(window).toContain("public.subscriptions");
    expect(window).toMatch(/now\(\)\s*-\s*make_interval/i);
  });

  it("does not consult the grace columns at all", () => {
    // The single most important line in this file. If the boundary ever reads
    // `history_grace_days`, a downgrade stops taking effect until the grace
    // expires and readers keep ninety days on a seven-day plan for a month.
    expect(body("history_window_start")).not.toMatch(/history_grace/i);
  });

  it("defaults an unknown reader to the smallest window", () => {
    expect(body("history_window_start")).toMatch(/coalesce[\s\S]*'uno'/i);
  });
});

describe("row-level security carries the window", () => {
  it("requires ownership and recency on digests", () => {
    const digests = policy("digests");
    expect(digests).toContain("auth.uid() = user_id");
    expect(digests).toMatch(/scheduled_for\s*>=\s*\(\s*select public\.history_window_start/i);
  });

  it("wraps the helper in a select, so it is an initplan rather than a per-row call", () => {
    // Bare, the helper is re-evaluated for every candidate row; an Omni reader
    // has 365 of them on the History page alone.
    expect(policy("digests")).toMatch(
      /\(\s*select public\.history_window_start\(auth\.uid\(\)\)\s*\)/i,
    );
  });

  it("restates the boundary on digest_items rather than inheriting it", () => {
    const items = policy("digest_items");
    expect(items).toContain("d.user_id = auth.uid()");
    expect(items).toMatch(/d\.scheduled_for\s*>=\s*\(\s*select public\.history_window_start/i);
  });

  it("keeps both policies read-only", () => {
    for (const table of ["digests", "digest_items"]) {
      expect(policy(table)).toMatch(/for\s+select/i);
      expect(policy(table)).not.toMatch(/for\s+(insert|update|delete|all)\b/i);
    }
  });
});

describe("downgrade grace is decided by the database", () => {
  it("fires on every plan change, whatever wrote it", () => {
    expect(SQL).toMatch(
      /create trigger subscriptions_history_grace\s+before update on public\.subscriptions/i,
    );
  });

  it("opens a thirty-day grace on a downgrade, holding the plan being left", () => {
    const grace = body("apply_history_grace");
    expect(grace).toMatch(/if new_days < old_days then/i);
    expect(grace).toMatch(/history_grace_days\s*:=\s*greatest\(old_days, carried\)/i);
    expect(grace).toMatch(/history_grace_until\s*:=\s*now\(\) \+ make_interval\(days => 30\)/i);
  });

  it("clears the grace on an upgrade that covers it", () => {
    expect(body("apply_history_grace")).toMatch(
      /elsif new_days >= carried then[\s\S]*?history_grace_days\s*:=\s*null/i,
    );
  });

  it("does nothing when the plan has not changed", () => {
    expect(body("apply_history_grace")).toMatch(
      /if new\.plan is not distinct from old\.plan then\s*return new;/i,
    );
  });
});

describe("purge keeps what grace is holding, and nothing more", () => {
  const purge = body("purge_expired_digests");

  it("cuts at the current entitlement when no grace is running", () => {
    expect(purge).toMatch(/else public\.plan_history_days\(s\.plan\)/i);
  });

  it("cuts at the wider of plan and grace while grace is running", () => {
    expect(purge).toMatch(/when s\.history_grace_until > now\(\)/i);
    expect(purge).toMatch(
      /greatest\(public\.plan_history_days\(s\.plan\), coalesce\(s\.history_grace_days, 0\)\)/i,
    );
  });

  it("prunes the match records on the same boundary", () => {
    // Previously never pruned at all: one row per matched event per reader,
    // kept for ever, for a window nobody may read.
    expect(purge).toMatch(/delete from public\.user_events/i);
    expect(purge).toMatch(/ue\.matched_at < c\.expires_before/i);
  });

  it("exempts saved stories from the match sweep", () => {
    expect(purge).toMatch(/not exists[\s\S]*?public\.saved_stories/i);
  });

  it("never deletes a saved story itself", () => {
    expect(SQL).not.toMatch(/delete from public\.saved_stories/i);
  });

  it("stays bounded and rerunnable", () => {
    expect(
      purge.match(/limit greatest\(1, least\(coalesce\(p_limit, 500\), 5000\)\)/gi),
    ).toHaveLength(2);
    expect(purge).toMatch(/order by d\.scheduled_for asc/i);
    expect(purge).toMatch(/order by ue\.matched_at asc/i);
  });
});

describe("one reader's expiry never touches shared knowledge", () => {
  it("deletes only user-specific rows in the per-user purge", () => {
    const purge = body("purge_expired_digests");
    const deletes = purge.match(/delete from public\.\w+/gi) ?? [];
    // digest_items follows its parent by cascade; events and articles are
    // shared with every other reader who matched them.
    expect(deletes.map((d) => d.toLowerCase())).toEqual([
      "delete from public.digests",
      "delete from public.user_events",
    ]);
  });

  it("leaves the shared corpus to its own age-based job", () => {
    const corpus = body("purge_expired_corpus");
    expect(corpus).not.toMatch(/subscriptions|plan_history_days|history_grace/i);
  });
});

describe("the shared corpus outlives the longest entitlement plus grace", () => {
  it("keeps events and orphan articles for 420 days", () => {
    // 365 (Omni) + 30 (grace) = 395, and `digest_items` cascades from `events`.
    // At 400 the corpus job was five days from hollowing out digests a reader
    // was still entitled to open.
    const corpus = body("purge_expired_corpus");
    expect(corpus.match(/interval '420 days'/g)).toHaveLength(2);
    expect(corpus).not.toMatch(/interval '400 days'/);
  });

  it("still refuses to delete an event somebody saved", () => {
    expect(body("purge_expired_corpus")).toMatch(/not exists[\s\S]*?public\.saved_stories/i);
  });
});

describe("grants", () => {
  it("lets authenticated readers execute the boundary their own policy calls", () => {
    // Without this the digests policy raises a permission error on every
    // browser read instead of returning a filtered result.
    expect(SQL).toMatch(
      /grant execute on function public\.history_window_start\(uuid\)[^;]*to authenticated/i,
    );
  });

  it("keeps the month metadata to the server", () => {
    expect(SQL).toMatch(/revoke all on function public\.history_months\(uuid\)[^;]*from public\b/i);
    expect(SQL).toMatch(
      /grant execute on function public\.history_months\(uuid\) to service_role/i,
    );
  });
});
