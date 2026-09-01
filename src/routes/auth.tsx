import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Github, Lock, Mail, User as UserIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/kit";
import { Logo } from "@/components/landing/nav";
import { LogoLoader } from "@/components/loading";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth, type OAuthProvider } from "@/lib/auth";
import { getPublicSiteContent } from "@/lib/server/settings";
import { getSignupState } from "@/lib/server/access";
import { MaintenanceScreen, SignupsClosedNote, WaitlistPanel } from "@/components/access";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.35 11.1h-9.17v2.96h5.27c-.23 1.4-1.66 4.1-5.27 4.1-3.17 0-5.76-2.62-5.76-5.86s2.59-5.86 5.76-5.86c1.81 0 3.02.77 3.71 1.44l2.53-2.44C16.78 3.87 14.72 3 12.18 3 7.14 3 3.06 7.03 3.06 12.3s4.08 9.3 9.12 9.3c5.27 0 8.76-3.7 8.76-8.92 0-.6-.06-1.06-.15-1.58z"
      />
    </svg>
  );
}

export const Route = createFileRoute("/auth")({
  // Both in one loader so the page never renders a "Create an account" button
  // that the database is about to refuse. `getSignupState` counts seats, which
  // is why it is not folded into `getPublicSiteContent` — that runs on every
  // marketing page and must not carry a count query.
  loader: async () => ({
    content: await getPublicSiteContent(),
    signup: await getSignupState(),
  }),
  component: Auth,
  head: () => ({
    meta: [
      { title: "Sign in — nyuz" },
      { name: "description", content: "Sign in to your nyuz briefing." },
    ],
  }),
});

type Mode = "signin" | "signup" | "forgot" | "recovery";

export function passwordRecoveryError(raw: string): string {
  if (/rate limit|too many requests/i.test(raw)) {
    return "Too many reset attempts. Wait a few minutes and try again.";
  }
  if (/expired|invalid|otp|session/i.test(raw)) {
    return "This recovery link is invalid or has expired. Request a new one.";
  }
  return raw || "Password recovery failed. Try again.";
}

/**
 * Turns whatever came back from GoTrue into something a person can act on.
 *
 * The refusals raised by `enforce_signups_open` reach the browser as the
 * exception text when GoTrue passes it through, and as a generic "Database
 * error saving new user" when it does not — which is the case for the OAuth
 * callback. Both have to land somewhere sensible, because a stranger who has
 * just clicked "Continue with Google" and been bounced deserves better than a
 * Postgres string.
 */
function signupError(raw: string, fallback: string): string {
  if (/capacity/i.test(raw)) {
    return "nyuz is full at the moment. Join the waitlist and we will write when a place opens.";
  }
  if (/maintenance/i.test(raw)) {
    return "nyuz is closed for maintenance right now. Please try again shortly.";
  }
  if (/signups are closed/i.test(raw)) return "Registration is closed right now.";
  // GoTrue swallows the trigger's message on the OAuth path, so the only
  // honest reading of this one is "the door refused you, and we know why but
  // cannot see it from here".
  if (/database error saving new user/i.test(raw)) {
    return "We could not create the account. nyuz may be full or closed to new signups.";
  }
  return raw || fallback;
}

