"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-context";

interface UserMenuProps {
  onManageUsers: () => void;
}

export default function UserMenu({ onManageUsers }: UserMenuProps) {
  const { session, loading, refresh } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleLogout() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    await refresh();
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return <div className="w-8 h-8 rounded-full bg-white/20 animate-pulse" />;
  }

  if (!session) return null;

  const initials = session.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const ROLE_BADGE: Record<string, string> = {
    admin:  "bg-amber-100 text-amber-800",
    editor: "bg-blue-100 text-blue-800",
    viewer: "bg-gray-100 text-gray-700",
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-full focus:outline-none focus:ring-2 focus:ring-white/50"
        aria-label="Account menu"
      >
        <div className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 transition-colors flex items-center justify-center text-white text-xs font-bold select-none">
          {initials}
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-56 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-[200]">
          {/* User info */}
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-coal truncate">{session.name}</p>
            <p className="text-xs text-coal/50 truncate">{session.email}</p>
            <span className={`inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${ROLE_BADGE[session.role] ?? ROLE_BADGE.viewer}`}>
              {session.role}
            </span>
          </div>

          {/* Actions */}
          <div className="py-1">
            <a
              href="/plans"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 text-sm text-coal/70 hover:bg-gray-50 hover:text-coal transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
              </svg>
              Saved Plans
            </a>

            {session.role === "admin" && (
              <button
                onClick={() => { setOpen(false); onManageUsers(); }}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-coal/70 hover:bg-gray-50 hover:text-coal transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M1 13.5c0-2.485 2.239-4.5 5-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <path d="M11 9v4M9 11h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Manage Users
              </button>
            )}

            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
