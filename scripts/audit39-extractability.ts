/**
 * Audit 39 — why the parked families fail, measured against the live web.
 *
 * The failure counters say a source failed; they do not say whether it is
 * unreachable, refused, guarded out, or simply thin. This instrument answers
 * that per family, read-only:
 *
 *   - fetch each of a family's newest articles with the pipeline's own user
 *     agent and no database writes at all (nothing here touches eligibility,
 *     the latch, the attempt clock or probe candidacy);
 *   - run the pipeline's own extractor over the response, so the word count
 *     and evidence-unit count are the ones production would produce;
 *   - print the response size next to the extractor's word count and next to
 *     `MAX_ARTICLE_BYTES` in `article-fetch.ts`, which is what turned the
 *     1.5MB cap into the Audit 39 ruling (Tom's Hardware's pages are
 *     1.79-1.95MB and extract cleanly, so the cap, not the source, was the
 *     obstacle for 784 unattempted articles).
 *
 * A 200 here is not production enrichment evidence: it establishes that the
 * extraction path can recover a family, not that the source lifecycle has
 * recovered. Failures are informative in the same direction -- an intermittent
 * 403 (OpenAI) and a genuinely thin feed (Next.js canary releases) call for
 * different responses, and only this kind of look tells them apart.
 *
 * Network-read only, service-role client for the article list. Node 22+.
 */

import { db, heading, main, row as rowLine, say } from "./lib/db.ts";
import { ARTICLE_USER_AGENT } from "../src/lib/pipeline/article-fetch.ts";
import { extractMainText } from "../src/lib/pipeline/html-text.ts";
import { selectEvidenceUnits } from "../src/lib/pipeline/evidence-extract.ts";

/** Refuse to hold a pathological page: four times the fetch cap. */
const SURVEY_BYTE_BUDGET = 12 * 1024 * 1024;
/** Articles per family. Enough to see a pattern, small enough to stay quick. */
const SAMPLE = 8;
/** Default: every latched family, which is what the audit is about. */
const FAMILIES = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

main(async () => {
  const client = db();
  const query = client
    .from("sources")
    .select("id, name, enrichment_failure_count, enrichment_last_success");
  const { data: sources, error } =
    FAMILIES.length > 0
      ? await query.in("name", FAMILIES)
      : await query.gte("enrichment_failure_count", 5);
  if (error) throw new Error(`sources: ${error.message}`);

  heading("Audit 39 — extractability survey (read-only)");
  say("  words+units means the extraction path can recover the family;");
  say("  thin means the page has almost no text; http=403 means refusal;");
  say("  kb next to MAX_ARTICLE_BYTES says whether the fetch cap is the obstacle.");

  for (const source of sources ?? []) {
    const { data: articles, error: articleError } = await client
      .from("articles")
      .select("id, url, title, published_at")
      .eq("source_id", source.id)
      .order("published_at", { ascending: false })
      .limit(SAMPLE);
    if (articleError) throw new Error(`articles(${source.name}): ${articleError.message}`);
    say();
    heading(`${source.name} — newest ${SAMPLE}`);
    for (const article of articles ?? []) {
      const url = String(article.url);
      let status: number | null = null;
      let bytes = 0;
      let words = 0;
      let units = 0;
      let note = "";
      try {
        const response = await fetch(url, {
          headers: { "user-agent": ARTICLE_USER_AGENT, accept: "text/html,application/xhtml+xml" },
          redirect: "follow",
        });
        status = response.status;
        const body = await response.text();
        bytes = body.length;
        if (status === 200 && bytes <= SURVEY_BYTE_BUDGET) {
          const text = extractMainText(body);
          words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
          units = selectEvidenceUnits(text, undefined, article.title ?? undefined, {
            name: source.name ?? undefined,
            url,
          }).length;
          if (words < 60) note = "thin";
        }
      } catch (error) {
        note = error instanceof Error ? error.message : String(error);
      }
      say(
        rowLine(
          `${String(article.published_at).slice(0, 10)} ${url.slice(0, 46)}`,
          `http=${status ?? "—"} kb=${Math.round(bytes / 1024)} words=${words} units=${units}${note ? ` ${note}` : ""}`,
        ),
      );
    }
  }
});
