import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Leaflet requires this to avoid SSR issues with window
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

export default nextConfig;
