/**
 * What clustering has actually cost, and what the shadow layer has actually seen.
 *
 *   npm run audit:cluster
 *
 * Stage 4 has `events.analysis_tokens`, so the analysis bill can be read straight
 * out of a column. Stage 3's spend is not missing — every clustering call has gone
 * through `ai_usage_ledger` since 0017 and carries `feature = 'cluster'` since 0053
 * — but it was never joined to anything, so "roughly 610 tokens per article" in
 * docs/status.md stood in for a number the database could have answered. Measured
 * here on 2026-09-05: 1,201 tokens per settled call, not 610.
 *
 * The three sections that matter, in order of how badly they were misread before:
 *
 *   1. `cluster_shadow_log` against the real call count. Rows written before 0057
 *      exist only where the deterministic layer was confident, so reading the table
 *      alone reports the numerator of its own success rate. 98 rows, 884 calls.
 *   2. The ledger by feature, which is the actual bill.
 *   3. A replay of `shortlist` + `verdictFor` over the live unclustered backlog,
 *      which is the only way to see the verdict mix without waiting for 0057 rows
 *      to accumulate. No model is called.
 *
 * It writes nothing. Safe to run against production, and meant to be.
 */

import { db, heading, main, row, say } from "./lib/db.ts";
import { shortlist } from "@/lib/pipeline/shortlist";
import { verdictFor } from "@/lib/pipeline/confidence";

const HEAD = { count: "exact", head: true } as const;
/** PostgREST's `db-max-rows` on Supabase. An unpaginated read silently stops here. */
const PAGE = 1000;

type CountQuery = PromiseLike<{ count: number | null; error: { message: string } | null }>;

