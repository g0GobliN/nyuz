import { afterEach, describe, expect, it } from "vitest";
import { ambientEnv, envValue, type EnvBag } from "@/lib/runtime-env";

/**
 * These pin the fix for a production-only outage: on Cloudflare the Worker
 * bindings arrive as `globalThis.__env__`, not `process.env`, so every server
 * function that read `process.env` resolved to nothing and threw. It passed
 * locally because the dev server is Node, where `process.env` is real — which
 * is exactly the shape of bug a test has to hold down, because no amount of
 * running it on a laptop will show it.
 */

type Globals = typeof globalThis & { __env__?: EnvBag };

function setWorkerEnv(bag: EnvBag | undefined): void {
  if (bag === undefined) delete (globalThis as Globals).__env__;
  else (globalThis as Globals).__env__ = bag;
}

afterEach(() => {
  setWorkerEnv(undefined);
  delete process.env["NYUZ_TEST_ONLY"];
});

describe("ambientEnv", () => {
  it("prefers Worker bindings over process.env", () => {
    process.env["NYUZ_TEST_ONLY"] = "from-node";
    setWorkerEnv({ NYUZ_TEST_ONLY: "from-worker" });
    expect(ambientEnv()["NYUZ_TEST_ONLY"]).toBe("from-worker");
  });

  it("falls back to process.env when there are no Worker bindings", () => {
    process.env["NYUZ_TEST_ONLY"] = "from-node";
    expect(ambientEnv()["NYUZ_TEST_ONLY"]).toBe("from-node");
  });

  it("returns a bag rather than throwing when neither source exists", () => {
    expect(() => ambientEnv()).not.toThrow();
  });
});

describe("envValue", () => {
  it("prefers an explicitly threaded env over both ambient sources", () => {
    process.env["NYUZ_TEST_ONLY"] = "from-node";
    setWorkerEnv({ NYUZ_TEST_ONLY: "from-worker" });
    expect(envValue("NYUZ_TEST_ONLY", { NYUZ_TEST_ONLY: "explicit" })).toBe("explicit");
  });

  it("reads Worker bindings for a caller that has no env to thread", () => {
    setWorkerEnv({ VITE_SUPABASE_URL: "https://project.supabase.co" });
    // The server-function case: nitro invokes the handler with no `env`
    // argument, so `undefined` here is not an oversight, it is the only thing
    // the caller has.
    expect(envValue("VITE_SUPABASE_URL")).toBe("https://project.supabase.co");
  });

  it("is undefined for a name nobody set", () => {
    expect(envValue("NYUZ_TEST_ONLY")).toBeUndefined();
  });
});
