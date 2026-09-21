import { PlanAccessError } from "./plan-access";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signedInOnly } from "./guard";
import { currentPlan } from "./plan-access";
import { PLAN_LIMITS } from "../plans";
import { deviceErrorMessage } from "../device-errors";

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
    const { data: id, error } = await context.actor.db.rpc("register_device", {
      p_user_id: context.actor.id,
      p_install_id: data.installId,
      p_label: data.label ?? "Browser",
      p_endpoint: data.endpoint ?? null,
    });
    if (error) throw new PlanAccessError(deviceErrorMessage(error));
    return { installId: id };
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
    return { ok: true };
  });
