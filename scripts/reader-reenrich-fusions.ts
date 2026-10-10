/**
 * The bounded historical repair for the fused-standfirst defect.
 *
 *   npm run reenrich:fusions                       -- dry run, writes nothing
 *   npm run reenrich:fusions -- --apply            -- writes the validated rows
 *   npm run reenrich:fusions -- --from other.json
 *
 * Why this exists. The extraction fix repairs new rows; storing is one-way, so
 * the pages already written to `article_evidence` still carry the fusion the
 * reader saw on 2026-10-10. The arbiter's ruling (2026-10-10) is to repair them
 * at the layer that produced the defect -- re-fetch, re-extract with the
 * corrected extractor -- and explicitly NOT to add a refusal or a splitting
 * heuristic to the reader.
 *
 * The four rules it holds itself to:
 *
 *   1. **Confirmed articles only.** The input is the output of
 *      `scripts/reader-fusion-sample.ts`, and only rows where the old extractor
 *      fused and the new one separates are repaired. A candidate signature over
 *      stored text is not a sufficient reason to touch anything: it counts place
 *      names.
 *   2. **Validation before replacement.** A replacement is written only if the
 *      re-extraction yields at least one unit, loses no more than five words
 *      against the page's own old extraction, and no longer carries the fusion
 *      the old unit carried. Anything else is reported as rejected and the
 *      stored row is left exactly as it was.
 *   3. **Preserve both sides.** The report always contains the original stored
 *      evidence and the proposed replacement, so the change can be read and
 *      rolled back without re-fetching anything.
 *   4. **A failed fetch is not a licence.** An article whose page cannot be
 *      fetched keeps its existing evidence and is reported as unavailable.
 *
 * Dry run by default. `--apply` updates `article_evidence` for validated rows
 * only, and never deletes anything. Node 22 or later.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fetchArticlePage } from "../src/lib/pipeline/article-fetch";
import { STRUCTURAL_BREAK, extractMainText } from "../src/lib/pipeline/html-text";
import { selectEvidenceUnits } from "../src/lib/pipeline/evidence-extract";
import { decodeEntities } from "../src/lib/pipeline/source-text";
import { CANDIDATE_FUSION, fusionSeparatedByRuns } from "./lib/defects.ts";
import { db, heading, main, row, say } from "./lib/db.ts";

/** The extractor as it stood before 2026-10-10, for the validation comparison. */
function legacyExtractMainText(html: string, maxChars = 20_000): string {
  let cleaned = html;
  for (const tag of [
    "script",
    "style",
    "noscript",
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "svg",
    "iframe",
    "template",
  ]) {
    cleaned = cleaned.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }
  const paragraphs: string[] = [];
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  let total = 0;
  while ((match = pRe.exec(cleaned)) !== null) {
    const text = decodeEntities((match[1] ?? "").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 20) continue;
    paragraphs.push(text);
    total += text.length;
    if (total >= maxChars) break;
  }
  return paragraphs.join(" ").slice(0, maxChars);
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

type SampleRow = { id: string; title: string; url: string; confirmedFusion: boolean };

type Outcome = {
  id: string;
  title: string;
  url: string;
  outcome: "corrected" | "unchanged" | "unavailable" | "rejected";
  detail: string;
  original?: { status: string; evidence: { kind: string; text: string }[] };
  replacement?: { status: string; evidence: { kind: string; text: string }[] };
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
/**
 * Rewrite rows that look already-repaired. Needed once, after a first write that
 * was wrong in a way the row itself could not show: it dropped `entities`. The
 * condition to touch a row is otherwise "the re-extraction still divides one of
 * its units", which a repaired row no longer satisfies -- so a repair that was
 * *incomplete* would have been invisible and permanent. Validation still runs.
 */
const force = args.includes("--force");
const fromIndex = args.indexOf("--from");
const from = fromIndex >= 0 ? args[fromIndex + 1]! : "tmp/fusion-sample.json";
const outIndex = args.indexOf("--out");
const out = (outIndex >= 0 ? args[outIndex + 1] : undefined) ?? "tmp/re-enrich-report.json";

main(async () => {
  const sample = JSON.parse(readFileSync(from, "utf8")) as SampleRow[];
  const confirmed = sample.filter((r) => r.confirmedFusion);
  say(`${sample.length} sampled articles, ${confirmed.length} confirmed fused`);
  say(
    apply
      ? `mode: APPLY (validated rows are written)${force ? ", --force" : ""}`
      : "mode: dry run (nothing is written)",
  );

  const outcomes: Outcome[] = [];
  for (const item of confirmed) {
    const { data: stored } = await db()
      .from("article_evidence")
      .select("status, evidence, source_word_count")
      .eq("article_id", item.id)
      .maybeSingle();
    const original = {
      status: (stored?.status as string) ?? "(no row)",
      evidence: ((stored?.evidence as { kind: string; text: string }[] | null) ?? []).map((u) => ({
        kind: u.kind,
        text: u.text,
      })),
    };
    const originalFused = original.evidence.filter((u) => CANDIDATE_FUSION.test(u.text));

    const fetched = await fetchArticlePage(item.url);
    if (!fetched.ok) {
      outcomes.push({
        id: item.id,
        title: item.title,
        url: item.url,
        outcome: "unavailable",
        detail: `${fetched.reason} — stored evidence left untouched`,
        original,
      });
      continue;
    }

    const legacyWords = words(legacyExtractMainText(fetched.html));
    const newText = extractMainText(fetched.html);
    const newWeight = words(newText);
    // Stored verbatim, including `entities`. The first version of this script
    // re-built each unit field by field and silently dropped `entities` -- the
    // reader path ranks sources by them, and a repair that quietly removes data
    // is worse than the defect it fixes. Caught by verifying the written rows
    // instead of trusting the write.
    const units = selectEvidenceUnits(newText).map((u) => ({
      kind: u.kind,
      text: u.text,
      ...(u.entities ? { entities: u.entities } : {}),
      ...(u.attribution ? { attribution: u.attribution } : {}),
    }));
    // Diagnostic only, never a reason to reject: the candidate ruler matches
    // place names, so "the ruler still matches something" says nothing.
    const stillCandidate = units.filter((u) => CANDIDATE_FUSION.test(u.text));
    const replacement = { status: "enriched", evidence: units };

    // Validation, in the order the failure would matter: nothing to store, text
    // missing, or nothing actually repaired.
    //
    // The repaired thing is a *page*, not a unit: a stored unit that the new
    // extraction no longer produces is one the corrected boundary divided, and a
    // unit that legitimately still matches the loose ruler survives verbatim and
    // is not a defect at all. Comparing the loose pattern with the replacement
    // rejected eight of ten genuinely repaired articles before this was fixed.
    const runs = newText.split(STRUCTURAL_BREAK);
    // A stored candidate only counts as repaired when the runs prove it: no run
    // holds the old unit whole, and both halves of its seam are present.
    const confirmedSplits = originalFused.filter((unit) => fusionSeparatedByRuns(unit.text, runs));
    const rejection =
      units.length === 0
        ? "re-extraction produced no usable unit"
        : newWeight < legacyWords - 5
          ? `${legacyWords - newWeight} words fewer than the page's own extraction`
          : null;

    if (rejection !== null) {
      outcomes.push({
        id: item.id,
        title: item.title,
        url: item.url,
        outcome: "rejected",
        detail: `${rejection} — stored evidence left untouched`,
        original,
        replacement,
      });
      continue;
    }

    if (!force && (originalFused.length === 0 || confirmedSplits.length === 0)) {
      outcomes.push({
        id: item.id,
        title: item.title,
        url: item.url,
        outcome: "unchanged",
        detail:
          originalFused.length === 0
            ? `stored row carries ${units.length} units and no fusion candidate`
            : `no stored unit was divided by the re-extraction (${originalFused.length} candidate(s), none confirmed)`,
        original,
        replacement,
      });
      continue;
    }

    if (apply) {
      const { error } = await db()
        .from("article_evidence")
        .update({
          status: "enriched",
          evidence: units,
          source_word_count: newWeight,
          extracted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("article_id", item.id);
      if (error) {
        outcomes.push({
          id: item.id,
          title: item.title,
          url: item.url,
          outcome: "rejected",
          detail: `write refused: ${error.message} — stored evidence left untouched`,
          original,
          replacement,
        });
        continue;
      }
    }

    outcomes.push({
      id: item.id,
      title: item.title,
      url: item.url,
      outcome: "corrected",
      detail: `${confirmedSplits.length} fused unit(s) divided, ${units.length} units, ${newWeight} words (was ${legacyWords})`,
      original,
      replacement,
    });
  }

  heading(`Re-enrichment ${apply ? "applied" : "dry run"}`);
  for (const outcome of outcomes) say(row(outcome.outcome, outcome.title));
  for (const outcome of outcomes) {
    say(`  · [${outcome.outcome}] ${outcome.title}`);
    say(`      ${outcome.detail}`);
    const before = outcome.original?.evidence.find((u) => CANDIDATE_FUSION.test(u.text));
    if (before) say(`      was:  ${before.text.slice(0, 200)}`);
    const after = outcome.replacement?.evidence.filter((u) => CANDIDATE_FUSION.test(u.text)) ?? [];
    if (outcome.replacement) {
      const replaced = outcome.replacement.evidence.find((u) => !CANDIDATE_FUSION.test(u.text));
      if (replaced) say(`      now:  ${replaced.text.slice(0, 200)}`);
      if (after.length > 0)
        say(`      candidate-pattern units remaining (place names included): ${after.length}`);
    }
  }

  const counts = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.outcome] = (acc[o.outcome] ?? 0) + 1;
    return acc;
  }, {});
  say(
    `attempted ${outcomes.length} · corrected ${counts["corrected"] ?? 0} · unchanged ${counts["unchanged"] ?? 0} · unavailable ${counts["unavailable"] ?? 0} · rejected ${counts["rejected"] ?? 0}`,
  );
  writeFileSync(out, `${JSON.stringify(outcomes, null, 1)}\n`);
  say(`rollback material (original + replacement per article) written to ${out}`);
});
