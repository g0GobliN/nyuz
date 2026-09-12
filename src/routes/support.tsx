import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail, MessageCircle, BookOpen, LifeBuoy } from "lucide-react";
import { Eyebrow, Section } from "@/components/kit";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import { getPublicSiteContent } from "@/lib/server/settings";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/support")({
  loader: () => getPublicSiteContent(),
  component: Support,
  head: () =>
    pageHead({
      path: "/support",
      title: "Support — nyuz",
      description:
        "Get help with nyuz. Find answers to common questions or contact our support team.",
    }),
});

const FAQ_ITEMS = [
  {
    q: "How do I change my delivery time?",
    a: "Go to Settings → Delivery in your dashboard to set when you want your briefing. You can choose a specific time or get it immediately when it's ready.",
  },
  {
    q: "Can I pause my briefing?",
    a: "Yes. In Settings → Delivery, you can pause all deliveries. Your briefing will resume when you turn it back on.",
  },
  {
    q: "How do I add or remove topics?",
    a: "Visit the Topics page in your dashboard. Add topics by name or pattern, and remove them by clicking the delete button next to any topic.",
  },
  {
    q: "Why did I get fewer stories today?",
    a: "nyuz only sends stories that match your topics and reach our relevance threshold. Quiet days are normal — we never pad briefings to make them look busy.",
  },
  {
    q: "How do I change my plan?",
    a: "Go to Billing in your dashboard to upgrade, downgrade, or cancel your subscription. Changes take effect from your next briefing.",
  },
  {
    q: "Can I get briefings in other languages?",
    a: "Yes. In Settings → Delivery, you can choose Japanese, Hindi, Nepali, Korean, or Simplified Chinese. These are translations of the English briefing.",
  },
  {
    q: "How do alerts work?",
    a: "Every plan includes important alerts, within its daily allowance. Configure them in Delivery settings.",
  },
];

function Support() {
  const content = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background">
      <SiteNav content={content} />
      <main>
        <section className="veil px-5 pb-10 pt-24 text-center sm:px-8 sm:pb-14 sm:pt-32">
          <div className="mx-auto w-full max-w-2xl">
            <Eyebrow>Support</Eyebrow>
            <h1 className="display mt-4 text-[clamp(1.875rem,7vw,4.25rem)] animate-rise">
              How can we help?
            </h1>
            <p className="mt-6 text-[16px] leading-relaxed text-muted-foreground">
              Find answers to common questions or get in touch with our team.
            </p>
          </div>
        </section>

        <Section className="border-t border-hairline">
          <div className="mx-auto w-full max-w-2xl">
            <h2 className="display text-3xl sm:text-4xl">Get help</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <Link
                to="/pricing"
                className="flex items-start gap-4 rounded-2xl border border-hairline bg-surface p-6 transition-colors hover:border-signal/40"
              >
                <BookOpen className="mt-1 h-5 w-5 shrink-0 text-signal" />
                <div>
                  <p className="text-[15px] font-medium">Pricing & plans</p>
                  <p className="mt-1 text-[13.5px] text-muted-foreground">
                    Compare plans and see what's included
                  </p>
                </div>
              </Link>

              <Link
                to="/how-it-works"
                className="flex items-start gap-4 rounded-2xl border border-hairline bg-surface p-6 transition-colors hover:border-signal/40"
              >
                <LifeBuoy className="mt-1 h-5 w-5 shrink-0 text-signal" />
                <div>
                  <p className="text-[15px] font-medium">How it works</p>
                  <p className="mt-1 text-[13.5px] text-muted-foreground">
                    Learn how nyuz keeps watch and filters what matters
                  </p>
                </div>
              </Link>

              <a
                href="mailto:contact@nyuz.app"
                className="flex items-start gap-4 rounded-2xl border border-hairline bg-surface p-6 transition-colors hover:border-signal/40"
              >
                <Mail className="mt-1 h-5 w-5 shrink-0 text-signal" />
                <div>
                  <p className="text-[15px] font-medium">Email support</p>
                  <p className="mt-1 text-[13.5px] text-muted-foreground">contact@nyuz.app</p>
                </div>
              </a>

              <Link
                to="/about"
                className="flex items-start gap-4 rounded-2xl border border-hairline bg-surface p-6 transition-colors hover:border-signal/40"
              >
                <MessageCircle className="mt-1 h-5 w-5 shrink-0 text-signal" />
                <div>
                  <p className="text-[15px] font-medium">About nyuz</p>
                  <p className="mt-1 text-[13.5px] text-muted-foreground">
                    Learn more about our mission and approach
                  </p>
                </div>
              </Link>
            </div>
          </div>
        </Section>

        <Section className="border-t border-hairline">
          <div className="mx-auto w-full max-w-2xl">
            <h2 className="display text-3xl sm:text-4xl">Common questions</h2>
            <div className="mt-10 space-y-px overflow-hidden rounded-3xl border border-hairline bg-[var(--hairline)]">
              {FAQ_ITEMS.map((item, i) => (
                <div key={item.q} className="bg-surface p-6">
                  <p className="text-[15.5px] font-medium">{item.q}</p>
                  <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </Section>

        <Section className="border-t border-hairline">
          <div className="mx-auto w-full max-w-2xl text-center">
            <h2 className="display text-3xl sm:text-4xl">Still need help?</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              Can't find what you're looking for? Our team is here to help.
            </p>
            <div className="mt-8">
              <a
                href="mailto:contact@nyuz.app"
                className="inline-flex h-12 items-center justify-center rounded-full bg-foreground px-8 text-[15px] font-medium text-background transition-opacity hover:opacity-90"
              >
                Contact support
              </a>
            </div>
            <p className="mt-4 text-[13px] text-muted-foreground">
              We typically respond within 24 hours on business days.
            </p>
          </div>
        </Section>
      </main>
      <SiteFooter content={content} />
    </div>
  );
}
