import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { LAUNCH_PLANS } from "./launch-plans";

// Execute the actual launch migrations against PostgreSQL, with the existing
// tables they touch. No mocks for constraints, triggers, RLS or atomic claims.
const db = new PGlite();
const migration = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");
const id = () => crypto.randomUUID();
async function account(plan: string) {
  const user = id();
  await db.query("insert into profiles values($1)", [user]);
  await db.query("insert into subscriptions values($1,$2)", [user, plan]);
  return user;
}
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create type plan_tier as enum ('uno','plura','omni');
    create table profiles(id uuid primary key);
    create table subscriptions(user_id uuid primary key,plan plan_tier);
    create table notification_preferences(user_id uuid primary key,send_at time default '07:30',timezone text default 'UTC',channels text[] default '{email}',breaking text default 'important',frequency text default 'daily');
    create table user_topics(user_id uuid,topic_id uuid,muted boolean default false,importance text default 'notable',keywords text[] default '{}',exclude_keywords text[] default '{}',primary key(user_id,topic_id));
    create table user_source_prefs(user_id uuid,source_id uuid,pref text,created_at timestamptz default now(),primary key(user_id,source_id));
    create table user_custom_sources(user_id uuid,source_id uuid,active boolean default true,created_at timestamptz default now(),updated_at timestamptz default now(),primary key(user_id,source_id));
    create table alert_claims(user_id uuid,event_id uuid,created_at timestamptz default now(),primary key(user_id,event_id));
    create table digests(digest_id uuid primary key default gen_random_uuid(),user_id uuid,kind text default 'briefing',scheduled_for timestamptz,status text default 'scheduled',generation_started_at timestamptz,generation_failure_reason text);
    create table push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid,endpoint text unique,created_at timestamptz default now());
  `);
  const old = migration("0066_rename_plan_tiers.sql");
  for (const name of ["enforce_topic_cap", "enforce_priority_source_cap"]) {
    const start = old.indexOf(`create or replace function public.${name}()`);
    await db.exec(old.slice(start, old.indexOf("$fn$;", old.indexOf("as $fn$", start)) + 5));
  }
  await db.exec(`create trigger topic_cap before insert or update on user_topics for each row execute function enforce_topic_cap();
    create trigger priority_cap before insert or update on user_source_prefs for each row execute function enforce_priority_source_cap();`);
  await db.exec(migration("0081_launch_plan_values.sql"));
  await db.exec(`insert into profiles values('00000000-0000-4000-8000-000000000099');
    insert into subscriptions values('00000000-0000-4000-8000-000000000099','uno');
    insert into push_subscriptions(user_id,endpoint) values
    ('00000000-0000-4000-8000-000000000099','https://push.example/old-1'),
    ('00000000-0000-4000-8000-000000000099','https://push.example/old-2');`);
  await db.exec(migration("0082_launch_plan_enforcement.sql"));
  // 0111 supersedes the 0082 keyword rule, which reserved keywords for Omni.
  await db.exec(migration("0111_keyword_ladder.sql"));
  const demand = migration("0083_launch_source_demand.sql");
  await db.exec(demand.slice(0, demand.indexOf("create or replace function")) + "commit;");
}, 60_000);
afterAll(async () => {
  await db.close();
});

it("preserves legacy push installations and reuses their registration", async () => {
  const user = "00000000-0000-4000-8000-000000000099";
  const legacy = await db.query<{ install_id: string }>(
    "select install_id from push_subscriptions where endpoint='https://push.example/old-1'",
  );
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::integer n from registered_devices where user_id=$1",
        [user],
      )
    ).rows[0]?.n,
  ).toBe(2);
  expect(
    (
      await db.query<{ result: string }>(
        "select register_device($1,$2,'Browser','https://push.example/old-1') result",
        [user, id()],
      )
    ).rows[0]?.result,
  ).toBe(legacy.rows[0]?.install_id);
  await expect(db.query("select register_device($1,$2)", [user, id()])).rejects.toThrow();
});

it("does not expose service-only claims to direct authenticated RPC calls", async () => {
  for (const fn of [
    "claim_alert(uuid,uuid,real)",
    "claim_custom_source(uuid,uuid)",
    "register_device(uuid,uuid,text,text)",
  ]) {
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('authenticated',$1,'EXECUTE') allowed",
          [fn],
        )
      ).rows[0]?.allowed,
    ).toBe(false);
  }
  const user = await account("omni");
  await expect(
    db.query(
      "insert into push_subscriptions(user_id,endpoint,install_id) values($1,'https://push.example/unregistered',$2)",
      [user, id()],
    ),
  ).rejects.toThrow("push_registered_device");
});

describe.each(Object.entries(LAUNCH_PLANS))("%s database entitlements", (plan, cap) => {
  it("rejects direct topic and priority-source additions above the cap", async () => {
    const user = await account(plan);
    for (let i = 0; i < cap.topics; i++)
      await db.query("insert into user_topics(user_id,topic_id) values($1,$2)", [user, id()]);
    await expect(
      db.query("insert into user_topics(user_id,topic_id) values($1,$2)", [user, id()]),
    ).rejects.toThrow("topic cap exceeded");
    for (let i = 0; i < cap.prioritySources; i++)
      await db.query(
        "insert into user_source_prefs(user_id,source_id,pref) values($1,$2,'priority')",
        [user, id()],
      );
    await expect(
      db.query("insert into user_source_prefs(user_id,source_id,pref) values($1,$2,'priority')", [
        user,
        id(),
      ]),
    ).rejects.toThrow("priority source cap exceeded");
  });
  it("enforces the shared keyword pool at the plan's cap", async () => {
    // Prioritize and exclude share one allowance (prioritize draws first);
    // the trigger is the last guard behind the server function's gate.
    const user = await account(plan);
    const row = id();
    await db.query("insert into user_topics(user_id,topic_id) values($1,$2)", [user, row]);
    const pool = cap.topicKeywords;
    const half = Math.floor(pool / 2);
    const terms = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    await db.query(
      "update user_topics set keywords=$3, exclude_keywords=$4 where user_id=$1 and topic_id=$2",
      [user, row, terms("k", half), terms("x", pool - half)],
    );
    await expect(
      db.query(
        "update user_topics set keywords=array_append(keywords,'overflow') where user_id=$1 and topic_id=$2",
        [user, row],
      ),
    ).rejects.toThrow("keywords per topic");

    // The dial keeps its Plura+ floor even though the words opened up.
    const dial = db.query(
      "update user_topics set importance='only_major' where user_id=$1 and topic_id=$2",
      [user, row],
    );
    if (cap.notificationControl === "basic")
      await expect(dial).rejects.toThrow("Per-topic controls");
    else await dial;
  });

  it("enforces custom sources and rolling alert claims", async () => {
    const user = await account(plan);
    const claim = async (fn: string) =>
      (
        await db.query<{ result: string }>(
          `select ${fn}($1,$2${fn === "claim_alert" ? ",6" : ""}) as result`,
          [user, id()],
        )
      ).rows[0]?.result;
    for (let i = 0; i < cap.customSources; i++)
      expect(await claim("claim_custom_source")).toBe("ok");
    expect(await claim("claim_custom_source")).toBe("limit");
    expect(
      (await db.query<{ result: string }>("select claim_alert($1,$2,5) as result", [user, id()]))
        .rows[0]?.result,
    ).toBe("importance");
    for (let i = 0; i < cap.alertDailyCap; i++) expect(await claim("claim_alert")).toBe("ok");
    expect(await claim("claim_alert")).toBe("quota");
    await db.query(
      "update alert_claims set created_at=now()-interval '25 hours' where user_id=$1",
      [user],
    );
    expect(await claim("claim_alert")).toBe("ok");
  });
  it("registers stable installations, blocks excess devices, and frees a removed slot", async () => {
    const user = await account(plan);
    const installs = Array.from({ length: cap.devices }, id);
    for (const install of installs)
      await db.query("select register_device($1,$2)", [user, install]);
    await db.query("select register_device($1,$2)", [user, installs[0]]);
    await expect(db.query("select register_device($1,$2)", [user, id()])).rejects.toThrow(
      "registered device",
    );
    await db.query("delete from registered_devices where user_id=$1 and install_id=$2", [
      user,
      installs[0],
    ]);
    await db.query("select register_device($1,$2)", [user, id()]);
  });
  it("enforces schedule, channels and notification controls on direct writes", async () => {
    const user = await account(plan);
    await db.query("insert into notification_preferences(user_id) values($1)", [user]);
    const time = db.query("update notification_preferences set send_at='09:00' where user_id=$1", [
      user,
    ]);
    if (cap.customDeliveryTime) await time;
    else await expect(time).rejects.toThrow("Custom delivery time");
    const telegram = db.query(
      "update notification_preferences set channels='{email,telegram}' where user_id=$1",
      [user],
    );
    if (cap.telegram) await telegram;
    else await expect(telegram).rejects.toThrow("Telegram delivery");
    const advanced = db.query(
      "update notification_preferences set breaking='everything' where user_id=$1",
      [user],
    );
    if (cap.notificationControl === "advanced") await advanced;
    else await expect(advanced).rejects.toThrow("Advanced notification");
    expect(
      (await db.query<{ days: number }>("select plan_history_days($1::plan_tier) as days", [plan]))
        .rows[0]?.days,
    ).toBe(cap.retentionDays);
    expect(
      (await db.query<{ days: number }>("select plan_alert_days($1::plan_tier) as days", [plan]))
        .rows[0]?.days,
    ).toBe(cap.retentionDays);
  });
});

it("preserves over-limit configuration on downgrade and activates it again on upgrade", async () => {
  const user = await account("omni");
  for (let i = 0; i < 7; i++) {
    await db.query("select register_device($1,$2)", [user, id()]);
    await db.query("select claim_custom_source($1,$2)", [user, id()]);
    await db.query("insert into user_topics(user_id,topic_id) values($1,$2)", [user, id()]);
  }
  await db.query("update subscriptions set plan='uno' where user_id=$1", [user]);
  for (const table of ["registered_devices", "user_custom_sources", "user_topics"])
    expect(
      (
        await db.query<{ n: number }>(`select count(*)::integer n from ${table} where user_id=$1`, [
          user,
        ])
      ).rows[0]?.n,
    ).toBe(7);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::integer n from active_custom_sources where user_id=$1",
        [user],
      )
    ).rows[0]?.n,
  ).toBe(0);
  await expect(db.query("select register_device($1,$2)", [user, id()])).rejects.toThrow();
  await db.query("update subscriptions set plan='omni' where user_id=$1", [user]);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::integer n from active_custom_sources where user_id=$1",
        [user],
      )
    ).rows[0]?.n,
  ).toBe(7);
  await db.query("select register_device($1,$2)", [user, id()]);
});

it("cannot schedule another briefing by changing the time on the same day", async () => {
  const user = await account("plura");
  await db.query("insert into notification_preferences(user_id,timezone) values($1,'Asia/Tokyo')", [
    user,
  ]);
  await db.query(
    "insert into digests(user_id,scheduled_for) values($1,'2026-09-12T00:00:00Z'),($1,'2026-09-12T02:00:00Z')",
    [user],
  );
  expect(
    (
      await db.query<{ n: number }>("select count(*)::integer n from digests where user_id=$1", [
        user,
      ])
    ).rows[0]?.n,
  ).toBe(1);
});
