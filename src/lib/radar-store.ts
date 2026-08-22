import { useCallback, useEffect, useState } from "react";

export type RadarPrefs = {
  name: string;
  topics: string[];
  exclusions: string[];
  time: string;
  timezone: string;
  days: string[];
  channels: { email: boolean; telegram: boolean; whatsapp: boolean };
  density: number; // 0 minimal .. 100 deep
  frequency: "daily" | "weekly";
  breaking: "important" | "everything" | "off";
  onboarded: boolean;
};

export const DEFAULT_PREFS: RadarPrefs = {
  name: "Vishal",
  topics: ["AI", "OpenAI", "Anthropic", "Cursor", "React", "TypeScript", "Startups"],
  exclusions: ["Crypto", "Politics", "Celebrity news"],
  time: "07:30",
  timezone: "Asia/Tokyo",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  channels: { email: true, telegram: true, whatsapp: false },
  density: 35,
  frequency: "daily",
  breaking: "important",
  onboarded: false,
};

const KEY = "nyuz.prefs.v1";

export function useRadar() {
  const [prefs, setPrefs] = useState<RadarPrefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<RadarPrefs>) });
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Partial<RadarPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { prefs, update, hydrated };
}
