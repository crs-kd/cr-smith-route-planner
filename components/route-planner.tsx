"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useLayoutEffect } from "react";
import AppointmentsPlanner from "./appointments-planner";
import CanvassPlanner from "./canvass-planner";
import { useLocalStorage } from "@/lib/use-local-storage";

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

export default function RoutePlanner() {
  const [mode, setMode] = useState<Mode>("appointments");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useLocalStorage("cr-smith-sidebar-width", 560);
  const [isResizing, setIsResizing] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [enableTransition, setEnableTransition] = useState(false);
  const [routePreview, setRoutePreview] = useState<RoutePreviewData | null>(null);

  // useLayoutEffect runs before the first browser paint — ensures isDesktop (and thus
  // the inline width style) is applied before anything is shown, preventing flash.
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

  return (
    <div className="flex flex-col lg:flex-row gap-0 h-[calc(100vh-64px)]">
      {/* ── Left panel: form ── */}
      <aside
        className={`relative flex-shrink-0 bg-white border-r border-gray-100 overflow-x-hidden w-full flex flex-col ${enableTransition && !isResizing ? "transition-[width] duration-300" : ""}`}
        style={isDesktop ? { width: sidebarOpen ? sidebarWidth : 40 } : undefined}
      >
        {/* Drag-to-resize handle — desktop only, visible when open */}
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

        {/* Collapse/expand toggle — desktop only */}
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

        {/* ── Mode tabs — sticky ── */}
        <div
          className={`flex-shrink-0 flex border-b border-gray-100 bg-white px-5 lg:px-6 ${!sidebarOpen ? "lg:invisible lg:pointer-events-none" : ""}`}
          role="tablist"
          aria-label="Route planner mode"
        >
          {(["appointments", "canvass"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setRoutePreview(null);
              }}
              className={`mr-6 py-3.5 text-sm font-semibold border-b-2 -mb-px transition-colors duration-150 ${
                mode === m
                  ? "border-loch text-loch"
                  : "border-transparent text-coal/40 hover:text-coal/60"
              }`}
            >
              {m === "canvass" ? "Canvass" : "Appointments"}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className={`overflow-y-auto flex-1 min-h-0 ${!sidebarOpen ? "lg:invisible lg:pointer-events-none" : ""}`}>
          {/* Appointments planner — always mounted to preserve state */}
          <div className={mode === "appointments" ? "" : "hidden"}>
            <AppointmentsPlanner onRoutePreview={setRoutePreview} />
          </div>
          {/* Canvass planner — always mounted to preserve state */}
          <div className={mode === "canvass" ? "" : "hidden"}>
            <CanvassPlanner onRoutePreview={setRoutePreview} />
          </div>
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
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
