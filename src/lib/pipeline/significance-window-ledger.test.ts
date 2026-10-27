import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Gate 2's ledger is written only when the run is asked to write it.
 *
 * `docs/decisions/significance-window-instrument.md:294` pins the ledger
 * committed beside the report to one snapshot, because the prose and the file
 * have to describe the same run: "the 18 November run regenerates it with the
 * verdict." `scripts/significance-window-audit.ts` wrote it unconditionally —
 * `writeLedger(out, ledger)` at the end of every run, no flag, no guard — so a
 * pre-close run (gate 2 is `PENDING` until 2026-11-18T06:46Z) replaced the
 * pinned snapshot with a `PENDING` one and left an unreviewed diff in exactly
 * the tree the 15:00 merge gate merges into.
 *
 * Measured 2026-10-26: `git status --porcelain` already read
 * ` M docs/audits/significance-window-12c-30d.json` before this session ran
 * anything, and the committed file's own `generatedAt` is
 * `2026-10-23T08:25:21.496Z` rather than the pinned `2026-10-20T08:42Z` — the
 * unguarded write has already overwritten the pinned snapshot once on `main`.
 *
 * The assertion is on the script's source rather than on a call, because the
 * write is only reachable with a live `source_exemptions` window row: there is
 * no hermetic way to execute the audit's tail. One unguarded call is what was
 * wrong, and a source read is what can hold it. The behaviour itself is
 * verified against the real script (`git status` after a pre-close run stays
 * clean) and recorded on the card.
 */

const SCRIPT = readFileSync(join(process.cwd(), "scripts", "significance-window-audit.ts"), "utf8");

describe("gate 2's ledger", () => {
  it("is written only when the run is asked to write it", () => {
    // The unguarded call this finding names, verbatim, as it stood.
    expect(SCRIPT).not.toMatch(/^\s*writeLedger\(out, ledger\);$/mu);
    expect(SCRIPT).toContain("if (write) writeLedger(out, ledger);");
    expect(SCRIPT).toContain("[--write]");
  });

  it("names the path, the counts and the flag when it does not write", () => {
    const line = SCRIPT.split("\n").find((source) => source.includes("not written"));
    expect(line).toBeDefined();
    expect(line).toContain("${out}");
    expect(line).toContain("${measurements.briefings}");
    expect(line).toContain("${measurements.items}");
    expect(line).toContain("--write");
  });
});
