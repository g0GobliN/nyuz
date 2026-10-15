/**
 * What summary lines did readers actually receive, and which boundary refuses each one?
 *
 * The denominator that matters for reader quality is the delivered surface -- `digests` +
 * `digest_items` + `deliveries` -- not the newest events. This audit exists because that measurement
 * was taken once from a scratch file and then could not be reproduced when its predicate set
 * mattered (2026-10-15: the guard built for the ruling refused fewer lines than the recorded count,
 * and there was nothing on disk to say which boundary the original count had used). Every count it
 * prints names the predicate that produced it, so a number from this file can be checked and
 * repeated.
 *
 * It reads the surface through the same resolver the reader surfaces use (`deliveredLine` in
 * `reader-summary.ts`): the item's own composed artifact first (0118), its stored line second,
 * guarded, and nothing when neither may be shown. That is what makes the must-be-zero line meaningful
 * -- it fails if any surface, or any future writer, prints a line the boundaries refuse.
 *
 * Usage: npm run audit:delivered-summary [--days 21] [--no-recompute]
 *
 * Measured 2026-10-15, three times, 21 days, **before the composed artifact existed**: 20 briefings
 * delivered, 297 items delivered, 289 carrying a line, **10 of those 289 withheld by the guard now
 * in force**, 11 of 297 refused by any boundary on the list (the extra one is the deck-scoped rule),
 * 8 of the 20 briefings (40%) carrying at least one such item, and 8 items (2.69%) delivered with no
 * line at all.
 *
 * With the artifact in place, the same three quantities are reported as one: of the items whose
 * stored line a boundary refuses, how many are delivered with a valid composed line instead, how
 * many are delivered with no line at all, and how many had a refused line printed to a reader --
 * which must be zero, and is zero by construction because the refusal is asked before anything is
 * printed.
 *
 * `--recompute` is on by default and bounded to the refused items that have no stored artifact: for
 * each, it composes the line the build *would* store, from the same inputs the build composes from,
 * and reports whether it validates. Rows built before 0118 cannot carry an artifact, so this is the
 * only way to see the composed half's effect on them without rewriting delivered history -- and it is
 * labelled as a recomputation, never as the delivered surface.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import {
  admissibleReaderSentence,
  developmentRecord,
  editorialNoise,
  noMainClause,
  publisherSelfReference,
  unresolvedContextOpening,
  type ReaderSource,
} from "../src/lib/reader-evidence";
import { assessReadiness } from "../src/lib/pipeline/readiness";
import { assessAlertFloor } from "../src/lib/pipeline/alert-floor";
import {
  composedSummaryArtifact,
  deliveredLine,
  deliveredSummary,
} from "../src/lib/reader-summary";

const DAYS = (() => {
  const flag = process.argv.indexOf("--days");
  const value = flag === -1 ? 21 : Number(process.argv[flag + 1]);
  return Number.isFinite(value) && value > 0 ? value : 21;
})();

const RECOMPUTE = !process.argv.includes("--no-recompute");

/**
 * When the new code went live, so the report can split the cohorts the ruling requires.
 *
 * `--deploy-at <iso>` with the deploy's commit time. Without it the report says so rather than
 * printing a combined number that could be read as post-deploy evidence (arbiter ruling,
 * 2026-10-15: "The historical figures ... must not be combined with new-code results in a way that
 * hides whether the repair path actually ran").
 */
const DEPLOY_AT = (() => {
  const flag = process.argv.indexOf("--deploy-at");
  const raw = flag === -1 ? null : (process.argv[flag + 1] ?? null);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
})();

/** Every boundary a reader-facing line is held to, named so the report can attribute a refusal. */
const BOUNDARIES: { name: string; refuses: (text: string) => boolean }[] = [
  { name: "shared sentence boundary", refuses: (t) => !admissibleReaderSentence(t) },
  { name: "editorial noise", refuses: editorialNoise },
  { name: "publisher self-reference", refuses: publisherSelfReference },
  { name: "no main clause (deck boundary)", refuses: noMainClause },
  { name: "unresolved context opening (card boundary)", refuses: unresolvedContextOpening },
];

const pct = (numerator: number, denominator: number): string =>
  `${((numerator / Math.max(denominator, 1)) * 100).toFixed(2)}%`;

