import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Github } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MaintenanceScreen, SignupsClosedNote, WaitlistPanel } from "@/components/access";
import { Button } from "@/components/kit";
import { Logo } from "@/components/landing/nav";
import { LogoLoader, PageLoading } from "@/components/loading";
import { ThemeToggle } from "@/components/theme-toggle";
import { safeAuthDestination } from "@/lib/auth-redirect";
import { authErrorMessage, providerName } from "@/lib/auth-errors";
import { useAuth, type OAuthProvider } from "@/lib/auth";
import { getSignupState } from "@/lib/server/access";
import { loadPreferences } from "@/lib/server/preferences";
import { getPublicSiteContent } from "@/lib/server/settings";

type AuthSearch = { next?: string; recovery?: "1" };

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    ...(typeof search["next"] === "string" ? { next: search["next"] } : {}),
    ...(search["recovery"] === "1" ? { recovery: "1" as const } : {}),
  }),
  loader: async () => ({
    content: await getPublicSiteContent(),
    signup: await getSignupState(),
  }),
  component: Auth,
  head: () => ({
    meta: [
      { title: "Continue — nyuz" },
      { name: "description", content: "Continue to your nyuz briefing." },
    ],
  }),
});

type Mode = "main" | "email" | "code";

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

function callbackError(): string | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.get("error_description") ?? query.get("error") ?? hash.get("error_description");
}

function Auth() {
  const search = Route.useSearch();
  const { content, signup } = Route.useLoaderData();
  const { continueWithEmail, verifyEmailOtp, signInWithProvider, session, loading } = useAuth();
  const destination = safeAuthDestination(search.next);

  const [mode, setMode] = useState<Mode>("main");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyProvider, setBusyProvider] = useState<OAuthProvider | null>(null);
  const [changingToCode, setChangingToCode] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const resendTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (resendTimerRef.current) window.clearInterval(resendTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const raw = callbackError();
    if (raw && !session) setError(authErrorMessage(raw));
  }, [loading, session]);

  // A valid legacy recovery link also creates a verified Supabase session. It
  // can safely use this same handoff; no password UI is needed to recover access.
  useEffect(() => {
    if (loading || !session) return;
    let active = true;
    setResolving(true);
    setResolveFailed(false);
    setError(null);

    void loadPreferences()
      .then((prefs) => {
        if (!active) return;
        if (prefs.onboarded) {
          window.location.replace(destination);
          return;
        }
        const next = destination === "/dashboard" ? "" : destination;
        window.location.replace(
          next ? `/onboarding?${new URLSearchParams({ next })}` : "/onboarding",
        );
      })
      .catch(() => {
        if (!active) return;
        setResolving(false);
        setResolveFailed(true);
      });

    return () => {
      active = false;
    };
  }, [loading, session, destination]);

  if (signup.reason === "maintenance") return <MaintenanceScreen access={content.access} />;
  if (loading || resolving || (session && !resolveFailed)) {
    return <PageLoading label="Opening your account" className="min-h-dvh" />;
  }
  if (session && resolveFailed) {
    return (
      <AuthShell>
        <h1 className="display text-[clamp(2rem,10vw,2.75rem)]">That didn&apos;t open.</h1>
        <p role="alert" className="mt-5 text-[14.5px] leading-relaxed text-muted-foreground">
          We couldn&apos;t open your account. Your session is safe.
        </p>
        <Button className="mt-7" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </AuthShell>
    );
  }

  const oauth = async (provider: OAuthProvider) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    setBusyProvider(provider);
    try {
      await signInWithProvider(provider, destination);
    } catch (caught) {
      setError(authErrorMessage(caught instanceof Error ? caught.message : "", provider));
      setBusy(false);
      setBusyProvider(null);
    }
  };

  const sendCode = async () => {
    if (busy) return;
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      await continueWithEmail(email.trim(), { createAccount: signup.open, next: destination });
      setCode("");
      if (mode === "email") {
        setChangingToCode(true);
        await new Promise((resolve) => window.setTimeout(resolve, 240));
        setMode("code");
        setChangingToCode(false);
      }
      setResendCooldown(60);
      if (resendTimerRef.current) window.clearInterval(resendTimerRef.current);
      resendTimerRef.current = window.setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            window.clearInterval(resendTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (caught) {
      setError(authErrorMessage(caught instanceof Error ? caught.message : ""));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      await verifyEmailOtp(email.trim(), code);
    } catch (caught) {
      setError(authErrorMessage(caught instanceof Error ? caught.message : ""));
      setBusy(false);
    }
  };

  const backToChooser = () => {
    setError(null);
    setMode("main");
  };
  const backToEmail = () => {
    setCode("");
    setError(null);
    setMode("email");
  };

  return (
    <AuthShell
      variant={mode === "main" ? "main" : "email"}
      onBack={mode === "code" ? backToEmail : backToChooser}
      backDisabled={changingToCode}
      step={mode === "code" ? 3 : mode === "email" ? 2 : undefined}
    >
      {mode === "main" ? (
        <MainAuth
          busy={busy}
          busyProvider={busyProvider}
          error={error}
          signup={signup}
          onProvider={oauth}
          onEmail={() => {
            setError(null);
            setMode("email");
          }}
        />
      ) : (
        <EmailFlow
          mode={mode}
          email={email}
          code={code}
          busy={busy}
          changingToCode={changingToCode}
          error={error}
          resendCooldown={resendCooldown}
          onEmail={setEmail}
          onCode={setCode}
          onSubmit={verifyCode}
          onResend={sendCode}
          onChangeEmail={backToEmail}
        />
      )}
    </AuthShell>
  );
}

