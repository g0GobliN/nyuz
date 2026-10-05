import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signedInOnly } from "@/lib/server/guard";
import { BASE_WEIGHT, weightsFromSignals, type FeedbackVote } from "@/lib/feedback-weights";
import { validateTopicLabel } from "@/lib/topics";
import type { Actor } from "@/lib/server/guard";

/**
 * The reader's own signals, and what they do to future briefings.
 *
 * Before this, `feedback-store.ts` described itself as standing in for the
 * server-side personalisation loop: thumbs and saves went to `localStorage`
 * under one key, so clearing site data erased every signal a reader had ever
 * given, and the pipeline never saw any of it. The `feedback` and
 * `saved_stories` tables have been in `0001_init.sql` the whole time, unused.
 *
 * ---------------------------------------------------------------------------
 * Ownership is enforced here, not by RLS
 * ---------------------------------------------------------------------------
 *
 * `context.actor.db` is the SERVICE-ROLE client — `resolveActor` builds it with
 * `createAdminClient()` and hands the same one to every handler. Row-level
 * security does not apply to it. The "own feedback" and "own saved stories"
 * policies in `0002_rls.sql` are therefore not what protects these tables from
 * this code path; they protect them from a browser holding an anon key.
 *
 * What protects them here is that every statement below is filtered or keyed by
 * `actor.id`, which comes from a JWT whose signature `resolveActor` has already
 * verified. Deletes carry `.eq("user_id", actor.id)`, upserts write `user_id`
 * explicitly, and the `user_topics` update is scoped by both user and topic.
 *
 * **Dropping one of those filters would expose or overwrite another reader's
 * rows, silently and with no error.** If a query is added to this file, it needs
 * the same scoping, and it does not get it for free.
 *
 * ---------------------------------------------------------------------------
 * Writing a weight is part of voting, not a later job
 * ---------------------------------------------------------------------------
 *
 * `recomputeWeights` runs inside the same call that stores the vote, rather than
 * on a schedule. Two reasons.
 *
 * The pipeline's triggers are already full — `STAGES_CRON` packs four stages
 * onto shared minutes because Cloudflare registers a limited number of them, so
 * "add a cron for this" is not free the way it sounds.
 *
 * More importantly, a reader who presses a thumb has done the one thing this
 * product asks of them, and the change should be true immediately. A vote that
 * takes until tomorrow to mean anything is indistinguishable from one that was
 * dropped.
 *
 * The cost is one small query per vote, over rows that are already indexed by
 * user.
 */

const voteValues = ["useful", "not_useful", "not_interested"] as const;

const voteInput = z.object({
  eventId: z.string().uuid(),
  /** `null` clears the vote — the story page toggles a thumb off. */
  vote: z.enum(voteValues).nullable(),
});

const saveInput = z.object({
  eventId: z.string().uuid(),
  saved: z.boolean(),
});

const dismissInput = z.object({
  eventId: z.string().uuid(),
  dismissed: z.boolean(),
});

const muteTopicInput = z.object({
  topic: z.string().min(1).max(80),
  muted: z.boolean(),
});

const engagementInput = z.object({
  eventId: z.string().uuid(),
  /** Times the story was rendered to the reader since the last flush. */
  impressions: z.number().int().min(0).max(100).optional(),
  /** True when this flush represents the story page being opened. */
  opened: z.boolean().optional(),
  /** Foreground milliseconds accumulated since the last flush. */
  readMs: z.number().int().min(0).optional(),
  reachedEnd: z.boolean().optional(),
});

/**
 * Ceiling on one flush of reading time.
 *
 * Ten minutes is longer than any story here takes to read, so a legitimate
 * session is never truncated, while a tab left open for a day contributes the
 * same as a thorough read rather than drowning out everything else.
 */
const MAX_READ_MS_PER_FLUSH = 600_000;

/** `impressions` and `open_count` are smallint. Saturate rather than overflow. */
function clampSmallInt(value: number): number {
  return Math.min(32_000, Math.max(0, Math.round(value)));
}

