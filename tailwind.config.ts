import type { Config } from "tailwindcss";

// ─── Brand colour tokens ────────────────────────────────────────────────────
// Edit values here to update the entire app at once.
//
//  loch     #041244   Primary brand colour
//  ink      #282A36   Body text
//  whisky   #F29300   Main accent / CTA
//  saltire  #2762EA   Secondary action
//  heather  #C9388A   Offers & finance highlights
//  slate    #CCCCCC   Dividers
//  coal     #2F2F2F   Greyscale text
//  mist     #FAFAFA   Card backgrounds
//  snow     #F5F7FA   Page backgrounds

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        loch:    "#041244",   // primary brand blue
        ink:     "#282A36",   // body text
        whisky:  "#F29300",   // main accent / CTA
        saltire: "#2762EA",   // secondary action
        heather: "#C9388A",   // offers & finance
        slate:   "#CCCCCC",   // dividers
        coal:    "#2F2F2F",   // greyscale text
        mist:    "#FAFAFA",   // card backgrounds
        snow:    "#F5F7FA",   // page backgrounds
        // Map-specific
        "map-stop":   "#041244",
        "map-anchor": "#1a6b2f",
      },
      fontFamily: {
        sans: ["Outfit", "Arial", "sans-serif"],
      },
      boxShadow: {
        card:       "0 1px 3px 0 rgba(4,18,68,0.08), 0 1px 2px -1px rgba(4,18,68,0.06)",
        "card-hover": "0 4px 12px 0 rgba(4,18,68,0.12), 0 2px 4px -1px rgba(4,18,68,0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
