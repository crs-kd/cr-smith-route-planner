// ── Appointment tags ──────────────────────────────────────────────────────────

export const APPT_TAGS = ["door", "8_units", "14_units"] as const;
export type ApptTag = typeof APPT_TAGS[number];
export const APPT_TAG_LABELS: Record<ApptTag, string> = {
  door: "Door",
  "8_units": "8+ Units",
  "14_units": "14+ Units",
};

// ── Sales bases ───────────────────────────────────────────────────────────────

export interface SalesBase {
  id: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
}

/** Built-in defaults — used to seed localStorage on first load. */
export const SALES_BASES: SalesBase[] = [
  { id: "inverness",   name: "Inverness",   address: "Inverness Retail Park, Inverness, IV2 3TQ",         lat: 57.4737, lng: -4.2111 },
  { id: "glasgow",     name: "Glasgow",     address: "Hillington Park, Glasgow, G52 4TR",                  lat: 55.8566, lng: -4.3425 },
  { id: "aberdeen",    name: "Aberdeen",    address: "Dyce Drive, Aberdeen, AB21 0BR",                     lat: 57.2028, lng: -2.1952 },
  { id: "dunfermline", name: "Dunfermline", address: "Pitreavie Business Park, Dunfermline, KY11 8UU",    lat: 56.0490, lng: -3.4350 },
];

/** Widened to string so custom bases work alongside the built-in set. */
export type SalesBaseId = string;

// ── Shared types ──────────────────────────────────────────────────────────────

export interface Rep {
  id: string;
  name: string;
  homeAddress: string;
  homeLat?: number;
  homeLng?: number;
  /** "0900" – "0000" means no start constraint */
  startTime: string;
  /** "1800" – "0000" means no end constraint */
  endTime: string;
  /** Maximum appointments this rep can take */
  maxAppointments: number;
  startLocation: "home" | "base";
  startBaseId?: SalesBaseId;
  endLocation: "home" | "base";
  endBaseId?: SalesBaseId;
  isWorking: boolean;
  tags?: ApptTag[];
}

/** Migrate a rep loaded from localStorage (may have old slot-based shape). */
export function migrateRep(raw: Record<string, unknown>): Rep {
  return {
    id:              String(raw.id ?? Math.random().toString(36).slice(2)),
    name:            String(raw.name ?? ""),
    homeAddress:     String(raw.homeAddress ?? ""),
    homeLat:         typeof raw.homeLat === "number" ? raw.homeLat : undefined,
    homeLng:         typeof raw.homeLng === "number" ? raw.homeLng : undefined,
    startTime:       typeof raw.startTime === "string" ? raw.startTime : "0000",
    endTime:         typeof raw.endTime   === "string" ? raw.endTime   : "0000",
    maxAppointments: typeof raw.maxAppointments === "number" ? raw.maxAppointments : 3,
    startLocation:   raw.startLocation === "base" ? "base" : "home",
    startBaseId:     typeof raw.startBaseId === "string" ? raw.startBaseId as SalesBaseId : undefined,
    endLocation:     raw.endLocation === "base" ? "base" : "home",
    endBaseId:       typeof raw.endBaseId === "string" ? raw.endBaseId as SalesBaseId : undefined,
    isWorking:       raw.isWorking !== false,
    tags:            Array.isArray(raw.tags) ? (raw.tags as string[]).filter(t => typeof t === "string") as ApptTag[] : [],
  };
}

export interface ApptInput {
  id: string;
  /** Customer reference / appointment title shown in route steps */
  urn?: string;
  address: string;
  lat?: number;
  lng?: number;
  /** e.g. "1700" */
  timeHHMM: string;
  geocodeFailed?: boolean;
  tags?: ApptTag[];
}

export type ConflictStatus =
  | "ok"
  | "buffered"           // travelSec > available but within 15-min buffer
  | "infeasible_travel"  // travelSec > available + 15 min
  | "double_booking";    // two appointments at same time for same rep

