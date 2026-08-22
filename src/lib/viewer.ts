import { useQuery } from "@tanstack/react-query";
import { getViewer, type Viewer } from "@/lib/server/guard";

/**
 * Who the current browser session belongs to, and whether that person is staff.
 *
 * This lives in its own module rather than in the console shell because the
 * customer dashboard needs it too, to decide whether to draw the staff links. If
 * it stayed next to `AdminLayout`, importing the role check would pull the entire
 * console shell into the dashboard chunk — every panel, stat and table a customer
 * will never see.
 *
 * Neither function is a security boundary. `isAdmin` reports what the browser was
 * told; `adminOnly` in src/lib/server/guard.ts re-reads the role from the database
 * on every single call, and that is the check that matters. This one only decides
 * what to draw.
 */

/** Cached briefly: the role gates the UI and changes about never. */
export function useViewer() {
  return useQuery<Viewer>({
    queryKey: ["viewer"],
    queryFn: () => getViewer(),
    staleTime: 60_000,
  });
}

export function isAdmin(viewer: Viewer | undefined): boolean {
  return viewer?.role === "admin" || viewer?.role === "superadmin";
}
