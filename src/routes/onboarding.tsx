import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Mail, MessageCircle, Phone, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Chip } from "@/components/kit";
import { Logo, LogoMark } from "@/components/landing/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { DensityDial } from "@/components/density-dial";
import { useAuth } from "@/lib/auth";
import { sendWelcome } from "@/lib/server/account";
import { startFirstBriefing } from "@/lib/server/briefing";
import { usePrefs, type Prefs } from "@/lib/prefs-store";
import { IGNORE_POOL, TOPIC_POOL } from "@/lib/sample-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding")({
  component: Onboarding,
  head: () => ({
    meta: [
      { title: "Build your nyuz" },
      { name: "description", content: "Four questions and your first briefing is on its way." },
    ],
  }),
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

const STEP_TITLES = [
  "What do you want to know about?",
  "What should we ignore?",
  "When should we talk to you?",
  "Where should we send it?",
];

function Onboarding() {
  const navigate = useNavigate();
  const { prefs, update, hydrated } = usePrefs();
  const { session } = useAuth();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Prefs | null>(null);

  /**
   * Where the finished sequence lets you out.
   *
   * Onboarding does not require an account, but `/dashboard` does — its guard
   * redirects anyone without a session straight to `/auth`. Sending everyone to
   * the dashboard therefore ended the flow by bouncing new visitors to a sign-in
   * page one beat after telling them everything was ready. Signed-in people go
   * to the dashboard; everyone else goes to sign-up, where their answers are
   * waiting in local storage to be attached to the new account.
   */
  const exitTo = session ? "/dashboard" : "/auth";

  useEffect(() => {
    if (hydrated && !draft) setDraft({ ...prefs, topics: [], exclusions: [] });
  }, [hydrated, prefs, draft]);

  if (!draft) {
    return <div className="min-h-screen bg-background" />;
  }

  const patch = (p: Partial<Prefs>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const canAdvance =
    step === 0
      ? draft.topics.length > 0
      : step === 3
        ? Object.values(draft.channels).some(Boolean)
        : true;

  const finish = () => {
    // The sequence starts immediately; the account work happens behind it. The
    // four lines it plays take about four and a half seconds, which is the
    // budget this has to finish inside.
    setStep(4);

    void (async () => {
      // Awaited, unlike everything else here. The backfill matches against
      // `user_topics`, so running it before the save lands would match an empty
      // topic list and decide this reader is interested in nothing.
      await update({ ...draft, onboarded: true });

      // Fire and forget. The welcome email is not worth blocking on, and
      // `sendWelcome` is idempotent — a signed-out visitor finishing onboarding
      // simply gets a rejected call and no mail, which is correct.
      void sendWelcome().catch((error: unknown) => console.error(error));

      // Day one. Events already in the database were analysed for somebody
      // else, so matching this reader against them costs one query — which is
      // why "Matching your interests" on the screen behind this is now a
      // description of something happening rather than an animation.
      //
      // A signed-out visitor gets a rejected call and no rows; their answers
      // are in local storage and `usePrefs` runs this again on the first
      // authenticated load.
      void startFirstBriefing().catch((error: unknown) => console.error(error));
    })();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <div className="flex items-center gap-3">
          {step < 4 ? (
            <span className="text-[12.5px] tabular-nums text-muted-foreground">
              Step {step + 1} of 4
            </span>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      {step < 4 ? (
        <div className="px-5 sm:px-8">
          <div className="mx-auto flex w-full max-w-xl gap-1.5">
            {STEP_TITLES.map((t, i) => (
              <span
                key={t}
                className="h-1 flex-1 rounded-full transition-colors duration-500"
                style={{ background: i <= step ? "var(--signal)" : "var(--border)" }}
              />
            ))}
          </div>
        </div>
      ) : null}

      <main className="veil flex flex-1 items-center px-5 py-12 sm:px-8">
        <div className="mx-auto w-full max-w-xl">
          {step === 4 ? (
            <SetupSequence name={draft.name} onDone={() => navigate({ to: exitTo })} />
          ) : (
            <div key={step} className="animate-rise">
              <h1 className="display text-[clamp(2rem,5.5vw,3rem)]">{STEP_TITLES[step]}</h1>

              {step === 0 ? <StepTopics draft={draft} patch={patch} /> : null}
              {step === 1 ? <StepIgnore draft={draft} patch={patch} /> : null}
              {step === 2 ? <StepSchedule draft={draft} patch={patch} /> : null}
              {step === 3 ? <StepChannels draft={draft} patch={patch} /> : null}

              <div className="mt-12 flex items-center justify-between gap-4">
                {step > 0 ? (
                  <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-3">
                  {step === 1 ? (
                    <button
                      onClick={() => setStep(2)}
                      className="text-[13px] text-muted-foreground hover:text-foreground"
                    >
                      Skip
                    </button>
                  ) : null}
                  <Button
                    disabled={!canAdvance}
                    onClick={() => (step === 3 ? finish() : setStep((s) => s + 1))}
                  >
                    {step === 3 ? "Build my nyuz" : "Continue"} <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {step === 0 && draft.topics.length === 0 ? (
                <p className="mt-4 text-right text-[12.5px] text-muted-foreground">
                  Pick at least one topic to continue.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

type StepProps = { draft: Prefs; patch: (p: Partial<Prefs>) => void };

function StepTopics({ draft, patch }: StepProps) {
  const [q, setQ] = useState("");
  const toggle = (t: string) =>
    patch({
      topics: draft.topics.includes(t) ? draft.topics.filter((x) => x !== t) : [...draft.topics, t],
    });

  const matches = useMemo(
    () => TOPIC_POOL.filter((t) => t.toLowerCase().includes(q.trim().toLowerCase())),
    [q],
  );

  const custom = q.trim();
  const canAddCustom =
    custom.length > 1 && !TOPIC_POOL.some((t) => t.toLowerCase() === custom.toLowerCase());

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2.5 rounded-full border border-input bg-surface px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAddCustom) {
              toggle(custom);
              setQ("");
            }
          }}
          placeholder="Search topics, companies, technologies"
          className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
      </div>

      {canAddCustom ? (
        <button
          onClick={() => {
            toggle(custom);
            setQ("");
          }}
          className="mt-3 text-[13px] text-signal"
        >
          Add &ldquo;{custom}&rdquo; as a topic
        </button>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {matches.map((t) => (
          <Chip key={t} active={draft.topics.includes(t)} onClick={() => toggle(t)}>
            {draft.topics.includes(t) ? <Check className="mr-1 inline h-3 w-3" /> : null}
            {t}
          </Chip>
        ))}
      </div>

      {draft.topics.filter((t) => !TOPIC_POOL.some((p) => p === t)).length > 0 ? (
        <div className="mt-5">
          <p className="text-[11.5px] uppercase tracking-[0.16em] text-muted-foreground">Yours</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {draft.topics
              .filter((t) => !TOPIC_POOL.some((p) => p === t))
              .map((t) => (
                <Chip key={t} active onClick={() => toggle(t)}>
                  <Check className="mr-1 inline h-3 w-3" />
                  {t}
                </Chip>
              ))}
          </div>
        </div>
      ) : null}

      <p className="mt-7 text-[13px] text-muted-foreground">
        {draft.topics.length === 0
          ? "Most people start with four or five."
          : `${draft.topics.length} selected. You can change these any time.`}
      </p>
    </div>
  );
}

function StepIgnore({ draft, patch }: StepProps) {
  const toggle = (t: string) =>
    patch({
      exclusions: draft.exclusions.includes(t)
        ? draft.exclusions.filter((x) => x !== t)
        : [...draft.exclusions, t],
    });

  return (
    <div className="mt-8">
      <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
        Optional. Anything you mark here stays out of your briefing even when it trends.
      </p>
      <div className="mt-7 flex flex-wrap gap-2">
        {IGNORE_POOL.map((t) => {
          const on = draft.exclusions.includes(t);
          return (
            <button
              key={t}
              onClick={() => toggle(t)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-all duration-300 active:scale-95",
                on
                  ? "border-transparent bg-muted text-muted-foreground line-through"
                  : "border-border bg-surface hover:border-foreground/25",
              )}
            >
              {on ? <X className="h-3 w-3" /> : null}
              {t}
            </button>
          );
        })}
      </div>

      <div className="mt-9">
        <label className="text-[13px] text-muted-foreground">
          Tell us anything else you want us to know
        </label>
        <textarea
          rows={3}
          placeholder="Only tell me about React when something significant happens."
          className="mt-2 w-full resize-none rounded-2xl border border-input bg-surface px-4 py-3 text-[14.5px] outline-none placeholder:text-muted-foreground focus:border-signal"
        />
      </div>
    </div>
  );
}

function StepSchedule({ draft, patch }: StepProps) {
  const toggleDay = (d: string) =>
    patch({
      days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d],
    });

  return (
    <div className="mt-8 space-y-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="time" className="text-[13px] text-muted-foreground">
            Delivery time
          </label>
          <input
            id="time"
            type="time"
            value={draft.time}
            onChange={(e) => patch({ time: e.target.value })}
            className="mt-2 h-12 w-full rounded-2xl border border-input bg-surface px-4 text-[16px] tabular-nums outline-none focus:border-signal"
          />
        </div>
        <div>
          <label htmlFor="tz" className="text-[13px] text-muted-foreground">
            Timezone
          </label>
          <select
            id="tz"
            value={draft.timezone}
            onChange={(e) => patch({ timezone: e.target.value })}
            className="mt-2 h-12 w-full rounded-2xl border border-input bg-surface px-4 text-[14.5px] outline-none focus:border-signal"
          >
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="text-[13px] text-muted-foreground">Days</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <Chip key={d} active={draft.days.includes(d)} onClick={() => toggleDay(d)}>
              {d}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[13px] text-muted-foreground">How much should reach you?</p>
        <DensityDial
          className="mt-3"
          value={draft.density}
          onChange={(v) => patch({ density: v })}
        />
      </div>
    </div>
  );
}

const CHANNELS = [
  { key: "email", label: "Email", icon: Mail, note: "Always on. The full briefing." },
  {
    key: "telegram",
    label: "Telegram",
    icon: MessageCircle,
    note: "Short form, tap through for detail.",
  },
  { key: "whatsapp", label: "WhatsApp", icon: Phone, note: "Available on Pro." },
] as const;

function StepChannels({ draft, patch }: StepProps) {
  return (
    <div className="mt-8 space-y-3">
      {CHANNELS.map((c) => {
        const on = draft.channels[c.key];
        const Icon = c.icon;
        return (
          <button
            key={c.key}
            onClick={() => patch({ channels: { ...draft.channels, [c.key]: !on } })}
            className={cn(
              "flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-300",
              on ? "border-signal/50 bg-surface" : "border-hairline bg-surface hover:border-border",
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
              <span className="block text-[15px] font-medium">{c.label}</span>
              <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{c.note}</span>
            </span>
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                on ? "border-signal bg-signal text-signal-foreground" : "border-border",
              )}
            >
              {on ? <Check className="h-3 w-3" /> : null}
            </span>
          </button>
        );
      })}
      <p className="pt-3 text-[13px] text-muted-foreground">
        You can add or remove channels later from Delivery settings.
      </p>
    </div>
  );
}

/**
 * What the sequence claims is happening, which now has to be what is happening.
 *
 * The first line used to read "Monitoring 327 sources". Nobody counted 327 of
 * anything — there are 64 live feeds — and a number invented to look busy is the
 * exact thing `plan.md` forbids, on the screen where a stranger is most likely
 * to believe it. It says no number now.
 *
 * The other three are true as of stage 6: articles are clustered into events,
 * those events are analysed, and `startFirstBriefing` above is running the
 * matcher against this reader's answers while these lines play.
 */
const SETUP_LINES = [
  "Reading your sources",
  "Understanding today's events",
  "Matching your interests",
  "Your first briefing is being prepared",
];

function SetupSequence({ name, onDone }: { name: string; onDone: () => void }) {
  const [done, setDone] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gap = reduce ? 200 : 900;
    const timers = SETUP_LINES.map((_, i) => setTimeout(() => setDone(i + 1), gap * (i + 1)));
    const end = setTimeout(onDone, gap * (SETUP_LINES.length + 1.4));
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(end);
    };
  }, [onDone]);

  return (
    <div className="animate-rise text-center">
      {/* The pulse conveys "scanning"; the mark keeps it ours rather than a
          generic scanning animation. */}
      <span className="relative mx-auto flex h-16 w-16 items-center justify-center">
        <span
          className="absolute inset-0 rounded-full border border-signal/40"
          style={{ animation: "pulse-ring 2.2s ease-out infinite" }}
        />
        <LogoMark className="h-7 w-auto text-foreground" />
      </span>

      {/* Greeted by name only when there actually is one. This line used to
          interpolate a default that shipped with a real person's name in it, so
          every stranger who finished onboarding was welcomed as somebody else. */}
      <h1 className="display mt-8 text-[clamp(2rem,5.5vw,3rem)]">
        {name ? `Your nyuz is ready, ${name}.` : "Your nyuz is ready."}
      </h1>

      <ol className="mx-auto mt-10 max-w-xs space-y-3 text-left">
        {SETUP_LINES.map((l, i) => {
          const complete = i < done;
          const active = i === done;
          return (
            <li
              key={l}
              className="flex items-center gap-3 text-[14px] transition-all duration-500"
              style={{ opacity: complete ? 1 : active ? 0.85 : 0.3 }}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-500",
                  complete ? "border-signal bg-signal text-signal-foreground" : "border-border",
                )}
              >
                {complete ? <Check className="h-3 w-3" /> : null}
              </span>
              <span className={complete ? "" : "text-muted-foreground"}>{l}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
