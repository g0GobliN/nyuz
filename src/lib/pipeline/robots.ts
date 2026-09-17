import { isPublicHttpUrl } from "@/lib/net/public-url";

/**
 * Whether a source's domain permits fetching an article page for enrichment.
 *
 * Checked once per domain and cached on `sources.enrichment_allowed` (0090),
 * never once per article -- a source publishes hundreds of articles and the
 * answer does not change per article. `robots_checked_at` is only stamped on
 * a *definitive* answer (a parsed 200, or a 404/410 treated as unrestricted
 * per the standard convention); an ambiguous fetch failure leaves it null so
 * the next enrichment run tries again rather than caching a false no forever.
 */

const AGENT_TOKEN = "nyuz";
const ROBOTS_USER_AGENT = "nyuz/1.0 (+https://nyuz.app/legal/contact; automated evidence reader)";
const ROBOTS_TIMEOUT_MS = 5_000;
const MAX_ROBOTS_BYTES = 100 * 1024;
/** Two hops -- see `enrich.ts`'s worst-case subrequest accounting, which this constant is part of. */
const MAX_REDIRECTS = 2;

export type RobotsDecision = "allowed" | "blocked" | "unknown";

/** One `User-agent:` group's rules, in file order (order matters for prefix ties). */
type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };

function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (field === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      current ??= (() => {
        const g: Group = { agents: ["*"], rules: [] };
        groups.push(g);
        return g;
      })();
      current.rules.push({ allow: field === "allow", path: value });
    }
  }
  return groups;
}

function groupFor(groups: Group[], token: string): Group | null {
  const named = groups.find((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  if (named) return named;
  return groups.find((g) => g.agents.includes("*")) ?? null;
}

/** Longest matching prefix wins; an `Allow` beats a `Disallow` of equal length. */
function isBlocked(group: Group | null, path: string): boolean {
  if (!group) return false;
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of group.rules) {
    if (rule.path === "") continue; // an empty Disallow means "disallow nothing"
    if (!path.startsWith(rule.path)) continue;
    if (
      !best ||
      rule.path.length > best.length ||
      (rule.path.length === best.length && rule.allow)
    ) {
      best = { allow: rule.allow, length: rule.path.length };
    }
  }
  return best ? !best.allow : false;
}

async function fetchRobotsText(origin: string): Promise<{ status: number; text: string } | null> {
  let current: string;
  try {
    current = new URL("/robots.txt", origin).href;
  } catch {
    return null;
  }
  for (let hop = 0; ; hop++) {
    if (!isPublicHttpUrl(current)) return null;
    let response: Response;
    try {
      response = await fetch(current, {
        headers: { "user-agent": ROBOTS_USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop >= MAX_REDIRECTS) return { status: response.status, text: "" };
      try {
        current = new URL(location, current).href;
      } catch {
        return { status: response.status, text: "" };
      }
      continue;
    }
    if (!response.ok) return { status: response.status, text: "" };
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_ROBOTS_BYTES) return null;
    let text: string;
    try {
      text = await response.text();
    } catch {
      return null;
    }
    if (text.length > MAX_ROBOTS_BYTES) return null;
    return { status: response.status, text };
  }
}

/**
 * The permission decision for one article path, plus whether the answer is
 * definitive enough to cache. `path` is the pathname (and query, if any) of
 * the specific article URL being considered for enrichment.
 */
export async function checkRobotsPermission(
  origin: string,
  path: string,
): Promise<{ decision: RobotsDecision; definitive: boolean }> {
  const fetched = await fetchRobotsText(origin);
  if (!fetched) return { decision: "unknown", definitive: false };
  if (fetched.status === 404 || fetched.status === 410)
    return { decision: "allowed", definitive: true };
  if (fetched.status !== 200) return { decision: "unknown", definitive: false };

  const groups = parseRobots(fetched.text);
  const group = groupFor(groups, AGENT_TOKEN);
  return { decision: isBlocked(group, path) ? "blocked" : "allowed", definitive: true };
}
