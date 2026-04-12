"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-context";

interface Plan {
  id: string;
  name: string;
  notes: string | null;
  type: "appointments" | "canvass";
  visibility: "private" | "shared" | "link";
  share_token: string | null;
  created_at: string;
  updated_at: string;
  creator_name: string;
  creator_email: string;
}

interface AuditEntry {
  id: string;
  user_name: string | null;
  action: string;
  resource_type: string | null;
  resource_name: string | null;
  created_at: string;
}

type FilterType = "all" | "appointments" | "canvass";
type ActiveTab = "plans" | "audit";

const TYPE_BADGE: Record<string, string> = {
  appointments: "bg-blue-100 text-blue-800",
  canvass:      "bg-amber-100 text-amber-800",
};

const VIS_BADGE: Record<string, string> = {
  private: "bg-gray-100 text-gray-600",
  shared:  "bg-green-100 text-green-700",
  link:    "bg-purple-100 text-purple-700",
};

const VIS_LABEL: Record<string, string> = {
  private: "Private",
  shared:  "Shared",
  link:    "Link",
};

const ACTION_LABEL: Record<string, string> = {
  "auth.login":    "Signed in",
  "auth.logout":   "Signed out",
  "plan.saved":    "Saved plan",
  "plan.viewed":   "Viewed plan",
  "plan.deleted":  "Deleted plan",
  "plan.shared":   "Shared plan",
  "user.created":  "Created user",
  "user.updated":  "Updated user",
  "user.deleted":  "Deactivated user",
};

export default function PlansScreen() {
  const { session } = useSession();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [activeTab, setActiveTab] = useState<ActiveTab>("plans");
  const [copyId, setCopyId] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/plans");
      if (res.ok) setPlans(await res.json() as Plan[]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAudit = useCallback(async () => {
    try {
      const res = await fetch("/api/audit");
      if (res.ok) setAudit(await res.json() as AuditEntry[]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void fetchPlans(); }, [fetchPlans]);
  useEffect(() => {
    if (activeTab === "audit" && session?.role === "admin") void fetchAudit();
  }, [activeTab, session, fetchAudit]);

  async function deletePlan(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    await fetch(`/api/plans/${id}`, { method: "DELETE" });
    setPlans((prev) => prev.filter((p) => p.id !== id));
  }

  async function copyShareLink(plan: Plan) {
    let url: string;
    if (plan.share_token) {
      url = `${window.location.origin}/share/${plan.share_token}`;
    } else {
      const res = await fetch(`/api/plans/${plan.id}/share`, { method: "POST" });
      if (!res.ok) return;
      const data = await res.json() as { url: string; token: string };
      url = data.url;
      setPlans((prev) => prev.map((p) => p.id === plan.id ? { ...p, share_token: data.token, visibility: "link" } : p));
    }
    await navigator.clipboard.writeText(url);
    setCopyId(plan.id);
    setTimeout(() => setCopyId(null), 2000);
  }

  const filtered = plans.filter((p) => filter === "all" || p.type === filter);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  const canSave = session && session.role !== "viewer";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-coal">Saved Plans</h1>
            <p className="text-sm text-coal/50 mt-0.5">
              {session?.role === "viewer" ? "Plans shared with you" : "Your saved route plans"}
            </p>
          </div>
          {session && session.role !== "viewer" && (
            <a
              href="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-loch text-white text-sm font-medium rounded-lg hover:bg-loch/90 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              New Plan
            </a>
          )}
        </div>

        {/* Tabs (admin sees audit log) */}
        {session?.role === "admin" && (
          <div className="flex gap-0 border-b border-gray-200 mb-6">
            {(["plans", "audit"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${activeTab === tab ? "border-loch text-loch" : "border-transparent text-coal/50 hover:text-coal"}`}
              >
                {tab === "audit" ? "Audit Log" : "Plans"}
              </button>
            ))}
          </div>
        )}

        {activeTab === "plans" && (
          <>
            {/* Filters */}
            <div className="flex gap-2 mb-5">
              {(["all", "appointments", "canvass"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors capitalize ${filter === f ? "bg-loch text-white border-loch" : "bg-white border-gray-200 text-coal/60 hover:text-coal"}`}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                  {f !== "all" && (
                    <span className="ml-1 opacity-60">({plans.filter((p) => p.type === f).length})</span>
                  )}
                </button>
              ))}
            </div>

            {/* Plan cards */}
            {loading ? (
              <div className="text-sm text-coal/40 text-center py-16">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <svg className="mx-auto w-10 h-10 text-coal/20 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                </svg>
                <p className="text-sm text-coal/40">No {filter === "all" ? "" : filter + " "}plans yet</p>
                {canSave && (
                  <a href="/" className="text-xs text-loch hover:underline mt-1 inline-block">Create one in the planner →</a>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {filtered.map((plan) => (
                  <div key={plan.id} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2.5 hover:border-loch/30 hover:shadow-sm transition-all">
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-coal truncate">{plan.name}</p>
                        <div className="flex gap-1.5 mt-1 flex-wrap">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${TYPE_BADGE[plan.type]}`}>
                            {plan.type}
                          </span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase ${VIS_BADGE[plan.visibility]}`}>
                            {VIS_LABEL[plan.visibility]}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Notes */}
                    {plan.notes && (
                      <p className="text-xs text-coal/50 line-clamp-2">{plan.notes}</p>
                    )}

                    {/* Meta */}
                    <div className="flex items-center justify-between text-[11px] text-coal/40 pt-0.5">
                      <span>By {plan.creator_name}</span>
                      <span>{formatDate(plan.created_at)}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-1 border-t border-gray-100">
                      <a
                        href={`/plans/${plan.id}`}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-loch border border-loch/20 rounded-lg hover:bg-loch/5 transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M1 8s3-5.5 7-5.5S15 8 15 8s-3 5.5-7 5.5S1 8 1 8z" stroke="currentColor" strokeWidth="1.4"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/></svg>
                        View
                      </a>
                      <button
                        onClick={() => copyShareLink(plan)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-coal/50 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                        title="Copy share link"
                      >
                        {copyId === plan.id ? (
                          <><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> Copied</>
                        ) : (
                          <><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 3.5A2.5 2.5 0 1112.5 6L9 9.5m-2 3A2.5 2.5 0 113.5 10l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> Share</>
                        )}
                      </button>
                      {(session?.role === "admin" || plan.creator_email === session?.email) && (
                        <button
                          onClick={() => deletePlan(plan.id, plan.name)}
                          className="p-1.5 text-coal/30 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          aria-label="Delete plan"
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "audit" && session?.role === "admin" && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-coal/50 uppercase tracking-wide">Time</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-coal/50 uppercase tracking-wide">User</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-coal/50 uppercase tracking-wide">Action</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-coal/50 uppercase tracking-wide">Resource</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {audit.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-coal/40 text-sm">No audit entries yet.</td></tr>
                  ) : (
                    audit.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 text-xs text-coal/50 whitespace-nowrap">
                          {new Date(entry.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-coal">{entry.user_name ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className="font-medium text-coal">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-coal/60">{entry.resource_name ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
