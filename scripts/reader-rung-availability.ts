/**
 * Which rungs of the why-it-matters ladder have input across a reader's pool.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/reader-rung-availability.ts [--user <id>] [--limit 1000]
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * On 2026-10-17 the reader's daily briefing had collapsed from 25 stories to 1,
 * and the next one would have shipped 0. The cause was not a broken gate: it was
 * that almost every rung of `reasonFor`'s ladder needs stored analysis text, and
 * the stored analysis is empty — the impact writer is off by policy, `after_state`
 * is not written, and the pool is single-source so the coverage rung cannot fire
 * either. Q4 withholds an item whose ladder is silent, so the briefing emptied.
 *
 * That measurement was made by a throwaway probe, and the numbers are the
 * arbiter's evidence for a product ruling. So it is an instrument now: the
 * question "can this product say why any of these stories matters?" has to be
 * answerable in one command, on any reader, whenever the policy changes.
 *
 * Read-only: it reads with the service key and writes nothing.
 */

import { consequenceLine } from "../src/lib/pipeline/inclusion";
import { db, heading, main, row, say } from "./lib/db.ts";

/** The reader whose 22:30Z slot is the case study, when no `--user` is given. */
const DEFAULT_READER = "640a69b6-36ff-4523-841c-957abfc60315";

/** The batch size the article and evidence reads use, matching the other audits. */
const CHUNK = 150;

type MatchedEvent = {
  event_id: string;
  events: { publisher_count?: number | null; after_state?: string | null } | null;
};

main(async () => {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback?: string): string | undefined => {
    const at = argv.indexOf(name);
    const inline = argv.find((arg) => arg.startsWith(`${name}=`));
    return inline?.slice(name.length + 1) ?? (at === -1 ? fallback : argv[at + 1]);
  };

  const userId = flag("--user", DEFAULT_READER) ?? DEFAULT_READER;
  const limit = Number(flag("--limit", "1000"));
  say(`reader ${userId}`);
  say(`pool   the ${limit} unbriefed, unexpired matches, ranked by relevance`);

  const { data: matchData, error: matchError } = await db()
    .from("user_events")
    .select("event_id, events ( publisher_count, after_state )")
    .eq("user_id", userId)
    .is("briefed_at", null)
    .is("expired_at", null)
    .order("relevance", { ascending: false })
    .limit(limit);
  if (matchError) throw new Error(`matches: ${matchError.message}`);
  const matches = (matchData ?? []) as MatchedEvent[];
  const ids = matches.map((m) => m.event_id);
  heading(`${ids.length} unbriefed matches`);

  // Rungs 6 and 7 need nothing but the event row.
  let multi = 0;
  let after = 0;
  for (const match of matches) {
    if ((match.events?.publisher_count ?? 0) >= 2) multi += 1;
    if ((match.events?.after_state ?? "").trim() !== "") after += 1;
  }

  // Rungs 1, 4 and 5 need the stored analysis the ladder reads.
  let impacts = 0;
  let consequenceEvidence = 0;
  let anyEvidence = 0;
  for (let at = 0; at < ids.length; at += CHUNK) {
    const slice = ids.slice(at, at + CHUNK);
    const { data: impactRows, error: impactError } = await db()
      .from("event_impacts")
      .select("event_id, text, status")
      .in("event_id", slice);
    if (impactError) throw new Error(`event_impacts: ${impactError.message}`);
    for (const impact of impactRows ?? []) {
      if (impact.status === "complete" && (impact.text ?? "").trim() !== "") impacts += 1;
    }

    const { data: articles, error: articleError } = await db()
      .from("articles")
      .select("id, event_id")
      .in("event_id", slice);
    if (articleError) throw new Error(`articles: ${articleError.message}`);
    const eventOf = new Map(
      (articles ?? []).flatMap((a) => (a.event_id ? [[a.id, a.event_id] as const] : [])),
    );
    const articleIds = (articles ?? []).map((a) => a.id);
    const withEvidence = new Set<string>();
    const withConsequence = new Set<string>();
    for (let from = 0; from < articleIds.length; from += CHUNK) {
      const { data: units, error: unitError } = await db()
        .from("article_evidence")
        .select("article_id, evidence")
        .in("article_id", articleIds.slice(from, from + CHUNK))
        .eq("status", "enriched");
      if (unitError) throw new Error(`article_evidence: ${unitError.message}`);
      for (const unit of units ?? []) {
        const eventId = eventOf.get(unit.article_id);
        if (eventId === undefined) continue;
        withEvidence.add(eventId);
        // The consequence rung is not "has evidence": it is "the evidence states a
        // money consequence". Counted by the ladder's own predicate, imported from
        // the product, so this number cannot drift from what the rung accepts.
        const texts = (Array.isArray(unit.evidence) ? unit.evidence : [])
          .map((item) => (item as { text?: unknown }).text)
          .filter((text): text is string => typeof text === "string" && text.trim() !== "");
        if (consequenceLine(texts) !== null) withConsequence.add(eventId);
      }
    }
    anyEvidence += withEvidence.size;
    consequenceEvidence += withConsequence.size;
  }

  const pct = (n2: number): string => `${((n2 / Math.max(ids.length, 1)) * 100).toFixed(1)}%`;
  heading("rung availability (a rung fires only where its input exists)");
  say(row("stored impact (rung 1)", `${impacts} / ${ids.length}  ${pct(impacts)}`));
  say(row("after-state (rung 3)", `${after} / ${ids.length}  ${pct(after)}`));
  say(row("coverage >= 2 (rung 6)", `${multi} / ${ids.length}  ${pct(multi)}`));
  say(
    row(
      "consequence evidence",
      `${consequenceEvidence} / ${ids.length}  ${pct(consequenceEvidence)}`,
    ),
  );
  say("");
  say(
    row(
      "any stored evidence (rung 4's input, wider)",
      `${anyEvidence} / ${ids.length}  ${pct(anyEvidence)}`,
    ),
  );
  say("");
  say("The change rung (2) reads before_state plus after_state, so it cannot fire");
  say("anywhere rung 3 reads zero. An empty stored impact is the policy's own");
  say("state, not a fault: `impact_writer_enabled` defaults off and the code-first");
  say("policy is zero provider calls in background.");
  say("");
  say('Read the numbers as "what the product can say", not as a defect count:');
  say("Q4 withholds an item whose ladder is silent, so the pool that can speak is");
  say("the ceiling on how many stories a briefing can carry.");
});
