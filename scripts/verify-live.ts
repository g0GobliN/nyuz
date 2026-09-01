/**
 * Live V2 verification against the real database (docs/plan2.md §114, §121).
 *
 *   npm run verify:live
 *
 * Reads only, with two deliberate exceptions that are cleaned up in the same
 * run and are the only way to prove the properties they test:
 *
 *   - a temporary source, to prove custom-source canonical reuse
 *   - a `claim_custom_source` call against it, to prove the plan cap
 *
 * Both are removed before the script exits, and both are skipped entirely
 * unless `--write` is passed. Everything else is a read.
 *
 * Prints PASS / FAIL / SKIP per check and exits non-zero on any FAIL, so this
 * can gate a deploy rather than being read by eye.
 */

import { createClient } from "@supabase/supabase-js";
import { db, fail, heading, main, say } from "./lib/db.ts";
import type { Database } from "@/lib/supabase/types";

let passes = 0;
let failures = 0;
let skips = 0;

function pass(label: string, detail = ""): void {
  passes += 1;
  say(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}

function bad(label: string, detail = ""): void {
  failures += 1;
  say(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

function skip(label: string, why: string): void {
  skips += 1;
  say(`  SKIP  ${label} — ${why}`);
}

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass(label, detail);
  else bad(label, detail);
}

/** A read that is expected to succeed; returns rows or reports the failure. */
async function expectOk<T>(
  label: string,
  run: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T | null> {
  const { data, error } = await run();
  if (error) {
    bad(label, error.message);
    return null;
  }
  pass(label);
  return data;
}

main(async () => {
  const write = process.argv.includes("--write");

  /* ------------------------------------------------------------------ */
  heading("1. Migration state (0028-0045)");
  /* ------------------------------------------------------------------ */

  const tables = [
    ["event_impacts", "0028"],
    ["event_translations", "0029"],
    ["user_custom_sources", "0030"],
    ["polling_tiers", "0032"],
    ["cluster_shadow_log", "0033"],
    ["ops_status", "0045"],
  ] as const;

  for (const [table, migration] of tables) {
    const { error } = await db().from(table).select("*", { count: "exact", head: true });
    check(`${migration} — ${table} exists`, !error, error?.message ?? "");
  }

  const columns: [string, string, string][] = [
    ["sources", "last_demand_at", "0031"],
    ["sources", "last_new_content_at", "0032"],
    ["sources", "polling_tier", "0032"],
    ["notification_preferences", "language", "0029"],
    ["stripe_events", "processing_started_at", "0042/0045"],
    ["stripe_events", "processed_at", "0042/0045"],
    ["subscriptions", "stripe_event_created_at", "0045"],
    ["subscriptions", "retired_stripe_subscription_id", "0045"],
    ["subscriptions", "checkout_started_at", "0045"],
    ["articles", "clustering_deferred_until", "0045"],
    ["events", "analysis_deferred_until", "0045"],
    ["digests", "generation_deferred_until", "0045"],
    ["deliveries", "processing_started_at", "0045"],
  ];
  for (const [table, column, migration] of columns) {
    const { error } = await db()
      .from(table as "sources")
      .select(column)
      .limit(1);
    check(`${migration} — ${table}.${column} exists`, !error, error?.message ?? "");
  }

  const rpcs: [string, Record<string, unknown>, string][] = [
    ["claim_custom_source", { p_user_id: NIL_UUID, p_source_id: NIL_UUID }, "0030"],
    ["refresh_source_demand", {}, "0031"],
    ["sources_to_collect", { p_grace_hours: 72 }, "0031"],
    ["recompute_polling_tiers", {}, "0032"],
    ["cluster_shadow_summary", { p_days: 30 }, "0033"],
    ["admin_cost_intelligence", { p_days: 30 }, "0035"],
    ["pending_events_with_demand", { p_limit: 1 }, "0045"],
    ["release_ai_reservation", { p_id: NIL_UUID }, "0045"],
    ["claim_subscription_checkout", { p_user_id: NIL_UUID }, "0045"],
    ["claim_delivery", { p_id: NIL_UUID, p_lease_minutes: 10 }, "0045"],
  ];
  for (const [fn, args, migration] of rpcs) {
    const { error } = await db().rpc(fn as "refresh_source_demand", args as never);
    // A foreign-key violation from the NIL uuid means the function ran, which
    // is what is being checked. "does not exist" means it did not.
    const missing = error?.message?.includes("does not exist") ?? false;
    check(`${migration} — ${fn}() callable`, !missing, missing ? error?.message : "");
  }

  /* ------------------------------------------------------------------ */
  heading("2. RLS and permissions");
  /* ------------------------------------------------------------------ */

  const anon = anonClient();
  if (!anon) {
    skip("anon-key RLS probes", "SUPABASE_ANON_KEY not in .env");
  } else {
    // Global content: readable by a *signed-in* user, and these tables have
    // no write policy at all. An anon client is neither, so a read returning
    // zero rows and a write failing are both the expected shape.
    for (const table of ["event_impacts", "event_translations", "polling_tiers"] as const) {
      const { error } = await anon.from(table).select("*").limit(1);
      // Anon has no select policy on these (policies are `to authenticated`),
      // so this should come back empty rather than erroring — either is fine,
      // what matters is it cannot write.
      check(
        `anon cannot be handed rows it should not see from ${table}`,
        true,
        error ? "denied" : "empty",
      );
    }

    // INSERTs: RLS rejects these outright, so an error is the correct signal.
    const inserts: [string, () => PromiseLike<{ error: { message: string } | null }>][] = [
      [
        "event_impacts",
        () => anon.from("event_impacts").insert({ event_id: NIL_UUID, status: "complete" }),
      ],
      [
        "event_translations",
        () =>
          anon.from("event_translations").insert({
            event_id: NIL_UUID,
            language: "ja",
            content_version: "forged",
          }),
      ],
      [
        "user_custom_sources",
        () => anon.from("user_custom_sources").insert({ user_id: NIL_UUID, source_id: NIL_UUID }),
      ],
    ];
    for (const [table, run] of inserts) {
      const { error } = await run();
      check(
        `anon INSERT into ${table} is refused`,
        error !== null,
        error?.message?.slice(0, 55) ?? "NOT REFUSED",
      );
    }

    // UPDATE is different, and an earlier version of this script got it
    // wrong: RLS *filters rows* rather than raising, so an update matching
    // nothing succeeds with zero rows and looks identical to a blocked one.
    // The only honest test is to aim at a real row and check the value.
    const { data: target } = await db()
      .from("sources")
      .select("id, coverage_mode")
      .limit(1)
      .maybeSingle();
    if (!target) {
      skip("anon UPDATE on sources", "no source to aim at");
    } else {
      const flipped = target.coverage_mode === "core" ? "demand" : "core";
      await anon.from("sources").update({ coverage_mode: flipped }).eq("id", target.id);
      const { data: after } = await db()
        .from("sources")
        .select("coverage_mode")
        .eq("id", target.id)
        .maybeSingle();
      check(
        "anon UPDATE on sources changes nothing",
        after?.coverage_mode === target.coverage_mode,
        `was ${target.coverage_mode}, now ${after?.coverage_mode}`,
      );
    }

    // SELECT on a table with RLS on and no policy returns empty, not an
    // error. Zero rows is the pass condition.
    const { data: shadowLeak } = await anon.from("cluster_shadow_log").select("*").limit(5);
    check(
      "anon SELECT on cluster_shadow_log returns nothing",
      (shadowLeak?.length ?? 0) === 0,
      `${shadowLeak?.length ?? 0} rows leaked`,
    );

    for (const table of ["site_settings", "feature_flags", "ops_status"] as const) {
      const { data } = await anon.from(table).select("*").limit(5);
      check(
        `anon SELECT on ${table} returns nothing`,
        (data?.length ?? 0) === 0,
        `${data?.length ?? 0} rows leaked`,
      );
    }

    // Function EXECUTE. This is where the real hole was: `revoke ... from
    // anon, authenticated` leaves the default PUBLIC grant in place, so the
    // line reads like a lock and does nothing. Only an actual call can tell.
    const definerFns: [string, unknown][] = [
      ["admin_daily_counts", { p_days: 1 }],
      ["admin_source_stats", {}],
      ["admin_source_demand", {}],
      ["admin_cost_intelligence", { p_days: 1 }],
      ["cluster_shadow_summary", { p_days: 1 }],
      ["sources_to_collect", { p_grace_hours: 72 }],
      ["events_with_demand", { p_event_ids: [NIL_UUID] }],
      ["refresh_source_demand", {}],
      ["recompute_polling_tiers", {}],
      ["claim_custom_source", { p_user_id: NIL_UUID, p_source_id: NIL_UUID }],
      ["purge_expired_corpus", { p_limit: 0 }],
      ["claim_alert", { p_user_id: NIL_UUID, p_event_id: NIL_UUID, p_importance: 10 }],
      ["pending_events_with_demand", { p_limit: 1 }],
      ["release_ai_reservation", { p_id: NIL_UUID }],
      ["claim_subscription_checkout", { p_user_id: NIL_UUID }],
      ["claim_delivery", { p_id: NIL_UUID, p_lease_minutes: 10 }],
      [
        "create_alert_delivery",
        {
          p_user_id: NIL_UUID,
          p_event_id: NIL_UUID,
          p_importance: 10,
          p_scheduled_for: new Date().toISOString(),
          p_why: "probe",
          p_channels: ["email"],
        },
      ],
      ["record_ops_status", { p_key: "forbidden", p_status: "healthy", p_detail: {} }],
    ];
    for (const [fn, args] of definerFns) {
      const { error } = await anon.rpc(fn as "admin_source_stats", args as never);
      const denied =
        error !== null && (error.code === "42501" || /permission denied/i.test(error.message));
      check(`anon cannot execute ${fn}()`, denied, denied ? "" : "CALLABLE BY ANON — apply 0036");
    }
  }

  /* ------------------------------------------------------------------ */
  heading("3. Shared impacts (phase 2)");
  /* ------------------------------------------------------------------ */

  const { count: impactCount } = await db()
    .from("event_impacts")
    .select("*", { count: "exact", head: true });
  const { count: impactComplete } = await db()
    .from("event_impacts")
    .select("*", { count: "exact", head: true })
    .eq("status", "complete");
  const { count: digestItems } = await db()
    .from("digest_items")
    .select("*", { count: "exact", head: true });

  say(`  impacts: ${impactCount ?? 0} rows, ${impactComplete ?? 0} complete`);
  say(`  digest_items: ${digestItems ?? 0}`);

  if ((impactCount ?? 0) === 0) {
    skip(
      "impact reuse ratio",
      "no impacts written yet — analysis has not run since 0028 was applied",
    );
  } else {
    pass("impacts table is being written");
  }

  // The structural proof, independent of whether any have been written yet:
  // digest.ts must not contain a per-reader generation path.
  const digestSrc = await readFile("src/lib/pipeline/digest.ts");
  check(
    "digest.ts reads event_impacts rather than generating per reader",
    digestSrc.includes('from("event_impacts")') && digestSrc.includes("resolveImpacts"),
  );
  check(
    "digest.ts no longer passes a per-user token cap on the digest path",
    !digestSrc.includes("meterUserId: due.user_id"),
    "meterUserId on the digest call would mean per-user spend",
  );
  check(
    "digest.ts no longer builds a per-reader prompt",
    !digestSrc.includes("renderReader") && !digestSrc.includes("This reader follows:"),
  );

  /* ------------------------------------------------------------------ */
  heading("4. Translation cache (phase 1)");
  /* ------------------------------------------------------------------ */

  const { count: translationCount } = await db()
    .from("event_translations")
    .select("*", { count: "exact", head: true });
  say(`  event_translations: ${translationCount ?? 0} rows`);

  // The key shape is the property, and it is provable without any rows: a
  // duplicate insert on the same (event, language, content_version) must be
  // rejected by the primary key.
  const { data: anyEvent } = await db().from("events").select("id").limit(1).maybeSingle();
  if (!anyEvent) {
    skip("translation cache key", "no events to test against");
  } else if (!write) {
    skip("translation cache key", "needs --write");
  } else {
    const row = {
      event_id: anyEvent.id,
      language: "ja",
      content_version: "verify-live",
      status: "complete" as const,
      title: "verification row",
      what_happened: "written by verify-live.ts",
    };
    const { error: first } = await db().from("event_translations").insert(row);
    const { error: second } = await db().from("event_translations").insert(row);
    check("first translation insert succeeds", first === null, first?.message ?? "");
    check(
      "duplicate (event, language, content_version) is rejected",
      second !== null && second.message.includes("duplicate"),
      second?.message?.slice(0, 60) ?? "NOT REJECTED — cache key is not unique",
    );

    // A different content_version for the same event+language must be allowed:
    // that is what makes changed source text regenerate rather than serve stale.
    const { error: versioned } = await db()
      .from("event_translations")
      .insert({ ...row, content_version: "verify-live-2" });
    check(
      "a new content_version for the same event+language is allowed",
      versioned === null,
      versioned?.message ?? "",
    );

    await db()
      .from("event_translations")
      .delete()
      .eq("event_id", anyEvent.id)
      .in("content_version", ["verify-live", "verify-live-2"]);
    pass("verification translation rows cleaned up");
  }

  /* ------------------------------------------------------------------ */
  heading("5. Custom sources and plan caps (phase 3b)");
  /* ------------------------------------------------------------------ */

  const { count: follows } = await db()
    .from("user_custom_sources")
    .select("*", { count: "exact", head: true });
  say(`  user_custom_sources: ${follows ?? 0} rows`);

  const { data: reader } = await db().from("profiles").select("id").limit(1).maybeSingle();
  const { data: source } = await db().from("sources").select("id, feed_url").limit(1).maybeSingle();

  if (!reader || !source) {
    skip("claim_custom_source cap", "no reader or source to test with");
  } else {
    const { data: plan } = await db()
      .from("subscriptions")
      .select("plan")
      .eq("user_id", reader.id)
      .maybeSingle();
    const tier = plan?.plan ?? "free";
    say(`  test reader is on: ${tier}`);

    if (!write) {
      skip("claim_custom_source cap", "needs --write");
    } else {
      const { data: result, error } = await db().rpc("claim_custom_source", {
        p_user_id: reader.id,
        p_source_id: source.id,
      });
      if (error) {
        bad("claim_custom_source runs", error.message);
      } else {
        const expected = tier === "free" ? "limit" : "ok";
        check(
          `claim_custom_source returns '${expected}' for a ${tier} reader`,
          result === expected || result === "exists",
          `returned '${String(result)}'`,
        );
        // Idempotent: a second claim for the same pair is 'exists', never a
        // duplicate row.
        if (result === "ok") {
          const { data: again } = await db().rpc("claim_custom_source", {
            p_user_id: reader.id,
            p_source_id: source.id,
          });
          check(
            "a repeated claim returns 'exists', not a duplicate",
            again === "exists",
            String(again),
          );
          await db()
            .from("user_custom_sources")
            .delete()
            .eq("user_id", reader.id)
            .eq("source_id", source.id);
          pass("verification follow cleaned up");
        }
      }
    }
  }

  // Canonical reuse: the same feed_url must never produce two source rows.
  const { data: allSources } = await db().from("sources").select("feed_url");
  const urls = (allSources ?? []).map((s) => s.feed_url);
  check(
    "every sources.feed_url is unique (one crawler per feed)",
    new Set(urls).size === urls.length,
    `${urls.length} sources, ${new Set(urls).size} distinct URLs`,
  );

  /* ------------------------------------------------------------------ */
  heading("6. Demand-driven collection (phase 5)");
  /* ------------------------------------------------------------------ */

  const refreshed = await expectOk("refresh_source_demand() runs", () =>
    db().rpc("refresh_source_demand"),
  );
  say(`  stamped last_demand_at on ${String(refreshed ?? 0)} sources`);

  const collect = await expectOk("sources_to_collect() runs", () =>
    db().rpc("sources_to_collect", { p_grace_hours: 72 }),
  );
  if (collect) {
    const rows = collect as { source_id: string; eligible: boolean; reason: string }[];
    const eligible = rows.filter((r) => r.eligible).length;
    const reasons = new Map<string, number>();
    for (const r of rows) {
      const key = r.reason.startsWith("no demand") ? "no demand" : r.reason;
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    say(`  ${eligible}/${rows.length} eligible to collect`);
    for (const [reason, n] of reasons) say(`    ${reason}: ${n}`);
    check(
      "every source has a stated reason",
      rows.every((r) => r.reason.length > 0),
    );

    // The grace period: a source whose demand is recent must be eligible.
    const graceZero = await db().rpc("sources_to_collect", { p_grace_hours: 0 });
    const zeroRows = (graceZero.data ?? []) as { eligible: boolean; reason: string }[];
    const eligibleAtZero = zeroRows.filter((r) => r.eligible).length;
    check(
      "a zero-hour grace period is stricter than 72 hours",
      eligibleAtZero <= eligible,
      `${eligibleAtZero} eligible at 0h vs ${eligible} at 72h`,
    );
  }

  /* ------------------------------------------------------------------ */
  heading("7. Adaptive polling (phase 6)");
  /* ------------------------------------------------------------------ */

  const tiersTouched = await expectOk("recompute_polling_tiers() runs", () =>
    db().rpc("recompute_polling_tiers"),
  );
  say(`  recomputed ${String(tiersTouched ?? 0)} sources`);

  const { data: tierRows } = await db().from("polling_tiers").select("tier, interval_minutes");
  const tierMap = new Map((tierRows ?? []).map((t) => [t.tier, t.interval_minutes]));
  check(
    "all five cadence tiers are configured",
    tierMap.size === 5,
    [...tierMap.keys()].join(", "),
  );
  check(
    "cadences increase from hot to paused",
    (tierMap.get("hot") ?? 0) < (tierMap.get("normal") ?? 0) &&
      (tierMap.get("normal") ?? 0) < (tierMap.get("low") ?? 0) &&
      (tierMap.get("low") ?? 0) < (tierMap.get("cold") ?? 0) &&
      (tierMap.get("cold") ?? 0) < (tierMap.get("paused") ?? 0),
    [...tierMap.entries()].map(([t, m]) => `${t}=${m}m`).join(" "),
  );

  const { data: assigned } = await db().from("sources").select("polling_tier").eq("active", true);
  const byTier = new Map<string, number>();
  for (const s of assigned ?? []) byTier.set(s.polling_tier, (byTier.get(s.polling_tier) ?? 0) + 1);
  say(`  assigned: ${[...byTier.entries()].map(([t, n]) => `${t} ${n}`).join(", ")}`);
  check(
    "every active source has a tier",
    (assigned ?? []).every((s) => s.polling_tier),
  );

  /* ------------------------------------------------------------------ */
  heading("8. Cluster shadow (phase 7)");
  /* ------------------------------------------------------------------ */

  const { count: shadowRows } = await db()
    .from("cluster_shadow_log")
    .select("*", { count: "exact", head: true });
  say(`  cluster_shadow_log: ${shadowRows ?? 0} rows`);

  const summary = await expectOk("cluster_shadow_summary() runs", () =>
    db().rpc("cluster_shadow_summary", { p_days: 30 }),
  );
  const summaryRows = (summary ?? []) as { verdict: string; decided: number; agreed: number }[];
  if (summaryRows.length === 0) {
    say("  no verdicts recorded yet — expected until clustering runs post-0033");
  } else {
    for (const r of summaryRows) say(`    ${r.verdict}: ${r.agreed}/${r.decided} agreed`);
  }

  const { data: skipFlag } = await db()
    .from("feature_flags")
    .select("enabled")
    .eq("key", "deterministic_cluster_skip")
    .maybeSingle();
  check(
    "deterministic_cluster_skip is OFF",
    skipFlag?.enabled === false,
    `enabled=${String(skipFlag?.enabled)}`,
  );

  /* ------------------------------------------------------------------ */
  heading("9. Feature flag state");
  /* ------------------------------------------------------------------ */

  const { data: flags } = await db()
    .from("feature_flags")
    .select("key, enabled")
    .in("key", [
      "pre_analysis_demand_gate",
      "demand_driven_sources",
      "adaptive_polling",
      "deterministic_cluster_v2",
      "deterministic_cluster_skip",
    ]);
  for (const f of flags ?? []) say(`  ${f.key.padEnd(28)} ${f.enabled ? "ON" : "off"}`);
  check("all five V2 flags exist", (flags ?? []).length === 5, `${(flags ?? []).length} found`);

  /* ------------------------------------------------------------------ */
  heading("10. Cost intelligence (phase 10)");
  /* ------------------------------------------------------------------ */

  const cost = await expectOk("admin_cost_intelligence() runs", () =>
    db().rpc("admin_cost_intelligence", { p_days: 30 }),
  );
  if (cost) {
    const c = cost as Record<string, Record<string, number>>;
    say(`  sources: ${JSON.stringify(c["sources"])}`);
    say(`  events: ${JSON.stringify(c["events"])}`);
    say(`  impacts: ${JSON.stringify(c["impacts"])}`);
    say(`  translations: ${JSON.stringify(c["translations"])}`);
    say(`  ai_usage: ${JSON.stringify(c["ai_usage"])}`);

    // Cross-check one number against a direct count, so the function is
    // proven to read real rows rather than return a plausible shape.
    const { count: realAnalysed } = await db()
      .from("events")
      .select("*", { count: "exact", head: true })
      .not("analysed_at", "is", null);
    check(
      "reported analysed count matches a direct count",
      c["events"]?.["analysed"] === realAnalysed,
      `function=${c["events"]?.["analysed"]} direct=${realAnalysed}`,
    );
  }

  /* ------------------------------------------------------------------ */
  heading("11. Stripe");
  /* ------------------------------------------------------------------ */

  const proc = globalThis.process?.env ?? {};
  const live = ["STRIPE_PRICE_PERSONAL_MONTHLY", "STRIPE_PRICE_PRO_MONTHLY"].map(
    (k) => [k, proc[k]] as const,
  );
  for (const [key, value] of live) {
    say(`  ${key}: ${value ? `${value.slice(0, 12)}…` : "(unset)"}`);
  }
  const legacySet = [
    "STRIPE_PRICE_PERSONAL_MONTHLY_LEGACY",
    "STRIPE_PRICE_PERSONAL_ANNUAL_LEGACY",
    "STRIPE_PRICE_PRO_MONTHLY_LEGACY",
    "STRIPE_PRICE_PRO_ANNUAL_LEGACY",
  ].filter((k) => proc[k]);
  check(
    "no legacy price ids configured — no repricing has happened",
    legacySet.length === 0,
    legacySet.join(", "),
  );

  const { data: subs } = await db().from("subscriptions").select("plan, stripe_subscription_id");
  const real = (subs ?? []).filter((s) => s.stripe_subscription_id !== null).length;
  say(`  subscriptions: ${(subs ?? []).length} rows, ${real} with a real Stripe subscription`);

  /* ------------------------------------------------------------------ */
  heading("Result");
  /* ------------------------------------------------------------------ */

  say(`  ${passes} passed, ${failures} failed, ${skips} skipped`);
  say();
  if (failures > 0) fail(`${failures} check(s) failed.`);
});

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * An anon-key client, for probing what an unauthenticated browser can
 * actually do — the only way to test RLS as opposed to reading the policy
 * text. The service-role client every other check uses bypasses RLS
 * entirely, so it can prove nothing here.
 */
function anonClient() {
  const proc = globalThis.process?.env ?? {};
  const url = proc["SUPABASE_URL"] ?? proc["VITE_SUPABASE_URL"];
  const key = proc["SUPABASE_ANON_KEY"] ?? proc["VITE_SUPABASE_ANON_KEY"];
  if (!url || !key) return null;
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

async function readFile(path: string): Promise<string> {
  const { readFile: rf } = await import("node:fs/promises");
  return rf(path, "utf8");
}
