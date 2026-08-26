import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Eyebrow, LinkButton, Section, buttonClass } from "@/components/kit";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import { DensityDial } from "@/components/density-dial";
import { getPublicSiteContent } from "@/lib/server/settings";
import { useReveal } from "@/lib/use-reveal";
import { cn } from "@/lib/utils";
import { DEFAULT_ANNUAL_PRICES, DEFAULT_PLAN_PRICES, formatUsd } from "@/lib/plans";

export const Route = createFileRoute("/pricing")({
  loader: () => getPublicSiteContent(),
  component: Pricing,
  head: () => ({
    meta: [
      { title: "Pricing — nyuz" },
      {
        name: "description",
        // Left as prose rather than interpolated from the loader: a search
        // snippet is cached for weeks, so a number in it goes stale in a place
        // nobody can see. The page body is where the live figures belong.
        content: "Start free. Paid plans from $7/month. Relevance, not quantity.",
      },
    ],
  }),
});

/**
 * Plan copy is hard-coded; the numbers are the Stripe catalogue in `plans.ts`.
 *
 * Feature lists are product decisions that need a deploy anyway — shipping
 * "WhatsApp delivery" as editable text would let someone promise a feature that
 * does not exist. Prices come from Stripe, not the console, so the page cannot
 * disagree with the invoice.
 */
type Plan = {
  name: string;
  /** Which price to read. Free has no key because its price is pinned to zero. */
  priceKey: "free" | "personal" | "pro";
  tagline: string;
  features: string[];
  cta: string;
  popular?: boolean;
};

const PLANS: Plan[] = [
  {
    name: "Free",
    priceKey: "free",
    tagline: "See whether a briefing changes your morning.",
    features: [
      "3 topics · prioritise any source",
      "Up to 18 stories per briefing",
      "Daily Flash briefing",
      "Email delivery",
      "7-day history",
    ],
    cta: "Start free",
  },
  {
    name: "Personal",
    priceKey: "personal",
    tagline: "A nyuz shaped around what you actually do.",
    features: [
      "15 topics · prioritise any source",
      "Up to 30 stories per briefing",
      "Pro-quality daily briefing",
      "Custom delivery time",
      "3 important alerts per week",
      "Custom instructions",
      "90-day history",
      "10 Ask AI questions per day",
    ],
    cta: "Start Personal",
    popular: true,
  },
  {
    name: "Pro",
    priceKey: "pro",
    tagline: "For people whose job is knowing first.",
    features: [
      "Unlimited topics · prioritise any source",
      "Up to 50 stories per briefing",
      "Pro-quality daily briefing",
      "Up to 10 configurable alerts per day",
      "1-year history",
      "15 Pro Ask AI questions per day",
    ],
    cta: "Start Pro",
  },
];

/**
 * Resolves one plan's monthly and annual figures out of the settings blob.
 *
 * Annual is optional in the product sense — zero means "we do not offer a year of
 * this" — so it comes back as null rather than 0, which would render as "$0 per
 * year" on a paid plan.
 */
function planPrice(key: Plan["priceKey"]): { monthly: number; annual: number | null } {
  if (key === "free") return { monthly: 0, annual: null };
  const monthly = DEFAULT_PLAN_PRICES[key];
  const annual = DEFAULT_ANNUAL_PRICES[key];
  return { monthly, annual };
}

/**
 * "Two months back" was hard-coded next to prices that gave three and a half.
 * Deriving the sentence from the numbers means the claim cannot drift away from
 * the charge, and an operator who sets an annual price with no saving in it gets
 * silence rather than a false discount.
 */
function annualCaption(): string | null {
  const savings = (["personal", "pro"] as const)
    .map((key) => {
      const { monthly, annual } = planPrice(key);
      if (monthly <= 0 || annual === null) return 0;
      return (monthly * 12 - annual) / monthly;
    })
    .filter((months) => months >= 0.5);

  if (savings.length === 0) return null;
  const least = Math.min(...savings);
  const rounded = Math.round(least * 10) / 10;
  const label = rounded === 1 ? "month" : "months";
  return `At least ${rounded} ${label} back on an annual plan.`;
}

const FAQ = [
  {
    q: "Is there an article limit?",
    a: "There is no monthly article quota. Each briefing has a maximum set by your plan and density: up to 18 on Free, 30 on Personal, or 50 on Pro. A quiet day can still be shorter.",
  },
  {
    q: "What happens on a quiet day?",
    a: "You get a short briefing, or none at all. We never pad a digest to make it look busy.",
  },
  {
    q: "Do you replace the original reporting?",
    a: "No. Every story lists the sources it was built from and links out to them. Summaries are generated and can be wrong.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes, at any time. Topic limits apply from the next briefing, and history stays for the retention window of the plan you are on.",
  },
];

