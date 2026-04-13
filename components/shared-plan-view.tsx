"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { useUISettings, pillStyle } from "@/lib/ui-settings";

// Leaflet MapView — no SSR
const MapView = dynamic(() => import("./map-view"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-56 flex items-center justify-center bg-gray-100 rounded-xl">
      <div className="w-6 h-6 border-2 border-loch border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

interface SharedPlan {
  id: string;
  name: string;
  notes: string | null;
  type: "appointments" | "canvass";
  created_at: string;
  creator_name: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
}

export default function SharedPlanView({ plan, backHref }: { plan: SharedPlan; backHref?: string }) {
  const [{ pillStyles }] = useUISettings();
  const typeLabel = plan.type === "appointments" ? "Appointments" : "Canvass";

  const dateLabel = new Date(plan.created_at).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Back link */}
        {backHref && (
          <div className="mb-4">
            <a
              href={backHref}
              className="inline-flex items-center gap-1.5 text-sm text-coal/60 hover:text-coal transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L4 8l6 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back to Plans
            </a>
          </div>
        )}

        {/* Plan header */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide" style={pillStyle(pillStyles[plan.type])}>
            {typeLabel}
          </span>
          <h1 className="text-xl font-bold text-coal mt-2">{plan.name}</h1>
          {plan.notes && <p className="text-sm text-coal/60 mt-1">{plan.notes}</p>}
          <div className="flex gap-4 mt-4 text-xs text-coal/40 border-t border-gray-100 pt-3">
            <span>Created by {plan.creator_name}</span>
            <span>{dateLabel}</span>
          </div>
        </div>

        {/* Plan result */}
        {plan.type === "canvass" ? (
          <CanvassResultView result={plan.result} inputs={plan.inputs} />
        ) : (
          <AppointmentsResultView result={plan.result} inputs={plan.inputs} />
        )}
      </div>
    </div>
  );
}

// ── Shared types ───────────────────────────────────────────────────────────────

type RepSnapshot = {
  id: string;
  name: string;
  homeAddress?: string;
  homeLat?: number | null;
  homeLng?: number | null;
};

type CanvasserSnapshot = {
  id: string;
  name: string;
  homeAddress: string;
  homeLat: number | null;
  homeLng: number | null;
  startAddress: string;
  startLat: number | null;
  startLng: number | null;
  startLabel: string;
  endAddress: string;
  endLat: number | null;
  endLng: number | null;
  endLabel: string;
};

type GeoAppt = {
  id: string;
  address: string;
  timeHHMM: string;
  urn?: string;
  lat?: number;
  lng?: number;
};

type GeoAddr = {
  id: string;
  address: string;
  lat?: number;
  lng?: number;
};

type RoutePreview = {
  anchor: { address: string; lat: number; lng: number };
  endAnchor?: { address: string; lat: number; lng: number };
  stops: { id: number; lat: number; lng: number; addresses: { address: string }[] }[];
  geometry: [number, number][] | null;
};

// ── Appointments result view ───────────────────────────────────────────────────

function AppointmentsResultView({ result, inputs }: { result: Record<string, unknown>; inputs: Record<string, unknown> }) {
  const schedules = (result.schedules as Array<{
    repId: string;
    assignments: Array<{ apptId: string; travelSec: number }>;
  }>) ?? [];

  const geocodedAppts = (result.geocodedAppts as GeoAppt[]) ?? [];
  const apptById = new Map(geocodedAppts.map((a) => [a.id, a]));
  const durationHours = (inputs.durationHours as number) ?? 1;

  // Prefer rep snapshot saved with the plan; fall back to fetching current reps
  const savedReps = (inputs.reps as RepSnapshot[] | undefined) ?? [];
  const [fetchedReps, setFetchedReps] = useState<RepSnapshot[]>([]);

  useEffect(() => {
    if (savedReps.length > 0) return; // snapshot present — no need to fetch
    fetch("/api/reps")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setFetchedReps(
            (data as Record<string, unknown>[]).map((r) => ({
              id:          String(r.id ?? ""),
              name:        String(r.name ?? ""),
              homeAddress: typeof r.homeAddress === "string" ? r.homeAddress : undefined,
              homeLat:     typeof r.homeLat === "number" ? r.homeLat : null,
              homeLng:     typeof r.homeLng === "number" ? r.homeLng : null,
            }))
          );
        }
      })
      .catch(() => { /* no-op — names simply won't resolve */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reps = savedReps.length > 0 ? savedReps : fetchedReps;
  const repById = new Map(reps.map((r) => [r.id, r]));

  const [expandedRepId, setExpandedRepId] = useState<string | null>(null);
  // Per-rep focused step: keyed by repId so each rep has its own highlight state
  const [focusedSteps, setFocusedSteps] = useState<Record<string, number | null>>({});
  const [routePreviews, setRoutePreviews] = useState<Map<string, RoutePreview | null>>(new Map());
  const [loadingRepId, setLoadingRepId] = useState<string | null>(null);

  function getFocused(repId: string): number | null {
    return focusedSteps[repId] ?? null;
  }

  function setFocused(repId: string, idx: number | null) {
    setFocusedSteps((prev) => ({ ...prev, [repId]: idx }));
  }

  async function handleToggleRep(repId: string) {
    const next = expandedRepId === repId ? null : repId;
    setExpandedRepId(next);
    if (!next) return;

    // Already fetched — don't re-fetch
    if (routePreviews.has(repId)) return;

    const rep = repById.get(repId);
    if (!rep?.homeLat || !rep?.homeLng) {
      setRoutePreviews((prev) => new Map(prev).set(repId, null));
      return;
    }

    const schedule = schedules.find((s) => s.repId === repId);
    if (!schedule) return;

    // Sort assignments by appointment time
    const orderedAppts = [...schedule.assignments]
      .map((a) => apptById.get(a.apptId))
      .filter((a): a is GeoAppt => !!a && a.lat != null && a.lng != null)
      .sort((a, b) => {
        const toInt = (hhmm: string) => parseInt((hhmm ?? "0000").replace(":", "").padStart(4, "0"));
        return toInt(a.timeHHMM) - toInt(b.timeHHMM);
      });

    if (orderedAppts.length === 0) {
      setRoutePreviews((prev) => new Map(prev).set(repId, null));
      return;
    }

    setLoadingRepId(repId);

    const anchor = { address: rep.homeAddress ?? "", lat: rep.homeLat, lng: rep.homeLng };
    const stops = orderedAppts.map((a, idx) => ({
      id: idx + 1,
      lat: a.lat!,
      lng: a.lng!,
      addresses: [{ address: a.urn || a.address }],
    }));

    // Fetch OSRM route geometry (home → appts → home)
    const waypoints = [
      { lat: rep.homeLat, lng: rep.homeLng },
      ...orderedAppts.map((a) => ({ lat: a.lat!, lng: a.lng! })),
      { lat: rep.homeLat, lng: rep.homeLng },
    ];
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    let geometry: [number, number][] | null = null;
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`
      );
      const data = await res.json() as { routes?: Array<{ geometry: { coordinates: [number, number][] } }> };
      if (data.routes?.[0]?.geometry?.coordinates) {
        geometry = data.routes[0].geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
        );
      }
    } catch { /* fall back to straight lines */ }

    setRoutePreviews((prev) => new Map(prev).set(repId, { anchor, stops, geometry }));
    setLoadingRepId(null);
  }

  function fmt(hhmm: string) {
    const s = (hhmm ?? "").replace(":", "").trim();
    return s.length === 4 ? `${s.slice(0, 2)}:${s.slice(2)}` : s;
  }

  if (schedules.length === 0) {
    return <p className="text-sm text-coal/50 text-center py-8">No appointments plan data available.</p>;
  }

  return (
    <div className="space-y-3">
      {schedules.map((sched) => {
        const rep = repById.get(sched.repId);
        const repName = rep?.name ?? sched.repId;
        const isExpanded = expandedRepId === sched.repId;
        const preview = routePreviews.get(sched.repId);
        const isLoading = loadingRepId === sched.repId;
        const focusedStepIdx = getFocused(sched.repId);

        // Sort assignments by time for display
        const sortedAssignments = [...sched.assignments].sort((a, b) => {
          const ta = apptById.get(a.apptId);
          const tb = apptById.get(b.apptId);
          const toInt = (hhmm: string) => parseInt((hhmm ?? "0000").replace(":", "").padStart(4, "0"));
          return toInt(ta?.timeHHMM ?? "0000") - toInt(tb?.timeHHMM ?? "0000");
        });

        return (
          <div key={sched.repId} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Rep header — clickable */}
            <button
              className="w-full text-left px-4 py-3 bg-gray-50 border-b border-gray-100 hover:bg-gray-100 transition-colors flex items-center justify-between gap-2"
              onClick={() => handleToggleRep(sched.repId)}
            >
              <div>
                <p className="text-sm font-semibold text-coal">{repName}</p>
                <p className="text-xs text-coal/50 mt-0.5">
                  {sched.assignments.length} appointment{sched.assignments.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isLoading && (
                  <div className="w-4 h-4 border-2 border-loch border-t-transparent rounded-full animate-spin" />
                )}
                <svg
                  width="14" height="14" viewBox="0 0 16 16" fill="none"
                  className={`text-coal/40 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                >
                  <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </button>

            {isExpanded && (
              <>
                {/* Map */}
                {preview && (
                  <div className="h-56 border-b border-gray-100">
                    <MapView
                      anchor={preview.anchor}
                      stops={preview.stops}
                      routeGeometry={preview.geometry}
                      focusedSegmentIdx={focusedStepIdx}
                    />
                  </div>
                )}
                {!preview && !isLoading && rep?.homeLat && (
                  <div className="h-12 flex items-center justify-center text-xs text-coal/40 border-b border-gray-100">
                    No map data available for this route.
                  </div>
                )}

                {/* Route steps */}
                <ol className="divide-y divide-gray-50">
                  {/* Start row */}
                  {rep?.homeAddress && (
                    <li className="flex items-start gap-3 px-4 py-3">
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-map-anchor text-white text-xs font-bold flex items-center justify-center mt-0.5">S</span>
                      <div>
                        <p className="text-xs font-semibold text-map-anchor uppercase tracking-wide">Start</p>
                        <p className="text-sm font-semibold text-coal mt-0.5">Home</p>
                        <p className="text-xs text-coal/50">{rep.homeAddress}</p>
                      </div>
                    </li>
                  )}

                  {/* Appointment stop rows */}
                  {sortedAssignments.map((a, idx) => {
                    const appt = apptById.get(a.apptId);
                    if (!appt) return null;
                    const endMins =
                      parseInt(appt.timeHHMM.slice(0, 2)) * 60 +
                      parseInt(appt.timeHHMM.slice(2)) +
                      durationHours * 60;
                    const endH = String(Math.floor(endMins / 60) % 24).padStart(2, "0");
                    const endM = String(endMins % 60).padStart(2, "0");
                    const isFocused = focusedStepIdx === idx;
                    return (
                      <li
                        key={a.apptId}
                        onClick={() => setFocused(sched.repId, focusedStepIdx === idx ? null : idx)}
                        className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${isFocused ? "ring-2 ring-inset ring-loch/40 bg-loch/5" : "hover:bg-gray-50"}`}
                      >
                        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-loch text-white text-xs font-bold flex items-center justify-center mt-0.5">
                          {idx + 1}
                        </span>
                        <div>
                          {a.travelSec > 0 && (
                            <p className="text-xs text-green-600 mb-0.5">↓ ~{Math.round(a.travelSec / 60)}m travel</p>
                          )}
                          <p className="text-sm font-semibold text-coal">{appt.urn || appt.address}</p>
                          {appt.urn && <p className="text-xs text-coal/50">{appt.address}</p>}
                          <p className="text-xs text-coal/60">{fmt(appt.timeHHMM)} – {endH}:{endM}</p>
                        </div>
                      </li>
                    );
                  })}

                  {/* End row */}
                  {rep?.homeAddress && (
                    <li className="flex items-start gap-3 px-4 py-3">
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-map-anchor text-white text-xs font-bold flex items-center justify-center mt-0.5">E</span>
                      <div>
                        <p className="text-xs font-semibold text-map-anchor uppercase tracking-wide">End</p>
                        <p className="text-sm font-semibold text-coal mt-0.5">Home</p>
                        <p className="text-xs text-coal/50">{rep.homeAddress}</p>
                      </div>
                    </li>
                  )}
                </ol>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Canvass result view ────────────────────────────────────────────────────────

function CanvassResultView({ result, inputs }: { result: Record<string, unknown>; inputs: Record<string, unknown> }) {
  type DayPlan = {
    date: string;
    routes: Array<{
      canvasserId: string;
      stops: Array<{ addressIds: string[]; travelSec: number }>;
    }>;
  };

  const days = (result.days as DayPlan[]) ?? [];
  const geocodedAddresses = (result.geocodedAddresses as GeoAddr[]) ?? [];
  const addrById = new Map(geocodedAddresses.map((a) => [a.id, a]));
  const durationMins = (inputs.durationMins as number) ?? 20;

  // Prefer canvasser snapshot saved with the plan; fall back to fetching current canvassers
  const savedCanvassers = (inputs.canvassers as CanvasserSnapshot[] | undefined) ?? [];
  const [fetchedCanvassers, setFetchedCanvassers] = useState<CanvasserSnapshot[]>([]);

  useEffect(() => {
    if (savedCanvassers.length > 0) return;
    fetch("/api/canvassers")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setFetchedCanvassers(
            (data as Record<string, unknown>[]).map((c) => ({
              id:           String(c.id ?? ""),
              name:         String(c.name ?? ""),
              homeAddress:  String(c.homeAddress ?? ""),
              homeLat:      typeof c.homeLat === "number" ? c.homeLat : null,
              homeLng:      typeof c.homeLng === "number" ? c.homeLng : null,
              startAddress: String(c.homeAddress ?? ""),
              startLat:     typeof c.homeLat === "number" ? c.homeLat : null,
              startLng:     typeof c.homeLng === "number" ? c.homeLng : null,
              startLabel:   "Home",
              endAddress:   String(c.homeAddress ?? ""),
              endLat:       typeof c.homeLat === "number" ? c.homeLat : null,
              endLng:       typeof c.homeLng === "number" ? c.homeLng : null,
              endLabel:     "Home",
            }))
          );
        }
      })
      .catch(() => { /* no-op */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canvassers = savedCanvassers.length > 0 ? savedCanvassers : fetchedCanvassers;
  const canvasserById = new Map(canvassers.map((c) => [c.id, c]));

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Per-canvasser:date focused step
  const [focusedSteps, setFocusedSteps] = useState<Record<string, number | null>>({});
  const [routePreviews, setRoutePreviews] = useState<Map<string, RoutePreview | null>>(new Map());
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  function getFocused(key: string): number | null {
    return focusedSteps[key] ?? null;
  }

  function setFocused(key: string, idx: number | null) {
    setFocusedSteps((prev) => ({ ...prev, [key]: idx }));
  }

  async function handleToggleCanvasser(canvasserId: string, date: string) {
    const key = `${canvasserId}:${date}`;
    const next = expandedKey === key ? null : key;
    setExpandedKey(next);
    if (!next) return;

    if (routePreviews.has(key)) return;

    const canvasser = canvasserById.get(canvasserId);
    if (!canvasser?.startLat || !canvasser?.startLng) {
      setRoutePreviews((prev) => new Map(prev).set(key, null));
      return;
    }

    const day = days.find((d) => d.date === date);
    const route = day?.routes.find((r) => r.canvasserId === canvasserId);
    if (!route || route.stops.length === 0) {
      setRoutePreviews((prev) => new Map(prev).set(key, null));
      return;
    }

    const orderedStops = route.stops.map((s) => {
      const firstAddr = s.addressIds.map((id) => addrById.get(id)).find(
        (a): a is GeoAddr => !!a && a.lat != null && a.lng != null
      );
      if (!firstAddr) return null;
      const allAddrs = s.addressIds.map((id) => addrById.get(id)).filter(Boolean) as GeoAddr[];
      return { lat: firstAddr.lat!, lng: firstAddr.lng!, addresses: allAddrs.map((a) => ({ address: a.address })) };
    }).filter((s): s is NonNullable<typeof s> => s !== null);

    if (orderedStops.length === 0) {
      setRoutePreviews((prev) => new Map(prev).set(key, null));
      return;
    }

    setLoadingKey(key);

    const endLat = canvasser.endLat ?? canvasser.startLat;
    const endLng = canvasser.endLng ?? canvasser.startLng;
    const waypoints = [
      { lat: canvasser.startLat, lng: canvasser.startLng },
      ...orderedStops,
      { lat: endLat, lng: endLng },
    ];
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    let geometry: [number, number][] | null = null;
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`
      );
      const data = await res.json() as { routes?: Array<{ geometry: { coordinates: [number, number][] } }> };
      if (data.routes?.[0]?.geometry?.coordinates) {
        geometry = data.routes[0].geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
        );
      }
    } catch { /* fall back to straight lines */ }

    const anchor = { address: canvasser.startAddress, lat: canvasser.startLat, lng: canvasser.startLng };
    // Only add endAnchor when it's a genuinely different location
    const hasDifferentEnd =
      canvasser.endLat != null &&
      canvasser.endLng != null &&
      (Math.abs(canvasser.endLat - canvasser.startLat) > 0.0001 ||
       Math.abs(canvasser.endLng - canvasser.startLng) > 0.0001);
    const endAnchor = hasDifferentEnd
      ? { address: canvasser.endAddress, lat: canvasser.endLat!, lng: canvasser.endLng! }
      : undefined;
    const stops = orderedStops.map((s, i) => ({ id: i + 1, lat: s.lat, lng: s.lng, addresses: s.addresses }));
    setRoutePreviews((prev) => new Map(prev).set(key, { anchor, endAnchor, stops, geometry }));
    setLoadingKey(null);
  }

  if (days.length === 0) {
    return <p className="text-sm text-coal/50 text-center py-8">No canvass plan data available.</p>;
  }

  return (
    <div className="space-y-4">
      {days.map((day) => {
        const dateLabel = new Date(day.date + "T12:00:00").toLocaleDateString("en-GB", {
          weekday: "long", day: "numeric", month: "long",
        });
        const totalAddresses = day.routes.reduce(
          (n, r) => n + r.stops.reduce((m, s) => m + s.addressIds.length, 0), 0
        );
        return (
          <div key={day.date} className="space-y-3">
            {/* Day header */}
            <div className="px-1">
              <p className="text-xs font-semibold text-coal/60 uppercase tracking-widest">{dateLabel}</p>
              <p className="text-xs text-coal/40 mt-0.5">{day.routes.length} canvasser{day.routes.length !== 1 ? "s" : ""} · {totalAddresses} addresses</p>
            </div>

            {/* Canvasser rows */}
            {day.routes.map((route) => {
              const key = `${route.canvasserId}:${day.date}`;
              const canvasser = canvasserById.get(route.canvasserId);
              const canvasserName = canvasser?.name ?? route.canvasserId;
              const isExpanded = expandedKey === key;
              const preview = routePreviews.get(key);
              const isLoading = loadingKey === key;
              const totalAddrs = route.stops.reduce((n, s) => n + s.addressIds.length, 0);
              const focusedStepIdx = getFocused(key);

              return (
                <div key={key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  {/* Canvasser header */}
                  <button
                    className="w-full text-left px-4 py-3 bg-gray-50 border-b border-gray-100 hover:bg-gray-100 transition-colors flex items-center justify-between gap-2"
                    onClick={() => handleToggleCanvasser(route.canvasserId, day.date)}
                  >
                    <div>
                      <p className="text-sm font-semibold text-coal">{canvasserName}</p>
                      <p className="text-xs text-coal/50 mt-0.5">
                        {totalAddrs} address{totalAddrs !== 1 ? "es" : ""} · {route.stops.length} stop{route.stops.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isLoading && (
                        <div className="w-4 h-4 border-2 border-loch border-t-transparent rounded-full animate-spin" />
                      )}
                      <svg
                        width="14" height="14" viewBox="0 0 16 16" fill="none"
                        className={`text-coal/40 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      >
                        <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </button>

                  {isExpanded && (
                    <>
                      {/* Map */}
                      {preview && (
                        <div className="h-56 border-b border-gray-100">
                          <MapView
                            anchor={preview.anchor}
                            endAnchor={preview.endAnchor}
                            stops={preview.stops}
                            routeGeometry={preview.geometry}
                            focusedSegmentIdx={focusedStepIdx}
                          />
                        </div>
                      )}
                      {!preview && !isLoading && canvasser?.startLat && (
                        <div className="h-12 flex items-center justify-center text-xs text-coal/40 border-b border-gray-100">
                          No map data available for this route.
                        </div>
                      )}

                      {/* Route steps */}
                      <ol className="divide-y divide-gray-50">
                        {/* Start row */}
                        {canvasser && (
                          <li className="flex items-start gap-3 px-4 py-3">
                            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-map-anchor text-white text-xs font-bold flex items-center justify-center mt-0.5">S</span>
                            <div>
                              <p className="text-xs font-semibold text-map-anchor uppercase tracking-wide">Start</p>
                              <p className="text-sm font-semibold text-coal mt-0.5">{canvasser.startLabel}</p>
                              <p className="text-xs text-coal/50">{canvasser.startAddress}</p>
                            </div>
                          </li>
                        )}

                        {/* Stop rows */}
                        {route.stops.map((stop, idx) => {
                          const stopAddrs = stop.addressIds.map((id) => addrById.get(id)).filter(Boolean) as GeoAddr[];
                          const doorMins = durationMins * stop.addressIds.length;
                          const isFocused = focusedStepIdx === idx;
                          return (
                            <li
                              key={stop.addressIds[0] ?? idx}
                              onClick={() => setFocused(key, focusedStepIdx === idx ? null : idx)}
                              className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${isFocused ? "ring-2 ring-inset ring-loch/40 bg-loch/5" : "hover:bg-gray-50"}`}
                            >
                              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-loch text-white text-xs font-bold flex items-center justify-center mt-0.5">
                                {idx + 1}
                              </span>
                              <div>
                                {stop.travelSec > 0 && (
                                  <p className="text-xs text-green-600 mb-0.5">↓ ~{Math.round(stop.travelSec / 60)}m travel</p>
                                )}
                                {stopAddrs.length > 0 ? (
                                  <div>
                                    {stopAddrs.map((a, i) => (
                                      <p key={i} className="text-sm font-semibold text-coal">{a.address}</p>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm font-semibold text-coal">{stop.addressIds[0]}</p>
                                )}
                                {doorMins > 0 && (
                                  <p className="text-xs text-coal/50 mt-0.5">Approx {doorMins} min{doorMins === 1 ? "" : "s"} at door</p>
                                )}
                              </div>
                            </li>
                          );
                        })}

                        {/* End row */}
                        {canvasser && (
                          <li className="flex items-start gap-3 px-4 py-3">
                            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-map-anchor text-white text-xs font-bold flex items-center justify-center mt-0.5">E</span>
                            <div>
                              <p className="text-xs font-semibold text-map-anchor uppercase tracking-wide">End</p>
                              <p className="text-sm font-semibold text-coal mt-0.5">{canvasser.endLabel}</p>
                              <p className="text-xs text-coal/50">{canvasser.endAddress}</p>
                            </div>
                          </li>
                        )}
                      </ol>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
