import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { codeFirstDb } from "@/lib/test-support/code-first-db";
let db: Awaited<ReturnType<typeof codeFirstDb>>;
const user = "00000000-0000-4000-8000-000000000001";
const event = "00000000-0000-4000-8000-000000000002";
const owner = "00000000-0000-4000-8000-000000000003";
const other = "00000000-0000-4000-8000-000000000004";
async function scalar(sql: string, values: unknown[] = []) {
  return (await db.query<{ v: unknown }>(sql, values)).rows[0]?.v;
}
const reserve = (cost = 10000, feature = "understand_generation") =>
  scalar(
    "select reserve_ai_tokens(null,'reason','deepseek-v4-pro',1000,null,10000000,$1,10000000,1000000,5000000,$2) as v",
    [cost, feature],
  );
const claim = (version = "v1", who = owner) =>
  scalar("select claim_shared_story($1,$2,$3,$4) as v", [event, version, who, user]);
const begin = (usage: unknown, version = "v1") =>
  scalar("select begin_shared_story_attempt($1,$2,$3,$4,$5) as v", [
    event,
    version,
    owner,
    user,
    usage,
  ]);
beforeAll(async () => {
  db = await codeFirstDb();
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    "truncate story_generation_starts,event_understanding,ai_usage_ledger,articles,event_topics,events,auth.users cascade; update ai_runtime_config set value='{\"value\":2}' where key='ai.story_concurrency';",
  );
  await db.query("insert into auth.users values($1)", [user]);
  await db.query("insert into events(id,title) values($1,'A useful event')", [event]);
});
describe("actual PostgreSQL financial and owner invariants", () => {
  it("rejects background features even with otherwise valid budget", async () => {
    for (const feature of ["cluster", "analyse", "enrich", "ask", "translate", "unknown"])
      expect(await reserve(1, feature)).toBeNull();
  });
  it("admits only the shared impact writer since 0105, under the same ceilings", async () => {
    expect(await reserve(300000, "impact")).toBeTruthy();
    // The 0085 daily ceiling still applies to it: $0.50 total, $0.30 used here.
    expect(await reserve(200001, "impact")).toBeNull();
  });
  it("holds a hard daily ceiling including concurrent reservations", async () => {
    const results = await Promise.all([reserve(300000), reserve(300000)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await reserve(200000)).toBeTruthy();
    expect(await reserve(1)).toBeNull();
  });
  it("holds the monthly ceiling across UTC days", async () => {
    await db.exec(
      "insert into ai_usage_ledger(cost_microusd,created_at) values(9990000,(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')+interval '1 second')",
    );
    // Start-of-month dates are still in the same UTC month.
    expect(await reserve(10001)).toBeNull();
  });
  it("never releases uncertain charges at a day/month boundary", async () => {
    await db.exec(
      "insert into ai_usage_ledger(estimated_cost_microusd,reserved_tokens,created_at) values(500000,1000,now()-interval '40 days')",
    );
    expect(await reserve(1)).toBeNull();
    expect(await scalar("select void_stale_ai_reservations() as v")).toBe(0);
  });
  it("charges cross-boundary settlement to the current day before authorizing more", async () => {
    const id = await reserve(300000);
    await db.query("update ai_usage_ledger set created_at=now()-interval '40 days' where id=$1", [
      id,
    ]);
    await db.query(
      'select record_ai_attempt($1,\'{"state":"settled"}\',\'{"prompt_tokens":100,"completion_tokens":30,"cost_microusd":300000}\')',
      [id],
    );
    expect(await reserve(200001)).toBeNull();
    expect(Number(await scalar("select actual_today_usd as v from ai_budget_status"))).toBe(0.3);
  });
  it("gives one owner to 100 concurrent readers and two global slots", async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => claim("v1", i % 2 ? owner : other)),
    );
    expect(results.filter((x) => x === "won")).toHaveLength(1);
    expect(await claim("v2")).toBe("won");
    expect(await claim("v3")).toBe("capacity");
    expect(await scalar("select sum(attempts)::integer as v from event_understanding")).toBe(0);
  });
  it("counts only begun attempts, enforces cooldown and lifetime limit", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await claim()).toBe("won");
      expect(await begin(await reserve())).toBe(true);
      await db.query("select fail_shared_story($1,'v1',$2,'rejected',false)", [event, owner]);
      expect(await claim()).toBe(i === 2 ? "exhausted" : "cooldown");
      await db.exec("update event_understanding set next_retry_at=now()-interval '1 second'");
    }
    expect(
      await scalar("select attempts as v from event_understanding where content_version='v1'"),
    ).toBe(3);
  });
  it("recovers an unspent expired lease, fences the former owner", async () => {
    expect(await claim()).toBe("won");
    await db.exec("update event_understanding set lease_until=now()-interval '1 second'");
    expect(await claim("v1", other)).toBe("won");
    expect(await begin(await reserve())).toBe(false);
  });
  it("requires reconciliation for uncertain timeouts, not another purchase", async () => {
    await claim();
    await begin(await reserve());
    await db.exec("update event_understanding set lease_until=now()-interval '1 day'");
    expect(await claim()).toBe("reconciliation");
    await db.exec("update event_understanding set next_retry_at=now()-interval '1 day'");
    expect(await claim()).toBe("reconciliation");
  });
  it("recovers staged output without a new generation", async () => {
    await claim();
    await begin(await reserve());
    expect(
      await scalar(
        'select stage_shared_story($1,\'v1\',$2,\'{"article":{"deck":"saved"}}\') as v',
        [event, owner],
      ),
    ).toBe(true);
    await db.exec("update event_understanding set lease_until=now()-interval '1 day'");
    expect(await claim()).toBe("persisting");
    expect(await scalar("select finish_shared_story($1,'v1') as v", [event])).toBe(true);
    expect(await claim()).toBe("ready");
    expect(await scalar("select prompt_version as v from event_understanding")).toBe("story:3");
    expect(await scalar("select attempts as v from event_understanding")).toBe(1);
  });
  it("settles observed/cached usage idempotently into typed columns", async () => {
    const id = await reserve();
    for (let i = 0; i < 2; i++)
      await db.query("select record_ai_attempt($1,'{}',$2)", [
        id,
        JSON.stringify({
          prompt_tokens: 100,
          completion_tokens: 30,
          cached_tokens: 70,
          cost_microusd: 120,
        }),
      ]);
    await db.query("select settle_ai_tokens($1,100,70,30,120,'understand_generation')", [id]);
    const rows = await db.query(
      "select prompt_tokens,completion_tokens,cached_prompt_tokens,cost_microusd,reserved_tokens,feature from ai_usage_ledger",
    );
    expect(rows.rows[0]).toEqual({
      prompt_tokens: 100,
      completion_tokens: 30,
      cached_prompt_tokens: 70,
      cost_microusd: 120,
      reserved_tokens: 0,
      feature: "understand_generation",
    });
  });
  it("reaps only positively unstarted old reservations, idempotently", async () => {
    await reserve();
    await reserve();
    await db.exec(
      'update ai_usage_ledger set created_at=now()-interval \'2 hours\',request_meta=\'{"state":"reserved"}\'; update ai_usage_ledger set request_meta=\'{"state":"started"}\' where id=(select id from ai_usage_ledger limit 1)',
    );
    expect(await scalar("select void_stale_ai_reservations(interval '1 second') as v")).toBe(1);
    expect(await scalar("select void_stale_ai_reservations() as v")).toBe(0);
    expect(
      Number(await scalar("select sum(actual_spend_usd) as v from ai_daily_financial_report")),
    ).toBe(0);
  });
  it("denies direct reader execution of spending RPCs", async () => {
    await db.exec("set role authenticated");
    try {
      await expect(claim()).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
  it("enforces configurable reader initiation limits without consuming denied attempts", async () => {
    await db.exec(
      "update ai_runtime_config set value='{\"value\":1}' where key='ai.story_user_daily_starts'",
    );
    try {
      await claim();
      await begin(await reserve());
      expect(await claim("v2")).toBe("rate");
      expect(
        await scalar("select attempts as v from event_understanding where content_version='v2'"),
      ).toBe(0);
    } finally {
      await db.exec(
        "update ai_runtime_config set value='{\"value\":10}' where key='ai.story_user_daily_starts'",
      );
    }
  });
  it("claims each article once and recovers a crashed clustering worker", async () => {
    await db.query("insert into articles(id,title,published_at) values($1,'New report',now())", [
      other,
    ]);
    const first = await scalar("select claim_article_cluster($1,$2) as v", [other, owner]);
    expect(first).toBe(true);
    expect(await scalar("select claim_article_cluster($1,$2) as v", [other, user])).toBe(false);
    await db.exec("update articles set cluster_lease_until=now()-interval '1 second'");
    expect(await scalar("select claim_article_cluster($1,$2) as v", [other, user])).toBe(true);
    expect(
      await scalar("select finish_article_cluster($1,$2,null,false) as v", [other, owner]),
    ).toBeNull();
    expect(
      await scalar("select finish_article_cluster($1,$2,null,false) as v", [other, user]),
    ).toBeTruthy();
    expect(await scalar("select count(*)::integer as v from events")).toBe(2);
  });
  it("finalizes stranded events atomically without refreshing the event's original time", async () => {
    await db.query(
      "update events set status='analysing',first_seen_at='2026-01-01',finalization_owner=$2,finalization_lease_until=now()-interval '1 day' where id=$1",
      [event, other],
    );
    expect(await scalar("select claim_event_finalization($1,$2) as v", [event, owner])).toBe(true);
    await db.query("insert into topics values($1)", [other]);
    const metadata = {
      title: "Source title",
      what_happened: "Source description",
      importance: 7,
      novelty: 3,
      article_count: 5,
      publisher_count: 1,
      tags: [],
    };
    expect(
      await scalar("select finish_event_finalization($1,$2,0,$3,$4) as v", [
        event,
        owner,
        JSON.stringify(metadata),
        [other],
      ]),
    ).toBe(true);
    expect(await scalar("select status::text as v from events where id=$1", [event])).toBe(
      "complete",
    );
    expect(await scalar("select count(*)::integer as v from event_topics")).toBe(1);
    const original = await scalar("select analysed_at::text as v from events where id=$1", [event]);
    await scalar("select claim_event_finalization($1,$2) as v", [event, owner]);
    await scalar("select finish_event_finalization($1,$2,0,$3,$4) as v", [
      event,
      owner,
      JSON.stringify(metadata),
      [other],
    ]);
    expect(await scalar("select analysed_at::text as v from events where id=$1", [event])).toBe(
      original,
    );
    expect(
      await scalar(
        "select extract(year from first_seen_at)::integer as v from events where id=$1",
        [event],
      ),
    ).toBe(2026);
  });
  it("completes an event with no topics rather than failing it", async () => {
    // Pins today's intentional behavior: an empty p_topics array is a no-op
    // insert, not an error. If this ever changes to fail the event instead,
    // that is a deliberate decision to make explicitly, not something that
    // should happen by accident -- see 0087's read model for why every
    // complete event with zero event_topics rows means "classifier found
    // nothing", not "the write failed silently".
    expect(await scalar("select claim_event_finalization($1,$2) as v", [event, owner])).toBe(true);
    const metadata = {
      title: "Source title",
      what_happened: "Source description",
      importance: 3,
      novelty: 1,
      article_count: 1,
      publisher_count: 1,
      tags: [],
    };
    expect(
      await scalar("select finish_event_finalization($1,$2,0,$3,$4) as v", [
        event,
        owner,
        JSON.stringify(metadata),
        [],
      ]),
    ).toBe(true);
    expect(await scalar("select status::text as v from events where id=$1", [event])).toBe(
      "complete",
    );
    expect(
      await scalar("select analysed_at is not null as v from events where id=$1", [event]),
    ).toBe(true);
    expect(await scalar("select count(*)::integer as v from event_topics")).toBe(0);
  });
});
