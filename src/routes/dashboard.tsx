import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="sr-only">Checking your session…</span>
        <span
          className="h-2 w-2 rounded-full bg-signal"
          style={{ animation: "pulse-ring 1.6s ease-out infinite" }}
        />
      </div>
    );
  }

  return <Outlet />;
}
