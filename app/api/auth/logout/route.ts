import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/auth";
import { writeAudit } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  const session = await getSession();

  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);

  if (session) {
    await writeAudit({
      userId: session.userId,
      userName: session.name,
      action: "auth.logout",
    });
  }

  return res;
}
