"use client";
import { useState, useEffect } from "react";

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
      if (item != null) {
        setStored(JSON.parse(item) as T);
      }
    } catch {
      // ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = (value: T | ((prev: T) => T)) => {
    try {
      const next = value instanceof Function ? value(stored) : value;
      setStored(next);
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch (e) {
      console.error("useLocalStorage write error", e);
    }
  };

  return [stored, setValue];
}
