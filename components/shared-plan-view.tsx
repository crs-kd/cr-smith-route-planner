"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";

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

export default function SharedPlanView({ plan }: { plan: SharedPlan }) {
  const typeLabel = plan.type === "appointments" ? "Appointments" : "Canvass";
  const typeBadge = plan.type === "appointments" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800";

  const dateLabel = new Date(plan.created_at).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Plan header */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${typeBadge}`}>
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
          <CanvassResultView result={plan.result} />
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

type GeoAppt = {
  id: string;
  address: string;
  timeHHMM: string;
  urn?: string;
  lat?: number;
  lng?: number;
};

type RoutePreview = {
  anchor: { address: string; lat: number; lng: number };
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
  const [routePreviews, setRoutePreviews] = useState<Map<string, RoutePreview | null>>(new Map());
  const [loadingRepId, setLoadingRepId] = useState<string | null>(null);

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
                      focusedSegmentIdx={null}
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
                  {sortedAssignments.map((a, idx) => {
                    const appt = apptById.get(a.apptId);
                    if (!appt) return null;
                    const endMins =
                      parseInt(appt.timeHHMM.slice(0, 2)) * 60 +
                      parseInt(appt.timeHHMM.slice(2)) +
                      durationHours * 60;
                    const endH = String(Math.floor(endMins / 60) % 24).padStart(2, "0");
                    const endM = String(endMins % 60).padStart(2, "0");
                    return (
                      <li key={a.apptId} className="flex items-start gap-3 px-4 py-3">
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

function CanvassResultView({ result }: { result: Record<string, unknown> }) {
  const days = (result.days as Array<{
    date: string;
    routes: Array<{
      canvasserId: string;
      stops: Array<{ addressIds: string[]; travelSec: number }>;
    }>;
  }>) ?? [];

  const geocodedAddresses = (result.geocodedAddresses as Array<{ id: string; address: string }>) ?? [];
  const addrById = new Map(geocodedAddresses.map((a) => [a.id, a.address]));

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
          <div key={day.date} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-sm font-semibold text-coal">{dateLabel}</p>
              <p className="text-xs text-coal/50 mt-0.5">
                {day.routes.length} canvasser{day.routes.length !== 1 ? "s" : ""} · {totalAddresses} addresses
              </p>
            </div>
            {day.routes.map((route) => {
              const totalAddrs = route.stops.reduce((n, s) => n + s.addressIds.length, 0);
              return (
                <div key={route.canvasserId} className="border-t border-gray-100 px-4 py-3">
                  <p className="text-sm font-semibold text-coal mb-2">{totalAddrs} addresses</p>
                  <ol className="space-y-1">
                    {route.stops.map((stop, idx) => {
                      const addrs = stop.addressIds.map((id) => addrById.get(id) ?? id);
                      return (
                        <li key={idx} className="flex gap-2 text-xs">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-loch/10 text-loch font-semibold flex items-center justify-center text-[10px]">
                            {idx + 1}
                          </span>
                          <div>{addrs.map((a, i) => <p key={i} className="text-coal/70">{a}</p>)}</div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