async function n(query: CountQuery): Promise<number> {
  const { count: value, error } = await query;
  if (error) throw new Error(error.message);
  return value ?? 0;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`;
}

/**
 * Every `event_id`, not the first thousand.
 *
 * PostgREST caps a response at 1000 rows silently — no error, just fewer rows —
 * which is how a corpus-wide ratio ends up computed over a fraction of the corpus.
 */
async function articleEventIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("articles")
      .select("event_id")
      .not("event_id", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`articles: ${error.message}`);
    const batch = data ?? [];
    for (const article of batch) if (article.event_id !== null) ids.push(article.event_id);
    if (batch.length < PAGE) return ids;
  }
}

async function analysisTokens(): Promise<number[]> {
  const tokens: number[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("events")
      .select("analysis_tokens")
      .gt("analysis_tokens", 0)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`events: ${error.message}`);
    const batch = data ?? [];
    for (const event of batch) tokens.push(event.analysis_tokens);
    if (batch.length < PAGE) return tokens;
  }
}

type ShadowRow = {
  shadow_verdict: string;
  shadow_matched_id: string | null;
  model_matched_id: string | null;
  agreed: boolean | null;
  candidates: number;
};

async function shadowRows(): Promise<ShadowRow[]> {
  const rows: ShadowRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("cluster_shadow_log")
      .select("shadow_verdict, shadow_matched_id, model_matched_id, agreed, candidates")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`cluster_shadow_log: ${error.message}`);
    const batch = (data ?? []) as ShadowRow[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

main(async () => {
  const articles = () => db().from("articles").select("*", HEAD);
  const events = () => db().from("events").select("*", HEAD);

  heading("Corpus");
  const totalArticles = await n(articles());
  const clustered = await n(articles().not("event_id", "is", null));
  const unclustered = await n(articles().is("event_id", null));
  const totalEvents = await n(events());
  say(row("articles", totalArticles));
  say(row("  clustered", clustered));
  say(row("  unclustered", unclustered));
  say(row("events", totalEvents));
  say(row("articles/event", totalEvents === 0 ? "n/a" : (clustered / totalEvents).toFixed(3)));

  heading("Event composition");
  const ids = await articleEventIds();
  const perEvent = new Map<string, number>();
  for (const id of ids) perEvent.set(id, (perEvent.get(id) ?? 0) + 1);
  const sizes = [...perEvent.values()];
  const singletons = sizes.filter((s) => s === 1).length;
  const multi = sizes.filter((s) => s > 1).length;
  say(row("events seen", sizes.length));
  say(row("  1 article", `${singletons} (${pct(singletons, sizes.length)})`));
  say(row("  2+ articles", `${multi} (${pct(multi, sizes.length)})`));
  say(row("largest event", sizes.length === 0 ? 0 : Math.max(...sizes)));
  say(
    row(
      "articles in multi",
      sizes.filter((s) => s > 1).reduce((a, b) => a + b, 0),
    ),
  );

  heading("Event status");
  for (const status of ["pending", "analysing", "complete", "failed"] as const) {
    say(row(status, await n(events().eq("status", status))));
  }

  heading("Analysis ledger (real column)");
  const tokens = await analysisTokens();
  const totalTokens = tokens.reduce((a, b) => a + b, 0);
  say(row("events with tokens", tokens.length));
  say(row("total tokens", totalTokens));
  say(row("mean/event", tokens.length === 0 ? "n/a" : Math.round(totalTokens / tokens.length)));

  heading("Cluster shadow log");
  const rows = await shadowRows();
  say(row("rows", rows.length));

  if (rows.length === 0) {
    say();
    say("EMPTY. No shadow measurement exists. No skip threshold can be");
    say("justified from data, and none should be invented.");
    return;
  }

  for (const verdict of ["same", "different", "ambiguous"] as const) {
    const seen = rows.filter((r) => r.shadow_verdict === verdict).length;
    say(row(`  ${verdict}`, `${seen} (${pct(seen, rows.length)})`));
  }

  const decidable = rows.filter((r) => r.agreed !== null);
  const agreed = decidable.filter((r) => r.agreed === true).length;
  say(row("decidable", decidable.length));
  say(row("agreed", `${agreed} (${pct(agreed, decidable.length)})`));

  heading("Confusion matrix (decidable only)");
  let sameSame = 0;
  let sameNew = 0;
  let newSame = 0;
  let newNew = 0;
  for (const r of decidable) {
    const modelSame = r.model_matched_id !== null;
    if (r.shadow_verdict === "same") {
      if (modelSame) sameSame++;
      else sameNew++;
    } else if (r.shadow_verdict === "different") {
      if (modelSame) newSame++;
      else newNew++;
    }
  }
  say(row("same / same", sameSame));
  say(row("same / new", sameNew));
  say(row("new / same", newSame));
  say(row("new / new", newNew));

  heading("Model outcomes across the whole log");
  const noMatch = rows.filter((r) => r.model_matched_id === null).length;
  say(row("model: no match", `${noMatch} (${pct(noMatch, rows.length)})`));
  say(row("model: matched", rows.length - noMatch));
  const meanCandidates = rows.reduce((a, r) => a + r.candidates, 0) / rows.length;
  say(row("mean candidates", meanCandidates.toFixed(1)));

  await ledger();
  await replay();
});

/**
 * The real clustering bill, per call, from `ai_usage_ledger`.
 *
 * `feature` has been on the ledger since 0053, and `cluster.ts` tags its calls,
 * so this is a measured number rather than the per-article estimate in
 * docs/status.md. Rows written before 0053 are `'unknown'` and are shown
 * separately rather than folded in.
 */
async function ledger(): Promise<void> {
  heading("AI usage ledger by feature (real rows)");

  type LedgerRow = {
    feature: string;
    capability: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    cost_microusd: number | null;
    estimated_cost_microusd: number | null;
    created_at: string;
  };

  const all: LedgerRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("ai_usage_ledger")
      .select(
        "feature, capability, model, prompt_tokens, completion_tokens, cost_microusd, estimated_cost_microusd, created_at",
      )
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ai_usage_ledger: ${error.message}`);
    const batch = (data ?? []) as LedgerRow[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }

  say(row("ledger rows", all.length));
  if (all.length === 0) return;

  const byFeature = new Map<string, LedgerRow[]>();
  for (const r of all) byFeature.set(r.feature, [...(byFeature.get(r.feature) ?? []), r]);

  say();
  say(`${"feature".padEnd(10)} ${"calls".padStart(7)} ${"tokens".padStart(10)} ${"$".padStart(9)}`);
  for (const [feature, list] of [...byFeature].sort((a, b) => b[1].length - a[1].length)) {
    const tokens = list.reduce((a, r) => a + r.prompt_tokens + r.completion_tokens, 0);
    // `coalesce(actual, estimate)` — the same rule the ceiling uses. A row still
    // in flight has only an estimate, and treating that as zero would understate
    // the bill by exactly the calls that have not settled.
    const cost = list.reduce((a, r) => a + (r.cost_microusd ?? r.estimated_cost_microusd ?? 0), 0);
    say(
      `${feature.padEnd(10)} ${String(list.length).padStart(7)} ${String(tokens).padStart(10)} ` +
        `${(cost / 1_000_000).toFixed(4).padStart(9)}`,
    );
  }

  const cluster = byFeature.get("cluster") ?? [];
  if (cluster.length > 0) {
    heading("Clustering, measured");
    const prompt = cluster.reduce((a, r) => a + r.prompt_tokens, 0);
    const completion = cluster.reduce((a, r) => a + r.completion_tokens, 0);
    const cost = cluster.reduce(
      (a, r) => a + (r.cost_microusd ?? r.estimated_cost_microusd ?? 0),
      0,
    );
    say(row("calls", cluster.length));
    say(row("prompt tokens", prompt));
    say(row("completion tokens", completion));
    say(row("total tokens", prompt + completion));
    say(row("mean tokens/call", Math.round((prompt + completion) / cluster.length)));
    say(row("cost USD", (cost / 1_000_000).toFixed(4)));
    say(row("cost/call USD", (cost / 1_000_000 / cluster.length).toFixed(6)));
    const models = new Set(cluster.map((r) => r.model));
    say(row("models", [...models].join(", ")));
    const first = cluster[0]?.created_at.slice(0, 10) ?? "?";
    const last = cluster[cluster.length - 1]?.created_at.slice(0, 10) ?? "?";
    say(row("window", `${first} .. ${last}`));
  }
}