export type ReaderFeedback = {
  votes: Record<string, FeedbackVote>;
  saved: string[];
  dismissed: string[];
  mutedTopics: string[];
};

export const EMPTY_READER_FEEDBACK: ReaderFeedback = {
  votes: {},
  saved: [],
  dismissed: [],
  mutedTopics: [],
};

/* ---------------------------------------------------------------------- */
/* Reads                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Every vote and save this reader has. Hydrates the store on load, which is
 * what makes the thumbs survive a new browser.
 */
export const loadFeedback = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<ReaderFeedback> => {
    const [votes, saved, dismissed, mutedTopics] = await Promise.all([
      context.actor.db.from("feedback").select("event_id, vote").eq("user_id", context.actor.id),
      context.actor.db
        .from("saved_stories")
        .select("event_id")
        .eq("user_id", context.actor.id)
        .order("saved_at", { ascending: false }),
      context.actor.db.from("dismissed_stories").select("event_id").eq("user_id", context.actor.id),
      context.actor.db.from("muted_topics").select("topic").eq("user_id", context.actor.id),
    ]);

    // A read failure here means an empty feedback panel, not a broken page. The
    // story itself has already rendered by the time this resolves.
    if (votes.error || saved.error || dismissed.error || mutedTopics.error) {
      return EMPTY_READER_FEEDBACK;
    }

    const map: Record<string, FeedbackVote> = {};
    for (const row of votes.data ?? []) {
      map[row.event_id] = row.vote as FeedbackVote;
    }

    return {
      votes: map,
      saved: (saved.data ?? []).map((row) => row.event_id),
      dismissed: (dismissed.data ?? []).map((row) => row.event_id),
      mutedTopics: (mutedTopics.data ?? []).map((row) => row.topic),
    };
  });

/* ---------------------------------------------------------------------- */
/* Writes                                                                 */
/* ---------------------------------------------------------------------- */

export const saveVote = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => voteInput.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    if (data.vote === null) {
      const { error } = await actor.db
        .from("feedback")
        .delete()
        .eq("user_id", actor.id)
        .eq("event_id", data.eventId);
      if (error) throw new Error(error.message);
    } else {
      // `(user_id, event_id)` is the primary key, so an upsert on it is what
      // makes changing your mind replace the old vote instead of failing.
      const { error } = await actor.db.from("feedback").upsert(
        {
          user_id: actor.id,
          event_id: data.eventId,
          vote: data.vote,
        },
        { onConflict: "user_id,event_id" },
      );
      if (error) throw new Error(error.message);
    }

    await recomputeWeights(actor, data.eventId);
    return { ok: true };
  });

export const saveStory = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => saveInput.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    if (data.saved) {
      const { error } = await actor.db
        .from("saved_stories")
        .upsert(
          { user_id: actor.id, event_id: data.eventId },
          { onConflict: "user_id,event_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await actor.db
        .from("saved_stories")
        .delete()
        .eq("user_id", actor.id)
        .eq("event_id", data.eventId);
      if (error) throw new Error(error.message);
    }

    // Saving is a bookmark, not a judgement. It deliberately does not move a
    // weight: people save things to read later, including stories they are not
    // sure about, and reading that as approval would teach the wrong lesson.
    return { ok: true };
  });

