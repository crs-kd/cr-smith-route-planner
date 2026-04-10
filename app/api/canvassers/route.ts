import { NextResponse } from "next/server";
import { list, put } from "@vercel/blob";

const BLOB_KEY = "cr-smith-canvassers.json";

export async function GET() {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY });
    if (blobs.length === 0) return NextResponse.json([]);
    const res = await fetch(blobs[0].url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json([]);
  }
}

export async function PUT(req: Request) {
  try {
    const canvassers = await req.json();
    await put(BLOB_KEY, JSON.stringify(canvassers), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to save canvassers:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
