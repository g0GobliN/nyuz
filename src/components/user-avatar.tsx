import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAvatarUrl, useDisplayName } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * The reader's own face, when the account came from a provider that has one.
 *
 * Sits where the initial used to: the header account menu, and the Profile
 * panel in Settings. A picture is the one thing a person recognises as theirs
 * on a screen full of our type, and it answers "whose account is this" faster
 * than a letter does — which matters most in the menu that offers to sign out
 * of it.
 *
 * The initial is still the fallback rather than the exception, on purpose.
 * Someone who signed in by email has no picture and never will, the display
 * name can be empty, and a provider URL can expire or 404. Radix swaps to the
 * fallback wherever the image fails to load, so an address we cannot vouch for
 * costs a missing picture rather than a broken one — which is also why no host
 * is allowlisted above.
 *
 * `name` is the caller's preferred display name, exactly as `useDisplayName`
 * takes it, so the letter here is the same one the rest of the app greets you
 * with. An initial from an invented name is worse than no avatar at all, so an
 * empty name falls back to the mark.
 */
export function UserAvatar({
  name,
  size = "sm",
  className,
}: {
  name?: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  const url = useAvatarUrl();
  const who = useDisplayName(name);
  const initial = who.trim().slice(0, 1).toUpperCase() || "·";

  return (
    <Avatar className={cn(size === "sm" ? "h-8 w-8" : "h-14 w-14", className)}>
      {url ? (
        // No referrer: the provider's CDN does not need to know which page the
        // request came from, and withholding it keeps our URL out of their logs.
        <AvatarImage src={url} alt="" referrerPolicy="no-referrer" />
      ) : null}
      <AvatarFallback
        className={cn(
          "font-medium",
          size === "sm"
            ? "bg-foreground text-[12px] text-background"
            : "bg-muted text-[19px] text-foreground",
        )}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}
