/**
 * Every migration in `supabase/migrations`, applied in order, on a scratch
 * PostgreSQL.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * `npm run ci` typechecks the application and runs its tests, and none of that
 * reads a single line of SQL. A migration can therefore be committed, reviewed
 * and pushed while being unapplyable: a misspelled column, a function that
 * references one that a later migration replaces with a different signature, a
 * `references` clause pointing at a table that no longer exists by the time the
 * file runs. The only thing that would notice is a human running
 * `supabase db push`, on the environment where a failure costs the most.
 *
 * PGlite is a real PostgreSQL 16 compiled to WASM, so this is not a parser and
 * not a mock: `create trigger`, `security definer`, enums, partial unique
 * indexes, RLS policies and plpgsql function bodies are all executed. What it is
 * not is Supabase's own platform, so the handful of objects Supabase provides
 * before the first migration -- the three roles, `auth.users`, `auth.uid()` --
 * are bootstrapped here. That gap is the honest limit of this test, and it is
 * small: the migrations touch `auth.uid()`, `auth.users` and `auth.role()` and
 * nothing else of the platform's (no storage, no realtime, no pg_net).
 *
 * ---------------------------------------------------------------------------
 * The chain this was written for
 * ---------------------------------------------------------------------------
 *
 * `0096`–`0102` are the newest files here: discovery, then the material-revision
 * series and the coverage clock it re-enters on. Applying them proves they run
 * *after* the ninety-five that came before, and the assertions below pin the
 * specific columns and flags those workstreams depend on -- so a later edit that
 * removes `discovery_jobs.method` or `events.material_revision` fails here rather
 * than in production. The coverage clock is also *executed* (the last block):
 * its correctness is a trigger side effect no fake can be trusted to model.
 *
 * ---------------------------------------------------------------------------
 * What a green run does not prove
 * ---------------------------------------------------------------------------
 *
 * Three things, worth knowing before trusting it.
 *
 * The live project is not an input. This builds the schema these files
 * describe; the project already has one somewhere else, and where the two
 * disagree nothing here can see it. Both directions have already happened.
 * `0058` wrote `sources.updated_at`, a column only the live project had, so the
 * chain could not be applied to an empty database at all -- fixed there, and
 * the fix is the reason this file turned green. And the discovery tables exist
 * in the live project in the shape an earlier revision of `0096` created, with
 * `provider` and `queries` where this chain has `method` and `attempts`. A
 * green run says the files agree with each other, never that they agree with
 * what is deployed.
 *
 * A body is not a call. `create function` checks a plpgsql body when it is
 * created, but a `language sql` body is only parsed then -- planned when it is
 * first used, which for a helper no migration calls is never. Indexes,
 * constraints, enums, `references` clauses and plpgsql bodies are executed;
 * the body of an unused `language sql` function is read and not run.
 *
 * And nothing here is data. The database is empty, so a migration whose
 * statements act on existing rows performs its DDL and none of its
 * consequences: a backfill selects nothing, a conditional update matches
 * nothing. `0058`'s reclassification is the local example -- it runs, and no
 * source changes.
 */

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DIRECTORY = "supabase/migrations";

/** Sorted by filename, which is the order `supabase db push` applies them in. */
const MIGRATIONS = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".sql"))
  .sort();

/**
 * What Supabase has in place before the first migration runs.
 *
 * Deliberately minimal and deliberately ugly: every line here is a thing the
 * migrations are allowed to assume and the test has to provide. If a migration
 * ever needs more of the platform -- a `storage` schema, `net.http_post` --
 * adding it here is the decision point, and refusing to add it is a legitimate
 * answer (that migration then cannot be verified offline at all).
 */
const SUPABASE_BOOTSTRAP = `
  create role anon;
  create role authenticated;
  create role service_role;

  create schema auth;

  -- The columns the migrations actually read: 0003 selects from it, 0049 and
  -- others read \`banned_until\`, and the signup triggers read \`email\`.
  create table auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text,
    created_at         timestamptz not null default now(),
    banned_until       timestamptz,
    last_sign_in_at    timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );

  -- Supabase reads the caller's identity out of the request's JWT. Off-platform
  -- there is no request, so these answer "nobody" -- which is exactly what a
  -- migration's own DDL should see while it is being applied.
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(current_setting('request.jwt.claim.role', true), 'anon')
  $$;
`;

type Failure = { file: string; message: string };

const failures: Failure[] = [];

let db: PGlite;

