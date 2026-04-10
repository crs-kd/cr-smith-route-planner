import { SalesBase, parseHHMM } from "./appt-scheduler";

// ── Canvasser type ────────────────────────────────────────────────────────────

export interface Canvasser {
  id: string;
  name: string;
  homeAddress: string;
  homeLat?: number;
  homeLng?: number;
  /** "0900" format */
  startTime: string;
  /** "1700" format */
  endTime: string;
  /** 0=Sun, 1=Mon … 6=Sat */
  workingDays: number[];
  startLocation: "home" | "base";
  startBaseId?: string;
  endLocation: "home" | "base";
  endBaseId?: string;
  isWorking: boolean;
}

export function migrateCanvasser(raw: Record<string, unknown>): Canvasser {
  return {
    id:            String(raw.id ?? Math.random().toString(36).slice(2)),
    name:          String(raw.name ?? ""),
    homeAddress:   String(raw.homeAddress ?? ""),
    homeLat:       typeof raw.homeLat === "number" ? raw.homeLat : undefined,
    homeLng:       typeof raw.homeLng === "number" ? raw.homeLng : undefined,
    startTime:     typeof raw.startTime === "string" ? raw.startTime : "0900",
    endTime:       typeof raw.endTime === "string" ? raw.endTime : "1700",
    workingDays:   Array.isArray(raw.workingDays)
                     ? (raw.workingDays as number[]).filter((d) => typeof d === "number")
                     : [1, 2, 3, 4, 5],
    startLocation: raw.startLocation === "base" ? "base" : "home",
    startBaseId:   typeof raw.startBaseId === "string" ? raw.startBaseId : undefined,
    endLocation:   raw.endLocation === "base" ? "base" : "home",
    endBaseId:     typeof raw.endBaseId === "string" ? raw.endBaseId : undefined,
    isWorking:     raw.isWorking !== false,
  };
}

// ── Address / Stop types ──────────────────────────────────────────────────────

export interface CanvassAddress {
  id: string;
  address: string;
  lat?: number;
  lng?: number;
}

/**
 * A canvass stop is one physical location that may represent multiple addresses
 * (e.g. several flats on the same street that geocode to the same point).
 * Duration at the stop = durationPerAddress × addressIds.length.
 */
export interface CanvassStop {
  /** Representative ID — the first address at this location */
  id: string;
  /** All address IDs at this location */
  addressIds: string[];
  lat: number;
  lng: number;
}

/**
 * Group geocoded addresses by their rounded lat/lng (5 d.p. ≈ 1 m).
 * Addresses that land on the same point are merged into one stop.
 */
