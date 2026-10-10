/**
 * The bounded re-extraction experiment for the fused-standfirst fix.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/reader-fusion-sample.ts \
 *     [--stories 20] [--out /tmp/fusion-sample.json]
 *
 * Why this exists. The fused text the reader saw on 2026-10-10 is already
 * stored in `article_evidence`, and storing is one-way: nothing in the composer
 * can tell two sentences from one after the fact. So the fix had to be made
 * where the boundary still exists -- in `extractMainText` -- and proving it
 * needs the original pages, not the stored units and not a hand-written fixture.
 *
 * What it does, for a bounded, deterministic sample of articles:
 *
 *   1. Re-fetch the article's page (SELECT-only otherwise; nothing is written).
 *   2. Run the pre-fix extractor and the current one over the same HTML. The
 *      pre-fix behaviour is reproduced here, verbatim, rather than by checking
 *      out an old revision: the two must see the same bytes.
 *   3. Report, per article, whether a unit the old extractor fused is separated
 *      by the new one, and whether any text is lost or duplicated in the
 *      process.
 *
 * The sample is for validating extraction behaviour, not for estimating a
 * defect rate: it takes the two known Guardian cases and then one article per
 * publisher, so different HTML structures are covered instead of one feed's.
 *
 * A page that cannot be fetched is reported as unavailable, never substituted:
 * the arbiter's rule is that missing evidence is recorded, not replaced.
 * Node 22 or later.
 */

import { writeFileSync } from "node:fs";
import { fetchArticlePage } from "../src/lib/pipeline/article-fetch";
import { STRUCTURAL_BREAK, extractMainText } from "../src/lib/pipeline/html-text";
import { selectEvidenceUnits } from "../src/lib/pipeline/evidence-extract";
import { decodeEntities } from "../src/lib/pipeline/source-text";
import { CANDIDATE_FUSION, fusionSeparatedByRuns } from "./lib/defects.ts";
import { main, say } from "./lib/db.ts";

/** The extractor as it stood before 2026-10-10: every tag is a word space. */
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

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const limit = Number(flag("--stories") ?? 20);
const out = flag("--out");

type Row = {
  /** The `articles.id`, so a confirmed row can be repaired in place. */
  id: string;
  title: string;
  source: string;
  url: string;
  fetched: boolean;
  reason?: string;
  legacyUnits: number;
  newUnits: number;
  candidateFusionInLegacy: boolean;
  confirmedFusion: boolean;
  lostText?: string;
  duplicatedText?: string;
  example?: string;
};

const rows: Row[] = [];

