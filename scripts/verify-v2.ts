/**
 * Confirms the V2 migrations (0018-0022, docs/track.md) actually landed and
 * checks their real output, rather than trusting that a paste into the SQL
 * editor succeeded.
 *
 *   npm run verify:v2
 *
 * Writes nothing. Safe to run against production, and meant to be — same
 * property as db-status.ts.
 */

import { db, fail, heading, main, row, say } from "./lib/db.ts";

main(async () => {
  heading("0018 — coverage_mode");
  const { data: modes, error: modeErr } = await db().from("sources").select("coverage_mode");
  if (modeErr) fail(`sources.coverage_mode: ${modeErr.message} — is 0018 applied?`);
  const byMode = new Map<string, number>();
  for (const r of modes ?? []) byMode.set(r.coverage_mode, (byMode.get(r.coverage_mode) ?? 0) + 1);
  for (const [mode, n] of byMode) say(row(mode, n));

  heading("0018/0019 — source_topics");
  const { count: topicRows, error: stErr } = await db()
    .from("source_topics")
    .select("*", { count: "exact", head: true });
  if (stErr) fail(`source_topics: ${stErr.message} — is 0018 applied?`);
  say(row("rows", topicRows ?? 0));

  // PostgREST's `in` filter takes a literal list, not a subquery, so the
  // mapped ids are fetched first and diffed here rather than in one query.
  const { data: allSources, error: allErr } = await db()
    .from("sources")
    .select("id, name, coverage_mode");
  if (allErr) throw new Error(allErr.message);
  const mappedIds = new Set(
    (await db().from("source_topics").select("source_id")).data?.map((r) => r.source_id),
  );
  const uncovered = (allSources ?? []).filter((s) => !mappedIds.has(s.id));
  say(row("sources with zero topics", uncovered.length));
  for (const s of uncovered.slice(0, 15)) say(`  - ${s.name} (${s.coverage_mode})`);

  heading("0020 — admin_source_demand()");
  const { data: demand, error: demandErr } = await db().rpc("admin_source_demand");
  if (demandErr) fail(`admin_source_demand(): ${demandErr.message} — is 0020 applied?`);
  say(row("rows returned", demand?.length ?? 0));
  const topDemand = [...(demand ?? [])].sort((a, b) => b.interested_users - a.interested_users);
  say("Top 10 by interested_users:");
  for (const d of topDemand.slice(0, 10)) {
    say(`  ${row(d.source_id, `${d.interested_users} (${d.paid_interested_users} paid)`, 40)}`);
  }
  const zero = (demand ?? []).filter((d) => d.interested_users === 0).length;
  say(row("sources with zero demand", zero));

  heading("0021 — pre_analysis_demand_gate + events_with_demand()");
  const { data: gateFlag, error: gateFlagErr } = await db()
    .from("feature_flags")
    .select("enabled")
    .eq("key", "pre_analysis_demand_gate")
    .maybeSingle();
  if (gateFlagErr) fail(`feature_flags: ${gateFlagErr.message}`);
  say(row("flag present", gateFlag ? "yes" : "NO — is 0021 applied?"));
  say(row("flag enabled", String(gateFlag?.enabled ?? "n/a")));

  const { data: pendingEvents } = await db()
    .from("events")
    .select("id")
    .is("analysed_at", null)
    .limit(5);
  const ids = (pendingEvents ?? []).map((e) => e.id);
  if (ids.length > 0) {
    const { data: withDemand, error: rpcErr } = await db().rpc("events_with_demand", {
      p_event_ids: ids,
    });
    if (rpcErr) fail(`events_with_demand(): ${rpcErr.message} — is 0021 applied?`);
    say(row("sample events checked", withDemand?.length ?? 0));
    for (const r of withDemand ?? [])
      say(`  ${r.event_id}: ${r.has_demand ? "has demand" : "no demand"}`);
  } else {
    say("no pending events to sample against right now");
  }

  heading("0022 — deterministic_cluster_v2");
  const { data: clusterFlag, error: clusterFlagErr } = await db()
    .from("feature_flags")
    .select("enabled")
    .eq("key", "deterministic_cluster_v2")
    .maybeSingle();
  if (clusterFlagErr) fail(`feature_flags: ${clusterFlagErr.message}`);
  say(row("flag present", clusterFlag ? "yes" : "NO — is 0022 applied?"));
  say(row("flag enabled", String(clusterFlag?.enabled ?? "n/a")));

  say();
});
