import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageLoading } from "@/components/loading";
import { authEntryUrl } from "@/lib/auth-redirect";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/dashboard")({
  component: DashboardGuard,
});

/**
 * The session lives in browser storage, so the server cannot know who you are
 * during SSR — the guard therefore runs on the client, after the first session
 * check resolves. Redirecting before `loading` clears would bounce signed-in
 * users out on every refresh.
 */
function DashboardGuard() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && !session) {
      const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.replace(authEntryUrl(destination));
    }
  }, [loading, session]);

  if (loading || !session) {
    return <PageLoading label="Checking your session" />;
  }

  return <Outlet />;
}
