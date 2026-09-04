import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "./supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  /** True until the first session check resolves. Guards must wait on this. */
  loading: boolean;
  continueWithEmail: (
    email: string,
    options: { createAccount: boolean; next?: string },
  ) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  signInWithProvider: (provider: OAuthProvider, next?: string) => Promise<void>;
  updateEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export type OAuthProvider = "google" | "github";

function callbackUrl(next?: string): string {
  const url = new URL("/auth", window.location.origin);
  if (next) url.searchParams.set("next", next);
  return url.toString();
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    // Fires on sign-in, sign-out, and token refresh — including in other tabs.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,

      async continueWithEmail(email, options) {
        const { error } = await getSupabaseBrowserClient().auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: callbackUrl(options.next),
            shouldCreateUser: options.createAccount,
          },
        });
        if (error) throw error;
      },

      async verifyEmailOtp(email, token) {
        const { error } = await getSupabaseBrowserClient().auth.verifyOtp({
          email,
          token,
          type: "email",
        });
        if (error) throw error;
      },

      async signInWithProvider(provider, next) {
        const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
          provider,
          options: { redirectTo: callbackUrl(next) },
        });
        if (error) {
          // Supabase reports a provider that is switched off in the dashboard as
          // a generic 400; say which one so it is obvious what to go enable.
          if (/not enabled|unsupported provider/i.test(error.message)) {
            throw new Error(
              `${provider === "google" ? "Google" : "GitHub"} authentication is not available.`,
            );
          }
          throw error;
        }
      },

      async updateEmail(email) {
        const { error } = await getSupabaseBrowserClient().auth.updateUser({ email });
        if (error) throw error;
      },

      async signOut() {
        const { error } = await getSupabaseBrowserClient().auth.signOut();
        if (error) throw error;
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/**
 * The best name we have for the signed-in person, or "" if we have none.
 *
 * Checked in order rather than reading one field, because the name arrives in a
 * different place depending on how the account was made: `name` is what our own
 * sign-up form writes, `full_name` is what the Google and GitHub providers set.
 * The local part of the email is the last resort — it is usually a real name and
 * always better than a stranger's.
 *
 * Returns "" rather than a placeholder like "there". Every greeting in the app
 * is written to work without a name; inventing one is what produced the bug
 * where everybody was welcomed by the same hard-coded first name.
 *
 * `preferredName` lets the caller supply a database-backed display name that
 * should win over the OAuth metadata. Without it, the hook falls back to
 * `user_metadata` and finally the email local part.
 */
export function useDisplayName(preferredName?: string): string {
  const { user } = useAuth();
  if (!user) return preferredName ?? "";

  if (preferredName && preferredName.trim()) return preferredName.trim();

  const meta = user.user_metadata as { name?: unknown; full_name?: unknown } | null;
  const fromMeta =
    typeof meta?.name === "string" && meta.name.trim()
      ? meta.name
      : typeof meta?.full_name === "string" && meta.full_name.trim()
        ? meta.full_name
        : "";
  if (fromMeta) return fromMeta.trim();

  const local = user.email?.split("@")[0] ?? "";
  return local.trim();
}
