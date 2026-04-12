import { NextRequest, NextResponse } from "next/server";
import { sql, writeAudit } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();

    let rows;

    if (session.role === "admin") {
      // Admins see all plans
      ({ rows } = await sql`
        SELECT sp.id, sp.name, sp.notes, sp.type, sp.visibility, sp.share_token,
               sp.created_at, sp.updated_at,
               u.name AS creator_name, u.email AS creator_email
        FROM saved_plans sp
        JOIN users u ON u.id = sp.created_by
        ORDER BY sp.created_at DESC
      `);
    } else if (session.role === "editor") {
      // Editors see their own plans + shared plans
      ({ rows } = await sql`
        SELECT sp.id, sp.name, sp.notes, sp.type, sp.visibility, sp.share_token,
               sp.created_at, sp.updated_at,
               u.name AS creator_name, u.email AS creator_email
        FROM saved_plans sp
        JOIN users u ON u.id = sp.created_by
        WHERE sp.created_by = ${session.userId}
           OR sp.visibility IN ('shared','link')
        ORDER BY sp.created_at DESC
      `);
    } else {
      // Viewers see shared/link plans only
      ({ rows } = await sql`
        SELECT sp.id, sp.name, sp.notes, sp.type, sp.visibility, sp.share_token,
               sp.created_at, sp.updated_at,
               u.name AS creator_name, u.email AS creator_email
        FROM saved_plans sp
        JOIN users u ON u.id = sp.created_by
        WHERE sp.visibility IN ('shared','link')
        ORDER BY sp.created_at DESC
      `);
    }

    return NextResponse.json(rows);
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Failed to fetch plans" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (session.role === "viewer") {
      return NextResponse.json({ error: "Viewers cannot save plans" }, { status: 403 });
    }

    const { name, notes, type, visibility, inputs, result } = await req.json() as {
      name?: string;
      notes?: string;
      type?: string;
      visibility?: string;
      inputs?: unknown;
      result?: unknown;
    };

    if (!name || !type || !inputs || !result) {
      return NextResponse.json({ error: "name, type, inputs and result are required" }, { status: 400 });
    }
    if (!["appointments", "canvass"].includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    const vis = (visibility && ["private", "shared", "link"].includes(visibility)) ? visibility : "private";

    const { rows } = await sql`
      INSERT INTO saved_plans (name, notes, type, created_by, visibility, inputs, result)
      VALUES (
        ${name}, ${notes ?? null}, ${type}, ${session.userId},
        ${vis}, ${JSON.stringify(inputs)}, ${JSON.stringify(result)}
      )
      RETURNING id, name, notes, type, visibility, share_token, created_at
    `;

    await writeAudit({
      userId: session.userId,
      userName: session.name,
      action: "plan.saved",
      resourceType: "plan",
      resourceId: rows[0].id as string,
      resourceName: name,
      metadata: { type, visibility: vis },
    });

    return NextResponse.json(rows[0], { status: 201 });
  } catch (e) {
    if (e instanceof NextResponse) return e;
    console.error("Save plan error:", e);
    return NextResponse.json({ error: "Failed to save plan" }, { status: 500 });
  }
}
