import { createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Eyebrow, LinkButton } from "@/components/kit";
import { FeaturedCard, PostRow } from "@/components/blog/cards";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import { getPublicPosts } from "@/lib/server/blog";
import { getPublicSiteContent } from "@/lib/server/settings";
import { pageHead } from "@/lib/seo";

/**
 * The public blog index.
 *
 * Gated on the `blog` feature flag, and the gate is a 404 rather than a hidden
 * link: an unlisted page is still a public page, and a half-finished blog anybody
 * can reach by guessing the URL is exactly what the flag exists to prevent.
 * Flipping the flag reveals the nav link and the route together, so the two cannot
 * disagree.
 *
 * Posts are fetched in the loader, not with React Query, because this page is
 * meant to be indexed: a crawler has to find the posts in the server-rendered
 * HTML rather than a spinner.
 */
export const Route = createFileRoute("/blog/")({
  loader: async () => {
    const content = await getPublicSiteContent();
    if (content.flags["blog"] !== true) throw notFound();
    const posts = await getPublicPosts({ data: { limit: 24 } });
    return { content, posts };
  },
  head: () =>
    pageHead({
      path: "/blog",
      title: "Blog — nyuz",
      description:
        "Notes on reading the internet at scale: deduplication, personalisation, model cost, and what a briefing should and should not decide for you.",
    }),
  component: BlogIndex,
});

function BlogIndex() {
  const { content, posts } = Route.useLoaderData();

  // Featured posts pin to the top. The server already returns newest first, and
  // filtering preserves order, so each group stays chronological.
  const featured = posts.filter((p) => p.featured);
  const rest = posts.filter((p) => !p.featured);

  return (
    <div className="min-h-screen bg-background">
      <SiteNav content={content} />
      <main className="px-5 pb-16 pt-24 sm:px-8 sm:pb-24 sm:pt-32">
        <div className="mx-auto w-full max-w-5xl">
          <header className="animate-rise max-w-2xl">
            <Eyebrow>Writing</Eyebrow>
            <h1 className="display mt-3 text-[clamp(1.75rem,6vw,3.75rem)]">
              Notes from the pipeline.
            </h1>
            <p className="mt-6 text-[16px] leading-relaxed text-muted-foreground">
              How we decide what counts as one event, what the models are allowed to conclude, and
              why sending less is harder than sending more.
            </p>
          </header>

          {posts.length === 0 ? (
            <div className="mt-16 rounded-3xl border border-hairline bg-surface p-10 text-center">
              <p className="font-serif text-xl">Nothing published yet.</p>
              <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-muted-foreground">
                The first post is being written. In the meantime, the product itself is the better
                explanation.
              </p>
              <div className="mt-7">
                <LinkButton to="/onboarding">
                  Build my nyuz <ArrowRight className="h-4 w-4" />
                </LinkButton>
              </div>
            </div>
          ) : (
            <>
              {featured.length > 0 ? (
                <div className="mt-16 space-y-5">
                  {featured.map((post) => (
                    <FeaturedCard key={post.slug} post={post} />
                  ))}
                </div>
              ) : null}

              {rest.length > 0 ? (
                <ul className="mt-14 divide-y divide-[var(--hairline)] border-t border-hairline">
                  {rest.map((post) => (
                    <PostRow key={post.slug} post={post} />
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </main>
      <SiteFooter content={content} />
    </div>
  );
}
