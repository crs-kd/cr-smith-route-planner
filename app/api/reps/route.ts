import { NextResponse } from "next/server";
import { list, put } from "@vercel/blob";

const BLOB_KEY = "cr-smith-reps.json";

export async function GET() {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY });
    if (blobs.length === 0) return NextResponse.json([]);
    const res = await fetch(blobs[0].url, { cache: "no-store" });
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
    const reps = await req.json();
    await put(BLOB_KEY, JSON.stringify(reps), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to save reps:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
