import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminOnly, audit, AdminAuthError } from "@/lib/server/guard";
import type { SourceTopic, Topic } from "@/lib/supabase/types";

/**
 * Source→topic graph administration (0018_source_topic_graph.sql).
 *
 * `source_topics` is global content, same shape as `event_topics`: readable by
 * any signed-in reader, writable only by the service role. There is no policy
 * that would let a browser write it directly — every mutation here goes
 * through `adminOnly` and the service-role client on `context.actor.db`.
 *
 * This is groundwork for demand visibility (docs/track.md phase 4), not a
 * behaviour change on its own: nothing in the pipeline reads this table yet.
 */

/* ---------------------------------------------------------------------- */
/* Read                                                                   */
/* ---------------------------------------------------------------------- */

/** The whole controlled vocabulary. Small table — fits in one response. */
export const listTopicsForAdmin = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<Topic[]> => {
    const { data, error } = await context.actor.db
      .from("topics")
      .select("*")
      .order("label", { ascending: true });

    if (error) throw new AdminAuthError(`List topics: ${error.message}`, 500);
    return data ?? [];
  });

/**
 * Every source→topic row. One query for the whole graph rather than one per
 * source — with ~70 sources and a handful of topics each, the join is small
 * enough to ship whole and let the page group it client-side, matching how
 * `listSources` already treats the source list itself.
 */
export const listSourceTopics = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<SourceTopic[]> => {
    const { data, error } = await context.actor.db.from("source_topics").select("*");
    if (error) throw new AdminAuthError(`List source topics: ${error.message}`, 500);
    return data ?? [];
  });

/**
 * How many currently-eligible readers a source reaches (0020, extended 0030).
 * `interested_users` is the union of topic interest and explicit follows;
 * `direct_followers` is the follows alone — the strongest demand signal there
 * is, since somebody asked for that source by name.
 */
export type SourceDemand = {
  source_id: string;
  interested_users: number;
  paid_interested_users: number;
  direct_followers: number;
};

/**
 * Reads `admin_source_demand()` (0020). Same "missing function" fallback as
 * `listSources` uses for 0007: a database that has not had 0020 applied yet
 * gets `null` rows back rather than an error, so the console degrades to
 * "—" instead of locking an operator out of the whole page.
 */
export const listSourceDemand = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<SourceDemand[] | null> => {
    const { data, error } = await context.actor.db.rpc("admin_source_demand");
    if (error) return null;
    return data ?? [];
  });

/* ---------------------------------------------------------------------- */
/* Write                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Add or re-confidence one source→topic link. `upsert` rather than
 * insert-then-update: an operator raising a topic's confidence on a source
 * that is already mapped is the common case, not an error.
 */
export const setSourceTopic = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    z
      .object({
        sourceId: z.string().uuid(),
        topicId: z.string().uuid(),
        confidence: z.number().min(0).max(1).default(0.8),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    const { error } = await actor.db.from("source_topics").upsert(
      {
        source_id: data.sourceId,
        topic_id: data.topicId,
        confidence: data.confidence,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source_id,topic_id" },
    );

    if (error) throw new AdminAuthError(`Set source topic: ${error.message}`, 500);

    await audit(
      actor,
      "source.topic.set",
      { type: "source", id: data.sourceId },
      { topic_id: data.topicId, confidence: data.confidence },
    );

    return { ok: true };
  });

export const removeSourceTopic = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    z.object({ sourceId: z.string().uuid(), topicId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    const { error } = await actor.db
      .from("source_topics")
      .delete()
      .eq("source_id", data.sourceId)
      .eq("topic_id", data.topicId);

    if (error) throw new AdminAuthError(`Remove source topic: ${error.message}`, 500);

    await audit(
      actor,
      "source.topic.remove",
      { type: "source", id: data.sourceId },
      {
        topic_id: data.topicId,
      },
    );

    return { ok: true };
  });
