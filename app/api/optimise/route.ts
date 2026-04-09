import { NextRequest, NextResponse } from "next/server";

interface Stop {
  id: number;
  address: string;
  lat: number;
  lng: number;
}

interface Anchor {
  address: string;
  lat: number;
  lng: number;
}

interface OsrmTripResponse {
  code: string;
  trips: Array<{
    geometry: {
      type: "LineString";
      coordinates: Array<[number, number]>; // GeoJSON: [lng, lat]
    };
    distance: number; // metres
    duration: number; // seconds — total trip
    legs: Array<{
      distance: number; // metres
      duration: number; // seconds
    }>;
  }>;
  waypoints: Array<{
    waypoint_index: number; // position in the optimised trip
    trips_index: number;
    location: [number, number];
    name: string;
  }>;
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Straight-line nearest-neighbour — used as OSRM fallback */
function nearestNeighbour(anchor: Anchor, stops: Stop[]): number[] {
  const remaining = stops.map((s) => s.id);
  const ordered: number[] = [];
  let current: { lat: number; lng: number } = anchor;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const stop = stops[remaining[i]];
      const dist = haversine(current, stop);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const chosenId = remaining[nearestIdx];
    ordered.push(chosenId);
    current = stops[chosenId];
    remaining.splice(nearestIdx, 1);
  }

  return ordered;
}

/**
 * OSRM /trip — road-distance TSP with full road geometry.
 * Returns null on any failure so callers can fall back gracefully.
 */
async function osrmTrip(
  anchor: Anchor,
  stops: Stop[],
  endAnchor?: Anchor
): Promise<{
  orderIds: number[];
  routeGeometry: [number, number][];
  roadDistanceKm: number;
  legDurationsS: number[];
} | null> {
  const hasDifferentEnd = !!endAnchor;
  // OSRM expects lng,lat pairs separated by semicolons
  const all = hasDifferentEnd
    ? [anchor, ...stops, endAnchor!]
    : [anchor, ...stops];
  const coords = all.map((p) => `${p.lng},${p.lat}`).join(";");

  const tripParams = hasDifferentEnd
    ? "roundtrip=false&source=first&destination=last"
    : "roundtrip=true&source=first";

  const url =
    `https://router.project-osrm.org/trip/v1/driving/${coords}` +
    `?${tripParams}&geometries=geojson&overview=full`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CRSmith-CanvassingRoutePlanner/1.0 (internal@crsmith.co.uk)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;

    const data: OsrmTripResponse = await res.json();
    if (data.code !== "Ok" || !data.trips?.[0] || !data.waypoints) return null;

    const trip = data.trips[0];

    // waypoints[0] = startAnchor, waypoints[N+1] = endAnchor (when different end)
    // middle waypoints are stops in input order — sort by waypoint_index for visit order
    const middleWaypoints = hasDifferentEnd
      ? data.waypoints.slice(1, -1)  // exclude start and end anchors
      : data.waypoints.slice(1);     // exclude only start anchor (roundtrip)

    const stopWaypoints = middleWaypoints.map((wp, inputIdx) => ({
      inputIdx,
      tripIdx: wp.waypoint_index,
    }));
    stopWaypoints.sort((a, b) => a.tripIdx - b.tripIdx);
    const orderIds = stopWaypoints.map(({ inputIdx }) => stops[inputIdx].id);

    // GeoJSON uses [lng, lat]; Leaflet needs [lat, lng] — swap every coord
    const routeGeometry: [number, number][] = trip.geometry.coordinates.map(
      ([lng, lat]) => [lat, lng]
    );

    // legs are in trip-visit order, same order as the sorted stops
    const legDurationsS = trip.legs.map((l) => l.duration);

    return { orderIds, routeGeometry, roadDistanceKm: trip.distance / 1000, legDurationsS };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { anchor, stops, endAnchor } = (await req.json()) as {
    anchor: Anchor;
    stops: Stop[];
    endAnchor?: Anchor;
  };

  if (!anchor || !Array.isArray(stops) || stops.length < 1) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Road-optimised: OSRM handles both stop ordering and path geometry
  const osrm = await osrmTrip(anchor, stops, endAnchor);
  if (osrm) {
    return NextResponse.json(osrm);
  }

  // Fallback: straight-line nearest-neighbour (no road geometry or durations)
  const orderIds = nearestNeighbour(anchor, stops);
  return NextResponse.json({ orderIds, routeGeometry: null, roadDistanceKm: null, legDurationsS: null, fallback: true });
}
