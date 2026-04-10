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

// ── Address type ──────────────────────────────────────────────────────────────

export interface CanvassAddress {
  id: string;
  address: string;
  lat?: number;
  lng?: number;
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface DayPlan {
  /** "YYYY-MM-DD" */
  date: string;
  routes: {
    canvasserId: string;
    /** Ordered address IDs */
    addressIds: string[];
    /** Travel seconds to each address from previous stop */
    travelSecs: number[];
  }[];
}

export interface CanvassResult {
  days: DayPlan[];
  /** Address IDs that could not be assigned within the day limit */
  unassigned: string[];
}

// ── Location matrix ───────────────────────────────────────────────────────────

export interface CanvassLocationMatrix {
  locations: { lat: number; lng: number }[];
  canvasserStartIndices: number[];
  canvasserEndIndices: number[];
  addressIndices: number[];
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
  geocodedAddresses: CanvassAddress[],
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

  const addressIndices: number[] = [];
  for (const addr of geocodedAddresses) {
    addressIndices.push(addLoc(addr.lat!, addr.lng!));
  }

  return { locations, canvasserStartIndices, canvasserEndIndices, addressIndices };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Greedy nearest-neighbour multi-day canvass scheduler.
 *
 * For each day, each working canvasser takes addresses from the remaining pool
 * in nearest-first order, stopping when their available time (including the
 * return journey) would be exceeded.
 */
export function scheduleCanvass(
  canvassers: Canvasser[],
  geocodedAddresses: CanvassAddress[],
  startDate: Date,
  bases: SalesBase[],
  travelMatrix: (number | null)[][],
  locMatrix: CanvassLocationMatrix,
  durationMinsPerAddress = 20
): CanvassResult {
  const durationSecs = durationMinsPerAddress * 60;
  const MAX_DAYS = 14;

  const remaining = new Set<string>(geocodedAddresses.map((a) => a.id));

  // Build fast lookups
  const addrById = new Map<string, CanvassAddress>(
    geocodedAddresses.map((a) => [a.id, a])
  );
  const addrLocByAddrId = new Map<string, number>();
  geocodedAddresses.forEach((a, i) =>
    addrLocByAddrId.set(a.id, locMatrix.addressIndices[i])
  );

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

    // Snapshot remaining at start of day so canvassers share from the same pool
    // (each address goes to the first canvasser who claims it)
    for (const { c, i: ci } of workingPairs) {
      const startMins = parseHHMM(c.startTime);
      const endMins   = parseHHMM(c.endTime);
      if (endMins <= startMins) continue;
      const availableSecs = (endMins - startMins) * 60;

      let currentLocIdx = locMatrix.canvasserStartIndices[ci];
      const endLocIdx   = locMatrix.canvasserEndIndices[ci];
      let usedSecs = 0;

      const assignedIds: string[] = [];
      const assignedTravelSecs: number[] = [];

      // Collect remaining pool as array for iteration
      const pool = [...remaining].map((id) => addrById.get(id)!).filter(Boolean);

      while (pool.length > 0) {
        // Find nearest address in remaining pool from current location
        let bestId: string | null = null;
        let bestTravel = Infinity;
        let bestLocIdx = -1;

        for (const addr of pool) {
          const locIdx = addrLocByAddrId.get(addr.id)!;
          const travel = travelMatrix[currentLocIdx]?.[locIdx] ?? Infinity;
          if (travel < bestTravel) {
            bestTravel = travel;
            bestId = addr.id;
            bestLocIdx = locIdx;
          }
        }

        if (bestId === null || bestTravel === Infinity) break;

        // Check we can visit and still return to end location in time
        const returnTravel = travelMatrix[bestLocIdx]?.[endLocIdx] ?? 0;
        if (usedSecs + bestTravel + durationSecs + returnTravel > availableSecs) break;

        // Claim address
        assignedIds.push(bestId);
        assignedTravelSecs.push(bestTravel);
        usedSecs += bestTravel + durationSecs;
        currentLocIdx = bestLocIdx;
        remaining.delete(bestId);
        pool.splice(
          pool.findIndex((a) => a.id === bestId),
          1
        );
        anyAssigned = true;
      }

      if (assignedIds.length > 0) {
        routes.push({
          canvasserId: c.id,
          addressIds: assignedIds,
          travelSecs: assignedTravelSecs,
        });
      }
    }

    if (routes.length > 0) {
      days.push({ date: dateStr, routes });
    }

    // If working canvassers couldn't assign anything, remaining pool is unreachable
    if (!anyAssigned && workingPairs.length > 0) break;
  }

  return { days, unassigned: [...remaining] };
}
