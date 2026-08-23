import { useEffect, useRef } from "react";

/**
 * Adds `.in` to elements with class `reveal` inside the ref when scrolled into
 * view. Without `.in` those elements sit at `opacity: 0` — the class is what
 * makes them visible at all, not merely how they animate in.
 *
 * That is why this watches for nodes added after mount rather than taking the
 * one snapshot it used to. On the dashboard the story list comes from a store
 * that hydrates from localStorage in its own effect, so the first render has no
 * topics and therefore no cards. The snapshot ran against that empty list, and
 * every card that mounted a tick later was never observed: the page reported
 * "4 things worth knowing" above a column of four fully rendered, permanently
 * invisible cards.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const collect = (scope: Element): HTMLElement[] => [
      ...(scope.classList.contains("reveal") ? [scope as HTMLElement] : []),
      ...Array.from(scope.querySelectorAll<HTMLElement>(".reveal")),
    ];

    // No IntersectionObserver means no way to know what is on screen. Showing
    // everything is the only safe answer — hiding it is not a degraded
    // animation, it is a blank page.
    if (typeof IntersectionObserver === "undefined") {
      collect(root).forEach((n) => n.classList.add("in"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );

    // Observing the same node twice is harmless but pointless, and a subtree
    // mutation re-reports ancestors that were already handled.
    const seen = new WeakSet<Element>();
    const observe = (scope: Element) => {
      for (const node of collect(scope)) {
        if (seen.has(node)) continue;
        seen.add(node);
        io.observe(node);
      }
    };

    observe(root);

    const mo =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((records) => {
            for (const record of records) {
              record.addedNodes.forEach((node) => {
                if (node.nodeType === 1) observe(node as Element);
              });
            }
          });
    mo?.observe(root, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo?.disconnect();
    };
  }, []);

  return ref;
}

/** True once mounted on the client. */
export function useInViewOnce<T extends HTMLElement = HTMLDivElement>(
  cb: () => void,
  deps: unknown[] = [],
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      cb();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          cb();
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
