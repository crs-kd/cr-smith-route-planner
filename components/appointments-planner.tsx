"use client";

import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocalStorage } from "@/lib/use-local-storage";
import {
  Rep,
  SalesBase,
  ApptInput,
  ApptTag,
  APPT_TAGS,
  APPT_TAG_LABELS,
  ScheduleResult,
  Assignment,
  ConflictStatus,
  SALES_BASES,
  SalesBaseId,
  scheduleAppointments,
  recalculateSchedules,
  buildLocationMatrix,
  getRepStartLoc,
  getRepEndLoc,
  getRepBaseId,
  migrateRep,
  parseHHMM,
  minsToDisplay,
  normaliseHHMM,
  formatDurationSec,
} from "@/lib/appt-scheduler";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoutePreviewData {
  anchor: { address: string; lat: number; lng: number };
  stops: { id: number; lat: number; lng: number; addresses: { address: string }[] }[];
  geometry: [number, number][] | null;
}

interface AppointmentsPlannerProps {
  onRoutePreview: (data: RoutePreviewData | null) => void;
}

type Phase = "idle" | "geocoding" | "matrix" | "scheduling" | "done" | "error";

interface CustomTag { id: string; label: string; }

const defaultCustomTags: CustomTag[] = [
  { id: "door", label: "Door" },
  { id: "8_units", label: "8+ Units" },
  { id: "14_units", label: "14+ Units" },
];

const CustomTagsContext = createContext<CustomTag[]>(defaultCustomTags);

