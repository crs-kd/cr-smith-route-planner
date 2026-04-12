"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useLayoutEffect, useEffect } from "react";
import AppointmentsPlanner from "./appointments-planner";
import CanvassPlanner from "./canvass-planner";
import SavePlanModal from "./save-plan-modal";
import { useLocalStorage } from "@/lib/use-local-storage";
import { useSession } from "@/lib/auth-context";

// Dynamic import for Leaflet map — no SSR
const MapView = dynamic(() => import("./map-view"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-snow rounded-xl">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-loch border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-coal/60 font-medium">Loading map…</p>
      </div>
    </div>
  ),
});

interface RoutePreviewData {
  anchor: { address: string; lat: number; lng: number };
  stops: { id: number; lat: number; lng: number; addresses: { address: string }[] }[];
  geometry: [number, number][] | null;
}

type Mode = "canvass" | "appointments";

interface PendingSave {
  type: "appointments" | "canvass";
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
}

export default function RoutePlanner() {
  const { session, loading: sessionLoading } = useSession();
  const [mode, setMode] = useState<Mode>("appointments");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useLocalStorage("cr-smith-sidebar-width", 560);
  const [isResizing, setIsResizing] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [enableTransition, setEnableTransition] = useState(false);
  const [routePreview, setRoutePreview] = useState<RoutePreviewData | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Determine which tabs this user can see
  const canSeeAppointments = !session || session.role === "admin" || (session.role === "editor" && session.tabs.includes("appointments"));
  const canSeeCanvass = !session || session.role === "admin" || (session.role === "editor" && session.tabs.includes("canvass"));
  const canSave = session && session.role !== "viewer";

  const visibleModes = (["appointments", "canvass"] as const).filter((m) =>
    m === "appointments" ? canSeeAppointments : canSeeCanvass
  );

  // Once the session has loaded, correct the active mode if it became inaccessible
  useEffect(() => {
    if (sessionLoading) return;
    if (visibleModes.length > 0 && !visibleModes.includes(mode)) {
      setMode(visibleModes[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading, session]);

  useLayoutEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    let raf1: number, raf2: number;
    raf1 = requestAnimationFrame(() => {
      setEnableTransition(true);
      raf2 = requestAnimationFrame(() => setSidebarOpen(true));
    });
    return () => {
      window.removeEventListener("resize", check);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMouseMove = (e: MouseEvent) => {
      const next = startWidth + (e.clientX - startX);
      const max = Math.floor(window.innerWidth * 0.75);
      setSidebarWidth(Math.max(420, Math.min(next, max)));
    };
    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [sidebarWidth, setSidebarWidth]);

  async function handleSavePlan(name: string, notes: string, visibility: "private" | "shared" | "link") {
    if (!pendingSave) return null;
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, notes, visibility, type: pendingSave.type, inputs: pendingSave.inputs, result: pendingSave.result }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { id: string };
      return data;
    } catch { return null; }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-0 h-[calc(100vh-64px)]">
      {/* ── Left panel: form ── */}
      <aside
        className={`relative flex-shrink-0 bg-white border-r border-gray-100 overflow-x-hidden w-full flex flex-col ${enableTransition && !isResizing ? "transition-[width] duration-300" : ""}`}
        style={isDesktop ? { width: sidebarOpen ? sidebarWidth : 40 } : undefined}
      >
        {/* Drag-to-resize handle */}
        {isDesktop && sidebarOpen && (
          <div
            onMouseDown={handleDragStart}
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-30 group hover:bg-loch/20 transition-colors"
            aria-hidden="true"
          >
            <div className="absolute right-0.5 top-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {[0, 1, 2].map((i) => <div key={i} className="w-0.5 h-2 bg-coal/30 rounded-full" />)}
            </div>
          </div>
        )}

        {/* Collapse/expand toggle */}
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          className="hidden lg:flex items-center justify-center absolute top-3 right-2 z-20 w-6 h-6 rounded-md text-coal/40 hover:text-coal/80 hover:bg-gray-100 transition-colors"
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {sidebarOpen
              ? <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
              : <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
            }
          </svg>
        </button>

        {/* ── Mode tabs ── */}
        {visibleModes.length > 1 && (
          <div
            className={`flex-shrink-0 flex border-b border-gray-100 bg-white px-5 lg:px-6 ${!sidebarOpen ? "lg:invisible lg:pointer-events-none" : ""}`}
            role="tablist"
            aria-label="Route planner mode"
          >
            {visibleModes.map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => { setMode(m); setRoutePreview(null); }}
                className={`mr-6 py-3.5 text-sm font-semibold border-b-2 -mb-px transition-colors duration-150 ${
                  mode === m ? "border-loch text-loch" : "border-transparent text-coal/40 hover:text-coal/60"
                }`}
              >
                {m === "canvass" ? "Canvass" : "Appointments"}
              </button>
            ))}
          </div>
        )}

        {/* Scrollable content */}
        <div className={`overflow-y-auto flex-1 min-h-0 ${!sidebarOpen ? "lg:invisible lg:pointer-events-none" : ""}`}>
          {canSeeAppointments && (
            <div className={mode === "appointments" ? "" : "hidden"}>
              <AppointmentsPlanner
                onRoutePreview={setRoutePreview}
                onResultReady={canSave ? (inputs, result) => setPendingSave({ type: "appointments", inputs, result }) : undefined}
              />
            </div>
          )}
          {canSeeCanvass && (
            <div className={mode === "canvass" ? "" : "hidden"}>
              <CanvassPlanner
                onRoutePreview={setRoutePreview}
                onResultReady={canSave ? (inputs, result) => setPendingSave({ type: "canvass", inputs, result }) : undefined}
              />
            </div>
          )}
        </div>
      </aside>

      {/* ── Right panel: map ── */}
      <main
        className="flex-1 bg-snow lg:sticky lg:top-16 h-[50vh] lg:h-[calc(100vh-64px)]"
        aria-label="Route map"
      >
        {routePreview ? (
          <MapView
            anchor={routePreview.anchor}
            stops={routePreview.stops}
            routeGeometry={routePreview.geometry}
            focusedSegmentIdx={null}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center max-w-xs px-6">
              <div className="w-16 h-16 rounded-2xl bg-loch/8 flex items-center justify-center mx-auto mb-4">
                {mode === "appointments" ? (
                  <svg className="w-8 h-8 text-loch/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                ) : (
                  <svg className="w-8 h-8 text-loch/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                )}
              </div>
              <p className="text-sm font-medium text-loch/60">
                {mode === "appointments"
                  ? "Select a rep\u2019s route to view it on the map."
                  : "Plan your canvass routes, then click a canvasser to view their route on the map."}
              </p>
              {pendingSave && canSave && (
                <button
                  onClick={() => setShowSaveModal(true)}
                  className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-loch border border-loch/25 rounded-lg hover:bg-loch/5 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2M8 2v8m0 0L5 7m3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Save Plan
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Save Plan Modal */}
      {showSaveModal && pendingSave && (
        <SavePlanModal
          type={pendingSave.type}
          onSave={handleSavePlan}
          onClose={() => setShowSaveModal(false)}
        />
      )}
    </div>
  );
}
