import { pushBlock, pushBlockMessage, pushPermission, type PushBlock } from "./client";

/**
 * The three facts behind the Notifications row, kept apart on purpose.
 *
 * ---------------------------------------------------------------------------
 * Why this is a separate type at all
 * ---------------------------------------------------------------------------
 *
 * Push subscriptions are per browser. Every device that wants notifications
 * calls `pushManager.subscribe()` itself and gets its own endpoint, and the
 * account holds one row per endpoint. So there are two different questions
 * with two different answers:
 *
 *   deviceSubscribed — does *this* browser hold a PushSubscription?
 *   accountDevices   — how many devices does the account have?
 *
 * The Delivery row used to answer the first with the second (by way of the
 * account-level `channels.push` preference, which every browser downloads).
 * A desktop subscribing therefore made a phone render as already on, so the
 * phone could never be turned on and never created a subscription of its own;
 * turning the phone "off" then deleted the desktop's row, because a device
 * with nothing to unsubscribe fell back to deleting everything.
 *
 * `deviceSubscribed` drives the toggle. `accountDevices` is a label and
 * nothing else.
 */
export type PushRowState = {
  /** This browser holds its own PushSubscription. The toggle, and only this. */
  deviceSubscribed: boolean;
  /** Devices on the account, this one included. Informational. */
  accountDevices: number;
  permission: NotificationPermission | "unavailable";
  /** Push is set up on this instance at all. */
  configured: boolean;
};

export const IDLE_DETAIL =
  "One notice per story. Tap to read, dismiss the rest. Your dashboard still has everything.";

/**
 * The one line under "Notifications".
 *
 * `block` is a parameter, defaulted to the real device, so the copy can be
 * exercised without a browser attached.
 */
export function pushDetail(state: PushRowState, block: PushBlock | null = pushBlock()): string {
  if (block === "ios-needs-install") {
    return "Add Nyuz to your Home Screen to turn these on. Use email or Telegram until then.";
  }
  if (block) return pushBlockMessage(block);
  if (!state.configured) return "Not available on this instance yet";

  if (state.permission === "denied") {
    return "Blocked in your device settings. Allow notifications for Nyuz there, then turn this on.";
  }

  if (state.deviceSubscribed) {
    // This device is counted in `accountDevices`, so what is left over is the
    // rest of them. Saying "1 device subscribed" while standing on that one
    // device reads as though the others were not there.
    const others = Math.max(state.accountDevices - 1, 0);
    const tail = "One notice per story; dismissing does not remove it from your dashboard.";
    if (others === 0) return `On on this device · the only one subscribed. ${tail}`;
    const rest = others === 1 ? "1 other device" : `${others} other devices`;
    return `On on this device · ${rest} subscribed. ${tail}`;
  }

  if (state.accountDevices > 0) {
    const devices =
      state.accountDevices === 1 ? "1 other device" : `${state.accountDevices} other devices`;
    return `Off on this device · ${devices} subscribed. Turn this on to get notices here too.`;
  }
  if (state.permission === "granted") {
    return "Off · no devices subscribed. Notifications are already allowed here, so this only takes a tap.";
  }
  return IDLE_DETAIL;
}

/**
 * Reads the row's state off the current device and the account's status.
 *
 * `deviceSubscribed` is passed in rather than read here: it comes from an async
 * `pushManager.getSubscription()` call the caller already holds in a query.
 */
export function pushRowState(
  status: { configured: boolean; count: number } | undefined,
  deviceSubscribed: boolean,
): PushRowState {
  return {
    deviceSubscribed,
    accountDevices: status?.count ?? 0,
    permission: pushPermission(),
    configured: status?.configured ?? false,
  };
}
