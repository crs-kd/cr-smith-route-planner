import type { Metadata } from "next";
import "./globals.css";
import HeaderActions from "@/components/header-actions";
import { SessionProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "Route Planner — CR Smith",
  description: "Optimised door-to-door canvassing routes for CR Smith.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body suppressHydrationWarning>
        <SessionProvider>
          <header
            className="header-gradient h-16 flex items-center px-5 lg:px-8 sticky top-0 z-50 shadow-md"
            role="banner"
          >
            <div className="flex items-center flex-1 gap-5">
              {/* CR Smith logo */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/cr-smith-logo-white.svg"
                alt="CR Smith"
                className="h-7 w-auto"
              />
              <span className="text-white/70 text-sm font-medium hidden sm:block">
                Route Planner
              </span>
            </div>

            {/* Right — nav + user menu */}
            <HeaderActions />
          </header>

          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