function useCustomTags() { return useContext(CustomTagsContext); }
function getTagLabel(id: string, tags: CustomTag[]): string {
  return tags.find(t => t.id === id)?.label ?? id;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newId() { return Math.random().toString(36).slice(2, 9); }

function toDisplayTime(hhmm: string): string {
  const s = (hhmm ?? "").replace(":", "").trim();
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2)}`;
  return s;
}

const STATUS_COLOUR: Record<ConflictStatus, string> = {
  ok:               "text-green-600",
  buffered:         "text-amber-500",
  infeasible_travel:"text-red-600",
  double_booking:   "text-red-600",
};

const STATUS_BG: Record<ConflictStatus, string> = {
  ok:               "",
  buffered:         "bg-amber-50 border-l-2 border-l-amber-400",
  infeasible_travel:"bg-red-50 border-l-2 border-l-red-500",
  double_booking:   "bg-red-50 border-l-2 border-l-red-500",
};

function conflictLabel(s: ConflictStatus): string | null {
  if (s === "buffered")          return "⚠ Within 15-min buffer";
  if (s === "infeasible_travel") return "✕ Insufficient travel time";
  if (s === "double_booking")    return "✕ Double booking";
  return null;
}

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

// ── Tags Manager ─────────────────────────────────────────────────────────────

function TagsManager({
  customTags, onTagsChange, onRemoveTag, onBack,
}: {
  customTags: CustomTag[];
  onTagsChange: (tags: CustomTag[]) => void;
  onRemoveTag: (tagId: string) => void;
  onBack: () => void;
}) {
  const [newLabel, setNewLabel] = useState("");

  function addTag() {
    const label = newLabel.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!id || customTags.some(t => t.id === id)) return;
    onTagsChange([...customTags, { id, label }]);
    setNewLabel("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="p-1.5 rounded-md text-coal/50 hover:text-coal hover:bg-gray-100 transition-colors" aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <h2 className="text-sm font-semibold text-coal">Tags</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-2">
        {customTags.map(tag => (
          <div key={tag.id} className="flex items-center justify-between px-3 py-2 bg-white border border-gray-200 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium px-2 py-1 rounded bg-saltire text-white leading-none">{tag.label}</span>
              <span className="text-xs text-coal/50 font-mono">{tag.id}</span>
            </div>
            <button
              onClick={() => onRemoveTag(tag.id)}
              className="p-1.5 text-coal/30 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
              aria-label={`Remove ${tag.label}`}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            placeholder="New tag label (e.g. 6+ Units)"
            className="flex-1 px-3 py-2 text-sm bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all"
          />
          <button
            onClick={addTag}
            className="px-3 py-2 bg-loch text-white text-sm font-medium rounded-lg hover:bg-loch/90 transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bases Manager ─────────────────────────────────────────────────────────────

function BasesManager({
  bases, onChange, onBack,
}: {
  bases: SalesBase[];
  onChange: (bases: SalesBase[]) => void;
  onBack: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<SalesBase>>({});
  const [geocoding, setGeocoding] = useState(false);

  const inputCls = "w-full px-3 py-2 text-sm bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all";

  function startEdit(base: SalesBase) { setForm({ ...base }); setEditingId(base.id); }
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
    const base: SalesBase = { id: form.id ?? newId(), name: form.name!, address: form.address!, lat, lng };
    const exists = bases.find((b) => b.id === base.id);
    onChange(exists ? bases.map((b) => (b.id === base.id ? base : b)) : [...bases, base]);
    setEditingId(null); setForm({});
  }

  function deleteBase(id: string) {
    onChange(bases.filter((b) => b.id !== id));
    if (editingId === id) { setEditingId(null); setForm({}); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-1.5 rounded-md text-coal/50 hover:text-coal hover:bg-gray-100 transition-colors" aria-label="Back to reps">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <h2 className="text-sm font-semibold text-coal">Sales Bases</h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {bases.length === 0 && editingId === null && (
          <p className="text-sm text-coal/50 text-center py-6">No bases configured.</p>
        )}

        {bases.map((base) => (
          <div key={base.id} className="border border-gray-200 rounded-lg overflow-hidden">
            {editingId === base.id ? (
              <div className="p-3 space-y-2.5 bg-snow/50">
                <input className={inputCls} placeholder="Base name (e.g. Glasgow)" value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                <input className={inputCls} placeholder="Address / postcode" value={form.address ?? ""} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                {form.lat && form.lng && (
                  <p className="text-xs text-green-600">✓ Geocoded: {form.lat.toFixed(4)}, {form.lng.toFixed(4)}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <button onClick={saveBase} disabled={geocoding} className="flex-1 py-2 bg-loch text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-loch/90 transition-colors">
                    {geocoding ? "Geocoding…" : "Save"}
                  </button>
                  <button onClick={() => { setEditingId(null); setForm({}); }} className="px-4 py-2 text-sm text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-coal">{base.name}</p>
                  <p className="text-xs text-coal/50 truncate">{base.address}</p>
                  {base.lat && base.lng
                    ? <p className="text-xs text-green-600 mt-0.5">✓ Geocoded</p>
                    : <p className="text-xs text-amber-600 mt-0.5">⚠ Not geocoded — save to fix</p>
                  }
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(base)} className="p-1.5 text-coal/40 hover:text-loch hover:bg-snow rounded transition-colors" aria-label="Edit">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button onClick={() => deleteBase(base.id)} className="p-1.5 text-coal/40 hover:text-red-500 hover:bg-red-50 rounded transition-colors" aria-label="Delete">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {editingId !== null && !bases.find((b) => b.id === editingId) && (
          <div className="border border-loch/20 rounded-lg overflow-hidden">
            <div className="p-3 space-y-2.5 bg-snow/50">
              <input className={inputCls} placeholder="Base name (e.g. Edinburgh)" value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <input className={inputCls} placeholder="Address / postcode" value={form.address ?? ""} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              <div className="flex gap-2 pt-1">
                <button onClick={saveBase} disabled={geocoding} className="flex-1 py-2 bg-loch text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-loch/90 transition-colors">
                  {geocoding ? "Geocoding…" : "Save"}
                </button>
                <button onClick={() => { setEditingId(null); setForm({}); }} className="px-4 py-2 text-sm text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <button onClick={startNew} className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-loch/20 rounded-lg text-sm text-loch/70 hover:text-loch hover:border-loch/40 transition-colors">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
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

// ── Grip handle icon ──────────────────────────────────────────────────────────

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="4" cy="2.5" r="1" /><circle cx="8" cy="2.5" r="1" />
      <circle cx="4" cy="6"   r="1" /><circle cx="8" cy="6"   r="1" />
      <circle cx="4" cy="9.5" r="1" /><circle cx="8" cy="9.5" r="1" />
    </svg>
  );
}

// ── Rep edit form (shared) ─────────────────────────────────────────────────────

function RepEditForm({
  form, setForm, onSave, onCancel, geocoding, bases,
}: {
  form: Partial<Rep>;
  setForm: (fn: (f: Partial<Rep>) => Partial<Rep>) => void;
  onSave: () => void;
  onCancel: () => void;
  geocoding: boolean;
  bases: SalesBase[];
}) {
  const inputCls = "w-full px-3 py-2 text-sm bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all";
  const customTags = useCustomTags();
  return (
    <div className="p-3 space-y-2.5 bg-snow/50">
      <input className={inputCls} placeholder="Full name" value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      <input className={inputCls} placeholder="Home address / postcode" value={form.homeAddress ?? ""} onChange={(e) => setForm((f) => ({ ...f, homeAddress: e.target.value }))} />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs text-coal/50 mb-1">Start time</p>
          <input className={inputCls + " font-mono text-center"} placeholder="09:00" maxLength={5}
            value={toDisplayTime(form.startTime ?? "")}
            onChange={(e) => setForm((f) => ({ ...f, startTime: normaliseHHMM(e.target.value) }))} />
          <p className="text-[10px] text-coal/40 mt-0.5">00:00 = any</p>
        </div>
        <div>
          <p className="text-xs text-coal/50 mb-1">End time</p>
          <input className={inputCls + " font-mono text-center"} placeholder="18:00" maxLength={5}
            value={toDisplayTime(form.endTime ?? "")}
            onChange={(e) => setForm((f) => ({ ...f, endTime: normaliseHHMM(e.target.value) }))} />
          <p className="text-[10px] text-coal/40 mt-0.5">00:00 = any</p>
        </div>
        <div>
          <p className="text-xs text-coal/50 mb-1">Max appts</p>
          <input type="number" min={1} max={20} className={inputCls + " text-center"} value={form.maxAppointments ?? 3}
            onChange={(e) => setForm((f) => ({ ...f, maxAppointments: Math.max(1, parseInt(e.target.value) || 1) }))} />
        </div>
      </div>
      <div>
        <p className="text-xs text-coal/50 mb-1">Starts from</p>
        <div className="flex gap-2">
          <select className={inputCls} value={form.startLocation ?? "home"}
            onChange={(e) => setForm((f) => ({ ...f, startLocation: e.target.value as "home" | "base" }))}>
            <option value="home">Home</option>
            <option value="base">Sales Base</option>
          </select>
          {form.startLocation === "base" && (
            <select className={inputCls} value={form.startBaseId ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, startBaseId: e.target.value as SalesBaseId }))}>
              <option value="">Select base…</option>
              {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </div>
      <div>
        <p className="text-xs text-coal/50 mb-1">Ends at</p>
        <div className="flex gap-2">
          <select className={inputCls} value={form.endLocation ?? "home"}
            onChange={(e) => setForm((f) => ({ ...f, endLocation: e.target.value as "home" | "base" }))}>
            <option value="home">Home</option>
            <option value="base">Sales Base</option>
          </select>
          {form.endLocation === "base" && (
            <select className={inputCls} value={form.endBaseId ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, endBaseId: e.target.value as SalesBaseId }))}>
              <option value="">Select base…</option>
              {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.isWorking ?? true} onChange={(e) => setForm((f) => ({ ...f, isWorking: e.target.checked }))} className="accent-loch" />
        <span className="text-xs text-coal/70">Working today</span>
      </label>
      <div>
        <p className="text-xs text-coal/50 mb-1">Specialisms</p>
        <div className="flex flex-wrap gap-1.5">
          {customTags.map((ct) => {
            const active = (form.tags ?? []).includes(ct.id as ApptTag);
            return (
              <button
                key={ct.id}
                type="button"
                onClick={() => setForm((f) => {
                  const current = f.tags ?? [];
                  const next = current.includes(ct.id as ApptTag) ? current.filter((t) => t !== ct.id) : [...current, ct.id as ApptTag];
                  return { ...f, tags: next };
                })}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  active
                    ? "bg-saltire text-white"
                    : "border border-gray-300 text-coal/50 hover:text-coal/80 hover:border-coal/40"
                }`}
              >
                {ct.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={geocoding} className="flex-1 py-2 bg-loch text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-loch/90 transition-colors">
          {geocoding ? "Geocoding…" : "Save"}
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-sm text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Sortable rep card ─────────────────────────────────────────────────────────

function SortableRepCard({
  rep, bases, editingId, form, setForm, geocoding, isFirst, isLast,
  onToggleWorking, onStartEdit, onDelete, onSave, onCancel, onMoveUp, onMoveDown, onUpdateRepTags,
}: {
  rep: Rep;
  bases: SalesBase[];
  editingId: string | null;
  form: Partial<Rep>;
  setForm: (fn: (f: Partial<Rep>) => Partial<Rep>) => void;
  geocoding: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggleWorking: (id: string) => void;
  onStartEdit: (rep: Rep) => void;
  onDelete: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onUpdateRepTags: (repId: string, tag: ApptTag) => void;
}) {
  const customTags = useCustomTags();
  const isEditing = editingId === rep.id;
  const editFormRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isEditing && editFormRef.current) {
      editFormRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isEditing]);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rep.id,
    disabled: isEditing,
    data: { type: "rep" },
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const arrowCls = "p-1 rounded transition-colors";
  const arrowActive = "text-coal/40 hover:text-coal hover:bg-gray-100";
  const arrowDisabled = "text-coal/15 cursor-not-allowed";

  return (
    <div ref={setNodeRef} style={style} className="border border-blue-200 rounded-lg overflow-hidden bg-blue-50">
      {isEditing ? (
        <div ref={editFormRef} className="bg-white">
        <RepEditForm form={form} setForm={setForm} onSave={onSave} onCancel={onCancel} geocoding={geocoding} bases={bases} />
        </div>
      ) : (
        <div className="flex items-start gap-2 p-3">
          {/* Grip + arrows stacked */}
          <div className="flex-shrink-0 flex flex-col items-center gap-0.5 mt-0.5">
            <button
              disabled={isFirst}
              onClick={() => onMoveUp(rep.id)}
              className={`${arrowCls} ${isFirst ? arrowDisabled : arrowActive}`}
              aria-label="Move up"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 10l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button {...attributes} {...listeners} className="p-1 text-coal/20 hover:text-coal/50 cursor-grab active:cursor-grabbing touch-none" aria-label="Drag to reorder">
              <GripIcon />
            </button>
            <button
              disabled={isLast}
              onClick={() => onMoveDown(rep.id)}
              className={`${arrowCls} ${isLast ? arrowDisabled : arrowActive}`}
              aria-label="Move down"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          <button
            onClick={() => onToggleWorking(rep.id)}
            className={`flex-shrink-0 mt-0.5 w-8 rounded-full transition-colors p-0.5 ${rep.isWorking ? "bg-loch" : "bg-gray-300"}`}
            style={{ height: "18px" }}
            title={rep.isWorking ? "Working" : "Not working"}
          >
            <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${rep.isWorking ? "translate-x-3" : "translate-x-0"}`} />
          </button>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${rep.isWorking ? "text-coal" : "text-coal/40"}`}>{rep.name}</p>
            <p className="text-xs text-coal/50 truncate">{rep.homeAddress}</p>
            {!rep.homeLat && <p className="text-xs text-amber-600 mt-0.5">⚠ Address not geocoded</p>}
            <div className="flex gap-2 mt-1 flex-wrap text-xs text-coal/50">
              <span className="font-mono">
                {normaliseHHMM(rep.startTime) === "0000" ? "Any start" : toDisplayTime(rep.startTime)}
                {" – "}
                {normaliseHHMM(rep.endTime) === "0000" ? "any end" : toDisplayTime(rep.endTime)}
              </span>
              <span>·</span>
              <span>{rep.maxAppointments} appt{rep.maxAppointments === 1 ? "" : "s"}</span>
              {rep.startLocation === "base" && rep.startBaseId && (
                <><span>·</span><span>Start: {bases.find(b => b.id === rep.startBaseId)?.name ?? rep.startBaseId}</span></>
              )}
              {rep.endLocation === "base" && rep.endBaseId && (
                <><span>·</span><span>End: {bases.find(b => b.id === rep.endBaseId)?.name ?? rep.endBaseId}</span></>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <div className="flex gap-1">
              <button onClick={() => onStartEdit(rep)} className="p-1.5 text-coal/40 hover:text-loch hover:bg-snow rounded transition-colors" aria-label="Edit">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button onClick={() => onDelete(rep.id)} className="p-1.5 text-coal/40 hover:text-red-500 hover:bg-red-50 rounded transition-colors" aria-label="Delete">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <div className="flex gap-1 flex-wrap justify-end">
              {(rep.tags ?? []).map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded bg-saltire text-white leading-none">
                  {getTagLabel(tag, customTags)}
                  <button
                    onClick={() => onUpdateRepTags(rep.id, tag)}
                    className="hover:opacity-70 transition-opacity leading-none"
                    aria-label={`Remove ${getTagLabel(tag, customTags)}`}
                  >
                    <svg width="7" height="7" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
                  </button>
                </span>
              ))}
              {(rep.tags ?? []).length < customTags.length && (
                <span className="relative inline-block">
                  <button className="text-coal/30 hover:text-saltire transition-colors text-base font-light leading-none" aria-label="Add tag">+</button>
                  <select
                    value=""
                    onChange={(e) => onUpdateRepTags(rep.id, e.target.value as ApptTag)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full"
                    aria-label="Select tag"
                  >
                    <option value="" disabled>Select tag</option>
                    {customTags.filter(ct => !(rep.tags ?? []).includes(ct.id as ApptTag)).map(ct => (
                      <option key={ct.id} value={ct.id}>{ct.label}</option>
                    ))}
                  </select>
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sortable group ────────────────────────────────────────────────────────────

function SortableGroup({
  baseId, baseName, groupReps, bases, editingId, form, setForm, geocoding,
  isFirst, isLast,
  onToggleWorking, onStartEdit, onDelete, onSave, onCancel,
  onMoveGroupUp, onMoveGroupDown, onMoveRepUp, onMoveRepDown, onUpdateRepTags,
}: {
  baseId: string;
  baseName: string;
  groupReps: Rep[];
  bases: SalesBase[];
  editingId: string | null;
  form: Partial<Rep>;
  setForm: (fn: (f: Partial<Rep>) => Partial<Rep>) => void;
  geocoding: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggleWorking: (id: string) => void;
  onStartEdit: (rep: Rep) => void;
  onDelete: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onMoveGroupUp: (baseId: string) => void;
  onMoveGroupDown: (baseId: string) => void;
  onMoveRepUp: (repId: string) => void;
  onMoveRepDown: (repId: string) => void;
  onUpdateRepTags: (repId: string, tag: ApptTag) => void;
}) {
  const isNewRepInThisGroup = editingId !== null && !groupReps.find(r => r.id === editingId) &&
    form.id === editingId && (form as { _groupId?: string })._groupId === baseId;

  const addFormRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isNewRepInThisGroup && addFormRef.current) {
      addFormRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isNewRepInThisGroup]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `group-${baseId}`,
    data: { type: "group" },
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const arrowCls = "p-1 rounded transition-colors";
  const arrowActive = "text-coal/40 hover:text-coal hover:bg-gray-200";
  const arrowDisabled = "text-coal/15 cursor-not-allowed";

  return (
    <div ref={setNodeRef} style={style} className="rounded-xl border border-gray-200 overflow-hidden">
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
        <button {...attributes} {...listeners} className="p-1 text-coal/25 hover:text-coal/50 cursor-grab active:cursor-grabbing touch-none flex-shrink-0" aria-label="Drag group">
          <GripIcon />
        </button>
        <p className="flex-1 text-xs font-semibold text-coal/60 uppercase tracking-wider">{baseName}</p>
        <span className="text-xs text-coal/40 mr-1">{groupReps.length} rep{groupReps.length === 1 ? "" : "s"}</span>
        <button
          disabled={isFirst}
          onClick={() => onMoveGroupUp(baseId)}
          className={`${arrowCls} ${isFirst ? arrowDisabled : arrowActive}`}
          aria-label="Move group up"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 10l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button
          disabled={isLast}
          onClick={() => onMoveGroupDown(baseId)}
          className={`${arrowCls} ${isLast ? arrowDisabled : arrowActive}`}
          aria-label="Move group down"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      {/* Reps */}
      <div className="p-2 space-y-2">
        <SortableContext items={groupReps.map(r => r.id)} strategy={verticalListSortingStrategy}>
          {groupReps.map((rep, idx) => (
            <SortableRepCard
              key={rep.id} rep={rep} bases={bases}
              editingId={editingId} form={form} setForm={setForm} geocoding={geocoding}
              isFirst={idx === 0} isLast={idx === groupReps.length - 1}
              onToggleWorking={onToggleWorking} onStartEdit={onStartEdit}
              onDelete={onDelete} onSave={onSave} onCancel={onCancel}
              onMoveUp={onMoveRepUp} onMoveDown={onMoveRepDown}
              onUpdateRepTags={onUpdateRepTags}
            />
          ))}
        </SortableContext>

        {/* New rep form for this group */}
        {isNewRepInThisGroup && (
          <div ref={addFormRef} className="border border-loch/20 rounded-lg overflow-hidden bg-white">
            <RepEditForm form={form} setForm={setForm} onSave={onSave} onCancel={onCancel} geocoding={geocoding} bases={bases} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Rep Manager ───────────────────────────────────────────────────────────────

function RepManager({
  reps, bases, onChange, onBasesChange, onClose, customTags, onTagsChange, onRemoveTag,
}: {
  reps: Rep[];
  bases: SalesBase[];
  onChange: (reps: Rep[]) => void;
  onBasesChange: (bases: SalesBase[]) => void;
  onClose: () => void;
  customTags: CustomTag[];
  onTagsChange: (tags: CustomTag[]) => void;
  onRemoveTag: (tagId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Rep>>({});
  const [geocoding, setGeocoding] = useState(false);
  const [showSettings, setShowSettings] = useState<"bases" | "tags" | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  // Group order: array of baseIds (+ "unassigned"). Initialized from bases order.
  const [groupOrder, setGroupOrder] = useState<string[]>(() =>
    [...bases.map(b => b.id), "unassigned"]
  );
  // Keep groupOrder in sync when bases change (new bases added etc.)
  const allGroupIds = [...bases.map(b => b.id), "unassigned"];
  const syncedGroupOrder = [
    ...groupOrder.filter(id => allGroupIds.includes(id)),
    ...allGroupIds.filter(id => !groupOrder.includes(id)),
  ];

  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Build groups from reps + bases
  const groups = syncedGroupOrder.map(baseId => {
    const base = bases.find(b => b.id === baseId);
    const baseName = baseId === "unassigned" ? "Unassigned" : (base?.name ?? baseId);
    const groupReps = reps.filter(r => getRepBaseId(r, bases) === baseId);
    return { baseId, baseName, groupReps };
  }).filter(g => {
    if (g.groupReps.length > 0) return true;
    if (g.baseId !== "unassigned") return true; // always show named bases
    // show unassigned group if a new rep is being added there
    return editingId !== null && (form as { _groupId?: string })._groupId === "unassigned";
  });

  // When a new rep is being added to "unassigned", float that group to the top
  const pendingGroupId = editingId !== null ? (form as { _groupId?: string })._groupId : null;
  const displayGroups = pendingGroupId === "unassigned"
    ? [...groups.filter(g => g.baseId === "unassigned"), ...groups.filter(g => g.baseId !== "unassigned")]
    : groups;

  function startEdit(rep: Rep) { setForm({ ...rep }); setEditingId(rep.id); }

  async function saveRep() {
    if (!form.name?.trim() || !form.homeAddress?.trim()) return;
    let lat = form.homeLat, lng = form.homeLng;
    const existing = reps.find((r) => r.id === form.id);
    if (!lat || !lng || existing?.homeAddress !== form.homeAddress) {
      setGeocoding(true);
      const geo = await geocodeOne(form.homeAddress!);
      setGeocoding(false);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }
    const rep: Rep = {
      id: form.id ?? newId(),
      name: form.name!,
      homeAddress: form.homeAddress!,
      homeLat: lat, homeLng: lng,
      startTime: normaliseHHMM(form.startTime ?? "0000") || "0000",
      endTime:   normaliseHHMM(form.endTime   ?? "0000") || "0000",
      maxAppointments: form.maxAppointments ?? 3,
      startLocation: form.startLocation ?? "home",
      startBaseId: form.startBaseId,
      endLocation: form.endLocation ?? "home",
      endBaseId: form.endBaseId,
      isWorking: form.isWorking ?? true,
      tags: form.tags ?? [],
    };
    const exists = reps.find((r) => r.id === rep.id);
    onChange(exists ? reps.map((r) => (r.id === rep.id ? rep : r)) : [...reps, rep]);
    setEditingId(null); setForm({});
  }

  function deleteRep(id: string) {
    onChange(reps.filter((r) => r.id !== id));
    if (editingId === id) { setEditingId(null); setForm({}); }
  }

  function addRepToGroup(baseId: string) {
    const id = newId();
    // Tag the form with the target group so SortableGroup can show the form
    setForm({ id, name: "", homeAddress: "", startTime: "0000", endTime: "0000", maxAppointments: 3, startLocation: "home", endLocation: "home", isWorking: true, _groupId: baseId } as Partial<Rep> & { _groupId: string });
    setEditingId(id);
  }

  function moveGroupUp(baseId: string) {
    const idx = syncedGroupOrder.indexOf(baseId);
    if (idx > 0) setGroupOrder(arrayMove(syncedGroupOrder, idx, idx - 1));
  }
  function moveGroupDown(baseId: string) {
    const idx = syncedGroupOrder.indexOf(baseId);
    if (idx < syncedGroupOrder.length - 1) setGroupOrder(arrayMove(syncedGroupOrder, idx, idx + 1));
  }
  function moveRepUp(repId: string) {
    // Find adjacent rep within the same group
    const rep = reps.find(r => r.id === repId);
    if (!rep) return;
    const groupId = getRepBaseId(rep, bases);
    const groupReps = reps.filter(r => getRepBaseId(r, bases) === groupId);
    const groupIdx = groupReps.findIndex(r => r.id === repId);
    if (groupIdx <= 0) return;
    const flatIdx = reps.findIndex(r => r.id === repId);
    const prevFlatIdx = reps.findIndex(r => r.id === groupReps[groupIdx - 1].id);
    onChange(arrayMove(reps, flatIdx, prevFlatIdx));
  }
  function moveRepDown(repId: string) {
    const rep = reps.find(r => r.id === repId);
    if (!rep) return;
    const groupId = getRepBaseId(rep, bases);
    const groupReps = reps.filter(r => getRepBaseId(r, bases) === groupId);
    const groupIdx = groupReps.findIndex(r => r.id === repId);
    if (groupIdx >= groupReps.length - 1) return;
    const flatIdx = reps.findIndex(r => r.id === repId);
    const nextFlatIdx = reps.findIndex(r => r.id === groupReps[groupIdx + 1].id);
    onChange(arrayMove(reps, flatIdx, nextFlatIdx));
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeType = active.data.current?.type as string;
    const overId = String(over.id);

    if (activeType === "group") {
      // Reorder groups
      const oldIdx = syncedGroupOrder.indexOf(String(active.id).replace("group-", ""));
      const newIdx = syncedGroupOrder.indexOf(overId.replace("group-", ""));
      if (oldIdx !== -1 && newIdx !== -1) {
        setGroupOrder(arrayMove(syncedGroupOrder, oldIdx, newIdx));
      }
    } else if (activeType === "rep") {
      // Reorder reps within the same group
      const activeRepId = String(active.id);
      const overRepId = overId;
      const oldIdx = reps.findIndex(r => r.id === activeRepId);
      const newIdx = reps.findIndex(r => r.id === overRepId);
      if (oldIdx !== -1 && newIdx !== -1) {
        onChange(arrayMove(reps, oldIdx, newIdx));
      }
    }
  }

  if (showSettings === "bases") {
    return <BasesManager bases={bases} onChange={onBasesChange} onBack={() => setShowSettings(null)} />;
  }
  if (showSettings === "tags") {
    return <TagsManager customTags={customTags} onTagsChange={onTagsChange} onRemoveTag={onRemoveTag} onBack={() => setShowSettings(null)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-white">
        <h2 className="text-sm font-semibold text-coal">Manage Reps</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => addRepToGroup("unassigned")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-loch/70 hover:text-loch hover:bg-gray-100 transition-colors"
            aria-label="Add rep"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Add Rep
          </button>
          <button
            onClick={() => setShowSettings("bases")}
            className="p-1.5 rounded-md text-coal/40 hover:text-coal hover:bg-gray-100 transition-colors"
            title="Sales Bases"
            aria-label="Sales Bases"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
              <path d="M9 21V12h6v9"/>
            </svg>
          </button>
          <button
            onClick={() => setShowSettings("tags")}
            className="p-1.5 rounded-md text-coal/40 hover:text-coal hover:bg-gray-100 transition-colors"
            title="Tags"
            aria-label="Tags"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
          </button>
          <button onClick={onClose} className="p-1.5 rounded-md text-coal/50 hover:text-coal hover:bg-gray-100 transition-colors" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {reps.length === 0 && editingId === null && (
          <p className="text-sm text-coal/50 text-center py-6">No reps added yet.</p>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <SortableContext items={displayGroups.map(g => `group-${g.baseId}`)} strategy={verticalListSortingStrategy}>
            {displayGroups.map(({ baseId, baseName, groupReps }, groupIdx) => (
              <SortableGroup
                key={baseId} baseId={baseId} baseName={baseName} groupReps={groupReps}
                bases={bases} editingId={editingId} form={form} setForm={setForm}
                geocoding={geocoding}
                isFirst={groupIdx === 0} isLast={groupIdx === displayGroups.length - 1}
                onToggleWorking={(id) => onChange(reps.map(r => r.id === id ? { ...r, isWorking: !r.isWorking } : r))}
                onStartEdit={startEdit} onDelete={deleteRep} onSave={saveRep}
                onCancel={() => { setEditingId(null); setForm({}); }}
                onMoveGroupUp={moveGroupUp} onMoveGroupDown={moveGroupDown}
                onMoveRepUp={moveRepUp} onMoveRepDown={moveRepDown}
                onUpdateRepTags={(repId, tag) => onChange(reps.map(r => {
                  if (r.id !== repId) return r;
                  const current = r.tags ?? [];
                  const next = current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag];
                  return { ...r, tags: next };
                }))}
              />
            ))}
          </SortableContext>

          <DragOverlay>
            {activeId && !activeId.startsWith("group-") && (() => {
              const rep = reps.find(r => r.id === activeId);
              if (!rep) return null;
              return (
                <div className="border border-gray-200 rounded-lg bg-white shadow-lg opacity-90 p-3 text-sm font-semibold text-coal">
                  {rep.name}
                </div>
              );
            })()}
          </DragOverlay>
        </DndContext>

      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AppointmentsPlanner({ onRoutePreview }: AppointmentsPlannerProps) {
  const [reps, setRepsState] = useState<Rep[]>([]);
  const [repSaveError, setRepSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reps")
      .then((r) => r.json())
      .then((data: Record<string, unknown>[]) => setRepsState(data.map(migrateRep)))
      .catch(console.error);
  }, []);

  function setReps(next: Rep[] | ((prev: Rep[]) => Rep[])) {
    const resolved = typeof next === "function" ? next(reps) : next;
    setRepsState(resolved);
    fetch("/api/reps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(resolved),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "save failed");
        }
        setRepSaveError(null);
      })
      .catch((e: Error) => setRepSaveError(e.message));
  }

  const [bases, setBasesState] = useState<SalesBase[]>([...SALES_BASES]);

  useEffect(() => {
    fetch("/api/bases")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setBasesState(data as SalesBase[]); })
      .catch(console.error);
  }, []);

  function setBases(next: SalesBase[]) {
    setBasesState(next);
    fetch("/api/bases", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(console.error);
  }
  const [customTags, setCustomTagsState] = useLocalStorage<CustomTag[]>("cr-smith-tags", defaultCustomTags);

  function setCustomTags(tags: CustomTag[]) {
    setCustomTagsState(tags);
  }

  function removeTag(tagId: string) {
    setCustomTagsState(prev => prev.filter(t => t.id !== tagId));
    setReps(reps.map(r => ({ ...r, tags: (r.tags ?? []).filter(t => t !== tagId as ApptTag) })));
    setAppts(prev => prev.map(a => ({ ...a, tags: (a.tags ?? []).filter(t => t !== tagId) })));
  }

  const [appts, setAppts] = useState<ApptInput[]>([]);
  const [durationHours, setDurationHours] = useState(1);
  const [showRepManager, setShowRepManager] = useState(false);
  const [tableCollapsed, setTableCollapsed] = useState(false);
  const [issuesCollapsed, setIssuesCollapsed] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
  const [travelMatrix, setTravelMatrix] = useState<(number | null)[][] | null>(null);
  const [locMatrix, setLocMatrix] = useState<ReturnType<typeof buildLocationMatrix> | null>(null);
  const [geocodedAppts, setGeocodedAppts] = useState<ApptInput[]>([]);
  const [geocodeFailedAddresses, setGeocodeFailedAddresses] = useState<Set<string>>(new Set());
  const [expandedRepId, setExpandedRepId] = useState<string | null>(null);
  const [flashRepId, setFlashRepId] = useState<string | null>(null);

  const repForAppt = new Map<string, string>();
  if (scheduleResult) {
    for (const s of scheduleResult.schedules) {
      for (const a of s.assignments) repForAppt.set(a.apptId, s.repId);
    }
  }

  const fileRef = useRef<HTMLInputElement>(null);
  const isLoading = ["geocoding", "matrix", "scheduling"].includes(phase);

  const workingReps = reps.filter(
    (r) => r.isWorking && r.homeLat != null && r.homeLng != null
  );

  function addRow() {
    setAppts((a) => [...a, { id: newId(), urn: "", address: "", timeHHMM: "", tags: [] }]);
  }
  function updateApptTag(id: string, tag: ApptTag | "") {
    setAppts((prev) =>
      prev.map((a) => a.id !== id ? a : { ...a, tags: tag ? [tag] : [] })
    );
  }
  function updateAppt(id: string, field: "urn" | "address" | "timeHHMM", val: string) {
    setAppts((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, [field]: field === "timeHHMM" ? normaliseHHMM(val) : val } : a
      )
    );
  }
  function removeAppt(id: string) { setAppts((prev) => prev.filter((a) => a.id !== id)); }

  const handleCSV = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = (ev.target?.result as string).split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return;
      const header = lines[0].toLowerCase();
      const hasHeader = header.includes("address") || header.includes("time") || header.includes("urn");
      const startIdx = hasHeader ? 1 : 0;
      const cols = hasHeader ? header.split(",") : [];
      const urnCol  = cols.findIndex((c) => c.includes("urn") || c.includes("ref"));
      const addrCol = Math.max(0, cols.findIndex((c) => c.includes("address")));
      const timeCol = Math.max(addrCol === 0 ? 1 : 0, cols.findIndex((c) => c.includes("time")));
      const newRows: ApptInput[] = [];
      for (let i = startIdx; i < lines.length; i++) {
        const parts = lines[i].split(",").map((p) => p.replace(/^"|"$/g, "").trim());
        const address = parts[addrCol] ?? "";
        const time    = normaliseHHMM(parts[timeCol] ?? "");
        const urn     = urnCol >= 0 ? (parts[urnCol] ?? "") : "";
        if (address) newRows.push({ id: newId(), urn, address, timeHHMM: time });
      }
      setAppts((prev) => [...prev, ...newRows]);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  async function handleOptimise() {
    const validAppts = appts.filter((a) => a.address.trim() && a.timeHHMM);
    if (validAppts.length === 0) {
      setPhase("error");
      setStatusMsg("Please add at least one appointment with an address and time.");
      return;
    }
    if (workingReps.length === 0) {
      setPhase("error");
      setStatusMsg("No working reps with geocoded home addresses. Add reps via Manage Reps.");
      return;
    }

    setScheduleResult(null); setExpandedRepId(null); onRoutePreview(null);
    setGeocodeFailedAddresses(new Set());

    // Step 1: Geocode
    setPhase("geocoding");
    setStatusMsg(`Geocoding ${validAppts.length} appointment${validAppts.length === 1 ? "" : "s"}…`);

    let geoData: { geocoded: Array<{ address: string; lat: number; lng: number; isAnchor?: boolean }>; failed: Array<{ address: string; reason: string }> };
    try {
      const res = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor: workingReps[0].homeAddress, addresses: validAppts.map((a) => a.address) }),
      });
      if (!res.ok) throw new Error("Geocoding failed");
      geoData = await res.json();
    } catch (e) {
      setPhase("error");
      setStatusMsg(e instanceof Error ? e.message : "Geocoding failed");
      return;
    }

    // Track failures
    const failedSet = new Set(geoData.failed.map((f) => f.address));
    setGeocodeFailedAddresses(failedSet);

    const geoMap = new Map<string, { lat: number; lng: number }>();
    for (const g of geoData.geocoded) {
      if (!g.isAnchor) geoMap.set(g.address, { lat: g.lat, lng: g.lng });
    }
    const geocoded: ApptInput[] = validAppts.map((a) => {
      const geo = geoMap.get(a.address);
      return geo ? { ...a, lat: geo.lat, lng: geo.lng } : { ...a, geocodeFailed: true };
    });
    const geocodedOk = geocoded.filter((a) => !a.geocodeFailed);

    if (geocodedOk.length === 0) {
      setPhase("error");
      setStatusMsg("None of the appointment addresses could be geocoded.");
      return;
    }
    setGeocodedAppts(geocodedOk);

    // Step 2: Build location matrix + fetch durations
    setPhase("matrix");
    setStatusMsg(`Building travel matrix for ${workingReps.length} rep${workingReps.length === 1 ? "" : "s"} + ${geocodedOk.length} appointments…`);

    const lm = buildLocationMatrix(workingReps, geocodedOk, bases);
    setLocMatrix(lm);

    let matrix: (number | null)[][];
    try {
      const res = await fetch("/api/travel-matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations: lm.locations }),
      });
      if (!res.ok) throw new Error("Travel matrix failed");
      const data = await res.json() as { durations: (number | null)[][] };
      matrix = data.durations;
    } catch (e) {
      setPhase("error");
      setStatusMsg(e instanceof Error ? e.message : "Travel matrix failed");
      return;
    }
    setTravelMatrix(matrix);

    // Step 3: Schedule
    setPhase("scheduling");
    setStatusMsg("Scheduling appointments…");
    const result = scheduleAppointments(reps, geocodedOk, durationHours, matrix, lm, bases);
    setScheduleResult(result);

    const totalAssigned = result.schedules.reduce((n, s) => n + s.assignments.length, 0);
    const failNote = failedSet.size > 0 ? ` · ${failedSet.size} address${failedSet.size === 1 ? "" : "es"} couldn't be geocoded` : "";
    setPhase("done");
    setStatusMsg(
      `${totalAssigned} appointment${totalAssigned === 1 ? "" : "s"} assigned across ${result.schedules.length} rep${result.schedules.length === 1 ? "" : "s"}` +
      (result.unassigned.length > 0 ? ` · ${result.unassigned.length} unassigned` : "") +
      failNote
    );
  }

  function handleClear() {
    setAppts([]); setScheduleResult(null); setTravelMatrix(null); setLocMatrix(null);
    setGeocodedAppts([]); setGeocodeFailedAddresses(new Set());
    setExpandedRepId(null); setPhase("idle"); setStatusMsg(""); onRoutePreview(null);
  }

  function reassignAppt(apptId: string, fromRepId: string | null, toRepId: string | null) {
    if (!scheduleResult || !travelMatrix || !locMatrix) return;

    let { schedules, unassigned } = scheduleResult;
    const existingAssignment: Assignment | undefined =
      fromRepId != null
        ? schedules.find((s) => s.repId === fromRepId)?.assignments.find((a) => a.apptId === apptId)
        : undefined;

    if (fromRepId != null) {
      schedules = schedules.map((s) =>
        s.repId === fromRepId ? { ...s, assignments: s.assignments.filter((a) => a.apptId !== apptId) } : s
      );
    } else {
      unassigned = unassigned.filter((u) => u.apptId !== apptId);
    }

    if (toRepId != null) {
      const placeholder: Assignment = { apptId, repId: toRepId, travelSec: existingAssignment?.travelSec ?? 0, status: "ok" };
      const exists = schedules.find((s) => s.repId === toRepId);
      if (exists) {
        schedules = schedules.map((s) =>
          s.repId === toRepId ? { ...s, assignments: [...s.assignments, placeholder] } : s
        );
      } else {
        const rep = workingReps.find((r) => r.id === toRepId);
        schedules = [...schedules, {
          repId: toRepId,
          assignments: [placeholder],
          leaveTimeMins: null, returnTravelSec: null, estimatedReturnTimeMins: null,
          startAddress: rep ? getRepStartLoc(rep, bases).address : "",
          endAddress:   rep ? getRepEndLoc(rep, bases).address   : "",
        }];
      }
    } else {
      unassigned = [...unassigned, { apptId, reason: "Manually unassigned" }];
    }

    const recalculated = recalculateSchedules(schedules, unassigned, workingReps, geocodedAppts, durationHours, travelMatrix, locMatrix, bases);
    setScheduleResult(recalculated);
  }

  function jumpToRep(apptId: string) {
    const repId = repForAppt.get(apptId);
    if (!repId) return;
    if (expandedRepId !== repId) handleToggleRep(repId);
    setFlashRepId(repId);
    setTimeout(() => setFlashRepId(null), 1200);
    setTimeout(() => {
      document.querySelector(`[data-rep-id="${repId}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  async function handleToggleRep(repId: string) {
    const next = expandedRepId === repId ? null : repId;
    setExpandedRepId(next);
    if (!next || !scheduleResult) { onRoutePreview(null); return; }

    const rep      = reps.find((r) => r.id === next);
    const schedule = scheduleResult.schedules.find((s) => s.repId === next);
    if (!rep?.homeLat || !rep?.homeLng || !schedule) { onRoutePreview(null); return; }

    const startLoc = getRepStartLoc(rep);

    const orderedAppts = [...schedule.assignments]
      .sort((a, b) => {
        const ta = geocodedAppts.find((ap) => ap.id === a.apptId);
        const tb = geocodedAppts.find((ap) => ap.id === b.apptId);
        return (ta ? parseHHMM(ta.timeHHMM) : 0) - (tb ? parseHHMM(tb.timeHHMM) : 0);
      })
      .map((a) => geocodedAppts.find((ap) => ap.id === a.apptId))
      .filter((a): a is ApptInput => !!a && a.lat != null && a.lng != null);

    if (orderedAppts.length === 0) { onRoutePreview(null); return; }

    const endLoc = getRepEndLoc(rep);
    const waypoints = [startLoc, ...orderedAppts.map((a) => ({ lat: a.lat!, lng: a.lng! })), endLoc];
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");

    let geometry: [number, number][] | null = null;
    try {
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
      const data = await res.json() as { routes?: Array<{ geometry: { coordinates: [number, number][] } }> };
      if (data.routes?.[0]?.geometry?.coordinates) {
        geometry = data.routes[0].geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number]);
      }
    } catch { /* straight lines */ }

    onRoutePreview({
      anchor: { address: startLoc.address, lat: startLoc.lat, lng: startLoc.lng },
      stops: orderedAppts.map((a, i) => ({ id: i, lat: a.lat!, lng: a.lng!, addresses: [{ address: a.urn ? `${a.urn} — ${a.address}` : a.address }] })),
      geometry,
    });
  }

  if (showRepManager) {
    return (
      <CustomTagsContext.Provider value={customTags}>
        <RepManager
          reps={reps}
          bases={bases}
          onChange={setReps}
          onBasesChange={setBases}
          onClose={() => setShowRepManager(false)}
          customTags={customTags}
          onTagsChange={setCustomTags}
          onRemoveTag={removeTag}
        />
      </CustomTagsContext.Provider>
    );
  }

  // ── Problems to surface inline ─────────────────────────────────────────────
  const geocodeFailList = appts.filter((a) => geocodeFailedAddresses.has(a.address));
  const unassignedList  = scheduleResult?.unassigned ?? [];
  const showProblems    = geocodeFailList.length > 0 || unassignedList.length > 0;

  return (
  <CustomTagsContext.Provider value={customTags}>
    <div className="p-5 lg:p-6 space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-coal/50"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span className="text-xs font-semibold uppercase tracking-widest text-coal/60">Duration</span>
          <input type="number" min={0.25} max={8} step={0.25} value={durationHours}
            onChange={(e) => setDurationHours(parseFloat(e.target.value) || 1)}
            className="w-16 px-2 py-1 text-sm text-coal bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 text-center"
            aria-label="Appointment duration in hours" />
          <span className="text-xs text-coal/50">hrs</span>
        </label>
        <button onClick={() => setShowRepManager(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-saltire border border-saltire/25 rounded-lg hover:bg-snow transition-colors">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M1 13.5c0-2.485 2.239-4.5 5-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M11 9v4M9 11h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          Manage Reps
          {reps.filter((r) => r.isWorking).length > 0 && (
            <span className="ml-0.5 bg-saltire/10 text-saltire text-[10px] font-bold px-1 rounded">
              {reps.filter((r) => r.isWorking).length}
            </span>
          )}
          {repSaveError && (
            <span className="ml-0.5 text-red-500" title={`Rep changes could not be saved: ${repSaveError}`}>⚠</span>
          )}
        </button>
      </div>

      {/* Appointments section */}
      <section aria-labelledby="appts-label" className="rounded-lg border border-blue-200 bg-blue-50 overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-3.5 py-2.5 border-b border-blue-100 text-left"
          onClick={() => setTableCollapsed((c) => !c)}
          aria-expanded={!tableCollapsed}
        >
          <h2 id="appts-label" className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
            Appointments {appts.length > 0 && `(${appts.length})`}
          </h2>
          <svg
            width="12" height="12" viewBox="0 0 16 16" fill="none"
            className={`text-blue-600 transition-transform duration-200 ${tableCollapsed ? "-rotate-90" : ""}`}
          >
            <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {!tableCollapsed && (
          <div className="px-3.5 py-2.5">
            {appts.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-lg border border-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white border-b border-snow">
                      <th className="text-left px-2 py-2 text-xs font-semibold text-coal/50 w-16">URN</th>
                      <th className="text-left px-2 py-2 text-xs font-semibold text-coal/50">Address</th>
                      <th className="text-left px-2 py-2 text-xs font-semibold text-coal/50 w-16">Time</th>
                      <th className="text-left px-2 py-2 text-xs font-semibold text-coal/50">Tag</th>
                      <th className="w-7" />
                    </tr>
                  </thead>
                  <tbody>
                    {appts.map((appt) => {
                      const isFailed = geocodeFailedAddresses.has(appt.address);
                      return (
                        <tr key={appt.id} className={`border-b border-snow last:border-b-0 ${isFailed ? "bg-amber-50" : ""}`}>
                          <td className="px-2 py-1.5">
                            {repForAppt.has(appt.id) ? (
                              <button
                                onClick={() => jumpToRep(appt.id)}
                                title="Jump to assigned rep"
                                className="w-full text-left text-xs font-mono text-saltire hover:underline truncate"
                              >
                                {appt.urn || <span className="opacity-40">URN</span>}
                              </button>
                            ) : (
                              <input value={appt.urn ?? ""} onChange={(e) => updateAppt(appt.id, "urn", e.target.value)}
                                placeholder="URN"
                                className="w-full text-xs font-mono text-coal bg-transparent outline-none placeholder-coal/30 focus:bg-white rounded px-0.5 transition-colors" />
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              {isFailed && (
                                <svg className="flex-shrink-0 w-3 h-3 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                                </svg>
                              )}
                              <input value={appt.address} onChange={(e) => updateAppt(appt.id, "address", e.target.value)}
                                placeholder="Address or postcode"
                                className={`w-full text-sm bg-transparent outline-none placeholder-coal/30 focus:bg-white rounded px-0.5 transition-colors ${isFailed ? "text-amber-700" : "text-coal"}`} />
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={toDisplayTime(appt.timeHHMM)} onChange={(e) => updateAppt(appt.id, "timeHHMM", e.target.value)}
                              placeholder="HH:MM" maxLength={5}
                              className="w-full text-sm font-mono text-coal bg-transparent outline-none placeholder-coal/30 focus:bg-white rounded px-0.5 transition-colors" />
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {(appt.tags ?? [])[0] ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded bg-saltire text-white leading-none">
                                {getTagLabel((appt.tags as ApptTag[])[0], customTags)}
                                <button
                                  onClick={() => updateApptTag(appt.id, "")}
                                  className="hover:opacity-70 transition-opacity leading-none"
                                  aria-label="Remove tag"
                                >
                                  <svg width="7" height="7" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
                                </button>
                              </span>
                            ) : (
                              <span className="relative inline-block">
                                <button className="text-coal/30 hover:text-saltire transition-colors text-base font-light leading-none" aria-label="Add tag">+</button>
                                <select
                                  value=""
                                  onChange={(e) => updateApptTag(appt.id, e.target.value as ApptTag | "")}
                                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                                  aria-label="Select tag"
                                >
                                  <option value="" disabled>Select tag</option>
                                  {customTags.map((ct) => (
                                    <option key={ct.id} value={ct.id}>{ct.label}</option>
                                  ))}
                                </select>
                              </span>
                            )}
                          </td>
                          <td className="px-1.5 py-1.5">
                            <button onClick={() => removeAppt(appt.id)} className="text-coal/25 hover:text-red-500 transition-colors" aria-label="Remove">
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={addRow}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 border-2 border-dashed border-loch/20 rounded-lg text-xs text-loch/60 hover:text-loch hover:border-loch/40 transition-colors">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                Add appointment
              </button>
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors" aria-label="Upload CSV">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1v9m0 0L5 7m3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                CSV
              </button>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} className="hidden" aria-hidden="true"/>
            </div>
            <p className="mt-1.5 text-xs text-coal/50">One appointment per line — URN, address, time (HH:MM)</p>
          </div>
        )}
      </section>

      {/* Status */}
      {phase !== "idle" && statusMsg && (
        <div role="status" aria-live="polite"
          className={`flex items-start gap-2.5 px-3.5 py-3 rounded-lg text-sm ${
            phase === "error"  ? "bg-red-50 text-red-700 border border-red-100" :
            phase === "done"   ? "bg-green-50 text-green-800 border border-green-100" :
                                 "bg-snow text-loch border border-loch/10"}`}>
          {isLoading && <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0 mt-0.5"/>}
          {phase === "done"  && <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>}
          {phase === "error" && <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>}
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Inline problems panel */}
      {phase === "done" && showProblems && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
          <button
            onClick={() => setIssuesCollapsed((c) => !c)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 border-b border-amber-100 text-left"
          >
            <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
              {geocodeFailList.length + unassignedList.length} issue{geocodeFailList.length + unassignedList.length === 1 ? "" : "s"} to review
            </p>
            <svg
              width="12" height="12" viewBox="0 0 16 16" fill="none"
              className={`text-amber-600 transition-transform duration-200 ${issuesCollapsed ? "-rotate-90" : ""}`}
            >
              <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {!issuesCollapsed && <ul className="divide-y divide-amber-100">
            {geocodeFailList.map((a) => (
              <li key={a.id} className="px-3.5 py-2.5 flex items-start gap-2">
                <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                <div>
                  {a.urn && <p className="text-xs font-semibold text-amber-900">{a.urn}</p>}
                  <p className="text-xs text-amber-800">{a.address}</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">Address could not be geocoded — check the postcode</p>
                </div>
              </li>
            ))}
            {unassignedList.map(({ apptId, reason }) => {
              const appt = geocodedAppts.find((a) => a.id === apptId) ?? appts.find((a) => a.id === apptId);
              return (
                <li key={apptId} className="px-3.5 py-2.5 flex items-start gap-2">
                  <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                  <div className="flex-1 min-w-0">
                    {appt?.urn && <p className="text-xs font-semibold text-amber-900">{appt.urn}</p>}
                    <p className="text-xs text-amber-800 truncate">{appt?.address ?? apptId}</p>
                    <p className="text-[11px] text-amber-600 mt-0.5">{appt?.timeHHMM ? toDisplayTime(appt.timeHHMM) + " · " : ""}{reason}</p>
                  </div>
                  <AssignDropdown apptId={apptId} currentRepId={null} workingReps={workingReps} onReassign={reassignAppt}/>
                </li>
              );
            })}
          </ul>}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2.5">
        <button onClick={handleOptimise} disabled={isLoading}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-whisky text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-whisky/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          aria-busy={isLoading}>
          {isLoading ? (
            <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
            <span>{phase === "geocoding" ? "Geocoding…" : phase === "matrix" ? "Building matrix…" : "Scheduling…"}</span></>
          ) : (
            <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
            Optimise</>
          )}
        </button>
        <button onClick={handleClear} disabled={isLoading}
          className="px-3.5 py-2.5 text-sm font-medium text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
          Clear
        </button>
      </div>

      {/* Results */}
      {scheduleResult && scheduleResult.schedules.length > 0 && (
        <div className="space-y-2 pt-1 animate-fadeIn">
          <h3 className="text-xs font-semibold text-coal/60 uppercase tracking-widest">Scheduled Routes</h3>

          {scheduleResult.schedules.map((schedule) => {
            const rep = reps.find((r) => r.id === schedule.repId);
            if (!rep) return null;
            const isExpanded   = expandedRepId === schedule.repId;
            const hasConflict  = schedule.assignments.some((a) => a.status !== "ok");
            const hasLongTravel = schedule.assignments.some((a) => a.travelSec > 7200);

            return (
              <div key={schedule.repId}
                data-rep-id={schedule.repId}
                className={`border rounded-lg overflow-hidden transition-all ${hasConflict ? "border-amber-200" : "border-gray-200"} ${flashRepId === schedule.repId ? "ring-2 ring-loch ring-offset-1" : ""}`}>
                <button onClick={() => handleToggleRep(schedule.repId)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${isExpanded ? "bg-snow" : "hover:bg-gray-50"}`}>
                  <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${hasConflict ? "bg-rose-500" : "bg-loch"}`}>
                    {rep.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-coal">{rep.name}</p>
                    <p className="text-xs text-coal/50">
                      {schedule.assignments.length} appointment{schedule.assignments.length === 1 ? "" : "s"}
                      {schedule.leaveTimeMins != null && ` · Leave ${minsToDisplay(schedule.leaveTimeMins)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {hasLongTravel && (
                      <span className="text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">+2h travel</span>
                    )}
                    {hasConflict && (
                      <span className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">Conflict</span>
                    )}
                  </div>
                  <svg className={`w-4 h-4 text-coal/40 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                  </svg>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100">
                    <RepRouteList
                      schedule={schedule} rep={rep}
                      geocodedAppts={geocodedAppts} durationHours={durationHours}
                      workingReps={workingReps} bases={bases} onReassign={reassignAppt}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  </CustomTagsContext.Provider>
  );
}

// ── Rep route expanded list ───────────────────────────────────────────────────

function RepRouteList({
  schedule, rep, geocodedAppts, durationHours, workingReps, bases, onReassign,
}: {
  schedule: import("@/lib/appt-scheduler").RepSchedule;
  rep: Rep;
  geocodedAppts: ApptInput[];
  durationHours: number;
  workingReps: Rep[];
  bases: SalesBase[];
  onReassign: (apptId: string, fromRepId: string | null, toRepId: string | null) => void;
}) {
  const customTags = useCustomTags();
  const sortedAssignments = [...schedule.assignments].sort((a, b) => {
    const ta = geocodedAppts.find((ap) => ap.id === a.apptId);
    const tb = geocodedAppts.find((ap) => ap.id === b.apptId);
    return (ta ? parseHHMM(ta.timeHHMM) : 0) - (tb ? parseHHMM(tb.timeHHMM) : 0);
  });

  const rowBase = "flex items-start gap-3 px-4 py-3 border-b border-gray-50";

  return (
    <ol aria-label={`Route for ${rep.name}`}>
      {/* Start */}
      <li className={rowBase}>
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-map-anchor text-white text-xs font-bold flex items-center justify-center mt-0.5">S</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-loch uppercase tracking-wide">Start</p>
          <p className="text-sm font-semibold text-coal mt-0.5">
            {rep.startLocation === "base" && rep.startBaseId
              ? (bases.find((b) => b.id === rep.startBaseId)?.name ?? rep.startBaseId) + " base"
              : "Home"}
          </p>
          <p className="text-xs text-coal/50">{schedule.startAddress}</p>
          {schedule.leaveTimeMins != null && (
            <p className="text-xs text-coal/50 mt-0.5">Est. leave: {minsToDisplay(schedule.leaveTimeMins)}</p>
          )}
        </div>
      </li>

      {sortedAssignments.map((assignment, idx) => {
        const appt     = geocodedAppts.find((a) => a.id === assignment.apptId);
        if (!appt) return null;
        const conflict    = conflictLabel(assignment.status);
        const endTimeMins = parseHHMM(appt.timeHHMM) + durationHours * 60;

        return (
          <li key={assignment.apptId}
            className={`${rowBase} last:border-b-0 ${STATUS_BG[assignment.status]}`}>
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-loch text-white text-xs font-bold flex items-center justify-center mt-0.5">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className={`text-xs ${STATUS_COLOUR[assignment.status]}`}>
                  ↓ ~{formatDurationSec(assignment.travelSec)} travel
                  {conflict && ` · ${conflict}`}
                </p>
                <AssignDropdown apptId={assignment.apptId} currentRepId={rep.id} workingReps={workingReps} onReassign={onReassign}/>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-coal">
                  {appt.urn || appt.address}
                </p>
                {appt.tags?.[0] && (
                  <span className="text-[10px] font-medium px-2 py-1 rounded bg-saltire text-white leading-none flex-shrink-0">
                    {getTagLabel(appt.tags[0], customTags)}
                  </span>
                )}
              </div>
              {appt.urn && <p className="text-xs text-coal/50 mt-0.5">{appt.address}</p>}
              <p className="text-xs text-coal/60 mt-0.5">
                {toDisplayTime(appt.timeHHMM)} – {minsToDisplay(endTimeMins)}
              </p>
            </div>
          </li>
        );
      })}

      {/* End */}
      <li className={rowBase.replace("border-b border-gray-50", "")}>
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-map-anchor text-white text-xs font-bold flex items-center justify-center mt-0.5">E</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-loch uppercase tracking-wide">End</p>
          <p className="text-sm font-semibold text-coal mt-0.5">
            {rep.endLocation === "base" && rep.endBaseId
              ? (bases.find((b) => b.id === rep.endBaseId)?.name ?? rep.endBaseId) + " base"
              : "Home"}
          </p>
          <p className="text-xs text-coal/50">{schedule.endAddress}</p>
          {schedule.returnTravelSec != null && (
            <p className="text-xs text-coal/50 mt-0.5">↓ ~{formatDurationSec(schedule.returnTravelSec)} return drive</p>
          )}
          {schedule.estimatedReturnTimeMins != null && (
            <p className="text-xs text-coal/50">Est. arrival: {minsToDisplay(schedule.estimatedReturnTimeMins)}</p>
          )}
        </div>
      </li>
    </ol>
  );
}

// ── Reassign dropdown ─────────────────────────────────────────────────────────

function AssignDropdown({
  apptId, currentRepId, workingReps, onReassign,
}: {
  apptId: string;
  currentRepId: string | null;
  workingReps: Rep[];
  onReassign: (apptId: string, fromRepId: string | null, toRepId: string | null) => void;
}) {
  return (
    <select
      value={currentRepId ?? "unassigned"}
      onChange={(e) => {
        const toId = e.target.value === "unassigned" ? null : e.target.value;
        onReassign(apptId, currentRepId, toId);
      }}
      className="flex-shrink-0 text-xs text-coal/60 border border-gray-200 rounded-md px-1.5 py-1 bg-white cursor-pointer focus:outline-none focus:ring-1 focus:ring-loch/30 hover:border-loch/30 transition-colors"
      aria-label="Reassign appointment"
    >
      <option value="unassigned">Unassigned</option>
      {workingReps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );
}
