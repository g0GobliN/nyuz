# Admin console

The operator console at `/admin`. Separate from the customer dashboard, gated by role, and
audited.

> **State: built.** Every panel reads and writes real tables.

---

## Getting in

1. Apply `0003_admin.sql`.
2. Sign up normally at `/auth`.
3. Run `supabase/bootstrap_superadmin.sql` by hand with your address.
4. Reload. A **Staff** group appears in the dashboard sidebar.

The role is cached client-side for 60 seconds, so a fresh grant can take one refresh to
appear.

---

## The security model

**Read this before adding anything to the console.**

> The security boundary is `adminOnly` / `superadminOnly` in
> `src/lib/server/guard.ts`, and nowhere else.

Every console server function runs behind one of those two middlewares. They:

1. Take the caller's Supabase access token, attached by a **client** middleware — the
   session lives in browser storage, so this cannot happen server-side.
2. Hand it to Supabase to **verify the signature and expiry**.
3. Re-read the role from `user_roles` **on every single call**.

What they deliberately do not do is read a role from the JWT or the request body. A JWT
claim is fixed at sign-in and would keep working for an hour after a demotion. A body field
is attacker-chosen.

### The UI check is not protection

`src/lib/viewer.ts` (`useViewer`, `isAdmin`) decides _what gets drawn_. Someone who forces
the console to render sees an empty shell whose every request fails. Hiding the nav links
removes the invitation, not the access.

A non-admin hitting a console function gets **404, not 403** — telling a stranger that a
console exists and they are merely not on the list is information they cannot use.

### Why console data is fetched client-side

Console queries go through React Query in components, never route loaders. A loader runs
during SSR, where there is no browser session to read a token from — so it would either see
every visitor as anonymous, or force the role check into a cookie, which is the one place it
must not live.

The public site is the opposite: it uses loaders, because `getPublicSiteContent` needs no
session and never throws.

---

## Panels

### Overview

Counts from Postgres using `head: true` with an exact count — the number comes back without
shipping a row, so page cost does not grow with table size.

Users (total, new 7/30d, active 7/30d, onboarded, banned, staff), plan distribution,
delivery success rate, feedback split, token spend, blog totals, and a daily chart from
`admin_daily_counts`.

**MRR is labelled an estimate everywhere it appears.** It multiplies list price by active
paid subscription and knows nothing about discounts, refunds or failed charges. Token
totals page at 10,000 rows and are a floor beyond that, which the panel states rather than
silently under-reporting.

### Users

Search by email or name, filter by plan and role. Per user: profile, plan, activity,
topics, role, ban state.

**Banning** writes a `user_bans` row _and_ calls the Supabase Admin API to set
`banned_until`. The second is the enforcement; the first is the reason and the trail. See
[database.md](database.md#why-a-ban-row-is-not-a-ban).

**Role changes are superadmin-only.**

### Blog

Markdown authoring with slug, excerpt, tags, cover, SEO fields and status. Scheduled posts
go live on time with no job running — the RLS policy compares `published_at` to `now()` on
every read.

Bodies are stored as **markdown, never rendered HTML**, so a compromised console session
cannot plant script into the public site.

### AI providers

Which provider and model serves each capability tier. See
[ai-providers.md](ai-providers.md).

### Sources

Add, disable and inspect feeds. Disable, never delete — `articles.source_id` is `on
delete set null`, so removing a row would orphan every article it ever contributed.

**Topics**, added with `0018_source_topic_graph.sql`: each source can be tagged with
the topics it covers, editable as a set of toggle chips per source. This is the
source→topic graph V2 planning (docs/track.md) reads demand from — it does not yet
change what gets fetched or analysed. Confidence is set to a flat 0.8 on add from the
console; anything more precise is a database edit for now.

### Site content

Landing hero, announcement bar, section order and visibility, media slots, SEO, footer,
prices, feature flags. See [site-content.md](site-content.md).

### Audit log

Every mutating action, append-only. Actor, action, target, metadata, timestamp.

There is no update or delete policy on `admin_audit_log` and nothing in the app issues
one. `audit()` **never throws** — an action that succeeded must not be reported as failed
because its log line did not land — but a failed write goes to the server log, so a gap in
the trail is explainable rather than silent.

---

## Adding a panel

1. **Server function** in `src/lib/server/`, behind `adminOnly` or `superadminOnly`.
2. **Call `audit()`** if it mutates anything.
3. **Route** under `src/routes/admin/`.
4. **Nav entry** in `NAV` in `src/components/admin/shell.tsx`.
5. **Fetch with React Query** in the component. Not a loader.

Primitives — `Panel`, `Field`, `Pill`, `inputClass`, `ConsoleHeader`, `Loading`,
`ErrorNote`, `useConsoleMutation` — are exported from `src/components/admin/shell.tsx`.

### What not to do

- Do not add a query that bypasses the guard middleware.
- Do not read a role from anywhere but `user_roles`, server-side.
- Do not put a secret in a table the console can read.
- Do not fetch console data in a route loader.

---

## Related

- [security.md](security.md) — the wider trust boundary
- [database.md](database.md) — the tables behind each panel
