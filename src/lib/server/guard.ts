import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AdminRole, Database, Json } from "@/lib/supabase/types";

/**
 * The trust boundary for the admin console.
 *
 * Every console server function runs behind `adminOnly` or `superadminOnly`.
 * Neither one trusts anything the caller sent about itself: the client half
 * attaches the caller's Supabase access token, and the server half hands that
 * token to Supabase to verify the signature and expiry, then reads the role
 * from `user_roles` — a table with no write policy, so a role can only have
 * been set by another admin through an audited action.
 *
 * What this deliberately does NOT do is read a role out of the JWT or out of
 * the request body. A JWT claim would be fixed at sign-in and would keep
 * working for an hour after a demotion; a body field would be attacker-chosen.
 */

export class AdminAuthError extends Error {
  /**
   * `statusCode` is load-bearing, not decoration: the request middleware in
   * src/start.ts rethrows anything carrying it and swallows everything else
   * into an HTML error page, which a server-function client cannot parse.
   */
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AdminAuthError";
    this.statusCode = statusCode;
  }
}

export type Actor = {
  id: string;
  email: string;
  role: AdminRole;
  /**
   * Service-role client, already built. Handed down so a handler does not
   * construct a second one per call.
   */
  db: SupabaseClient<Database>;
};

function bearer(): string | undefined {
  const header = getRequestHeader("authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

async function resolveActor(): Promise<Actor> {
  const token = bearer();
  if (!token) {
    throw new AdminAuthError("Not signed in.", 401);
  }

  const db = createAdminClient();

  // Verifies the signature and expiry against the project's JWT secret. A
  // forged or stale token fails here, before any row is read.
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    throw new AdminAuthError("Session expired. Sign in again.", 401);
  }

  const { data: roleRow, error: roleError } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (roleError) {
    throw new AdminAuthError(`Could not read role: ${roleError.message}`, 500);
  }

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    role: roleRow?.role ?? "user",
    db,
  };
}

/**
 * Attaches the caller's access token. Runs in the browser, where the session
 * actually lives — during SSR there is no stored session, which is why the
 * console fetches on the client rather than in route loaders.
 */
const attachToken = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  return next(token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
});

export const adminOnly = createMiddleware({ type: "function" })
  .middleware([attachToken])
  .server(async ({ next }) => {
    const actor = await resolveActor();
    if (actor.role !== "admin" && actor.role !== "superadmin") {
      // Same message either way. Telling a non-admin that the console exists
      // and they are merely not on the list is information they cannot use.
      throw new AdminAuthError("Not found.", 404);
    }
    return next({ context: { actor } });
  });

export const superadminOnly = createMiddleware({ type: "function" })
  .middleware([attachToken])
  .server(async ({ next }) => {
    const actor = await resolveActor();
    if (actor.role !== "superadmin") {
      throw new AdminAuthError("This action is restricted to superadmins.", 403);
    }
    return next({ context: { actor } });
  });

/**
 * Who the caller is, from the console's point of view.
 *
 * Deliberately does not throw for a signed-out visitor. This is what the nav
 * calls to decide whether to render a link to the console at all, and it runs on
 * pages an anonymous visitor sees — a 401 there would turn "no admin link" into
 * a failed request on every page load.
 *
 * It is not a security check. The answer is advisory and only decides what gets
 * drawn; every action still passes through `adminOnly` or `superadminOnly`,
 * which re-resolve the role server-side. A user who lies to this endpoint gets a
 * link to a page whose every request then fails.
 */
export type Viewer = { signedIn: boolean; id: string; email: string; role: AdminRole };

export const getViewer = createServerFn({ method: "GET" })
  .middleware([attachToken])
  .handler(async (): Promise<Viewer> => {
    try {
      const actor = await resolveActor();
      return { signedIn: true, id: actor.id, email: actor.email, role: actor.role };
    } catch {
      return { signedIn: false, id: "", email: "", role: "user" };
    }
  });

/**
 * Appends one row to the audit trail.
 *
 * Never throws. A console action that succeeded must not be reported as failed
 * because its log line did not land — but the miss goes to the server log so
 * a gap in the trail is explainable rather than silent.
 */
export async function audit(
  actor: Actor,
  action: string,
  target: { type: string; id: string },
  meta: Record<string, Json> = {},
): Promise<void> {
  const { error } = await actor.db.from("admin_audit_log").insert({
    actor_id: actor.id,
    actor_email: actor.email,
    action,
    target_type: target.type,
    target_id: target.id,
    meta,
  });
  if (error) {
    console.error(`audit write failed for ${action}: ${error.message}`);
  }
}

/** Turns a PostgREST error into something the console can display. */
export function orThrow<T>(
  result: { data: T | null; error: { message: string } | null },
  what: string,
): T {
  if (result.error) throw new AdminAuthError(`${what}: ${result.error.message}`, 500);
  if (result.data === null) throw new AdminAuthError(`${what}: not found.`, 404);
  return result.data;
}
