"use client";

import { useState, useEffect } from "react";

export type PillTarget =
  | "appointments"
  | "canvass"
  | "private"
  | "shared"
  | "link"
  | "admin"
  | "editor"
  | "viewer";

export interface PillStyle {
  bg: string;
  text: string;
}

export interface UISettings {
  pillStyles: Record<PillTarget, PillStyle>;
}

export const DEFAULT_PILL_STYLES: Record<PillTarget, PillStyle> = {
  appointments: { bg: "#dbeafe", text: "#1e40af" },
  canvass:      { bg: "#f3e8ff", text: "#6b21a8" },
  private:      { bg: "#f3f4f6", text: "#4b5563" },
  shared:       { bg: "#dcfce7", text: "#166534" },
  link:         { bg: "#f3e8ff", text: "#6b21a8" },
  admin:        { bg: "#dcfce7", text: "#166534" },
  editor:       { bg: "#dbeafe", text: "#1e40af" },
  viewer:       { bg: "#f3f4f6", text: "#374151" },
};

const LS_KEY = "cr-smith-ui-settings";

export function useUISettings(): [UISettings, (s: UISettings) => void] {
  const [settings, setSettings] = useState<UISettings>({
    pillStyles: DEFAULT_PILL_STYLES,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<UISettings>;
        setSettings({
          pillStyles: { ...DEFAULT_PILL_STYLES, ...(parsed.pillStyles ?? {}) },
        });
      }
    } catch { /* ignore */ }
  }, []);

  function update(s: UISettings) {
    setSettings(s);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch { /* ignore */ }
  }

  return [settings, update];
}

/** Convert a PillStyle to React inline style properties. */
export function pillStyle(s: PillStyle): React.CSSProperties {
  return { backgroundColor: s.bg, color: s.text };
}
