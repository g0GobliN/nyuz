/**
 * Freezes the reader corpus, so every later run measures the same stories.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/reader-corpus-freeze.ts \
 *     --out /tmp/corpus.json [--limit 200]
 *
 * The live corpus is the newest N completed events, so it slides -- a run hours
 * apart shares no events with the last one, and a before/after diff between them
 * compares two populations instead of one change. `--corpus` on the audit, the
 * snapshot writer and the diff reads this file, and a worktree at another commit
 * reads the same one, which is what makes "the same 200 stories" true.
 *
 * SELECT only, service-role client, same as `db:status`. Node 22 or later.
 */

import { CORPUS_SIZE, freezeCorpus } from "./lib/corpus.ts";
import { main, say } from "./lib/db.ts";

main(async () => {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const out = flag("--out");
  if (!out) throw new Error("usage: --out <file.json> [--limit N]");
  const limit = Number(flag("--limit") ?? CORPUS_SIZE);
  const count = await freezeCorpus(out, limit);
  say(`${count} events frozen to ${out}`);
});
