import { PlanAccessError } from "./plan-access";
import { createServerFn } from "@tanstack/react-start";
import {
  deleteCookie,
  getCookie,
  getRequestProtocol,
  setCookie,
} from "@tanstack/react-start/server";
import { z } from "zod";
import type { Actor } from "./guard";
import { signedInOnly } from "./guard";
import { currentPlan } from "./plan-access";
import { PLAN_LIMITS } from "../plans";
import { deviceErrorMessage } from "../device-errors";
import {
  DEVICE_COOKIE,
  deviceCookieAttributes,
  resolveInstallId,
  type InstallIdInput,
} from "../device-anchor";

/**
 * Register this installation, whoever it turns out to be, and return the id its
 * row is under.
 *
 * Every path that registers a device goes through here — the settings list and
 * the push subscription both do — because the identity has to be decided in one
 * place. Two resolvers would eventually disagree about which row a device is,
 * and the disagreement would show up as a reader at their plan's cap being told
 * to remove a device they are not using, while the row for the phone in their
 * hand sat in the list beside it.
 *
 * The caller reads the request and writes the answer back, because neither can
 * be done from here — see `deviceCookieAttributes` in src/lib/device-anchor.ts
 * for the rule this module has to live inside.
 */
export async function registerThisDevice(
  actor: Actor,
  input: InstallIdInput & { label?: string | undefined; endpoint?: string | undefined },
): Promise<string> {
  const { data: rows, error: rowsError } = await actor.db
    .from("registered_devices")
    .select("install_id")
    .eq("user_id", actor.id);
  if (rowsError) throw new PlanAccessError(deviceErrorMessage(rowsError));

  const installId = resolveInstallId({
    anchor: input.anchor,
    client: input.installId,
    known: (rows ?? []).map((row) => row.install_id),
  });

  const { data: id, error } = await actor.db.rpc("register_device", {
    p_user_id: actor.id,
    p_install_id: installId,
    // Omitted rather than filled in, when this call has no label to give: the
    // function's own default is what means "no opinion, keep the name you
    // have" (0094). The push path has no label, and it runs on every dashboard
    // visit — handing it a placeholder is what renamed the reader's own device
    // to "Browser" and made the list unreadable.
    ...(input.label ? { p_label: input.label } : {}),
    p_endpoint: input.endpoint ?? null,
  });
  if (error) throw new PlanAccessError(deviceErrorMessage(error));

  return id;
}

export const registerDevice = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    z
      .object({
        installId: z.string().uuid(),
        label: z.string().trim().min(1).max(80).optional(),
        endpoint: z.string().max(2048).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const installId = await registerThisDevice(context.actor, {
      ...data,
      anchor: getCookie(DEVICE_COOKIE),
    });
    // The id the call ended on, not the one it was asked for: `register_device`
    // reunites identities that arrived by different routes (a push endpoint
    // migrated from before 0082), and a browser left holding the id it *asked*
    // for would look like a new device on its next visit.
    // `secure` follows the request rather than the build, because a plain-http
    // development origin still has to be able to set it and a proxy terminates
    // TLS before this code sees the connection. Read here rather than in a
    // helper: the build denies this import outside a handler body.
    setCookie(DEVICE_COOKIE, installId, deviceCookieAttributes(getRequestProtocol() === "https"));
    return { installId };
  });

export const listDevices = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }) => {
    const plan = await currentPlan(context.actor);
    const { data, error } = await context.actor.db
      .from("registered_devices")
      .select("*")
      .eq("user_id", context.actor.id)
      .order("first_seen")
      .order("install_id");
    if (error) throw new PlanAccessError("We couldn't load your devices. Please try again later.");
    return { devices: data ?? [], limit: PLAN_LIMITS[plan].devices, plan };
  });

export const removeDevice = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => z.object({ installId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.actor.db
      .from("registered_devices")
      .delete()
      .eq("user_id", context.actor.id)
      .eq("install_id", data.installId);
    if (error) throw new PlanAccessError("We couldn't remove this device. Please try again later.");

    // The reader removed the device they are holding. Keeping the anchor would
    // hand the same identity straight back on the next page load, and the row
    // would reappear as though the removal had failed.
    if (getCookie(DEVICE_COOKIE) === data.installId) {
      deleteCookie(DEVICE_COOKIE, deviceCookieAttributes(getRequestProtocol() === "https"));
    }
    return { ok: true };
  });
