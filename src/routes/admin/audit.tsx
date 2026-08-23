import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ConsoleHeader,
  ErrorNote,
  Loading,
  Panel,
  formatDateTime,
  formatNumber,
  inputClass,
} from "@/components/admin/shell";
import { Button } from "@/components/kit";
import { listAudit, listAuditActions, type AuditRow } from "@/lib/server/settings";
import type { Json } from "@/lib/supabase/types";

export const Route = createFileRoute("/admin/audit")({ component: AuditPage });

const PAGE_SIZE = 50;

function AuditPage() {
  const [action, setAction] = useState("");
  const [email, setEmail] = useState("");
  const [debouncedEmail, setDebouncedEmail] = useState("");
  const [page, setPage] = useState(0);

  // Same 350ms as the user search, for the same reason: an email address typed in
  // full would otherwise fire one `ilike` per keystroke against a table designed
  // to grow forever and never be pruned.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedEmail(email);
      setPage(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [email]);

  const actions = useQuery({
    queryKey: ["admin", "auditActions"],
    queryFn: () => listAuditActions(),
    staleTime: 300_000,
  });

  const log = useQuery({
    queryKey: ["admin", "audit", action, debouncedEmail, page],
    queryFn: () =>
      listAudit({
        data: { action, actorEmail: debouncedEmail, page, pageSize: PAGE_SIZE },
      }),
    staleTime: 15_000,
  });

  const rows = log.data?.rows ?? [];
  const total = log.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const filtered = action !== "" || debouncedEmail !== "";

  return (
    <>
      <ConsoleHeader
        title="Audit log"
        sub="Every console write, in order, with the account that made it. Nothing here can be edited or deleted from the console — that is the whole point of it. A row is written after the change succeeds, so an attempt that failed validation leaves no trace."
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[200px] flex-1">
            <span className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Action
            </span>
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(0);
              }}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">Everything</option>
              {groupActions(actions.data ?? []).map(([domain, names]) => (
                <optgroup key={domain} label={domain}>
                  {names.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="block min-w-[200px] flex-1">
            <span className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Actor
            </span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email, or part of one"
              className={inputClass}
            />
          </label>

          {filtered ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAction("");
                setEmail("");
                setPage(0);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          The action list is built from the most recent 2,000 entries, so it shows the vocabulary in
          current use rather than everything ever recorded. An older action can still be filtered by
          typing nothing here and paging back.
        </p>

        <ErrorNote error={log.error} />
        <ErrorNote error={actions.error} />

        {log.isLoading ? (
          <Loading label="Reading the log" />
        ) : rows.length === 0 ? (
          <p className="py-10 text-[13.5px] text-muted-foreground">
            {filtered ? "Nothing matches those filters." : "Nothing has been recorded yet."}
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-[var(--hairline)]">
            {rows.map((row) => (
              <Entry key={row.id} row={row} />
            ))}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
          <p className="tabular-nums">
            Page {page + 1} of {lastPage + 1} · {formatNumber(total)}{" "}
            {total === 1 ? "entry" : "entries"}
            {filtered ? " matching" : ""}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Newer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= lastPage}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
            </Button>
          </div>
        </div>
      </Panel>
    </>
  );
}

/**
 * Groups `domain.verb` action names under their domain for the dropdown.
 *
 * The vocabulary is small but it is not short — a flat list of thirty entries
 * reads as noise, while `user → user.ban` is scannable. Names without a dot are
 * grouped under themselves rather than dropped.
 */
function groupActions(actions: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const action of actions) {
    const domain = action.split(".")[0] ?? action;
    const existing = groups.get(domain);
    if (existing) existing.push(action);
    else groups.set(domain, [action]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function Entry({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => metaSummary(row.meta), [row.meta]);
  const expandable = summary !== null;

  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <span className="w-[130px] shrink-0 tabular-nums text-[12px] text-muted-foreground">
          {formatDateTime(row.createdAt)}
        </span>

        <code className="font-mono text-[12.5px]">{row.action}</code>

        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
          {row.actorEmail || "unknown actor"}
        </span>

        {row.targetType ? (
          <span
            className="shrink-0 text-[12px] text-muted-foreground"
            title={row.targetId || undefined}
          >
            {row.targetType}
            {row.targetId ? ` · ${shortId(row.targetId)}` : ""}
          </span>
        ) : null}

        {expandable ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            details
          </button>
        ) : null}
      </div>

      {expandable && !open ? (
        <p className="mt-1 pl-[146px] text-[11.5px] text-muted-foreground">{summary}</p>
      ) : null}

      {open ? (
        <pre className="mt-2 overflow-x-auto rounded-xl border border-hairline bg-surface-2 px-4 py-3 font-mono text-[11.5px] leading-relaxed">
          {JSON.stringify(row.meta, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

/**
 * One-line gist of an entry's metadata, so the common case — two scalar keys like
 * `enabled: false · rollout: 25` — is readable without expanding anything. Nested
 * values collapse to an ellipsis and are left to the expanded JSON.
 *
 * Returns null when there is nothing to show, which is also what hides the
 * expander: an entry with no metadata should not offer a button that reveals
 * `{}`.
 */
function metaSummary(meta: Json): string | null {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return null;
  const entries = Object.entries(meta);
  if (entries.length === 0) return null;
  return entries
    .slice(0, 4)
    .map(
      ([key, value]) =>
        `${key}: ${value !== null && typeof value === "object" ? "…" : String(value)}`,
    )
    .join(" · ");
}

/** UUIDs are unreadable at full length; the full value stays in the title. */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
