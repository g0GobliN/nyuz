import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageLoading } from "@/components/loading";
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
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return <PageLoading label="Checking your session" />;
  }

  return <Outlet />;
}
