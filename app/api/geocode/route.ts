import { NextRequest, NextResponse } from "next/server";

export interface GeocodedAddress {
  address: string;
  lat: number;
  lng: number;
  displayName: string;
  isAnchor?: boolean;
  fallback?: boolean; // true when resolved to postcode area rather than exact address
}

export interface FailedAddress {
  address: string;
  reason: string;
}

/** Normalise an address string: collapse tabs, extra spaces, etc. */
function cleanAddress(raw: string): string {
  return raw
    .split(/\t+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join(", ")
    .replace(/,\s*,/g, ",") // remove double commas
    .trim();
}

/** Extract a UK postcode from a string, e.g. "IV13 7XY" */
function extractPostcode(s: string): string | null {
  const m = s.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : null;
}

async function nominatim(query: string): Promise<{ lat: number; lng: number; display_name: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&countrycodes=gb&addressdetails=1`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "CRSmith-CanvassingRoutePlanner/1.0 (internal@crsmith.co.uk)",
        "Accept-Language": "en-GB",
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const results: Array<{
      lat: string; lon: string; display_name: string;
      address: { country_code: string };
    }> = await res.json();
    const uk = results.find((r) => r.address?.country_code === "gb") ?? results[0];
    if (!uk) return null;
    return { lat: parseFloat(uk.lat), lng: parseFloat(uk.lon), display_name: uk.display_name };
  } catch {
    return null;
  }
}

/** Postcodes.io — authoritative UK postcode → lat/lng. No API key required. */
async function postcodeIo(postcode: string): Promise<{ lat: number; lng: number } | null> {
  const clean = postcode.replace(/\s+/g, "");
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${clean}`, {
      next: { revalidate: 86400 }, // postcodes don't change often
    });
    if (!res.ok) return null;
    const data: { status: number; result: { latitude: number; longitude: number } | null } =
      await res.json();
    if (data.status !== 200 || !data.result) return null;
    return { lat: data.result.latitude, lng: data.result.longitude };
  } catch {
    return null;
  }
}

async function geocodeAddress(
  raw: string
): Promise<{ ok: GeocodedAddress } | { fail: FailedAddress }> {
  const cleaned = cleanAddress(raw);
  const postcode = extractPostcode(cleaned);

  // 1. Try Nominatim with the full cleaned address
  const full = await nominatim(cleaned);
  if (full) {
    return { ok: { address: raw, lat: full.lat, lng: full.lng, displayName: full.display_name } };
  }

  // 2. Fall back to Postcodes.io — accurate for any valid UK postcode
  if (postcode) {
    const pc = await postcodeIo(postcode);
    if (pc) {
      return {
        ok: {
          address: raw,
          lat: pc.lat,
          lng: pc.lng,
          displayName: `${postcode} (postcode area)`,
          fallback: true,
        },
      };
    }
  }

  return {
    fail: {
      address: raw,
      reason: postcode
        ? `Address not found and postcode ${postcode} is not recognised`
        : `No result for "${cleaned}" — no recognisable UK postcode found`,
    },
  };
}

export async function POST(req: NextRequest) {
  const { anchor, addresses, endAddress } = (await req.json()) as {
    anchor: string;
    addresses: string[];
    endAddress?: string;
  };

  if (!anchor || !Array.isArray(addresses) || addresses.length < 1) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  if (addresses.length > 100) {
    return NextResponse.json({ error: "Maximum 100 addresses" }, { status: 400 });
  }

  // Geocode start anchor
  const anchorResult = await geocodeAddress(anchor);
  if ("fail" in anchorResult) {
    return NextResponse.json(
      { error: `Could not locate the start address: ${anchorResult.fail.reason}` },
      { status: 422 }
    );
  }
  anchorResult.ok.isAnchor = true;

  // Geocode optional separate end anchor
  let endAnchorGeo: GeocodedAddress | undefined;
  if (endAddress && endAddress.trim() && endAddress.trim() !== anchor.trim()) {
    const endResult = await geocodeAddress(endAddress.trim());
    if ("fail" in endResult) {
      return NextResponse.json(
        { error: `Could not locate the end address: ${endResult.fail.reason}` },
        { status: 422 }
      );
    }
    endAnchorGeo = endResult.ok;
  }

  // Geocode stops in batches of 5 (polite to Nominatim rate limits)
  const geocoded: GeocodedAddress[] = [anchorResult.ok];
  const failed: FailedAddress[] = [];

  const batchSize = 5;
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(geocodeAddress));
    for (const r of results) {
      if ("ok" in r) geocoded.push(r.ok);
      else failed.push(r.fail);
    }
    if (i + batchSize < addresses.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return NextResponse.json({ geocoded, failed, ...(endAnchorGeo ? { endAnchorGeo } : {}) });
}
