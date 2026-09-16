import { vi } from "vitest";

globalThis.fetch = async () => {
  throw new Error("Real network fetch is forbidden in tests");
};

// Only explicit fetch mocks can receive provider traffic; never delegate to the network.
(globalThis as unknown as Record<symbol, typeof fetch>)[
  Symbol.for("nyuz.fake-provider-transport")
] = (input, init) => {
  if (!vi.isMockFunction(globalThis.fetch))
    throw new Error("Provider request has no fake transport");
  return globalThis.fetch(input, init);
};
process.env["DEEPSEEK_API_KEY"] = "test-only";
process.env["OPENAI_API_KEY"] = "test-only";
