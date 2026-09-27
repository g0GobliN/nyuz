import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseSettingSearch } from "./ai/-shared";

/**
 * The old standalone AI-runtime page.
 *
 * The AI console is one hub now (see src/routes/admin/ai.tsx); runtime controls
 * live on its Limits tab. This shim keeps every existing link working —
 * bookmarks, the sidebar status card, and the `?setting=` deep links the status
 * derivation hands out all land on the same control.
 */
export const Route = createFileRoute("/admin/ai-runtime")({
  beforeLoad: ({ search }) => {
    // Forward the ?setting= deep link so an old bookmark or status-card link
    // still opens the exact control it named. Parsed by the tab's own
    // validator, so nothing is forwarded that the tab would not accept.
    throw redirect({
      to: "/admin/ai/limits",
      search: parseSettingSearch(search as Record<string, unknown>),
      replace: true,
    });
  },
});
