import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Eyebrow, LinkButton, Section, buttonClass } from "@/components/kit";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import { DensityDial } from "@/components/density-dial";
import { useReveal } from "@/lib/use-reveal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pricing")({
  component: Pricing,
  head: () => ({
    meta: [
      { title: "Pricing — nyuz" },
      {
        name: "description",
        content: "Start free. Personal at $7/month, Pro at $15/month. Relevance, not quantity.",
      },
    ],
  }),
});

type Plan = {
  name: string;
  monthly: number;
  annual?: number;
  tagline: string;
  features: string[];
  cta: string;
  popular?: boolean;
};

const PLANS: Plan[] = [
  {
    name: "Free",
    monthly: 0,
    tagline: "See whether a briefing changes your morning.",
    features: ["3 topics", "Daily briefing", "Email delivery", "7-day history"],
    cta: "Start free",
  },
  {
    name: "Personal",
    monthly: 7,
    annual: 60,
    tagline: "A radar shaped around what you actually do.",
    features: [
      "15 topics",
      "Daily and weekly briefings",
      "Custom delivery time",
      "Telegram delivery",
      "Breaking alerts",
      "Custom instructions",
      "90-day history",
      "AI explanations",
    ],
    cta: "Start Personal",
    popular: true,
  },
  {
    name: "Pro",
    monthly: 15,
    annual: 120,
    tagline: "For people whose job is knowing first.",
    features: [
      "Unlimited topics",
      "Multiple schedules",
      "Breaking alerts",
      "WhatsApp delivery",
      "Advanced personalisation",
      "1-year history",
      "Deeper AI explanations",
      "Priority processing",
    ],
    cta: "Start Pro",
  },
];

const FAQ = [
  {
    q: "Why is there no article limit?",
    a: "A cap on articles rewards volume. This product is trying to do the opposite — some days the honest answer is that four things happened.",
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
  const [annual, setAnnual] = useState(false);
  const ref = useReveal<HTMLDivElement>();

  return (
    <div ref={ref} className="min-h-screen bg-background">
      <SiteNav />
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

            <div className="mt-9 inline-flex items-center gap-1 rounded-full border border-hairline bg-surface p-1">
              {[
                { k: false, label: "Monthly" },
                { k: true, label: "Annual" },
              ].map((o) => (
                <button
                  key={String(o.k)}
                  onClick={() => setAnnual(o.k)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-[13px] transition-all duration-300",
                    annual === o.k
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {annual ? (
              <p className="mt-3 text-[12px] text-muted-foreground">
                Two months back on Personal and Pro.
              </p>
            ) : null}
          </div>
        </section>

        <Section className="pt-4">
          <div className="grid gap-5 lg:grid-cols-3">
            {PLANS.map((p, i) => {
              const price =
                p.monthly === 0 ? "$0" : annual && p.annual ? `$${p.annual}` : `$${p.monthly}`;
              const period =
                p.monthly === 0 ? "forever" : annual && p.annual ? "per year" : "per month";
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

                  <div className="mt-6 flex items-baseline gap-2">
                    <span className="display text-5xl tabular-nums">{price}</span>
                    <span className="text-[13px] text-muted-foreground">{period}</span>
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
              Build my radar <ArrowRight className="h-4 w-4" />
            </LinkButton>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
