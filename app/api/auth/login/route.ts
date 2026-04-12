import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { signToken, setSessionCookie } from "@/lib/auth";
import { writeAudit } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth";

export const runtime = "nodejs";

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: "admin" | "editor" | "viewer";
  tabs: string[];
  is_active: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json() as { email?: string; password?: string };

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const { rows } = await sql<UserRow>`
      SELECT id, email, name, password_hash, role, tabs, is_active
      FROM users WHERE email = ${email.toLowerCase().trim()}
    `;

    const user = rows[0];
    if (!user || !user.is_active) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const payload: SessionPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tabs: user.tabs ?? [],
    };

    const token = await signToken(payload);
    const res = NextResponse.json({ ok: true, user: payload });
    setSessionCookie(res, token);

    await writeAudit({
      userId: user.id,
      userName: user.name,
      action: "auth.login",
    });

    return res;
  } catch (e) {
    console.error("Login error:", e);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
