import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Bell, Check, Mail, MessageCircle, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Chip } from "@/components/kit";
import { ExclusionPicker } from "@/components/exclusion-picker";
import { Logo } from "@/components/landing/nav";
import { LogoLoader } from "@/components/loading";
import { ThemeToggle } from "@/components/theme-toggle";
import { DensityDial } from "@/components/density-dial";
import { TimezoneSelect } from "@/components/timezone-select";
import { PageLoading } from "@/components/loading";
import { useAuth } from "@/lib/auth";
import { usePlan } from "@/lib/plan-state";
import { PLAN_LIMITS, STANDARD_DELIVERY_TIME, formatTopicLimit } from "@/lib/plans";
import { sendWelcome } from "@/lib/server/account";
import { startFirstBriefing } from "@/lib/server/briefing";
import { usePrefs, type Prefs } from "@/lib/prefs-store";
import { TopicPicker } from "@/components/topic-picker";
import { topicSlug } from "@/lib/topics";
import { cn } from "@/lib/utils";
import { authEntryUrl, safeAuthDestination } from "@/lib/auth-redirect";

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    ...(typeof search["next"] === "string" ? { next: search["next"] } : {}),
  }),
  component: Onboarding,
  head: () => ({
    meta: [
      { title: "Build your nyuz" },
      { name: "description", content: "Four questions and your first briefing is on its way." },
    ],
  }),
});

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STEP_TITLES = [
  "What do you want to know about?",
  "What should we ignore?",
  "When should we talk to you?",
  "Where should we send it?",
];

