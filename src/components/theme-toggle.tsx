import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY, applyTheme } from "@/lib/theme";

/**
 * Flips the theme and remembers the choice.
 *
 * The button no longer decides what the theme *is* — the script inlined in
 * <head> has already applied it before this component exists. This reads the
 * result off the document so the icon matches what the visitor is looking at.
 *
 * State starts at `true` because dark is the default: the server renders the
 * sun, and for everyone who has not chosen light the effect confirms it and
 * nothing moves.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next ? "dark" : "light");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Private modes can refuse to store. The theme still flips for this
      // page view; it just will not survive a reload, which beats throwing
      // inside a click handler.
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label="Toggle colour theme"
      className={
        "inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground " +
        (className ?? "")
      }
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
