import { createFileRoute } from "@tanstack/react-router";
import { Check, Mail, MessageCircle, Pause, Phone, Play } from "lucide-react";
import { useState } from "react";
import { DashboardShell, PageHeader } from "@/components/dashboard/shell";
import { Button, Chip } from "@/components/kit";
import { DensityDial } from "@/components/density-dial";
import { useAuth } from "@/lib/auth";
import { notifyBriefingsPaused } from "@/lib/server/account";
import { usePrefs } from "@/lib/prefs-store";
import { cn } from "@/lib/utils";

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
  // The address on the account, not a stored copy — the account is the only
  // thing that actually receives a briefing.
  const email = useAuth().user?.email ?? "";
  const [saved, setSaved] = useState(false);

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
                className="mt-2 h-12 w-full rounded-2xl border border-input bg-background px-4 text-[14.5px] outline-none focus:border-signal"
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
              detail="Preference stored · nothing is sent on this channel yet"
              on={prefs.channels.telegram}
              onToggle={() =>
                touch({ channels: { ...prefs.channels, telegram: !prefs.channels.telegram } })
              }
            />
            <Channel
              icon={Phone}
              label="WhatsApp"
              detail="Preference stored · nothing is sent on this channel yet"
              on={prefs.channels.whatsapp}
              onToggle={() =>
                touch({ channels: { ...prefs.channels, whatsapp: !prefs.channels.whatsapp } })
              }
            />
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
              {(["important", "everything", "off"] as const).map((b) => (
                <Chip key={b} active={prefs.breaking === b} onClick={() => touch({ breaking: b })}>
                  {b === "important" ? "Only important" : b === "everything" ? "Everything" : "Off"}
                </Chip>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
              Breaking alerts arrive outside your schedule. On &ldquo;only important&rdquo; we send
              at most a couple a week.
            </p>
          </div>
        </Panel>

        <Panel title="Density">
          <DensityDial value={prefs.density} onChange={(v) => touch({ density: v })} />
        </Panel>
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

function Channel({
  icon: Icon,
  label,
  detail,
  on,
  onToggle,
}: {
  icon: typeof Mail;
  label: string;
  detail: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-300",
        on ? "border-signal/50 bg-surface-2" : "border-hairline hover:border-border",
      )}
    >
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
    </button>
  );
}
