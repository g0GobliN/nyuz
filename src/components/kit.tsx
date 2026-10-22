import { Link } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The product's focus ring, in one place.
 *
 * The kit's buttons have always drawn this ring; the navigation did not, so a
 * keyboard reader tabbing through the chrome got `outline: auto 1px` from the
 * browser on every nav link while every button lit up in the product's blue.
 * That is two control languages for one product, and a 1px default outline is
 * easy to lose against hairlines and tints.
 *
 * Exported rather than pasted into each call site so the ring cannot drift, and
 * so a change here reaches all of them at once. `focus-visible:` throughout —
 * a mouse click must not draw it. No new token: `--ring` is already the signal
 * hue in both themes, and the 2px offset stays `--background`.
 */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  variant?: "primary" | "ghost" | "outline" | "signal";
  size?: "sm" | "md" | "lg";
}) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function buttonClass(
  variant: "primary" | "ghost" | "outline" | "signal" = "primary",
  size: "sm" | "md" | "lg" = "md",
) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-300 select-none",
    focusRing,
    "disabled:opacity-40 disabled:pointer-events-none",
    size === "sm" && "h-9 px-4 text-[13px]",
    size === "md" && "h-11 px-6 text-sm",
    size === "lg" && "h-13 px-8 text-[15px]",
    variant === "primary" &&
      "bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.985] shadow-[var(--shadow-soft)]",
    variant === "signal" &&
      "bg-signal text-signal-foreground hover:opacity-90 active:scale-[0.985] shadow-[var(--shadow-soft)]",
    variant === "outline" && "border border-border bg-transparent hover:bg-muted",
    variant === "ghost" && "text-muted-foreground hover:text-foreground hover:bg-muted",
  );
}

export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: {
  to: string;
  variant?: "primary" | "ghost" | "outline" | "signal";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "to" | "children" | "className">) {
  return (
    <Link to={to} className={cn(buttonClass(variant, size), className)} {...rest}>
      {children}
    </Link>
  );
}

export function Chip({
  active,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      className={cn(
        // `items-center` and a gap, because a chip is the one control in the kit
        // that carries a 12px icon beside 13px text. A flex item is stretched by
        // default, and a box with a definite height (`h-3 w-3`) resolves that to
        // flex-start — so the glyph sat 3.75px above the middle of its own label
        // and made the whole chip look lifted, which is exactly how it was
        // reported. `gap-1` is the 4px the icons used to carry as `mr-1`, so
        // nothing but the vertical alignment moves. Measured in the browser, not
        // guessed: pill height 33.5px either way, icon centre 76.5 → 80.25.
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] transition-all duration-300 active:scale-95",
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border bg-surface text-muted-foreground hover:text-foreground hover:border-foreground/25",
        className,
      )}
      {...props}
    />
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-2xl border border-hairline bg-surface", className)} {...props} />
  );
}

export function Section({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("px-5 py-16 sm:px-8 sm:py-24 md:py-32", className)}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}
