import { describe, expect, it } from "vitest";
import { thresholdFor } from "@/lib/density";
import type { Candidate, Reader, ReaderTopic } from "@/lib/pipeline/match";
import { decide } from "@/lib/pipeline/match";
import { promotionVerdict } from "@/lib/pipeline/scoring-shadow";
import {
  MIN_BASELINE_EVENTS,
  SUBJECT_SIGNIFICANT_FLOOR,
  ageInHours,
  alertEligible,
  briefingScore,
  historyFrom,
  magnitudePercentile,
  observationsFor,
  readerNovelty,
  relevanceStrength,
  significanceShadow,
  subjectSignificance,
  type SignificanceRow,
  type SubjectObservations,
} from "@/lib/pipeline/subject-significance";
import { deriveSpecFromTerms, evaluateSpec } from "@/lib/match-spec";
import { normaliseText } from "@/lib/topics";

/**
 * Significance, for a subject nobody wrote a rule about.
 *
 * ---------------------------------------------------------------------------
 * The property this file exists for
 * ---------------------------------------------------------------------------
 *
 * One mechanism has to serve a language release, an album, a transfer, a
 * preprint and a bus route, and it may not contain a word that knows which of
 * those it is looking at. So the fixtures below are all in the same shape --
 * markers and magnitudes against a subject's own history -- and the *same*
 * assertions are made about software, music, football, science and transport.
 *
 * The test that matters most is the negative one: a reprint of facts the
 * subject's coverage already carried scores zero. If that ever stops holding,
 * every subject starts promoting its own back catalogue.
 */

/** An observation, spelled the way the revision model already spells one. */
function obs(markers: string[], magnitudes: string[] = []): SubjectObservations {
  return { markers, magnitudes };
}

/* -------------------------------------------------------------------------- */
/* The subject is its own baseline                                             */
/* -------------------------------------------------------------------------- */

describe("a first occurrence for the subject is a development", () => {
  /**
   * Six events of one subject: announcements and patch releases, plus one
   * security fix, which is the marker that counts as rare below.
   */
  const history = historyFrom([
    obs(["release_announced"]),
    obs(["release_announced", "released"]),
    obs(["release_patch", "released"]),
    obs(["release_announced"]),
    obs(["release_patch", "security_fix"]),
    obs(["release_announced", "released"]),
  ]);

  it("scores the release candidate that this subject has never carried", () => {
    // The flagship case, domain-free: the subject's own coverage contains
    // announcements and patches, and a release candidate is a transition it has
    // never reported. Nothing here knows the subject is a programming language.
    const result = subjectSignificance(obs(["release_candidate"]), history);
    expect(result.firstTime).toContain("release_candidate");
    expect(result.score).toBeGreaterThanOrEqual(SUBJECT_SIGNIFICANT_FLOOR);
    expect(result.reasons.some((reason) => reason.includes("first release_candidate"))).toBe(true);
  });

  it("scores zero for a reprint of facts the subject already carried", () => {
    // The collapse case. An outlet re-running the same facts carries the same
    // markers, so there is no first occurrence, no rarity and no new magnitude.
    // If this ever scores, reprints become developments and readers get their
    // own history back as news.
    const reprint = subjectSignificance(obs(["release_announced", "released"]), history);
    expect(reprint.firstTime).toEqual([]);
    expect(reprint.score).toBe(0);
  });

  it("scores a rare transition below the floor on rarity alone", () => {
    // Seen once in six events is unusual (below `RARE_SHARE`) but it is not a
    // first occurrence, and one point must not clear a two-point floor: rarity
    // is a hint, and hints do not admit.
    const rare = subjectSignificance(obs(["security_fix"]), history);
    expect(rare.rare).toContain("security_fix");
    expect(rare.firstTime).toEqual([]);
    expect(rare.score).toBeLessThan(SUBJECT_SIGNIFICANT_FLOOR);
  });

  it("claims nothing at all from too little history", () => {
    // A subject seen twice has no "usual". Everything looks like a first
    // occurrence, which would make a brand-new topic's first events maximally
    // significant and its reader's briefing a firehose.
    const thin = historyFrom([obs(["release_announced"]), obs(["release_patch"])]);
    const result = subjectSignificance(obs(["release_candidate", "released"]), thin);
    expect(thin.events).toBeLessThan(MIN_BASELINE_EVENTS);
    expect(result.firstTime).toEqual([]);
    expect(result.score).toBe(0);
    expect(subjectSignificance(obs(["release_candidate"]), historyFrom([])).score).toBe(0);
  });
});

