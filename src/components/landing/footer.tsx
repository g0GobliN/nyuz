import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/landing/nav";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline px-5 py-14 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            nyuz summarises and links to original reporting. Summaries are generated and can be
            wrong — every story keeps its sources one tap away.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-10 text-[13px] sm:grid-cols-3">
          <div className="flex flex-col gap-2.5">
            <p className="font-medium">Product</p>
            <Link to="/how-it-works" className="text-muted-foreground hover:text-foreground">
              How it works
            </Link>
            <Link to="/pricing" className="text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            <Link to="/dashboard" className="text-muted-foreground hover:text-foreground">
              Dashboard
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            <p className="font-medium">Legal</p>
            <Link
              to="/legal/$doc"
              params={{ doc: "privacy" }}
              className="text-muted-foreground hover:text-foreground"
            >
              Privacy
            </Link>
            <Link
              to="/legal/$doc"
              params={{ doc: "terms" }}
              className="text-muted-foreground hover:text-foreground"
            >
              Terms
            </Link>
            <Link
              to="/legal/$doc"
              params={{ doc: "cookies" }}
              className="text-muted-foreground hover:text-foreground"
            >
              Cookie policy
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            <p className="font-medium">Company</p>
            <Link
              to="/legal/$doc"
              params={{ doc: "contact" }}
              className="text-muted-foreground hover:text-foreground"
            >
              Contact
            </Link>
            <Link to="/auth" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-12 w-full max-w-6xl text-[12px] text-muted-foreground">
        © {new Date().getFullYear()} nyuz. Less information. More relevance. Zero searching.
      </div>
    </footer>
  );
}
