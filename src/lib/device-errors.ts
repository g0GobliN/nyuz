const registrationUnavailable =
  "We couldn't register this device right now. Please try again later. If this keeps happening, contact support.";

/** Only known, actionable messages may reach the device interface. */
export function deviceErrorMessage(error: unknown, fallback = registrationUnavailable): string {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  const limit =
    /^(Uno|Plura|Omni) supports (\d+) registered device\(s\)\. Remove an existing device or upgrade\.$/.exec(
      message,
    );
  if (limit) {
    return `Your ${limit[1]} plan allows ${limit[2]} ${limit[2] === "1" ? "device" : "devices"}. Remove a device you no longer use or choose a plan with more devices.`;
  }
  if (
    message === registrationUnavailable ||
    /^Your (Uno|Plura|Omni) plan allows \d+ devices?\. Remove a device you no longer use or choose a plan with more devices\.$/.test(
      message,
    )
  )
    return message;
  return fallback;
}