export const saveDismissed = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => dismissInput.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    if (data.dismissed) {
      const { error } = await actor.db
        .from("dismissed_stories")
        .upsert(
          { user_id: actor.id, event_id: data.eventId },
          { onConflict: "user_id,event_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await actor.db
        .from("dismissed_stories")
        .delete()
        .eq("user_id", actor.id)
        .eq("event_id", data.eventId);
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

export const saveMutedTopic = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => muteTopicInput.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    // Only a real topic label may be stored: the veto in the matcher is exact
    // on the label against an event's own topic links, so a string that is not
    // a canonical label could never fire anyway — it would just consume the
    // cap. `validateTopicLabel` also trims, which keeps the stored form the
    // same string the cards display.
    const validated = validateTopicLabel(data.topic);
    if ("rejected" in validated) throw new Error("That is not a topic that can be muted.");

    // The write goes through `save_muted_topic` (0109), which owns the cap and
    // the lock, because a number here would be a display value rather than a
    // guard. A full set refuses the save, and the client's rollback is the
    // visible answer.
    const { data: result, error } = await actor.db.rpc("save_muted_topic", {
      p_user_id: actor.id,
      p_topic: validated.label,
      p_muted: data.muted,
    });
    if (error) throw new Error(error.message);
    if (result === "limit")
      throw new Error("You have muted a lot of topics already. Unmute one first.");

    return { ok: true };
  });

/**
 * Records what the reader did, without ever asking them anything.
 *
 * This is the main input to the loop. The thumbs are a bonus that a reader may
 * never touch; impressions, opens and dwell arrive on their own from ordinary
 * use, which is the only way a briefing gets better for someone who does not
 * want to be surveyed about it.
 *
 * Counts are added rather than set, so a lost or duplicated flush costs a little
 * accuracy and never corrupts the record. `read_ms` is capped per call for the
 * same reason: a tab left open on a story overnight is not forty minutes of
 * reading, and without a ceiling one forgotten tab would outweigh a month of
 * real use.
 *
 * Failures are silent by design. Nothing the reader can see depends on this, and
 * an error toast about analytics would be both useless and alarming.
 */
export const recordEngagement = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => engagementInput.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    try {
      const { data: existing } = await actor.db
        .from("user_events")
        .select("impressions, open_count, read_ms, reached_end, opened_at")
        .eq("user_id", actor.id)
        .eq("event_id", data.eventId)
        .maybeSingle();

      // Only stories already matched to this reader are tracked. An unmatched
      // row would be a story we never chose to show them, and inventing one here
      // would let a crafted request write arbitrary rows into `user_events`.
      if (!existing) return { ok: true };

      const readMs = Math.min(data.readMs ?? 0, MAX_READ_MS_PER_FLUSH);
      const opened = data.opened === true;

      await actor.db
        .from("user_events")
        .update({
          impressions: clampSmallInt((existing.impressions ?? 0) + (data.impressions ?? 0)),
          open_count: clampSmallInt((existing.open_count ?? 0) + (opened ? 1 : 0)),
          opened_at: existing.opened_at ?? (opened ? new Date().toISOString() : null),
          read_ms: (existing.read_ms ?? 0) + readMs,
          // Sticky: having reached the end of a story once is a fact about it.
          reached_end: existing.reached_end === true || data.reachedEnd === true,
          engaged_at: new Date().toISOString(),
        })
        .eq("user_id", actor.id)
        .eq("event_id", data.eventId);

      // Only worth recomputing when something happened that can move a weight.
      if (opened || readMs > 0 || data.reachedEnd) {
        await recomputeWeights(actor, data.eventId);
      }
    } catch {
      /* Observation is best-effort. The reader must never see this fail. */
    }

    return { ok: true };
  });

/**
 * Wipes every stored signal and returns each affected topic to its base weight.
 *
 * The settings page offers this, and it has to mean what it says: deleting the
 * votes while leaving the weights they produced would keep personalising from
 * data the reader believes they erased.
 */
export const clearFeedback = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { actor } = context;

    await actor.db.from("feedback").delete().eq("user_id", actor.id);
    await actor.db.from("saved_stories").delete().eq("user_id", actor.id);
    await actor.db.from("dismissed_stories").delete().eq("user_id", actor.id);
    await actor.db.from("muted_topics").delete().eq("user_id", actor.id);

    // Behaviour drives the weights too, so clearing only the votes would leave
    // the product personalising from data the reader believes they erased. The
    // match itself is kept — that is the pipeline's record of what it chose to
    // show, not a record of what the reader did.
    await actor.db
      .from("user_events")
      .update({
        impressions: 0,
        open_count: 0,
        opened_at: null,
        read_ms: 0,
        reached_end: false,
        engaged_at: null,
      })
      .eq("user_id", actor.id);

    // With no votes left, every topic's weight is BASE_WEIGHT by definition, so
    // this needs no per-topic arithmetic.
    const { error } = await actor.db
      .from("user_topics")
      .update({ weight: BASE_WEIGHT })
      .eq("user_id", actor.id)
      .neq("weight", BASE_WEIGHT);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/* ---------------------------------------------------------------------- */
