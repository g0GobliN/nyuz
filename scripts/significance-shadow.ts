/**
 * Read-only. Zero AI. What would turning on subject significance change?
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/significance-shadow.ts [--limit N] [--since-hours H]
 *   npm run shadow:significance
 *
 * The P4 shadow, collected from production data through the production code.
 * It runs the real match stage -- the same readers, the same candidate page, the
 * same topic selection -- as a dry run with the shipped rule deciding, and asks
 * it to score every (reader, event) pair the shipped rule considered under the
 * interest-conditional rule as well. The comparison is `significanceShadow`: the
 * same admission floors, ranking metrics and alert-miss list the deterministic
 * scorer had to pass (`scoring-shadow.ts`), with `promotionVerdict` naming what
 * would block turning the flag on.
 *
 * Writes nothing: `dryRun` skips every insert, reopen, coverage link and alert,
 * and `subjectSignificance: false` pins the decisions to the shipped rule
 * whatever the flag currently says. Calls no model.
 */
import { match } from "@/lib/pipeline/match";
import { promotionVerdict } from "@/lib/pipeline/scoring-shadow";
import { db, heading, main, row, say } from "./lib/db";

function arg(name: string): number | undefined {
  const at = process.argv.indexOf(name);
  if (at === -1) return undefined;
  const value = Number(process.argv[at + 1]);
  return Number.isFinite(value) ? value : undefined;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

main(async () => {
  const report = await match(db(), {
    dryRun: true,
    subjectSignificance: false,
    significanceShadow: true,
    skipAlerts: true,
    limit: arg("--limit"),
    sinceHours: arg("--since-hours"),
  });

  heading("Run");
  say(row("readers", report.readers));
  say(row("candidates", report.candidates));
  say(row("subject history", report.significanceHistory));

  const shadow = report.significanceShadow;
  if (!shadow || shadow.report.events === 0) {
    say("no (reader, event) pairs were considered; nothing to compare");
    return;
  }
  if (report.significanceHistory !== "loaded") {
    say("the subject history could not be read -- every subject score is 0 in this run");
  }

  heading("Pairs");
  say(row("considered", shadow.report.events));
  say(row("admission changes", shadow.changedAdmissions));

  heading("Briefing admission agreement");
  say("floor  where                          agree     FP     FN   miss-rate");
  for (const floor of shadow.report.admission) {
    say(
      `${String(floor.floor).padStart(5)}  ${floor.label.padEnd(30)} ${pct(floor.agreement).padStart(6)} ` +
        `${String(floor.falsePositives).padStart(6)} ${String(floor.falseNegatives).padStart(6)} ` +
        `${pct(floor.missRate).padStart(10)}`,
    );
  }

  heading("Ranking");
  for (const ranking of shadow.report.ranking) {
    say(
      `top ${String(ranking.n).padStart(2)}: overlap ${pct(ranking.topNOverlap)}, ` +
        `pairwise ${pct(ranking.pairwiseAgreement)}`,
    );
  }

  heading("Alerts");
  say(row("before", shadow.alertChanges.before));
  say(row("after", shadow.alertChanges.after));
  say(row("gained", shadow.alertChanges.gained.join(", ") || "none"));
  say(row("lost", shadow.alertChanges.lost.join(", ") || "none"));

  heading("Verdict");
  const verdict = promotionVerdict(shadow.report);
  say(verdict.ready ? "no blockers" : "blocked:");
  for (const blocker of verdict.blockers) say(`  - ${blocker}`);
});
