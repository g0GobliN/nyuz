import { Eyebrow } from "@/components/kit";

/**
 * The mechanics of the pipeline, written for /how-it-works.
 *
 * This file exists because /how-it-works used to be the landing page again: it
 * rendered `HowItWorksRail`, `NoiseSection`, `Comparison`, `AiTrust`,
 * `Infrastructure`, `WhyDifferent` and `SourceTransparency` — seven components
 * the home page already shows. Somebody who clicked "See how it works" from the
 * hero scrolled the same argument a second time under a new headline, which is
 * the worst outcome for the one page whose whole job is to answer a question the
 * home page raised.
 *
 * The split now: the landing page ARGUES (five steps, none of them yours), and
 * this page EXPLAINS (what each step actually does, in order, with the real
 * names of the real operations). Anything here that reads like persuasion
 * belongs on the home page instead.
 *
 * Every stage below describes something that exists in supabase/migrations —
 * `content_hash`, the trigram index on article titles, `importance`, `novelty`,
 * `analysis_tokens`, `events_with_demand()`, `event_impacts`,
 * `event_translations`. If a stage changes, this copy is wrong and needs
 * changing with it.
 *
 * Stage 07 is the one to watch. It used to say a paragraph was generated per
 * person per story, which was true until `0028` moved that explanation into the
 * analysis call and made it shared. Only describe per-reader generation here if
 * `digest.ts` actually does it — today the only model call made for one reader
 * alone is Story Ask, which they have to press.
 */

type Stage = {
  n: string;
  title: string;
  /** What arrives at this stage. */
  input: string;
  /** What the stage does to it. Mechanism, not benefit. */
  operation: string;
  /** What leaves. */
  output: string;
  /** The honest cost note. `model: true` marks the two stages that pay a model. */
  cost: string;
  model?: boolean;
};

const STAGES: Stage[] = [
  {
    n: "01",
    title: "Collect",
    input: "A list of feeds — newsrooms, sports desks, music sites, wires, company blogs.",
    operation:
      "Each source is checked on its own schedule, plus any you have added yourself. A source that stops responding is backed off and eventually dropped, so one dead feed never holds up anybody's morning.",
    output: "Articles, timestamped and credited to the publication they came from.",
    cost: "No AI. Fetching and reading, nothing more.",
  },
  {
    n: "02",
    title: "Tidy up",
    input: "Raw articles, many of which are the same page reached by a different link.",
    operation:
      "The same article often arrives at several addresses at once — a tracking link, a mobile version, a syndicated copy. Those are recognised as one article rather than several, and a headline quietly rewritten hours later is spotted as the same piece.",
    output: "One entry per genuinely different article.",
    cost: "No AI. Straightforward matching.",
  },
  {
    n: "03",
    title: "Group",
    input: "Different articles that may still be describing one real event.",
    operation:
      "Headlines that look like they are covering the same thing are pulled into a shortlist first. Only that shortlist is looked at closely, and only to settle one question: is this the same story?",
    output: "One story, with every article that reported it kept alongside it.",
    cost: "The first place AI is used, and only on a shortlist rather than on everything.",
    model: true,
  },
  {
    n: "04",
    title: "Check it is wanted",
    input: "Stories waiting to be read, and the subjects people actually follow.",
    operation:
      "Before anything slow happens, we check whether this is something anybody follows. If nobody does, it waits. The moment somebody starts following that subject, it is read — so nothing is thrown away, it simply is not read in advance for an audience of nobody.",
    output: "A shorter queue: the stories somebody is genuinely waiting for.",
    cost: "No AI. This is what keeps the next step affordable.",
  },
  {
    n: "05",
    title: "Understand",
    input: "One story and the articles covering it.",
    operation:
      "One careful read: what happened, how things stood before, where they stand now, and how much of a departure it really is. The same read produces the line about what it changes.",
    output: "A story worth putting in front of somebody, and the reason it is worth it.",
    cost: "The second and last time AI is used without being asked. Once per story, however many people it eventually reaches.",
    model: true,
  },
  {
    n: "06",
    title: "Match",
    input: "Stories that have been read, and what each subscriber follows.",
    operation:
      "Your topics, your keywords, your preferred sources and your density setting decide what reaches you — worked out on our side, not handed to anyone. Exclusions are applied last and win outright: something you have excluded cannot be let back in by a topic you follow.",
    output: "The handful of stories that belong in your morning specifically.",
    cost: "No AI. This is the step that would otherwise grow with every new subscriber, and deliberately does not.",
  },
  {
    n: "07",
    title: "Put together and sent",
    input: "The few stories that cleared your threshold today.",
    operation:
      "Your briefing is built from what has already been read — the summary and the line about what changed — in your order, at your density, within your plan's limits. If you read in another language, the translated version is reused rather than remade for you.",
    output: "A briefing, at your time, in your timezone, on your channel.",
    cost: "No AI writing happens here. This step is assembly.",
  },
];

