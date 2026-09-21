import { useState } from "react";
import { Eyebrow, Chip } from "@/components/kit";
import { BriefingPreview } from "@/components/briefing-preview";
import { PROFILE_BRIEFS, STORIES, type Profile } from "@/lib/sample-data";
import { cn } from "@/lib/utils";

export function ProfileDemo() {
  const [profile, setProfile] = useState<Profile>("sports");
  const cfg = PROFILE_BRIEFS[profile];
  const stories = cfg.storyIds
    .map((id) => STORIES.find((s) => s.id === id))
    .filter(Boolean) as typeof STORIES;

  return (
    <div className="grid items-start gap-10 md:grid-cols-[0.9fr_1.1fr] md:gap-14">
      <div className="md:sticky md:top-28">
        <Eyebrow>Personalisation</Eyebrow>
        <h2 className="display mt-3 text-4xl sm:text-5xl">
          Same morning.
          <br />
          Different briefing.
        </h2>
        <div className="mt-7 flex flex-wrap gap-2">
          {(Object.keys(PROFILE_BRIEFS) as Profile[]).map((p) => (
            <Chip key={p} active={p === profile} onClick={() => setProfile(p)}>
              {PROFILE_BRIEFS[p].label}
            </Chip>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-1.5">
          {cfg.topics.map((t) => (
            <span
              key={t}
              className="rounded-md bg-muted px-2 py-1 text-[11.5px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <BriefingPreview key={profile} stories={stories} compact className="animate-rise" />
    </div>
  );
}

/**
 * One paragraph per card, kept to roughly two to four lines.
 *
 * These are not shortened versions of longer text — they are the length. A card
 * is one beat of the argument, the grid pairs them by height as much as by
 * subject, and a body that runs long enough to wrap a fifth line does not make
 * its own case better; it only sets the row height and leaves a hole beside the
 * shorter card it is paired with.
 */
const DIFFS = [
  {
    title: "One event, not thirty articles",
    body: "When thirty outlets cover the same thing, Nyuz brings them together into one story with the sources attached. You see the event once — not thirty rewrites of the same headline.",
  },
  {
    title: "More than just the news",
    body: "Nyuz doesn't stop at what happened — it gives you the context around a story: what changed, the numbers that matter, and what is worth knowing beyond the headline.",
  },
  {
    title: "Important beats endless",
    body: "There is no quota to fill. If only a few stories genuinely matter today, your briefing stays short — five things worth knowing beat fifty competing for attention.",
  },
  {
    title: "It gets more relevant over time",
    body: "What you read, skip, follow, and exclude helps Nyuz understand what deserves space in your briefing. Use it normally and it gradually becomes more relevant.",
  },
  {
    title: "Sources stay attached",
    body: "Nyuz brings information together without hiding where it came from. Every story keeps its original sources close, so you can check the reporting or keep reading at the source.",
  },
  {
    title: "You decide how much reaches you",
    body: "Want only major developments? Keep it quiet. Want broader coverage? Turn it up. Your topics, exclusions, sources, and briefing density decide how much makes it through.",
  },
  {
    title: "Follow beyond the mainstream",
    body: "Add the sources you care about — a local publication, research feed, niche blog, project page, or something the bigger news apps might never watch. Nyuz isn't trying to make everyone read the same internet.",
  },
];

export function WhyDifferent() {
  return (
    <div>
      <Eyebrow>What makes it different</Eyebrow>
      <h2 className="display mt-3 max-w-xl text-4xl sm:text-5xl">
        Less noise. More context. Information worth knowing.
      </h2>
      <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-hairline bg-[var(--hairline)] sm:grid-cols-2">
        {DIFFS.map((d, i) => (
          <div
            key={d.title}
            // An odd number of cards would leave the final cell empty, and an
            // empty cell in this grid is a bare block of hairline colour rather
            // than nothing. The last card spans instead.
            className={cn(
              "reveal bg-surface p-8",
              i === DIFFS.length - 1 && DIFFS.length % 2 === 1 && "sm:col-span-2",
            )}
            style={{ transitionDelay: `${i * 80}ms` }}
          >
            <p className="text-[19px] font-medium tracking-tight">{d.title}</p>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">{d.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The stages, in order, with the ones that are about *you* marked.
 *
 * `yours` was an index comparison (`i > 5`) until a stage landed in the middle
 * of the list and silently moved the boundary. A flag per row says what the
 * colour means, so inserting a stage cannot recolour its neighbours.
 *
 * Labels are the reader's words, not ours — "duplicates merged", not
 * "deduplication". The internal names of these stages live in
 * `pipeline-explainer.tsx`, on the page written for somebody who asked.
 */
const PIPE: { label: string; yours?: boolean }[] = [
  { label: "Sources" },
  { label: "Collected through the day" },
  { label: "Duplicates merged" },
  { label: "One event, not thirty articles" },
  { label: "Source descriptions selected" },
  { label: "Weighed for importance" },
  { label: "Matched to what you follow", yours: true },
  { label: "Your briefing", yours: true },
];

export function AiTrust() {
  return (
    <div className="grid items-center gap-12 md:grid-cols-2">
      <div>
        <Eyebrow>Under the surface</Eyebrow>
        <h2 className="display mt-3 text-4xl sm:text-5xl">
          Your sources, brought together.
          <br />
          You get the useful part.
        </h2>
        <div className="mt-7 space-y-3 text-[14.5px] leading-relaxed text-muted-foreground">
          <p>
            Coverage is collected once, closely related reports are grouped, and useful source
            descriptions give you a quick way into each event.
          </p>
          <p>
            Working out which of those stories belong in your morning happens quietly on our side,
            using what you told us you care about. Your interests aren&apos;t handed to anyone to do
            it.
          </p>
          <p>
            Open a story for its sources and, when enough reporting and generation capacity are
            available, deeper shared coverage. Once prepared, that article is available to every
            reader.
          </p>
        </div>
      </div>
      <ol className="relative space-y-2 pl-6">
        <span className="absolute bottom-3 left-[7px] top-3 w-px bg-border" />
        {PIPE.map((p, i) => (
          <li key={p.label} className="reveal relative" style={{ transitionDelay: `${i * 70}ms` }}>
            <span
              className="absolute -left-6 top-3 h-[7px] w-[7px] rounded-full"
              style={{ background: p.yours ? "var(--signal)" : "var(--border)" }}
            />
            <div className="rounded-xl border border-hairline bg-surface px-4 py-2.5 text-[14px]">
              {p.label}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Infrastructure() {
  // No count on the left-hand column. "327 monitored feeds" sat here long after
  // onboarding's identical claim was removed for being a number nobody counted;
  // the real figure moves every week and a stale one is worse than none. What
  // each stage *does* is stable, and that is what this table is for.
  const rows = [
    ["Sources", "Curated feeds, plus the ones you add"],
    ["Collection", "Gathered and timestamped"],
    ["Duplicates", "Near-identical articles folded together"],
    ["Shared coverage", "Source descriptions now, deeper coverage on request"],
    ["Story record", "Kept, searchable, always attributed"],
    ["Your interests", "Matched on our side"],
    ["Your briefing", "Built from what has already been read"],
  ];
  return (
    <div>
      <Eyebrow>Infrastructure</Eyebrow>
      <h2 className="display mt-3 max-w-2xl text-4xl sm:text-5xl">
        Simple on the outside. Sophisticated underneath.
      </h2>
      <div className="mt-12 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-hairline bg-surface p-6 sm:p-8">
          {rows.map(([a, b], i) => (
            <div key={a} className="reveal" style={{ transitionDelay: `${i * 60}ms` }}>
              <div className="flex items-baseline justify-between gap-4 py-3">
                <span className="text-[15px] font-medium">{a}</span>
                <span className="text-right text-[12.5px] text-muted-foreground">{b}</span>
              </div>
              {i < rows.length - 1 ? <div className="h-4 w-px bg-border" /> : null}
            </div>
          ))}
          <div className="mt-5 flex flex-wrap gap-2">
            {["Email", "Telegram", "Notifications"].map((d) => (
              <span
                key={d}
                className="rounded-full border border-signal/40 px-3 py-1.5 text-[12px] text-signal"
              >
                {d}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col justify-between gap-5">
          <div className="rounded-3xl border border-hairline bg-surface-2 p-7">
            <p className="font-serif text-3xl leading-snug">
              Organize coverage once. Share it with everyone it matters to.
            </p>
          </div>
          <div className="rounded-3xl border border-hairline bg-surface p-7">
            <p className="text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
              One event. Thousands of people. Understood once.
            </p>
            <div className="mt-6 space-y-4">
              <ArchRow
                label="Re-processing every event, for every person"
                tone="bad"
                note="Costs climb with every new subscriber"
              />
              <ArchRow
                label="Understood once, shared by everyone"
                tone="good"
                note="Costs follow what changes, not the audience"
              />
            </div>
            <p className="mt-6 text-[13px] leading-relaxed text-muted-foreground">
              The quick, obvious work happens first, so the slow work only ever sees what&apos;s
              left. Anything deeper happens when you ask for it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArchRow({ label, note, tone }: { label: string; note: string; tone: "bad" | "good" }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)" }}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px]">{label}</span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: tone === "good" ? "var(--signal)" : "var(--muted-foreground)" }}
        />
      </div>
      {/* Blue bars are model calls. Twelve on the naive path, two on ours — the
          comparison is meant to be read by counting, not by colour coding. */}
      <div className="mt-3 flex gap-1">
        {Array.from({ length: 12 }).map((_, i) => {
          const call = tone === "bad" || i < 2;
          return (
            <span
              key={i}
              className="h-6 flex-1 rounded-[3px]"
              style={{ background: call ? "var(--signal)" : "var(--muted)" }}
            />
          );
        })}
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">{note}</p>
    </div>
  );
}
