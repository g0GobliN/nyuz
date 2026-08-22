import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, Github, Loader2, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/kit";
import { Logo } from "@/components/landing/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { useRadar } from "@/lib/radar-store";

export const Route = createFileRoute("/auth")({
  component: Auth,
  head: () => ({
    meta: [
      { title: "Sign in — nyuz" },
      { name: "description", content: "Sign in to your nyuz briefing." },
    ],
  }),
});

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

type Mode = "signin" | "signup";

function Auth() {
  const navigate = useNavigate();
  const { prefs, update } = useRadar();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setError("Enter an email address we can reach you at.");
      return;
    }
    setError(null);
    setState("sending");
    // Stand-in for the magic-link request. Wire to the auth provider here.
    setTimeout(() => setState("sent"), 900);
  };

  const continueAsDemo = () => {
    update({ onboarded: true });
    navigate({ to: prefs.onboarded ? "/dashboard" : "/onboarding" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="veil flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm animate-rise">
          {state === "sent" ? (
            <div className="text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-signal/40">
                <Check className="h-5 w-5 text-signal" />
              </span>
              <h1 className="display mt-6 text-3xl">Check your inbox.</h1>
              <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
                We sent a sign-in link to <span className="text-foreground">{email}</span>. It works
                once and expires in 15 minutes.
              </p>
              <button
                onClick={() => setState("idle")}
                className="mt-7 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Use a different address
              </button>
              <div className="mt-10 border-t border-hairline pt-6">
                <Button variant="outline" className="w-full" onClick={continueAsDemo}>
                  Explore the demo dashboard <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="display text-4xl">
                {mode === "signin" ? "Welcome back." : "Build your radar."}
              </h1>
              <p className="mt-4 text-[14.5px] leading-relaxed text-muted-foreground">
                {mode === "signin"
                  ? "Your briefing is where you left it."
                  : "Free to start. No credit card required."}
              </p>

              <div className="mt-8 flex flex-col gap-2.5">
                <Button variant="outline" className="w-full" onClick={continueAsDemo}>
                  <GoogleMark /> Continue with Google
                </Button>
                <Button variant="outline" className="w-full" onClick={continueAsDemo}>
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

              <form onSubmit={submit} noValidate>
                <label htmlFor="email" className="text-[13px] text-muted-foreground">
                  Email address
                </label>
                <div className="mt-2 flex items-center gap-2.5 rounded-full border border-input bg-surface px-4 focus-within:border-signal">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="you@work.com"
                    className="h-11 w-full bg-transparent text-[14.5px] outline-none placeholder:text-muted-foreground"
                  />
                </div>
                {error ? <p className="mt-2 text-[12.5px] text-destructive">{error}</p> : null}

                <Button type="submit" className="mt-4 w-full" disabled={state === "sending"}>
                  {state === "sending" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending link
                    </>
                  ) : (
                    <>Send me a sign-in link</>
                  )}
                </Button>
              </form>

              <p className="mt-7 text-center text-[13px] text-muted-foreground">
                {mode === "signin" ? "New here? " : "Already have an account? "}
                <button
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  {mode === "signin" ? "Create an account" : "Sign in"}
                </button>
              </p>
            </>
          )}

          <p className="mt-10 text-center text-[11.5px] leading-relaxed text-muted-foreground">
            By continuing you agree to our{" "}
            <Link to="/legal/$doc" params={{ doc: "terms" }} className="underline-offset-4 hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link to="/legal/$doc" params={{ doc: "privacy" }} className="underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
