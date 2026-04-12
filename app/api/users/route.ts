import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, writeAudit } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireAdmin();
    void session;

    const { rows } = await sql`
      SELECT id, email, name, role, tabs, is_active, created_at
      FROM users ORDER BY created_at ASC
    `;
    return NextResponse.json(rows);
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();

    const { email, name, password, role, tabs } = await req.json() as {
      email?: string;
      name?: string;
      password?: string;
      role?: string;
      tabs?: string[];
    };

    if (!email || !name || !password || !role) {
      return NextResponse.json({ error: "email, name, password and role are required" }, { status: 400 });
    }
    if (!["admin", "editor", "viewer"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const assignedTabs = role === "editor" ? (tabs ?? []) : [];

    const { rows } = await sql`
      INSERT INTO users (email, name, password_hash, role, tabs)
      VALUES (${email.toLowerCase().trim()}, ${name}, ${passwordHash}, ${role}, ${assignedTabs as unknown as string})
      RETURNING id, email, name, role, tabs, is_active, created_at
    `;

    await writeAudit({
      userId: session.userId,
      userName: session.name,
      action: "user.created",
      resourceType: "user",
      resourceId: rows[0].id as string,
      resourceName: name,
    });

    return NextResponse.json(rows[0], { status: 201 });
  } catch (e) {
    if (e instanceof NextResponse) return e;
    const err = e as { code?: string };
    if (err.code === "23505") {
      return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
    }
    console.error("Create user error:", e);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
