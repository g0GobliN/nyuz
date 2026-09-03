import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminOnly, audit, AdminAuthError } from "@/lib/server/guard";
import { withViewerIp } from "@/lib/server/rate-limit";
import { shouldCountView } from "@/lib/rate-limit-core";
import type { BlogPost, PostStatus } from "@/lib/supabase/types";

/**
 * The blog.
 *
 * Public reads and admin writes live in one file because they share the row
 * shape, but they are two different trust levels:
 *
 *   - Public reads run with NO middleware and return only live posts, filtered
 *     explicitly here rather than relying on RLS. That means the same query is
 *     safe whether it runs on the anon key or the service key, and SSR does not
 *     depend on a browser session existing.
 *   - Admin reads and every write run behind `adminOnly`.
 *
 * Bodies are stored and returned as Markdown, never HTML. The public page
 * renders them through the safe renderer in src/lib/markdown.tsx, which emits
 * React nodes and never sets innerHTML, so an admin cannot inject script into
 * the marketing site even by pasting a <script> tag into a post.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      // Strip combining marks left behind by NFKD so "Café" slugs as "cafe"
      // rather than "caf-".
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
  );
}

/** ~200 words per minute, floor of one. Denormalised onto the row on save. */
function readingMinutes(bodyMd: string): number {
  const words = bodyMd.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/* ---------------------------------------------------------------------- */
/* Public                                                                 */
/* ---------------------------------------------------------------------- */

export type PublicPostCard = {
  slug: string;
  title: string;
  excerpt: string;
  coverUrl: string | null;
  tags: string[];
  authorName: string;
  readingMinutes: number;
  publishedAt: string | null;
  featured: boolean;
};

function toCard(
  row: Pick<
    BlogPost,
    | "slug"
    | "title"
    | "excerpt"
    | "cover_url"
    | "tags"
    | "author_name"
    | "reading_minutes"
    | "published_at"
    | "featured"
  >,
): PublicPostCard {
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    coverUrl: row.cover_url,
    tags: row.tags,
    authorName: row.author_name,
    readingMinutes: row.reading_minutes,
    publishedAt: row.published_at,
    featured: row.featured,
  };
}

const CARD_COLUMNS =
  "slug, title, excerpt, cover_url, tags, author_name, reading_minutes, published_at, featured";

export const getPublicPosts = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z
      .object({
        tag: z.string().max(50).optional(),
        limit: z.number().int().min(1).max(50).optional().default(24),
        featuredOnly: z.boolean().optional().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<PublicPostCard[]> => {
    const db = createAdminClient();
    let query = db
      .from("blog_posts")
      .select(CARD_COLUMNS)
      .eq("status", "published")
      .not("published_at", "is", null)
      .lte("published_at", new Date().toISOString());

    if (data.tag) query = query.contains("tags", [data.tag]);
    if (data.featuredOnly) query = query.eq("featured", true);

    const { data: rows, error } = await query
      .order("published_at", { ascending: false })
      .limit(data.limit);

    if (error) throw new AdminAuthError(`Posts: ${error.message}`, 500);
    return (rows ?? []).map(toCard);
  });

export type PublicPost = PublicPostCard & {
  bodyMd: string;
  seoTitle: string;
  seoDescription: string;
  viewCount: number;
};

export const getPublicPost = createServerFn({ method: "GET" })
  .middleware([withViewerIp])
  .validator((input: unknown) => parseInput(z.object({ slug: z.string().max(90) }), input))
  .handler(async ({ data, context }): Promise<PublicPost | null> => {
    const db = createAdminClient();
    const { data: row, error } = await db
      .from("blog_posts")
      .select("*")
      .eq("slug", data.slug)
      .eq("status", "published")
      .not("published_at", "is", null)
      .lte("published_at", new Date().toISOString())
      .maybeSingle();

    if (error) throw new AdminAuthError(`Post: ${error.message}`, 500);
    if (!row) return null;

    // Best-effort. A failed counter must never break the read, so the RPC
    // result is ignored rather than awaited-and-checked. One count per reader
    // per post per hour, so a loop cannot invent traffic — see shouldCountView.
    if (shouldCountView(context.viewerIp, data.slug)) {
      void db.rpc("increment_post_view", { p_slug: data.slug });
    }

    return {
      ...toCard(row),
      bodyMd: row.body_md,
      seoTitle: row.seo_title,
      seoDescription: row.seo_description,
      viewCount: row.view_count,
    };
  });

/* ---------------------------------------------------------------------- */
/* Admin                                                                  */
/* ---------------------------------------------------------------------- */

export type AdminPostRow = {
  id: string;
  slug: string;
  title: string;
  status: PostStatus;
  featured: boolean;
  tags: string[];
  authorName: string;
  viewCount: number;
  readingMinutes: number;
  publishedAt: string | null;
  updatedAt: string;
};

export const adminListPosts = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    z
      .object({
        status: z.enum(["draft", "scheduled", "published", "archived"]).optional(),
        search: z.string().max(100).optional().default(""),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<AdminPostRow[]> => {
    let query = context.actor.db
      .from("blog_posts")
      .select(
        "id, slug, title, status, featured, tags, author_name, view_count, reading_minutes, published_at, updated_at",
      );

    if (data.status) query = query.eq("status", data.status);
    const term = data.search.replace(/[,()*\\]/g, "").trim();
    if (term) query = query.ilike("title", `%${term}%`);

    const { data: rows, error } = await query.order("updated_at", { ascending: false }).limit(200);
    if (error) throw new AdminAuthError(`List posts: ${error.message}`, 500);

    return (rows ?? []).map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      featured: r.featured,
      tags: r.tags,
      authorName: r.author_name,
      viewCount: r.view_count,
      readingMinutes: r.reading_minutes,
      publishedAt: r.published_at,
      updatedAt: r.updated_at,
    }));
  });

