import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/kit";
import { Logo } from "@/components/landing/nav";
import { LogoLoader } from "@/components/loading";
import { ThemeToggle } from "@/components/theme-toggle";
import { joinWaitlist } from "@/lib/server/access";
import { ACCESS_DEFAULT, type Access } from "@/lib/site-content";

/**
 * The two screens somebody sees when they cannot get in.
 *
 * Neither is a security boundary — the capacity gate is the trigger on
 * `auth.users` in `0038_access_control.sql`, and it refuses whether or not
 * these render. What these do is replace a database error nobody can act on
 * with something a person can actually do next.
 *
 * The address is deliberately not a `mailto:` on its own line by default: an
 * operator who has not opened the waitlist gets the address, and one who has
 * gets a form, because a form somebody fills in beats an email somebody means
 * to send later and does not.
 */

/** Where a turned-away visitor writes to. Matches ENTITY.mail.contact. */
const CONTACT = "contact@nyuz.app";

/**
 * Full-page maintenance notice.
 *
 * Rendered instead of the page rather than above it. A banner over a dashboard
 * whose every request is failing reads as a broken product; a page that says
 * plainly that it is closed reads as a decision somebody made.
 */
export function MaintenanceScreen({ access = ACCESS_DEFAULT }: { access?: Access }) {
  const message = access.maintenanceMessage.trim() || ACCESS_DEFAULT.maintenanceMessage;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="veil flex flex-1 items-center justify-center px-5 py-16 sm:px-8">
        <div className="w-full max-w-md text-center animate-rise">
          <h1 className="display text-[clamp(2.2rem,6vw,3.25rem)]">Back shortly.</h1>
          <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">{message}</p>
          <p className="mt-8 text-[13px] text-muted-foreground">
            Nothing is lost. Your briefings, topics and history are exactly where you left them.
          </p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Something urgent?{" "}
            <a
              href={`mailto:${CONTACT}`}
              className="text-foreground underline decoration-signal underline-offset-4"
            >
              {CONTACT}
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * The waitlist form, shown where "Create an account" would otherwise be.
 *
 * Always reports success, because `joinWaitlist` always does. Telling somebody
 * their address is already on the list would answer a question about a stranger
 * to anyone who asked.
 */
export function WaitlistPanel({ waitlistOpen }: { waitlistOpen: boolean }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!waitlistOpen) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface p-6 text-center">
        <p className="text-[14.5px] font-medium">nyuz is full at the moment.</p>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
          We keep the number of accounts small on purpose while the product settles. If you would
          like a place, write to us and say a little about what you would use it for.
        </p>
        <a
          href={`mailto:${CONTACT}?subject=nyuz%20access`}
          className="mt-5 inline-block text-[13.5px] text-foreground underline decoration-signal underline-offset-4"
        >
          {CONTACT}
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-signal/40 bg-surface p-6 text-center">
        <p className="text-[14.5px] font-medium">You&apos;re on the list.</p>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
          We will email you the moment a place opens. It goes in the order people arrived, and we
          will not write to you about anything else.
        </p>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await joinWaitlist({ data: { email: email.trim(), name: name.trim(), note: "" } });
    } catch {
      // Swallowed on purpose. The server function already logs and always
      // answers success; a network blip should not tell somebody their place
      // failed when it may well have landed.
    }
    setDone(true);
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-6">
      <p className="text-[14.5px] font-medium">nyuz is full at the moment.</p>
      <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
        We keep the number of accounts small on purpose while the product settles. Leave your
        address and we will write the moment a place opens.
      </p>

      <form onSubmit={submit} className="mt-5" noValidate>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (optional)"
          autoComplete="name"
          className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-[16px] outline-none transition-colors focus:border-signal md:text-[14px]"
        />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@work.com"
          autoComplete="email"
          className="mt-2.5 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-[16px] outline-none transition-colors focus:border-signal md:text-[14px]"
        />
        <Button type="submit" className="mt-3 w-full" disabled={busy || email.trim() === ""}>
          {busy ? (
            <>
              <LogoLoader className="h-4 w-4" tone="current" label="Joining" /> Joining
            </>
          ) : (
            "Join the waitlist"
          )}
        </Button>
      </form>

      <p className="mt-4 text-center text-[12px] text-muted-foreground">
        Already have an account? Sign in above. Or write to{" "}
        <a href={`mailto:${CONTACT}`} className="underline underline-offset-4">
          {CONTACT}
        </a>
        .
      </p>
    </div>
  );
}

/** Shown on the auth page when the operator has closed registration outright. */
export function SignupsClosedNote() {
  return (
    <p className="text-center text-[13px] text-muted-foreground">
      Registration is closed right now. Sign in if you already have an account, or{" "}
      <Link to="/" className="text-foreground underline underline-offset-4">
        read what nyuz does
      </Link>
      .
    </p>
  );
}
