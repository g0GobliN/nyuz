import { PLAN_CARDS } from "@/lib/plan-copy";
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
import { DEFAULT_ANNUAL_PRICES, DEFAULT_PLAN_PRICES, PLAN_LIMITS, formatUsd } from "@/lib/plans";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/pricing")({
  loader: () => getPublicSiteContent(),
  component: Pricing,
  head: () =>
    pageHead({
      path: "/pricing",
      title: "Pricing — nyuz",
      // Left as prose rather than interpolated from the loader: a search
      // snippet is cached for weeks, so a number in it goes stale in a place
      // nobody can see. The page body is where the live figures belong.
      description: `Start free. Paid plans from ${formatUsd(DEFAULT_PLAN_PRICES.plura)}/month. Relevance, not quantity.`,
    }),
});

/** Pricing and billing share feature copy generated from the canonical plan limits. */
type Plan = {
  name: string;
  /** Which price to read. Uno has no key because its price is pinned to zero. */
  priceKey: "uno" | "plura" | "omni";
  tagline: string;
  features: string[];
  cta: string;
  popular?: boolean;
};

const PLANS: Plan[] = PLAN_CARDS;

/**
 * Resolves one plan's monthly and annual figures out of the settings blob.
 *
 * Annual is optional in the product sense — zero means "we do not offer a year of
 * this" — so it comes back as null rather than 0, which would render as "$0 per
 * year" on a paid plan.
 */
function planPrice(key: Plan["priceKey"]): { monthly: number; annual: number | null } {
  if (key === "uno") return { monthly: 0, annual: null };
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
  const savings = (["plura", "omni"] as const)
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
    a: `There is no monthly article quota. Each briefing has a maximum set by your plan and density: up to ${PLAN_LIMITS.uno.storiesPerBriefing} on Uno, ${PLAN_LIMITS.plura.storiesPerBriefing} on Plura, or ${PLAN_LIMITS.omni.storiesPerBriefing} on Omni. A quiet day can still be shorter.`,
  },
  {
    q: "What happens on a quiet day?",
    a: "You get a short briefing, or none at all. We never pad a digest to make it look busy.",
  },
  {
    q: "Do you replace the original reporting?",
    a: "No. Every story links to its sources. Cards use source descriptions; deeper shared coverage may be generated on request and can be wrong.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes, at any time. Topic limits apply from the next briefing, and history stays for the retention window of the plan you are on.",
  },
  {
    q: "What are “sources of your own”?",
    a: `Feeds nyuz isn't watching yet that you'd like it to — your local paper, a niche blog, a company's own updates. Plura includes ${PLAN_LIMITS.plura.customSources} and Omni ${PLAN_LIMITS.omni.customSources}. If another reader has already asked for the same one, you simply share it.`,
  },
  {
    q: "What does upgrading actually get me?",
    a: "Reach and precision, not more words. More topics, more of your own sources, a bigger cap on a busy day, alerts outside your usual time, and a longer history to look back through.",
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
        <section className="veil px-5 pb-10 pt-24 text-center sm:px-8 sm:pb-14 sm:pt-32">
          <div className="mx-auto w-full max-w-2xl">
            <h1 className="display text-[clamp(1.875rem,7vw,4.25rem)] animate-rise">
              Pay for relevance,
              <br />
              not volume.
            </h1>
            <p className="mt-6 text-[16px] leading-relaxed text-muted-foreground">
              Every plan starts with the same core sources. What changes is how precisely it is
              shaped around you.
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
                          ? `${formatUsd(yearly / 12)} per month equivalent, billed annually`
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
            Story limits are ceilings. Briefings stay shorter when fewer fresh, relevant stories
            qualify.
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
                // An odd count would leave the final cell empty, and an empty
                // cell in a gap-px grid is a bare block of hairline colour
                // rather than nothing. Same treatment as `WhyDifferent`.
                className={cn(
                  "reveal bg-surface p-7",
                  i === FAQ.length - 1 && FAQ.length % 2 === 1 && "sm:col-span-2",
                )}
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