/**
 * The other delivered surface: a breaking alert's text.
 *
 * An alert stores no summary line of its own. `create_alert_delivery` writes the event's own
 * description into `digest_items.why_it_matters` (`p_why: event.whatHappened || event.title` in
 * `alerts.ts`), and that one text is what the reader gets twice over: as the alert email's body
 * paragraph and as the Alerts page's explanation. So it is the same raw column the briefing joins,
 * which is why the ruling's covered surfaces name it -- but it is **not the same artifact class**.
 * A briefing line is one sentence; an alert's is the alert body, admitted by the fire gate
 * (`assessReadiness` and `assessAlertFloor`) rather than by the sentence boundary, and measuring it
 * against that boundary mostly reports the class difference (a two-sentence paragraph is not a
 * sentence). Measured 2026-10-15 over 60 days: 184 delivered alerts, 26 of their lines refused by
 * the sentence boundary, 20 of those for being more than one sentence, and **every line that is a
 * defect in any class -- a development record, editorial noise, an unresolved-context opening, a
 * publisher self-reference -- comes from an event today's fire gate refuses**, so no current path can
 * deliver one. That last sentence is the must-be-zero line for this surface, and it is printed as a
 * count of live violations rather than asserted.
 */
async function alertSurface(db: SupabaseClient<Database>, since: string): Promise<void> {
  const { data: digests } = await db
    .from("digests")
    .select("digest_id")
    .eq("kind", "alert")
    .gte("scheduled_for", since);
  const ids = (digests ?? []).map((d) => d.digest_id);
  if (ids.length === 0) return;

  const sent = new Set(
    ((await db.from("deliveries").select("digest_id, status").in("digest_id", ids)).data ?? [])
      .filter((d) => d.status === "sent")
      .map((d) => d.digest_id),
  );

  type AlertItem = {
    digest_id: string;
    event_id: string;
    why_it_matters: string | null;
    summary: string | null;
  };
  const items: AlertItem[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await db
      .from("digest_items")
      .select("digest_id, event_id, why_it_matters, summary")
      .in("digest_id", ids.slice(i, i + 50));
    items.push(...((data ?? []) as AlertItem[]));
  }
  const delivered = items.filter((item) => sent.has(item.digest_id));

  const refused = delivered.filter(
    (item) =>
      (item.why_it_matters ?? "").trim() !== "" && deliveredSummary(item.why_it_matters) === null,
  );
  const classOnly = refused.filter((item) => {
    const why = (item.why_it_matters ?? "").trim();
    return !publisherSelfReference(why) && !editorialNoise(why) && !unresolvedContextOpening(why);
  });

  console.log(
    `\nalert surface, last ${DAYS} days: alerts delivered ${sent.size}, items delivered ${delivered.length}, carrying a stored artifact ${delivered.filter((i) => i.summary !== null).length}`,
  );
  console.log(
    `  lines the sentence boundary refuses: ${refused.length} of ${delivered.length} = ${pct(refused.length, delivered.length)} (of which ${classOnly.length} only because an alert's line is not one sentence)`,
  );

  // The must-be-zero question for this surface: is any refused line's event one the fire gate would
  // still admit? Readiness and the floor are asked over the same inputs the alert stage asks them
  // with, so an admitted event means the class is still deliverable and the line is a live defect.
  const suspect = refused.filter((item) => !classOnly.includes(item));
  if (suspect.length === 0) {
    console.log("  refused lines a defect in any class: 0 <- must be zero");
    return;
  }

  const eventIds = [...new Set(suspect.map((item) => item.event_id))];
  const { data: events } = await db
    .from("events")
    .select("id, title, what_happened, publisher_count, first_seen_at, material_occurrence_at")
    .in("id", eventIds);
  const { data: coverage } = await db
    .from("articles")
    .select("event_id, source_id, title, excerpt, sources ( name, kind )")
    .in("event_id", eventIds);
  const sources = new Map<string, ReaderSource[]>();
  const outlets = new Map<string, Set<string>>();
  const kinds = new Map<string, Set<string>>();
  for (const row of coverage ?? []) {
    if (!row.event_id) continue;
    const list = sources.get(row.event_id) ?? [];
    list.push({
      name: (row.sources as { name?: string } | null)?.name ?? "Unattributed",
      ...(row.title ? { headline: row.title } : {}),
      ...(row.excerpt ? { excerpt: row.excerpt } : {}),
    });
    sources.set(row.event_id, list);
    outlets.set(row.event_id, (outlets.get(row.event_id) ?? new Set()).add(row.source_id ?? "?"));
    const kind = (row.sources as { kind?: string } | null)?.kind;
    if (kind) kinds.set(row.event_id, (kinds.get(row.event_id) ?? new Set()).add(kind));
  }

  let live = 0;
  for (const item of suspect) {
    const event = (events ?? []).find((e) => e.id === item.event_id);
    const why = (item.why_it_matters ?? "").trim();
    const verdict = assessReadiness({
      title: event?.title ?? "",
      whatHappened: why,
      sourceCount: outlets.get(item.event_id)?.size ?? event?.publisher_count ?? 0,
      sourceKinds: [...(kinds.get(item.event_id) ?? [])],
      sources: sources.get(item.event_id) ?? [],
      publishedAt: event?.material_occurrence_at ?? event?.first_seen_at ?? null,
    });
    const floor = verdict.ready
      ? assessAlertFloor({ title: event?.title ?? "", whatHappened: why })
      : null;
    const admitted = verdict.ready && floor?.ready === true;
    if (admitted) live += 1;
    // The class that flags the line, per line, beside the gate's own disposition: the ruling's
    // caveat is that a blocked example must be shown blocked by its **actual** disposition rather
    // than inferred from the event's category (2026-10-15).
    const classes = [
      developmentRecord(why) ? "development record" : "",
      editorialNoise(why) ? "editorial noise" : "",
      unresolvedContextOpening(why) ? "unresolved context opening" : "",
      publisherSelfReference(why) ? "publisher self-reference" : "",
    ]
      .filter(Boolean)
      .join(" + ");
    const disposition = admitted
      ? "STILL ADMITTED by the fire gate -- a live defect"
      : verdict.ready
        ? "refused by the alert floor today"
        : `refused by readiness today (${verdict.kind})`;
    console.log(`   [${classes}] ${disposition} :: ${event?.title ?? "(no title)"}`);
  }
  console.log(
    `  refused lines a defect in any class AND admitted by today's fire gate: ${live} <- must be zero`,
  );
}

