"use client";

import dynamic from "next/dynamic";
import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import RouteList from "./route-list";
import AppointmentsPlanner from "./appointments-planner";
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

interface GeocodedStop {
  address: string;
  lat: number;
  lng: number;
  isAnchor?: boolean;
  fallback?: boolean;
  name?: string; // Appointments mode: customer / appointment label
}

interface FailedAddress {
  address: string;
  reason: string;
}

interface StopGroup {
  id: number;
  lat: number;
  lng: number;
  addresses: GeocodedStop[];
}

type Phase = "idle" | "geocoding" | "optimising" | "done" | "error";
type Mode  = "canvass" | "appointments";

/**
 * In Appointments mode each line can optionally be prefixed with a name
 * separated by " - ":  "John Smith - 14 Main Street, Edinburgh, EH1 1AB"
 */
function parseAddressLine(line: string, mode: Mode): { name?: string; address: string } {
  if (mode !== "appointments") return { address: line };
  const sepIdx = line.indexOf(" - ");
  if (sepIdx > 0) {
    return { name: line.slice(0, sepIdx).trim(), address: line.slice(sepIdx + 3).trim() };
  }
  return { address: line };
}

const KM_TO_MI = 0.621371;

interface RouteResult {
  anchor: GeocodedStop;
  endAnchor?: GeocodedStop;
  stops: StopGroup[];
  failed: FailedAddress[];
  totalMi: number;
  roadRouted: boolean;
  routeGeometry: [number, number][] | null;
  legDurationsS: number[] | null;
  geocodedCount: number;
  totalCount: number;
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Group co-located stops (same Nominatim result → same lat/lng) into one map pin. */
function groupStops(stops: GeocodedStop[]): StopGroup[] {
  const map = new Map<string, GeocodedStop[]>();
  for (const stop of stops) {
    const key = `${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`; // ~0.1 m — only groups exact Nominatim duplicates
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(stop);
  }
  return Array.from(map.values()).map((addresses, id) => ({
    id,
    lat: addresses[0].lat,
    lng: addresses[0].lng,
    addresses,
  }));
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default function RoutePlanner() {
  const [mode, setMode] = useState<Mode>("appointments");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useLocalStorage("cr-smith-sidebar-width", 560);
  const [isResizing, setIsResizing] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [enableTransition, setEnableTransition] = useState(false);

  // useLayoutEffect runs before the first browser paint — ensures isDesktop (and thus
  // the inline width:40 style) is applied before anything is shown, so the sidebar
  // genuinely starts collapsed. The double-rAF then lets the browser commit that
  // collapsed frame before the open transition plays.
  useLayoutEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    let raf1: number, raf2: number;
    // rAF1: enable transitions (sidebar is still collapsed at width:40, no visible animation)
    raf1 = requestAnimationFrame(() => {
      setEnableTransition(true);
      // rAF2: now open — transition plays from 40 → saved width
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
  const [anchor, setAnchor] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [activeTab, setActiveTab] = useState<"paste" | "csv">("paste");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [result, setResult] = useState<RouteResult | null>(null);
  const [failedOpen, setFailedOpen] = useState(false);
  const [useEndAnchor, setUseEndAnchor] = useState(false);
  const [endAnchorInput, setEndAnchorInput] = useState("");
  const [hiddenStopIds, setHiddenStopIds] = useState<Set<number>>(new Set());
  const [focusedStopId, setFocusedStopId] = useState<number | "start" | null>(null);
  const [apptPreview, setApptPreview] = useState<{
    anchor: { address: string; lat: number; lng: number };
    stops: { id: number; lat: number; lng: number; addresses: { address: string }[] }[];
    geometry: [number, number][] | null;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleStop(id: number) {
    setHiddenStopIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function focusStop(id: number | "start") {
    setFocusedStopId((prev) => (prev === id ? null : id));
  }

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
      const hasHeader =
        header.includes("address") || header.includes("addr") || isNaN(Number(lines[0][0]));
      const startIdx = hasHeader ? 1 : 0;
      const colIdx = hasHeader
        ? Math.max(
            0,
            header.split(",").findIndex((h) => h.includes("address") || h.includes("addr"))
          )
        : 0;

      const addrs: string[] = [];
      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const val = cols[colIdx]?.replace(/^"|"$/g, "").trim();
        if (val) addrs.push(val);
      }
      setAddressInput(addrs.join("\n"));
      setActiveTab("paste");
    };
    reader.readAsText(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  }, []);

  async function handleOptimise() {
    const anchorVal = anchor.trim();
    const raw = addressInput.trim();

    if (!anchorVal) {
      setPhase("error");
      setStatusMsg("Please enter a start location.");
      return;
    }
    if (useEndAnchor && !endAnchorInput.trim()) {
      setPhase("error");
      setStatusMsg("Please enter an end location or uncheck 'Different end location'.");
      return;
    }
    if (!raw) {
      setPhase("error");
      setStatusMsg("Please enter at least 2 addresses.");
      return;
    }

    // Parse each line — in Appointments mode extract optional "Name - Address" prefix
    const parsedLines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => parseAddressLine(l, mode));

    const addresses = parsedLines.map((p) => p.address);

    if (addresses.length < 2) {
      setPhase("error");
      setStatusMsg("Please enter at least 2 addresses.");
      return;
    }
    if (addresses.length > 100) {
      setPhase("error");
      setStatusMsg("Maximum 100 addresses supported.");
      return;
    }

    setResult(null);
    setPhase("geocoding");
    setStatusMsg(`Geocoding ${addresses.length} ${mode === "appointments" ? "appointment" : "address"}${addresses.length === 1 ? "" : "es"}…`);

    try {
      // Step 1: Geocode
      const geoBody: Record<string, unknown> = { anchor: anchorVal, addresses };
      if (useEndAnchor && endAnchorInput.trim()) geoBody.endAddress = endAnchorInput.trim();

      const geoRes = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geoBody),
      });

      if (!geoRes.ok) {
        const err = await geoRes.json();
        throw new Error(err.error ?? "Geocoding failed");
      }

      const { geocoded, failed: failedAddresses, endAnchorGeo } = await geoRes.json() as {
        geocoded: GeocodedStop[];
        failed: FailedAddress[];
        endAnchorGeo?: GeocodedStop;
      };

      const anchorGeo = geocoded.find((g) => g.isAnchor);
      // Re-attach names (Appointments mode): geocode API preserves original `address` string
      const nameLookup = new Map<string, string>();
      if (mode === "appointments") {
        for (const p of parsedLines) {
          if (p.name) nameLookup.set(p.address, p.name);
        }
      }
      const stops = geocoded
        .filter((g) => !g.isAnchor)
        .map((g) => ({ ...g, name: nameLookup.get(g.address) }));

      if (!anchorGeo) throw new Error("Could not locate the start/end address.");
      if (stops.length < 1) {
        throw new Error("None of the addresses could be geocoded. Check the postcodes and try again.");
      }

      // Group co-located addresses into one waypoint each
      const stopGroups = groupStops(stops);

      setPhase("optimising");
      setStatusMsg(`Optimising route for ${stopGroups.length} ${mode === "appointments" ? "appointment" : "location"}${stopGroups.length === 1 ? "" : "s"}…`);

      // Step 2: Optimise (pass groups — each has {id, lat, lng})
      const stopsForApi = stopGroups.map((g) => ({
        id: g.id,
        lat: g.lat,
        lng: g.lng,
        address: g.addresses.map((a) => a.address).join("; "),
      }));

      let orderedGroups: StopGroup[];
      let totalMi: number;
      let roadRouted: boolean;
      let routeGeo: [number, number][] | null = null;

      const optBody: Record<string, unknown> = { anchor: anchorGeo, stops: stopsForApi };
      if (endAnchorGeo) optBody.endAnchor = endAnchorGeo;

      const optRes = await fetch("/api/optimise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(optBody),
      });
      if (!optRes.ok) throw new Error("Route optimisation failed");
      const { orderIds, routeGeometry: geo, roadDistanceKm, legDurationsS } = await optRes.json() as {
        orderIds: number[];
        routeGeometry: [number, number][] | null;
        roadDistanceKm: number | null;
        legDurationsS: number[] | null;
      };