export function PipelineStages() {
  return (
    <div>
      <Eyebrow>The pipeline, stage by stage</Eyebrow>
      <h2 className="display mt-3 max-w-2xl text-4xl sm:text-5xl">
        Seven steps. Two of them use AI.
      </h2>
      <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        The order matters more than any single step. The quick, obvious work happens first and
        throws away as much as it can, so the slow work only ever sees what is left — and the last
        step, the one that happens for every reader, is quick again.
      </p>

      <ol className="mt-12 space-y-3">
        {STAGES.map((s, i) => (
          <li key={s.n} className="reveal" style={{ transitionDelay: `${i * 60}ms` }}>
            <article className="rounded-3xl border border-hairline bg-surface p-6 sm:p-8">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
                <span className="font-serif text-2xl tabular-nums text-muted-foreground">
                  {s.n}
                </span>
                <h3 className="text-[20px] font-medium tracking-tight">{s.title}</h3>
                <span
                  className={
                    "ml-auto rounded-full border px-2.5 py-0.5 text-[11px] " +
                    (s.model
                      ? "border-signal/40 text-signal"
                      : "border-border text-muted-foreground")
                  }
                >
                  {s.model ? "uses AI" : "no AI"}
                </span>
              </div>

              <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-3">
                {(
                  [
                    ["In", s.input],
                    ["What happens", s.operation],
                    ["Out", s.output],
                  ] as const
                ).map(([label, text]) => (
                  <div key={label}>
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="mt-2 text-[13.5px] leading-relaxed">{text}</dd>
                  </div>
                ))}
              </dl>

              <p className="mt-5 border-t border-hairline pt-4 text-[12.5px] leading-relaxed text-muted-foreground">
                {s.cost}
              </p>
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

/**
 * The fan-in / fan-out shape, which is the one idea that explains both the cost
 * model and why the briefings are short.
 *
 * The numbers are a worked illustration of a single day's run at the volume the
 * system is built for, and the page says so rather than presenting them as a
 * measurement. Real figures live in the operator console.
 */
export function SharedAnalysis() {
  const funnel = [
    { label: "Articles collected", value: "8,412", width: 100 },
    { label: "After normalisation", value: "8,120", width: 96 },
    { label: "Once grouped", value: "312 stories", width: 34 },
    { label: "Somebody follows it", value: "224 stories", width: 25 },
    { label: "Read properly", value: "224 times", width: 25, signal: true },
    { label: "Above your threshold", value: "6 stories", width: 8, signal: true },
  ];

  return (
    <div className="grid items-start gap-12 lg:grid-cols-[0.95fr_1.05fr]">
      <div>
        <Eyebrow>Why it stays cheap</Eyebrow>
        <h2 className="display mt-3 text-4xl sm:text-5xl">
          Understand a story once.
          <br />
          Everyone it matters to reads it.
        </h2>
        <div className="mt-7 space-y-4 text-[14.5px] leading-relaxed text-muted-foreground">
          <p>
            Thirty outlets covering one announcement is one story, and it gets read once. The
            hundredth person to care about it does not set off a hundredth reading — they are
            matched to something that already exists.
          </p>
          <p>
            That is why the expensive part of nyuz grows with{" "}
            <span className="text-foreground">how much happened today</span>, not with how many
            people subscribed. Nothing is written separately for each reader.
          </p>
          <p>
            The one thing written just for you is the thing you ask for — what a particular story
            means in your world. You press a button, and it does not happen otherwise.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-hairline bg-surface p-6 sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          One day, illustrated
        </p>
        <div className="mt-6 space-y-4">
          {funnel.map((f, i) => (
            <div key={f.label} className="reveal" style={{ transitionDelay: `${i * 80}ms` }}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[13.5px]">{f.label}</span>
                <span className="text-[12.5px] tabular-nums text-muted-foreground">{f.value}</span>
              </div>
              <span className="mt-2 block h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full transition-[width] duration-1000"
                  style={{
                    width: `${f.width}%`,
                    background: f.signal ? "var(--signal)" : "var(--border)",
                  }}
                />
              </span>
            </div>
          ))}
        </div>
        <p className="mt-7 text-[12.5px] leading-relaxed text-muted-foreground">
          Illustrative volumes at the scale the pipeline is designed for, not a measurement. The
          ratio between the second bar and the fourth is the whole argument.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

/**
 * `yours` marks the beats that are about the reader rather than about the
 * event, and drives the accent dot. It was an index comparison (`i >= 4`)
 * until the demand beat was inserted in the middle and quietly recoloured the
 * beat after it — same failure as the pipeline list in `sections.tsx`.
 */
type Beat = { time: string; what: string; detail: string; yours?: boolean };

const BEATS: Beat[] = [
  {
    time: "14:02",
    what: "First report appears",
    detail: "One outlet publishes. The article is fetched, canonicalised and hashed.",
  },
  {
    time: "14:09",
    what: "Six more arrive",
    detail:
      "Different headlines, same announcement. They look like candidates for the same story, and a quick check confirms it.",
  },
  {
    time: "14:10",
    what: "Somebody is waiting for it",
    detail:
      "Before anything slow runs, we check this is a subject people actually follow. It is, so it goes ahead. Had nobody followed it, it would have waited until somebody did.",
  },
  {
    time: "14:11",
    what: "The story is read",
    detail:
      "What happened, what it changes, how much of a departure it is, what it is about — all in one read. This is the only time it is read at length.",
  },
  {
    time: "14:11",
    what: "Thirty-one more pile in",
    detail:
      "Aggregators and follow-ups. They join the story already there as further sources. Nothing is read twice.",
  },
  {
    time: "14:12",
    what: "Matched against you",
    detail:
      "Importance 8.4 clears your density threshold, the topic is one you follow, and none of your excluded terms appear. It is queued for your briefing.",
    yours: true,
  },
  {
    time: "07:30",
    what: "You read one paragraph",
    detail:
      "What happened and what it changes, in your briefing, with all thirty-eight sources one tap away. Want it in your own terms? Asking is one tap away too.",
    yours: true,
  },
];

export function WorkedExample() {
  return (
    <div>
      <Eyebrow>One story, end to end</Eyebrow>
      <h2 className="display mt-3 max-w-2xl text-4xl sm:text-5xl">
        Thirty-eight articles. One paragraph.
      </h2>
      <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        A single announcement, followed from the moment it is published to the moment it reaches a
        briefing.
      </p>

      <ol className="relative mt-12 space-y-1 pl-8">
        <span className="absolute bottom-4 left-[9px] top-4 w-px bg-border" />
        {BEATS.map((b, i) => (
          <li
            key={b.time + b.what}
            className="reveal relative py-3"
            style={{ transitionDelay: `${i * 70}ms` }}
          >
            <span
              className="absolute -left-8 top-[18px] h-[9px] w-[9px] rounded-full ring-4 ring-[var(--background)]"
              style={{ background: b.yours ? "var(--signal)" : "var(--border)" }}
            />
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="w-14 shrink-0 font-serif text-[15px] tabular-nums text-muted-foreground">
                {b.time}
              </span>
              <span className="text-[15px] font-medium">{b.what}</span>
            </div>
            <p className="mt-1.5 max-w-xl pl-0 text-[13.5px] leading-relaxed text-muted-foreground sm:pl-[4.5rem]">
              {b.detail}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

/**
 * Questions about the mechanism, not about the plan. Pricing objections belong
 * on /pricing and product objections on the home page; these are the things
 * somebody wonders once they understand how the pipeline works.
 */
const MECHANICS_FAQ: { q: string; a: string }[] = [
  {
    q: "What happens on a day when nothing important occurs?",
    a: "You get a shorter briefing, or none at all. A quiet day is a real outcome and is recorded as one — the system has a status for a skipped briefing with zero items. Padding it out with whatever ranked highest that day would defeat the point of a threshold.",
  },
  {
    q: "What if the reporting disagrees with itself?",
    a: "Clustering groups articles that describe the same event, not articles that agree about it. Where accounts differ, the summary describes what is established and the sources stay attached, so the disagreement is one tap away rather than averaged into a single confident sentence.",
  },
  {
    q: "How fast is something breaking?",
    a: "Breaking alerts are scored on the same importance scale as everything else and sent outside your schedule only when an event clears a much higher bar. You choose whether that means anything important, everything, or nothing at all.",
  },
  {
    q: "Can the summary be wrong?",
    a: "Yes. It is generated, and generated text can be wrong. This is why every story keeps its original sources, why nyuz never presents itself as the origin of a story, and why the link to the reporting is never more than one tap from the summary of it.",
  },
  {
    q: "What happens when a source stops working?",
    a: "Failures are counted per source. A feed that keeps failing is backed off and eventually deactivated rather than retried forever, and it shows up in the operator console as a failing source. One broken feed does not delay anybody's briefing.",
  },
  {
    q: "Does following more topics mean a longer briefing?",
    a: "Not directly. Topics decide what is eligible; the density setting decides how high the bar is. Following twenty topics at a high threshold gives you a shorter briefing than following three at a low one.",
  },
  {
    q: "If the summary is the same for everyone, is my briefing still personal?",
    a: "The choosing is yours; the writing is shared. Which stories reach you, in what order, at what threshold, with your exclusions applied — that part is yours and nobody else's. What a story changed is a fact about the story rather than about you, so it is written once and read by everyone it reaches. When you want the version that is about you, ask for it and you will get it.",
  },
  {
    q: "What happens to a story nobody follows?",
    a: "It waits. We do not read it in advance for an audience of nobody. If you start following that subject next week, it is read then and appears in your briefing like anything else — it is not thrown away in the meantime.",
  },
  {
    q: "Can I add a source you don't already watch?",
    a: "On a paid plan, yes — a local paper, a niche blog, a company's own updates. Personal includes five and Pro twenty-five. If another reader has already asked for the same feed, you simply share it. We check an address before we start using it, and we will tell you if it is not something we can read.",
  },
  {
    q: "Can I read in a language other than English?",
    a: "You can choose your reading language in settings. English is the language nyuz reads in, so the others are translations of it — and the original reporting always stays in its own language, and is always linked.",
  },
];

export function MechanicsFaq() {
  return (
    <div>
      <Eyebrow>Questions about the mechanism</Eyebrow>
      <h2 className="display mt-3 max-w-2xl text-4xl sm:text-5xl">The parts people ask about.</h2>

      <dl className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-hairline bg-[var(--hairline)] sm:grid-cols-2">
        {MECHANICS_FAQ.map((item) => (
          <div key={item.q} className="bg-surface p-6 sm:p-7">
            <dt className="text-[15px] font-medium leading-snug">{item.q}</dt>
            <dd className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">{item.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
