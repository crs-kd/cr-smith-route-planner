"use client";

import { useState } from "react";

interface SavePlanModalProps {
  type: "appointments" | "canvass";
  onSave: (name: string, notes: string, visibility: "private" | "shared" | "link") => Promise<{ id: string } | null>;
  onClose: () => void;
}

export default function SavePlanModal({ type, onSave, onClose }: SavePlanModalProps) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<"private" | "shared" | "link">("private");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const inputCls = "w-full px-3 py-2.5 text-sm bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all";

  async function handleSave() {
    if (!name.trim()) { setError("Please enter a plan name"); return; }
    setSaving(true);
    setError("");
    try {
      const result = await onSave(name.trim(), notes.trim(), visibility);
      if (!result) { setError("Failed to save plan"); return; }

      // If link visibility, generate share URL
      if (visibility === "link") {
        const res = await fetch(`/api/plans/${result.id}/share`, { method: "POST" });
        if (res.ok) {
          const data = await res.json() as { token: string };
          // Build absolute URL on the client so it's always correct
          setShareUrl(`${window.location.origin}/share/${data.token}`);
          return; // Stay open to show the URL
        }
        // Share endpoint failed — plan is saved but without a share link
        setError("Plan saved, but the share link couldn't be generated. You can create it from the Plans page.");
        return;
      }

      onClose();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  }

  const typeLabel = type === "appointments" ? "Appointments" : "Canvass";
  const typeBadge = type === "appointments" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800";

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-coal">Save Plan</h2>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide mt-1 inline-block ${typeBadge}`}>
                {typeLabel}
              </span>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-coal/40 hover:text-coal hover:bg-gray-100 transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        {shareUrl ? (
          /* Share URL screen */
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2.5">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
              <span className="text-sm font-medium">Plan saved!</span>
            </div>
            <div>
              <p className="text-xs font-medium text-coal/60 mb-1.5">Share link</p>
              <div className="flex gap-2">
                <input readOnly value={shareUrl} className="flex-1 px-3 py-2 text-xs text-coal bg-gray-50 border border-gray-200 rounded-lg font-mono truncate" />
                <button
                  onClick={() => navigator.clipboard.writeText(shareUrl)}
                  className="px-3 py-2 text-xs font-medium text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-coal/40 mt-1.5">Anyone with this link can view the plan without logging in.</p>
            </div>
            <button onClick={onClose} className="w-full py-2 bg-loch text-white text-sm font-medium rounded-lg hover:bg-loch/90 transition-colors">Done</button>
          </div>
        ) : (
          /* Save form */
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-coal/60 mb-1.5">Plan name <span className="text-red-500">*</span></label>
              <input
                className={inputCls}
                placeholder={`e.g. ${typeLabel} – Week 24`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-coal/60 mb-1.5">Notes <span className="text-coal/30">(optional)</span></label>
              <textarea
                className={inputCls + " resize-none"}
                placeholder="Any notes about this plan…"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div>
              <p className="text-xs font-medium text-coal/60 mb-2">Visibility</p>
              <div className="space-y-2">
                {[
                  { value: "private", label: "Private", desc: "Only you and admins can see this" },
                  { value: "shared", label: "Shared", desc: "All logged-in users can view" },
                  { value: "link", label: "Share link", desc: "Anyone with the link can view (no login needed)" },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-50" style={{ borderColor: visibility === opt.value ? "rgb(var(--color-loch) / 0.4)" : "rgb(229 231 235)" }}>
                    <input
                      type="radio"
                      name="visibility"
                      value={opt.value}
                      checked={visibility === opt.value}
                      onChange={() => setVisibility(opt.value as typeof visibility)}
                      className="accent-loch mt-0.5 flex-shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-coal">{opt.label}</p>
                      <p className="text-xs text-coal/50">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="flex-1 py-2.5 bg-loch text-white text-sm font-semibold rounded-lg disabled:opacity-50 hover:bg-loch/90 transition-colors"
              >
                {saving ? "Saving…" : "Save Plan"}
              </button>
              <button onClick={onClose} className="px-4 py-2.5 text-sm text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
