import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Bell, Mail, MessageCircle, Pause, Phone, Play, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardShell, PageHeader } from "@/components/dashboard/shell";
import { Button, Chip } from "@/components/kit";
import { DensityDial } from "@/components/density-dial";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LANGUAGES } from "@/lib/languages";
import { useAuth } from "@/lib/auth";
import { notifyBriefingsPaused } from "@/lib/server/account";
import {
  createTelegramLink,
  disconnectTelegram,
  getTelegramStatus,
} from "@/lib/server/telegram/account";
import { getPushStatus } from "@/lib/server/push/account";
import {
  disablePush,
  enablePush,
  pushBlock,
  pushBlockMessage,
  pushDiagnostics,
  pushPermission,
  pushSupported,
} from "@/lib/push/client";
import { usePrefs } from "@/lib/prefs-store";
import { cn } from "@/lib/utils";
import { usePlan } from "@/lib/plan-state";
import { PLAN_LIMITS, allowedBreaking } from "@/lib/plans";

export const Route = createFileRoute("/dashboard/delivery")({
  component: Delivery,
  head: () => ({ meta: [{ title: "Delivery — nyuz" }] }),
});

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ZONES = [
  "Asia/Tokyo",
  "Asia/Kathmandu",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
];

function Delivery() {
  const { prefs, update } = usePrefs();
  const { plan } = usePlan();
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.uno;
  const effectiveBreaking = allowedBreaking(plan, prefs.breaking);
  // The address on the account, not a stored copy — the account is the only
  // thing that actually receives a briefing.
  const email = useAuth().user?.email ?? "";
  const [saved, setSaved] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [showIosSetup, setShowIosSetup] = useState(false);
  // The capability checks only mean something in a browser. Reading them
  // during the server render would print "cannot show notifications" into the
  // HTML of a device that can, so the row waits one paint for the truth.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const queryClient = useQueryClient();
  const telegramQ = useQuery({
    queryKey: ["telegram", "status"],
    queryFn: () => getTelegramStatus(),
  });
  const pushQ = useQuery({
    queryKey: ["push", "status"],
    queryFn: () => getPushStatus(),
  });

  const touch = (p: Parameters<typeof update>[0]) => {
    update(p);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const toggleDay = (d: string) =>
    touch({
      days: prefs.days.includes(d) ? prefs.days.filter((x) => x !== d) : [...prefs.days, d],
    });

  /**
   * Asks the browser and stores the endpoint. Separate from the toggle because
   * the pref can already be on with no subscription behind it: onboarding sets
   * the channel without a browser prompt, and permission can also be revoked
   * from site settings. In both cases the toggle already reads "on", so without
   * a way to subscribe on its own the only route through is off and on again.
   */
  const subscribe = async (): Promise<boolean> => {
    setPushError(null);
    const key = pushQ.data?.publicKey;
    if (!key || !pushQ.data?.configured) {
      setPushError("Notifications are not configured on this instance.");
      return false;
    }
    // The only branch that is an instruction rather than an error: iOS exposes
    // the push APIs to Home Screen web apps only, so show the install steps.
    if (pushBlock() === "ios-needs-install") {
      setShowIosSetup(true);
      return false;
    }
    // No await before this point: enablePush asks for permission immediately,
    // and the tap on the toggle is the gesture that request needs.
    const result = await enablePush(key);
    if (!result.ok) {
      setPushError(result.error);
      if (import.meta.env.DEV && result.detail)
        console.error("[push]", result.reason, result.detail);
      return false;
    }
    void queryClient.invalidateQueries({ queryKey: ["push", "status"] });
    return true;
  };

  const togglePush = async () => {
    setPushError(null);
    if (prefs.channels.push) {
      await disablePush();
      touch({ channels: { ...prefs.channels, push: false } });
      void queryClient.invalidateQueries({ queryKey: ["push", "status"] });
      return;
    }
    if (await subscribe()) touch({ channels: { ...prefs.channels, push: true } });
  };

  /**
   * Stops or resumes everything.
   *
   * The confirmation email is sent only on the way into paused, never on the way
   * out: the message tells the reader there is no follow-up, and mailing them
   * again when they resume would contradict it. Fire and forget, because a
   * failed confirmation must not make the pause itself look like it failed —
   * the pause is the thing they asked for.
   */
  const togglePaused = () => {
    const next = !prefs.paused;
    touch({ paused: next });
    if (next) void notifyBriefingsPaused().catch((error: unknown) => console.error(error));
  };

  return (
    <DashboardShell title="Delivery">
      <PageHeader
        eyebrow="Schedule"
        title="When should we talk to you?"
        sub="Your briefing is generated shortly before it is sent, so it is current at the moment it lands."
      >
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-signal/40 px-3 py-1.5 text-[12px] text-signal transition-opacity duration-500",
            saved ? "opacity-100" : "opacity-0",
          )}
        >
          <Check className="h-3.5 w-3.5" /> Saved
        </span>
      </PageHeader>

      {/* At the top because it overrides everything under it. Somebody looking
          for "make it stop" should not have to read a schedule editor first. */}
      <section
        className={cn(
          "mb-5 flex flex-wrap items-center justify-between gap-4 rounded-3xl border p-6 sm:p-7",
          prefs.paused ? "border-signal/40 bg-surface-2" : "border-hairline bg-surface",
        )}
      >
        <div>
          <p className="text-[15px] font-medium">
            {prefs.paused ? "Briefings are paused." : "Briefings are on."}
          </p>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
            {prefs.paused
              ? "Nothing is being sent on any channel. Your topics, schedule and history are untouched and resume exactly where you left off."
              : "Pausing stops every channel at once without changing anything below. Nothing is deleted and nothing is lost."}
          </p>
        </div>
        <Button variant={prefs.paused ? "primary" : "outline"} size="sm" onClick={togglePaused}>
          {prefs.paused ? (
            <>
              <Play className="h-3.5 w-3.5" /> Resume briefings
            </>
          ) : (
            <>
              <Pause className="h-3.5 w-3.5" /> Pause briefings
            </>
          )}
        </Button>
      </section>

      <div
        className={cn(
          "space-y-5 transition-opacity duration-500",
          // Dimmed rather than disabled: these settings still describe what will
          // happen on resume, and locking them would make a pause feel like a
          // downgrade rather than a switch.
          prefs.paused && "opacity-60",
        )}
      >
        <Panel title="Time and place">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="time" className="text-[13px] text-muted-foreground">
                Delivery time
              </label>
              <input
                id="time"
                type="time"
                value={prefs.time}
                onChange={(e) => touch({ time: e.target.value })}
                className="mt-2 h-12 w-full rounded-2xl border border-input bg-background px-4 text-[16px] tabular-nums outline-none focus:border-signal"
              />
            </div>
            <div>
              <label htmlFor="tz" className="text-[13px] text-muted-foreground">
                Timezone
              </label>
              <select
                id="tz"
                value={prefs.timezone}
                onChange={(e) => touch({ timezone: e.target.value })}
                className="mt-2 h-12 w-full rounded-2xl border border-input bg-background px-4 text-[16px] outline-none focus:border-signal md:text-[14.5px]"
              >
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-[13px] text-muted-foreground">Days</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <Chip key={d} active={prefs.days.includes(d)} onClick={() => toggleDay(d)}>
                  {d}
                </Chip>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Channels">
          <div className="space-y-3">
            <Channel
              icon={Mail}
              label="Email"
              detail={`${email || "No address on file"} · the full briefing`}
              on={prefs.channels.email}
              onToggle={() =>
                touch({ channels: { ...prefs.channels, email: !prefs.channels.email } })
              }
            />
            <Channel
              icon={MessageCircle}
              label="Telegram"
              detail={telegramDetail(telegramQ.data, prefs.channels.telegram)}
              on={prefs.channels.telegram}
              onToggle={() =>
                touch({ channels: { ...prefs.channels, telegram: !prefs.channels.telegram } })
              }
              extra={<TelegramConnect />}
            />
            <Channel
              icon={Bell}
              label="Notifications"
              detail={pushDetail(pushQ.data, prefs.channels.push, mounted)}
              on={prefs.channels.push}
              onToggle={() => void togglePush()}
              extra={
                <PushConnect
                  error={pushError}
                  needsPermission={
                    mounted &&
                    prefs.channels.push &&
                    Boolean(pushQ.data?.configured) &&
                    !pushQ.data?.subscribed &&
                    (pushSupported() || pushBlock() === "ios-needs-install")
                  }
                  onAllow={() => void subscribe()}
                  diagnostics={mounted && showPushDiagnostics()}
                />
              }
            />
            <div className="flex w-full items-center gap-4 rounded-2xl border border-hairline p-4 opacity-60">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Phone className="h-4 w-4" />
              </span>
              <span className="flex-1">
                <span className="block text-[15px] font-medium">More soon</span>
                <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                  Other services later. Nothing is sent from this row.
                </span>
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Frequency">
          <div className="flex flex-wrap gap-2">
            {(["daily", "weekly"] as const).map((f) => (
              <Chip key={f} active={prefs.frequency === f} onClick={() => touch({ frequency: f })}>
                {f === "daily" ? "Daily briefing" : "Weekly roundup"}
              </Chip>
            ))}
          </div>

          <div className="mt-7">
            <p className="text-[13px] text-muted-foreground">Breaking alerts</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["important", "everything", "off"] as const).map((b) => {
                const locked =
                  (limits.alerts === "none" && b !== "off") ||
                  (limits.alerts === "important" && b === "everything");
                return (
                  <Chip
                    key={b}
                    active={effectiveBreaking === b}
                    onClick={() => {
                      if (!locked) touch({ breaking: b });
                    }}
                  >
                    {b === "important"
                      ? "Only important"
                      : b === "everything"
                        ? "Everything"
                        : "Off"}
                    {locked ? ` · ${b === "everything" ? "Omni" : "Paid"}` : ""}
                  </Chip>
                );
              })}
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
              {limits.alerts === "none"
                ? "Alerts are a paid feature. On Uno, stories wait for the next scheduled briefing."
                : limits.alerts === "important"
                  ? `Only what you would regret missing arrives outside your schedule. Most days that is nothing at all, and never more than ${limits.alertDailyCap} in a day.`
                  : `Choose important or everything, with a ceiling of ${limits.alertDailyCap} alerts a day.`}
            </p>
          </div>
        </Panel>

        <Panel title="Language">
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((language) => (
              <Chip
                key={language.tag}
                active={prefs.language === language.tag}
                onClick={() => touch({ language: language.tag })}
              >
                {language.endonym}
              </Chip>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            The language your stories are written in. Sources stay in their own language and every
            story links to the original. This does not change the language of the app itself.
          </p>
        </Panel>

        <Panel title="Density">
          <DensityDial value={prefs.density} onChange={(v) => touch({ density: v })} />
        </Panel>
      </div>

      <Dialog open={showIosSetup} onOpenChange={setShowIosSetup}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enable notifications on iPhone</DialogTitle>
            <div className="mt-4 space-y-4 text-left text-[13px] text-muted-foreground">
              <p>Add Nyuz to your Home Screen first. You only need to do this once.</p>
              <ol className="space-y-3">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal/15 text-[11px] font-semibold text-signal">
                    1
                  </span>
                  <span className="pt-0.5">Tap Share</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal/15 text-[11px] font-semibold text-signal">
                    2
                  </span>
                  <span className="pt-0.5">Tap "Add to Home Screen"</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal/15 text-[11px] font-semibold text-signal">
                    3
                  </span>
                  <span className="pt-0.5">Open Nyuz from your Home Screen</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal/15 text-[11px] font-semibold text-signal">
                    4
                  </span>
                  <span className="pt-0.5">Enable notifications</span>
                </li>
              </ol>
              <p className="pt-1">Email and Telegram notifications work without this setup.</p>
            </div>
          </DialogHeader>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" size="sm" onClick={() => setShowIosSetup(false)}>
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function telegramDetail(
  status: { configured: boolean; linked: boolean } | undefined,
  on: boolean,
): string {
  if (!status) return "Short form. Connect below, then turn this on.";
  if (!status.configured) return "Not available on this instance yet";
  if (status.linked) {
    return on
      ? "Linked · short form, tap through for the full story"
      : "Linked · turn this on to receive briefings here";
  }
  if (on) return "Turned on · connect below to start receiving";
  return "Short form. Connect below, then turn this on.";
}

const IDLE_DETAIL =
  "One notice per story. Tap to read, dismiss the rest. Your dashboard still has everything.";

/**
 * The one line under "Notifications", which has to be honest about seven
 * different situations. The old copy collapsed all of them into an iOS version
 * complaint, which was wrong on every modern iPhone.
 */
function pushDetail(
  status: { configured: boolean; subscribed: boolean; count: number } | undefined,
  on: boolean,
  mounted: boolean,
): string {
  if (!mounted) return IDLE_DETAIL;

  const block = pushBlock();
  if (block === "ios-needs-install") {
    return "Add Nyuz to your Home Screen to turn these on. Use email or Telegram until then.";
  }
  if (block) return pushBlockMessage(block);

  if (!status) return "One notice per story. Dismiss just clears the notice.";
  if (!status.configured) return "Not available on this instance yet";

  const permission = pushPermission();
  if (permission === "denied") {
    return "Blocked in your device settings. Allow notifications for Nyuz there, then turn this on.";
  }
  if (on && status.subscribed) {
    const devices = status.count === 1 ? "1 device" : `${status.count} devices`;
    return `On · ${devices} subscribed. One notice per story. Dismissing does not remove it from your dashboard.`;
  }
  if (on && permission === "granted") {
    return "Allowed, but this device is not registered yet. Tap Enable notifications to finish.";
  }
  if (on) return "Turned on · allow notifications when the browser asks.";
  return IDLE_DETAIL;
}

/**
 * Whether to print the raw capability values under the row.
 *
 * Temporary, for the iOS push investigation: on in development, and on any
 * build when the page is opened with `?pushdebug=1`, so the values can be read
 * off the phone that produced them.
 */
function showPushDiagnostics(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("pushdebug");
}

function PushConnect({
  error,
  needsPermission,
  onAllow,
  diagnostics,
}: {
  error: string | null;
  needsPermission: boolean;
  onAllow: () => void;
  diagnostics: boolean;
}) {
  return (
    <div className="space-y-2.5">
      {needsPermission ? (
        <Button variant="outline" size="sm" onClick={onAllow}>
          Enable notifications
        </Button>
      ) : null}
      <p className="text-[12.5px] text-muted-foreground">
        {error ??
          "Clearing a notice only clears the notice. Come back here, or Home, to read the rest."}
      </p>
      {diagnostics ? <PushDiagnostics /> : null}
    </div>
  );
}

function PushDiagnostics() {
  const values = pushDiagnostics();
  return (
    <details className="rounded-xl border border-hairline bg-surface-2 px-3 py-2">
      <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        Push diagnostics
      </summary>
      <dl className="mt-2 space-y-1">
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className="flex gap-2 text-[11px] leading-relaxed">
            <dt className="shrink-0 text-muted-foreground">{key}</dt>
            <dd className="break-all font-mono">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function TelegramConnect() {
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const status = useQuery({
    queryKey: ["telegram", "status"],
    queryFn: () => getTelegramStatus(),
    refetchInterval: (q) => (waiting && !q.state.data?.linked ? 4_000 : false),
  });

  const connect = useMutation({
    mutationFn: () => createTelegramLink(),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["telegram", "status"] });
      if (data.connectUrl) {
        setWaiting(true);
        window.open(data.connectUrl, "_blank", "noopener,noreferrer");
      }
    },
  });

  const unlink = useMutation({
    mutationFn: () => disconnectTelegram(),
    onSuccess: () => {
      setWaiting(false);
      void queryClient.invalidateQueries({ queryKey: ["telegram", "status"] });
    },
  });

  const data = status.data;

  if (status.isLoading && !data) return null;
  if (!data?.configured) {
    return <p className="text-[12.5px] text-muted-foreground">Telegram is not configured here.</p>;
  }

  if (data.linked) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">This Telegram account is linked.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={unlink.isPending}
          onClick={() => unlink.mutate()}
        >
          Disconnect
        </Button>
      </div>
    );
  }

  const error = connect.data?.error;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[12.5px] text-muted-foreground">
        {error ??
          (waiting
            ? "Tap Start in Telegram, then come back here."
            : "Opens Telegram with a one-time link. Expires in 30 minutes.")}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={connect.isPending}
        onClick={() => connect.mutate()}
      >
        Connect Telegram
      </Button>
    </div>
  );
}

function Channel({
  icon: Icon,
  label,
  detail,
  on,
  onToggle,
  extra,
}: {
  icon: typeof Mail;
  label: string;
  detail: string;
  on: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
}) {
  const row = (
    <>
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          on ? "bg-signal/15 text-signal" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{detail}</span>
      </span>
      <span
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-300",
          on ? "bg-signal" : "bg-muted",
        )}
      >
        <span
          className="absolute top-1 h-4 w-4 rounded-full bg-background transition-all duration-300"
          style={{ left: on ? "1.375rem" : "0.25rem" }}
        />
      </span>
    </>
  );

  if (extra) {
    return (
      <div
        className={cn(
          "rounded-2xl border transition-all duration-300",
          on ? "border-signal/50 bg-surface-2" : "border-hairline",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-4 p-4 text-left"
        >
          {row}
        </button>
        <div className="border-t border-hairline px-4 py-3">{extra}</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-300",
        on ? "border-signal/50 bg-surface-2" : "border-hairline hover:border-border",
      )}
    >
      {row}
    </button>
  );
}
