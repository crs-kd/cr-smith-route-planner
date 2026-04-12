"use client";

import { useState } from "react";
import { useSession } from "@/lib/auth-context";
import UserMenu from "@/components/user-menu";
import AdminPanel from "@/components/admin-panel";

export default function HeaderActions() {
  const { session } = useSession();
  const [showAdmin, setShowAdmin] = useState(false);

  return (
    <div className="flex items-center gap-3">
      {session && (
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

      <UserMenu onManageUsers={() => setShowAdmin(true)} />

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  );
}