main(async () => {
  const { db } = await import("./lib/db.ts");
  const { data: articles, error } = await db()
    .from("articles")
    .select("id, url, title, event_id, source_id, published_at")
    .not("event_id", "is", null)
    .order("published_at", { ascending: false })
    .limit(600);
  if (error) throw new Error(`articles: ${error.message}`);

  const { data: sources } = await db().from("sources").select("id, name");
  const nameById = new Map((sources ?? []).map((s) => [s.id as string, s.name as string]));

  // One article per publisher, newest first, with the two known cases first.
  const known = (articles ?? []).filter((a) => /marble-hill|drumcree/i.test(`${a.url} ${a.title}`));
  const sample: typeof articles = [...known];
  const seen = new Set(sample.map((a) => a.source_id as string));
  for (const article of articles ?? []) {
    if (sample.length >= limit) break;
    const source = article.source_id as string;
    if (seen.has(source)) continue;
    seen.add(source);
    sample.push(article);
  }

  say(`${sample.length} articles sampled (${known.length} known cases)`);
  for (const article of sample.slice(0, limit)) {
    const url = article.url as string;
    const source = nameById.get(article.source_id as string) ?? "unknown";
    const fetched = await fetchArticlePage(url);
    if (!fetched.ok) {
      rows.push({
        id: article.id as string,
        title: article.title as string,
        source,
        url,
        fetched: false,
        reason: fetched.reason,
        legacyUnits: 0,
        newUnits: 0,
        candidateFusionInLegacy: false,
        confirmedFusion: false,
      });
      continue;
    }

    const legacyText = legacyExtractMainText(fetched.html);
    const newText = extractMainText(fetched.html);
    const legacyUnits = selectEvidenceUnits(legacyText).map((u) => u.text);
    const newUnits = selectEvidenceUnits(newText).map((u) => u.text);

    const fused = legacyUnits.filter((text) => CANDIDATE_FUSION.test(text));
    // Confirmed, and only confirmed this way: the unit the old extractor
    // produced is *absent* from the new extraction, and both halves of its seam
    // are present there. The earlier version of this test ran on units that were
    // still present verbatim, which means it could never fail -- it certified 10
    // of 16 articles on the strength of a pattern that also matches a place name.
    // Confirmed against the *stored* units, not against a fresh run of the old
    // extractor: the defect that reached readers is the row in the database, and
    // a fresh legacy pass selects a slightly different top-12 (that mistake is
    // how an earlier version of this test reported ten confirmed repairs while
    // being unable to fail). The new extraction's runs are the proof.
    const { data: storedRow } = await db()
      .from("article_evidence")
      .select("evidence")
      .eq("article_id", article.id as string)
      .maybeSingle();
    const storedUnits = ((storedRow?.evidence as { text: string }[] | null) ?? []).map(
      (unit) => unit.text,
    );
    const runs = newText.split(STRUCTURAL_BREAK);
    const confirmed = storedUnits.some((text) => fusionSeparatedByRuns(text, runs));
    const legacyWords = legacyText.split(/\s+/).filter(Boolean).length;
    const newWords = newText.split(/\s+/).filter(Boolean).length;

    rows.push({
      id: article.id as string,
      title: article.title as string,
      source,
      url,
      fetched: true,
      legacyUnits: legacyUnits.length,
      newUnits: newUnits.length,
      candidateFusionInLegacy: fused.length > 0,
      confirmedFusion: confirmed,
      // Loss and duplication are measured as words, which is the level at which
      // "the fix deleted half a sentence" would show up.
      ...(newWords < legacyWords - 5
        ? {
            lostText: `${legacyWords - newWords} words fewer across ${newText.split(STRUCTURAL_BREAK).length} runs`,
          }
        : {}),
      ...(newWords > legacyWords + 5 ? { duplicatedText: "more words than before" } : {}),
      ...(fused[0] ? { example: fused[0].slice(0, 220) } : {}),
    });
  }

  const fetched = rows.filter((r) => r.fetched);
  const unavailable = rows.length - fetched.length;
  say(`fetched ${fetched.length}, unavailable ${unavailable}`);
  say(
    `legacy units ${fetched.reduce((a, r) => a + r.legacyUnits, 0)} -> new ${fetched.reduce((a, r) => a + r.newUnits, 0)}`,
  );
  say(
    `articles whose legacy extraction carried a candidate fusion: ${fetched.filter((r) => r.candidateFusionInLegacy).length}`,
  );
  say(
    `CONFIRMED: the stored fused unit is divided by the new extraction: ${fetched.filter((r) => r.confirmedFusion).length}`,
  );
  say(`articles that lost more than 5 words: ${fetched.filter((r) => r.lostText).length}`);
  say(`articles that gained more than 5 words: ${fetched.filter((r) => r.duplicatedText).length}`);
  for (const row of fetched.filter((r) => r.confirmedFusion || r.candidateFusionInLegacy)) {
    say(`  · [${row.confirmedFusion ? "CONFIRMED" : "candidate"}] ${row.title}`);
    say(
      `      ${row.source} — units ${row.legacyUnits} -> ${row.newUnits}${row.lostText ? ` · ${row.lostText}` : ""}`,
    );
    if (row.example) say(`      was: ${row.example}`);
  }
  for (const row of rows.filter((r) => !r.fetched)) {
    say(`  · [unavailable] ${row.url} — ${row.reason}`);
  }
  if (out) {
    writeFileSync(out, `${JSON.stringify(rows, null, 1)}\n`);
    say(`rows written to ${out}`);
  }
});
