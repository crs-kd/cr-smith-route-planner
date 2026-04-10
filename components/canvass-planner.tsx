"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import {
  Canvasser,
  CanvassAddress,
  CanvassResult,
  DayPlan,
  migrateCanvasser,
  buildCanvassLocationMatrix,
  scheduleCanvass,
} from "@/lib/canvass-scheduler";
import { SalesBase, SALES_BASES, normaliseHHMM, formatDurationSec, parseHHMM } from "@/lib/appt-scheduler";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoutePreviewData {
  anchor: { address: string; lat: number; lng: number };
  stops: { id: number; lat: number; lng: number; addresses: { address: string }[] }[];
  geometry: [number, number][] | null;
}

interface CanvassPlannerProps {
  onRoutePreview: (data: RoutePreviewData | null) => void;
}

type Phase = "idle" | "geocoding" | "matrix" | "scheduling" | "done" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

function newId() { return Math.random().toString(36).slice(2, 9); }

function toDisplayTime(hhmm: string): string {
  const s = (hhmm ?? "").replace(":", "").trim();
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2)}`;
  return s;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri defaults

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

// ── Canvasser edit form ───────────────────────────────────────────────────────

function CanvasserEditForm({
  form, setForm, onSave, onCancel, geocoding, bases,
}: {
  form: Partial<Canvasser>;
  setForm: (fn: (f: Partial<Canvasser>) => Partial<Canvasser>) => void;
  onSave: () => void;
  onCancel: () => void;
  geocoding: boolean;
  bases: SalesBase[];
}) {
  const inputCls = "w-full px-3 py-2 text-sm bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all";
  const workingDays = form.workingDays ?? WEEKDAYS;

  function toggleDay(d: number) {
    setForm((f) => {
      const current = f.workingDays ?? WEEKDAYS;
      const next = current.includes(d) ? current.filter((x) => x !== d) : [...current, d].sort();
      return { ...f, workingDays: next };
    });
  }

  return (
    <div className="p-3 space-y-2.5 bg-snow/50">
      <input
        className={inputCls}
        placeholder="Full name"
        value={form.name ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
      />
      <input
        className={inputCls}
        placeholder="Home address / postcode"
        value={form.homeAddress ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, homeAddress: e.target.value }))}
      />
      {form.homeLat && form.homeLng && (
        <p className="text-xs text-green-600">✓ Geocoded: {form.homeLat.toFixed(4)}, {form.homeLng.toFixed(4)}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-coal/50 mb-1">Start time</p>
          <input
            className={inputCls + " font-mono text-center"} placeholder="09:00" maxLength={5}
            value={toDisplayTime(form.startTime ?? "")}
            onChange={(e) => setForm((f) => ({ ...f, startTime: normaliseHHMM(e.target.value) }))}
          />
        </div>
        <div>
          <p className="text-xs text-coal/50 mb-1">End time</p>
          <input
            className={inputCls + " font-mono text-center"} placeholder="17:00" maxLength={5}
            value={toDisplayTime(form.endTime ?? "")}
            onChange={(e) => setForm((f) => ({ ...f, endTime: normaliseHHMM(e.target.value) }))}
          />
        </div>
      </div>
      <div>
        <p className="text-xs text-coal/50 mb-1.5">Working days</p>
        <div className="flex gap-1">
          {DAY_LABELS.map((label, d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={`flex-1 py-1 text-[11px] font-medium rounded transition-colors ${
                workingDays.includes(d)
                  ? "bg-loch text-white"
                  : "border border-gray-200 text-coal/40 hover:text-coal/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-coal/50 mb-1">Starts from</p>
        <div className="flex gap-2">
          <select
            className={inputCls}
            value={form.startLocation ?? "home"}
            onChange={(e) => setForm((f) => ({ ...f, startLocation: e.target.value as "home" | "base" }))}
          >
            <option value="home">Home</option>
            <option value="base">Sales Base</option>
          </select>
          {form.startLocation === "base" && (
            <select
              className={inputCls}
              value={form.startBaseId ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, startBaseId: e.target.value }))}
            >
              <option value="">Select base…</option>
              {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </div>
      <div>
        <p className="text-xs text-coal/50 mb-1">Ends at</p>
        <div className="flex gap-2">
          <select
            className={inputCls}
            value={form.endLocation ?? "home"}
            onChange={(e) => setForm((f) => ({ ...f, endLocation: e.target.value as "home" | "base" }))}
          >
            <option value="home">Home</option>
            <option value="base">Sales Base</option>
          </select>
          {form.endLocation === "base" && (
            <select
              className={inputCls}
              value={form.endBaseId ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, endBaseId: e.target.value }))}
            >
              <option value="">Select base…</option>
              {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.isWorking ?? true}
          onChange={(e) => setForm((f) => ({ ...f, isWorking: e.target.checked }))}
          className="accent-loch"
        />
        <span className="text-xs text-coal/70">Working</span>
      </label>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={geocoding}
          className="flex-1 py-2 bg-loch text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-loch/90 transition-colors"
        >
          {geocoding ? "Geocoding…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Sortable canvasser card ───────────────────────────────────────────────────

function SortableCanvasserCard({
  canvasser, bases, editingId, form, setForm, geocoding, isFirst, isLast,
  onToggleWorking, onStartEdit, onDelete, onSave, onCancel, onMoveUp, onMoveDown, onQuickUpdate,
}: {
  canvasser: Canvasser;
  bases: SalesBase[];
  editingId: string | null;
  form: Partial<Canvasser>;
  setForm: (fn: (f: Partial<Canvasser>) => Partial<Canvasser>) => void;
  geocoding: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggleWorking: (id: string) => void;
  onStartEdit: (c: Canvasser) => void;
  onDelete: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onQuickUpdate: (id: string, patch: Partial<Canvasser>) => void;
}) {
  const isEditing = editingId === canvasser.id;
  const editFormRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isEditing && editFormRef.current) {
      editFormRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isEditing]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: canvasser.id,
    disabled: isEditing,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const arrowCls = "p-1 rounded transition-colors";
  const arrowActive = "text-coal/40 hover:text-coal hover:bg-gray-100";
  const arrowDisabled = "text-coal/15 cursor-not-allowed";

  const workingDays = canvasser.workingDays ?? WEEKDAYS;

  return (
    <div ref={setNodeRef} style={style} className="border border-blue-200 rounded-lg overflow-hidden bg-blue-50">
      {isEditing ? (
        <div ref={editFormRef} className="bg-white">
          <CanvasserEditForm
            form={form} setForm={setForm} onSave={onSave} onCancel={onCancel}
            geocoding={geocoding} bases={bases}
          />
        </div>
      ) : (
        <div className="flex items-start gap-2 p-3">
          {/* Grip + arrows */}
          <div className="flex-shrink-0 flex flex-col items-center gap-0.5 mt-0.5">
            <button
              disabled={isFirst}
              onClick={() => onMoveUp(canvasser.id)}
              className={`${arrowCls} ${isFirst ? arrowDisabled : arrowActive}`}
              aria-label="Move up"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 10l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button
              {...attributes} {...listeners}
              className="p-1 text-coal/20 hover:text-coal/50 cursor-grab active:cursor-grabbing touch-none"
              aria-label="Drag to reorder"
            >
              <GripIcon />
            </button>
            <button
              disabled={isLast}
              onClick={() => onMoveDown(canvasser.id)}
              className={`${arrowCls} ${isLast ? arrowDisabled : arrowActive}`}
              aria-label="Move down"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          {/* Working toggle */}
          <button
            onClick={() => onToggleWorking(canvasser.id)}
            className={`flex-shrink-0 mt-0.5 w-8 rounded-full transition-colors p-0.5 ${canvasser.isWorking ? "bg-loch" : "bg-gray-300"}`}
            style={{ height: "18px" }}
            title={canvasser.isWorking ? "Working" : "Not working"}
          >
            <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${canvasser.isWorking ? "translate-x-3" : "translate-x-0"}`} />
          </button>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${canvasser.isWorking ? "text-coal" : "text-coal/40"}`}>
              {canvasser.name}
            </p>
            {/* Inline start location dropdown */}
            <select
              value={canvasser.startLocation === "base" && canvasser.startBaseId ? canvasser.startBaseId : "home"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "home") onQuickUpdate(canvasser.id, { startLocation: "home", startBaseId: undefined });
                else onQuickUpdate(canvasser.id, { startLocation: "base", startBaseId: v });
              }}
              className="mt-0.5 text-xs text-coal/60 bg-transparent border-0 outline-none cursor-pointer hover:text-coal transition-colors -ml-0.5 max-w-full"
            >
              <option value="home">{canvasser.homeAddress || "Home"}</option>
              {bases.map((b) => <option key={b.id} value={b.id}>{b.name} base</option>)}
            </select>
            {canvasser.homeLat && canvasser.homeLng
              ? <p className="text-xs text-green-600 mt-0.5">✓ Geocoded: {canvasser.homeLat.toFixed(4)}, {canvasser.homeLng.toFixed(4)}</p>
              : <p className="text-xs text-amber-600 mt-0.5">⚠ Address not geocoded</p>
            }
            <div className="flex gap-1.5 mt-1 items-center text-xs text-coal/50">
              {/* Inline time fields */}
              <input
                type="text" maxLength={5}
                defaultValue={normaliseHHMM(canvasser.startTime) === "0000" ? "" : toDisplayTime(canvasser.startTime)}
                placeholder="Any"
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "");
                  if (raw.length >= 3) e.target.value = `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
                }}
                onBlur={(e) => onQuickUpdate(canvasser.id, { startTime: normaliseHHMM(e.target.value) || "0000" })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="font-mono w-10 bg-transparent outline-none border-b border-transparent hover:border-gray-300 focus:border-loch text-center transition-colors"
                aria-label="Start time"
              />
              <span>–</span>
              <input
                type="text" maxLength={5}
                defaultValue={normaliseHHMM(canvasser.endTime) === "0000" ? "" : toDisplayTime(canvasser.endTime)}
                placeholder="Any"
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "");
                  if (raw.length >= 3) e.target.value = `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
                }}
                onBlur={(e) => onQuickUpdate(canvasser.id, { endTime: normaliseHHMM(e.target.value) || "0000" })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="font-mono w-10 bg-transparent outline-none border-b border-transparent hover:border-gray-300 focus:border-loch text-center transition-colors"
                aria-label="End time"
              />
            </div>
            {/* Working days pills */}
            <div className="flex gap-0.5 mt-1.5">
              {DAY_LABELS.map((label, d) => (
                <span
                  key={d}
                  className={`text-[9px] font-medium px-1 py-0.5 rounded ${
                    workingDays.includes(d)
                      ? "bg-loch/15 text-loch"
                      : "text-coal/20"
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
          {/* Edit / delete */}
          <div className="flex gap-1 flex-shrink-0">
            <button
              onClick={() => onStartEdit(canvasser)}
              className="p-1.5 text-coal/40 hover:text-loch hover:bg-snow rounded transition-colors"
              aria-label="Edit"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button
              onClick={() => onDelete(canvasser.id)}
              className="p-1.5 text-coal/40 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
              aria-label="Delete"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CanvasserManager ──────────────────────────────────────────────────────────

function CanvasserManager({
  canvassers, bases, onChange, onClose,
}: {
  canvassers: Canvasser[];
  bases: SalesBase[];
  onChange: (next: Canvasser[]) => void;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Canvasser>>({});
  const [geocoding, setGeocoding] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function startEdit(c: Canvasser) { setEditingId(c.id); setForm({ ...c }); }

  function startNew() {
    const id = newId();
    setEditingId(id);
    setForm({
      id,
      name: "",
      homeAddress: "",
      startTime: "0900",
      endTime: "1700",
      workingDays: [...WEEKDAYS],
      startLocation: "home",
      endLocation: "home",
      isWorking: true,
    });
  }

  async function saveCanvasser() {
    if (!form.name?.trim() || !form.homeAddress?.trim()) return;
    let lat = form.homeLat, lng = form.homeLng;
    const existing = canvassers.find((c) => c.id === form.id);
    if (!lat || !lng || existing?.homeAddress !== form.homeAddress) {
      setGeocoding(true);
      const geo = await geocodeOne(form.homeAddress!);
      setGeocoding(false);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }
    const canvasser: Canvasser = {
      id:            form.id ?? newId(),
      name:          form.name!,
      homeAddress:   form.homeAddress!,
      homeLat:       lat,
      homeLng:       lng,
      startTime:     form.startTime ?? "0900",
      endTime:       form.endTime   ?? "1700",
      workingDays:   form.workingDays ?? [...WEEKDAYS],
      startLocation: form.startLocation ?? "home",
      startBaseId:   form.startBaseId,
      endLocation:   form.endLocation ?? "home",
      endBaseId:     form.endBaseId,
      isWorking:     form.isWorking !== false,
    };
    const exists = canvassers.find((c) => c.id === canvasser.id);
    onChange(exists
      ? canvassers.map((c) => (c.id === canvasser.id ? canvasser : c))
      : [...canvassers, canvasser]
    );
    setEditingId(null); setForm({});
  }

  function deleteCanvasser(id: string) {
    onChange(canvassers.filter((c) => c.id !== id));
    if (editingId === id) { setEditingId(null); setForm({}); }
  }

  function moveUp(id: string) {
    const idx = canvassers.findIndex((c) => c.id === id);
    if (idx <= 0) return;
    const next = [...canvassers];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  }

  function moveDown(id: string) {
    const idx = canvassers.findIndex((c) => c.id === id);
    if (idx < 0 || idx >= canvassers.length - 1) return;
    const next = [...canvassers];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next);
  }

  function handleDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const from = canvassers.findIndex((c) => c.id === active.id);
      const to   = canvassers.findIndex((c) => c.id === over.id);
      if (from >= 0 && to >= 0) onChange(arrayMove(canvassers, from, to));
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-white">
        <h2 className="text-sm font-semibold text-coal">Manage Canvassers</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={startNew}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-loch/70 hover:text-loch hover:bg-gray-100 transition-colors"
            aria-label="Add canvasser"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Add Canvasser
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-coal/50 hover:text-coal hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {canvassers.length === 0 && editingId === null && (
          <p className="text-sm text-coal/50 text-center py-6">No canvassers added yet.</p>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={canvassers.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {canvassers.map((c, idx) => (
              <SortableCanvasserCard
                key={c.id}
                canvasser={c}
                bases={bases}
                editingId={editingId}
                form={form}
                setForm={setForm}
                geocoding={geocoding}
                isFirst={idx === 0}
                isLast={idx === canvassers.length - 1}
                onToggleWorking={(id) =>
                  onChange(canvassers.map((x) => x.id === id ? { ...x, isWorking: !x.isWorking } : x))
                }
                onStartEdit={startEdit}
                onDelete={deleteCanvasser}
                onSave={saveCanvasser}
                onCancel={() => { setEditingId(null); setForm({}); }}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
                onQuickUpdate={(id, patch) =>
                  onChange(canvassers.map((x) => x.id === id ? { ...x, ...patch } : x))
                }
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {activeId && (() => {
              const c = canvassers.find((x) => x.id === activeId);
              if (!c) return null;
              return (
                <div className="border border-gray-200 rounded-lg bg-white shadow-lg opacity-90 p-3 text-sm font-semibold text-coal">
                  {c.name}
                </div>
              );
            })()}
          </DragOverlay>
        </DndContext>

        {/* New canvasser form (if adding) */}
        {editingId !== null && !canvassers.find((c) => c.id === editingId) && (
          <div className="border border-loch/20 rounded-lg overflow-hidden">
            <div className="bg-white">
              <CanvasserEditForm
                form={form} setForm={setForm} onSave={saveCanvasser}
                onCancel={() => { setEditingId(null); setForm({}); }}
                geocoding={geocoding} bases={bases}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Day accordion card ────────────────────────────────────────────────────────

function DayCard({
  dayPlan, canvassers, addresses, expandedCanvasserId, onToggleCanvasser,
}: {
  dayPlan: DayPlan;
  canvassers: Canvasser[];
  addresses: CanvassAddress[];
  expandedCanvasserId: string | null;
  onToggleCanvasser: (canvasserId: string, dayDate: string) => void;
}) {
  const addrById = new Map(addresses.map((a) => [a.id, a]));
  const totalAddresses = dayPlan.routes.reduce((n, r) => n + r.addressIds.length, 0);

  // Format date nicely
  const dateObj = new Date(dayPlan.date + "T12:00:00");
  const dateLabel = dateObj.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div>
          <p className="text-sm font-semibold text-coal">{dateLabel}</p>
          <p className="text-xs text-coal/50 mt-0.5">
            {dayPlan.routes.length} canvasser{dayPlan.routes.length === 1 ? "" : "s"} · {totalAddresses} address{totalAddresses === 1 ? "" : "es"}
          </p>
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {dayPlan.routes.map((route) => {
          const canvasser = canvassers.find((c) => c.id === route.canvasserId);
          if (!canvasser) return null;
          const isExpanded = expandedCanvasserId === `${route.canvasserId}:${dayPlan.date}`;
          const totalTravelSec = route.travelSecs.reduce((s, t) => s + t, 0);

          return (
            <div key={route.canvasserId} className="bg-white">
              <button
                onClick={() => onToggleCanvasser(route.canvasserId, dayPlan.date)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-snow/60 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-coal">{canvasser.name}</p>
                  <p className="text-xs text-coal/50 mt-0.5">
                    {route.addressIds.length} address{route.addressIds.length === 1 ? "" : "es"}
                    {totalTravelSec > 0 && (
                      <> · ~{formatDurationSec(totalTravelSec)} drive</>
                    )}
                  </p>
                </div>
                <svg
                  className={`w-4 h-4 text-coal/40 transition-transform duration-150 flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 px-4 pb-3">
                  <ol className="space-y-1.5 mt-2">
                    {route.addressIds.map((id, idx) => {
                      const addr = addrById.get(id);
                      const travel = route.travelSecs[idx] ?? 0;
                      return (
                        <li key={id} className="flex gap-2 text-xs">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-loch/10 text-loch font-semibold flex items-center justify-center text-[10px]">
                            {idx + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-coal/80 truncate">{addr?.address ?? id}</p>
                            {idx > 0 && travel > 0 && (
                              <p className="text-coal/40">{formatDurationSec(travel)} from previous</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CanvassPlanner({ onRoutePreview }: CanvassPlannerProps) {
  const [canvassers, setCanvassersState] = useState<Canvasser[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/canvassers")
      .then((r) => r.json())
      .then((data: Record<string, unknown>[]) => setCanvassersState(data.map(migrateCanvasser)))
      .catch(console.error);
  }, []);

  function setCanvassers(next: Canvasser[] | ((prev: Canvasser[]) => Canvasser[])) {
    const resolved = typeof next === "function" ? next(canvassers) : next;
    setCanvassersState(resolved);
    fetch("/api/canvassers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(resolved),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "save failed");
        }
        setSaveError(null);
      })
      .catch((e: Error) => setSaveError(e.message));
  }

  const [bases, setBasesState] = useState<SalesBase[]>([...SALES_BASES]);
  useEffect(() => {
    fetch("/api/bases")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setBasesState(data as SalesBase[]); })
      .catch(console.error);
  }, []);

  const [addressInput, setAddressInput] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [durationMins, setDurationMins] = useState(20);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [canvassResult, setCanvassResult] = useState<CanvassResult | null>(null);
  const [geocodedAddresses, setGeocodedAddresses] = useState<CanvassAddress[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showManager, setShowManager] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isLoading = ["geocoding", "matrix", "scheduling"].includes(phase);

  const workingCanvassers = canvassers.filter(
    (c) => c.isWorking && c.homeLat != null && c.homeLng != null
  );

  const handleCSV = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = (ev.target?.result as string)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.length) return;
      const header = lines[0].toLowerCase();
      const hasHeader = header.includes("address") || header.includes("addr") || isNaN(Number(lines[0][0]));
      const startIdx = hasHeader ? 1 : 0;
      const colIdx = hasHeader
        ? Math.max(0, header.split(",").findIndex((h) => h.includes("address") || h.includes("addr")))
        : 0;
      const addrs: string[] = [];
      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const val = cols[colIdx]?.replace(/^"|"$/g, "").trim();
        if (val) addrs.push(val);
      }
      setAddressInput(addrs.join("\n"));
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  async function handlePlan() {
    const rawAddresses = addressInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (rawAddresses.length === 0) {
      setPhase("error");
      setStatusMsg("Please enter at least one address.");
      return;
    }
    if (workingCanvassers.length === 0) {
      setPhase("error");
      setStatusMsg("No working canvassers with geocoded home addresses. Add canvassers via Manage Canvassers.");
      return;
    }

    setCanvassResult(null);
    setExpandedKey(null);
    onRoutePreview(null);

    // Step 1: Geocode
    setPhase("geocoding");
    setStatusMsg(`Geocoding ${rawAddresses.length} address${rawAddresses.length === 1 ? "" : "es"}…`);

    let geoData: {
      geocoded: Array<{ address: string; lat: number; lng: number; isAnchor?: boolean }>;
      failed: Array<{ address: string; reason: string }>;
    };
    try {
      const res = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor: workingCanvassers[0].homeAddress, addresses: rawAddresses }),
      });
      if (!res.ok) throw new Error("Geocoding failed");
      geoData = await res.json();
    } catch (e) {
      setPhase("error");
      setStatusMsg(e instanceof Error ? e.message : "Geocoding failed");
      return;
    }

    const failedCount = geoData.failed.length;
    const geoMap = new Map<string, { lat: number; lng: number }>();
    for (const g of geoData.geocoded) {
      if (!g.isAnchor) geoMap.set(g.address, { lat: g.lat, lng: g.lng });
    }

    const geocoded: CanvassAddress[] = rawAddresses
      .map((addr) => {
        const geo = geoMap.get(addr);
        return geo ? { id: newId(), address: addr, lat: geo.lat, lng: geo.lng } : null;
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    if (geocoded.length === 0) {
      setPhase("error");
      setStatusMsg("None of the addresses could be geocoded.");
      return;
    }
    setGeocodedAddresses(geocoded);

    // Step 2: Build travel matrix
    setPhase("matrix");
    setStatusMsg(`Building travel matrix for ${workingCanvassers.length} canvasser${workingCanvassers.length === 1 ? "" : "s"} + ${geocoded.length} addresses…`);

    const locMatrix = buildCanvassLocationMatrix(workingCanvassers, geocoded, bases);

    let travelMatrix: (number | null)[][];
    try {
      const res = await fetch("/api/travel-matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations: locMatrix.locations }),
      });
      if (!res.ok) throw new Error("Travel matrix failed");
      const data = await res.json() as { durations: (number | null)[][] };
      travelMatrix = data.durations;
    } catch (e) {
      setPhase("error");
      setStatusMsg(e instanceof Error ? e.message : "Travel matrix failed");
      return;
    }

    // Step 3: Schedule
    setPhase("scheduling");
    setStatusMsg("Planning canvass routes…");

    const result = scheduleCanvass(
      workingCanvassers,
      geocoded,
      new Date(startDate + "T12:00:00"),
      bases,
      travelMatrix,
      locMatrix,
      durationMins
    );
    setCanvassResult(result);

    const totalAssigned = geocoded.length - result.unassigned.length;
    const failNote = failedCount > 0 ? ` · ${failedCount} address${failedCount === 1 ? "" : "es"} couldn't be geocoded` : "";
    setPhase("done");
    setStatusMsg(
      `${totalAssigned} address${totalAssigned === 1 ? "" : "es"} assigned across ${result.days.length} day${result.days.length === 1 ? "" : "s"}` +
      (result.unassigned.length > 0 ? ` · ${result.unassigned.length} unassigned` : "") +
      failNote
    );
  }

  function handleClear() {
    setAddressInput("");
    setCanvassResult(null);
    setGeocodedAddresses([]);
    setExpandedKey(null);
    setPhase("idle");
    setStatusMsg("");
    onRoutePreview(null);
  }

  async function handleToggleCanvasser(canvasserId: string, date: string) {
    const key = `${canvasserId}:${date}`;
    const next = expandedKey === key ? null : key;
    setExpandedKey(next);

    if (!next || !canvassResult) { onRoutePreview(null); return; }

    const canvasser = canvassers.find((c) => c.id === canvasserId);
    if (!canvasser?.homeLat || !canvasser?.homeLng) { onRoutePreview(null); return; }

    const dayPlan = canvassResult.days.find((d) => d.date === date);
    const route   = dayPlan?.routes.find((r) => r.canvasserId === canvasserId);
    if (!route || route.addressIds.length === 0) { onRoutePreview(null); return; }

    const addrById = new Map(geocodedAddresses.map((a) => [a.id, a]));
    const orderedAddrs = route.addressIds.map((id) => addrById.get(id)).filter(
      (a): a is CanvassAddress => !!a && a.lat != null && a.lng != null
    );
    if (orderedAddrs.length === 0) { onRoutePreview(null); return; }

    // Resolve start/end location
    const startBaseMatch = canvasser.startLocation === "base" && canvasser.startBaseId
      ? bases.find((b) => b.id === canvasser.startBaseId)
      : undefined;
    const startPt: { address: string; lat: number; lng: number } =
      startBaseMatch?.lat != null && startBaseMatch?.lng != null
        ? { address: `${startBaseMatch.name} base`, lat: startBaseMatch.lat, lng: startBaseMatch.lng }
        : { address: canvasser.homeAddress, lat: canvasser.homeLat!, lng: canvasser.homeLng! };

    const endBaseMatch = canvasser.endLocation === "base" && canvasser.endBaseId
      ? bases.find((b) => b.id === canvasser.endBaseId)
      : undefined;
    const endPt: { lat: number; lng: number } =
      endBaseMatch?.lat != null && endBaseMatch?.lng != null
        ? { lat: endBaseMatch.lat, lng: endBaseMatch.lng }
        : { lat: canvasser.homeLat!, lng: canvasser.homeLng! };

    const waypoints = [startPt, ...orderedAddrs.map((a) => ({ lat: a.lat!, lng: a.lng! })), endPt];
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");

    let geometry: [number, number][] | null = null;
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`
      );
      const data = await res.json() as {
        routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
      };
      if (data.routes?.[0]?.geometry?.coordinates) {
        geometry = data.routes[0].geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
        );
      }
    } catch { /* straight lines fallback */ }

    onRoutePreview({
      anchor: { address: startPt.address, lat: startPt.lat, lng: startPt.lng },
      stops: orderedAddrs.map((a, i) => ({
        id: i,
        lat: a.lat!,
        lng: a.lng!,
        addresses: [{ address: a.address }],
      })),
      geometry,
    });
  }

  if (showManager) {
    return (
      <CanvasserManager
        canvassers={canvassers}
        bases={bases}
        onChange={setCanvassers}
        onClose={() => setShowManager(false)}
      />
    );
  }

  const unassignedAddrs = canvassResult
    ? canvassResult.unassigned
        .map((id) => geocodedAddresses.find((a) => a.id === id)?.address ?? id)
    : [];

  return (
    <div className="p-5 lg:p-6 space-y-5">
      {/* Toolbar — mirrors appointments: settings left, manage button right */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-coal/50 flex-shrink-0"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span className="text-xs font-semibold uppercase tracking-widest text-coal/60">Duration</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            value={durationMins}
            onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) setDurationMins(v); }}
            className="w-14 px-2 py-1 text-sm text-coal bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 text-center"
            aria-label="Minutes per door"
          />
          <span className="text-xs text-coal/50">mins</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-2 py-1 text-sm text-coal bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 transition-all"
            aria-label="Start date"
          />
        </div>
        <button
          onClick={() => setShowManager(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-saltire border border-saltire/25 rounded-lg hover:bg-snow transition-colors flex-shrink-0"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M1 13.5c0-2.485 2.239-4.5 5-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M11 9v4M9 11h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          Manage Canvassers
          {canvassers.filter((c) => c.isWorking).length > 0 && (
            <span className="ml-0.5 bg-saltire/10 text-saltire text-[10px] font-bold px-1 rounded">
              {canvassers.filter((c) => c.isWorking).length}
            </span>
          )}
          {saveError && (
            <span className="ml-0.5 text-red-500" title={`Changes could not be saved: ${saveError}`}>⚠</span>
          )}
        </button>
      </div>

      {/* Addresses — blue box matching appointments section style */}
      <section aria-labelledby="canvass-addresses-label" className="rounded-lg border border-blue-200 bg-blue-50 overflow-hidden">
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-blue-100">
          <h2 id="canvass-addresses-label" className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
            Addresses{addressInput.split("\n").filter(Boolean).length > 0 && ` (${addressInput.split("\n").filter(Boolean).length})`}
          </h2>
        </div>
        <div className="px-3.5 py-2.5">
          <textarea
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder={"12 Union Street, Aberdeen, AB10 1AA\n45 Byres Road, Glasgow, G11 5RG\n7 Rose Street, Edinburgh, EH2 2PR"}
            rows={7}
            className="w-full px-3 py-2 text-sm text-coal placeholder-coal/40 bg-white border border-blue-100 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all duration-150 resize-none font-sans"
          />
          <div className="flex gap-2 mt-2">
            <p className="flex-1 text-xs text-coal/50 self-center">One address per line, including postcode</p>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              aria-label="Upload CSV"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 10V1m0 0L5 4m3-3 3 3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} className="hidden" aria-hidden="true" />
          </div>
        </div>
      </section>

      {/* Status */}
      {phase !== "idle" && statusMsg && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-start gap-2.5 px-3.5 py-3 rounded-lg text-sm ${
            phase === "error"
              ? "bg-red-50 text-red-700 border border-red-100"
              : phase === "done"
              ? "bg-green-50 text-green-800 border border-green-100"
              : "bg-snow text-loch border border-loch/10"
          }`}
        >
          {isLoading && (
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0 mt-0.5" aria-hidden="true" />
          )}
          {phase === "done" && (
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {phase === "error" && (
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          )}
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2.5">
        <button
          onClick={handlePlan}
          disabled={isLoading}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-whisky text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-whisky/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-whisky/50 focus:ring-offset-2"
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
              <span>{phase === "geocoding" ? "Geocoding…" : phase === "matrix" ? "Building matrix…" : "Planning…"}</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              Plan routes
            </>
          )}
        </button>
        <button
          onClick={handleClear}
          disabled={isLoading}
          className="px-3.5 py-2.5 text-sm font-medium text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
          aria-label="Clear all inputs"
        >
          Clear
        </button>
      </div>

      {/* Results */}
      {canvassResult && canvassResult.days.length > 0 && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-coal/60 uppercase tracking-widest">
              Canvass Plan
            </h3>
            <p className="text-xs text-coal/40">Click a canvasser to see their route on the map</p>
          </div>

          {canvassResult.days.map((dayPlan) => (
            <DayCard
              key={dayPlan.date}
              dayPlan={dayPlan}
              canvassers={canvassers}
              addresses={geocodedAddresses}
              expandedCanvasserId={expandedKey}
              onToggleCanvasser={handleToggleCanvasser}
            />
          ))}

          {/* Unassigned */}
          {unassignedAddrs.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5">
              <p className="text-sm font-semibold text-amber-800 mb-2">
                {unassignedAddrs.length} unassigned address{unassignedAddrs.length === 1 ? "" : "es"}
              </p>
              <ul className="space-y-1">
                {unassignedAddrs.map((addr, i) => (
                  <li key={i} className="text-xs text-amber-700 truncate">{addr}</li>
                ))}
              </ul>
              <p className="text-xs text-amber-600 mt-2">
                These addresses couldn&apos;t be fit within {14} days. Try adding more canvassers or extending working hours.
              </p>
            </div>
          )}
        </div>
      )}

      {canvassResult && canvassResult.days.length === 0 && phase === "done" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5">
          <p className="text-sm text-amber-800">No routes could be planned. Check that canvassers have working days that fall within the date range and sufficient working hours.</p>
        </div>
      )}
    </div>
  );
}
