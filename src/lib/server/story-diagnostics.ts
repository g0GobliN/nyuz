import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminOnly } from "@/lib/server/guard";
import { parseInput } from "@/lib/server/validate";
import { readEventIntelligence, readerQuality } from "@/lib/understand";
import type { Database, Json } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StoryDiagnostic = {
  event: {
    id: string;
    title: string;
    category: string | null;
    topics: string[];
    firstSeen: string;
    lastSeen: string;
    status: string;
    importance: number;
    novelty: number;
  };
  reader: {
    mode: "ai_cached" | "deterministic_enriched" | "deterministic_rss" | "minimal";
    quality: "thin" | "adequate" | "rich";
    words: number;
    aiArticle: boolean;
  };
  articles: {
    id: string;
    title: string;
    source: string | null;
    publishedAt: string | null;
    evidenceStatus: string | null;
    evidenceCount: number;
    sourceWords: number;
    selected: string[];
    rejected: { text: string; reason: string }[];
  }[];
  entities: { name: string; role: string; score: number; sourceCount: number }[];
  related: {
    persisted: boolean;
    candidates: number;
    accepted: number;
    note: string;
  };
};

type Db = SupabaseClient<Database>;

function words(intel: ReturnType<typeof readEventIntelligence>): number {
  if (!intel) return 0;
  const text = intel.article
    ? [intel.article.deck.text, ...intel.article.paragraphs.map((p) => p.text)].join(" ")
    : [intel.oneSentence, ...intel.newDevelopments, ...intel.context]
        .map((value) => (typeof value === "string" ? value : value.text))
        .join(" ");
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function evidenceCount(value: Json): number {
  return Array.isArray(value) ? value.length : 0;
}

export const getStoryDiagnostic = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({ id: z.string().uuid() }), input))
  .handler(async ({ context, data }): Promise<StoryDiagnostic | null> => {
    const db = context.actor.db as Db;
    const event = await db
      .from("events")
      .select(
        "id, title, what_happened, status, importance, novelty, first_seen_at, last_updated_at, understand, tags",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (event.error) throw new Error(event.error.message);
    if (!event.data) return null;

    const [topics, articles, understanding] = await Promise.all([
      db.from("event_topics").select("topics ( label )").eq("event_id", data.id).limit(100),
      db
        .from("articles")
        .select("id, title, source_id, published_at, sources ( name )")
        .eq("event_id", data.id)
        .order("published_at", { ascending: true })
        .limit(100),
      db
        .from("event_understanding")
        .select("payload, status, updated_at")
        .eq("event_id", data.id)
        .eq("status", "ready")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    for (const result of [topics, articles, understanding]) {
      if (result.error) throw new Error(result.error.message);
    }

    const articleIds = (articles.data ?? []).map((row) => row.id);
    const evidence = articleIds.length
      ? await db
          .from("article_evidence")
          .select("article_id, status, evidence, source_word_count")
          .in("article_id", articleIds)
      : { data: [], error: null };
    if (evidence.error) throw new Error(evidence.error.message);
    const evidenceByArticle = new Map((evidence.data ?? []).map((row) => [row.article_id, row]));
    const payload = understanding.data?.payload ?? event.data.understand;
    const intel = readEventIntelligence(payload, articleIds.length);
    const enriched = (evidence.data ?? []).some((row) => row.status === "enriched");
    const mode =
      understanding.data?.status === "ready" && intel?.article
        ? "ai_cached"
        : enriched
          ? "deterministic_enriched"
          : intel
            ? "deterministic_rss"
            : "minimal";
    const quality = readerQuality(
      intel ?? { newDevelopments: [], context: [] },
      articles.data?.length ?? 0,
    );

    return {
      event: {
        id: event.data.id,
        title: event.data.title,
        category: event.data.tags?.[0] ?? null,
        topics: (topics.data ?? []).flatMap((row) => {
          const topic = row.topics as { label?: string } | null;
          return topic?.label ? [topic.label] : [];
        }),
        firstSeen: event.data.first_seen_at,
        lastSeen: event.data.last_updated_at,
        status: event.data.status,
        importance: event.data.importance,
        novelty: event.data.novelty,
      },
      reader: {
        mode,
        quality,
        words: words(intel),
        aiArticle: !!intel?.article && !!understanding.data,
      },
      articles: (articles.data ?? []).map((article) => {
        const row = evidenceByArticle.get(article.id);
        return {
          id: article.id,
          title: article.title,
          source: (article.sources as { name?: string } | null)?.name ?? null,
          publishedAt: article.published_at,
          evidenceStatus: row?.status ?? null,
          evidenceCount: row ? evidenceCount(row.evidence) : 0,
          sourceWords: row?.source_word_count ?? 0,
          selected: [],
          rejected: [],
        };
      }),
      entities: (intel?.newDevelopments ?? []).flatMap(() => []),
      related: {
        persisted: false,
        candidates: 0,
        accepted: 0,
        note: "Related-event candidates are computed at read time and are not persisted as an audit log; no historical candidate count is claimed.",
      },
    };
  });
