/**
 * Where the sign-in provider keeps this person's picture, or null.
 *
 * Google and GitHub both return one with the profile, and Supabase normalises
 * it to `avatar_url` on the user metadata. `picture` is the same value under the
 * name Google itself uses, so both are read rather than betting on one — the
 * order only matters if a provider ever sends two disagreeing values, and then
 * the normalised field is the one to trust.
 *
 * https only. The value arrives from an identity provider rather than from us
 * and ends up in an `img` src, so anything else — a `data:` payload dressed up
 * as somebody's face, a plain-http address that would be blocked as mixed
 * content, a `javascript:` string — is refused here, before it can reach an
 * attribute. Deliberately not a list of approved hosts: a provider we add later
 * should not need this function changed, and an address that is wrong in some
 * other way is caught by the avatar's own fallback rather than by a rule here.
 */
export function avatarUrlFrom(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return null;

  const meta = metadata as { avatar_url?: unknown; picture?: unknown };
  for (const value of [meta.avatar_url, meta.picture]) {
    if (typeof value === "string" && value.startsWith("https://")) return value;
  }
  return null;
}
