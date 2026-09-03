import { createAdminClient, type ServerEnv } from "@/lib/supabase/admin";
import { envValue } from "@/lib/runtime-env";

/**
 * The sitemap, built at request time rather than checked in.
 *
 * ---------------------------------------------------------------------------
 * Why this stopped being a static file
 * ---------------------------------------------------------------------------
 *
 * `public/sitemap.xml` listed fourteen fixed URLs. Blog posts are published
 * from the admin console into `blog_posts`, so every post ever written was
 * absent from it — the one part of the site that grows was the one part search
 * engines were never told about. It had also already drifted: `acceptable-use`
 * shipped as a legal document and was never added.
 *
 * A file that has to be edited by hand every time content is published will be
 * out of date, so the list is derived instead. The static half is still a
 * literal below, because those routes are files in `src/routes` and there is no
 * runtime registry to read them from — but it is one list, next to the code
 * that serves it, rather than a second copy in `public/`.
 */

/**
 * Public routes that are files rather than rows.
 *
 * Adding a public page means adding it here. Dashboard and admin routes are
 * deliberately absent: they are behind auth, carry `Cache-Control: no-store`,
 * and are not linked from anywhere public.
 */
const STATIC_PATHS = [
  "/",
  "/how-it-works",
  "/pricing",
  "/about",
  "/support",
  "/blog",
  "/legal/privacy",
  "/legal/terms",
  "/legal/acceptable-use",
  "/legal/refunds",
  "/legal/subprocessors",
  "/legal/security",
  "/legal/cookies",
  "/legal/tokushoho",
  "/legal/contact",
] as const;

/** XML text nodes. A slug with an ampersand would otherwise break the document. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(loc: string, lastmod?: string | null): string {
  const modified = lastmod ? `<lastmod>${xmlEscape(lastmod.slice(0, 10))}</lastmod>` : "";
  return `  <url><loc>${xmlEscape(loc)}</loc>${modified}</url>`;
}

export type SitemapEnv = ServerEnv;

export async function handleSitemap(env?: SitemapEnv): Promise<Response> {
  const configured = envValue("VITE_SITE_URL", env);
  if (!configured) {
    // Every entry is absolute, so there is no useful sitemap to emit without an
    // origin — and emitting one with a guessed origin would publish wrong URLs.
    return new Response("Sitemap is not configured", { status: 503 });
  }
  const origin = configured.replace(/\/+$/, "");

  let posts: { slug: string; updated_at: string }[] = [];
  try {
    const db = createAdminClient(env);
    const { data } = await db
      .from("blog_posts")
      .select("slug, updated_at")
      .eq("status", "published")
      .not("published_at", "is", null)
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(1000);
    posts = data ?? [];
  } catch (error) {
    // A sitemap missing its posts is worth more than a 500. The static routes
    // are the ones that matter for indexing the product itself.
    console.error("Building sitemap:", error);
  }

  const entries = [
    ...STATIC_PATHS.map((path) => urlEntry(`${origin}${path}`)),
    ...posts.map((post) => urlEntry(`${origin}/blog/${post.slug}`, post.updated_at)),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Crawlers do not need this to the minute, and this is one database read
      // per hour rather than one per crawl.
      "cache-control": "public, max-age=3600",
    },
  });
}