describe("magnitude is measured against the subject, not the world", () => {
  const history = historyFrom([
    obs([], ["count:1", "money:7"]),
    obs([], ["count:2", "money:8"]),
    obs([], ["count:3", "money:7"]),
    obs([], ["count:2", "money:8"]),
    obs([], ["count:1", "money:7"]),
    obs([], ["count:2", "money:8"]),
  ]);

  it("ranks the event's numbers inside the subject's own range, dimension by dimension", () => {
    // "Bigger than this subject's usual numbers" is the same rule for a funding
    // round, a casualty count and a stadium capacity, which is why it is stated
    // in buckets rather than in units.
    expect(magnitudePercentile(["count:4"], history.magnitudes)).toBe(1);

    const top = subjectSignificance(obs([], ["count:4"]), history);
    expect(top.magnitudePercentile).toBe(1);
    expect(top.score).toBeGreaterThanOrEqual(2);

    // A number at the top of the range but not beyond it: high, not top.
    const high = subjectSignificance(obs([], ["count:3"]), history);
    expect(high.magnitudePercentile).toBeGreaterThan(0.7);
    expect(high.score).toBeLessThan(top.score as number);
  });

  it("has no opinion when there is nothing to compare with", () => {
    // No numbers, or no observed numbers, is absence of evidence. Returning 1
    // would make every first story about a subject "top of range".
    expect(magnitudePercentile(["count:4"], [])).toBeNull();
    expect(magnitudePercentile([], history.magnitudes)).toBeNull();
    expect(
      subjectSignificance(obs(["release_candidate"]), historyFrom([])).magnitudePercentile,
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* One mechanism, every domain                                                 */
/* -------------------------------------------------------------------------- */

describe("the same rule serves software, music, football, science and transport", () => {
  /**
   * One fixture per domain, in the identical shape. Nothing branches on which
   * is which: the marker names are the shared material vocabulary, and the
   * significance model never reads them as anything but strings.
   */
  const SUBJECTS: { name: string; carried: string[][]; development: string }[] = [
    {
      name: "a programming language",
      carried: [
        ["release_announced"],
        ["release_patch"],
        ["release_announced"],
        ["release_patch"],
        ["released"],
      ],
      development: "release_candidate",
    },
    {
      name: "a band",
      carried: [
        ["release_announced"],
        ["touring"],
        ["release_announced"],
        ["released"],
        ["touring"],
      ],
      development: "album_released",
    },
    {
      name: "a football club",
      carried: [
        ["deal_announced"],
        ["deal_announced"],
        ["deal_confirmed"],
        ["injury"],
        ["deal_announced"],
      ],
      development: "transfer_confirmed",
    },
    {
      name: "a scientific field",
      carried: [["preprint"], ["preprint"], ["preprint"], ["published"], ["preprint"]],
      development: "peer_reviewed",
    },
    {
      name: "a transit network",
      carried: [
        ["consultation"],
        ["deal_announced"],
        ["consultation"],
        ["consultation"],
        ["deal_announced"],
      ],
      development: "route_enacted",
    },
  ];

  it("treats each subject's own new transition as a development, and its reprints as nothing", () => {
    for (const subject of SUBJECTS) {
      const history = historyFrom(subject.carried.map((markers) => obs(markers)));
      const development = subjectSignificance(obs([subject.development]), history);
      expect(development.score, subject.name).toBeGreaterThanOrEqual(SUBJECT_SIGNIFICANT_FLOOR);

      // And the same facts again, which is what a reprint is.
      const reprint = subjectSignificance(obs(subject.carried[0] as string[]), history);
      expect(reprint.score, `${subject.name} reprint`).toBe(0);
    }
  });

  it("reads the development out of real coverage rather than out of a domain word", () => {
    // The integration point: `observationsFor` is `materialState`'s own input, so
    // significance and revision detection can never disagree about what moved.
    const text =
      "Rust 2.0 release candidate published. The first release candidate is now available.";
    expect(observationsFor(text).markers).toContain("release_candidate");

    const history = historyFrom([
      obs(["release_announced"]),
      obs(["release_announced"]),
      obs(["release_patch"]),
      obs(["release_patch"]),
      obs(["released"]),
    ]);
    expect(subjectSignificance(observationsFor(text), history).score).toBeGreaterThanOrEqual(
      SUBJECT_SIGNIFICANT_FLOOR,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The consumer rule                                                           */
/* -------------------------------------------------------------------------- */

describe("the interest-conditional rule raises a topic's score and never lowers it", () => {
  it("lets a subject-significant development clear the floor that suppressed it", () => {
    // The product failure this exists to fix: a major release for the subject's
    // followers, invisible to everyone else, suppressed by a world-news score.
    const signals = {
      importance: 2,
      relevanceStrong: true,
      subject: SUBJECT_SIGNIFICANT_FLOOR,
      novelty: 1,
    };
    expect(briefingScore(signals)).toBe(3);
    expect(briefingScore(signals)).toBeGreaterThanOrEqual(thresholdFor(30));
  });

  it("still requires the interest to have matched firmly", () => {
    // A single common word in a broad interest is not evidence that an event is
    // about the subject, so it cannot promote one.
    expect(briefingScore({ importance: 2, relevanceStrong: false, subject: 5, novelty: 1 })).toBe(
      2,
    );
  });

  it("does not make an ordinary story about the subject significant", () => {
    expect(briefingScore({ importance: 2, relevanceStrong: true, subject: 0, novelty: 1 })).toBe(2);
  });

  it("leaves high-importance events exactly as they were", () => {
    // The world-facing accelerator is unchanged: an earthquake needs no interest
    // to be admitted, and no interest can raise or lower its score.
    const earthquake = { importance: 9, relevanceStrong: false, subject: 0, novelty: 1 };
    expect(briefingScore(earthquake)).toBe(9);
    expect(alertEligible(earthquake)).toBe(true);
    expect(briefingScore({ importance: 6, relevanceStrong: false, subject: 0, novelty: 1 })).toBe(
      6,
    );
    expect(alertEligible({ importance: 6, relevanceStrong: false, subject: 0, novelty: 1 })).toBe(
      true,
    );
  });

  it("alerts on a subject development the reader has not received", () => {
    const signals = { importance: 2, relevanceStrong: true, subject: 4, novelty: 1 };
    expect(alertEligible(signals)).toBe(true);
    // Already delivered: nothing new to interrupt with.
    expect(alertEligible({ ...signals, novelty: 0 })).toBe(false);
  });

  it("keeps novelty a property of the reader, not of the event", () => {
    // The event's own `novelty` is shared and says the story is fresh; what
    // makes an update worth re-delivering is the revision this reader holds.
    expect(readerNovelty(null, 0)).toBe(1);
    expect(readerNovelty(3, 3)).toBe(0);
    expect(readerNovelty(3, 4)).toBe(1);
    expect(readerNovelty(4, 3)).toBe(0);
  });

  it("measures freshness from when the development happened", () => {
    // Not from discovery. A development published a week ago and ingested this
    // morning is a week old, and dating it from ingestion is the bug this whole
    // layer exists to remove.
    const now = new Date("2026-09-25T12:00:00Z");
    expect(ageInHours("2026-09-24T12:00:00Z", "2026-09-01T00:00:00Z", now)).toBe(24);
    expect(ageInHours(null, "2026-09-24T12:00:00Z", now)).toBe(24);
    expect(ageInHours(null, "not a date", now)).toBeNull();
  });

  it("builds relevance strength from the specification, not from a threshold on length", () => {
    const conjunction = deriveSpecFromTerms(["india", "china"]);
    const single = deriveSpecFromTerms(["nepal"]);
    const text = normaliseText("India and China held border talks");

    expect(relevanceStrength(conjunction, evaluateSpec(conjunction, text)).strong).toBe(true);
    // One word, one group, no alias: not strong. That is the case where widening
    // admission would be most tempting and most wrong.
    expect(relevanceStrength(single, evaluateSpec(single, text)).strong).toBe(false);

    const withAlias = {
      v: 1 as const,
      require: [[{ text: "arsenal" }, { text: "gunners" }]],
      optional: [{ text: "emirates" }],
    };
    const aliasText = normaliseText("The Emirates hosts a match");
    // "emirates" alone does not admit, so the spec does not match at all here.
    expect(evaluateSpec(withAlias, aliasText).matched).toBe(false);

    const both = normaliseText("Gunners win at the Emirates");
    expect(relevanceStrength(withAlias, evaluateSpec(withAlias, both)).strong).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The switch, and the shadow that has to be read before it is thrown          */
/* -------------------------------------------------------------------------- */

const TOPIC: ReaderTopic = {
  topicId: "t-rust",
  slug: "rust",
  label: "Rust",
  kind: "predefined",
  terms: [],
  spec: null,
  importance: "notable",
  weight: 1,
  keywords: [],
  excludeKeywords: [],
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    eventId: "e-rust-2-0-rc",
    title: "Rust 2.0 release candidate published",
    whatHappened: "The first Rust 2.0 release candidate is available.",
    importance: 2,
    novelty: 1,
    firstSeenAt: "2026-09-25T06:00:00Z",
    materialRevision: 1,
    materialOccurrenceAt: "2026-09-25T05:00:00Z",
    tags: [],
    topics: [{ id: "t-rust", slug: "rust", label: "Rust" }],
    sources: [{ id: "s1", name: "Rust Blog" }],
    ...overrides,
  };
}

function readerTopic(overrides: Partial<ReaderTopic> = {}): ReaderTopic {
  return { ...TOPIC, ...overrides };
}

function reader(overrides: Partial<Reader> = {}): Reader {
  return {
    userId: "reader",
    density: 35,
    topics: [TOPIC],
    exclusions: [],
    sourcePrefs: new Map(),
    ...overrides,
  };
}

describe("the interest-conditional rule is off until a context says otherwise", () => {
  it("refuses without a context, and admits with one", () => {
    // The property that has to hold for shadowing to mean anything: enabling the
    // rule is a decision, made in one place (`decide`'s optional context, which
    // `match()` supplies only when the feature flag is on). Nothing about the
    // default path changes.
    const event = candidate();
    const topic = readerTopic();
    const interests = reader({ topics: [topic] });

    expect(decide(event, interests)).toEqual({ matched: false, reason: "below-threshold" });

    const context = {
      observations: new Map([
        ["e-rust-2-0-rc", observationsFor(`${event.title}\n${event.whatHappened}`)],
      ]),
      history: new Map([
        [
          "t-rust",
          historyFrom([
            obs(["release_announced"]),
            obs(["release_patch"]),
            obs(["release_announced"]),
            obs(["release_patch"]),
            obs(["released"]),
          ]),
        ],
      ]),
      significant: () =>
        subjectSignificance(observationsFor(event.title), historyFrom([obs(["release_announced"])]))
          .score,
    };

    // With the baselines supplied the same event clears the same floor, because
    // the subject term lifts it -- and only for the topic that matched it.
    const admitted = decide(event, interests, {
      ...context,
      significant: () => 2,
    });
    expect(admitted.matched).toBe(true);

    const otherTopic = readerTopic({ topicId: "t-python", slug: "python", label: "Python" });
    expect(
      decide(event, reader({ topics: [otherTopic] }), { ...context, significant: () => 2 }),
    ).toEqual({ matched: false, reason: "no-topic-match" });
  });
});

describe("the shadow reports what turning it on would change, before it is turned on", () => {
  /** One release (low importance, subject-significant), one world event, one reprint. */
  const rows: SignificanceRow[] = [
    {
      eventId: "rust-2-0-rc",
      importance: 2,
      novelty: 1,
      relevanceStrong: true,
      subject: SUBJECT_SIGNIFICANT_FLOOR,
      deliveredRevision: null,
      currentRevision: 1,
    },
    {
      eventId: "earthquake",
      importance: 9,
      novelty: 1,
      relevanceStrong: false,
      subject: 0,
      deliveredRevision: null,
      currentRevision: 0,
    },
    {
      eventId: "reprint",
      importance: 2,
      novelty: 0,
      relevanceStrong: true,
      subject: 0,
      deliveredRevision: 1,
      currentRevision: 1,
    },
  ];

  it("produces the shared shadow report", () => {
    const shadow = significanceShadow(rows);
    expect(shadow.report.events).toBe(3);
    // Every floor the product uses, plus the alert floor called out separately.
    expect(shadow.report.admission).toHaveLength(4);
    expect(shadow.report.admission.map((m) => m.floor)).toEqual([6, 3, 1, 0]);
    expect(shadow.report.distribution.ai[2]).toBe(2);
    expect(shadow.changedAdmissions).toBe(1);
  });

  it("names the events whose alert behaviour would change, and why", () => {
    const shadow = significanceShadow(rows);
    expect(shadow.alertChanges.before).toBe(1);
    expect(shadow.alertChanges.after).toBe(2);
    expect(shadow.alertChanges.gained).toEqual(["rust-2-0-rc"]);
    // The asymmetry that protects the product: the interest-conditional rule can
    // never silence a genuinely important event.
    expect(shadow.alertChanges.lost).toEqual([]);
  });

  it("gives a promotion verdict a human reads before flipping the flag", () => {
    // `promotionVerdict` is the gate, and it reports blockers rather than a
    // boolean. On a corpus where the new rule only adds, it passes; the point of
    // asserting it here is that the shadow is measured against the same gate the
    // deterministic scorer had to pass.
    const verdict = promotionVerdict(significanceShadow(rows).report);
    expect(verdict.blockers.filter((blocker) => blocker.startsWith("Alert miss rate"))).toEqual([]);
    expect(typeof verdict.ready).toBe("boolean");
  });

  it("counts a new revision as novel for the reader who holds the old one", () => {
    const shadow = significanceShadow([
      {
        eventId: "revision",
        importance: 3,
        novelty: 0,
        relevanceStrong: true,
        subject: 0,
        deliveredRevision: 2,
        currentRevision: 3,
      },
    ]);
    expect(shadow.report.events).toBe(1);
    // Novelty here is reader-relative, so the row is scored as novel.
    expect(shadow.report.distribution.deterministic[3]).toBe(1);
  });
});