export const getPostForEdit = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({ id: z.string().uuid() }), input))
  .handler(async ({ context, data }): Promise<BlogPost> => {
    const { data: row, error } = await context.actor.db
      .from("blog_posts")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new AdminAuthError(`Load post: ${error.message}`, 500);
    if (!row) throw new AdminAuthError("Post not found.", 404);
    return row;
  });

const saveInput = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().max(90).optional().default(""),
  title: z.string().max(200).optional().default(""),
  excerpt: z.string().max(500).optional().default(""),
  bodyMd: z.string().max(200_000).optional().default(""),
  coverUrl: z.string().url().max(2000).nullable().optional(),
  status: z.enum(["draft", "scheduled", "published", "archived"]).optional().default("draft"),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
  seoTitle: z.string().max(200).optional().default(""),
  seoDescription: z.string().max(300).optional().default(""),
  featured: z.boolean().optional().default(false),
  /** For scheduled/published: when it goes (or went) live. */
  publishedAt: z.string().datetime().nullable().optional(),
});

export const savePost = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => saveInput.parse(input))
  .handler(async ({ context, data }): Promise<{ id: string; slug: string }> => {
    const { actor } = context;
    const db = actor.db;

    const title = data.title.trim() || "Untitled";
    let slug = (data.slug.trim() || slugify(title)).toLowerCase();
    if (!SLUG_RE.test(slug)) slug = slugify(slug) || `post-${Date.now()}`;

    // A published or scheduled post needs a timestamp; a draft may keep the one
    // it had (so re-publishing restores the original date) but does not require
    // one. "publish now" is the common case, so an empty timestamp on publish
    // means now rather than an error.
    let publishedAt = data.publishedAt ?? null;
    if ((data.status === "published" || data.status === "scheduled") && !publishedAt) {
      publishedAt = new Date().toISOString();
    }

    const fields = {
      slug,
      title,
      excerpt: data.excerpt,
      body_md: data.bodyMd,
      cover_url: data.coverUrl ?? null,
      status: data.status,
      tags: data.tags,
      seo_title: data.seoTitle,
      seo_description: data.seoDescription,
      featured: data.featured,
      reading_minutes: readingMinutes(data.bodyMd),
      published_at: publishedAt,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await db.from("blog_posts").update(fields).eq("id", data.id);
      if (error) throw slugError(error, "Update post");
      await audit(
        actor,
        "blog.update",
        { type: "blog_post", id: data.id },
        { slug, status: data.status },
      );
      return { id: data.id, slug };
    }

    const { data: created, error } = await db
      .from("blog_posts")
      .insert({ ...fields, author_id: actor.id, author_name: actor.email })
      .select("id")
      .single();
    if (error) throw slugError(error, "Create post");

    await audit(
      actor,
      "blog.create",
      { type: "blog_post", id: created.id },
      { slug, status: data.status },
    );
    return { id: created.id, slug };
  });

/** Postgres 23505 on the slug index means the slug is taken — say so plainly. */
function slugError(error: { code?: string; message: string }, what: string): AdminAuthError {
  if (error.code === "23505") {
    return new AdminAuthError("That slug is already taken. Choose another.", 409);
  }
  return new AdminAuthError(`${what}: ${error.message}`, 500);
}

export const deletePost = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({ id: z.string().uuid() }), input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { error } = await context.actor.db.from("blog_posts").delete().eq("id", data.id);
    if (error) throw new AdminAuthError(`Delete post: ${error.message}`, 500);
    await audit(context.actor, "blog.delete", { type: "blog_post", id: data.id });
    return { ok: true };
  });
