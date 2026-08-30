import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ConsoleHeader,
  ErrorNote,
  Field,
  Loading,
  Panel,
  Pill,
  Stat,
  StatGrid,
  formatDateTime,
  formatNumber,
  inputClass,
  useConfirm,
  useConsoleMutation,
} from "@/components/admin/shell";
import { Button } from "@/components/kit";
import {
  getAccessOverview,
  inviteFromWaitlist,
  listWaitlist,
  removeFromWaitlist,
} from "@/lib/server/access";
import { saveSetting } from "@/lib/server/settings";
import { ACCESS_DEFAULT, type Access } from "@/lib/site-content";

export const Route = createFileRoute("/admin/access")({ component: AccessPage });

/**
 * Capacity, the waitlist and the maintenance switch.
 *
 * Nothing drawn here enforces anything. The cap and the maintenance close are
 * enforced by the `enforce_signups_open` trigger on `auth.users` in
 * `0038_access_control.sql`, because a Google sign-in never reaches this
 * application at all. This page writes the numbers that trigger reads.
 *
 * Which is why the seat count is prominent and the limit field is not clever:
 * an operator setting a cap needs to know what it is being compared against
 * right now, and nothing else on this page matters as much as that one figure.
 */
function AccessPage() {
  const overview = useQuery({
    queryKey: ["admin", "access"],
    queryFn: () => getAccessOverview(),
    staleTime: 30_000,
  });

  const waitlist = useQuery({
    queryKey: ["admin", "waitlist"],
    queryFn: () => listWaitlist({ data: { limit: 200 } }),
    staleTime: 30_000,
  });

  const save = useConsoleMutation(
    (value: Access) => saveSetting({ data: { key: "site.access", value } }),
    [["admin", "access"]],
  );
  const invite = useConsoleMutation(
    (count: number) => inviteFromWaitlist({ data: { count } }),
    [
      ["admin", "access"],
      ["admin", "waitlist"],
    ],
  );
  const drop = useConsoleMutation(
    (id: string) => removeFromWaitlist({ data: { id } }),
    [
      ["admin", "access"],
      ["admin", "waitlist"],
    ],
  );

  const stored = overview.data?.access;
  const [form, setForm] = useState<Access>(ACCESS_DEFAULT);
  const [inviteCount, setInviteCount] = useState(10);
  const confirm = useConfirm();

  // Seeded from the server once it answers. Without this the form would show
  // the bundled default over a database that says something else, and the
  // first save would quietly overwrite the real numbers with the defaults.
  useEffect(() => {
    if (stored) setForm(stored);
  }, [stored]);

  if (overview.isLoading) return <Loading label="Reading access settings" />;

  const data = overview.data;
  const seats = data?.seatsUsed ?? 0;
  const limit = form.userLimit;
  const full = limit > 0 && seats >= limit;
  const remaining = limit > 0 ? Math.max(0, limit - seats) : null;
  const rows = waitlist.data ?? [];

  return (
    <>
      <ConsoleHeader
        title="Access"
        sub="How many people can be in, who is waiting, and the switch that closes the doors."
      />

      <StatGrid>
        <Stat
          label="Accounts"
          value={formatNumber(seats)}
          hint={limit > 0 ? `of ${formatNumber(limit)}` : "no limit set"}
        />
        <Stat
          label="Seats left"
          value={remaining === null ? "—" : formatNumber(remaining)}
          hint={full ? "full — only invitations get in" : "open to new signups"}
        />
        <Stat label="Waiting" value={formatNumber(data?.waiting ?? 0)} hint="not yet invited" />
        <Stat
          label="Invited"
          value={formatNumber(data?.invitedPending ?? 0)}
          hint="yet to sign up"
        />
      </StatGrid>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Panel
          title="Capacity"
          note="0 means no limit. The count above is rows in profiles, which is what the signup trigger compares against."
        >
          <Field label="Maximum accounts">
            <input
              type="number"
              min={0}
              value={form.userLimit}
              onChange={(e) => setForm({ ...form, userLimit: Number(e.target.value) || 0 })}
              className={inputClass}
            />
          </Field>

          <label className="mt-5 flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.waitlistOpen}
              onChange={(e) => setForm({ ...form, waitlistOpen: e.target.checked })}
              className="mt-1"
            />
            <span className="text-[13.5px] leading-relaxed">
              Offer a waitlist when full
              <span className="mt-1 block text-[12px] text-muted-foreground">
                Off shows an email address instead. Turn it off if nobody is going to work through a
                list — a queue that never moves is worse than an honest inbox.
              </span>
            </span>
          </label>

          <div className="mt-6">
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save capacity"}
            </Button>
          </div>
          <ErrorNote error={save.error} />
        </Panel>

        <Panel
          title="Maintenance"
          note="Closes the site for everybody except admins. Sign-in, the dashboard and the landing page all show the notice; the pipeline keeps running."
        >
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.maintenance}
              onChange={(e) => setForm({ ...form, maintenance: e.target.checked })}
              className="mt-1"
            />
            <span className="text-[13.5px] leading-relaxed">
              Maintenance mode
              {form.maintenance ? (
                <span className="ml-2 align-middle">
                  <Pill tone="signal">live</Pill>
                </span>
              ) : null}
              <span className="mt-1 block text-[12px] text-muted-foreground">
                You will still be able to sign in and use the console. Everybody else sees the
                notice below.
              </span>
            </span>
          </label>

          <div className="mt-5">
            <Field label="What readers see" hint="Kept short. It is read by somebody who is stuck.">
              <textarea
                rows={3}
                maxLength={300}
                value={form.maintenanceMessage}
                onChange={(e) => setForm({ ...form, maintenanceMessage: e.target.value })}
                className={`${inputClass} resize-none`}
              />
            </Field>
          </div>

          <div className="mt-6">
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save maintenance"}
            </Button>
          </div>

          {data && !data.signupsFlagOn ? (
            <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">
              Note: the <span className="text-foreground">signups_open</span> flag is off, so
              registration is closed regardless of the capacity above. That switch lives on the
              flags page.
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel
        className="mt-6"
        title="Waitlist"
        note="Oldest first. Inviting stamps the row and emails them; that stamp is what lets the address past a full cap, and it is spent on signup."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Field label="Invite">
              <input
                type="number"
                min={1}
                max={200}
                value={inviteCount}
                onChange={(e) => setInviteCount(Number(e.target.value) || 1)}
                className={inputClass}
              />
            </Field>
          </div>
          <Button
            onClick={() => invite.mutate(inviteCount)}
            disabled={invite.isPending || (data?.waiting ?? 0) === 0}
          >
            {invite.isPending ? "Inviting…" : `Invite next ${inviteCount}`}
          </Button>
          {remaining !== null && inviteCount > remaining ? (
            <p className="text-[12.5px] text-muted-foreground">
              Only {formatNumber(remaining)} seats are free. Inviting more than that is allowed — an
              invitation is spent when somebody signs up, so extra invitations simply queue behind
              the cap.
            </p>
          ) : null}
        </div>
        <ErrorNote error={invite.error} />
        <ErrorNote error={drop.error} />

        {waitlist.isLoading ? (
          <div className="mt-6">
            <Loading label="Reading waitlist" />
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-6 text-[13.5px] text-muted-foreground">Nobody is waiting.</p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Email</th>
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Joined</th>
                  <th className="pb-2 pr-4 font-medium">State</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-hairline">
                    <td className="py-2.5 pr-4 break-all">{row.email}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{row.name || "—"}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="py-2.5 pr-4">
                      {row.signed_up_at ? (
                        <Pill>signed up</Pill>
                      ) : row.invited_at ? (
                        <Pill tone="signal">invited</Pill>
                      ) : (
                        <Pill tone="outline">waiting</Pill>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {confirm.is(row.id) ? (
                        <span className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              drop.mutate(row.id);
                              confirm.clear();
                            }}
                            className="text-[12px] underline underline-offset-4"
                          >
                            Really remove
                          </button>
                          <button
                            onClick={confirm.clear}
                            className="text-[12px] text-muted-foreground"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => confirm.ask(row.id)}
                          className="text-[12px] text-muted-foreground hover:text-foreground"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