function Auth() {
  const navigate = useNavigate();
  const { content, signup } = Route.useLoaderData();
  const signupsOpen = signup.open;
  const {
    signIn,
    signUp,
    signInWithProvider,
    requestPasswordReset,
    updatePassword,
    clearRecovery,
    recovery,
    session,
    loading,
  } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const recoveryRequested =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("recovery") === "1";

  useEffect(() => {
    if (recovery || recoveryRequested) setMode("recovery");
  }, [recovery, recoveryRequested]);

  useEffect(() => {
    if (recoveryRequested && !loading && !recovery && !session) {
      setError("This recovery link is invalid or has expired. Request a new one.");
    }
  }, [recoveryRequested, loading, recovery, session]);

  // Already signed in (or just became so) — nothing to do on this page.
  useEffect(() => {
    if (!loading && session && !recovery && !recoveryRequested && mode !== "recovery") {
      navigate({ to: "/dashboard" });
    }
  }, [loading, session, recovery, recoveryRequested, mode, navigate]);

  // Maintenance closes sign-in too. Letting somebody in to a dashboard whose
  // every request is failing is worse than telling them the door is shut.
  if (signup.reason === "maintenance") {
    return <MaintenanceScreen access={content.access} />;
  }

  const oauth = async (provider: OAuthProvider) => {
    setError(null);
    setBusy(true);
    try {
      // On success this navigates away to the provider, so nothing after runs.
      await signInWithProvider(provider);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      setError(signupError(raw, "Could not start sign-in."));
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode !== "recovery" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Enter an email address we can reach you at.");
      return;
    }
    if (mode !== "forgot" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (mode === "recovery" && password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "forgot") {
        await requestPasswordReset(email.trim());
        setResetSent(true);
        setBusy(false);
        return;
      }
      if (mode === "recovery") {
        if (!session) throw new Error("Recovery session is invalid or expired.");
        await updatePassword(password);
        setResetComplete(true);
        setBusy(false);
        window.setTimeout(() => navigate({ to: "/dashboard", replace: true }), 1200);
        return;
      }
      if (mode === "signup") {
        if (!signupsOpen) {
          setError(
            signup.reason === "full"
              ? "nyuz is full at the moment. Join the waitlist below and we will write when a place opens."
              : "Registration is closed right now.",
          );
          setBusy(false);
          return;
        }
        await signUp(email.trim(), password, name.trim());
      } else {
        await signIn(email.trim(), password);
      }
      // The auth listener flips `session`, and the effect above redirects.
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      setError(
        mode === "forgot" || mode === "recovery"
          ? passwordRecoveryError(raw)
          : signupError(raw, "Something went wrong. Try again."),
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="veil flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm animate-rise">
          <h1 className="display text-4xl">
            {mode === "signin"
              ? "Welcome back."
              : mode === "signup"
                ? "Build your nyuz."
                : mode === "forgot"
                  ? "Reset your password."
                  : "Choose a new password."}
          </h1>
          <p className="mt-4 text-[14.5px] leading-relaxed text-muted-foreground">
            {mode === "signin"
              ? "This morning's briefing is where you left it."
              : mode === "signup"
                ? "Free to start. No card. Tell us what actually matters."
                : mode === "forgot"
                  ? "We will send a time-limited recovery link to your account email."
                  : "The recovery link has opened a protected session for this change."}
          </p>

          {mode === "signin" || mode === "signup" ? (
            <>
              <div className="mt-8 flex flex-col gap-2.5">
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => oauth("google")}
                >
                  <GoogleMark /> Continue with Google
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => oauth("github")}
                >
                  <Github className="h-4 w-4" /> Continue with GitHub
                </Button>
              </div>

              <div className="my-7 flex items-center gap-4">
                <span className="h-px flex-1 bg-[var(--hairline)]" />
                <span className="text-[11.5px] uppercase tracking-[0.16em] text-muted-foreground">
                  or
                </span>
                <span className="h-px flex-1 bg-[var(--hairline)]" />
              </div>
            </>
          ) : null}

          {resetSent ? (
            <div className="mt-8 rounded-2xl border border-hairline bg-surface p-5 text-[13.5px] leading-relaxed">
              If an account exists for that address, its recovery email is on the way.
            </div>
          ) : resetComplete ? (
            <div className="mt-8 rounded-2xl border border-hairline bg-surface p-5 text-[13.5px] leading-relaxed">
              Password updated. Taking you back to your briefing…
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              {mode === "signup" ? (
                <Field
                  id="name"
                  label="What should we call you?"
                  icon={<UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={setName}
                  placeholder="Your name"
                />
              ) : null}

              {mode !== "recovery" ? (
                <Field
                  id="email"
                  label="Email address"
                  icon={<Mail className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(v) => {
                    setEmail(v);
                    if (error) setError(null);
                  }}
                  placeholder="you@work.com"
                  className={mode === "signup" ? "mt-4" : ""}
                />
              ) : null}

              {mode !== "forgot" ? (
                <Field
                  id="password"
                  label={mode === "recovery" ? "New password" : "Password"}
                  icon={<Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  type="password"
                  autoComplete={
                    mode === "signup" || mode === "recovery" ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={(v) => {
                    setPassword(v);
                    if (error) setError(null);
                  }}
                  placeholder={
                    mode === "signup" || mode === "recovery" ? "At least 6 characters" : "••••••••"
                  }
                  className={mode === "recovery" ? "" : "mt-4"}
                />
              ) : null}

              {mode === "recovery" ? (
                <Field
                  id="password-confirmation"
                  label="Confirm new password"
                  icon={<Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(v) => {
                    setConfirmation(v);
                    if (error) setError(null);
                  }}
                  placeholder="Repeat the new password"
                  className="mt-4"
                />
              ) : null}

              {error ? <p className="mt-3 text-[12.5px] text-destructive">{error}</p> : null}

              <Button type="submit" className="mt-6 w-full" disabled={busy}>
                {busy ? (
                  <>
                    <LogoLoader
                      className="h-4 w-4"
                      tone="current"
                      label={
                        mode === "signup"
                          ? "Creating account"
                          : mode === "forgot"
                            ? "Sending reset"
                            : mode === "recovery"
                              ? "Updating password"
                              : "Signing in"
                      }
                    />
                    {mode === "signup"
                      ? "Creating account"
                      : mode === "forgot"
                        ? "Sending reset"
                        : mode === "recovery"
                          ? "Updating password"
                          : "Signing in"}
                  </>
                ) : mode === "signup" ? (
                  "Create account"
                ) : mode === "forgot" ? (
                  "Send recovery email"
                ) : mode === "recovery" ? (
                  "Set new password"
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          )}

          {mode === "signin" ? (
            <button
              onClick={() => {
                setMode("forgot");
                setError(null);
              }}
              className="mt-4 w-full text-center text-[12.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </button>
          ) : null}

          {/* Full is not the same as closed. "Full" has somewhere to send
              somebody — a place in a queue; "closed" is the operator switching
              registration off, and inviting a waitlist against it would be
              collecting addresses for a door nobody intends to open. */}
          {mode === "signin" && signup.reason === "full" ? (
            <div className="mt-7">
              <WaitlistPanel waitlistOpen={signup.waitlistOpen} />
            </div>
          ) : null}

          {mode === "signin" && signup.reason === "closed" ? (
            <div className="mt-7">
              <SignupsClosedNote />
            </div>
          ) : null}

          <p className="mt-7 text-center text-[13px] text-muted-foreground">
            {mode === "signin" ? (
              signupsOpen ? (
                <>
                  New here?{" "}
                  <button
                    onClick={() => {
                      setMode("signup");
                      setError(null);
                    }}
                    className="text-foreground underline-offset-4 hover:underline"
                  >
                    Create an account
                  </button>
                </>
              ) : null
            ) : mode === "signup" ? (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                  }}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  Sign in
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  clearRecovery();
                  window.history.replaceState({}, "", "/auth");
                  setMode("signin");
                  setResetSent(false);
                  setResetComplete(false);
                  setError(null);
                }}
                className="text-foreground underline-offset-4 hover:underline"
              >
                Back to sign in
              </button>
            )}
          </p>

          <p className="mt-10 text-center text-[11.5px] leading-relaxed text-muted-foreground">
            By continuing you agree to our{" "}
            <Link
              to="/legal/$doc"
              params={{ doc: "terms" }}
              className="underline-offset-4 hover:underline"
            >
              Terms
            </Link>{" "}
            and{" "}
            <Link
              to="/legal/$doc"
              params={{ doc: "privacy" }}
              className="underline-offset-4 hover:underline"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}

function Field({
  id,
  label,
  icon,
  type,
  autoComplete,
  value,
  onChange,
  placeholder,
  className,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  type: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-[13px] text-muted-foreground">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2.5 rounded-full border border-input bg-surface px-4 focus-within:border-signal">
        {icon}
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-11 w-full bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:text-[14.5px]"
        />
      </div>
    </div>
  );
}
