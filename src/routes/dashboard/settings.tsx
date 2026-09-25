import { createFileRoute } from "@tanstack/react-router";
import { Check, Download, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { DeviceManager } from "@/components/device-manager";
import { InstallSection } from "@/components/dashboard/install-section";
import { DashboardShell, PageHeader } from "@/components/dashboard/shell";
import { Button, LinkButton } from "@/components/kit";
import { archiveAccount, archiveUsage, clearAccount } from "@/lib/offline/archive";
import { UserAvatar } from "@/components/user-avatar";
import { ACCOUNT_DELETION_GRACE_DAYS, deletionDeadline } from "@/lib/account-deletion";
import { useFeedback } from "@/lib/feedback-store";
import { useAuth, useAvatarUrl } from "@/lib/auth";
import { usePlan } from "@/lib/plan-state";
import { usePrefs } from "@/lib/prefs-store";
import { deleteAccount, exportAccountData } from "@/lib/server/account";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/settings")({
  component: Settings,
  head: () => ({ meta: [{ title: "Settings — nyuz" }] }),
});

/**
 * What this device is holding for offline reading, and the way to empty it.
 *
 * Shown in every layout rather than only in the installed app: the archive is
 * written in a browser tab too, and a reader who wants to know what nyuz has put
 * on their device should not have to install it first to find out.
 */
