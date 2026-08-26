# Security

Where the trust boundaries are, what enforces each one, and the mistakes the design is
shaped to prevent.

---

## The two keys

Supabase issues two keys and confusing them is the single worst mistake available here.

|                  | Anon key                                       | Service-role key            |
| ---------------- | ---------------------------------------------- | --------------------------- |
| Variable         | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| Ships to browser | **Yes, by design**                             | **Never**                   |
| RLS              | Enforced                                       | **Bypassed entirely**       |
| Used by          | `src/lib/supabase/client.ts`                   | `src/lib/supabase/admin.ts` |

The anon key is public — it is compiled into the bundle every visitor downloads.
**Row-level security is what actually protects the data**, which is why `0002_rls.sql`
exists and why any table reachable from the browser must have policies.

> **The `VITE_` prefix is the trust boundary.** Vite inlines any `VITE_`-prefixed variable
> into the browser bundle. Putting a secret behind that prefix ships it to every visitor.
> Never `VITE_`-prefix the service-role key or any provider key.

`src/lib/supabase/admin.ts` must never be imported from a component or anything reachable
from client code.

---

## Authorisation: enforced in the database

Every table holding customer data enforces RLS in Postgres. A query can only return rows
belonging to the account that asked, **enforced below the application** — an application
bug cannot hand you somebody else's briefing.

Patterns and their reasoning are in [database.md](database.md#row-level-security). The ones
that matter most:

- **No write policy is a write guard.** Global content tables have `select` only; the
  pipeline writes with the service-role key, which bypasses RLS.
- **`ai_providers`, `ai_model_routes`, `ai_prompts` have no policy at all.** RLS on,
  nothing matches, unreachable from the browser under any circumstances.
- **`user_roles` has no write policy.** A role can only change through an audited server
  function.

---

## Admin authorisation

> The boundary is `adminOnly` / `superadminOnly` in `src/lib/server/guard.ts`.

Full reasoning in [admin-console.md](admin-console.md#the-security-model). In short: the
caller's token is verified by Supabase, and the role is re-read from `user_roles` **on
every call**. Never from a JWT claim (fixed at sign-in — would survive a demotion for an
hour) and never from the request body (attacker-chosen).

The UI role check is cosmetic. A non-admin gets **404**, not 403.

---

## Privilege escalation, closed twice

Two related holes, both closed in `0003`:

**1. Roles are not on `profiles`.** `0002` grants `update own profile` for all columns, so a
`role` column there would be self-grantable with one PostgREST call.

**2. `profiles.email` is clamped by a trigger.** The mirrored address is covered by that
same update policy. RLS cannot compare against `OLD`, so `protect_profile_columns` forces
`id`, `email` and `created_at` back to their old values unless the caller is
`service_role`. Without it, a user could rewrite their address and the console would show
whatever they typed.

---

## Bans

`user_bans` is the reason and the paper trail. **The enforcement is
`auth.users.banned_until`**, set through the Supabase Admin API by the same server
function — that is what stops a token refresh.

A banned user can read their own `user_bans` row, so the app can tell them why and sign
them out rather than failing with an opaque token error.

---

## Secrets

| Secret                      | Where it lives         | Never                                |
| --------------------------- | ---------------------- | ------------------------------------ |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker secret / `.env` | In the browser, in a table, in a log |
| Provider API keys           | Worker secret / `.env` | In the database                      |
| Anon key                    | Bundle                 | — public by design                   |

**Provider keys are referenced by variable name, never stored.** `ai_providers.api_key_env`
holds `"OPENAI_API_KEY"`, not the key. See
[ai-providers.md](ai-providers.md#keys-are-never-in-the-database).

`.env` is gitignored. `.env.example` is not — never put a real value there.

**CI enforces the table above rather than trusting it.** Vite compiles every
`VITE_`-prefixed variable into the browser bundle, so the difference between a Worker
secret and a published one is a naming convention — and a naming convention is not a
control. Two jobs in `.github/workflows/ci.yml` make it one:

- `audit` rejects any `VITE_`-prefixed name containing `SECRET`, `SERVICE_ROLE`,
  `PRIVATE_KEY`, `API_KEY`, `PASSWORD` or `TOKEN`, across `src/`, `scripts/` and
  `.env.example`. This runs on pull requests, so the mistake is caught while it is still
  a name and before it ever holds a value.
- `deploy` scans `.output/public` after the build and before the upload for Stripe,
  Resend, OpenAI-style and Telegram key shapes, and decodes every JWT it finds to
  confirm the role is `anon`. A service-role key and an anon key are both JWTs and look
  alike; only the payload distinguishes them, and only one of them is safe to publish.

If either fires, treat the value as disclosed and rotate it — a failed run has already
printed it to a build log.

On Cloudflare Workers there is **no ambient `process.env` at module scope**, so the
service-role client is built per call from the env handed to the request rather than
captured at import time.

---

## Application-level protections

**CSRF.** `src/start.ts` re-adds `createCsrfMiddleware` explicitly. Start installs it
automatically only when `src/start.ts` is absent — defining the file opts out, so it must be
re-added by hand or server functions lose cross-site protection.

**Blog XSS.** Post bodies are stored as **markdown, never rendered HTML**, and rendered by
the app's own renderer. A compromised console session cannot plant script into the public
site.

**Media URLs.** Validated as a root-relative path or `https://` only, which excludes
`javascript:` and `data:` from an attribute that reaches every visitor.

**Console indexing.** `/admin` sets `noindex, nofollow` and `referrer: same-origin`, so no
console URL leaks through a referer header.

**Audit trail.** Append-only by construction — no update or delete policy, and nothing in
the app issues one.

---

## Checklist for new code

- [ ] Does this reach the browser? Then it must not import `supabase/admin.ts`.
- [ ] Is it a console action? Then it is behind `adminOnly` / `superadminOnly` and calls
      `audit()`.
- [ ] Does it add a table? Then RLS is enabled and the policies are deliberate. Denying by
      default is a valid choice; forgetting is not.
- [ ] Does it add a secret? Then it is a Worker secret, referenced by name, and its name
      does not begin with `VITE_`.
- [ ] Does it add a workflow step using a third-party action? Then it is pinned to a
      commit SHA, with the version in a comment.
- [ ] Does it render user- or operator-supplied text? Then it is escaped, and any URL is
      scheme-checked.
- [ ] Does it read a role? Then from `user_roles`, server-side, per call.

---

## Reporting a vulnerability

The public policy is at `/legal/security`. Report privately first, allow a reasonable window
before disclosure. Good-faith research that does not access or destroy other people's data
will not be pursued.
