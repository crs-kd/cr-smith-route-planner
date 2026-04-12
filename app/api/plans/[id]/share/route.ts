import { NextRequest, NextResponse } from "next/server";
import { sql, writeAudit } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const { rows } = await sql`SELECT * FROM saved_plans WHERE id = ${id}`;
    if (!rows[0]) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    const canShare = session.role === "admin" || rows[0].created_by === session.userId;
    if (!canShare) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Generate or reuse share token
    let token = rows[0].share_token as string | null;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "");
      await sql`
        UPDATE saved_plans
        SET share_token = ${token}, visibility = 'link', updated_at = NOW()
        WHERE id = ${id}
      `;
    }

    await writeAudit({
      userId: session.userId,
      userName: session.name,
      action: "plan.shared",
      resourceType: "plan",
      resourceId: id,
      resourceName: rows[0].name as string,
    });

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? "";
    return NextResponse.json({ token, url: `${origin}/share/${token}` });
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Failed to generate share link" }, { status: 500 });
  }
}