export interface Assignment {
  apptId: string;
  repId: string;
  /** Seconds to travel from previous location */
  travelSec: number;
  status: ConflictStatus;
}

export interface RepSchedule {
  repId: string;
  /** In visit (time) order */
  assignments: Assignment[];
  /** Minutes since midnight the rep should leave their start location */
  leaveTimeMins: number | null;
  /** Seconds to drive from last appt back to end location */
  returnTravelSec: number | null;
  /** Minutes since midnight the rep arrives at their end location */
  estimatedReturnTimeMins: number | null;
  /** Display address for the start location */
  startAddress: string;
  /** Display address for the end location */
  endAddress: string;
}

export interface ScheduleResult {
  schedules: RepSchedule[];
  unassigned: { apptId: string; reason: string }[];
}

/** Used to pass pre-built location indices to the scheduler. */
export interface LocationMatrix {
  locations: { lat: number; lng: number }[];
  repStartIndices: number[];
  repEndIndices: number[];
  apptIndices: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "1700" → 1020  (minutes since midnight) */
export function parseHHMM(hhmm: string): number {
  const s = (hhmm ?? "").replace(":", "").padStart(4, "0");
  return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(2, 4), 10);
}

/** 1020 → "17:00" */
export function minsToDisplay(totalMins: number): string {
  const h = Math.floor(totalMins / 60) % 24;
  const m = totalMins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Normalise "17:00" or "1700" → "1700" */
export function normaliseHHMM(raw: string): string {
  return (raw ?? "").replace(":", "").trim();
}

export function formatDurationSec(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Determine which base a rep belongs to for grouping purposes.
 * Priority: explicit start base → closest base by home address → "unassigned"
 */
export function getRepBaseId(rep: Rep, bases: SalesBase[]): string {
  if (rep.startLocation === "base" && rep.startBaseId) return rep.startBaseId;
  if (rep.homeLat != null && rep.homeLng != null) {
    let closestId = "unassigned";
    let closestDist = Infinity;
    for (const base of bases) {
      if (base.lat == null || base.lng == null) continue;
      const d = (rep.homeLat - base.lat) ** 2 + (rep.homeLng - base.lng) ** 2;
      if (d < closestDist) { closestDist = d; closestId = base.id; }
    }
    return closestId;
  }
  return "unassigned";
}

/** Find the closest base to a geocoded appointment (mirrors getRepBaseId). */
export function getApptBaseId(appt: ApptInput, bases: SalesBase[]): string {
  if (appt.lat == null || appt.lng == null) return "unassigned";
  let closestId = "unassigned";
  let closestDist = Infinity;
  for (const base of bases) {
    if (base.lat == null || base.lng == null) continue;
    const d = (appt.lat - base.lat) ** 2 + (appt.lng - base.lng) ** 2;
    if (d < closestDist) { closestDist = d; closestId = base.id; }
  }
  return closestId;
}

/** Resolve a rep's start coordinates + address. */
export function getRepStartLoc(
  rep: Rep,
  bases: SalesBase[] = SALES_BASES
): { lat: number; lng: number; address: string } {
  if (rep.startLocation === "base" && rep.startBaseId) {
    const base = bases.find((b) => b.id === rep.startBaseId);
    if (base?.lat != null && base?.lng != null)
      return { lat: base.lat, lng: base.lng, address: `${base.name} base` };
  }
  return { lat: rep.homeLat!, lng: rep.homeLng!, address: rep.homeAddress };
}

/** Resolve a rep's end coordinates + address. */
export function getRepEndLoc(
  rep: Rep,
  bases: SalesBase[] = SALES_BASES
): { lat: number; lng: number; address: string } {
  if (rep.endLocation === "base" && rep.endBaseId) {
    const base = bases.find((b) => b.id === rep.endBaseId);
    if (base?.lat != null && base?.lng != null)
      return { lat: base.lat, lng: base.lng, address: `${base.name} base` };
  }
  return { lat: rep.homeLat!, lng: rep.homeLng!, address: rep.homeAddress };
}

/**
 * Builds a deduplicated list of locations and the corresponding index arrays
 * needed by both the matrix API call and the scheduler.
 */
export function buildLocationMatrix(
  workingReps: Rep[],
  geocodedAppts: ApptInput[],
  bases: SalesBase[] = SALES_BASES
): LocationMatrix {
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

  const repStartIndices: number[] = [];
  const repEndIndices: number[]   = [];
  for (const rep of workingReps) {
    const s = getRepStartLoc(rep, bases);
    const e = getRepEndLoc(rep, bases);
    repStartIndices.push(addLoc(s.lat, s.lng));
    repEndIndices.push(addLoc(e.lat, e.lng));
  }

  const apptIndices: number[] = [];
  for (const appt of geocodedAppts) {
    apptIndices.push(addLoc(appt.lat!, appt.lng!));
  }

  return { locations, repStartIndices, repEndIndices, apptIndices };
}

/** Returns true if the appointment falls within the rep's working window. */
function isInTimeWindow(rep: Rep, apptTimeMins: number, apptEndMins: number): boolean {
  const st = normaliseHHMM(rep.startTime ?? "0000");
  const et = normaliseHHMM(rep.endTime   ?? "0000");
  const noStart = st === "0000";
  const noEnd   = et === "0000";
  if (noStart && noEnd) return true;
  if (!noStart && apptTimeMins < parseHHMM(st)) return false;
  if (!noEnd   && apptEndMins  > parseHHMM(et)) return false;
  return true;
}

// ── Scheduling ────────────────────────────────────────────────────────────────

export function scheduleAppointments(
  reps: Rep[],
  geocodedAppts: ApptInput[],
  durationHours: number,
  travelMatrix: (number | null)[][],
  locMatrix: LocationMatrix,
  bases: SalesBase[] = SALES_BASES
): ScheduleResult {
  const durationMins = durationHours * 60;
  const workingReps  = reps.filter(
    (r) => r.isWorking && r.homeLat != null && r.homeLng != null
  );
  const BUFFER_SEC = 15 * 60;

  const repState = new Map<
    string,
    { lastLocIdx: number; lastEndMins: number; count: number; assignments: Assignment[] }
  >();
  for (let i = 0; i < workingReps.length; i++) {
    const rep = workingReps[i];
    repState.set(rep.id, {
      lastLocIdx: locMatrix.repStartIndices[i],
      lastEndMins: 0,
      count: 0,
      assignments: [],
    });
  }

  // Pre-pass: reserve slots by priority tier so lower-priority appointments
  // cannot crowd out higher-priority ones.
  //   Tier 2 (tag match)  — same area + matching tag
  //   Tier 1 (area only)  — same area, no tag match
  //   Tier 0 (cross-area) — uses whatever slots remain after tier 1 & 2 reservations
  const tagMatchReserved  = new Map<string, number>();
  const tagMatchTaken     = new Map<string, number>();
  const areaOnlyReserved  = new Map<string, number>();
  const areaOnlyTaken     = new Map<string, number>();

  for (const rep of workingReps) {
    const repBaseId = getRepBaseId(rep, bases);
    const repTags   = rep.tags ?? [];

    const tagCount = repTags.length === 0 ? 0 : geocodedAppts.filter((appt) => {
      const apptTags = appt.tags ?? [];
      return apptTags.length > 0
        && apptTags.some((t) => repTags.includes(t))
        && getApptBaseId(appt, bases) === repBaseId;
    }).length;
    const tagReserved = Math.min(tagCount, rep.maxAppointments);

    const areaOnlyCount = geocodedAppts.filter((appt) => {
      const apptTags = appt.tags ?? [];
      const isTagMatch = repTags.length > 0 && apptTags.length > 0
        && apptTags.some((t) => repTags.includes(t));
      return getApptBaseId(appt, bases) === repBaseId && !isTagMatch;
    }).length;
    const areaReserved = Math.min(areaOnlyCount, rep.maxAppointments - tagReserved);

    tagMatchReserved.set(rep.id, tagReserved);
    tagMatchTaken.set(rep.id, 0);
    areaOnlyReserved.set(rep.id, areaReserved);
    areaOnlyTaken.set(rep.id, 0);
  }

  const sorted = [...geocodedAppts].sort(
    (a, b) => parseHHMM(a.timeHHMM) - parseHHMM(b.timeHHMM)
  );
  const unassigned: ScheduleResult["unassigned"] = [];

  for (const appt of sorted) {
    const apptTimeMins = parseHHMM(appt.timeHHMM);
    const apptEndMins  = apptTimeMins + durationMins;
    const apptLocIdx   = locMatrix.apptIndices[geocodedAppts.findIndex((a) => a.id === appt.id)];
    const apptBaseId   = getApptBaseId(appt, bases);
    const apptTags     = appt.tags ?? [];

    let anyInWindow    = false;
    let anyUnderLimit  = false;

    const candidates: { rep: Rep; travelSec: number; status: ConflictStatus; isAreaTagMatch: boolean; isAreaOnly: boolean }[] = [];

    for (let i = 0; i < workingReps.length; i++) {
      const rep   = workingReps[i];
      const state = repState.get(rep.id)!;

      if (!isInTimeWindow(rep, apptTimeMins, apptEndMins)) continue;
      anyInWindow = true;

      const repTags        = rep.tags ?? [];
      const repBaseId      = getRepBaseId(rep, bases);
      const isAreaTagMatch = apptTags.length > 0 && repTags.length > 0
        && apptTags.some((t) => repTags.includes(t))
        && repBaseId === apptBaseId;
      const isAreaOnly = !isAreaTagMatch && repBaseId === apptBaseId;

      // Effective capacity depends on tier:
      //   tag match  → can use any slot
      //   area only  → cannot use tag-reserved slots
      //   cross-area → cannot use tag-reserved or area-reserved slots
      const tagRemaining  = Math.max(0, (tagMatchReserved.get(rep.id) ?? 0) - (tagMatchTaken.get(rep.id) ?? 0));
      const areaRemaining = Math.max(0, (areaOnlyReserved.get(rep.id) ?? 0) - (areaOnlyTaken.get(rep.id) ?? 0));
      const effectiveMax  = isAreaTagMatch
        ? rep.maxAppointments
        : isAreaOnly
          ? rep.maxAppointments - tagRemaining
          : rep.maxAppointments - tagRemaining - areaRemaining;

      if (state.count >= effectiveMax) continue;
      anyUnderLimit = true;

      const travelSec    = travelMatrix[state.lastLocIdx]?.[apptLocIdx] ?? null;
      if (travelSec === null) continue;

      const availableSec = (apptTimeMins - state.lastEndMins) * 60;
      if (travelSec > availableSec + BUFFER_SEC) continue;

      candidates.push({
        rep,
        travelSec,
        isAreaTagMatch,
        isAreaOnly,
        status: travelSec > availableSec ? "buffered" : "ok",
      });
    }

    if (candidates.length === 0) {
      let reason: string;
      if (!anyInWindow) {
        reason = "No working rep has a time window covering this appointment";
      } else if (!anyUnderLimit) {
        reason = "All available reps have reached their appointment limit";
      } else {
        reason = "No rep can travel to this appointment in time";
      }
      unassigned.push({ apptId: appt.id, reason });
      continue;
    }

    candidates.sort((a, b) => {
      const aArea = getRepBaseId(a.rep, bases) === apptBaseId;
      const bArea = getRepBaseId(b.rep, bases) === apptBaseId;
      const aTag  = apptTags.length > 0 && apptTags.some((t) => (a.rep.tags ?? []).includes(t));
      const bTag  = apptTags.length > 0 && apptTags.some((t) => (b.rep.tags ?? []).includes(t));
      // Tier 2: same area + tag match; Tier 1: same area; Tier 0: different area
      const aTier = aArea ? (aTag ? 2 : 1) : 0;
      const bTier = bArea ? (bTag ? 2 : 1) : 0;
      if (aTier !== bTier) return bTier - aTier;
      return a.travelSec - b.travelSec;
    });
    const best  = candidates[0];
    const state = repState.get(best.rep.id)!;

    // Update slot tracking for the correct tier
    if (best.isAreaTagMatch) {
      tagMatchTaken.set(best.rep.id, (tagMatchTaken.get(best.rep.id) ?? 0) + 1);
    } else if (best.isAreaOnly) {
      areaOnlyTaken.set(best.rep.id, (areaOnlyTaken.get(best.rep.id) ?? 0) + 1);
    }

    state.assignments.push({
      apptId: appt.id,
      repId:  best.rep.id,
      travelSec: best.travelSec,
      status:    best.status,
    });
    state.lastLocIdx  = apptLocIdx;
    state.lastEndMins = apptTimeMins + durationMins;
    state.count++;
  }

  const schedules: RepSchedule[] = [];
  for (let i = 0; i < workingReps.length; i++) {
    const rep   = workingReps[i];
    const state = repState.get(rep.id)!;
    if (state.assignments.length === 0) continue;

    const startLoc = getRepStartLoc(rep, bases);
    const endLoc   = getRepEndLoc(rep, bases);

    const firstAppt     = geocodedAppts.find((a) => a.id === state.assignments[0].apptId)!;
    const firstApptIdx  = locMatrix.apptIndices[geocodedAppts.findIndex((a) => a.id === firstAppt.id)];
    const travelToFirst = travelMatrix[locMatrix.repStartIndices[i]]?.[firstApptIdx] ?? 0;
    const leaveTimeMins = parseHHMM(firstAppt.timeHHMM) - Math.ceil(travelToFirst / 60);

    const lastAppt        = geocodedAppts.find((a) => a.id === state.assignments.at(-1)!.apptId)!;
    const lastApptIdx     = locMatrix.apptIndices[geocodedAppts.findIndex((a) => a.id === lastAppt.id)];
    const lastApptEndMins = parseHHMM(lastAppt.timeHHMM) + durationMins;
    const returnTravelSec = travelMatrix[lastApptIdx]?.[locMatrix.repEndIndices[i]] ?? null;
    const estimatedReturnTimeMins =
      returnTravelSec != null ? lastApptEndMins + Math.ceil(returnTravelSec / 60) : null;

    schedules.push({
      repId: rep.id,
      assignments: state.assignments,
      leaveTimeMins,
      returnTravelSec,
      estimatedReturnTimeMins,
      startAddress: startLoc.address,
      endAddress:   endLoc.address,
    });
  }

  return { schedules, unassigned };
}

// ── Conflict recalculation ────────────────────────────────────────────────────

export function recalculateSchedules(
  schedules: RepSchedule[],
  unassigned: ScheduleResult["unassigned"],
  workingReps: Rep[],
  geocodedAppts: ApptInput[],
  durationHours: number,
  travelMatrix: (number | null)[][],
  locMatrix: LocationMatrix,
  bases: SalesBase[] = SALES_BASES
): ScheduleResult {
  const durationMins = durationHours * 60;
  const BUFFER_SEC   = 15 * 60;

  const newSchedules: RepSchedule[] = schedules.map((schedule) => {
    const repIdx = workingReps.findIndex((r) => r.id === schedule.repId);
    const rep    = workingReps[repIdx];
    if (!rep) return schedule;

    const sorted = [...schedule.assignments].sort((a, b) => {
      const ta = geocodedAppts.find((ap) => ap.id === a.apptId);
      const tb = geocodedAppts.find((ap) => ap.id === b.apptId);
      return (ta ? parseHHMM(ta.timeHHMM) : 0) - (tb ? parseHHMM(tb.timeHHMM) : 0);
    });

    const timeSeen = new Map<string, number>();
    for (const a of sorted) {
      const appt = geocodedAppts.find((ap) => ap.id === a.apptId);
      if (!appt) continue;
      timeSeen.set(appt.timeHHMM, (timeSeen.get(appt.timeHHMM) ?? 0) + 1);
    }
    const doubleBooked = new Set(
      [...timeSeen.entries()].filter(([, n]) => n > 1).map(([t]) => t)
    );

    const newAssignments: Assignment[] = sorted.map((assignment, i) => {
      const appt = geocodedAppts.find((ap) => ap.id === assignment.apptId);
      if (!appt) return assignment;

      if (doubleBooked.has(appt.timeHHMM)) {
        return { ...assignment, status: "double_booking" };
      }

      const apptTimeMins = parseHHMM(appt.timeHHMM);
      const apptLocIdx   = locMatrix.apptIndices[geocodedAppts.findIndex((a) => a.id === appt.id)];

      let prevLocIdx: number;
      let prevEndMins: number;
      if (i === 0) {
        prevLocIdx  = locMatrix.repStartIndices[repIdx];
        prevEndMins = 0;
      } else {
        const prevAppt = geocodedAppts.find((ap) => ap.id === sorted[i - 1].apptId);
        prevLocIdx  = prevAppt
          ? locMatrix.apptIndices[geocodedAppts.findIndex((a) => a.id === prevAppt.id)]
          : locMatrix.repStartIndices[repIdx];
        prevEndMins = prevAppt ? parseHHMM(prevAppt.timeHHMM) + durationMins : 0;
      }

      const travelSec    = travelMatrix[prevLocIdx]?.[apptLocIdx] ?? null;
      if (travelSec === null) return { ...assignment, status: "ok" };

      const availableSec = (apptTimeMins - prevEndMins) * 60;
      let status: ConflictStatus = "ok";
      if (travelSec > availableSec + BUFFER_SEC) status = "infeasible_travel";
      else if (travelSec > availableSec)          status = "buffered";

      return { ...assignment, travelSec, status };
    });

    const startLoc = getRepStartLoc(rep, bases);
    const endLoc   = getRepEndLoc(rep, bases);

    const firstAppt    = geocodedAppts.find((a) => a.id === newAssignments[0]?.apptId);
    const firstApptIdx = firstAppt
      ? locMatrix.apptIndices[geocodedAppts.findIndex((a) => a.id === firstAppt.id)]
      : locMatrix.repStartIndices[repIdx];
    const travelToFirst = firstAppt
      ? (travelMatrix[locMatrix.repStartIndices[repIdx]]?.[firstApptIdx] ?? 0) : 0;
    const leaveTimeMins = firstAppt
      ? parseHHMM(firstAppt.timeHHMM) - Math.ceil(travelToFirst / 60) : null;

    const lastAppt        = geocodedAppts.find((a) => a.id === newAssignments.at(-1)?.apptId);
    const lastApptIdx     = lastAppt
      ? locMatrix.apptIndices[geocodedAppts.findIndex((a) => a.id === lastAppt.id)]
      : locMatrix.repStartIndices[repIdx];
    const lastApptEndMins = lastAppt ? parseHHMM(lastAppt.timeHHMM) + durationMins : 0;
    const returnTravelSec = lastAppt
      ? (travelMatrix[lastApptIdx]?.[locMatrix.repEndIndices[repIdx]] ?? null) : null;
    const estimatedReturnTimeMins =
      returnTravelSec != null ? lastApptEndMins + Math.ceil(returnTravelSec / 60) : null;

    return {
      ...schedule,
      assignments: newAssignments,
      leaveTimeMins,
      returnTravelSec,
      estimatedReturnTimeMins,
      startAddress: startLoc.address,
      endAddress:   endLoc.address,
    };
  });

  return { schedules: newSchedules, unassigned };
}