function MainAuth({
  busy,
  busyProvider,
  error,
  signup,
  onProvider,
  onEmail,
}: {
  busy: boolean;
  busyProvider: OAuthProvider | null;
  error: string | null;
  signup: Awaited<ReturnType<typeof getSignupState>>;
  onProvider: (provider: OAuthProvider) => void;
  onEmail: () => void;
}) {
  return (
    <div className="animate-rise">
      <div className="auth-providers mt-8 flex flex-col gap-2.5">
        <ProviderButton
          provider="google"
          busy={busy}
          active={busyProvider === "google"}
          onClick={onProvider}
        >
          <GoogleMark /> Continue with Google
        </ProviderButton>
        <ProviderButton
          provider="github"
          busy={busy}
          active={busyProvider === "github"}
          onClick={onProvider}
        >
          <Github className="h-4 w-4" /> Continue with GitHub
        </ProviderButton>
      </div>

      <div className="auth-divider my-5 flex items-center gap-4" aria-hidden="true">
        <span className="h-px flex-1 bg-hairline" />
        <span className="text-[12px] text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>

      <button
        type="button"
        onClick={onEmail}
        className="mx-auto block rounded-full px-4 py-2 text-[14px] font-medium underline-offset-4 transition-colors hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Continue with email
      </button>

      <AuthError message={error} />
      <Legal />

      {signup.reason === "full" ? (
        <div className="mt-7">
          <WaitlistPanel waitlistOpen={signup.waitlistOpen} />
        </div>
      ) : signup.reason === "closed" ? (
        <div className="mt-7">
          <SignupsClosedNote />
        </div>
      ) : null}
    </div>
  );
}