beforeAll(async () => {
  if (MIGRATIONS.length === 0) throw new Error(`no migrations found in ${DIRECTORY}`);

  db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(SUPABASE_BOOTSTRAP);

  for (const file of MIGRATIONS) {
    try {
      await db.exec(readFileSync(`${DIRECTORY}/${file}`, "utf8"));
    } catch (error) {
      // Collected rather than thrown: one broken file should report its own
      // message, not hide the ones behind it behind a first failure.
      failures.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
}, 300_000);

afterAll(async () => {
  await db?.close();
});

/** The column names of one table, as PostgreSQL reports them. */
async function columnsOf(table: string): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by column_name`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

async function flagEnabled(key: string): Promise<boolean | undefined> {
  const { rows } = await db.query<{ enabled: boolean }>(
    "select enabled from public.feature_flags where key = $1",
    [key],
  );
  return rows[0]?.enabled;
}

describe("the migration chain", () => {
  it("applies every file in order without an error", () => {
    // Named individually, because "one of 101 migrations failed" is not a
    // report anyone can act on.
    expect(failures.map((failure) => `${failure.file}: ${failure.message}`)).toEqual([]);
  });

  it("is a numbered series whose order is that of the filenames", () => {
    // The filename is the only thing that orders the chain, so every claim here
    // is about the four digits and the order `readdirSync().sort()` produced.
    expect(MIGRATIONS.every((name) => /^\d{4}_\S+\.sql$/.test(name))).toBe(true);

    const numbers = MIGRATIONS.map((name) => Number(name.slice(0, 4)));

    // Non-decreasing. A file numbered below its predecessor still runs after it,
    // so anything it depends on may not exist yet -- and the opposite mistake,
    // reusing a number for something newer, hides the dependency by sorting the
    // newer file first.
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));

    // Gapless among the distinct numbers. A gap is not a failure in itself, but
    // it is what a deleted migration looks like from here, and the next author
    // then reuses the number without knowing a version of it has already run
    // somewhere.
    const distinct = [...new Set(numbers)];
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers) - Math.min(...numbers) + 1).toBe(distinct.length);

    // Duplicate numbers are real in this history: `0056` and `0094` each carry
    // two files, and both pairs are old enough to have been applied in
    // filename order everywhere. That is the only reason they are tolerable --
    // the rest of the filename silently decides. Pinned by number so a *new*
    // collision fails here rather than changing an apply order in production.
    const counts = new Map<number, number>();
    for (const number of numbers) counts.set(number, (counts.get(number) ?? 0) + 1);
    const duplicated = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([number]) => number);
    expect(duplicated).toEqual([56, 94]);
  });
});

describe("what the discovery chain left behind (0096)", () => {
  it("gives a job its deterministic method, terms and link count", async () => {
    expect(await columnsOf("discovery_jobs")).toEqual([
      "attempt",
      "attempts",
      "created_at",
      "error",
      "finished_at",
      "id",
      "linked_count",
      "method",
      "next_attempt_at",
      "started_at",
      "status",
      "terms",
      "topic_id",
    ]);
  });

  it("records where a candidate came from, and remembers rejections", async () => {
    const columns = await columnsOf("source_candidates");
    expect(columns).toContain("method");
    expect(columns).toContain("reject_reason");
    expect(columns).toContain("next_attempt_at");
  });

  it("keeps both tables closed to readers and open to admins", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relname in ('discovery_jobs', 'source_candidates') order by relname`,
    );
    expect(rows).toEqual([
      { relname: "discovery_jobs", relrowsecurity: true },
      { relname: "source_candidates", relrowsecurity: true },
    ]);
  });

  it("ships the flag off and the retention sweep present", async () => {
    expect(await flagEnabled("source_discovery_enabled")).toBe(false);

    // Callable with no argument, which is how the dormant stage calls it.
    const { rows } = await db.query<{ purged: number }>(
      "select public.purge_expired_discovery() as purged",
    );
    expect(rows[0]?.purged).toBe(0);
  });
});

describe("what the material-revision chain left behind (0097–0101)", () => {
  it("records an event's material revision and when it was measured", async () => {
    const columns = await columnsOf("events");
    expect(columns).toEqual(
      expect.arrayContaining([
        "material_revision",
        "material_fingerprint",
        "last_material_change_at",
        "material_occurrence_at",
      ]),
    );
  });

  it("records which revision a reader was delivered, on both sides of the send", async () => {
    expect(await columnsOf("user_events")).toContain("delivered_revision");
    // 0099 added `subject_significance` here; 0103 removed it, because nothing
    // wrote or read it and its (reader, event) grain was not the model.
    expect(await columnsOf("user_events")).not.toContain("subject_significance");
    expect(await columnsOf("digest_items")).toContain("delivered_revision");
  });

  it("gives a topic a match specification and ships its significance flag off", async () => {
    expect(await columnsOf("topics")).toEqual(
      expect.arrayContaining(["match_spec", "match_spec_source", "match_spec_updated_at"]),
    );
    expect(await flagEnabled("subject_significance_enabled")).toBe(false);
  });
});

/**
 * The re-entry clock, executed rather than described (0102).
 *
 * `revision-delivery.test.ts` drives the pipeline against a fake whose trigger
 * emulation stamps `coverage_changed_at`; this is the other half of that bargain.
 * It runs the real `finish_article_cluster`, the real attachment trigger and the
 * real `finish_event_finalization` on PostgreSQL, so removing the trigger's write
 * -- the production behaviour the lane depends on -- fails here and not only in a
 * fake that could have been taught the wrong thing.
 */
