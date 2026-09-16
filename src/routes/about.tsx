import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail, MapPin } from "lucide-react";
import { Eyebrow, Section } from "@/components/kit";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import { getPublicSiteContent } from "@/lib/server/settings";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  loader: () => getPublicSiteContent(),
  component: About,
  head: () =>
    pageHead({
      path: "/about",
      title: "About — nyuz",
      description:
        "nyuz keeps watch across relevant sources, connects duplicate coverage into events, filters the noise, and delivers a personalized briefing.",
    }),
});

function About() {
  const content = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background">
      <SiteNav content={content} />
      <main>
        <section className="veil px-5 pb-10 pt-24 text-center sm:px-8 sm:pb-14 sm:pt-32">
          <div className="mx-auto w-full max-w-2xl">
            <Eyebrow>About</Eyebrow>
            <h1 className="display mt-4 text-[clamp(1.875rem,7vw,4.25rem)] animate-rise">
              Stop searching.
              <br />
              Start knowing.
            </h1>
            <p className="mt-6 text-[16px] leading-relaxed text-muted-foreground">
              Tell nyuz what matters. It keeps watch across relevant sources, connects duplicate
              coverage into events, and sends you the handful of things worth knowing.
            </p>
          </div>
        </section>

        <Section className="border-t border-hairline">
          <div className="mx-auto w-full max-w-2xl">
            <h2 className="display text-3xl sm:text-4xl">What we do</h2>
            <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                The internet publishes more every minute than anyone can read. nyuz keeps watch
                across relevant publications and feeds, connects related coverage into events, and
                surfaces what actually changed.
              </p>
              <p>
                You tell us what you care about — topics like "AI regulation", "climate policy", or
                "your competitors". We watch the sources, filter the noise, and deliver a briefing
                that arrives before you reach for your phone.
              </p>
              <p>
                Every story links to its original reporting. We don't replace journalism; we make it
                manageable.
              </p>
            </div>
          </div>
        </Section>

        <Section className="border-t border-hairline">
          <div className="mx-auto w-full max-w-2xl">
            <h2 className="display text-3xl sm:text-4xl">How it works</h2>
            <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">1. You choose your topics.</strong> Tell us what
                matters to you — industries, regions, companies, or any pattern you want to follow.
              </p>
              <p>
                <strong className="text-foreground">2. We watch the sources.</strong> nyuz monitors
                newsrooms, blogs, research, sports, music, and other supported feeds on their own
                schedules — including sources readers add.
              </p>
              <p>
                <strong className="text-foreground">3. Coverage becomes useful.</strong> Our system
                groups closely related reports, ranks events, and selects concise source
                descriptions. Deeper shared coverage can be prepared when you open a story.
              </p>
              <p>
                <strong className="text-foreground">4. You get a briefing.</strong> Receive your
                personalized digest via email, Telegram, or browser notifications — on your
                schedule.
              </p>
            </div>
          </div>
        </Section>

        <Section className="border-t border-hairline">
          <div className="mx-auto w-full max-w-2xl">
            <h2 className="display text-3xl sm:text-4xl">Contact us</h2>
            <div className="mt-8 space-y-6">
              <div className="flex items-start gap-4">
                <Mail className="mt-1 h-5 w-5 shrink-0 text-signal" />
                <div>
                  <p className="text-[15px] font-medium">Email</p>
                  <p className="mt-1 text-[14px] text-muted-foreground">
                    <a
                      href="mailto:contact@nyuz.app"
                      className="text-foreground underline decoration-signal underline-offset-4"
                    >
                      contact@nyuz.app
                    </a>
                  </p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    For questions, feedback, or support requests.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <MapPin className="mt-1 h-5 w-5 shrink-0 text-signal" />
                <div>
                  <p className="text-[15px] font-medium">Location</p>
                  <p className="mt-1 text-[14px] text-muted-foreground">
                    Matsudo, Chiba, 〒270-0004, Japan
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-10 rounded-2xl border border-hairline bg-surface p-6">
              <p className="text-[14.5px] font-medium">Quick links</p>
              <div className="mt-4 flex flex-col gap-3 text-[14px]">
                <Link
                  to="/legal/$doc"
                  params={{ doc: "privacy" }}
                  className="text-foreground underline decoration-signal underline-offset-4"
                >
                  Privacy Policy
                </Link>
                <Link
                  to="/legal/$doc"
                  params={{ doc: "terms" }}
                  className="text-foreground underline decoration-signal underline-offset-4"
                >
                  Terms of Service
                </Link>
                <Link
                  to="/legal/$doc"
                  params={{ doc: "security" }}
                  className="text-foreground underline decoration-signal underline-offset-4"
                >
                  Security
                </Link>
                <Link
                  to="/pricing"
                  className="text-foreground underline decoration-signal underline-offset-4"
                >
                  Pricing
                </Link>
              </div>
            </div>
          </div>
        </Section>
      </main>
      <SiteFooter content={content} />
    </div>
  );
}