async function main() {
  // The two names `.env.example` documents; the env contract test in this repo fails a variable read
  // by the code but absent from that file, which is how this line was corrected on 2026-10-15.
  const url = process.env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const { data: digests, error: digestError } = await db
    .from("digests")
    .select("digest_id, user_id, scheduled_for, generated_at")
    .eq("kind", "briefing")
    .gte("scheduled_for", since);
  if (digestError) throw new Error(`reading digests: ${digestError.message}`);
  const digestIds = (digests ?? []).map((d) => d.digest_id);

  // Two denominators, and the report states both. "A delivery row exists" is the definition the
  // 20-briefings/297-items baseline was recorded with; `status` on this surface is not decoration --
  // measured 2026-10-15, 7 of those 20 briefings have **only failed** deliveries (20 rows failed, 13
  // sent), so a row can exist for a digest no reader ever received. The reader-facing denominator is
  // "at least one channel actually sent it", used for every headline number below, and the earlier
  // denominator is printed beside it so the rebased baseline is visible rather than silently swapped.
  const deliveryRows = (
    await db.from("deliveries").select("digest_id, status").in("digest_id", digestIds)
  ).data;
  const delivered = new Set(
    (deliveryRows ?? []).filter((d) => d.status === "sent").map((d) => d.digest_id),
  );
  const anyDeliveryRow = new Set((deliveryRows ?? []).map((d) => d.digest_id));

  // The generated types declare this relation as an array while the query returns the single related
  // row as an object -- measured 2026-10-15, when the array-only accessor silently read no rows at
  // all and the audit reported zero lines. `eventOf` accepts both shapes so neither reading is
  // assumed.
  type JoinedEvent = {
    id: string;
    title: string | null;
    what_happened: string | null;
    material_occurrence_at: string | null;
    first_seen_at: string | null;
  };
  type ItemRow = {
    digest_id: string;
    event_id: string;
    summary: string | null;
    events: JoinedEvent | JoinedEvent[] | null;
  };
  const eventOf = (row: ItemRow): JoinedEvent | null => {
    const relation = row.events;
    if (!relation) return null;
    return Array.isArray(relation) ? (relation[0] ?? null) : relation;
  };

  const items: ItemRow[] = [];
  for (let i = 0; i < digestIds.length; i += 50) {
    const { data, error } = await db
      .from("digest_items")
      .select(
        "digest_id, event_id, summary, events ( id, title, what_happened, material_occurrence_at, first_seen_at )",
      )
      .in("digest_id", digestIds.slice(i, i + 50));
    if (error) throw new Error(`reading digest_items: ${error.message}`);
    items.push(...(data ?? []));
  }

  /**
   * Every number the report states, from one set of delivered items.
   *
   * Extracted so the whole-window report and each cohort below are counted by the **same** code: a
   * cohort number that could disagree with the same number in the full report is how a measurement
   * stops being evidence.
   */
  function measure(rows: ItemRow[]) {
    const refusedBy = new Map<string, string[]>();
    const refusedAny = new Set<string>();
    let withLine = 0;
    let withArtifact = 0;
    let rawPrinted = 0;
    let refusedAndRepaired = 0;
    let refusedAndEmpty = 0;
    let emptyStored = 0;
    let emptyStoredRepaired = 0;
    let emptyStoredStillEmpty = 0;
    const refusedWithoutArtifact: ItemRow[] = [];
    const rawFallbacks: string[] = [];

    for (const item of rows) {
      const event = eventOf(item);
      const raw = (event?.what_happened ?? "").trim();
      const printed = deliveredLine(item, raw);
      const artifact = deliveredSummary(item.summary);
      // Two classes, and they are different questions: a stored line that is
      // **refused** (there is text and a boundary will not print it) and an item
      // with **no stored line at all**. The ruling reports their rates separately,
      // and the previous measurement of the withhold half (10 of 289 carrying a
      // line) counted only the first.
      const storedRefused = raw !== "" && deliveredSummary(raw) === null;
      const storedEmpty = raw === "";

      // The diagnostic half, unchanged: which predicate refuses the item's own stored line, with the
      // disposition this slice gave it. It is a count of *lines*, not of readers harmed -- the
      // artifact accounting below is what answers that.
      if (storedRefused) {
        for (const boundary of BOUNDARIES) {
          if (!boundary.refuses(raw)) continue;
          refusedAny.add(item.event_id);
          const lines = refusedBy.get(boundary.name) ?? [];
          if (lines.length < 8) {
            const disposition =
              printed === "" ? " [no line]" : artifact !== null ? " [repaired]" : " [raw printed]";
            lines.push(`${event?.title ?? "(no title)"} :: ${raw}${disposition}`);
          }
          refusedBy.set(boundary.name, lines);
        }
      }

      if (storedEmpty) {
        emptyStored += 1;
        if (artifact !== null) emptyStoredRepaired += 1;
        else emptyStoredStillEmpty += 1;
      }

      if (printed === "") {
        if (storedRefused) {
          refusedAndEmpty += 1;
          refusedWithoutArtifact.push(item);
        } else if (storedEmpty && artifact === null) {
          refusedWithoutArtifact.push(item);
        }
        continue;
      }
      withLine += 1;
      if (artifact !== null) withArtifact += 1;
      else rawPrinted += 1;
      if (storedRefused) {
        refusedAndRepaired += 1;
        // The must-be-zero line, computed independently of the resolver that should prevent it: the
        // printed text is the raw description AND a boundary refuses that text.
        if (printed === raw && BOUNDARIES.some((b) => b.refuses(printed))) {
          rawFallbacks.push(`${event?.title ?? "(no title)"} :: ${printed}`);
        }
      }
    }

    return {
      refusedBy,
      refusedAny,
      withLine,
      withArtifact,
      rawPrinted,
      refusedAndRepaired,
      refusedAndEmpty,
      emptyStored,
      emptyStoredRepaired,
      emptyStoredStillEmpty,
      refusedWithoutArtifact,
      rawFallbacks,
      noLine: rows.length - withLine,
      affectedDigests: new Set(
        rows
          .filter((item) => deliveredLine(item, eventOf(item)?.what_happened) === "")
          .map((d) => d.digest_id),
      ),
    };
  }

  const sent = items.filter((item) => delivered.has(item.digest_id));
  const byOlderDenominator = measure(items.filter((item) => anyDeliveryRow.has(item.digest_id)));
  const {
    refusedBy,
    refusedAny,
    withLine,
    withArtifact,
    rawPrinted,
    refusedAndRepaired,
    refusedAndEmpty,
    emptyStored,
    emptyStoredRepaired,
    emptyStoredStillEmpty,
    refusedWithoutArtifact,
    rawFallbacks,
    noLine,
    affectedDigests,
  } = measure(sent);

  console.log(`delivered surface, last ${DAYS} days (measured ${new Date().toISOString()})`);
  console.log(
    `briefings built ${digestIds.length}, delivered to a reader (>=1 channel sent) ${delivered.size}, items delivered ${sent.length}, items carrying a line ${withLine}`,
  );
  console.log(
    `  the earlier denominator, for comparison -- a delivery row exists (failed included): ${anyDeliveryRow.size} briefing(s), ${byOlderDenominator.withLine + byOlderDenominator.noLine} item(s), ${byOlderDenominator.refusedAny.size} refused, ${byOlderDenominator.noLine} with no line. The 20/297 baseline was recorded with this definition.`,
  );
  console.log(
    `  valid composed artifact delivered (0118): ${withArtifact} of ${sent.length} = ${pct(withArtifact, sent.length)}`,
  );
  console.log(`  the item's own stored line: ${rawPrinted} of ${sent.length}`);
  console.log(
    `stored lines a boundary refuses: ${refusedAny.size} of ${sent.length} item(s) = ${pct(refusedAny.size, sent.length)}`,
  );
  console.log(
    `  replaced by a valid composed line: ${refusedAndRepaired}  (the composed half of the ruling)`,
  );
  console.log(`  still delivered with no line: ${refusedAndEmpty}`);
  console.log(
    `items with no stored line at all: ${emptyStored} of ${sent.length} = ${pct(emptyStored, sent.length)}`,
  );
  console.log(
    `  delivered with a composed line instead: ${emptyStoredRepaired}, still with none: ${emptyStoredStillEmpty}`,
  );
  console.log(
    `raw fallbacks -- a refused stored line printed to a reader: ${rawFallbacks.length} <- must be zero`,
  );
  for (const line of rawFallbacks) console.log(`   ${line}`);
  console.log(
    `items delivered with no line at all: ${noLine} of ${sent.length} = ${pct(noLine, sent.length)}`,
  );
  console.log(
    `briefings carrying at least one item with no line: ${affectedDigests.size} of ${delivered.size} = ${pct(affectedDigests.size, delivered.size)}`,
  );
  console.log(
    `  (the comparison denominator for that rate: ${byOlderDenominator.affectedDigests.size} of ${anyDeliveryRow.size})`,
  );
  for (const [name, lines] of refusedBy) {
    const repaired = lines.filter((line) => line.endsWith("[repaired]")).length;
    console.log(
      `\n-- ${name} --${repaired > 0 ? ` (${repaired} of the shown lines repaired)` : ""}`,
    );
    for (const line of lines) console.log(`   ${line}`);
  }

  // The cohort split the ruling requires (2026-10-15): the historical rows are the pre-change
  // baseline and must stay identifiable, and a post-deploy number must be a number about rows the
  // new code actually built. `generated_at` is when the digest was built; without `--deploy-at` the
  // section says it is not split rather than printing something that reads as post-deploy evidence.
  console.log("\ncohorts");
  if (!DEPLOY_AT) {
    console.log(
      "  not split -- pass --deploy-at <iso> with the deploy's commit time: the historical rows are the" +
        " pre-change baseline and a combined number is not post-deploy evidence",
    );
  } else {
    const builtAt = new Map((digests ?? []).map((d) => [d.digest_id, d.generated_at] as const));
    const rowsIn = (postDeploy: boolean): ItemRow[] =>
      sent.filter((item) => {
        const at = builtAt.get(item.digest_id) ?? null;
        const built = at === null ? null : Date.parse(at);
        const after = built !== null && built >= Date.parse(DEPLOY_AT);
        return postDeploy ? after : !after;
      });
    console.log(`  split at ${DEPLOY_AT} -- both cohorts counted by the same measure()`);
    for (const [label, postDeploy] of [
      ["historical (built before)", false],
      ["post-deploy (built at/after)", true],
    ] as const) {
      const rows = rowsIn(postDeploy);
      const m = measure(rows);
      console.log(
        `   ${label}: digests reaching a reader ${new Set(rows.map((r) => r.digest_id)).size}, items ${rows.length}, carrying a line ${m.withLine}, composed artifacts ${m.withArtifact}, stored lines refused ${m.refusedAny.size} (repaired ${m.refusedAndRepaired}), delivered with no line ${m.noLine}, raw fallbacks ${m.rawFallbacks.length}`,
      );
    }
  }

  // The untyped client the rest of this file reads through; the typed view is for the alert section
  // only, where the joined shapes are checked rather than assumed.
  await alertSurface(db as unknown as SupabaseClient<Database>, since);

  if (!RECOMPUTE) return;
  if (refusedWithoutArtifact.length === 0) {
    console.log(
      "\nrecompute: no delivered item is missing a line with no artifact -- nothing to compose.",
    );
    return;
  }

  // What the build would store for the rows that predate the artifact. The inputs are the ones
  // `loadBriefs` hands the gate and the composer: the headline, the coverage as `ReaderSource`
  // (name, headline, excerpt), the occurrence clock, and the stored line. Composed through the same
  // function the build calls, so this is the build's answer, not a second implementation of it.
  const eventIds = [...new Set(refusedWithoutArtifact.flatMap((item) => [item.event_id]))];
  const { data: coverage, error: coverageError } = await db
    .from("articles")
    .select("event_id, source_id, title, excerpt, sources ( name, kind )")
    .in("event_id", eventIds);
  if (coverageError) throw new Error(`reading coverage: ${coverageError.message}`);
  const sources = new Map<string, ReaderSource[]>();
  const outlets = new Map<string, Set<string>>();
  const kinds = new Map<string, Set<string>>();
  for (const row of coverage ?? []) {
    if (!row.event_id) continue;
    const list = sources.get(row.event_id) ?? [];
    list.push({
      name: (row.sources as { name?: string } | null)?.name ?? "Unattributed",
      ...(row.title ? { headline: row.title } : {}),
      ...(row.excerpt ? { excerpt: row.excerpt } : {}),
    });
    sources.set(row.event_id, list);
    outlets.set(row.event_id, (outlets.get(row.event_id) ?? new Set()).add(row.source_id ?? "?"));
    const kind = (row.sources as { kind?: string } | null)?.kind;
    if (kind) kinds.set(row.event_id, (kinds.get(row.event_id) ?? new Set()).add(kind));
  }

  // Two populations, and the difference matters for what this section may claim. An item the
  // readiness gate refuses today would not ship at all, so the build stores no artifact for it and
  // composing one here would report a line the product would never carry. Only the second group is
  // where the composed half acts.
  const rebuilt: string[] = [];
  const stillEmpty: string[] = [];
  const notShippedToday: string[] = [];
  for (const item of refusedWithoutArtifact) {
    const event = eventOf(item);
    const title = event?.title ?? "";
    const raw = (event?.what_happened ?? "").trim();
    const publishedAt = event?.material_occurrence_at ?? event?.first_seen_at ?? null;
    const storySources = sources.get(item.event_id) ?? [];
    const verdict = assessReadiness({
      title,
      whatHappened: raw,
      sourceCount: outlets.get(item.event_id)?.size ?? 0,
      sourceKinds: [...(kinds.get(item.event_id) ?? [])],
      sources: storySources,
      publishedAt,
    });
    const cls = raw === "" ? "no stored line" : "refused";
    if (!verdict.ready) {
      notShippedToday.push(`${title || "(no title)"} [${verdict.kind}, ${cls}]`);
      continue;
    }
    const composed = composedSummaryArtifact({
      title,
      sources: storySources,
      publishedAt,
      whatHappened: raw,
    });
    if (composed === null) stillEmpty.push(`${title || "(no title)"} [${cls}]`);
    else rebuilt.push(`${title || "(no title)"} [${cls}]\n     -> ${composed}`);
  }
  const acted = rebuilt.length + stillEmpty.length;
  console.log(
    `\nrecompute over the ${refusedWithoutArtifact.length} delivered item(s) with no line and no artifact -- not the delivered surface: what the build would store for these rows today`,
  );
  console.log(
    `  the readiness gate would not ship it at all today (so no artifact would be stored): ${notShippedToday.length}`,
  );
  for (const line of notShippedToday) console.log(`   ${line}`);
  console.log(`  still shippable by today's gate: ${acted}`);
  console.log(`    would deliver a valid composed line: ${rebuilt.length}`);
  for (const line of rebuilt) console.log(`   ${line}`);
  console.log(`    would still deliver no line: ${stillEmpty.length}`);
  for (const line of stillEmpty) console.log(`   ${line}`);
}

await main();
