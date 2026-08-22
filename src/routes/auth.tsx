import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Lock, Mail, User as UserIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/kit";
import { Logo } from "@/components/landing/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  component: Auth,
  head: () => ({
    meta: [
      { title: "Sign in — nyuz" },
      { name: "description", content: "Sign in to your nyuz briefing." },
    ],
  }),
});

type Mode = "signin" | "signup";

function Auth() {
  const navigate = useNavigate();
  const { signIn, signUp, session, loading } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (or just became so) — nothing to do on this page.
  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Enter an email address we can reach you at.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        await signUp(email.trim(), password, name.trim());
      } else {
        await signIn(email.trim(), password);
      }
      // The auth listener flips `session`, and the effect above redirects.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
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
            {mode === "signin" ? "Welcome back." : "Build your radar."}
          </h1>
          <p className="mt-4 text-[14.5px] leading-relaxed text-muted-foreground">
            {mode === "signin"
              ? "Your briefing is where you left it."
              : "Free to start. No credit card required."}
          </p>

          <form onSubmit={submit} className="mt-8" noValidate>
            {mode === "signup" ? (
              <Field
                id="name"
                label="What should we call you?"
                icon={<UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                type="text"
                autoComplete="name"
                value={name}
                onChange={setName}
                placeholder="Vishal"
              />
            ) : null}

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

            <Field
              id="password"
              label="Password"
              icon={<Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(v) => {
                setPassword(v);
                if (error) setError(null);
              }}
              placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
              className="mt-4"
            />

            {error ? <p className="mt-3 text-[12.5px] text-destructive">{error}</p> : null}

            <Button type="submit" className="mt-6 w-full" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {mode === "signup" ? "Creating account" : "Signing in"}
                </>
              ) : mode === "signup" ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <p className="mt-7 text-center text-[13px] text-muted-foreground">
            {mode === "signin" ? "New here? " : "Already have an account? "}
            <button
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}
              className="text-foreground underline-offset-4 hover:underline"
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
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
          className="h-11 w-full bg-transparent text-[14.5px] outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
