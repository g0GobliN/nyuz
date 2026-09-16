import { afterEach, describe, expect, it, vi } from "vitest";
import { isTestRuntime, providerFetch, realProviderFetch } from "./transport";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("paid network isolation", () => {
  it("rejects real provider transport before fetch in test", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    await expect(realProviderFetch("https://api.deepseek.com/chat/completions")).rejects.toThrow(
      "forbidden",
    );
    expect(network).not.toHaveBeenCalled();
  });
  it("CI cannot be bypassed with worker bindings or production NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "true");
    vi.stubGlobal("__env__", {});
    expect(isTestRuntime()).toBe(true);
    await expect(realProviderFetch("https://api.openai.com/v1/chat/completions")).rejects.toThrow(
      "forbidden",
    );
  });
  it("requires fake transport and never uses the original network", async () => {
    expect(() => providerFetch("https://api.deepseek.com")).toThrow("fake transport");
    const fake = vi.fn(async () => new Response("fixture"));
    vi.stubGlobal("fetch", fake);
    expect(await (await providerFetch("https://api.deepseek.com")).text()).toBe("fixture");
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it("a spy calling through to fetch still cannot reach the network", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      await expect(providerFetch("https://api.deepseek.com")).rejects.toThrow("Real network");
    } finally {
      spy.mockRestore();
    }
  });
});
