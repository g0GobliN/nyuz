import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "./supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  /** True until the first session check resolves. Guards must wait on this. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signInWithProvider: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
};

export type OAuthProvider = "google" | "github";

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

      async signIn(email, password) {
        const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      },

      async signUp(email, password, name) {
        const { error } = await getSupabaseBrowserClient().auth.signUp({
          email,
          password,
          // handle_new_user() reads this to seed profiles.display_name, so the
          // greeting works from the very first briefing.
          options: { data: { name } },
        });
        if (error) throw error;
      },

      async signInWithProvider(provider) {
        const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
          provider,
          options: { redirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) {
          // Supabase reports a provider that is switched off in the dashboard as
          // a generic 400; say which one so it is obvious what to go enable.
          if (/not enabled|unsupported provider/i.test(error.message)) {
            throw new Error(
              `${provider === "google" ? "Google" : "GitHub"} sign-in is not enabled yet. Turn it on in Supabase under Authentication > Providers.`,
            );
          }
          throw error;
        }
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
