import { createFileRoute } from "@tanstack/react-router";
import { Section } from "@/components/kit";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import {
  MechanicsFaq,
  PipelineStages,
  SharedAnalysis,
  WorkedExample,
} from "@/components/landing/pipeline-explainer";
import { SourceTransparency, FinalCta } from "@/components/landing/closing";
import { getPublicSiteContent } from "@/lib/server/settings";
import { useReveal } from "@/lib/use-reveal";
import { pageHead } from "@/lib/seo";

// The loader is here for the chrome, not the body: the announcement strip and the
// blog link have to be identical on every marketing page, and they come from the
// console. The title and description stay hard-coded because they describe this
// page, not the site.
export const Route = createFileRoute("/how-it-works")({
  loader: () => getPublicSiteContent(),
  component: HowItWorks,
  head: () =>
    pageHead({
      path: "/how-it-works",
      title: "How nyuz works",
      description:
        "Sources are collected once, duplicates are merged into events, and only what matches your interests reaches your briefing.",
    }),
});

function HowItWorks() {
  const content = Route.useLoaderData();
  const ref = useReveal<HTMLDivElement>();

  return (
    <div ref={ref} className="min-h-screen bg-background">
      <SiteNav content={content} />
      <main>
        <section className="veil px-5 pb-12 pt-24 sm:px-8 sm:pb-16 sm:pt-32">
          <div className="mx-auto w-full max-w-6xl">
            <h1 className="display max-w-3xl text-[clamp(1.875rem,7vw,4.5rem)] animate-rise">
              Understand the event, not thirty copies of the same article.
            </h1>
            <p className="mt-7 max-w-lg text-[16.5px] leading-relaxed text-muted-foreground animate-rise [animation-delay:120ms]">
              nyuz keeps watch across supported sources on a schedule, groups coverage of the same
              event, and decides what deserves a place in your morning.
            </p>
          </div>
        </section>

        {/* This page's own content. It deliberately shares only two components
            with the home page — SourceTransparency, because attribution is a
            mechanical claim as much as a persuasive one, and FinalCta, because
            every marketing page needs a way out. Everything above them is
            written for a reader who has already decided the idea sounds good
            and now wants to know what actually happens. */}
        <Section className="reveal border-t border-hairline">
          <PipelineStages />
        </Section>

        <Section className="border-t border-hairline">
          <SharedAnalysis />
        </Section>

        <Section className="reveal border-t border-hairline">
          <WorkedExample />
        </Section>

        <Section className="border-t border-hairline">
          <MechanicsFaq />
        </Section>

        <Section className="border-t border-hairline">
          <SourceTransparency />
        </Section>

        <div className="border-t border-hairline">
          <FinalCta />
        </div>
      </main>
      <SiteFooter content={content} />
    </div>
  );
}
