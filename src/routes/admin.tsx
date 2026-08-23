import { createFileRoute } from "@tanstack/react-router";
import { AdminLayout } from "@/components/admin/shell";

/**
 * The console's layout route.
 *
 * Deliberately has no `loader`. A loader runs on the server during SSR, where
 * there is no browser session to read a token from — so it would either see
 * every visitor as anonymous or force the role check into a cookie, which is the
 * one place it must not live. The gate is therefore a client component, and the
 * real enforcement is the middleware every child route's queries pass through.
 */
export const Route = createFileRoute("/admin")({
  component: AdminLayout,
  head: () => ({
    meta: [
      { title: "Console — nyuz" },
      // The console must never appear in search results, and no console URL
      // should leak through a referer header to an external site.
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "same-origin" },
    ],
  }),
});
