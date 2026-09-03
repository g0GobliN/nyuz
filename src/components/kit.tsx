import { Link } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

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
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
        "rounded-full border px-3.5 py-1.5 text-[13px] transition-all duration-300 active:scale-95",
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
