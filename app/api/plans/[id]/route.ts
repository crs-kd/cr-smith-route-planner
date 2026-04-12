import { NextRequest, NextResponse } from "next/server";
import { sql, writeAudit } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const { rows } = await sql`
      SELECT sp.*, u.name AS creator_name, u.email AS creator_email
      FROM saved_plans sp JOIN users u ON u.id = sp.created_by
      WHERE sp.id = ${id}
    `;

    if (!rows[0]) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    const plan = rows[0];

    // Access control
    const canView =
      session.role === "admin" ||
      plan.created_by === session.userId ||
      plan.visibility === "shared" ||
      plan.visibility === "link";

    if (!canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await writeAudit({
      userId: session.userId,
      userName: session.name,
      action: "plan.viewed",
      resourceType: "plan",
      resourceId: id,
      resourceName: plan.name as string,
    });

    return NextResponse.json(plan);
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Failed to fetch plan" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const { rows: existing } = await sql`SELECT * FROM saved_plans WHERE id = ${id}`;
    if (!existing[0]) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    const canEdit = session.role === "admin" || existing[0].created_by === session.userId;
    if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { name, notes, visibility } = await req.json() as { name?: string; notes?: string; visibility?: string };

    if (name !== undefined) await sql`UPDATE saved_plans SET name = ${name}, updated_at = NOW() WHERE id = ${id}`;
    if (notes !== undefined) await sql`UPDATE saved_plans SET notes = ${notes}, updated_at = NOW() WHERE id = ${id}`;
    if (visibility && ["private", "shared", "link"].includes(visibility)) {
      await sql`UPDATE saved_plans SET visibility = ${visibility}, updated_at = NOW() WHERE id = ${id}`;
    }

    const { rows } = await sql`SELECT id, name, notes, visibility, share_token, updated_at FROM saved_plans WHERE id = ${id}`;
    return NextResponse.json(rows[0]);
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const { rows } = await sql`SELECT * FROM saved_plans WHERE id = ${id}`;
    if (!rows[0]) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    const canDelete = session.role === "admin" || rows[0].created_by === session.userId;
    if (!canDelete) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await sql`DELETE FROM saved_plans WHERE id = ${id}`;

    await writeAudit({
      userId: session.userId,
      userName: session.name,
      action: "plan.deleted",
      resourceType: "plan",
      resourceId: id,
      resourceName: rows[0].name as string,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Failed to delete plan" }, { status: 500 });
  }
}
