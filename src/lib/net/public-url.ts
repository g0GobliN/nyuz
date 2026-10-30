/**
 * Whether a URL is safe to fetch from a Worker that holds the service-role key.
 *
 * http(s) only, and the host must not be loopback, link-local, RFC1918, CGNAT,
 * or IPv6 unique-local. A stolen admin session must not be able to point
 * ingestion at an internal address and read the response.
 */
const BLOCKED_NAME = /^(localhost|.*\.localhost|.*\.internal|.*\.local|.*\.lan)$/i;

export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || BLOCKED_NAME.test(host)) return false;
  if (isBlockedHost(host)) return false;
  return true;
}

function isBlockedHost(host: string): boolean {
  if (/^\d+$/.test(host)) return true;
  if (host.includes(":")) return isBlockedIpv6(host);

  const dotted = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (dotted) {
    const oct = dotted.slice(1).map(Number);
    if (oct.some((n) => n > 255)) return true;
    return isBlockedIpv4(oct as [number, number, number, number]);
  }

  if (/^127\./.test(host) || /^0\./.test(host)) return true;
  return false;
}

function isBlockedIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;

  // Mapped IPv4 in dotted notation: ::ffff:127.0.0.1
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(lower);
  if (mappedDotted?.[1]) return isBlockedHost(mappedDotted[1]);

  // Mapped IPv4 in hex notation: ::ffff:7f00:1 (WHATWG normalizes dotted to hex)
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(lower);
  if (mappedHex) {
    const high = parseInt(mappedHex[1]!, 16);
    const low = parseInt(mappedHex[2]!, 16);
    const octets: [number, number, number, number] = [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ];
    return isBlockedIpv4(octets);
  }

  return false;
}
