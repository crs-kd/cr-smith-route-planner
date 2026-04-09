import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Route Planner — CR Smith",
  description: "Optimised door-to-door canvassing routes for CR Smith.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body suppressHydrationWarning>
        <header
          className="header-gradient h-16 flex items-center px-5 lg:px-8 sticky top-0 z-50 shadow-md"
          role="banner"
        >
          <div className="flex items-center flex-1">
            {/* CR Smith logo */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/cr-smith-logo-white.svg"
              alt="CR Smith"
              className="h-7 w-auto"
            />
          </div>

          {/* Right — Route Planner */}
          <span className="text-white/70 text-sm font-medium hidden sm:block">
            Route Planner
          </span>
        </header>

        {children}
      </body>
    </html>
  );
}
