import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

// ── Types ─────────────────────────────────────────────────────────────────

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  tabs: string[]; // ['appointments','canvass'] — only relevant for editors
}

// ── Secret ────────────────────────────────────────────────────────────────

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET env var is not set");
  return new TextEncoder().encode(secret);
}

// ── Token helpers ─────────────────────────────────────────────────────────

export async function signToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────

const COOKIE_NAME = "cr_session";

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24, // 24 h
    path: "/",
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

// ── Middleware token reader (Edge-compatible) ─────────────────────────────

export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

// ── API route guard ───────────────────────────────────────────────────────

/**
 * Call at the top of API route handlers.
 * Returns the session or throws a NextResponse 401.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return session;
}

/** Like requireSession but also enforces the user is an admin. */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "admin") {
    throw NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

/**
 * Checks whether the session user can access a given tab.
 * Admins can access all tabs. Editors only their assigned tabs.
 */
export function canAccessTab(
  session: SessionPayload,
  tab: "appointments" | "canvass"
): boolean {
  if (session.role === "admin") return true;
  if (session.role === "editor") return session.tabs.includes(tab);
  return false; // viewers never access tabs directly
}