function OfflineCopies() {
  const [usage, setUsage] = useState<{ lists: number; stories: number; bytes: number } | null>(
    null,
  );

  const read = () => {
    const userId = archiveAccount();
    if (!userId) return;
    void archiveUsage(userId).then(setUsage);
  };

  useEffect(read, []);

  const clear = () => {
    const userId = archiveAccount();
    if (!userId) return;
    void clearAccount(userId).then(read);
  };

  return (
    <Panel title="Offline">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
          {usage && usage.stories + usage.lists > 0
            ? `${usage.stories} ${usage.stories === 1 ? "story" : "stories"} and ${usage.lists} ${usage.lists === 1 ? "list" : "lists"} are stored here, about ${formatBytes(usage.bytes)}, so nyuz opens without a connection. Kept on this device only, and removed when you sign out.`
            : "Nothing is stored on this device yet. Open a briefing or save a story while online and it will be kept here."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={clear}
          disabled={!usage || usage.stories + usage.lists === 0}
        >
          Clear offline copies
        </Button>
      </div>
    </Panel>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Settings() {
  const { prefs, update } = usePrefs();
  // The address on the account, not a stored copy — the account is the only
  // thing that actually receives a briefing.
  const auth = useAuth();
  // Read here as well as inside `UserAvatar`, because what the row says about
  // the picture depends on whether there is one.
  const avatarUrl = useAvatarUrl();
  const { plan, cancelsOn, loading: planLoading } = usePlan();
  const email = auth.user?.email ?? "";
  const [nextEmail, setNextEmail] = useState(email);
  const { state, signals, reset } = useFeedback();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"email" | "export" | "pause" | "delete" | "all-devices" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // The danger zone stays collapsed until asked for. Typing the address is not
  // a security control — the call is already behind `signedInOnly` — it is
  // there so an irreversible action cannot happen on one stray click.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Set once the grace period has actually started. The reader is still signed
  // in at that point, so this is the only moment the restore-by date can be
  // shown to them — after signing out there is no screen left to show it on.
  const [deletesOn, setDeletesOn] = useState<Date | null>(null);

  useEffect(() => setNextEmail(email), [email]);

  const mustCancelSubscription = !planLoading && plan !== "uno" && cancelsOn === null;

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const removeAccount = async () => {
    if (busy) return;
    setBusy("delete");
    setDeleteError(null);
    try {
      const result = await deleteAccount({ data: { confirmEmail: confirmEmail.trim() } });
      if (!result.ok) {
        setDeleteError(result.detail);
        return;
      }
      // Not signed out here. The account is off but still real for thirty days,
      // so the session stays valid, and the reader is owed the date their
      // account stops being recoverable before the screen goes away. Presence
      // will not quietly undo the request in the meantime — restoring needs a
      // sign-in newer than the request (0074).
      setConfirmingDelete(false);
      setConfirmEmail("");
      setDeletesOn(deletionDeadline(result.deletesOn));
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? cause.message : "Could not delete the account. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  const signOutAllDevices = async () => {
    if (busy) return;
    setBusy("all-devices");
    setError(null);
    try {
      await auth.signOutAllDevices();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out all devices.");
      setBusy(null);
    }
  };

  const changeEmail = async () => {
    const value = nextEmail.trim();
    if (!value || value === email || busy) return;
    setBusy("email");
    setError(null);
    try {
      await auth.updateEmail(value);
      save();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the email address.");
    } finally {
      setBusy(null);
    }
  };

  const downloadExport = async () => {
    if (busy) return;
    setBusy("export");
    setError(null);
    try {
      const data = await exportAccountData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `nyuz-account-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export your data.");
    } finally {
      setBusy(null);
    }
  };

  const pause = async () => {
    if (busy || prefs.paused) return;
    setBusy("pause");
    setError(null);
    await update({ paused: true });
    save();
    setBusy(null);
  };

  return (
    <DashboardShell title="Settings">
      <PageHeader eyebrow="Account" title="Settings.">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-signal/40 px-3 py-1.5 text-[12px] text-signal transition-opacity duration-500",
            saved ? "opacity-100" : "opacity-0",
          )}
        >
          <Check className="h-3.5 w-3.5" /> Saved
        </span>
      </PageHeader>

      {/* No navigation on this page, in either chrome. The sidebar and the app's
          bottom strip list the same destinations, so a second copy here was only
          ever a consequence of the app having four tabs and needing somewhere to
          put the rest. */}
      <div className="space-y-5">
        <Panel title="Profile">
          {/* Shown rather than offered. The picture belongs to the Google or
              GitHub account; there is no upload here, and a control that
              looked like one would just be a dead end. */}
          <div className="flex flex-wrap items-center gap-4">
            <UserAvatar name={prefs.name} size="lg" />
            <div>
              <p className="text-[13px] text-muted-foreground">Picture</p>
              <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
                {avatarUrl
                  ? "Taken from the account you signed in with. Change it there and it follows you here."
                  : "None yet. Signing in with Google or GitHub brings the picture on that account."}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-5 border-t border-hairline pt-6 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="text-[13px] text-muted-foreground">
                What should we call you?
              </label>
              <input
                id="name"
                value={prefs.name}
                onChange={(e) => update({ name: e.target.value })}
                onBlur={save}
                className="mt-2 h-11 w-full rounded-2xl border border-input bg-background px-4 text-[16px] outline-none focus:border-signal md:text-[14.5px]"
              />
              <p className="mt-2 text-[12px] text-muted-foreground">
                Used in the greeting at the top of every briefing.
              </p>
            </div>
            <div>
              <label htmlFor="email" className="text-[13px] text-muted-foreground">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={nextEmail}
                onChange={(event) => setNextEmail(event.target.value)}
                className="mt-2 h-11 w-full rounded-2xl border border-input bg-background px-4 text-[16px] outline-none focus:border-signal md:text-[14.5px]"
              />
              <p className="mt-2 text-[12px] text-muted-foreground">
                Changing this sends a confirmation link to the new address.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void changeEmail()}
                disabled={busy !== null || !nextEmail.trim() || nextEmail.trim() === email}
              >
                {busy === "email" ? "Sending…" : "Change email"}
              </Button>
            </div>
          </div>
          {error ? <p className="mt-4 text-[12.5px] text-destructive">{error}</p> : null}
        </Panel>

        {/* Directly under Profile, and above Security and Devices, because the
            reader who wants this is looking for it — a device setting they came
            here to find, not one to discover by scrolling. It renders nothing on
            a device that cannot install. */}
        <InstallSection />

        <Panel title="Security">
          <RowAction
            title="Sign out all devices"
            body="Signs out every browser and device using this account, including this one. Use this if you think someone else has access."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void signOutAllDevices()}
                disabled={busy !== null}
              >
                {busy === "all-devices" ? "Signing out…" : "Sign out all devices"}
              </Button>
            }
          />
          {error ? <p className="mt-4 text-[12.5px] text-destructive">{error}</p> : null}
        </Panel>

        <DeviceManager />

        <Panel title="Personalisation">
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex-1">
              <p className="flex items-center gap-2 text-[14px] font-medium">
                <Sparkles className="h-4 w-4 text-signal" /> Your nyuz is learning
              </p>
              <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                {signals === 0
                  ? "No feedback signals yet. Rate stories and your briefing starts shifting toward what you open."
                  : `${signals} signals in play: ${Object.keys(state.votes).length} ratings, ${state.dismissed.length} dismissed, ${state.mutedTopics.length} muted topics, ${state.saved.length} saved.`}
              </p>
              <p className="mt-3 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                Clearing this resets personalisation to your stated topics alone. Your topics and
                schedule are untouched.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={reset} disabled={signals === 0}>
              Clear feedback signals
            </Button>
          </div>
        </Panel>

        <OfflineCopies />

        <Panel title="Data">
          <div className="space-y-3">
            <RowAction
              title="Export your data"
              body="Topics, schedule, feedback signals and delivery history as JSON."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void downloadExport()}
                  disabled={busy !== null}
                >
                  <Download className="h-3.5 w-3.5" />
                  {busy === "export" ? "Preparing…" : "Export"}
                </Button>
              }
            />
            <RowAction
              title="Pause briefings"
              body="Stops delivery without losing your configuration or archive."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void pause()}
                  disabled={busy !== null || prefs.paused}
                >
                  {prefs.paused ? "Paused" : busy === "pause" ? "Pausing…" : "Pause"}
                </Button>
              }
            />
          </div>
        </Panel>

        <section className="rounded-3xl border border-destructive/30 bg-surface p-6 sm:p-7">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-destructive">
            Danger zone
          </h2>
          {deletesOn ? (
            <div className="mt-5">
              <p className="text-[14px] font-medium">Deletion scheduled</p>
              <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                Briefings and alerts have stopped. Your account is permanently deleted on{" "}
                <span className="font-medium text-foreground">
                  {deletesOn.toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                . Signing back in before then restores everything exactly as you left it.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => void auth.signOut()}
              >
                Sign out
              </Button>
            </div>
          ) : (
            <>
              <div className="mt-5 flex flex-wrap items-start gap-5">
                <div className="flex-1">
                  <p className="text-[14px] font-medium">Delete account</p>
                  <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                    Stops all briefings and alerts immediately. Your account remains recoverable for{" "}
                    {ACCOUNT_DELETION_GRACE_DAYS} days, then your profile and personal data are
                    permanently deleted.
                  </p>
                  {mustCancelSubscription ? (
                    <p className="mt-2 max-w-md text-[12.5px] font-medium">
                      Cancel your paid subscription before account deletion can be scheduled.
                    </p>
                  ) : cancelsOn ? (
                    <p className="mt-2 max-w-md text-[12.5px] text-muted-foreground">
                      Your subscription cancellation is scheduled, so account deletion is available.
                    </p>
                  ) : null}
                </div>
                {confirmingDelete ? null : (
                  <div className="flex flex-wrap gap-2">
                    {mustCancelSubscription ? (
                      <LinkButton to="/dashboard/billing" variant="outline" size="sm">
                        Cancel subscription first
                      </LinkButton>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConfirmingDelete(true);
                        setDeleteError(null);
                      }}
                      disabled={busy !== null || planLoading || mustCancelSubscription}
                    >
                      Delete account
                    </Button>
                  </div>
                )}
              </div>

              {confirmingDelete ? (
                <div className="mt-5 rounded-2xl border border-destructive/30 p-4">
                  <label htmlFor="confirm-delete" className="text-[12.5px] text-muted-foreground">
                    Type <span className="font-medium text-foreground">{email}</span> to confirm.
                  </label>
                  <input
                    id="confirm-delete"
                    type="email"
                    autoComplete="off"
                    value={confirmEmail}
                    onChange={(event) => setConfirmEmail(event.target.value)}
                    className="mt-2 h-11 w-full rounded-2xl border border-input bg-background px-4 text-[16px] outline-none focus:border-destructive md:text-[14.5px]"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void removeAccount()}
                      disabled={
                        busy !== null ||
                        mustCancelSubscription ||
                        confirmEmail.trim().toLowerCase() !== email.toLowerCase()
                      }
                    >
                      {busy === "delete" ? "Scheduling…" : "Delete my account"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConfirmingDelete(false);
                        setConfirmEmail("");
                        setDeleteError(null);
                      }}
                      disabled={busy !== null}
                    >
                      Cancel
                    </Button>
                  </div>
                  {deleteError ? (
                    <p className="mt-3 text-[12.5px] text-destructive">{deleteError}</p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
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

function RowAction({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-hairline bg-surface-2 px-5 py-4">
      <div className="flex-1">
        <p className="text-[14px] font-medium">{title}</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}
