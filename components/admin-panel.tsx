"use client";

import { useState, useEffect, useCallback } from "react";

interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  tabs: string[];
  is_active: boolean;
  created_at: string;
}

type UserForm = {
  name: string;
  email: string;
  password: string;
  role: "admin" | "editor" | "viewer";
  tabs: string[];
};

const DEFAULT_FORM: UserForm = { name: "", email: "", password: "", role: "editor", tabs: ["appointments", "canvass"] };

const TAB_OPTIONS = [
  { value: "appointments", label: "Appointments" },
  { value: "canvass", label: "Canvass" },
];

const ROLE_COLOUR: Record<string, string> = {
  admin:  "bg-green-100 text-green-800",
  editor: "bg-blue-100 text-blue-800",
  viewer: "bg-gray-100 text-gray-700",
};

interface AdminPanelProps {
  onClose: () => void;
}

export default function AdminPanel({ onClose }: AdminPanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<UserForm>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) setUsers(await res.json() as User[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  function startEdit(user: User) {
    setEditingId(user.id);
    setForm({ name: user.name, email: user.email, password: "", role: user.role, tabs: user.tabs ?? [] });
    setError("");
  }

  function startNew() {
    setEditingId("new");
    setForm(DEFAULT_FORM);
    setError("");
  }

  function toggleTab(tab: string) {
    setForm((f) => ({
      ...f,
      tabs: f.tabs.includes(tab) ? f.tabs.filter((t) => t !== tab) : [...f.tabs, tab],
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = { name: form.name, email: form.email, role: form.role, tabs: form.tabs };
      if (form.password) body.password = form.password;

      const isNew = editingId === "new";
      if (isNew && !form.password) { setError("Password is required for new users"); return; }

      const res = await fetch(
        isNew ? "/api/users" : `/api/users/${editingId}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (res.ok) {
        await fetchUsers();
        setEditingId(null);
      } else {
        const d = await res.json() as { error?: string };
        setError(d.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(user: User) {
    if (!confirm(`${user.is_active ? "Deactivate" : "Reactivate"} ${user.name}?`)) return;
    await fetch(`/api/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !user.is_active }),
    });
    await fetchUsers();
  }

  const inputCls = "w-full px-3 py-2 text-sm bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all";

  return (
    <div className="fixed inset-0 z-[300] flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-md bg-white shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-coal">Manage Users</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={startNew}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-loch/70 hover:text-loch hover:bg-gray-100 transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              Add User
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md text-coal/50 hover:text-coal hover:bg-gray-100 transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Add / Edit form */}
          {editingId !== null && (
            <div className="border border-loch/20 rounded-xl overflow-hidden bg-snow/30">
              <div className="px-4 py-3 border-b border-loch/10 bg-snow/60">
                <p className="text-xs font-semibold text-coal">{editingId === "new" ? "New User" : "Edit User"}</p>
              </div>
              <div className="p-4 space-y-3">
                <input className={inputCls} placeholder="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                <input className={inputCls} placeholder="Email address" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                <input className={inputCls} placeholder={editingId === "new" ? "Password" : "New password (leave blank to keep)"} type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />

                <div>
                  <p className="text-xs text-coal/50 mb-1.5">Role</p>
                  <div className="flex gap-2">
                    {(["admin", "editor", "viewer"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, role: r }))}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${form.role === r ? "bg-loch text-white" : "border border-gray-200 text-coal/50 hover:text-coal"}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {form.role === "editor" && (
                  <div>
                    <p className="text-xs text-coal/50 mb-1.5">Tab access</p>
                    <div className="flex gap-2">
                      {TAB_OPTIONS.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => toggleTab(t.value)}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${form.tabs.includes(t.value) ? "bg-saltire/10 text-saltire border border-saltire/20" : "border border-gray-200 text-coal/40 hover:text-coal"}`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={save}
                    disabled={saving || !form.name || !form.email}
                    className="flex-1 py-2 bg-loch text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-loch/90 transition-colors"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-4 py-2 text-sm text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* User list */}
          {loading ? (
            <div className="text-sm text-coal/40 text-center py-8">Loading…</div>
          ) : users.length === 0 ? (
            <div className="text-sm text-coal/40 text-center py-8">No users yet.</div>
          ) : (
            users.map((user) => (
              <div key={user.id} className={`border rounded-xl p-3.5 ${user.is_active ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-60"}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-loch/10 text-loch flex items-center justify-center text-xs font-bold">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-coal">{user.name}</p>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${ROLE_COLOUR[user.role]}`}>{user.role}</span>
                      {!user.is_active && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 uppercase">inactive</span>}
                    </div>
                    <p className="text-xs text-coal/50 truncate">{user.email}</p>
                    {user.role === "editor" && user.tabs?.length > 0 && (
                      <p className="text-xs text-coal/40 mt-0.5">{user.tabs.join(", ")}</p>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(user)} className="p-1.5 text-coal/40 hover:text-loch hover:bg-snow rounded transition-colors" aria-label="Edit">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <button onClick={() => deactivate(user)} className={`p-1.5 rounded transition-colors ${user.is_active ? "text-coal/40 hover:text-red-500 hover:bg-red-50" : "text-green-600 hover:bg-green-50"}`} aria-label={user.is_active ? "Deactivate" : "Reactivate"}>
                      {user.is_active ? (
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1v7M8 12.5v.5M12 3.5A7 7 0 114 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 8l3 3 3-3M8 4v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
