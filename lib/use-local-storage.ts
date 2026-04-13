"use client";
import { useState, useEffect } from "react";

// Custom event name used to broadcast same-tab localStorage writes to all
// other hook instances reading the same key.
const SYNC_EVENT = "cr-smith-ls-sync";

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // Always start with initialValue so the server and first client render match.
  const [stored, setStored] = useState<T>(initialValue);

  // After hydration, read the real value from localStorage.
  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item != null) setStored(JSON.parse(item) as T);
    } catch {
      // ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Keep in sync when *another* hook instance (same tab) writes to the same key.
  useEffect(() => {
    function onSync(e: Event) {
      const { key: k, value } = (e as CustomEvent<{ key: string; value: string }>).detail;
      if (k !== key) return;
      try {
        setStored(JSON.parse(value) as T);
      } catch {
        // ignore
      }
    }
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, [key]);

  const setValue = (value: T | ((prev: T) => T)) => {
    try {
      const next = value instanceof Function ? value(stored) : value;
      setStored(next);
      const serialized = JSON.stringify(next);
      window.localStorage.setItem(key, serialized);
      // Notify all other hook instances watching the same key in this tab.
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENT, { detail: { key, value: serialized } })
      );
    } catch (e) {
      console.error("useLocalStorage write error", e);
    }
  };

  return [stored, setValue];
}
