import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  try {
    await ensureSchema();

    // Only allow if no users exist yet
    const { rows } = await sql<{ count: number }>`SELECT COUNT(*)::int AS count FROM users`;
    if ((rows[0]?.count ?? 0) > 0) {
      return NextResponse.json({ error: "Setup already complete" }, { status: 409 });
    }

    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    const name = process.env.ADMIN_NAME ?? "Admin";

    if (!email || !password) {
      return NextResponse.json(
        { error: "ADMIN_EMAIL and ADMIN_PASSWORD env vars are required" },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await sql`
      INSERT INTO users (email, name, password_hash, role, tabs)
      VALUES (${email}, ${name}, ${passwordHash}, 'admin', '{}')
    `;

    return NextResponse.json({ ok: true, message: `Admin account created for ${email}` });
  } catch (e) {
    console.error("Setup error:", e);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
