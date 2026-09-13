import { describe, expect, it } from "vitest";
import { deviceErrorMessage } from "./device-errors";

describe("device error messages", () => {
  it("hides database details, including errors serialized without an Error prototype", () => {
    const message = deviceErrorMessage({
      message:
        "Could not find the function public.register_device(p_endpoint, p_install_id, p_user_id) in the schema cache",
    });
    expect(message).toContain("We couldn't register this device");
    expect(message).not.toMatch(/public\.|schema|p_endpoint/);
    expect(deviceErrorMessage(new Error("internal connection details"))).toBe(message);
  });

  it("preserves actionable plan limits through server and client formatting", () => {
    const message = deviceErrorMessage({
      message: "Omni supports 5 registered device(s). Remove an existing device or upgrade.",
    });
    expect(message).toContain("Your Omni plan allows 5 devices.");
    expect(deviceErrorMessage(new Error(message))).toBe(message);
  });

  it("uses the removal message for unknown removal failures", () => {
    expect(deviceErrorMessage(null, "Could not remove device.")).toBe("Could not remove device.");
  });
});
