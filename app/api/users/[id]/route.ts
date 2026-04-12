import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, writeAudit } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const { name, email, password, role, tabs, isActive } = await req.json() as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
      tabs?: string[];
      isActive?: boolean;
    };

    if (role && !["admin", "editor", "viewer"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Build updates dynamically
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await sql`UPDATE users SET password_hash = ${hash}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (name !== undefined) await sql`UPDATE users SET name = ${name}, updated_at = NOW() WHERE id = ${id}`;
    if (email !== undefined) await sql`UPDATE users SET email = ${email.toLowerCase().trim()}, updated_at = NOW() WHERE id = ${id}`;
    if (role !== undefined) {
      const assignedTabs = role === "editor" ? (tabs ?? []) : [];
      await sql`UPDATE users SET role = ${role}, tabs = ${assignedTabs as unknown as string}, updated_at = NOW() WHERE id = ${id}`;
    } else if (tabs !== undefined) {
      await sql`UPDATE users SET tabs = ${tabs as unknown as string}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (isActive !== undefined) await sql`UPDATE users SET is_active = ${isActive}, updated_at = NOW() WHERE id = ${id}`;

    const { rows } = await sql`
      SELECT id, email, name, role, tabs, is_active, created_at FROM users WHERE id = ${id}
    `;
    if (!rows[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });

    await writeAudit({
      userId: session.userId,
      userName: session.name,
      action: "user.updated",
      resourceType: "user",
      resourceId: id,
      resourceName: rows[0].name as string,
    });

    return NextResponse.json(rows[0]);
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    // Prevent deleting yourself
    if (id === session.userId) {
      return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
    }

    const { rows } = await sql`SELECT name FROM users WHERE id = ${id}`;
    if (!rows[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Soft-delete: deactivate rather than hard delete (preserves audit log FKs)
    await sql`UPDATE users SET is_active = false, updated_at = NOW() WHERE id = ${id}`;

    await writeAudit({
      userId: session.userId,
      userName: session.name,
      action: "user.deleted",
      resourceType: "user",
      resourceId: id,
      resourceName: rows[0].name as string,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