/**
 * What the deterministic layer would say about articles waiting to be clustered.
 *
 * `cluster_shadow_log` cannot answer this: `recordShadow` only writes when there
 * was something to compare, so every `ambiguous` verdict — the ones that would
 * still cost a model call — is missing from it. The bypass rate is a fraction
 * whose denominator is therefore absent from the table entirely.
 *
 * This replays the real `shortlist()` and the real `verdictFor()` over a sample
 * of the actual unclustered backlog. No model is called and nothing is written,
 * so it costs a few hundred index-served queries and nothing else.
 */
async function replay(): Promise<void> {
  const size = Number(process.env["SAMPLE"] ?? 400);
  heading(`Deterministic replay over ${size} unclustered articles`);

  const { data, error } = await db()
    .from("articles")
    .select("id, title, published_at")
    .is("event_id", null)
    .order("published_at", { ascending: false })
    .limit(size);
  if (error) throw new Error(`replay sample: ${error.message}`);
  const sample = data ?? [];

  let emptyShortlist = 0;
  const verdicts = { same: 0, different: 0, ambiguous: 0 };
  const candidateCounts: number[] = [];

  for (const article of sample) {
    const candidates = await shortlist(db(), article, { size: 10 });
    if (candidates.length === 0) {
      // Either no distinctive tokens (free path) or genuinely no neighbour.
      // Both are already free today and are not a bypass saving.
      emptyShortlist++;
      continue;
    }
    candidateCounts.push(candidates.length);
    const verdict = verdictFor(article.title, candidates);
    verdicts[verdict.verdict]++;
  }

  const reachedModel = verdicts.same + verdicts.different + verdicts.ambiguous;
  say(row("sampled", sample.length));
  say(row("no shortlist (free)", `${emptyShortlist} (${pct(emptyShortlist, sample.length)})`));
  say(row("would call model", `${reachedModel} (${pct(reachedModel, sample.length)})`));
  say();
  say("Of the articles that reach the model today:");
  say(row("  same", `${verdicts.same} (${pct(verdicts.same, reachedModel)})`));
  say(row("  different", `${verdicts.different} (${pct(verdicts.different, reachedModel)})`));
  say(row("  ambiguous", `${verdicts.ambiguous} (${pct(verdicts.ambiguous, reachedModel)})`));
  const meanCands =
    candidateCounts.reduce((a, b) => a + b, 0) / Math.max(candidateCounts.length, 1);
  say(row("mean candidates", meanCands.toFixed(1)));
}
