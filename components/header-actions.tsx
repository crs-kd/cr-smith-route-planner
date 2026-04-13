"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/auth-context";
import UserMenu from "@/components/user-menu";
import AdminPanel from "@/components/admin-panel";
import SettingsPanel from "@/components/settings-panel";

export default function HeaderActions() {
  const { session } = useSession();
  const [showAdmin, setShowAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const pathname = usePathname();

  const onPlansPage = pathname === "/plans" || pathname.startsWith("/plans/");

  return (
    <div className="flex items-center gap-3">
      {session && !onPlansPage && (
        <a
          href="/plans"
          className="hidden sm:flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-medium transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
            <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
            <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
            <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
          Plans
        </a>
      )}

      {session && session.role !== "viewer" && onPlansPage && (
        <a
          href="/"
          className="hidden sm:flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-medium transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 8L8 2l6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 6v7a1 1 0 001 1h2v-3h2v3h2a1 1 0 001-1V6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Planner
        </a>
      )}

      <UserMenu onManageUsers={() => setShowAdmin(true)} onSettings={() => setShowSettings(true)} />

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
