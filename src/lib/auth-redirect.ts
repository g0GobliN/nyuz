/**
 * Accepts only same-origin application paths for post-authentication routing.
 * A leading `//` or backslash can make a browser interpret an apparent path as
 * another host, so both are refused before URL parsing.
 */
export function safeAuthDestination(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  if (value.includes("\\")) return fallback;

  try {
    const base = new URL("https://nyuz.invalid");
    const destination = new URL(value, base);
    if (destination.origin !== base.origin || destination.pathname === "/auth") return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}

export function authEntryUrl(destination: unknown): string {
  const safe = safeAuthDestination(destination, "");
  if (!safe) return "/auth";
  return `/auth?${new URLSearchParams({ next: safe }).toString()}`;
}
