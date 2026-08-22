import { createFileRoute } from "@tanstack/react-router";
import { Section } from "@/components/kit";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import { HowItWorksRail, Comparison } from "@/components/landing/how-it-works";
import { AiTrust, Infrastructure, WhyDifferent } from "@/components/landing/sections";
import { SourceTransparency, FinalCta } from "@/components/landing/closing";
import { NoiseSection } from "@/components/landing/noise";
import { useReveal } from "@/lib/use-reveal";

export const Route = createFileRoute("/how-it-works")({
  component: HowItWorks,
  head: () => ({
    meta: [
      { title: "How nyuz works" },
      {
        name: "description",
        content:
          "Sources are collected once, duplicates are merged into events, and only what matches your interests reaches your briefing.",
      },
    ],
  }),
});

function HowItWorks() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <div ref={ref} className="min-h-screen bg-background">
      <SiteNav />
      <main>
        <section className="veil px-5 pb-16 pt-32 sm:px-8">
          <div className="mx-auto w-full max-w-6xl">
            <h1 className="display max-w-3xl text-[clamp(2.5rem,7vw,4.5rem)] animate-rise">
              Understand the event, not thirty copies of the same article.
            </h1>
            <p className="mt-7 max-w-lg text-[16.5px] leading-relaxed text-muted-foreground animate-rise [animation-delay:120ms]">
              nyuz reads the internet on a schedule, groups the reporting that describes the same
              thing, and decides what deserves a place in your morning.
            </p>
          </div>
        </section>

        <Section className="reveal border-t border-hairline">
          <HowItWorksRail />
        </Section>

        <Section className="border-t border-hairline">
          <NoiseSection />
        </Section>

        <Section className="border-t border-hairline">
          <Comparison />
        </Section>

        <Section className="border-t border-hairline">
          <AiTrust />
        </Section>

        <Section className="border-t border-hairline">
          <Infrastructure />
        </Section>

        <Section className="reveal border-t border-hairline">
          <WhyDifferent />
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
