import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/kit";
import { ThemeToggle } from "@/components/theme-toggle";

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={"flex items-center gap-2.5 " + (className ?? "")}>
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-foreground/25" />
        <span className="absolute inset-1.5 rounded-full border border-foreground/40" />
        <span className="h-1.5 w-1.5 rounded-full bg-signal" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">nyuz</span>
    </Link>
  );
}

const links = [
  { to: "/how-it-works", label: "How it works" },
  { to: "/pricing", label: "Pricing" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={
        "fixed inset-x-0 top-0 z-50 transition-all duration-500 " +
        (scrolled ? "glass border-b border-hairline" : "")
      }
    >
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Logo />
        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <Link
            to="/auth"
            className="px-3 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
          <LinkButton to="/onboarding" size="sm">
            Get started
          </LinkButton>
        </div>
        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <button
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>
      {open ? (
        <div className="glass border-b border-hairline px-5 pb-6 pt-2 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 text-[15px] hover:bg-muted"
              >
                {l.label}
              </Link>
            ))}
            <Link
              to="/auth"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-[15px] hover:bg-muted"
            >
              Sign in
            </Link>
            <LinkButton to="/onboarding" className="mt-2 w-full" onClick={() => setOpen(false)}>
              Build my radar
            </LinkButton>
          </div>
        </div>
      ) : null}
    </header>
  );
}
