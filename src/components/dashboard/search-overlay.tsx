import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { searchStories } from "@/lib/server/briefing";

/**
 * Search over the reader's own archive, as an overlay.
 *
 * Opened from the header in both chromes. It renders over whatever page is
 * behind it rather than navigating, because the question it answers ("where was
 * that story about X") is one the reader asks *while* reading something else,
 * and losing the page to ask it is the reason search felt like a detour.
 */
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const term = q.trim();
  const results = useQuery({
    queryKey: ["briefing", "shell-search", term],
    queryFn: () => searchStories({ data: { q: term } }),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });
  const hits = results.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-[12vh] backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-hairline bg-surface shadow-[var(--shadow-float)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Show me everything about OpenAI"
            className="h-14 w-full bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:text-[15px]"
          />
          <button
            onClick={onClose}
            aria-label="Close search"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {term.length >= 2 && hits.length === 0 && !results.isFetching ? (
            <p className="px-5 py-8 text-center text-[13.5px] text-muted-foreground">
              Nothing in your archive matches that yet.
            </p>
          ) : null}
          {hits.map((s) => (
            <Link
              key={s.id}
              to="/dashboard/story/$id"
              params={{ id: s.id }}
              onClick={onClose}
              className="block border-b border-hairline px-5 py-3.5 last:border-0 hover:bg-muted"
            >
              <p className="text-[11px] uppercase tracking-[0.14em] text-signal">{s.org}</p>
              <p className="mt-1 text-[14px] font-medium leading-snug">{s.title}</p>
            </Link>
          ))}
          {!term ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              Search your archive by company, topic or headline.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
