# Security findings — classification before any revocation (R1 item 6, 2026-10-12)

The arbiter's R1 ruling: _"security gets a classification pass before any revocations"_ and the
anon-executable `SECURITY DEFINER` functions, the RLS-no-policy tables, the mutable
`search_path` functions and the disabled leaked-password protection are classified
**separately**, with **no blanket revocations**.

This file is the classification for the two SQL-side items that can be settled from the
migration chain plus the code. It changes no behaviour: nothing is revoked, no policy is
added, and no grant is altered. Where a finding needs a ruling, it says so and stops.

Instrument: read-only parsers over `supabase/migrations` (the chain, 118 files) crossed with
every access site in `src/` and `scripts/`.

## 1. Tables with RLS enabled and no policy — the 32

**Question the advisor raises.** "RLS Enabled No Policy" is an informational lint: the table
is enabled but no policy exists, so `anon`/`authenticated` get zero rows and cannot write.

**What it actually means here.** With RLS on and no policy the effective grant to
`anon`/`authenticated` is _deny all_. That is the **safe** default, and it is exactly right
for a table that only the server should touch. The finding is only a problem if the browser
is supposed to reach the table, in which case it is a _broken feature_, not a leak.

**The decisive check.** A table can only be exposed to a browser session through a Supabase
client built from the **anon key**. There is exactly one such module —
[client.ts](../src/lib/supabase/client.ts), whose own header states the invariant: _"any table
reachable from here must have policies."_ Its importers are, in full:

| file                         | uses the anon client for                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/lib/auth.tsx`           | `auth.*` only — sign-in, OTP, OAuth, `updateUser`, `signOut`                                    |
| `src/lib/plan-state.ts`      | one read, `.from("subscriptions")`                                                              |
| `src/lib/server/guard.ts`    | `auth.getSession()` (attaches the bearer token); rows are read with the **service-role** client |
| `src/lib/supabase/client.ts` | the definition itself                                                                           |

Every other access site for these tables is in `src/lib/server/**` (service role, handed down
as `actor.db` / `createAdminClient()`), in `scripts/**`, or in a pipeline/AI module
(`src/lib/pipeline/**`, `src/lib/ai/**`) that receives **`db` as an injected parameter** and
never constructs a client. Service role bypasses RLS, so those reads do not need a policy.

**The one public-table read from the browser is `subscriptions`**, and it has the
`"own subscription"` policy. Nothing else in the 32 is browser-reachable.

**Verdict: no policy is missing. Revoke nothing, add nothing.** The 32 are internal tables
behind a deny-all default; the exposure the advisor implies does not exist because the only
anon-key client in the product cannot reach them.

**Two things to record rather than act on.**

- The advisor reports **31**; the chain contains **32**. The extra name is likely a table the
  live project created outside the migration chain, or one dropped there. Reconciling needs
  the dashboard's list — owner-side, same blocker shape as the `search_path` finding.
- `user_roles` carries a policy `"own role"` that lets a signed-in user read their own role
  through PostgREST. The guard does not rely on it (it re-reads the role with the service-role
  client), and a user learning their own role is not sensitive. Noted, not changed.

## 2. Mutable `search_path` — the chain is clean, live drift is owner-side

A scratch PGlite instance applied all 118 migrations, and `pg_proc` reports **0** `SECURITY
DEFINER` functions with a mutable `search_path`. The repo's convention (`set search_path =
public`) is universal in the chain and is now **locked by a test**
([schema-migrations.test.ts](../src/lib/schema-migrations.test.ts), "pins search_path on every
SECURITY DEFINER function"), so a future migration that adds an unpinned definer fails in CI,
not on the advisor.

The advisor's 10 therefore describe **live drift outside the chain**. Writing a pinning
migration without the live names would be freelancing against an unknown; the names are
needed from the dashboard or `supabase db diff`. **Blocked on the owner; no code written.**

## 3. Anon-executable `SECURITY DEFINER` functions — 19 classified

R1's own number is 19 anon-executable definers. They were classified from the migrations with
caller analysis, one name at a time, against who actually calls them. Three shapes account for
the set: a few `is_admin`/`is_superadmin`-style helpers that must stay callable because the
RLS policies call them, functions that are only reachable as **trigger** bodies and so cannot
be invoked through PostgREST at all, and candidates that looked executable from the grant list
but are plain SQL or invoker-rights once read. **Verdict: revoke nothing.** The per-name table
with its evidence is in the relay pack prepared for the arbiter; this file records the verdict
and its shape, not a claim to have re-derived the grants today.

The corresponding list of `SECURITY DEFINER` functions the repo never revokes is 35 names,
printed by the definer audit — a different question from the 19, which is about the `anon`
grant, not about the definer attribute.

## What this file is not

It is not a grant change, not a policy change, and not a substitute for a ruling. If the
arbiter wants any of the three verdicts revisited, the evidence to argue against is in the
tables above; the numbers are reproducible from the chain with the parsers, and the
browser-reachability claim rests on the four-file importer list, which is a `grep`, not an
opinion.
