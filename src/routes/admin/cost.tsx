import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The old standalone AI-cost page.
 *
 * The AI console is one hub now (see src/routes/admin/ai.tsx); credit, cap
 * usage and top-ups live on its Spend tab. Bookmarks and docs links keep
 * working through this shim.
 */
export const Route = createFileRoute("/admin/cost")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/ai/spend", replace: true });
  },
});