describe("the coverage clock that drives re-entry (0102)", () => {
  /** The lane's predicate, as `analyse.ts` spells it through PostgREST. */
  const REENTRY_LANE = `
    select id from public.events
     where (metadata_dirty or status in ('pending', 'analysing'))
       and first_seen_at < now() - interval '72 hours'
       and coverage_changed_at >= now() - interval '14 days'
     order by coverage_changed_at desc`;

  async function oldEvent(daysOld: number): Promise<string> {
    // As an event looks after its first finalization: complete, clean, and with
    // every clock at its creation -- including the coverage clock, so the only
    // thing that can move it below is the attachment.
    const { rows } = await db.query<{ id: string }>(
      `insert into public.events
         (title, status, first_seen_at, last_updated_at, coverage_changed_at,
          analysed_at, metadata_dirty, coverage_revision, material_fingerprint,
          material_occurrence_at)
       values ('Rust 2.0 announced', 'complete',
               now() - make_interval(days => $1), now() - make_interval(days => $1),
               now() - make_interval(days => $1), now() - make_interval(days => $1),
               false, 1, 'v2|m=|n=|e=version:2.0', now() - make_interval(days => $1))
       returning id`,
      [daysOld],
    );
    return rows[0]!.id;
  }

  async function attachThroughCluster(eventId: string, url: string): Promise<void> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.articles (url, title, excerpt, published_at, content_hash)
       values ($1, 'Rust 2.0 RC is out', 'The release candidate is ready.', now(), md5($1))
       returning id`,
      [url],
    );
    const articleId = rows[0]!.id;
    const owner = "00000000-0000-4000-8000-000000000001";
    const claimed = await db.query<{ ok: boolean }>(
      "select public.claim_article_cluster($1, $2) as ok",
      [articleId, owner],
    );
    expect(claimed.rows[0]?.ok).toBe(true);
    const finished = await db.query<{ target: string }>(
      "select public.finish_article_cluster($1, $2, $3, false) as target",
      [articleId, owner, eventId],
    );
    expect(finished.rows[0]?.target).toBe(eventId);
  }

  async function eventRow(id: string) {
    const { rows } = await db.query<{
      metadata_dirty: boolean;
      coverage_revision: number;
      recent_coverage: boolean;
      creation_unmoved: boolean;
      material_revision: number;
      discovered: boolean;
    }>(
      `select metadata_dirty, coverage_revision,
              coverage_changed_at > now() - interval '1 minute' as recent_coverage,
              last_updated_at < now() - interval '10 days' as creation_unmoved,
              material_revision,
              last_material_change_at is not null as discovered
         from public.events where id = $1`,
      [id],
    );
    return rows[0]!;
  }

  it("is a not-null column the re-entry index is built on", async () => {
    expect(await columnsOf("events")).toContain("coverage_changed_at");
    const { rows } = await db.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where tablename = 'events' and indexname like 'events_%reentry%'`,
    );
    expect(rows.map((row) => row.indexname)).toEqual(["events_coverage_reentry_idx"]);
    expect(rows[0]?.indexdef).toContain("coverage_changed_at DESC");
  });

  it.each([15, 30])(
    "is stamped when an article attaches to a %i-day-old event, and nothing else moves",
    async (days) => {
      const eventId = await oldEvent(days);
      const lane = async () => (await db.query<{ id: string }>(REENTRY_LANE)).rows.map((r) => r.id);
      expect(await lane()).not.toContain(eventId);

      await attachThroughCluster(eventId, `https://example.com/rust-rc-${days}`);

      const after = await eventRow(eventId);
      expect(after.metadata_dirty).toBe(true);
      expect(after.coverage_revision).toBe(2);
      expect(after.recent_coverage).toBe(true);
      // `last_updated_at` keeps the meaning its readers depend on.
      expect(after.creation_unmoved).toBe(true);
      // Attachment is not a material change: no revision, no discovery clock.
      expect(after.material_revision).toBe(0);
      expect(after.discovered).toBe(false);
      expect(await lane()).toContain(eventId);
    },
  );

  it("lets finalization advance the revision without touching the coverage clock", async () => {
    const eventId = await oldEvent(21);
    await attachThroughCluster(eventId, "https://example.com/rust-rc-21");
    const before = await db.query<{ at: string }>(
      "select coverage_changed_at::text as at from public.events where id = $1",
      [eventId],
    );

    const owner = "00000000-0000-4000-8000-000000000002";
    await db.query("select public.claim_event_finalization($1, $2)", [eventId, owner]);
    const saved = await db.query<{ ok: boolean }>(
      `select public.finish_event_finalization($1, $2, 2,
         '{"title":"Rust 2.0 RC","what_happened":"","importance":3,"novelty":2,"tags":[],"article_count":2,"publisher_count":1}'::jsonb,
         '{}'::uuid[],
         jsonb_build_object('fingerprint', 'v2r3|m=release_candidate|n=|e=version:2.0',
                            'changed', true, 'occurrence_at', now()::text)) as ok`,
      [eventId, owner],
    );
    expect(saved.rows[0]?.ok).toBe(true);

    const after = await eventRow(eventId);
    expect(after.material_revision).toBe(1);
    expect(after.discovered).toBe(true);
    expect(after.metadata_dirty).toBe(false);
    const clock = await db.query<{ at: string }>(
      "select coverage_changed_at::text as at from public.events where id = $1",
      [eventId],
    );
    expect(clock.rows[0]?.at).toBe(before.rows[0]?.at);
  });
});

/**
 * P4 and revision-aware alerts, executed (0103).
 *
 * `claim_alert` is the authority on what may interrupt a reader, so the two
 * rules it gained are asserted here against the real function: a sub-floor
 * alert is claimable only for a subject-qualified hit *and* only while the flag
 * is on, and a claim covers its revision and no later one.
 */
