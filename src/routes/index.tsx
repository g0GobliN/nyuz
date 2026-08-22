import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { LinkButton, Section } from "@/components/kit";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import { HeroPipeline, InterestDemo } from "@/components/landing/hero";
import { NoiseSection } from "@/components/landing/noise";
import { HowItWorksRail, Comparison } from "@/components/landing/how-it-works";
import { ProfileDemo, WhyDifferent, AiTrust, Infrastructure } from "@/components/landing/sections";
import { SourceTransparency, FinalCta } from "@/components/landing/closing";
import { useReveal } from "@/lib/use-reveal";

// No head() here: the home route inherits title/description/og/twitter from
// __root.tsx, and ships no og:image so serve-time hosting can inject the
// project's social preview (explicit og:image or latest screenshot).
export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <div ref={ref} className="min-h-screen bg-background">
      <SiteNav />

      <main>
        {/* Hero */}
        <section className="veil relative px-5 pb-20 pt-28 sm:px-8 sm:pt-32">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="animate-rise">
              <h1 className="display text-[clamp(2.75rem,8vw,5rem)]">
                Stop searching.
                <br />
                Start knowing.
              </h1>
              <p className="mt-7 max-w-md text-[16.5px] leading-relaxed text-muted-foreground">
                Tell us what matters to you. We watch the internet and deliver the things worth
                knowing.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <LinkButton to="/onboarding" size="lg">
                  Build my radar <ArrowRight className="h-4 w-4" />
                </LinkButton>
                <Link
                  to="/how-it-works"
                  className="px-2 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  See how it works
                </Link>
              </div>
              <p className="mt-8 text-[12.5px] text-muted-foreground">
                327 sources monitored · duplicates merged · one briefing
              </p>
            </div>

            <div className="animate-rise [animation-delay:180ms]">
              <HeroPipeline />
            </div>
          </div>
        </section>

        <Section className="reveal">
          <InterestDemo />
        </Section>

        <Section className="border-t border-hairline">
          <NoiseSection />
        </Section>

        <Section className="reveal border-t border-hairline">
          <HowItWorksRail />
        </Section>

        <Section className="border-t border-hairline">
          <Comparison />
        </Section>

        <Section className="border-t border-hairline">
          <ProfileDemo />
        </Section>

        <Section className="reveal border-t border-hairline">
          <WhyDifferent />
        </Section>

        <Section className="border-t border-hairline">
          <AiTrust />
        </Section>

        <Section className="border-t border-hairline">
          <Infrastructure />
        </Section>

        <Section className="border-t border-hairline">
          <SourceTransparency />
        </Section>

        <div className="border-t border-hairline">
          <FinalCta />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
