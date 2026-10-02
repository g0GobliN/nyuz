import { DeviceManager } from "@/components/device-manager";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/dashboard/app-shell";
import { PanelLoading, PageLoading } from "@/components/loading";
import { authEntryUrl } from "@/lib/auth-redirect";
import { useAuth } from "@/lib/auth";
import { useStandalone } from "@/lib/display-mode";
import { loadPreferences } from "@/lib/server/preferences";

export const Route = createFileRoute("/dashboard")({
  component: DashboardGuard,
});

/**
 * The session lives in browser storage, so the server cannot know who you are
 * during SSR — the guard therefore runs on the client, after the first session
 * check resolves. Redirecting before `loading` clears would bounce signed-in
 * users out on every refresh.
 *
 * A session alone is not enough to show the dashboard: a reader who has never
 * picked topics has nothing for it to display. `/auth` sends first-time sign-ins
 * to `/onboarding` already, but that only covers the sign-in path — a deep link
 * or bookmark lands here directly, so the guard checks `onboarded` itself
 * rather than trusting that every visitor arrived through `/auth`.
 */
function DashboardGuard() {
  const { session, loading } = useAuth();
  const standalone = useStandalone();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [prefsFailed, setPrefsFailed] = useState(false);

  useEffect(() => {
    if (!loading && !session) {
      const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.replace(authEntryUrl(destination));
    }
  }, [loading, session]);

  useEffect(() => {
    if (loading || !session) return;
    let active = true;
    // The catch is load-bearing. This is the first server call after sign-in,
    // and a rejection (expired token, server error, network drop) used to leave
    // `onboarded` at null forever — the guard below rendered its loader
    // indefinitely, and the reader's only way out was a hard reload that often
    // reproduced the same hang. An error here must resolve the wait, either by
    // redirecting to sign-in or by surfacing the failure, never by spinning.
    loadPreferences()
      .then((prefs) => {
        if (active) setOnboarded(prefs.onboarded);
      })
      .catch(() => {
        if (active) setPrefsFailed(true);
      });
    return () => {
      active = false;
    };
  }, [loading, session]);

  useEffect(() => {
    if (onboarded === false) {
      const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.replace(`/onboarding?${new URLSearchParams({ next: destination })}`);
    }
  }, [onboarded]);

  if (loading || !session) {
    // In the installed app the chrome is drawn from the first frame and only the
    // content waits. That wait is the session check plus one round trip for
    // preferences — short, but it is the first thing the reader sees after a
    // cold launch, and a full-screen mark on an empty screen is the difference
    // between an app starting and a page loading. A browser tab keeps the plain
    // loader: it has no shell to hold the space.
    return standalone ? (
      <AppShell>
        <PanelLoading label="Checking your session" />
      </AppShell>
    ) : (
      <PageLoading label="Checking your session" />
    );
  }

  // The preferences read failed. The redirect effects below both key on
  // `onboarded`, which stays null forever after a rejection — so without this
  // branch the guard would spin on "Checking your session" until the reader
  // gave up. A retry button resolves the wait either way: a stale token has by
  // now been refreshed by the auth listener, and a real server failure is at
  // least named rather than hidden behind a loader.
  if (prefsFailed) {
    return standalone ? (
      <AppShell>
        <PanelLoading label="Couldn't load your settings." retry={() => window.location.reload()} />
      </AppShell>
    ) : (
      <PageLoading label="Couldn't load your settings." retry={() => window.location.reload()} />
    );
  }

  return (
    <>
      <DeviceManager compact />
      <Outlet />
    </>
  );
}
