import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminOnly, audit, AdminAuthError } from "@/lib/server/guard";
import type { Json } from "@/lib/supabase/types";
import {
  MatchSpecError,
  acceptPromotions,
  promotionEvidence,
  resetTopicMatchSpec,
  writeTopicMatchSpec,
  type PromotionReport,
} from "@/lib/match-spec-store";

/**
 * The operator's side of the match-spec lifecycle (0100).
 *
 * Four actions, each a thin shell over `match-spec-store.ts`, which owns the
 * validation and the write. Every one is `adminOnly` -- the security boundary --
 * and every mutation writes an `admin_audit_log` row. There is no reader-facing
 * path: what a topic *means* is shared by everyone who follows it, so changing it
 * is an editorial act.
 *
 * Nothing here calls a model. An "enriched" spec is one an operator wrote or the
 * topic's own coverage earned through promotion; neither buys a provider call.
 */

const topicIdInput = z.object({ topicId: z.string().uuid() });

function asConsoleError(error: unknown): never {
  if (error instanceof MatchSpecError) throw new AdminAuthError(error.message, error.status);
  throw error;
}

/** Store an explicit specification for a custom topic. */
export const setTopicMatchSpec = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    z.object({ topicId: z.string().uuid(), spec: z.unknown() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      const spec = await writeTopicMatchSpec(context.actor.db, data.topicId, data.spec, new Date());
      await audit(
        context.actor,
        "topic.match_spec.set",
        { type: "topic", id: data.topicId },
        {
          spec: JSON.parse(JSON.stringify(spec)) as Json,
        },
      );
      return { ok: true as const };
    } catch (error) {
      asConsoleError(error);
    }
  });

/** Return a custom topic to "derive from its terms". */
export const resetTopicMatchSpecFn = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => topicIdInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      await resetTopicMatchSpec(context.actor.db, data.topicId, new Date());
      await audit(context.actor, "topic.match_spec.reset", { type: "topic", id: data.topicId });
      return { ok: true as const };
    } catch (error) {
      asConsoleError(error);
    }
  });

/** Which optional terms have earned promotion, and on what evidence. Read-only. */
export const loadTopicPromotions = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) => topicIdInput.parse(input))
  .handler(async ({ context, data }): Promise<PromotionReport> => {
    try {
      return await promotionEvidence(context.actor.db, data.topicId);
    } catch (error) {
      asConsoleError(error);
    }
  });

/**
 * Accept promotion for some candidate terms. The evidence is recomputed on the
 * server; a term that is not a candidate at this moment is not promoted.
 */
export const promoteTopicTerms = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    z
      .object({
        topicId: z.string().uuid(),
        terms: z.array(z.string().trim().min(1).max(120)).min(1).max(24),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      const result = await acceptPromotions(context.actor.db, data.topicId, data.terms, new Date());
      await audit(
        context.actor,
        "topic.match_spec.promote",
        { type: "topic", id: data.topicId },
        { promoted: result.promoted.map((term) => term.text) },
      );
      return { ok: true as const, promoted: result.promoted.map((term) => term.text) };
    } catch (error) {
      asConsoleError(error);
    }
  });
