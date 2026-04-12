import { NextResponse } from "next/server";
import { list, put } from "@vercel/blob";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

const BLOB_KEY = "cr-smith-bases.json";

export async function GET() {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY });
    if (blobs.length === 0) return NextResponse.json(null); // null = use defaults
    const res = await fetch(blobs[0].url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(null);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireSession();
    if (session.role === "viewer") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const bases = await req.json();
    await put(BLOB_KEY, JSON.stringify(bases), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to save bases:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
