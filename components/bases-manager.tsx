"use client";

import { useState } from "react";
import { SalesBase, SALES_BASES } from "@/lib/appt-scheduler";

function newId() { return Math.random().toString(36).slice(2, 9); }

async function geocodeOne(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=gb`,
      { headers: { "User-Agent": "CRSmith-RoutePlanner/1.0" } }
    );
    if (!res.ok) return null;
    const results = await res.json() as Array<{ lat: string; lon: string }>;
    if (!results[0]) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch { return null; }
}

export default function BasesManager({
  bases,
  onChange,
  onBack,
}: {
  bases: SalesBase[];
  onChange: (bases: SalesBase[]) => void;
  onBack?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<SalesBase>>({});
  const [geocoding, setGeocoding] = useState(false);

  const inputCls =
    "w-full px-3 py-2 text-sm bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all";

  function startEdit(base: SalesBase) {
    setForm({ ...base });
    setEditingId(base.id);
  }

  function startNew() {
    const id = newId();
    setForm({ id, name: "", address: "" });
    setEditingId(id);
  }

  async function saveBase() {
    if (!form.name?.trim() || !form.address?.trim()) return;
    let lat = form.lat, lng = form.lng;
    const existing = bases.find((b) => b.id === form.id);
    if (!lat || !lng || existing?.address !== form.address) {
      setGeocoding(true);
      const geo = await geocodeOne(form.address!);
      setGeocoding(false);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }
    const base: SalesBase = {
      id: form.id ?? newId(),
      name: form.name!,
      address: form.address!,
      lat,
      lng,
    };
    const exists = bases.find((b) => b.id === base.id);
    onChange(exists ? bases.map((b) => (b.id === base.id ? base : b)) : [...bases, base]);
    setEditingId(null);
    setForm({});
  }

  function deleteBase(id: string) {
    onChange(bases.filter((b) => b.id !== id));
    if (editingId === id) { setEditingId(null); setForm({}); }
  }

  return (
    <div className="flex flex-col h-full">
      {onBack && (
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="p-1.5 rounded-md text-coal/50 hover:text-coal hover:bg-gray-100 transition-colors"
              aria-label="Back"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <h2 className="text-sm font-semibold text-coal">Sales Bases</h2>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {bases.length === 0 && editingId === null && (
          <p className="text-sm text-coal/50 text-center py-6">No bases configured.</p>
        )}

        {bases.map((base) => (
          <div key={base.id} className="border border-gray-200 rounded-lg overflow-hidden">
            {editingId === base.id ? (
              <div className="p-3 space-y-2.5 bg-snow/50">
                <input
                  className={inputCls}
                  placeholder="Base name (e.g. Glasgow)"
                  value={form.name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                <input
                  className={inputCls}
                  placeholder="Address / postcode"
                  value={form.address ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
                {form.lat && form.lng && (
                  <p className="text-xs text-green-600">
                    ✓ Geocoded: {form.lat.toFixed(4)}, {form.lng.toFixed(4)}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveBase}
                    disabled={geocoding}
                    className="flex-1 py-2 bg-loch text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-loch/90 transition-colors"
                  >
                    {geocoding ? "Geocoding…" : "Save"}
                  </button>
                  <button
                    onClick={() => { setEditingId(null); setForm({}); }}
                    className="px-4 py-2 text-sm text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-coal">{base.name}</p>
                  <p className="text-xs text-coal/50 truncate">{base.address}</p>
                  {base.lat && base.lng ? (
                    <p className="text-xs text-green-600 mt-0.5">✓ Geocoded</p>
                  ) : (
                    <p className="text-xs text-amber-600 mt-0.5">⚠ Not geocoded — save to fix</p>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => startEdit(base)}
                    className="p-1.5 text-coal/40 hover:text-loch hover:bg-snow rounded transition-colors"
                    aria-label="Edit"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteBase(base.id)}
                    className="p-1.5 text-coal/40 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    aria-label="Delete"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d="M3 4h10M6 4V2h4v2M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {editingId !== null && !bases.find((b) => b.id === editingId) && (
          <div className="border border-loch/20 rounded-lg overflow-hidden">
            <div className="p-3 space-y-2.5 bg-snow/50">
              <input
                className={inputCls}
                placeholder="Base name (e.g. Edinburgh)"
                value={form.name ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                className={inputCls}
                placeholder="Address / postcode"
                value={form.address ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
              <div className="flex gap-2 pt-1">
                <button
                  onClick={saveBase}
                  disabled={geocoding}
                  className="flex-1 py-2 bg-loch text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-loch/90 transition-colors"
                >
                  {geocoding ? "Geocoding…" : "Save"}
                </button>
                <button
                  onClick={() => { setEditingId(null); setForm({}); }}
                  className="px-4 py-2 text-sm text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={startNew}
          className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-loch/20 rounded-lg text-sm text-loch/70 hover:text-loch hover:border-loch/40 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Add Base
        </button>

        <div className="pt-1">
          <button
            onClick={() => { onChange([...SALES_BASES]); setEditingId(null); setForm({}); }}
            className="w-full py-2 text-xs text-coal/40 hover:text-coal/60 transition-colors"
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}
