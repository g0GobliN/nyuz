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

const DIFFS = [
  {
    title: "One event, not thirty articles",
    body: "When thirty outlets cover one announcement, you get one story with all thirty sources attached — not thirty entries to mentally deduplicate at 7am.",
  },
  {
    title: "It tells you what changed",
    body: "Not just what was announced — how things stood before, where they stand now, and why that's worth thirty seconds of your morning. Want to go deeper on one of them? Ask, and you'll get a straight answer about that story.",
  },
  {
    title: "It gets sharper without being asked",
    body: "nyuz learns from what you actually read. Open the stories that matter, skip the ones that don't, and in a fortnight your briefing is better aimed than it is today — no survey, no rating prompt, nothing to train. The thumbs are there if you feel like it, and they count for more when you use them. Most people never will, and it works anyway.",
  },
  {
    title: "Quiet days stay quiet",
    body: "There is no daily quota to fill. If nothing crossed your threshold, your briefing is short or it doesn't come. A calendar of manufactured urgency is what we're replacing.",
  },
  {
    title: "Sources are always one tap away",
    body: "Summaries are generated, and generated text can be wrong. nyuz never presents itself as the origin of a story — the original reporting is never more than one tap from the summary of it.",
  },
  {
    title: "You control the volume, precisely",
    body: "A density dial from “only if it's genuinely major” to “tell me everything”. Exclusions that actually hold: a term you've excluded cannot be smuggled back in by a topic you follow.",
  },
  {
    title: "Add the sources you'd hate to miss",
    body: "Your local paper. A niche blog nobody else reads. The team page that posts before anyone reports it. On a paid plan, hand nyuz a feed it isn't watching yet and it joins the rest of your morning.",
  },
];

export function WhyDifferent() {
  return (
    <div>
      <Eyebrow>What makes it different</Eyebrow>
      <h2 className="display mt-3 max-w-xl text-4xl sm:text-5xl">
        Less information. More relevance. Zero searching.
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
  { label: "Understood once" },
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
          AI does the boring work.
          <br />
          You get the useful part.
        </h2>
        <div className="mt-7 space-y-3 text-[14.5px] leading-relaxed text-muted-foreground">
          <p>
            We don&apos;t ask AI to process the same coverage again for every person. Information is
            collected once, the duplicates are folded together, and each event is understood a
            single time — including the part about what it actually changes.
          </p>
          <p>
            Working out which of those stories belong in your morning happens quietly on our side,
            using what you told us you care about. Your interests aren&apos;t handed to anyone to do
            it.
          </p>
          <p>
            Nothing is written separately for each subscriber. That&apos;s what keeps your briefing
            quick, and it&apos;s a good part of why nyuz costs what it does.
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
    ["Understanding", "Each story read once, properly"],
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
              Understand an event once. Deliver it to everyone it matters to.
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