function Pricing() {
  const content = Route.useLoaderData();
  const ref = useReveal<HTMLDivElement>();
  const caption = annualCaption();
  const [annual, setAnnual] = useState(false);

  return (
    <div ref={ref} className="min-h-screen bg-background">
      <SiteNav content={content} />
      <main>
        <section className="veil px-5 pb-14 pt-32 text-center sm:px-8">
          <div className="mx-auto w-full max-w-2xl">
            <h1 className="display text-[clamp(2.5rem,7vw,4.25rem)] animate-rise">
              Pay for relevance,
              <br />
              not volume.
            </h1>
            <p className="mt-6 text-[16px] leading-relaxed text-muted-foreground">
              Every plan watches the same internet. What changes is how precisely it is shaped
              around you.
            </p>

            <div className="mt-9 flex flex-col items-center gap-4">
              <div className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface p-1">
                {[
                  { k: false, label: "Monthly" },
                  { k: true, label: "Annual" },
                ].map((o) => (
                  <button
                    key={String(o.k)}
                    type="button"
                    onClick={() => setAnnual(o.k)}
                    className={cn(
                      "rounded-full px-3.5 py-1 text-[12.5px] transition-all duration-300",
                      annual === o.k
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {caption ? <p className="text-[13px] text-muted-foreground">{caption}</p> : null}
            </div>
          </div>
        </section>

        <Section className="pt-4">
          <div className="grid gap-5 lg:grid-cols-3">
            {PLANS.map((p, i) => {
              const { monthly, annual: yearly } = planPrice(p.priceKey);
              return (
                <div
                  key={p.name}
                  className={cn(
                    "reveal flex flex-col rounded-3xl border p-7 sm:p-8",
                    p.popular
                      ? "border-signal/40 bg-surface shadow-[var(--shadow-float)]"
                      : "border-hairline bg-surface",
                  )}
                  style={{ transitionDelay: `${i * 90}ms` }}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[15px] font-medium">{p.name}</p>
                    {p.popular ? (
                      <span className="rounded-full bg-signal/15 px-2.5 py-1 text-[11px] font-medium text-signal">
                        Most popular
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-6">
                    <div className="flex items-baseline gap-2">
                      <span className="display text-5xl tabular-nums">
                        {formatUsd(annual && yearly !== null ? yearly : monthly)}
                      </span>
                      <span className="text-[13px] text-muted-foreground">
                        {monthly === 0 ? "forever" : annual ? "per year" : "per month"}
                      </span>
                    </div>
                    {yearly !== null ? (
                      <p className="mt-2 text-[13px] tabular-nums text-muted-foreground">
                        {annual
                          ? `${formatUsd(monthly)} per month`
                          : `${formatUsd(yearly)} per year`}
                      </p>
                    ) : null}
                  </div>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                    {p.tagline}
                  </p>

                  <ul className="mt-7 space-y-2.5">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-[14px]">
                        <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-signal" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8 pt-2">
                    <Link
                      to="/onboarding"
                      className={cn(buttonClass(p.popular ? "primary" : "outline", "md"), "w-full")}
                    >
                      {p.cta}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-8 text-center text-[13px] text-muted-foreground">
            We do not limit how many stories you receive. The product is about relevance, not
            quantity.
          </p>
        </Section>

        <Section className="border-t border-hairline">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <Eyebrow>Briefing density</Eyebrow>
              <h2 className="display mt-3 text-4xl sm:text-5xl">
                How much noise
                <br />
                do you want?
              </h2>
              <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
                A more honest control than a monthly article quota. Move it and the threshold for
                what reaches you moves with it.
              </p>
            </div>
            <DensityDial />
          </div>
        </Section>

        <Section className="border-t border-hairline">
          <h2 className="display max-w-xl text-3xl sm:text-4xl">Questions worth answering.</h2>
          <div className="mt-10 grid gap-px overflow-hidden rounded-3xl border border-hairline bg-[var(--hairline)] sm:grid-cols-2">
            {FAQ.map((f, i) => (
              <div
                key={f.q}
                className="reveal bg-surface p-7"
                style={{ transitionDelay: `${i * 70}ms` }}
              >
                <p className="text-[15.5px] font-medium">{f.q}</p>
                <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 flex flex-col items-center gap-5 text-center">
            <p className="font-serif text-3xl">Your morning briefing, already waiting.</p>
            <LinkButton to="/onboarding" size="lg">
              Build my nyuz <ArrowRight className="h-4 w-4" />
            </LinkButton>
          </div>
        </Section>
      </main>
      <SiteFooter content={content} />
    </div>
  );
}