/* The loop itself                                                        */
/* ---------------------------------------------------------------------- */

/**
 * Rewrites `user_topics.weight` for every topic the given event touches.
 *
 * Scoped to that event's topics rather than all of them: a vote cannot change
 * the weight of a topic the story was not about, so recomputing the rest would
 * be work with a guaranteed no-op result.
 *
 * Failures are swallowed. The vote is already stored by the time this runs, and
 * losing a weight update is recoverable — the next vote on the same topic
 * recomputes from the full set and repairs it, because nothing here is
 * incremental. Throwing instead would show the reader an error for a thumb that
 * was in fact recorded.
 */
async function recomputeWeights(actor: Actor, eventId: string): Promise<void> {
  try {
    const { data: eventTopics } = await actor.db
      .from("event_topics")
      .select("topic_id")
      .eq("event_id", eventId);

    const topicIds = (eventTopics ?? []).map((row) => row.topic_id);
    if (topicIds.length === 0) return;

    // Only topics this reader actually follows. An event can be tagged with
    // things they have never selected, and `user_topics` has no row to weight.
    const { data: followed } = await actor.db
      .from("user_topics")
      .select("topic_id, weight")
      .eq("user_id", actor.id)
      .in("topic_id", topicIds);

    const mine = followed ?? [];
    if (mine.length === 0) return;

    const [votes, seen, links] = await Promise.all([
      actor.db.from("feedback").select("event_id, vote").eq("user_id", actor.id),
      actor.db
        .from("user_events")
        .select("event_id, impressions, open_count, read_ms, reached_end")
        .eq("user_id", actor.id),
      actor.db
        .from("event_topics")
        .select("event_id, topic_id")
        .in(
          "topic_id",
          mine.map((row) => row.topic_id),
        ),
    ]);

    const topicsOf = new Map<string, string[]>();
    for (const row of links.data ?? []) {
      const list = topicsOf.get(row.event_id);
      if (list) list.push(row.topic_id);
      else topicsOf.set(row.event_id, [row.topic_id]);
    }

    // One signal per story, behaviour and vote merged. Every matched event is
    // included even when nothing has happened to it, because "shown and ignored"
    // is itself an input and only `user_events` knows it was shown.
    const votedOn = new Map<string, string>();
    for (const row of votes.data ?? []) votedOn.set(row.event_id, row.vote);

    const signals = (seen.data ?? []).map((row) => ({
      eventId: row.event_id,
      vote: votedOn.get(row.event_id) ?? null,
      impressions: row.impressions ?? 0,
      openCount: row.open_count ?? 0,
      readMs: row.read_ms ?? 0,
      reachedEnd: row.reached_end ?? false,
    }));

    // A vote can exist for a story that was never matched to this reader — an
    // alert, say. Those carry no impression data but still count.
    for (const [eventId, vote] of votedOn) {
      if (!signals.some((s) => s.eventId === eventId)) {
        signals.push({
          eventId,
          vote,
          impressions: 0,
          openCount: 0,
          readMs: 0,
          reachedEnd: false,
        });
      }
    }

    const weights = weightsFromSignals(signals, topicsOf);

    for (const row of mine) {
      // A topic with no votes left falls back to base rather than keeping the
      // number an earlier vote gave it. This is what makes un-voting undo.
      const next = weights.get(row.topic_id) ?? BASE_WEIGHT;
      if (row.weight === next) continue;
      await actor.db
        .from("user_topics")
        .update({ weight: next })
        .eq("user_id", actor.id)
        .eq("topic_id", row.topic_id);
    }
  } catch {
    /* The vote is stored; the next one repairs the weight. */
  }
}
