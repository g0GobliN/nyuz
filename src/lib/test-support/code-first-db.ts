import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const migration = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");

export async function codeFirstDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create type event_status as enum ('pending','analysing','complete','failed');
    create type plan_tier as enum ('free','plus','pro');
    create table subscriptions(user_id uuid,plan plan_tier);
    create table events(id uuid primary key default gen_random_uuid(),title text,status event_status default 'pending',first_seen_at timestamptz default now(),analysed_at timestamptz,what_happened text,importance real,novelty real,tags text[],analysis_deferred_until timestamptz);
    create table articles(id uuid primary key default gen_random_uuid(),event_id uuid references events(id),title text,excerpt text,published_at timestamptz);
    create table topics(id uuid primary key);
    create table event_topics(event_id uuid references events(id),topic_id uuid references topics(id),primary key(event_id,topic_id));
    create table ai_runtime_config(key text primary key,value jsonb);
    create table feature_flags(key text primary key,label text,description text,enabled boolean,rollout_percent integer);
    create table ai_credit_topups(amount_microusd bigint,provider text,occurred_at timestamptz default now());
    create table ai_usage_ledger(id uuid primary key default gen_random_uuid(),user_id uuid,plan plan_tier,capability text,model text,feature text default 'unknown',reserved_tokens integer default 0,prompt_tokens integer default 0,completion_tokens integer default 0,cached_prompt_tokens integer default 0,cost_microusd bigint,estimated_cost_microusd bigint,created_at timestamptz default now());
  `);
  const original = migration("0053_launch_cost_safety.sql");
  for (const name of ["reserve_ai_tokens", "settle_ai_tokens"]) {
    const start = original.search(
      new RegExp(`create (?:or replace )?function public\\.${name}\\(`),
    );
    await db.exec(original.slice(start, original.indexOf("$fn$;", start) + 5));
  }
  await db.exec(migration("0070_ai_attempt_accounting.sql"));
  await db.exec(migration("0078_understand_on_demand.sql"));
  await db.exec(migration("0080_provider_credit_gate.sql"));
  await db.exec(migration("0085_code_first_news.sql"));
  return db;
}
