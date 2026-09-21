import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The staff Pipeline page used to live at /dashboard/admin and now lives at
 * /dashboard/pipeline. This route exists only to forward the old path, so an
 * existing bookmark or a link written against the previous name still lands.
 *
 * `replace` keeps the hop out of history: without it, pressing Back from the
 * Pipeline page would return here and immediately bounce forward again.
 *
 * It grants nothing. The page it forwards to re-checks the viewer for drawing
 * and both of its server functions (`getOverview`, `listRecentEvents`) re-read
 * the caller's role through `adminOnly` on every call, which is the real
 * boundary. A customer who follows this path arrives at the same "Not your
 * floor." state they would have seen on the page it replaced.
 */
export const Route = createFileRoute("/dashboard/admin")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/pipeline", replace: true });
  },
});