describe("the alert gate and the subject history (0103)", () => {
  async function reader(): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id",
      [`reader-${crypto.randomUUID()}@example.com`],
    );
    const id = rows[0]!.id;
    await db.query(
      `insert into public.subscriptions (user_id, plan) values ($1, 'omni')
       on conflict (user_id) do update set plan = 'omni'`,
      [id],
    );
    return id;
  }

  async function event(title: string, status = "complete", daysAgo = 1): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.events (title, status, first_seen_at)
       values ($1, $2::event_status, now() - make_interval(days => $3)) returning id`,
      [title, status, daysAgo],
    );
    return rows[0]!.id;
  }

  async function setFlag(enabled: boolean): Promise<void> {
    await db.query(
      "update public.feature_flags set enabled = $1 where key = 'subject_significance_enabled'",
      [enabled],
    );
  }

  const claim = async (
    user: string,
    eventId: string,
    importance: number,
    revision: number,
    qualified: boolean,
  ) =>
    (
      await db.query<{ result: string }>(
        "select public.claim_alert($1, $2, $3, $4, $5) as result",
        [user, eventId, importance, revision, qualified],
      )
    ).rows[0]?.result;

  it("admits a sub-floor alert only for a qualified hit while the flag is on", async () => {
    const user = await reader();
    const eventId = await event("Rust 2.0 RC");
    await setFlag(false);
    expect(await claim(user, eventId, 3, 0, true)).toBe("importance");
    await setFlag(true);
    expect(await claim(user, eventId, 3, 0, false)).toBe("importance");
    expect(await claim(user, eventId, 3, 0, true)).toBe("ok");
    await setFlag(false);
  });

  it("claims each revision once, and keeps the old signature's meaning", async () => {
    const user = await reader();
    const eventId = await event("Rust 2.0 RC");
    expect(await claim(user, eventId, 8, 1, false)).toBe("ok");
    expect(await claim(user, eventId, 8, 1, false)).toBe("duplicate");
    expect(await claim(user, eventId, 8, 2, false)).toBe("ok");
    // The three-argument form is revision 0, which an alerted revision covers.
    const legacy = await db.query<{ result: string }>(
      "select public.claim_alert($1, $2, 8) as result",
      [user, eventId],
    );
    expect(legacy.rows[0]?.result).toBe("duplicate");
  });

  it("stamps the delivered revision on the alert item and the relationship", async () => {
    const user = await reader();
    const eventId = await event("Rust 2.0 released");
    await db.query("insert into public.user_events (user_id, event_id) values ($1, $2)", [
      user,
      eventId,
    ]);
    const created = await db.query<{ result: string }>(
      `select public.create_alert_delivery($1, $2, 8, now(), 'why', array['email']::delivery_channel[], 2, false) as result`,
      [user, eventId],
    );
    expect(created.rows[0]?.result).toMatch(/^ok:/);
    const item = await db.query<{ delivered_revision: number }>(
      "select delivered_revision from public.digest_items where event_id = $1",
      [eventId],
    );
    expect(item.rows.map((r) => r.delivered_revision)).toEqual([2]);
    const pair = await db.query<{ delivered_revision: number; briefed: boolean }>(
      "select delivered_revision, briefed_at is not null as briefed from public.user_events where user_id = $1 and event_id = $2",
      [user, eventId],
    );
    expect(pair.rows[0]).toEqual({ delivered_revision: 2, briefed: true });
  });

  it("returns each subject's recent complete history, bounded per topic", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.topics (slug, label, kind, terms) values ($1, 'Subject', 'custom', '{subject}') returning id`,
      [`subject-${crypto.randomUUID().slice(0, 8)}`],
    );
    const topicId = rows[0]!.id;
    const recent = [
      await event("one", "complete", 1),
      await event("two", "complete", 2),
      await event("three", "complete", 3),
    ];
    const pending = await event("pending", "pending", 1);
    const ancient = await event("ancient", "complete", 400);
    for (const eventId of [...recent, pending, ancient]) {
      await db.query("insert into public.event_topics (event_id, topic_id) values ($1, $2)", [
        eventId,
        topicId,
      ]);
    }

    const history = await db.query<{ event_id: string }>(
      "select event_id from public.subject_history(array[$1]::uuid[], now() - interval '90 days', 2)",
      [topicId],
    );
    expect(history.rows.map((r) => r.event_id)).toEqual(recent.slice(0, 2));

    const capped = await db.query<{ n: number }>(
      "select count(*)::integer as n from public.subject_history(array[$1]::uuid[], now() - interval '90 days', 100000)",
      [topicId],
    );
    expect(capped.rows[0]?.n).toBe(3);
  });
});

