/**
 * Audit 37 — lifetime-success eligibility semantics: investigation census.
 *
 * v2. v1 read all five backed-off sources in ONE combined `.in()` query; the
 * rows summed to exactly 1000 — PostgREST's default max_rows — and llama.cpp
 * releases, last in the returned order, was silently truncated (614 -> 314
 * rows, 6 enriched rows -> 0). v1's "successes vanished" finding was an
 * artifact of that cap. This version reads each source in its own paginated
 * queries and additionally evaluates the shipped probe's success predicate
 * ("success on an article published within 7 days") against the lifetime
 * predicate ("any enriched row"), which is the exact gap Audit 37 exists to
 * rule on.
 *
 * Read-only. Service-role SELECTs only. Node 22 or later.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

type EvidenceRow = { status: string | null; extracted_at: string | null };

type ArticleRow = {
  id: string;
  event_id: string | null;
  published_at: string;
  sources: { id: string; name: string | null; enrichment_failure_count: number } | null;
  article_evidence: EvidenceRow | null;
};

type PreCensus = {
  takenAt: string;
  backedOffSources: {
    id: string;
    name: string | null;
    corpus: number;
    successes: number;
    lastSuccess: string | null;
    lastFailedAt: string | null;
  }[];
};

const HOUR = 3_600_000;
/** PostgREST default max_rows is 1000; page well under it. */
const PAGE = 500;

