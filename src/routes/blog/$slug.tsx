import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { LinkButton } from "@/components/kit";
import { PostMeta, PostRow } from "@/components/blog/cards";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import { getPublicPost, getPublicPosts } from "@/lib/server/blog";
import { getPublicSiteContent } from "@/lib/server/settings";
import { Markdown, stripMarkdown } from "@/lib/markdown";
import { canonicalUrlFor } from "@/lib/seo";

/**
 * A single post.
 *
 * The body is Markdown rendered to React nodes by src/lib/markdown.tsx — never
 * `innerHTML`. That is what makes it safe for an admin to paste arbitrary text
 * into the editor: a `<script>` tag in a post renders as the characters
 * `<script>`, on a page served from the same origin as the dashboard.
 *
 * The flag check runs first and 404s, matching the index. A published post behind
 * a disabled flag is not reachable by URL either.
 */
export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params }) => {
    const content = await getPublicSiteContent();
    if (content.flags["blog"] !== true) throw notFound();

    const post = await getPublicPost({ data: { slug: params.slug } });
    if (!post) throw notFound();

    // Fetched after the post so a draft URL still 404s without a second query.
    // A failure here would take the article down with it, which is the wrong
    // trade for a footer list, so it degrades to nothing.
    const more = await getPublicPosts({ data: { limit: 4 } }).catch(() => []);

    return { content, post, more: more.filter((p) => p.slug !== post.slug).slice(0, 3) };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [] };
    const { post } = loaderData;
    const title = post.seoTitle || post.title;
    // The excerpt is optional and the body is not, so a post with no excerpt
    // still gets a real description rather than an empty one.
    const description = post.seoDescription || post.excerpt || stripMarkdown(post.bodyMd, 160);
    return {
      meta: [
        { title: `${title} — nyuz` },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        ...(post.coverUrl
          ? [
              { property: "og:image", content: post.coverUrl },
              { name: "twitter:image", content: post.coverUrl },
            ]
          : []),
        ...(post.publishedAt
          ? [{ property: "article:published_time", content: post.publishedAt }]
          : []),
        { property: "og:url", content: canonicalUrlFor(`/blog/${post.slug}`) },
      ],
      // A post is reachable with campaign query strings from every share of it,
      // so the canonical is what keeps those collapsing onto one indexed URL.
      links: [{ rel: "canonical", href: canonicalUrlFor(`/blog/${post.slug}`) }],
    };
  },
  component: BlogPost,
});

function BlogPost() {
  const { content, post, more } = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background">
      <SiteNav content={content} />

      <main className="px-5 pb-16 pt-24 sm:px-8 sm:pb-24 sm:pt-32">
        <article className="mx-auto w-full max-w-2xl">
          <Link
            to="/blog"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All writing
          </Link>

          <header className="mt-8 animate-rise">
            <h1 className="display text-[clamp(1.625rem,5.5vw,3.25rem)]">{post.title}</h1>
            {post.excerpt ? (
              <p className="mt-5 font-serif text-xl leading-relaxed text-muted-foreground">
                {post.excerpt}
              </p>
            ) : null}
            <div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-5">
              <span className="text-[13px]">{post.authorName}</span>
              <PostMeta post={post} />
            </div>
          </header>

          {post.coverUrl ? (
            <div className="mt-10 aspect-[16/9] w-full overflow-hidden rounded-2xl border border-hairline bg-muted">
              <img
                src={post.coverUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}

          <div className="mt-12">
            <Markdown source={post.bodyMd} />
          </div>

          {post.tags.length > 0 ? (
            <div className="mt-14 flex flex-wrap gap-2 border-t border-hairline pt-7">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-hairline bg-surface px-3 py-1 text-[12px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          <aside className="mt-16 rounded-3xl border border-hairline bg-surface p-8 text-center sm:p-10">
            <p className="font-serif text-2xl">Stop searching. Start knowing.</p>
            <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-muted-foreground">
              Pick your topics once. We watch the sources and send only what changed.
            </p>
            <div className="mt-7">
              <LinkButton to="/onboarding">
                Build my nyuz <ArrowRight className="h-4 w-4" />
              </LinkButton>
            </div>
          </aside>
        </article>

        {more.length > 0 ? (
          <div className="mx-auto mt-20 w-full max-w-2xl">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Keep reading
            </h2>
            <ul className="mt-2 divide-y divide-[var(--hairline)] border-t border-hairline">
              {more.map((p) => (
                <PostRow key={p.slug} post={p} />
              ))}
            </ul>
          </div>
        ) : null}
      </main>

      <SiteFooter content={content} />
    </div>
  );
}