describe("the brakes on the topic-saving path (0108)", () => {
  async function account(): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id",
      [`brake-${crypto.randomUUID()}@example.com`],
    );
    return rows[0]!.id;
  }

  it("throttles stage 5 to one run per account per window", async () => {
    // The brake exists because saving a topic ran the whole matcher, and
    // add/remove/add made it spendable on demand. Whether it actually holds is
    // a claim about two statements racing on an advisory lock, which is exactly
    // the kind of thing a read of the file cannot establish.
    const user = await account();
    const call = (minutes: number) =>
      db.query<{ result: string }>("select public.claim_topic_backfill($1, $2) as result", [
        user,
        minutes,
      ]);

    expect((await call(30)).rows[0]?.result).toBe("ok");
    // Second save inside the window: refused, which is what the server acts on.
    expect((await call(30)).rows[0]?.result).toBe("cooling-down");

    // A different account is unaffected. The window is per reader, so one
    // reader spending the brake never costs another reader their day one.
    const other = await account();
    const theirs = await db.query<{ result: string }>(
      "select public.claim_topic_backfill($1, 30) as result",
      [other],
    );
    expect(theirs.rows[0]?.result).toBe("ok");

    // Outside the window it reopens, so a reader who adds a topic tomorrow is
    // not left waiting for a cron they were promised would cover them.
    await db.query(
      "update public.topic_backfill_claims set claimed_at = now() - interval '31 minutes' where user_id = $1",
      [user],
    );
    expect((await call(30)).rows[0]?.result).toBe("ok");

    // A zero window disables the brake rather than refusing forever, so the
    // behaviour is tunable without a migration.
    expect((await call(0)).rows[0]?.result).toBe("ok");
    expect((await call(0)).rows[0]?.result).toBe("ok");
  });

  it("bounds how many canonical custom topics can be minted at once", async () => {
    const countCustoms = async () => {
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::integer as n from public.topics where kind = 'custom'",
      );
      return rows[0]!.n;
    };
    const room = async (limit: number) => {
      const { rows } = await db.query<{ room: number }>(
        "select public.topic_creation_room($1) as room",
        [limit],
      );
      return rows[0]!.room;
    };

    // Exactly at the ceiling is zero room, not one: `room` is a LIMIT, so the
    // arithmetic has to be read as a subtraction from the real count.
    const before = await countCustoms();
    expect(await room(before)).toBe(0);
    expect(await room(before + 1)).toBe(1);

    // Two more custom rows consume two units of the same room.
    for (const slug of [`brake-a-${crypto.randomUUID().slice(0, 8)}`, "brake-b"]) {
      await db.query(
        "insert into public.topics (slug, label, kind, terms) values ($1, 'Brake', 'custom', '{brake}')",
        [slug],
      );
    }
    expect(await countCustoms()).toBe(before + 2);
    expect(await room(before + 2)).toBe(0);
    expect(await room(1_000_000)).toBe(1_000_000 - (before + 2));

    // Never negative. A caller clamps on `max(0, room)`, but a negative value
    // that escaped would reach `slice(0, -n)` and behave very differently.
    expect(await room(0)).toBe(0);
    expect(await room(-5)).toBe(0);

    // The editorial pool is not counted. It is human-curated and does not grow
    // from anything a reader typed, so it must not consume the readers' room.
    const seeded = await db.query<{ n: number }>(
      "select count(*)::integer as n from public.topics where kind = 'predefined'",
    );
    expect(seeded.rows[0]!.n).toBeGreaterThan(0);
    expect(await room(1_000_000)).toBe(1_000_000 - (before + 2));
  });
});

