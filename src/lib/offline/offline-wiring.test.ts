import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The four queries the archive depends on, held to the wiring that makes it work.
 *
 * These read source text, in the same spirit as
 * `src/lib/security-invariants.test.ts` and for the same reason: every one of the
 * mistakes below is invisible at runtime until a reader is on a train.
 *
 * - A query left in React Query's default `networkMode: "online"` never calls its
 *   `queryFn` while offline. It does not throw, the fallback never runs, and the
 *   screen shows a spinner forever. Nothing in a type or a unit test of the
 *   fallback would catch that — the fallback is correct and simply unreachable.
 * - A list written without slimming quietly turns the archive into a full copy of
 *   every briefing the reader opens.
 * - An archive that is not cleared on sign-out hands one reader's stories to the
 *   next person who signs in on the same device.
 */

const read = (path: string) => readFileSync(path, "utf8");

/** Where the four archived queries live, and how many each file should hold. */
const ARCHIVED_QUERIES: Array<[string, number]> = [
  ["src/routes/dashboard/index.tsx", 1],
  ["src/routes/dashboard/briefing.tsx", 2],
  ["src/routes/dashboard/story/$id.tsx", 1],
];

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/**
 * Source with its comments removed.
 *
 * Needed because these modules *talk* about the thing they must not do: the
 * archive's own header explains why localStorage is the wrong tool, and an
 * assertion that reads prose would fail on the explanation rather than on a
 * regression.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("every archived query runs while offline", () => {
  it.each(ARCHIVED_QUERIES)("%s declares offlineFirst", (path, expected) => {
    const source = read(path);
    expect(count(source, 'networkMode: "offlineFirst"')).toBe(expected);
  });

  it.each(ARCHIVED_QUERIES)("%s goes through the fallback", (path, expected) => {
    expect(count(read(path), "withOfflineFallback(")).toBe(expected);
  });

  it("matches the keys the archive whitelists", () => {
    // The query keys passed to the fallback have to be the keys keys.ts knows,
    // or the fallback looks up a list nothing ever wrote.
    const archive = read("src/lib/offline/keys.ts");
    for (const key of ["home", "saved", "today"]) {
      expect(archive).toContain(`"${key}"`);
    }
    const index = read("src/routes/dashboard/index.tsx");
    expect(index).toContain('["briefing", "home"]');
    expect(read("src/routes/dashboard/briefing.tsx")).toContain('["briefing", "saved"]');
    expect(read("src/routes/dashboard/story/$id.tsx")).toContain('["briefing", "story", id]');
  });
});

describe("what gets written to the disk", () => {
  it("slims every list before storing it", () => {
    const persist = read("src/lib/offline/persist.ts");
    // The archive stores whatever it is handed, so the slimming has to happen at
    // the only call that hands it a list payload.
    const saveLine = persist.split("\n").find((line) => line.includes("saveList(")) ?? "";
    expect(saveLine).toContain("slimListPayload");
  });

  it("writes only through the account-keyed accessors", () => {
    const persist = read("src/lib/offline/persist.ts");
    expect(persist).toContain("saveList(userId");
    expect(persist).toContain("saveStory(userId");
  });

  it("does not touch localStorage", () => {
    // The two things the archive must not be: a shared store with no account in
    // the key, and a synchronous 5MB one.
    for (const path of [
      "src/lib/offline/archive.ts",
      "src/lib/offline/persist.ts",
      "src/lib/offline/fallback.ts",
    ]) {
      const code = withoutComments(read(path));
      expect(code).not.toContain("localStorage");
      expect(code).not.toContain("sessionStorage");
    }
  });
});

describe("nothing survives a change of reader", () => {
  it("clears the previous account and installs for the current one", () => {
    const root = read("src/routes/__root.tsx");
    expect(root).toContain("clearAccount(before)");
    expect(root).toContain("installOfflineArchive(queryClient, userId)");
    // Guarded on a session: no account, no archive.
    expect(root).toMatch(/if \(!userId\) \{\s*setArchiveAccount\(null\)/);
  });

  it("is installed from an effect, so no server render can write", () => {
    const root = read("src/routes/__root.tsx");
    const component = root.slice(root.indexOf("function OfflineArchive()"));
    expect(component.indexOf("useEffect(")).toBeGreaterThan(-1);
  });
});
