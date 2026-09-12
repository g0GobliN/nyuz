/**
 * Read-only. Zero AI. Does the deterministic scorer make the same decisions?
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/scoring-shadow.ts [--limit N]
 *
 * Every event this project has ever analysed carries an importance and a novelty
 * the model assigned after reading the coverage, and the coverage is still in
 * `articles`. That is a labelled evaluation set of ~1,900 events that cost
 * nothing to use and cannot be biased by the thing being tested, because the
 * labels were written before the test existed.
 *
 * So this re-scores each of those events with `scoreEvent` — the same code the
 * pipeline would use if the model stopped producing these numbers — and asks
 * whether the reader's briefing, ordering and alerts would have come out the
 * same. See src/lib/pipeline/scoring-shadow.ts for why the comparison is about
 * decisions rather than score distance.
 *
 * Writes nothing. Calls no model.
 */
import { extractFacts } from "@/lib/pipeline/extract";
import { scoreEvent } from "@/lib/pipeline/scoring";
import { promotionVerdict, shadowReport, type ScoredPair } from "@/lib/pipeline/scoring-shadow";
import { db, heading, main, say } from "./lib/db";

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg === -1 ? 5000 : Number(process.argv[limitArg + 1] ?? 5000);

type EventRow = {
  id: string;
  title: string;
  importance: number;
  novelty: number;
  analysed_at: string | null;
};

