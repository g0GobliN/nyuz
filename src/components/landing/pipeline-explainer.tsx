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
 * `analysis_tokens`, `why_it_matters`. If a stage changes, this copy is wrong
 * and needs changing with it.
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
    input: "A list of feeds — company blogs, newsrooms, research pages, release notes.",
    operation:
      "Each source is fetched on its own schedule. A source that fails is counted, backed off, and retired if it keeps failing, so one dead feed cannot stall the run.",
    output: "Raw articles, timestamped and attributed to the source they came from.",
    cost: "No model. Network and parsing only.",
  },
  {
    n: "02",
    title: "Normalise",
    input: "Raw articles, many of which are the same page reached by different URLs.",
    operation:
      "URLs are canonicalised — tracking parameters, session ids and AMP variants stripped — then hashed together with the title. An exact hash collision is a republish, not a new article.",
    output: "One row per genuinely distinct article.",
    cost: "No model. A hash comparison.",
  },
  {
    n: "03",
    title: "Cluster",
    input: "Distinct articles that may still describe one real-world event.",
    operation:
      "Trigram similarity on headlines shortlists the plausible matches first, in the database. Only that shortlist goes to a model, and only to answer one question: are these the same event?",
    output: "An event, with every article that reported it attached to it.",
    cost: "First model call. Runs on a shortlist, not on everything.",
    model: true,
  },
  {
    n: "04",
    title: "Understand",
    input: "One event and its cluster of articles.",
    operation:
      "A single analysis pass extracts what happened, what the situation was before, what it is now, and scores the event for importance and novelty from 0 to 10. The tokens this costs are recorded against the event.",
    output: "A structured event: summary, before, after, importance, novelty, topics.",
    cost: "Second model call — and the last one that is shared. Charged once per event, no matter how many people it eventually reaches.",
    model: true,
  },
  {
    n: "05",
    title: "Match",
    input: "Structured events, and every subscriber's interest profile.",
    operation:
      "A database query, not a model: topics, keywords, source preferences and the density threshold decide who sees what. Exclusions are applied last and beat everything — a term you have excluded cannot be reintroduced by a topic you follow.",
    output: "Per-person relevance scores against events that already exist.",
    cost: "No model. This is the stage that would otherwise scale with users, and it is deliberately arithmetic.",
  },
  {
    n: "06",
    title: "Write and deliver",
    input: "The handful of events that cleared your threshold today.",
    operation:
      "One short paragraph is generated per person per story — why this matters to you specifically, given what you follow. Everything else in the briefing was already written once, upstream.",
    output: "A briefing, sent at your time, in your timezone, on your channel.",
    cost: "A small generation per person. The only per-user model spend in the system.",
    model: true,
  },
];

export function PipelineStages() {
  return (
    <div>
      <Eyebrow>The pipeline, stage by stage</Eyebrow>
      <h2 className="display mt-3 max-w-2xl text-4xl sm:text-5xl">
        Six stages. Two of them cost anything.
      </h2>
      <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        The order matters more than any individual step. Cheap, deterministic work runs first and
        throws away as much as it can, so that the expensive work only ever sees what survived.
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
                  {s.model ? "model call" : "no model"}
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
    { label: "After clustering", value: "312 events", width: 34 },
    { label: "Analysed by a model", value: "312 times", width: 34, signal: true },
    { label: "Above your threshold", value: "6 stories", width: 8, signal: true },
  ];

  return (
    <div className="grid items-start gap-12 lg:grid-cols-[0.95fr_1.05fr]">
      <div>
        <Eyebrow>Why it stays cheap</Eyebrow>
        <h2 className="display mt-3 text-4xl sm:text-5xl">
          Understand a story once.
          <br />
          Personalise it many times.
        </h2>
        <div className="mt-7 space-y-4 text-[14.5px] leading-relaxed text-muted-foreground">
          <p>
            Thirty outlets covering one announcement is one event, and it is read by a model a
            single time. The hundredth subscriber to care about it does not trigger a hundredth
            analysis — they are matched against an event that already exists.
          </p>
          <p>
            That is why the expensive part of this system grows with{" "}
            <span className="text-foreground">how much happened today</span>, not with how many
            people subscribed. The part that does grow per person is one short paragraph, which is
            the cheapest thing a model can be asked for.
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

type Beat = { time: string; what: string; detail: string };

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
      "Different headlines, same announcement. Trigram similarity flags them as candidates; a model confirms they describe one event.",
  },
  {
    time: "14:11",
    what: "The event is analysed",
    detail:
      "What happened, what it changes, importance 8.4, novelty 7.1, topics assigned. This is the only time the story is read at length.",
  },
  {
    time: "14:11",
    what: "Thirty-one more pile in",
    detail:
      "Aggregators and follow-ups. They attach to the existing event as further sources. No new analysis, no new cost.",
  },
  {
    time: "14:12",
    what: "Matched against you",
    detail:
      "Importance 8.4 clears your density threshold, the topic is one you follow, and none of your excluded terms appear. It is queued for your briefing.",
  },
  {
    time: "07:30",
    what: "You read one paragraph",
    detail:
      "Written for you, saying why this matters given what you follow — with all thirty-eight sources one tap away.",
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
              style={{ background: i >= 4 ? "var(--signal)" : "var(--border)" }}
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
