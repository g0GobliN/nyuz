import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { installId, rememberInstallId } from "@/lib/device-install";
import { listDevices, registerDevice, removeDevice } from "@/lib/server/devices";

export function DeviceManager({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const [state, setState] = useState<Awaited<ReturnType<typeof listDevices>> | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState("");
  const reload = async () => setState(await listDevices());
  const register = async () => {
    try {
      setError("");
      let endpoint: string | undefined;
      if ("serviceWorker" in navigator) {
        const sw = await navigator.serviceWorker.getRegistration();
        endpoint = (await sw?.pushManager?.getSubscription())?.endpoint;
      }
      const result = await registerDevice({
        data: { installId: installId(), ...(endpoint ? { endpoint } : {}) },
      });
      rememberInstallId(result.installId);
      setCurrent(result.installId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not register this device.");
    }
    await reload().catch(() => {});
  };
  useEffect(() => {
    if (user) void register();
  }, [user?.id]);
  if (!user || (compact && !error)) return null;
  return (
    <section className="mx-auto my-5 max-w-3xl rounded-2xl border border-hairline bg-surface p-5">
      <h2 className="font-medium">
        Registered devices{state ? ` · ${state.devices.length} of ${state.limit}` : ""}
      </h2>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
      {state && state.devices.length > state.limit && (
        <p className="mt-2 text-sm">
          Your devices are preserved. Push delivery uses the first {state.limit} registered devices
          on this plan.
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {state?.devices.map((device) => (
          <li key={device.install_id} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {device.label}
              {device.install_id === current ? " (this device)" : ""} ·{" "}
              {device.install_id.slice(0, 8)}
              <br />
              <span className="text-xs text-muted-foreground">
                Last seen {new Date(device.last_seen).toLocaleDateString()}
              </span>
            </span>
            <button
              className="underline"
              onClick={async () => {
                try {
                  await removeDevice({ data: { installId: device.install_id } });
                  await reload();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not remove device.");
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-4 text-sm">
        <button onClick={() => void register()} className="underline">
          Register this device
        </button>
        <a href="/dashboard/billing" className="text-signal">
          View plans
        </a>
      </div>
    </section>
  );
}
