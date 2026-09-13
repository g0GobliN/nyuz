import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite();
const user = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${user}'::uuid $$;
    create table user_exclusions(user_id uuid, term text, primary key(user_id, term));
    alter table user_exclusions enable row level security;
    grant select, insert, update, delete on user_exclusions to authenticated;
    create policy "own exclusions" on user_exclusions for all using(auth.uid()=user_id);
  `);
  await db.exec(readFileSync("supabase/migrations/0084_exclusion_limits.sql", "utf8"));
}, 60_000);
afterAll(async () => {
  await db.close();
});

it("replaces exclusions atomically and preserves them after invalid writes", async () => {
  const save = (terms: string[]) =>
    db.query("select replace_user_exclusions($1,$2)", [user, terms]);
  await save(["Football"]);
  await expect(save(Array.from({ length: 21 }, (_, i) => `Subject ${i}`))).rejects.toThrow(
    "20 subjects",
  );
  await expect(save(["AI", "AI"])).rejects.toThrow();
  expect((await db.query("select term from user_exclusions")).rows).toEqual([{ term: "Football" }]);
  await save([]);
  expect((await db.query("select term from user_exclusions")).rows).toEqual([]);
});

it("prevents direct browser writes and RPC calls", async () => {
  await db.exec("set role authenticated");
  try {
    await expect(
      db.query("insert into user_exclusions values($1,'aaa')", [user]),
    ).rejects.toThrow();
    await expect(db.query("select replace_user_exclusions($1,'{}')", [user])).rejects.toThrow(
      "permission denied",
    );
  } finally {
    await db.exec("reset role");
  }
});
