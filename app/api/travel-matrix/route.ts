import { NextRequest, NextResponse } from "next/server";

interface Location {
  lat: number;
  lng: number;
}

export async function POST(req: NextRequest) {
  const { locations } = (await req.json()) as { locations: Location[] };

  if (!locations || locations.length < 2) {
    return NextResponse.json({ error: "Need at least 2 locations" }, { status: 400 });
  }
  if (locations.length > 60) {
    return NextResponse.json({ error: "Maximum 60 locations" }, { status: 400 });
  }

  const coords = locations.map((l) => `${l.lng},${l.lat}`).join(";");
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "CRSmith-CanvassingRoutePlanner/1.0 (internal@crsmith.co.uk)",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "OSRM table request failed" }, { status: 502 });
    }

    const data = (await res.json()) as {
      code: string;
      durations: (number | null)[][];
    };

    if (data.code !== "Ok" || !data.durations) {
      return NextResponse.json({ error: "No duration data returned" }, { status: 502 });
    }

    return NextResponse.json({ durations: data.durations });
  } catch {
    return NextResponse.json({ error: "Travel matrix request timed out" }, { status: 504 });
  }
}