export function groupAddressesToStops(addresses: CanvassAddress[]): CanvassStop[] {
  const stopMap = new Map<string, CanvassStop>();
  for (const addr of addresses) {
    const key = `${addr.lat!.toFixed(5)},${addr.lng!.toFixed(5)}`;
    if (stopMap.has(key)) {
      stopMap.get(key)!.addressIds.push(addr.id);
    } else {
      stopMap.set(key, { id: addr.id, addressIds: [addr.id], lat: addr.lat!, lng: addr.lng! });
    }
  }
  return [...stopMap.values()];
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface DayPlan {
  /** "YYYY-MM-DD" */
  date: string;
  routes: {
    canvasserId: string;
    /** Ordered stops — each may contain multiple addresses at the same location */
    stops: {
      /** All address IDs at this location */
      addressIds: string[];
      /** Travel seconds to reach this stop from the previous one */
      travelSec: number;
    }[];
  }[];
}

export interface CanvassResult {
  days: DayPlan[];
  /** Individual address IDs that could not be assigned within the day limit */
  unassigned: string[];
}

// ── Location matrix ───────────────────────────────────────────────────────────

export interface CanvassLocationMatrix {
  locations: { lat: number; lng: number }[];
  canvasserStartIndices: number[];
  canvasserEndIndices: number[];
  /** One index per CanvassStop (in the same order as the stops array) */
  stopIndices: number[];
}

function getCanvasserStartLoc(
  c: Canvasser,
  bases: SalesBase[]
): { lat: number; lng: number } {
  if (c.startLocation === "base" && c.startBaseId) {
    const base = bases.find((b) => b.id === c.startBaseId);
    if (base?.lat != null && base?.lng != null)
      return { lat: base.lat, lng: base.lng };
  }
  return { lat: c.homeLat!, lng: c.homeLng! };
}

function getCanvasserEndLoc(
  c: Canvasser,
  bases: SalesBase[]
): { lat: number; lng: number } {
  if (c.endLocation === "base" && c.endBaseId) {
    const base = bases.find((b) => b.id === c.endBaseId);
    if (base?.lat != null && base?.lng != null)
      return { lat: base.lat, lng: base.lng };
  }
  return { lat: c.homeLat!, lng: c.homeLng! };
}

export function buildCanvassLocationMatrix(
  canvassers: Canvasser[],
  stops: CanvassStop[],
  bases: SalesBase[]
): CanvassLocationMatrix {
  const locations: { lat: number; lng: number }[] = [];
  const keyToIdx = new Map<string, number>();

  function addLoc(lat: number, lng: number): number {
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (keyToIdx.has(key)) return keyToIdx.get(key)!;
    const idx = locations.length;
    locations.push({ lat, lng });
    keyToIdx.set(key, idx);
    return idx;
  }

  const canvasserStartIndices: number[] = [];
  const canvasserEndIndices: number[] = [];
  for (const c of canvassers) {
    const s = getCanvasserStartLoc(c, bases);
    const e = getCanvasserEndLoc(c, bases);
    canvasserStartIndices.push(addLoc(s.lat, s.lng));
    canvasserEndIndices.push(addLoc(e.lat, e.lng));
  }

  const stopIndices: number[] = [];
  for (const stop of stops) {
    stopIndices.push(addLoc(stop.lat, stop.lng));
  }

  return { locations, canvasserStartIndices, canvasserEndIndices, stopIndices };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Greedy nearest-neighbour multi-day canvass scheduler.
 *
 * Operates on CanvassStop[] — each stop may represent multiple addresses.
 * Duration at a stop = durationMinsPerAddress × stop.addressIds.length.
 * Travel time to the stop is counted once regardless of address count.
 */
export function scheduleCanvass(
  canvassers: Canvasser[],
  stops: CanvassStop[],
  startDate: Date,
  bases: SalesBase[],
  travelMatrix: (number | null)[][],
  locMatrix: CanvassLocationMatrix,
  durationMinsPerAddress = 20
): CanvassResult {
  const durationSecsPerAddr = durationMinsPerAddress * 60;
  const MAX_DAYS = 14;

  const remaining = new Set<string>(stops.map((s) => s.id));

  // Fast lookups
  const stopById = new Map<string, CanvassStop>(stops.map((s) => [s.id, s]));
  const stopLocById = new Map<string, number>();
  stops.forEach((s, i) => stopLocById.set(s.id, locMatrix.stopIndices[i]));

  const days: DayPlan[] = [];

  for (let dayOffset = 0; dayOffset < MAX_DAYS && remaining.size > 0; dayOffset++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + dayOffset);
    const weekday = date.getDay();
    const dateStr = date.toISOString().slice(0, 10);

    const workingPairs = canvassers
      .map((c, i) => ({ c, i }))
      .filter(
        ({ c }) =>
          c.isWorking &&
          c.workingDays.includes(weekday) &&
          c.homeLat != null &&
          c.homeLng != null
      );

    if (workingPairs.length === 0) continue;

    const routes: DayPlan["routes"] = [];
    let anyAssigned = false;

    for (const { c, i: ci } of workingPairs) {
      const startMins = parseHHMM(c.startTime);
      const endMins   = parseHHMM(c.endTime);
      if (endMins <= startMins) continue;
      const availableSecs = (endMins - startMins) * 60;

      let currentLocIdx = locMatrix.canvasserStartIndices[ci];
      const endLocIdx   = locMatrix.canvasserEndIndices[ci];
      let usedSecs = 0;

      const assignedStops: DayPlan["routes"][0]["stops"] = [];

      // Working pool for this canvasser's turn
      const pool = [...remaining].map((id) => stopById.get(id)!).filter(Boolean);

      while (pool.length > 0) {
        // Find nearest stop in remaining pool
        let bestId: string | null = null;
        let bestTravel = Infinity;
        let bestLocIdx = -1;

        for (const stop of pool) {
          const locIdx = stopLocById.get(stop.id)!;
          const travel = travelMatrix[currentLocIdx]?.[locIdx] ?? Infinity;
          if (travel < bestTravel) {
            bestTravel = travel;
            bestId = stop.id;
            bestLocIdx = locIdx;
          }
        }

        if (bestId === null || bestTravel === Infinity) break;

        const stop = stopById.get(bestId)!;
        const stopDuration = durationSecsPerAddr * stop.addressIds.length;

        // Check we can visit this stop and still return to end in time
        const returnTravel = travelMatrix[bestLocIdx]?.[endLocIdx] ?? 0;
        if (usedSecs + bestTravel + stopDuration + returnTravel > availableSecs) break;

        // Claim stop
        assignedStops.push({ addressIds: stop.addressIds, travelSec: bestTravel });
        usedSecs += bestTravel + stopDuration;
        currentLocIdx = bestLocIdx;
        remaining.delete(bestId);
        pool.splice(pool.findIndex((s) => s.id === bestId), 1);
        anyAssigned = true;
      }

      if (assignedStops.length > 0) {
        routes.push({ canvasserId: c.id, stops: assignedStops });
      }
    }

    if (routes.length > 0) {
      days.push({ date: dateStr, routes });
    }

    if (!anyAssigned && workingPairs.length > 0) break;
  }

  // Expand unassigned stops back to individual address IDs
  const unassigned = [...remaining].flatMap(
    (id) => stopById.get(id)?.addressIds ?? [id]
  );

  return { days, unassigned };
}
