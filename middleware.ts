import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";

// Routes that don't require a session
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/setup",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow Next.js internals, static files, and public share links
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/cr-smith") ||
    pathname.startsWith("/share/")
  ) {
    return NextResponse.next();
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Verify session
  const session = await getSessionFromRequest(req);
  if (!session) {
    // API routes return 401; page routes redirect to /login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Viewers should land on /plans, not the route planner
  if (session.role === "viewer" && pathname === "/") {
    return NextResponse.redirect(new URL("/plans", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon, logo images
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