function ProviderButton({
  provider,
  busy,
  active,
  onClick,
  children,
}: {
  provider: OAuthProvider;
  busy: boolean;
  active: boolean;
  onClick: (provider: OAuthProvider) => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={active ? "w-full bg-surface disabled:!opacity-100" : "w-full bg-surface"}
      disabled={busy}
      onClick={() => onClick(provider)}
    >
      {active ? (
        <>
          <LogoLoader className="h-4 w-4" label={`Connecting to ${providerName(provider)}`} />{" "}
          Connecting to {providerName(provider)}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

function EmailFlow({
  mode,
  email,
  code,
  busy,
  changingToCode,
  error,
  resendCooldown,
  onEmail,
  onCode,
  onSubmit,
  onResend,
  onChangeEmail,
}: {
  mode: Exclude<Mode, "main">;
  email: string;
  code: string;
  busy: boolean;
  changingToCode: boolean;
  error: string | null;
  resendCooldown: number;
  onEmail: (email: string) => void;
  onCode: (code: string) => void;
  onSubmit: (event: FormEvent) => void;
  onResend: () => void;
  onChangeEmail: () => void;
}) {
  const showingCode = mode === "code" || changingToCode;
  const [signalState, setSignalState] = useState<
    "entering" | "idle" | "focused" | "typing" | "submitting"
  >("entering");
  const typingTimerRef = useRef<number | undefined>(undefined);

  // Enter animation -> idle
  useEffect(() => {
    if (mode === "email" && signalState === "entering") {
      const timer = window.setTimeout(() => setSignalState("idle"), 600);
      return () => window.clearTimeout(timer);
    }
    return;
  }, [mode, signalState]);

  // Return to idle after focus response
  useEffect(() => {
    if (signalState === "focused") {
      const timer = window.setTimeout(() => setSignalState("idle"), 250);
      return () => window.clearTimeout(timer);
    }
    return;
  }, [signalState]);

  // Return to idle after typing pauses
  useEffect(() => {
    if (signalState === "typing") {
      const timer = window.setTimeout(() => setSignalState("idle"), 1000);
      return () => window.clearTimeout(timer);
    }
    return;
  }, [signalState, email]);

  // Cleanup typing timer on unmount
  useEffect(() => {
    const timer = typingTimerRef.current;
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const visualClass = showingCode ? "code" : signalState;

  const handleEmailFocus = () => {
    if (busy || changingToCode || showingCode) return;
    setSignalState("focused");
  };

  const handleEmailBlur = () => {
    if (busy || changingToCode || showingCode) return;
    setSignalState("idle");
  };

  const handleEmailChange = (value: string) => {
    if (busy || changingToCode || showingCode) return;
    setSignalState("typing");
    onEmail(value);
  };

  const handleSendCode = async () => {
    if (busy || changingToCode || showingCode) return;
    setSignalState("submitting");
    await onResend();
  };

  return (
    <div className="animate-rise">
      <SignalCodeVisual state={visualClass} code={showingCode} className="hidden" />

      {mode === "email" ? (
        <div className={changingToCode ? "auth-email-panel-out" : undefined}>
          <h1 className="display mt-1 text-[clamp(1.5rem,6vw,1.75rem)] lg:text-[2.25rem]">
            Continue with email
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground lg:text-[14px]">
            Enter your email to receive a one-time code.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSendCode();
            }}
            className="mt-5"
            noValidate
          >
            <AuthField
              value={email}
              onChange={handleEmailChange}
              onFocus={handleEmailFocus}
              onBlur={handleEmailBlur}
            />
            <Button type="submit" className="mt-4 w-full disabled:!opacity-100" disabled={busy}>
              {busy ? (
                <>
                  <LogoLoader className="h-4 w-4" tone="current" label="Sending code" />
                  Sending code
                </>
              ) : (
                "Continue"
              )}
            </Button>
            <AuthError message={error} />
          </form>
        </div>
      ) : (
        <div className="auth-email-panel-in">
          <h1 className="display mt-1 text-[clamp(1.5rem,6vw,1.75rem)] lg:text-[2.25rem]">
            Check your email
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground lg:text-[14.5px]">
            We sent a code to:
            <br />
            <span className="text-foreground">{email}</span>
          </p>
          <form onSubmit={onSubmit} className="mt-8" noValidate>
            <label htmlFor="email-code" className="text-[13px] text-muted-foreground">
              Verification code
            </label>
            <input
              id="email-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(event) => onCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="mt-2 h-12 w-full rounded-full border border-input bg-surface px-5 text-center font-mono text-[18px] tracking-[0.35em] outline-none transition-colors focus:border-signal focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-describedby={error ? "auth-error" : undefined}
            />
            <Button type="submit" className="mt-5 w-full disabled:!opacity-100" disabled={busy}>
              {busy ? (
                <>
                  <LogoLoader className="h-4 w-4" tone="current" label="Checking code" />
                  Checking code
                </>
              ) : (
                "Continue"
              )}
            </Button>
            <AuthError message={error} />
          </form>
          <div className="mt-6 flex items-center justify-center gap-5 text-[12.5px] text-muted-foreground">
            <button
              type="button"
              onClick={onResend}
              disabled={busy || resendCooldown > 0}
              className="underline underline-offset-4 hover:text-foreground disabled:opacity-50"
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
            </button>
            <button
              type="button"
              onClick={onChangeEmail}
              disabled={busy}
              className="underline underline-offset-4 hover:text-foreground disabled:opacity-50"
            >
              Change email
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuthHero() {
  return (
    <>
      <h1 className="display text-[clamp(2.5rem,13vw,3.75rem)] lg:text-[clamp(3rem,4.5vw,4.5rem)]">
        Your world.
        <br />
        Briefed.
      </h1>
      <p className="auth-support mt-5 text-[15px] leading-relaxed text-muted-foreground">
        Follow what matters.
        <br />
        Skip what doesn&apos;t.
      </p>
    </>
  );
}

const AUTH_STEP_TOTAL = 3;

function AuthStepProgress({ step }: { step: number }) {
  return (
    <div className="hidden lg:mb-8 lg:flex lg:items-center lg:gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-hairline" />
      <span className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
        {String(step).padStart(2, "0")} / {String(AUTH_STEP_TOTAL).padStart(2, "0")}
      </span>
    </div>
  );
}

function SignalCodeVisual({
  state,
  code,
  className = "",
}: {
  state: string;
  code: boolean;
  className?: string;
}) {
  return (
    <div
      className={`auth-signal-visual ${code ? "is-code" : ""} ${state} ${className}`}
      aria-hidden="true"
    >
      <div className="auth-signal-marks">
        {Array.from({ length: 6 }, (_, index) => (
          <span
            key={index}
            className="auth-signal-mark"
            style={{ animationDelay: `${index * 50}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function BackButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mb-8 inline-flex h-9 w-9 items-center justify-center gap-2 rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:mb-8 lg:w-auto lg:px-3.5"
      aria-label="Back"
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="hidden text-[13px] font-medium lg:inline">Back</span>
    </button>
  );
}

function AuthField({
  value,
  onChange,
  onFocus,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <div>
      <label htmlFor="email" className="text-[13px] text-muted-foreground">
        Email address
      </label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="you@example.com"
        className="mt-2 h-11 w-full rounded-full border border-input bg-surface px-4 text-[16px] outline-none transition-colors placeholder:text-muted-foreground focus:border-signal focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:text-[14.5px]"
      />
    </div>
  );
}

function AuthError({ message }: { message: string | null }) {
  return message ? (
    <p
      id="auth-error"
      role="alert"
      className="mt-4 flex items-start gap-2 text-[12.5px] font-medium text-destructive"
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {message}
    </p>
  ) : null;
}

function Legal() {
  return (
    <p className="auth-legal mt-7 text-center text-[11.5px] leading-relaxed text-muted-foreground">
      By continuing, you agree to our
      <br />
      <Link
        to="/legal/$doc"
        params={{ doc: "terms" }}
        className="underline underline-offset-4 hover:text-foreground"
      >
        Terms
      </Link>{" "}
      and{" "}
      <Link
        to="/legal/$doc"
        params={{ doc: "privacy" }}
        className="underline underline-offset-4 hover:text-foreground"
      >
        Privacy Policy
      </Link>
      .
    </p>
  );
}

function AuthShell({
  children,
  variant = "main",
  onBack,
  backDisabled = false,
  step,
}: {
  children: React.ReactNode;
  variant?: "main" | "email";
  onBack?: () => void;
  backDisabled?: boolean;
  step?: number | undefined;
}) {
  return (
    <div className="auth-page flex min-h-dvh flex-col overflow-x-hidden bg-background">
      <header className="auth-header flex items-center justify-between px-5 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="auth-main flex flex-1 flex-col justify-center px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-11 sm:px-8 sm:pt-12 lg:flex-row lg:justify-normal lg:p-0">
        <div className="auth-visual hidden lg:block lg:w-1/2" aria-hidden="true">
          <div className="auth-visual-pan" />
          <div className="auth-visual-scrim" />
        </div>
        <div className="lg:flex lg:w-1/2 lg:items-center lg:justify-center lg:px-16 xl:px-24">
          <div
            className={
              variant === "main"
                ? "animate-rise mx-auto w-full max-w-sm lg:mx-0 lg:max-w-[420px]"
                : "-mt-24 mx-auto w-full max-w-[480px] lg:mx-0 lg:mt-0 lg:max-w-[420px]"
            }
          >
            {variant === "email" && onBack ? (
              <BackButton onClick={onBack} disabled={backDisabled} />
            ) : null}
            {variant === "main" ? (
              <AuthHero />
            ) : (
              <div className="mb-8 lg:mb-10">
                <AuthHero />
              </div>
            )}
            {variant === "email" && step ? <AuthStepProgress step={step} /> : null}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