type ArticleRow = {
  event_id: string | null;
  title: string;
  excerpt: string | null;
  published_at: string | null;
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

main(async () => {
  const client = db();

  const events: EventRow[] = [];
  for (let from = 0; from < LIMIT; from += 1000) {
    const { data, error } = await client
      .from("events")
      .select("id, title, importance, novelty, analysed_at")
      .not("analysed_at", "is", null)
      .eq("status", "complete")
      .order("analysed_at", { ascending: false })
      .range(from, Math.min(from + 999, LIMIT - 1));
    if (error) throw new Error(`reading events: ${error.message}`);
    const page = (data ?? []) as EventRow[];
    events.push(...page);
    if (page.length < 1000) break;
  }
  say(`analysed events with model labels: ${events.length}`);
  if (events.length === 0) return;

  // Coverage, in chunks: the `in` filter and the 1000-row response cap are both
  // real, and an event with no surviving articles cannot be re-scored at all.
  const coverage = new Map<string, ArticleRow[]>();
  const ids = events.map((e) => e.id);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data, error } = await client
      .from("articles")
      .select("event_id, title, excerpt, published_at")
      .in("event_id", chunk);
    if (error) throw new Error(`reading articles: ${error.message}`);
    for (const row of (data ?? []) as ArticleRow[]) {
      if (!row.event_id) continue;
      coverage.set(row.event_id, [...(coverage.get(row.event_id) ?? []), row]);
    }
  }

  const pairs: ScoredPair[] = [];
  // Which deterministic signals fire, and which fire on the events the model
  // called important. A scorer that reaches 0 on 86% of the corpus is not
  // mis-weighted, it is blind to something, and this is what names it.
  const reasonsAll = new Map<string, number>();
  const reasonsImportant = new Map<string, number>();
  let skipped = 0;
  for (const event of events) {
    const articles = coverage.get(event.id) ?? [];
    if (articles.length === 0) {
      skipped++;
      continue;
    }
    // Exactly what analyse.ts does, so this measures the scorer and not a
    // difference in how the text was assembled.
    const fullText = articles.map((a) => `${a.title}\n${a.excerpt ?? ""}`).join("\n---\n");
    const facts = extractFacts(fullText, 0);
    // Scored at the event's own analysis time. Using today's clock would mark
    // every historical event "old" and manufacture a disagreement.
    const at = event.analysed_at ? new Date(event.analysed_at) : new Date();
    const signals = scoreEvent(articles, facts, at);

    for (const reason of signals.reasons) {
      reasonsAll.set(reason, (reasonsAll.get(reason) ?? 0) + 1);
      if (event.importance >= 6) {
        reasonsImportant.set(reason, (reasonsImportant.get(reason) ?? 0) + 1);
      }
    }

    pairs.push({
      eventId: event.id,
      ai: { importance: event.importance, novelty: event.novelty },
      deterministic: {
        importance: signals.importanceEstimate,
        novelty: signals.noveltyEstimate,
        confidence: signals.confidence,
      },
    });
  }
  say(`re-scored: ${pairs.length}  (skipped, no surviving coverage: ${skipped})`);

  const report = shadowReport(pairs);

  heading("Importance distribution");
  say("score   model   deterministic");
  for (let score = 0; score <= 10; score++) {
    const ai = report.distribution.ai[score] ?? 0;
    const code = report.distribution.deterministic[score] ?? 0;
    if (ai === 0 && code === 0) continue;
    say(`${String(score).padStart(5)}${String(ai).padStart(8)}${String(code).padStart(16)}`);
  }

  heading("Which deterministic signals fire");
  const important = pairs.filter((p) => p.ai.importance >= 6).length;
  say(`signal                 all events (${pairs.length})    model-important (${important})`);
  for (const [reason, count] of [...reasonsAll].sort((a, b) => b[1] - a[1])) {
    const hit = reasonsImportant.get(reason) ?? 0;
    say(
      reason.padEnd(22) +
        `${String(count).padStart(6)} ${pct(count / pairs.length).padStart(7)}` +
        `${String(hit).padStart(10)} ${pct(important === 0 ? 0 : hit / important).padStart(7)}`,
    );
  }

  heading("Briefing admission agreement");
  say("floor  where                          agree     FP     FN   miss-rate");
  for (const row of report.admission) {
    say(
      String(row.floor).padStart(5) +
        "  " +
        row.label.padEnd(30) +
        pct(row.agreement).padStart(6) +
        String(row.falsePositives).padStart(7) +
        String(row.falseNegatives).padStart(7) +
        pct(row.missRate).padStart(12),
    );
  }

  heading("Alert admission agreement");
  const a = report.alerts;
  say(`floor:            ${a.floor}`);
  say(`model alerted:    ${a.truePositives + a.falseNegatives}`);
  say(`both alert:       ${a.truePositives}`);
  say(`extra alerts:     ${a.falsePositives}  (false positives — reader gets one too many)`);
  say(`MISSED alerts:    ${a.falseNegatives}  (false negatives — reader never hears about it)`);
  say(`miss rate:        ${pct(a.missRate)}`);

  heading("Ranking agreement");
  say("top-N   overlap   pairwise");
  for (const row of report.ranking) {
    say(
      String(row.n).padStart(5) +
        pct(row.topNOverlap).padStart(10) +
        pct(row.pairwiseAgreement).padStart(11),
    );
  }

  if (report.missedImportant.length > 0) {
    heading("Events the deterministic scorer would stop alerting on");
    const titles = new Map(events.map((e) => [e.id, e.title]));
    for (const id of report.missedImportant.slice(0, 25)) {
      const pair = pairs.find((p) => p.eventId === id);
      say(
        `  model ${String(pair?.ai.importance).padStart(2)} -> code ${String(pair?.deterministic.importance).padStart(2)}  ${titles.get(id)?.slice(0, 88) ?? id}`,
      );
    }
    if (report.missedImportant.length > 25) {
      say(`  … and ${report.missedImportant.length - 25} more`);
    }
  }

  heading("Verdict");
  const verdict = promotionVerdict(report);
  if (verdict.ready) {
    say("READY — the deterministic scorer reproduces the model's product decisions.");
  } else {
    say("NOT READY. Blockers:");
    for (const blocker of verdict.blockers) say(`  - ${blocker}`);
  }
  say("");
  say("Nothing was changed. This script only measures.");
});
