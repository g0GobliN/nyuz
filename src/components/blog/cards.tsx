import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { PublicPostCard } from "@/lib/server/blog";

/**
 * Presentation for blog listings, kept out of the route files so the index and a
 * future "related posts" block cannot drift apart, and so the date formatter has
 * one home.
 */

/**
 * Long month name, so "8 Mar 2026" never reads as a US date to a European or the
 * other way round. Pinned to en-GB rather than the visitor's locale because the
 * server renders this string too: `toLocaleDateString()` with no locale uses the
 * machine's, and a Worker in Frankfurt disagreeing with a browser in Chicago is a
 * hydration mismatch that only shows up in production.
 */
export function formatPostDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** Date, reading time and tags in one line, in the order a reader scans them. */
export function PostMeta({
  post,
  align = "left",
}: {
  post: Pick<PublicPostCard, "publishedAt" | "readingMinutes" | "tags">;
  align?: "left" | "right" | undefined;
}) {
  return (
    <p
      className={
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground " +
        (align === "right" ? "sm:justify-end" : "")
      }
    >
      {post.publishedAt ? (
        <>
          <time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt)}</time>
          <span aria-hidden="true">·</span>
        </>
      ) : null}
      <span>{post.readingMinutes} min</span>
      {post.tags.length > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="truncate">{post.tags.slice(0, 2).join(", ")}</span>
        </>
      ) : null}
    </p>
  );
}

export function FeaturedCard({ post }: { post: PublicPostCard }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      className="group block overflow-hidden rounded-3xl border border-hairline bg-surface transition-colors hover:border-foreground/20"
    >
      {post.coverUrl ? (
        // Aspect box first, image inside: the space is reserved before the bytes
        // arrive, so a lazy-loaded cover cannot shove the headline down the page.
        <div className="aspect-[16/7] w-full overflow-hidden bg-muted">
          <img
            src={post.coverUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}
      <div className="p-8 sm:p-10">
        <PostMeta post={post} />
        <h2 className="display mt-4 text-3xl sm:text-4xl">{post.title}</h2>
        {post.excerpt ? (
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            {post.excerpt}
          </p>
        ) : null}
        <span className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] text-signal">
          Read
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

export function PostRow({ post }: { post: PublicPostCard }) {
  return (
    <li>
      <Link
        to="/blog/$slug"
        params={{ slug: post.slug }}
        className="group flex flex-col gap-2 py-7 sm:flex-row sm:items-baseline sm:gap-8"
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-[17.5px] font-medium tracking-tight transition-colors group-hover:text-signal">
            {post.title}
          </h2>
          {post.excerpt ? (
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
              {post.excerpt}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 sm:w-[200px]">
          <PostMeta post={post} align="right" />
        </div>
      </Link>
    </li>
  );
}