      orderedGroups = orderIds.map((id) => stopGroups[id]).filter(Boolean);
      if (orderedGroups.length < 1) orderedGroups = stopGroups;
      routeGeo = geo ?? null;

      const endPt = endAnchorGeo ?? anchorGeo;
      if (roadDistanceKm != null) {
        totalMi = roadDistanceKm * KM_TO_MI;
        roadRouted = true;
      } else {
        const chain = [anchorGeo, ...orderedGroups.map((g) => ({ lat: g.lat, lng: g.lng })), endPt];
        let totalKm = 0;
        for (let i = 0; i < chain.length - 1; i++) totalKm += haversine(chain[i], chain[i + 1]);
        totalMi = totalKm * KM_TO_MI;
        roadRouted = false;
      }

      const totalAddresses = orderedGroups.reduce((n, g) => n + g.addresses.length, 0);
      const skipped = (failedAddresses ?? []).length;

      setResult({
        anchor: anchorGeo,
        endAnchor: endAnchorGeo,
        stops: orderedGroups,
        failed: failedAddresses ?? [],
        totalMi,
        roadRouted,
        routeGeometry: routeGeo,
        legDurationsS: legDurationsS ?? null,
        geocodedCount: stops.length,
        totalCount: addresses.length,
      });
      setHiddenStopIds(new Set());
      setFocusedStopId(null);
      setDisplayGeometry(routeGeo);
      setDisplayLegDurations(legDurationsS ?? null);
      setFailedOpen(false);
      setPhase("done");
      const unitSingular = mode === "appointments" ? "appointment" : "area";
      const unitPlural   = mode === "appointments" ? "appointments" : "areas";
      setStatusMsg(
        `Route ready — ${orderedGroups.length} ${orderedGroups.length === 1 ? unitSingular : unitPlural}` +
        (mode === "canvass" && totalAddresses > orderedGroups.length ? ` · ${totalAddresses} addresses` : "") +
        `, ~${totalMi.toFixed(1)} mi` +
        (skipped > 0 ? ` · ${skipped} skipped` : "")
      );
    } catch (err) {
      setPhase("error");
      setStatusMsg(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  }

  function handleClear() {
    setAnchor("");
    setAddressInput("");
    setResult(null);
    setPhase("idle");
    setStatusMsg("");
    setFailedOpen(false);
    setUseEndAnchor(false);
    setEndAnchorInput("");
    setHiddenStopIds(new Set());
    setFocusedStopId(null);
    setDisplayGeometry(null);
    setDisplayLegDurations(null);
  }

  // Derived: only the stops the user hasn't hidden
  const visibleStops = result ? result.stops.filter((g) => !hiddenStopIds.has(g.id)) : [];

  // Road geometry for the currently-visible stops.
  // When nothing is hidden we use the geometry from the optimise call directly.
  // When stops are hidden we re-fetch OSRM /route for the visible subset so the
  // route still follows roads and respects the end point.
  const [displayGeometry, setDisplayGeometry] = useState<[number, number][] | null>(null);
  const [displayLegDurations, setDisplayLegDurations] = useState<number[] | null>(null);

  useEffect(() => {
    if (!result) { setDisplayGeometry(null); return; }

    if (hiddenStopIds.size === 0) {
      setDisplayGeometry(result.routeGeometry);
      setDisplayLegDurations(result.legDurationsS);
      return;
    }

    // Build ordered waypoints: anchor → visible stops → end
    const endPt = result.endAnchor ?? result.anchor;
    const waypoints = [result.anchor, ...visibleStops, endPt];
    if (waypoints.length < 2) { setDisplayGeometry(null); return; }

    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    const abortCtrl = new AbortController();

    fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`,
      { signal: abortCtrl.signal }
    )
      .then((r) => r.json())
      .then((data) => {
        const route = data.routes?.[0];
        if (route?.geometry?.coordinates) {
          const geo: [number, number][] = route.geometry.coordinates.map(
            ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
          );
          setDisplayGeometry(geo);
          setDisplayLegDurations(
            Array.isArray(route.legs)
              ? route.legs.map((l: { duration: number }) => l.duration)
              : null
          );
        } else {
          setDisplayGeometry(null);
          setDisplayLegDurations(null);
        }
      })
      .catch(() => { /* aborted or network error — leave previous values */ });

    return () => abortCtrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, hiddenStopIds]);

  // Segment index passed to MapView:
  //   0       = anchor → stop[0]   (Start row clicked)
  //   N+1     = stop[N] → stop[N+1] or anchor  (stop N clicked)
  //   null    = no focus
  const focusedSegmentIdx: number | null = (() => {
    if (focusedStopId === null) return null;
    if (focusedStopId === "start") return 0;
    const idx = visibleStops.findIndex((g) => g.id === focusedStopId);
    return idx >= 0 ? idx + 1 : null;
  })();

  // Recompute distance for the visible subset (haversine — exact road dist would need a re-fetch)
  const visibleMi =
    result && hiddenStopIds.size > 0
      ? (() => {
          const endPt = result.endAnchor ?? result.anchor;
          const chain = [result.anchor, ...visibleStops, endPt];
          let d = 0;
          for (let i = 0; i < chain.length - 1; i++) d += haversine(chain[i], chain[i + 1]);
          return d * KM_TO_MI;
        })()
      : result?.totalMi ?? 0;

  const isLoading = phase === "geocoding" || phase === "optimising";

  return (
    <div className="flex flex-col lg:flex-row gap-0 min-h-[calc(100vh-64px)]">
      {/* ── Left panel: form ── */}
      <aside
        className={`relative flex-shrink-0 bg-white border-r border-gray-100 overflow-hidden w-full flex flex-col ${enableTransition && !isResizing ? "transition-[width] duration-300" : ""}`}
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
              {[0,1,2].map(i => <div key={i} className="w-0.5 h-2 bg-coal/30 rounded-full" />)}
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

        {/* ── Mode tabs — sticky, outside the scroll container ── */}
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
                setResult(null);
                setHiddenStopIds(new Set());
                setFocusedStopId(null);
                setDisplayGeometry(null);
                setApptPreview(null);
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

        {/* Appointments planner — always mounted to preserve state, hidden when on canvass tab */}
        <div className={mode === "appointments" ? "" : "hidden"}>
          <AppointmentsPlanner onRoutePreview={setApptPreview} />
        </div>

        {/* Canvass form — always mounted, hidden when on appointments tab */}
        <div className={mode === "canvass" ? "" : "hidden"}>
        <div className="p-5 lg:p-6 space-y-5">

          {/* Anchor location */}
          <section aria-labelledby="anchor-label" className="print:hidden">
            <h2 id="anchor-label" className="text-xs font-semibold text-coal/60 uppercase tracking-widest mb-2">
              Start location
            </h2>
            <label htmlFor="anchor-input" className="sr-only">Start address or postcode</label>
            <input
              id="anchor-input"
              type="text"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              placeholder="e.g. Gardeners Street, Dunfermline, KY12 0RN"
              className="w-full px-3.5 py-2.5 text-sm text-coal placeholder-coal/40 bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all duration-150"
              aria-required="true"
            />

            {/* Different end location toggle */}
            <label className="flex items-center gap-2 mt-2.5 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={useEndAnchor}
                onChange={(e) => setUseEndAnchor(e.target.checked)}
                className="w-3.5 h-3.5 accent-loch"
              />
              <span className="text-xs text-coal/60 group-hover:text-coal/80 transition-colors">
                Different end location
              </span>
            </label>

            {useEndAnchor && (
              <div className="mt-2">
                <label htmlFor="end-anchor-input" className="sr-only">End address or postcode</label>
                <input
                  id="end-anchor-input"
                  type="text"
                  value={endAnchorInput}
                  onChange={(e) => setEndAnchorInput(e.target.value)}
                  placeholder="e.g. High Street, Perth, PH1 5TJ"
                  className="w-full px-3.5 py-2.5 text-sm text-coal placeholder-coal/40 bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all duration-150"
                />
              </div>
            )}
          </section>

          {/* Address input */}
          <section aria-labelledby="addresses-label" className="print:hidden">
            <div className="mb-3">
              <h2 id="addresses-label" className="text-xs font-semibold text-coal/60 uppercase tracking-widest mb-1">
                Addresses
              </h2>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-3" role="tablist" aria-label="Address input method">
              <button
                role="tab"
                aria-selected={activeTab === "paste"}
                aria-controls="tab-paste"
                onClick={() => setActiveTab("paste")}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                  activeTab === "paste"
                    ? "bg-loch text-white"
                    : "text-coal/60 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                Paste addresses
              </button>
              <button
                role="tab"
                aria-selected={activeTab === "csv"}
                aria-controls="tab-csv"
                onClick={() => setActiveTab("csv")}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                  activeTab === "csv"
                    ? "bg-loch text-white"
                    : "text-coal/60 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                Upload CSV
              </button>
            </div>

            {/* Paste tab */}
            <div
              id="tab-paste"
              role="tabpanel"
              hidden={activeTab !== "paste"}
            >
              <textarea
                id="address-textarea"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder={"12 Union Street, Aberdeen, AB10 1AA\n45 Byres Road, Glasgow, G11 5RG\n7 Rose Street, Edinburgh, EH2 2PR"}
                rows={7}
                className="w-full px-3.5 py-2.5 text-sm text-coal placeholder-coal/40 bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all duration-150 resize-none font-sans"
                aria-required="true"
              />
              <p className="mt-1.5 text-xs text-coal/50">One address per line, including postcode</p>
            </div>

            {/* CSV tab */}
            <div
              id="tab-csv"
              role="tabpanel"
              hidden={activeTab !== "csv"}
            >
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-loch/20 rounded-lg py-8 text-center hover:bg-snow/50 transition-colors duration-150 group"
                aria-label="Choose CSV file to upload"
              >
                <svg className="w-8 h-8 mx-auto mb-2 text-loch/30 group-hover:text-loch/50 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm font-medium text-loch/70 group-hover:text-loch transition-colors">
                  Drop a CSV or click to browse
                </p>
                <p className="text-xs text-coal/60 mt-1">
                  Column named &ldquo;address&rdquo; or first column used
                </p>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                onChange={handleCSV}
                className="hidden"
                aria-hidden="true"
              />
              {addressInput && activeTab === "csv" && (
                <p className="mt-2 text-xs text-coal/60">
                  {addressInput.split("\n").filter(Boolean).length} addresses loaded
                </p>
              )}
            </div>
          </section>

          {/* Status message */}
          {phase !== "idle" && statusMsg && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-start gap-2.5 px-3.5 py-3 rounded-lg text-sm print:hidden ${
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
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {phase === "error" && (
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              )}
              <span>{statusMsg}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2.5">
            <button
              onClick={handleOptimise}
              disabled={isLoading}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-whisky text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-whisky/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-whisky/50 focus:ring-offset-2"
              aria-busy={isLoading}
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  <span>{phase === "geocoding" ? "Geocoding…" : "Optimising…"}</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Optimise route
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

          {/* Results panel */}
          {result && (
            <div className="space-y-4 pt-2 animate-fadeIn">
              {/* Stats */}
              {(() => {
                const totalDurationS = displayLegDurations
                  ? displayLegDurations.reduce((s, d) => s + d, 0)
                  : null;
                return (
                  <div className="grid grid-cols-2 gap-2.5 print:hidden" role="region" aria-label="Route statistics">
                    <div className="bg-snow rounded-lg p-3 text-center">
                      <p className="text-xl font-bold text-loch">
                        {result.geocodedCount}/{result.totalCount}
                      </p>
                      <p className="text-xs text-coal/60 mt-0.5">Addresses</p>
                    </div>
                    <div className="bg-snow rounded-lg p-3 text-center">
                      <p className="text-xl font-bold text-loch">
                        {hiddenStopIds.size > 0
                          ? `${visibleStops.length}/${result.stops.length}`
                          : result.stops.length}
                      </p>
                      <p className="text-xs text-coal/60 mt-0.5">Areas</p>
                    </div>
                    <div className="bg-snow rounded-lg p-3 text-center">
                      <p className="text-xl font-bold text-loch">{visibleMi.toFixed(1)}</p>
                      <p className="text-xs text-coal/60 mt-0.5">Distance (Miles)</p>
                    </div>
                    <div className="bg-snow rounded-lg p-3 text-center">
                      <p className="text-xl font-bold text-loch">
                        {totalDurationS != null ? formatDuration(totalDurationS) : "—"}
                      </p>
                      <p className="text-xs text-coal/60 mt-0.5">Est. Drive Time</p>
                    </div>
                  </div>
                );
              })()}

              {/* Failed addresses — collapsible warning */}
              {result.failed.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
                  <button
                    onClick={() => setFailedOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 text-left"
                    aria-expanded={failedOpen}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-amber-800">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                      {result.failed.length} address{result.failed.length === 1 ? "" : "es"} couldn&apos;t be located
                    </span>
                    <svg
                      className={`w-4 h-4 text-amber-600 transition-transform duration-150 ${failedOpen ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {failedOpen && (
                    <ul className="border-t border-amber-200 divide-y divide-amber-100" aria-label="Addresses that could not be geocoded">
                      {result.failed.map((f, i) => (
                        <li key={i} className="px-3.5 py-2.5">
                          <p className="text-xs font-medium text-amber-900 truncate">{f.address}</p>
                          <p className="text-xs text-amber-700 mt-0.5">{f.reason}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Route list */}
              <div>
                <h3 className="text-xs font-semibold text-coal/60 uppercase tracking-widest mb-3">
                  Optimised route
                </h3>
                <RouteList
                  mode={mode}
                  anchor={result.anchor}
                  endAnchor={result.endAnchor}
                  stops={result.stops}
                  legDurationsS={displayLegDurations}
                  hiddenStopIds={hiddenStopIds}
                  onToggleStop={toggleStop}
                  focusedStopId={focusedStopId}
                  onFocusStop={(id: number | "start") => focusStop(id)}
                />
              </div>
            </div>
          )}
        </div>
        </div>{/* end canvass wrapper */}
        </div>{/* end scrollable content */}
      </aside>

      {/* ── Right panel: map ── */}
      <main
        className="flex-1 bg-snow lg:sticky lg:top-16 h-[50vh] lg:h-[calc(100vh-64px)]"
        aria-label="Route map"
      >
        {mode === "appointments" ? (
          apptPreview ? (
            <MapView
              anchor={apptPreview.anchor}
              stops={apptPreview.stops}
              routeGeometry={apptPreview.geometry}
              focusedSegmentIdx={null}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center max-w-xs px-6">
                <div className="w-16 h-16 rounded-2xl bg-loch/8 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-loch/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-loch/60">
                  Select a rep&apos;s route to view it on the map.
                </p>
              </div>
            </div>
          )
        ) : result ? (
          <MapView
            anchor={result.anchor}
            endAnchor={result.endAnchor}
            stops={visibleStops}
            routeGeometry={displayGeometry}
            focusedSegmentIdx={focusedSegmentIdx}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center max-w-xs px-6">
              <div className="w-16 h-16 rounded-2xl bg-loch/8 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-loch/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-loch/60">
                Enter your addresses and click <span className="text-whisky font-semibold">Optimise route</span> to see your canvassing route here.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