function Onboarding() {
  const search = Route.useSearch();
  const { prefs, update, hydrated, accountLoaded } = usePrefs();
  const { session, loading: sessionLoading } = useAuth();
  const { plan, topicLimit, loading: planLoading } = usePlan();
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
  const destination = safeAuthDestination(search.next);
  const exitTo = session ? destination : authEntryUrl(search.next);

  /**
   * A reader who has already done this does not get handed it again.
   *
   * "Get started" is a public call to action and does not know who is looking at
   * it, so a signed-in reader reaches this route from the marketing header, from
   * a bookmark, or by typing the URL. Without this they are walked back through
   * four questions, the answers they already gave are replaced by a fresh draft,
   * and the sequence ends by welcoming them to a product they have been using —
   * which reads as the account having been made again.
   *
   * Both halves have to be known first. `sessionLoading` covers the session
   * check and `hydrated` covers preferences arriving from storage; redirecting
   * before either resolves would throw a genuine new reader out of the flow they
   * just started.
   */
  const alreadyOnboarded =
    !sessionLoading && Boolean(session) && hydrated && accountLoaded && prefs.onboarded;

  useEffect(() => {
    if (alreadyOnboarded) window.location.replace(destination);
  }, [alreadyOnboarded, destination]);

  useEffect(() => {
    if (hydrated && !draft) setDraft({ ...prefs, topics: [], exclusions: [] });
  }, [hydrated, prefs, draft]);

  // Ahead of the draft check so the wizard never paints for one frame on its way
  // to the dashboard.
  if (alreadyOnboarded) {
    return <PageLoading label="Opening your dashboard" />;
  }

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
      await update({
        ...draft,
        frequency: "daily",
        time: PLAN_LIMITS[plan].customDeliveryTime ? draft.time : STANDARD_DELIVERY_TIME,
        channels: {
          ...draft.channels,
          telegram: PLAN_LIMITS[plan].telegram && draft.channels.telegram,
          whatsapp: false,
        },
        onboarded: true,
      });

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

      <main className="veil flex flex-1 items-center px-5 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto w-full max-w-xl">
          {step === 4 ? (
            <SetupSequence name={draft.name} onDone={() => window.location.replace(exitTo)} />
          ) : (
            <div key={step} className="animate-rise">
              <h1 className="display text-[clamp(1.5rem,5.5vw,3rem)]">{STEP_TITLES[step]}</h1>

              {step === 0 ? (
                <StepTopics
                  draft={draft}
                  patch={patch}
                  topicLimit={topicLimit}
                  planLoading={planLoading}
                  remoteSearch={Boolean(session)}
                />
              ) : null}
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

function StepTopics({
  draft,
  patch,
  topicLimit,
  planLoading,
  remoteSearch,
}: StepProps & { topicLimit: number; planLoading: boolean; remoteSearch: boolean }) {
  const atCap = !planLoading && Number.isFinite(topicLimit) && draft.topics.length >= topicLimit;
  const toggle = (t: string) => {
    if (draft.topics.some((x) => topicSlug(x) === topicSlug(t))) {
      patch({ topics: draft.topics.filter((x) => topicSlug(x) !== topicSlug(t)) });
      return;
    }
    patch({ topics: [...draft.topics, t] });
  };

  return (
    <div className="mt-8">
      <p className="text-[14px] leading-relaxed text-muted-foreground">
        Pick from the suggestions, or type whatever you actually want followed — a country, a
        company, a rivalry. This plan includes {formatTopicLimit(topicLimit)} topics.
      </p>
      <div className="mt-5">
        <TopicPicker
          selected={draft.topics}
          onToggle={toggle}
          atCap={atCap}
          remoteSearch={remoteSearch}
        />
      </div>

      {draft.topics.length > 0 ? (
        <div className="mt-6">
          <p className="text-[12.5px] text-muted-foreground">Following</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.topics.map((t) => (
              <Chip key={t} active onClick={() => toggle(t)}>
                <Check className="mr-1 inline h-3 w-3" />
                {t}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepIgnore({ draft, patch }: StepProps) {
  return (
    <div className="mt-8">
      <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
        Optional. Anything you mark here stays out of your briefing even when it trends.
      </p>
      <div className="mt-5">
        <ExclusionPicker
          selected={draft.exclusions}
          onChange={(exclusions) => patch({ exclusions })}
        />
      </div>
    </div>
  );
}

function StepSchedule({ draft, patch }: StepProps) {
  const { plan } = usePlan();
  const customTime = PLAN_LIMITS[plan].customDeliveryTime;
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
            value={customTime ? draft.time : STANDARD_DELIVERY_TIME}
            disabled={!customTime}
            onChange={(e) => patch({ time: e.target.value })}
            className="mt-2 h-12 w-full rounded-2xl border border-input bg-surface px-4 text-[16px] tabular-nums outline-none focus:border-signal"
          />
        </div>
        <div>
          <label htmlFor="tz" className="text-[13px] text-muted-foreground">
            Timezone
          </label>
          <TimezoneSelect
            id="tz"
            value={draft.timezone}
            onChange={(timezone) => patch({ timezone })}
            className="bg-surface"
          />
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
    note: "Connect in Delivery after you finish. Short form, tap through for detail.",
  },
  {
    key: "push",
    label: "Notifications",
    icon: Bell,
    note: "A notice when your briefing is ready. Allow them in Delivery after you finish.",
  },
] as const;

function StepChannels({ draft, patch }: StepProps) {
  const { plan } = usePlan();
  return (
    <div className="mt-8 space-y-3">
      {CHANNELS.filter((c) => c.key !== "telegram" || PLAN_LIMITS[plan].telegram).map((c) => {
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
      <div className="flex w-full items-center gap-4 rounded-2xl border border-hairline bg-surface p-4 opacity-60">
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
      {/* The same mark that stands in for every other wait in the product, at
          the one size where the stroke is worth watching. A ring pulsed around
          a static mark here before; two loops on different clocks drifted
          against each other, and the product only needs one waiting motion. */}
      <span className="mx-auto flex h-16 w-16 items-center justify-center">
        <LogoLoader className="h-14 w-14" label="Setting up your nyuz" />
      </span>

      {/* Greeted by name only when there actually is one. This line used to
          interpolate a default that shipped with a real person's name in it, so
          every stranger who finished onboarding was welcomed as somebody else. */}
      <h1 className="display mt-8 text-[clamp(1.5rem,5.5vw,3rem)]">
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
