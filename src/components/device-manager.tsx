import { Check, Globe2, Laptop, Smartphone, Tablet, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, LinkButton } from "@/components/kit";
import { useAuth } from "@/lib/auth";
import { deviceErrorMessage } from "@/lib/device-errors";
import { deviceLabel, installId, rememberInstallId } from "@/lib/device-install";
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
        data: { installId: installId(), label: deviceLabel(), ...(endpoint ? { endpoint } : {}) },
      });
      rememberInstallId(result.installId);
      setCurrent(result.installId);
    } catch (e) {
      setError(deviceErrorMessage(e));
    }
    await reload().catch(() => {});
  };
  useEffect(() => {
    if (user) void register();
  }, [user?.id]);
  if (!user || (compact && !error)) return null;
  return (
    <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Devices
          </p>
          <h2 className="mt-2 text-[17px] font-medium tracking-tight">Registered devices</h2>
        </div>
        {state ? (
          <p className="text-[12.5px] tabular-nums text-muted-foreground">
            {state.devices.length} of {state.limit} used
          </p>
        ) : null}
      </div>

      <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
        Each browser or installed app gets its own delivery slot. Remove devices you no longer use.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-2xl border border-destructive/30 px-4 py-3 text-[12.5px]"
        >
          {error}
        </p>
      ) : null}
      {state && state.devices.length > state.limit ? (
        <p className="mt-4 rounded-2xl border border-hairline bg-surface-2 px-4 py-3 text-[12.5px] text-muted-foreground">
          Your devices are preserved. Push delivery uses the first {state.limit} registered devices
          on this plan.
        </p>
      ) : null}

      <ul className="mt-5 space-y-2">
        {state?.devices.map((device) => {
          const legacy = /^Existing browser \/ PWA$/i.test(device.label);
          const label = legacy ? "Older browser" : device.label;
          const lowerLabel = label.toLowerCase();
          const DeviceIcon = /iphone|android/i.test(lowerLabel)
            ? Smartphone
            : /ipad|tablet/i.test(lowerLabel)
              ? Tablet
              : /macos|windows|linux/i.test(lowerLabel)
                ? Laptop
                : Globe2;
          return (
            <li
              key={device.install_id}
              className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface-2 px-4 py-3.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface text-muted-foreground">
                <DeviceIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                  <span className="truncate">{label}</span>
                  {device.install_id === current ? (
                    <span className="rounded-full bg-signal/15 px-2 py-0.5 text-[10.5px] font-medium text-signal">
                      This device
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Last seen{" "}
                  {new Date(device.last_seen).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
                {legacy ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Registered before device details were available
                  </p>
                ) : null}
              </div>
              <button
                aria-label={`Remove ${label}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={async () => {
                  try {
                    await removeDevice({ data: { installId: device.install_id } });
                    await reload();
                  } catch (e) {
                    setError(
                      deviceErrorMessage(
                        e,
                        "We couldn't remove this device. Please try again later.",
                      ),
                    );
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {state?.devices.some((device) => device.install_id === current) ? (
          <Button variant="ghost" size="sm" disabled>
            <Check className="h-3.5 w-3.5" /> This device is registered
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void register()}>
            Register this device
          </Button>
        )}
        {state && state.devices.length >= state.limit ? (
          <LinkButton to="/dashboard/billing" variant="ghost" size="sm">
            View plans
          </LinkButton>
        ) : null}
      </div>
    </section>
  );
}