main(async () => {
  const args = process.argv.slice(2);
  const argOf = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const out =
    argOf("--out") ?? `${process.env["HOME"] ?? ""}/.nyuz-artifacts/audit37-investigation.json`;
  const prePath = argOf("--pre") ?? `${process.env["HOME"] ?? ""}/.nyuz-artifacts/audit36-pre.json`;
  const pre: PreCensus = JSON.parse(readFileSync(prePath, "utf8")) as PreCensus;
  const client = db();
  const now = new Date();
  const ageCutoff = now.getTime() - 72 * HOUR;
  const gateCutoff = now.getTime() - 7 * 24 * HOUR; // the shipped gate's window

  heading("Audit 37 — lifetime-success semantics: investigation census (v2)");
  say(rowLine("pre-census artifact", `${pre.takenAt} (${prePath})`));
  say(
    rowLine(
      "v1 finding corrected",
      "combined 5-source read hit the 1000-row PostgREST cap; per-source reads replace it",
    ),
  );

  const { data: backedOff, error: sourcesError } = await client
    .from("sources")
    .select("id, name, enrichment_failure_count, enrichment_allowed")
    .gte("enrichment_failure_count", 5);
  if (sourcesError) throw new Error(`sources: ${sourcesError.message}`);
  const sources = backedOff ?? [];
  say(rowLine("backed-off sources (failures >= 5)", sources.length));

  type Profile = {
    id: string;
    name: string | null;
    failures: number;
    allowed: boolean | null;
    corpus: number;
    enriched: number;
    lastEnrichedAt: string | null;
    failed: number;
    lastFailedAt: string | null;
    other: number;
    unattempted: number;
    unattemptedYoung: number;
    parkedEvents: number;
    /** The shipped gate's success signal: an enriched row on an article published within 7 days. */
    gateSuccess: boolean;
    /** The ruling's intended signal: any enriched row at all. */
    lifetimeSuccess: boolean;
    newestEnrichedPublished: string | null;
  };
  const profiles = new Map<string, Profile>();
  for (const source of sources) {
    profiles.set(source.id, {
      id: source.id,
      name: source.name,
      failures: source.enrichment_failure_count,
      allowed: source.enrichment_allowed,
      corpus: 0,
      enriched: 0,
      lastEnrichedAt: null,
      failed: 0,
      lastFailedAt: null,
      other: 0,
      unattempted: 0,
      unattemptedYoung: 0,
      parkedEvents: 0,
      gateSuccess: false,
      lifetimeSuccess: false,
      newestEnrichedPublished: null,
    });
  }

  const readAll = async (sourceId: string): Promise<ArticleRow[]> => {
    const rows: ArticleRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await client
        .from("articles")
        .select(
          "id, event_id, published_at, sources(id, name, enrichment_failure_count), article_evidence(status, extracted_at)",
        )
        .eq("source_id", sourceId)
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`articles(${sourceId}): ${error.message}`);
      const page = (data ?? []) as unknown as ArticleRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  };

  const parkedEvents = new Map<string, Set<string>>();
  for (const source of sources) {
    const profile = profiles.get(source.id);
    if (!profile) continue;
    const rows = await readAll(source.id);
    for (const row of rows) {
      profile.corpus += 1;
      if (row.event_id) {
        (parkedEvents.get(source.id) ?? parkedEvents.set(source.id, new Set()).get(source.id)!).add(
          row.event_id,
        );
      }
      const evidence = row.article_evidence;
      if (!evidence) {
        profile.unattempted += 1;
        if ((Date.parse(row.published_at) || 0) >= ageCutoff) profile.unattemptedYoung += 1;
        continue;
      }
      if (evidence.status === "enriched") {
        profile.enriched += 1;
        const at = evidence.extracted_at;
        if (at && (!profile.lastEnrichedAt || at > profile.lastEnrichedAt)) {
          profile.lastEnrichedAt = at;
        }
        const published = Date.parse(row.published_at) || 0;
        if (published >= gateCutoff) profile.gateSuccess = true;
        if (
          published &&
          (!profile.newestEnrichedPublished ||
            published > Date.parse(profile.newestEnrichedPublished))
        ) {
          profile.newestEnrichedPublished = row.published_at;
        }
      } else if (evidence.status === "failed" || evidence.status === "unavailable") {
        profile.failed += 1;
        const at = evidence.extracted_at;
        if (at && (!profile.lastFailedAt || at > profile.lastFailedAt)) profile.lastFailedAt = at;
      } else {
        profile.other += 1;
      }
    }
    profile.lifetimeSuccess = profile.enriched > 0;
    profile.parkedEvents = parkedEvents.get(source.id)?.size ?? 0;
  }

  heading("Live evidence profiles (per-source reads, no cap truncation)");
  let totalEvents = 0;
  for (const source of sources) {
    const p = profiles.get(source.id);
    if (!p) continue;
    totalEvents += p.parkedEvents;
    say(
      `  ${String(p.name ?? p.id.slice(0, 8))
        .slice(0, 24)
        .padEnd(
          24,
        )} failures=${String(p.failures).padStart(3)}  corpus=${String(p.corpus).padStart(4)}  enriched=${String(p.enriched).padStart(3)} (last ${(p.lastEnrichedAt ?? "never").slice(0, 16)}, newest published ${(p.newestEnrichedPublished ?? "n/a").slice(0, 10)})  failed=${String(p.failed).padStart(3)} (last ${(p.lastFailedAt ?? "—").slice(0, 16)})  unattempted=${String(p.unattempted).padStart(4)} (<=72h: ${String(p.unattemptedYoung).padStart(3)})  parkedEvents=${String(p.parkedEvents).padStart(3)}`,
    );
    say(
      `    gate signal (success published <=7d): ${p.gateSuccess ? "YES" : "no"}    lifetime signal (any enriched row): ${p.lifetimeSuccess ? "YES" : "no"}`,
    );
  }
  say(rowLine("parked events across latched families", totalEvents));

  // ---------------------------------------------------------------------------
  // v1-vs-v2 artifact note: what the truncated read claimed vs what is true
  // ---------------------------------------------------------------------------
  heading("v1 truncation artifact, per source (v1 claimed -> actual)");
  for (const source of sources) {
    const p = profiles.get(source.id);
    const before = pre.backedOffSources.find((s) => s.id === source.id);
    if (!p) continue;
    say(
      `  ${String(p.name ?? p.id.slice(0, 8))
        .slice(0, 24)
        .padEnd(
          24,
        )} corpus pre=${before ? String(before.corpus).padStart(4) : "  --"} now=${String(p.corpus).padStart(4)}  enriched now=${String(p.enriched).padStart(3)} (last ${p.lastEnrichedAt ? p.lastEnrichedAt.slice(0, 16) : "never"})`,
    );
  }

  writeFileSync(
    out,
    `${JSON.stringify(
      {
        takenAt: now.toISOString(),
        preCensusTakenAt: pre.takenAt,
        version: 2,
        v1Artifact:
          "v1 combined 5-source read hit the 1000-row PostgREST max_rows cap; llama.cpp (last in return order) was truncated 614->314 rows and its 6 enriched rows were hidden. v1's 'successes vanished' claim was false.",
        profiles: [...profiles.values()],
        notes: {
          retentionHorizonDays: 420,
          evidenceMutability:
            "finish() sets status once per article; reclaim deletes only pending rows; no path rewrites enriched -> other (committed code)",
          gatePredicate:
            "shipped probe: success on article published >= now-7d (PROBE_HISTORY_DAYS window)",
          lifetimePredicate: "ruling intent: any enriched row, any age",
        },
      },
      null,
      1,
    )}\n`,
  );
  say();
  say(`written to ${out}`);
});
