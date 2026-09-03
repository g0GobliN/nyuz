import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "@/components/landing/nav";
import { PUBLIC_CONTENT_FALLBACK, type PublicSiteContent } from "@/lib/site-content";

const footerLink = "text-muted-foreground transition-colors hover:text-foreground";

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="font-medium">{title}</p>
      {children}
    </div>
  );
}

/**
 * The footer. Blurb and tagline come from the console; the link columns do not,
 * because a footer link that points at a route which does not exist is worse than
 * a footer nobody can edit.
 *
 * The one exception is the blog link, which appears only when the `blog` feature
 * flag is on — the route exists either way, but an empty index is not something to
 * advertise.
 */
export function SiteFooter({
  content = PUBLIC_CONTENT_FALLBACK,
}: {
  content?: PublicSiteContent | undefined;
}) {
  const blogOn = content.flags["blog"] === true;

  return (
    <footer className="border-t border-hairline px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            {content.footer.blurb}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-9 text-[13px] sm:grid-cols-4">
          <FooterColumn title="Product">
            <Link to="/how-it-works" className={footerLink}>
              How it works
            </Link>
            <Link to="/pricing" className={footerLink}>
              Pricing
            </Link>
            <Link to="/support" className={footerLink}>
              Support
            </Link>
            {blogOn ? (
              <Link to="/blog" className={footerLink}>
                Blog
              </Link>
            ) : null}
            <Link to="/dashboard" className={footerLink}>
              Dashboard
            </Link>
          </FooterColumn>

          {/* Trust and Legal are separate columns because they answer different
              questions. Somebody checking who sees their data before they sign
              up is not reading the refund policy, and burying Subprocessors at
              the bottom of a six-item legal list hides the page most worth
              finding. */}
          <FooterColumn title="Trust">
            <Link to="/legal/$doc" params={{ doc: "security" }} className={footerLink}>
              Security
            </Link>
            <Link to="/legal/$doc" params={{ doc: "subprocessors" }} className={footerLink}>
              Subprocessors
            </Link>
            <Link to="/legal/$doc" params={{ doc: "privacy" }} className={footerLink}>
              Privacy
            </Link>
          </FooterColumn>

          <FooterColumn title="Legal">
            <Link to="/legal/$doc" params={{ doc: "terms" }} className={footerLink}>
              Terms
            </Link>
            <Link to="/legal/$doc" params={{ doc: "acceptable-use" }} className={footerLink}>
              Acceptable use
            </Link>
            <Link to="/legal/$doc" params={{ doc: "refunds" }} className={footerLink}>
              Refunds
            </Link>
            <Link to="/legal/$doc" params={{ doc: "cookies" }} className={footerLink}>
              Cookie policy
            </Link>
          </FooterColumn>

          <FooterColumn title="Company">
            <Link to="/about" className={footerLink}>
              About
            </Link>
            <Link to="/auth" className={footerLink}>
              Sign in
            </Link>
          </FooterColumn>
        </div>
      </div>
      <div className="mx-auto mt-12 w-full max-w-6xl text-[12px] text-muted-foreground">
        {/* The year is computed, not editable: a stale copyright year is the one
            footer mistake every visitor notices. */}
        © {new Date().getFullYear()} nyuz. {content.footer.tagline}
      </div>
    </footer>
  );
}
