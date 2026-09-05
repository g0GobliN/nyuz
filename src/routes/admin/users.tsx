import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Search, ShieldAlert, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  ConsoleHeader,
  ErrorNote,
  Field,
  Loading,
  Panel,
  Pill,
  formatDate,
  formatDateTime,
  formatNumber,
  inputClass,
  useConsoleMutation,
  useViewer,
} from "@/components/admin/shell";
import { Button, Chip } from "@/components/kit";
import {
  banUser,
  getUserDetail,
  listUsers,
  setUserPlan,
  setUserRole,
  unbanUser,
  type UserListRow,
} from "@/lib/server/users";
import type { AdminRole, PlanTier } from "@/lib/supabase/types";

export const Route = createFileRoute("/admin/users")({ component: UsersPage });

const PAGE_SIZE = 25;
const ROLES: AdminRole[] = ["user", "admin", "superadmin"];
const PLANS: PlanTier[] = ["uno", "plura", "omni"];

function UsersPage() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [role, setRole] = useState<AdminRole | "">("");
  const [plan, setPlan] = useState<PlanTier | "">("");
  const [bannedOnly, setBannedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  // 350ms after the last keystroke. Typing an email address would otherwise fire
  // one `ilike` per character against a table that only grows.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const filtersActive = role !== "" || plan !== "" || bannedOnly;

  const users = useQuery({
    queryKey: ["admin", "users", debounced, role, plan, bannedOnly, page],
    queryFn: () =>
      listUsers({
        data: {
          search: debounced,
          page,
          pageSize: PAGE_SIZE,
          bannedOnly,
          ...(role ? { role } : {}),
          ...(plan ? { plan } : {}),
        },
      }),
    staleTime: 15_000,
  });

  const rows = users.data?.rows ?? [];
  const total = users.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <>
      <ConsoleHeader
        title="Users"
        sub="Search by email or display name. Role, plan and ban filters apply to the page you are looking at, not to the whole table — they live on other tables and are stitched in after the search."
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Email or name"
              className={`${inputClass} mt-0 pl-10`}
              aria-label="Search users"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Chip active={role === ""} onClick={() => setRole("")}>
              All roles
            </Chip>
            {ROLES.map((r) => (
              <Chip key={r} active={role === r} onClick={() => setRole(r)}>
                {r}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Chip active={plan === ""} onClick={() => setPlan("")}>
              All plans
            </Chip>
            {PLANS.map((p) => (
              <Chip key={p} active={plan === p} onClick={() => setPlan(p)}>
                {p}
              </Chip>
            ))}
          </div>

          <Chip active={bannedOnly} onClick={() => setBannedOnly((v) => !v)}>
            Banned
          </Chip>
        </div>

        <ErrorNote error={users.error} />

        {users.isLoading ? (
          <Loading label="Loading users" />
        ) : rows.length === 0 ? (
          <p className="py-10 text-[13.5px] text-muted-foreground">
            {debounced || filtersActive ? "Nobody on this page matches." : "No accounts yet."}
          </p>
        ) : (
          <div className="-mx-6 mt-5 overflow-x-auto sm:-mx-7">
            <table className="w-full min-w-[720px] text-left text-[13.5px]">
              <thead>
                <tr className="border-y border-hairline text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <Th className="pl-6 sm:pl-7">Account</Th>
                  <Th>Role</Th>
                  <Th>Plan</Th>
                  <Th>Joined</Th>
                  <Th>Last seen</Th>
                  <Th className="pr-6 text-right sm:pr-7">State</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row.id)}
                    className="cursor-pointer border-b border-hairline transition-colors hover:bg-surface-2"
                  >
                    <td className="py-3 pl-6 pr-4 sm:pl-7">
                      <p className="font-medium">{row.displayName || "—"}</p>
                      <p className="text-[12px] text-muted-foreground">{row.email}</p>
                    </td>
                    <td className="py-3 pr-4">
                      {row.role === "user" ? (
                        <span className="text-muted-foreground">user</span>
                      ) : (
                        <Pill tone="signal">{row.role}</Pill>
                      )}
                    </td>
                    <td className="py-3 pr-4">{row.plan}</td>
                    <td className="py-3 pr-4 tabular-nums text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-muted-foreground">
                      {formatDate(row.lastSeenAt)}
                    </td>
                    <td className="py-3 pr-6 text-right sm:pr-7">
                      <StateCell row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
          <p>
            {filtersActive ? (
              <>
                {formatNumber(rows.length)} shown on this page · {formatNumber(total)} accounts
                matched the search before filtering
              </>
            ) : (
              <>
                Page {page + 1} of {lastPage + 1} · {formatNumber(total)} accounts
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= lastPage}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Panel>

      {selected ? <UserDrawer userId={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <th className={`py-2.5 pr-4 font-medium ${className ?? ""}`}>{children}</th>;
}

function StateCell({ row }: { row: UserListRow }) {
  if (row.banned) return <Pill tone="outline">banned</Pill>;
  if (!row.onboarded) return <Pill tone="neutral">not set up</Pill>;
  if (row.planStatus !== "active") return <Pill tone="outline">{row.planStatus}</Pill>;
  return <span className="text-muted-foreground">—</span>;
}

/* ---------------------------------------------------------------------- */
/* Detail                                                                 */
/* ---------------------------------------------------------------------- */

function UserDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data: viewer } = useViewer();
  const isSuper = viewer?.role === "superadmin";

  const detail = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => getUserDetail({ data: { userId } }),
  });

  const invalidate = [
    ["admin", "user", userId],
    ["admin", "users"],
    ["admin", "overview"],
  ];

  const ban = useConsoleMutation(banUser, invalidate);
  const unban = useConsoleMutation(unbanUser, invalidate);
  const role = useConsoleMutation(setUserRole, invalidate);
  const plan = useConsoleMutation(setUserPlan, invalidate);

  const [reason, setReason] = useState("");
  const [confirmBan, setConfirmBan] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const u = detail.data;
  const busy = ban.isPending || unban.isPending || role.isPending || plan.isPending;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]"
      />

      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-hairline bg-background">
        <div className="glass sticky top-0 flex items-center justify-between gap-4 border-b border-hairline px-6 py-4">
          <div className="min-w-0">
            <p className="truncate font-medium">{u?.displayName || u?.email || "Loading"}</p>
            {u ? <p className="truncate text-[12px] text-muted-foreground">{u.email}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          {detail.isLoading ? <Loading label="Loading account" /> : null}
          <ErrorNote error={detail.error} />

          {u ? (
            <>
              {u.ban ? (
                <div className="rounded-2xl border border-border bg-surface-2 p-5">
                  <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
                    <ShieldAlert className="h-3.5 w-3.5" /> Banned
                  </p>
                  <p className="mt-2 text-[13.5px] leading-relaxed">
                    {u.ban.reason || "No reason recorded."}
                  </p>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Since {formatDateTime(u.ban.bannedAt)}
                    {u.ban.expiresAt
                      ? ` · expires ${formatDateTime(u.ban.expiresAt)}`
                      : " · indefinite"}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-4"
                    disabled={busy}
                    onClick={() => unban.mutate({ data: { userId } })}
                  >
                    {unban.isPending ? "Lifting…" : "Lift ban"}
                  </Button>
                  <ErrorNote error={unban.error} />
                </div>
              ) : null}

              <dl className="divide-y divide-[var(--hairline)] text-[13.5px]">
                <DRow label="Signed up" value={formatDateTime(u.createdAt)} />
                <DRow label="Last seen" value={formatDateTime(u.lastSeenAt)} />
                <DRow
                  label="Finished onboarding"
                  value={u.onboardedAt ? formatDateTime(u.onboardedAt) : "Never"}
                />
                <DRow label="Timezone" value={u.timezone} />
                <DRow label="Plan status" value={u.planStatus} />
                <DRow
                  label="Renews"
                  value={u.currentPeriodEnd ? formatDate(u.currentPeriodEnd) : "—"}
                />
              </dl>

              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-4">
                <Mini label="Topics" value={u.counts.topics} />
                <Mini label="Saved" value={u.counts.savedStories} />
                <Mini label="Briefings" value={u.counts.digests} />
                <Mini label="Feedback" value={u.counts.feedback} />
              </div>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Plan
                </h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                  A manual change here is for comps, credits and refunds. In production the billing
                  webhook owns this column, so an override may be reverted the next time Stripe
                  reports on the subscription.
                </p>
                <div className="mt-3 flex gap-1.5">
                  {PLANS.map((p) => (
                    <Chip
                      key={p}
                      active={u.plan === p}
                      disabled={busy}
                      onClick={() => plan.mutate({ data: { userId, plan: p } })}
                    >
                      {p}
                    </Chip>
                  ))}
                </div>
                <ErrorNote error={plan.error} />
              </section>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Role
                </h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                  {isSuper
                    ? "Admin grants console access. Superadmin additionally allows provider changes, role changes and deletions. The last superadmin cannot be demoted."
                    : "Only a superadmin can change roles."}
                </p>
                <div className="mt-3 flex gap-1.5">
                  {ROLES.map((r) => (
                    <Chip
                      key={r}
                      active={u.role === r}
                      disabled={!isSuper || busy}
                      onClick={() => role.mutate({ data: { userId, role: r } })}
                    >
                      {r}
                    </Chip>
                  ))}
                </div>
                <ErrorNote error={role.error} />
              </section>

              {u.recentDigests.length > 0 ? (
                <section>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Recent briefings
                  </h3>
                  <ul className="mt-3 divide-y divide-[var(--hairline)] text-[13px]">
                    {u.recentDigests.map((dg) => (
                      <li
                        key={`${dg.scheduledFor}-${dg.status}`}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <span className="tabular-nums text-muted-foreground">
                          {formatDate(dg.scheduledFor)}
                        </span>
                        <span className="flex items-center gap-2.5">
                          <span className="tabular-nums text-muted-foreground">
                            {dg.itemCount} items
                          </span>
                          <Pill tone={dg.status === "sent" ? "neutral" : "outline"}>
                            {dg.status}
                          </Pill>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {!u.ban ? (
                <section className="rounded-2xl border border-border p-5">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Ban this account
                  </h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                    Revokes the session immediately and blocks sign-in. Briefings stop being
                    generated. Data is kept — this is not a deletion, and it is reversible from this
                    panel.
                  </p>
                  <div className="mt-4">
                    <Field label="Reason" hint="Stored on the ban record and in the audit log.">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Abuse report #128"
                        className={inputClass}
                      />
                    </Field>
                  </div>
                  {confirmBan ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="signal"
                        disabled={busy}
                        onClick={() => {
                          ban.mutate({ data: { userId, reason } });
                          setConfirmBan(false);
                        }}
                      >
                        {ban.isPending ? "Banning…" : "Yes, ban"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmBan(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-4"
                      onClick={() => setConfirmBan(true)}
                    >
                      Ban account
                    </Button>
                  )}
                  <ErrorNote error={ban.error} />
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-serif text-[20px] leading-none tabular-nums">
        {formatNumber(value)}
      </p>
    </div>
  );
}
