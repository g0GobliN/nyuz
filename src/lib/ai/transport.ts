import { ambientEnv } from "@/lib/runtime-env";

export function isTestRuntime(): boolean {
  const env = ambientEnv();
  return (
    env["NODE_ENV"] === "test" ||
    env["CI"] === "true" ||
    globalThis.process?.env["NODE_ENV"] === "test" ||
    globalThis.process?.env["CI"] === "true"
  );
}

const testTransport = Symbol.for("nyuz.fake-provider-transport");

export async function realProviderFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (isTestRuntime()) throw new Error("Live AI transport is forbidden in tests and CI");
  return fetch(input, init);
}

export function providerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isTestRuntime()) {
    const fake = (globalThis as unknown as Record<symbol, typeof fetch | undefined>)[testTransport];
    if (!fake) throw new Error("A fake provider transport is required");
    return fake(input, init);
  }
  return realProviderFetch(input, init);
}
