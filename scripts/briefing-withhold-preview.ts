/**
 * What would the briefing deliver today if a story no rule can explain were withheld?
 *
 *   npm run briefing:withhold-preview              the newest delivered briefing's items
 *   npm run briefing:withhold-preview -- --digest ID
 *
 * This is a measurement, not a rule. Ruling #12 said not to withhold publishable stories for a missing
 * significance line until the arbiter says so, and nothing here changes what a build ships: it reads
 * the newest delivered briefing's own items and asks the ladder (`inclusion.ts`, the same function the
 * read path calls) what line each would carry. Then it says how many items survive such a rule and
 * prints each survivor's line — the number the open ruling turns on, rather than a promise about it.
 *
 * The count is the whole point. `briefing:checkpoint` already says the ladder is silent on this
 * briefing (`ladder now: none 13`); this says what that silence would *mean* — an explanation per item,
 * or nothing — and why each silent item is silent, so the next ruling is asked with the cause in hand.
 *
 * Reads only. Service-role client, Node 22 or later.
 */

import { reasonFor } from "@/lib/pipeline/inclusion";
import { db, heading, main, row as rowLine, say } from "./lib/db";
import { loadCorpusEvents, type CorpusEvent } from "./lib/corpus";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const DIGEST = flag("--digest") ?? null;

type States = { before: string | null; after: string | null };

/**
 * The missing input a silent item is silent for, in the ladder's own order.
 *
 * Printed instead of a line, because "no line" alone reads like a rung to fix; the item below did not
 * miss a rule, it missed an input, and those are different repairs.
 */
function cause(event: CorpusEvent, states: States, hasImpact: boolean): string {
  const missing: string[] = [];
  if (!hasImpact) missing.push("no stored impact");
  if ((states.before ?? "").trim() === "" || (states.after ?? "").trim() === "")
    missing.push("no before/after state");
  const evidence = event.sourceList.flatMap(
    (source) => source.enrichedEvidence?.map((unit) => unit.text) ?? [],
  );
  if (evidence.length === 0) missing.push("no stored evidence for the binding rung");
  if (event.sources < 2) missing.push("one publisher");
  return missing.join(", ");
}

main(async () => {
  const client = db();
  const { data: digests, error } = DIGEST
    ? await client
        .from("digests")
        .select("digest_id, generated_at, scheduled_for, kind")
        .eq("digest_id", DIGEST)
        .limit(1)
    : await client
        .from("digests")
        .select("digest_id, generated_at, scheduled_for, kind")
        .not("generated_at", "is", null)
        .eq("kind", "briefing")
        .order("scheduled_for", { ascending: false })
        .limit(1);
  if (error) throw new Error(`digests: ${error.message}`);
  const digest = (digests ?? [])[0];
  if (!digest) {
    say("no generated briefing to preview");
    process.exitCode = 1;
    return;
  }

  const { data: items, error: itemError } = await client
    .from("digest_items")
    .select("event_id, position")
    .eq("digest_id", digest.digest_id)
    .order("position", { ascending: true });
  if (itemError) throw new Error(`digest_items: ${itemError.message}`);
  const rows = items ?? [];
  if (rows.length === 0) {
    say(`briefing ${digest.digest_id} delivered no items`);
    return;
  }

  const events = await loadCorpusEvents(
    rows.length,
    undefined,
    undefined,
    rows.map((row) => row.event_id),
  );
  const byId = new Map(events.map((event) => [event.id, event] as const));

  const { data: impacts, error: impactError } = await client
    .from("event_impacts")
    .select("event_id, text")
    .in(
      "event_id",
      rows.map((row) => row.event_id),
    )
    .eq("status", "complete");
  if (impactError) throw new Error(`event_impacts: ${impactError.message}`);
  const impactOf = new Map((impacts ?? []).map((row) => [row.event_id, row.text ?? null] as const));

  // The two state columns are read here rather than from the corpus loader, which carries neither:
  // they are the rungs' own inputs and the cause line has to name them exactly.
  const { data: stateRows, error: stateError } = await client
    .from("events")
    .select("id, before_state, after_state")
    .in(
      "id",
      rows.map((row) => row.event_id),
    );
  if (stateError) throw new Error(`events: ${stateError.message}`);
  const statesOf = new Map(
    (stateRows ?? []).map(
      (row) =>
        [row.id, { before: row.before_state ?? null, after: row.after_state ?? null }] as const,
    ),
  );

  heading(`The ladder's answer, per item — briefing ${digest.digest_id} (${digest.scheduled_for})`);

  const explained: { position: number; title: string; line: string; rung: string }[] = [];
  const silent: { position: number; title: string; cause: string }[] = [];
  for (const item of rows) {
    const event = byId.get(item.event_id);
    if (!event) continue;
    const impact = impactOf.get(event.id) ?? null;
    const evidence = event.sourceList.flatMap(
      (source) => source.enrichedEvidence?.map((unit) => unit.text) ?? [],
    );
    const states = statesOf.get(event.id) ?? { before: null, after: null };
    const reason = reasonFor({
      storedImpact: impact,
      beforeState: states.before,
      afterState: states.after,
      sourceCount: event.sources,
      evidence,
      title: event.title,
      whatHappened: event.what,
    });
    if (reason.text.trim() === "") {
      silent.push({
        position: item.position,
        title: event.title,
        cause: cause(event, states, impact !== null && impact.trim() !== ""),
      });
      continue;
    }
    explained.push({
      position: item.position,
      title: event.title,
      line: reason.text,
      rung: reason.source,
    });
  }

  say();
  for (const entry of explained) {
    say(`  KEEP     #${entry.position}  ${entry.title.slice(0, 62)}`);
    say(`           [${entry.rung}] ${entry.line}`);
  }
  for (const entry of silent) {
    say(`  WITHHELD #${entry.position}  ${entry.title.slice(0, 62)}`);
    say(`           ${entry.cause}`);
  }

  say();
  say(rowLine("items in the briefing as delivered", rows.length));
  say(rowLine("  explained -> would be delivered", explained.length));
  say(rowLine("  silent    -> would be withheld", silent.length));
  // The one number the open ruling turns on. Not an exit status: this is a preview of a rule that has
  // not been ruled on, so a red exit would read as a defect in the shipped product.
  say(
    `briefing under the withhold rule: ${explained.length} of ${rows.length} items would reach a reader`,
  );
  if (explained.length === 0)
    say(
      "  — under that rule this briefing would be empty, which is why it cannot ship before a ruling",
    );
});
