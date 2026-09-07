import { afterEach, describe, expect, it, vi } from "vitest";
import { sendStoryPushes } from "./send";
import type { StoryPush } from "@/lib/push/payload";

// The real one does ECDH against the subscription keys. None of what is under
// test here depends on the ciphertext, only on what the push service answers.
vi.mock("@block65/webcrypto-web-push", () => ({
  buildPushPayload: async () => ({ method: "POST", headers: {}, body: "encrypted" }),
}));

afterEach(() => vi.unstubAllGlobals());

const VAPID = {
  VAPID_PUBLIC_KEY: "public-key",
  VAPID_PRIVATE_KEY: "private-key",
  VAPID_SUBJECT: "mailto:ops@nyuz.app",
};

const STORY: StoryPush = {
  title: "A thing happened",
  body: "Some detail.",
  url: "https://nyuz.app/dashboard",
  tag: "digest-1",
};

function subs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `sub-${i}`,
    endpoint: `https://push.example/${i}`,
    p256dh: "p",
    auth: "a",
  }));
}

/** Answers by endpoint index, so each device can be given its own behaviour. */
function respondPerDevice(statuses: number[]) {
  return vi.fn<typeof fetch>(async (input) => {
    const index = Number(String(input).split("/").pop());
    return new Response(null, { status: statuses[index] ?? 201 });
  });
}

describe("sendStoryPushes accounting", () => {
  it("does not report success when only some devices took the push", async () => {
    // The bug this pins: one 201 among two 503s used to answer ok:true, the
    // delivery row was marked sent, and the two phones never retried.
    vi.stubGlobal("fetch", respondPerDevice([201, 503, 503]));

    const result = await sendStoryPushes({
      subscriptions: subs(3),
      stories: [STORY],
      env: VAPID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(true);
    expect(result.error).toContain("2/3");
  });

  it("reports success when every device took the push", async () => {
    vi.stubGlobal("fetch", respondPerDevice([201, 201, 200]));

    const result = await sendStoryPushes({
      subscriptions: subs(3),
      stories: [STORY],
      env: VAPID,
    });

    expect(result.ok).toBe(true);
    expect(result.dropIds).toEqual([]);
  });

  it("keeps a delivery retryable when any device failed transiently", async () => {
    // Last-write-wins used to let a trailing 400 overwrite the 503's retryable
    // flag, turning a transient outage into a permanent failure.
    vi.stubGlobal("fetch", respondPerDevice([503, 400]));

    const result = await sendStoryPushes({
      subscriptions: subs(2),
      stories: [STORY],
      env: VAPID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(true);
  });

  it("treats a gone device as unsubscribed, not as a failure", async () => {
    vi.stubGlobal("fetch", respondPerDevice([201, 410]));

    const result = await sendStoryPushes({
      subscriptions: subs(2),
      stories: [STORY],
      env: VAPID,
    });

    expect(result.ok).toBe(true);
    expect(result.dropIds).toEqual(["sub-1"]);
  });

  it("does not fail a delivery that reached the reader over a permanently broken device", async () => {
    vi.stubGlobal("fetch", respondPerDevice([201, 400]));

    const result = await sendStoryPushes({
      subscriptions: subs(2),
      stories: [STORY],
      env: VAPID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.partialError).toContain("1/2");
  });

  it("fails when no device could be reached at all", async () => {
    vi.stubGlobal("fetch", respondPerDevice([400, 400]));

    const result = await sendStoryPushes({
      subscriptions: subs(2),
      stories: [STORY],
      env: VAPID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(false);
  });

  it("reports every device gone as having nothing to send to", async () => {
    vi.stubGlobal("fetch", respondPerDevice([410, 404]));

    const result = await sendStoryPushes({
      subscriptions: subs(2),
      stories: [STORY],
      env: VAPID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("no push subscription");
    expect(result.retryable).toBe(false);
    expect(result.dropIds).toEqual(["sub-0", "sub-1"]);
  });

  it("stops pushing to a device that has already refused", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 410 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendStoryPushes({
      subscriptions: subs(1),
      stories: [STORY, STORY, STORY],
      env: VAPID,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends every story to every subscribed device", async () => {
    // The account side of the multi-device fix: one row per browser only helps
    // if delivery actually visits all of them. Three devices, two stories, and
    // each device has to be asked for both — a fan-out that quietly stopped at
    // the first subscription would leave the other phones silent while the
    // delivery still recorded as sent.
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const second: StoryPush = { ...STORY, title: "Another thing", tag: "digest-2" };

    const result = await sendStoryPushes({
      subscriptions: subs(3),
      stories: [STORY, second],
      env: VAPID,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const visited = fetchMock.mock.calls.map(([input]) => String(input));
    for (const sub of subs(3)) {
      expect(visited.filter((url) => url === sub.endpoint)).toHaveLength(2);
    }
  });

  it("retires only the device that is gone", async () => {
    // A 410 from one phone must not take the other devices' rows with it: the
    // caller deletes exactly the ids returned here.
    vi.stubGlobal("fetch", respondPerDevice([201, 410, 201]));

    const result = await sendStoryPushes({
      subscriptions: subs(3),
      stories: [STORY],
      env: VAPID,
    });

    expect(result.ok).toBe(true);
    expect(result.dropIds).toEqual(["sub-1"]);
  });

  it("bounds each request with a timeout signal", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendStoryPushes({ subscriptions: subs(1), stories: [STORY], env: VAPID });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats a timeout as retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new DOMException("The operation was aborted.", "TimeoutError");
      }),
    );

    const result = await sendStoryPushes({
      subscriptions: subs(1),
      stories: [STORY],
      env: VAPID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(true);
  });
});
