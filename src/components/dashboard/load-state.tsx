import type { ReactNode } from "react";
import { EmptyState } from "@/components/dashboard/shell";
import { Button } from "@/components/kit";
import { humanError } from "@/lib/errors";
import { loadPhase, type LoadQuery } from "@/lib/load-state";

/**
 * The panel a request-backed section draws, in whichever state it is in.
 *
 * A screen hands over its slots and stops deciding anything. `loadPhase` orders
 * the five states once, for every screen (`src/lib/load-state.ts` explains the
 * order and why it is that order), and this renders exactly one of the slots —
 * so there is no chain of ternaries left in a route for a reader to end up
 * under the wrong branch of.
 *
 * `empty` receives the data. That is the point of the prop's shape: the copy
 * inside it is the answer to a question that was asked, and it cannot be
 * written from a request that has not answered, because there is nothing to
 * write it from.
 *
 * `failed` is a headline and nothing else. The reason (`humanError`) and the
 * retry are drawn here, identically on every screen, because those two have one
 * correct form and seven copies of it drifted into seven failures that a reader
 * could not tell apart or act on.
 *
 * `given` is for a state that outranks the failure — see `loadPhase`. It is
 * drawn above the failure, so the reader's own facts are never hidden behind a
 * connection problem; only sentences that are true without an answer belong
 * there.
 */
export function LoadState<T>({
  query,
  hasContent,
  content,
  loading,
  given,
  failed,
  empty,
  className,
}: {
  /** The request behind this panel. */
  query: LoadQuery<T>;
  /** Whether `content` has anything worth showing. */
  hasContent: boolean;
  /** The panel itself. Rendered only when `hasContent`. */
  content: ReactNode;
  /** The first wait. Every panel waits in its own words, so it is passed in. */
  loading: ReactNode;
  /** A fact about the reader that outranks a failure. */
  given?: ReactNode;
  /** The failure's headline. The reason and the retry are supplied here. */
  failed: string;
  /**
   * The answer with nothing in it. Omitted where a successful read with nothing
   * in it draws nothing at all — the section's own copy lives outside this
   * panel in that case.
   */
  empty?: (data: T) => ReactNode;
  className?: string;
}) {
  const data = query.data;
  const phase = loadPhase(query, {
    hasContent,
    hasGiven: given !== undefined && given !== null,
  });

  let node: ReactNode = null;
  if (phase === "content") {
    node = content;
  } else if (phase === "waiting") {
    node = loading;
  } else if (phase === "given") {
    node = given;
  } else if (phase === "failed") {
    node = <Failure query={query} title={failed} />;
  } else if (data !== undefined) {
    node = empty?.(data);
  }

  // A slot that draws nothing leaves nothing behind, not an empty box carrying
  // `className`'s margins into the page — a section whose own body is drawn
  // around this panel passes `content={null}` and must not gain a gap for it.
  if (node === null) return null;
  return className ? <div className={className}>{node}</div> : <>{node}</>;
}

/** The failure state, in one place: what happened, why, and the way out. */
function Failure({ query, title }: { query: LoadQuery<unknown>; title: string }) {
  return (
    <EmptyState
      title={title}
      body={humanError(query.error, "The request did not complete.")}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? "Trying…" : "Try again"}
        </Button>
      }
    />
  );
}