describe("the muted-topics write path (0109) and the dropped column (0110)", () => {
  async function account(): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id",
      [`mute-${crypto.randomUUID()}@example.com`],
    );
    return rows[0]!.id;
  }

  const save = (user: string, topic: string, muted: boolean) =>
    db.query<{ save_muted_topic: string }>(
      "select public.save_muted_topic($1, $2, $3) as save_muted_topic",
      [user, topic, muted],
    );

  it("stores and removes one label, trimmed and idempotent", async () => {
    const user = await account();
    expect((await save(user, "  AI  ", true)).rows[0]?.save_muted_topic).toBe("ok");
    // A second identical save is a no-op, not a second row: the (user, topic)
    // key is the contract 0089 wrote, and the cap arithmetic counts rows.
    expect((await save(user, "AI", true)).rows[0]?.save_muted_topic).toBe("ok");
    const { rows } = await db.query<{ topic: string }>(
      "select topic from public.muted_topics where user_id = $1",
      [user],
    );
    expect(rows.map((r) => r.topic)).toEqual(["AI"]);

    expect((await save(user, "AI", false)).rows[0]?.save_muted_topic).toBe("ok");
    const after = await db.query<{ n: number }>(
      "select count(*)::integer as n from public.muted_topics where user_id = $1",
      [user],
    );
    expect(after.rows[0]?.n).toBe(0);
  });

  it("refuses labels no topic could have", async () => {
    const user = await account();
    expect((await save(user, "   ", true)).rows[0]?.save_muted_topic).toBe("invalid");
    expect((await save(user, "x".repeat(81), true)).rows[0]?.save_muted_topic).toBe("invalid");
  });

  it("caps an account at one hundred and never traps it there", async () => {
    const user = await account();
    for (let i = 0; i < 100; i++) {
      expect((await save(user, `topic ${i}`, true)).rows[0]?.save_muted_topic).toBe("ok");
    }
    expect((await save(user, "one too many", true)).rows[0]?.save_muted_topic).toBe("limit");

    // The brake must never become a trap: unmuting still works at the cap,
    // which is also what frees the next slot.
    expect((await save(user, "topic 0", false)).rows[0]?.save_muted_topic).toBe("ok");
    expect((await save(user, "one too many", true)).rows[0]?.save_muted_topic).toBe("ok");
  });

  it("leaves user_topics without a muted column for any reader to contradict", async () => {
    // 0110 closes the state-model contradiction: loadPreferences read only
    // unmuted rows while replaceTopics diffed all of them, so a future writer
    // of this column would have made the next topics-page save delete the
    // muted follow. The column is gone rather than preserved — the mute
    // semantics live in muted_topics, with one writer.
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::integer as n from information_schema.columns " +
        "where table_schema = 'public' and table_name = 'user_topics' and column_name = 'muted'",
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe("the callable surface the application depends on (0115)", () => {
  /*
   * Applying the chain above proves the schema these files describe. It does
   * not prove that schema can be used. `create function` parses a `language
   * sql` body and plans it at first use, and a plpgsql `new.<field>` resolves
   * when the trigger fires, so a chain can be green while a function is dead.
   *
   * That is exactly how 0110 shipped. It dropped `user_topics.muted` and
   * updated every TypeScript read site, and nine live functions plus the
   * `user_topics` cap trigger went on naming the column. The suite stayed
   * green; the first real call in production raised 42703, and the trigger
   * raised `record "new" has no field "muted"` on every topic follow.
   *
   * So after the chain, call the surface. Not every function in the database —
   * the objects the application can actually reach, with the smallest inputs
   * that exercise their bodies. A reintroduced reference to a dropped column
   * fails here, where it costs a test run, instead of in production.
   */
  async function account(): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id",
      [`callable-${crypto.randomUUID()}@example.com`],
    );
    return rows[0]!.id;
  }

  it("calls every application-callable function without an error", async () => {
    const user = await account();
    const { rows: topics } = await db.query<{ id: string }>(
      "select id from public.topics order by id limit 1",
    );
    const topic = topics[0]!.id;

    // Every one of these is reached from `src/`: `briefing_readiness` and the
    // heartbeats from the scheduled handler, `refresh_source_demand` and
    // `priority_articles_to_cluster` from the ingest and cluster stages,
    // `reader_sources` and `search_topics` from the dashboard, the two admin
    // demand readers from the console, and the last two from the freshness
    // helpers. A call that only needs a body to plan is enough.
    const calls: [string, string, unknown[]][] = [
      ["briefing_readiness", "select * from public.briefing_readiness()", []],
      ["refresh_source_demand", "select public.refresh_source_demand()", []],
      ["pending_events_with_demand", "select * from public.pending_events_with_demand(1)", []],
      ["priority_articles_to_cluster", "select * from public.priority_articles_to_cluster(1)", []],
      ["event_has_demand", "select public.event_has_demand($1)", [topic]],
      ["admin_source_demand", "select * from public.admin_source_demand()", []],
      ["admin_topic_demand", "select * from public.admin_topic_demand(1)", []],
      ["reader_sources", "select * from public.reader_sources($1, 1, 0)", [user]],
      ["search_topics", "select * from public.search_topics($1, 'ai', 5)", [user]],
    ];

    const broken: string[] = [];
    for (const [name, sql, params] of calls) {
      try {
        await db.query(sql, params);
      } catch (error) {
        broken.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("pins search_path on every SECURITY DEFINER function", async () => {
    // The advisor flags DEFINER functions with a mutable search_path, and the
    // repo convention is SET search_path = public on every one. This locks
    // the convention at the source: a future migration that adds an unpinned
    // DEFINER fails here, where it costs a test run, instead of on the
    // advisor. Live drift outside the migration chain is a separate finding
    // and is not what this asserts.
    const { rows } = await db.query<{ name: string; args: string }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
        order by 1`,
    );
    expect(rows.map((row) => `${row.name}(${row.args})`)).toEqual([]);
  });

  it("follows a topic through the user_topics cap trigger", async () => {
    // The function calls above cannot see the trigger, and the trigger was the
    // worst of 0110's leftovers: it fires on every insert, so a reference to
    // the dropped column there broke following a topic outright. Insert and
    // update a real row, which is the only way to run it.
    const user = await account();
    const { rows: topics } = await db.query<{ id: string }>(
      "select id from public.topics order by id limit 1",
    );
    const topic = topics[0]!.id;

    await db.query("insert into public.user_topics (user_id, topic_id) values ($1, $2)", [
      user,
      topic,
    ]);
    await db.query(
      "update public.user_topics set weight = 2 where user_id = $1 and topic_id = $2",
      [user, topic],
    );

    const { rows } = await db.query<{ n: number }>(
      "select count(*)::integer as n from public.user_topics where user_id = $1",
      [user],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe("the match candidate bundle (0116)", () => {
  const WINDOW = "now() - interval '14 days'";
  let topic: string;
  let source: string;

  async function mkTopic(slug: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.topics (slug, label, kind, terms)
       values ($1, $2, 'custom', '{politics}') returning id`,
      [slug, slug],
    );
    return rows[0]!.id;
  }

  async function mkSource(name: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.sources (name, feed_url) values ($1, $2) returning id`,
      [name, `https://bundle-${crypto.randomUUID()}.example.com/feed`],
    );
    return rows[0]!.id;
  }

  async function mkEvent(input: {
    title: string;
    status?: string;
    firstSeenHoursAgo?: number | null;
    analysed?: boolean;
    revision?: number;
    occurrenceHoursAgo?: number | null;
  }): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.events
         (title, status, first_seen_at, analysed_at, material_revision, material_occurrence_at)
       values ($1, $2::event_status,
               now() - make_interval(0, 0, 0, 0, $3::integer, 0, 0),
               case when $4::boolean then now() else null end,
               coalesce($5::integer, 0),
               case when $6::integer is null then null
                    else now() - make_interval(0, 0, 0, 0, $6::integer, 0, 0) end)
       returning id`,
      [
        input.title,
        input.status ?? "complete",
        input.firstSeenHoursAgo ?? 1,
        input.analysed ?? true,
        input.revision ?? 0,
        input.occurrenceHoursAgo ?? null,
      ],
    );
    return rows[0]!.id;
  }

  async function link(eventId: string): Promise<void> {
    await db.query("insert into public.event_topics (event_id, topic_id) values ($1, $2)", [
      eventId,
      topic,
    ]);
  }

  async function article(eventId: string, withSource: boolean): Promise<void> {
    await db.query(
      `insert into public.articles (source_id, event_id, url, title, content_hash)
       values ($1, $2, $3, $4, $5)`,
      [
        withSource ? source : null,
        eventId,
        `https://bundle-${crypto.randomUUID()}.example.com/story`,
        "story",
        crypto.randomUUID(),
      ],
    );
  }

  type BundleRow = {
    id: string;
    title: string;
    topics: unknown;
    sources: unknown;
    has_articles: boolean;
  };

  /** The pre-0116 lane predicates, transcribed as the equivalence oracle. */
  async function legacyLaneIds(fetchLimit: number): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>(
      `(select id from public.events
         where analysed_at is not null and status = 'complete'
           and first_seen_at >= ${WINDOW}
         order by first_seen_at desc limit $1)
       union
       (select id from public.events
         where analysed_at is not null and status = 'complete'
           and material_revision > 0 and material_occurrence_at >= ${WINDOW}
         order by material_occurrence_at desc limit $1)`,
      [fetchLimit],
    );
    return rows.map((r) => r.id).sort();
  }

  async function bundle(fetchLimit: number): Promise<BundleRow[]> {
    const { rows } = await db.query<BundleRow>(
      `select * from public.match_candidate_bundle(${WINDOW}, $1)`,
      [fetchLimit],
    );
    return rows;
  }

  function asJson(value: unknown): unknown {
    return typeof value === "string" ? JSON.parse(value) : value;
  }

  beforeAll(async () => {
    topic = await mkTopic(`bundle-${crypto.randomUUID().slice(0, 8)}`);
    source = await mkSource("Bundle Gazette");
  });

  it("returns the union of the two lanes with links and the article gate", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    // Lane A, linked + sourced.
    const laneA = await mkEvent({ title: `a-${tag}`, firstSeenHoursAgo: 24 });
    await link(laneA);
    await article(laneA, true);
    // Lane A, source-less article, no topics: reporting without attribution.
    const sourceless = await mkEvent({
      title: `s-${tag}`,
      firstSeenHoursAgo: 48,
      revision: 2,
      occurrenceHoursAgo: 48,
    });
    await article(sourceless, false);
    // Lane B only: first seen outside the window, revised inside it, no articles.
    const laneB = await mkEvent({
      title: `b-${tag}`,
      firstSeenHoursAgo: 30 * 24,
      revision: 1,
      occurrenceHoursAgo: 12,
    });
    // Neither lane: old and never revised.
    await mkEvent({ title: `old-${tag}`, firstSeenHoursAgo: 30 * 24 });
    // Wrong status, in window.
    await mkEvent({ title: `pending-${tag}`, status: "pending", firstSeenHoursAgo: 1 });
    // Never analysed, in window.
    await mkEvent({ title: `raw-${tag}`, analysed: false, firstSeenHoursAgo: 1 });
    // In lane A but article-less: returned so the caller can gate it.
    const bare = await mkEvent({ title: `bare-${tag}`, firstSeenHoursAgo: 2 });

    const rows = await bundle(1000);
    const ids = rows.map((r) => r.id).sort();
    // Other blocks seed their own events into the same scratch database, so
    // this asserts containment for ours plus exact agreement with the oracle.
    expect(ids).toEqual(expect.arrayContaining([laneA, sourceless, laneB, bare]));
    // The oracle agrees: the RPC is the old predicates, not a reinterpretation.
    expect(ids).toEqual(await legacyLaneIds(1000));

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(asJson(byId.get(laneA)!.topics)).toEqual([
      { id: topic, slug: expect.any(String), label: expect.any(String) },
    ]);
    expect(asJson(byId.get(laneA)!.sources)).toEqual([{ id: source, name: "Bundle Gazette" }]);
    expect(byId.get(laneA)!.has_articles).toBe(true);
    expect(asJson(byId.get(sourceless)!.topics)).toEqual([]);
    expect(asJson(byId.get(sourceless)!.sources)).toEqual([]);
    expect(byId.get(sourceless)!.has_articles).toBe(true);
    expect(byId.get(laneB)!.has_articles).toBe(false);
    expect(byId.get(bare)!.has_articles).toBe(false);
  });

  it("applies each lane's own limit before merging", async () => {
    // Latest first_seen in the window and latest occurrence decide, per lane.
    const rows = await bundle(1);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(await legacyLaneIds(1));
    expect(ids.length).toBeLessThanOrEqual(2);
  });

  it("survives an absurd fetch limit without truncating a normal page", async () => {
    const rows = await bundle(100_000);
    expect(rows.map((r) => r.id).sort()).toEqual(await legacyLaneIds(100_000));
  });
});

