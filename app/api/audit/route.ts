import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireAdmin();
    void session;

    const { rows } = await sql`
      SELECT id, user_id, user_name, action, resource_type, resource_id, resource_name, created_at
      FROM audit_log
      ORDER BY created_at DESC
      LIMIT 500
    `;
    return NextResponse.json(rows);
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await requireAdmin();
    void session;

    await sql`DELETE FROM audit_log`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Failed to clear audit log" }, { status: 500 });
  }
}