/**
 * The reader's zone, from the row the signup creates (0123).
 *
 * `handle_new_user` runs inside GoTrue's insert, so `raw_user_meta_data` is the
 * only thing that can reach the first row. That makes this the one place the
 * whole path can be executed: the trigger, the gate that decides whether a
 * offered value is schedulable, and the guarded correction for the signup paths
 * that carry no metadata at all.
 *
 * The gap this leaves is the one the file header names: the live project is not
 * an input, so a green run says these files agree with each other, not that the
 * deployed trigger matches them.
 */
describe("the reader's timezone from the first row (0123)", () => {
  /** A signup, exactly as GoTrue performs it: one insert into auth.users. */
  async function signup(metadata: Record<string, unknown>): Promise<string> {
    const id = crypto.randomUUID();
    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
      [id, `${id}@example.com`, JSON.stringify(metadata)],
    );
    return id;
  }

  /** Both columns that carry the fact, read together so they cannot disagree. */
  async function storedZone(id: string): Promise<{ preferences: string; profile: string }> {
    const { rows } = await db.query<{ preferences: string; profile: string }>(
      `select np.timezone as preferences, p.timezone as profile
         from public.notification_preferences np
         join public.profiles p on p.id = np.user_id
        where np.user_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function capture(id: string, zone: string): Promise<string | null> {
    const { rows } = await db.query<{ zone: string | null }>(
      "select public.capture_signup_timezone($1, $2) as zone",
      [id, zone],
    );
    return rows[0]?.zone ?? null;
  }

  it("stores the browser's zone on both rows the signup writes", async () => {
    const id = await signup({ name: "Asha", timezone: "Asia/Kathmandu" });
    expect(await storedZone(id)).toEqual({
      preferences: "Asia/Kathmandu",
      profile: "Asia/Kathmandu",
    });
  });

  it("keeps an alias the scheduler can resolve rather than rewriting it", async () => {
    // `Asia/Calcutta` is absent from `Intl.supportedValuesOf` but `nextSlot`
    // resolves it, and the product's rule is that a stored zone the runtime can
    // read is never replaced. The gate must not be stricter than the scheduler.
    const id = await signup({ timezone: "Asia/Calcutta" });
    expect((await storedZone(id)).preferences).toBe("Asia/Calcutta");
  });

  it("falls back to UTC for a zone it cannot schedule in, without failing the signup", async () => {
    // The insert succeeding is half the assertion: a gate that raised here would
    // turn a bad metadata field into a failed account creation.
    const id = await signup({ timezone: "Mars/Olympus_Mons" });
    expect(await storedZone(id)).toEqual({ preferences: "UTC", profile: "UTC" });
  });

  it("refuses Factory, the one catalog name Intl cannot schedule in", async () => {
    const id = await signup({ timezone: "Factory" });
    expect((await storedZone(id)).preferences).toBe("UTC");
  });

  it("stores UTC when the signup carries no zone at all", async () => {
    const id = await signup({ name: "No Zone" });
    expect(await storedZone(id)).toEqual({ preferences: "UTC", profile: "UTC" });
  });

  it("corrects a row still holding the default, on both tables", async () => {
    // The OAuth case: no metadata, so the trigger wrote the column default.
    const id = await signup({});
    expect(await capture(id, "America/New_York")).toBe("America/New_York");
    expect(await storedZone(id)).toEqual({
      preferences: "America/New_York",
      profile: "America/New_York",
    });
  });

  it("leaves a zone the signup already captured alone", async () => {
    // The email case, opened later from somewhere else. The signup carried the
    // reader's own zone, so the correction has nothing to correct and must not
    // replace a capture with a guess.
    const id = await signup({ timezone: "Asia/Tokyo" });
    expect(await capture(id, "America/New_York")).toBe("Asia/Tokyo");
    expect(await storedZone(id)).toEqual({ preferences: "Asia/Tokyo", profile: "Asia/Tokyo" });
  });

  it("corrects an account whose preferences row was never created", async () => {
    const id = crypto.randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.com`]);
    // What an account created before the trigger wrote this row looks like.
    await db.query("delete from public.notification_preferences where user_id = $1", [id]);

    expect(await capture(id, "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect((await storedZone(id)).preferences).toBe("Asia/Tokyo");
  });

  it("refuses once the reader has onboarded, and answers with the zone they chose", async () => {
    const id = await signup({ timezone: "Asia/Tokyo" });
    // Exactly what onboarding's single save leaves behind: the stamp and the
    // chosen zone, written together.
    await db.query("update public.profiles set onboarded_at = now(), timezone = $2 where id = $1", [
      id,
      "Europe/Berlin",
    ]);
    await db.query("update public.notification_preferences set timezone = $2 where user_id = $1", [
      id,
      "Europe/Berlin",
    ]);

    expect(await capture(id, "America/Los_Angeles")).toBe("Europe/Berlin");
    expect(await storedZone(id)).toEqual({
      preferences: "Europe/Berlin",
      profile: "Europe/Berlin",
    });
  });

  it("is callable only by the service role", async () => {
    // 0036's lesson: revoking from `anon, authenticated` alone leaves the PUBLIC
    // grant standing, which looks like a lock and is not one.
    const { rows } = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(
      `select
         has_function_privilege('anon', 'public.capture_signup_timezone(uuid, text)', 'execute') as anon,
         has_function_privilege('authenticated', 'public.capture_signup_timezone(uuid, text)', 'execute') as authenticated,
         has_function_privilege('service_role', 'public.capture_signup_timezone(uuid, text)', 'execute') as service`,
    );
    expect(rows[0]).toEqual({ anon: false, authenticated: false, service: true });
  });
});
