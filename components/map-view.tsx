"use client";

import { useEffect, useRef } from "react";

interface StopGroup {
  lat: number;
  lng: number;
  addresses: { address: string }[];
}

interface MapViewProps {
  anchor: { address: string; lat: number; lng: number };
  endAnchor?: { address: string; lat: number; lng: number };
  stops: StopGroup[];
  routeGeometry?: [number, number][] | null;
  focusedSegmentIdx: number | null; // 0=anchor→stop[0], 1=stop[0]→stop[1], …
}

/** Distance in metres between two [lat, lng] points. */
function distM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Compass bearing in degrees (0 = north) from point a to point b. */
function bearing(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLng = toRad(b[1] - a[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

/**
 * Build an array of geometry indices for each waypoint, searching only
 * forward from the previous match. Prevents the return leg from stealing
 * an earlier waypoint when stops are geographically close together.
 */
function buildWaypointIndices(
  coords: [number, number][],
  waypoints: [number, number][]
): number[] {
  const indices: number[] = [];
  let searchFrom = 0;
  for (const wp of waypoints) {
    let best = searchFrom;
    let bestDist = Infinity;
    for (let i = searchFrom; i < coords.length; i++) {
      const d = (coords[i][0] - wp[0]) ** 2 + (coords[i][1] - wp[1]) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    indices.push(best);
    searchFrom = best;
  }
  return indices;
}

export default function MapView({ anchor, endAnchor, stops, routeGeometry, focusedSegmentIdx }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    import("leaflet").then((L) => {
      // Fix default icon paths that break in Next.js
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(containerRef.current!, { zoomControl: false }).setView([anchor.lat, anchor.lng], 14);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const allPoints: [number, number][] = [];

      // ── Anchor marker ──────────────────────────────────────────────────────
      const anchorIcon = L.divIcon({
        className: "",
        html: `<div style="
          width:32px;height:32px;border-radius:50%;
          background:#1a6b2f;color:#fff;
          font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;
          display:flex;align-items:center;justify-content:center;
          border:2.5px solid #fff;
          box-shadow:0 2px 8px rgba(0,0,0,0.28);
        ">S</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      L.marker([anchor.lat, anchor.lng], { icon: anchorIcon })
        .bindPopup(
          `<div style="font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">${endAnchor ? "Start" : "Start / End"}</div>
           <div style="font-family:'Outfit',sans-serif;font-size:12px;color:#6f6f6f;margin-top:2px">${anchor.address}</div>`
        )
        .addTo(map);

      // Separate end marker when a different end location is specified
      if (endAnchor) {
        const endIcon = L.divIcon({
          className: "",
          html: `<div style="
            width:32px;height:32px;border-radius:50%;
            background:#b45309;color:#fff;
            font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;
            display:flex;align-items:center;justify-content:center;
            border:2.5px solid #fff;
            box-shadow:0 2px 8px rgba(0,0,0,0.28);
          ">E</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        L.marker([endAnchor.lat, endAnchor.lng], { icon: endIcon })
          .bindPopup(
            `<div style="font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">End</div>
             <div style="font-family:'Outfit',sans-serif;font-size:12px;color:#6f6f6f;margin-top:2px">${endAnchor.address}</div>`
          )
          .addTo(map);
        allPoints.push([endAnchor.lat, endAnchor.lng]);
      }
      allPoints.push([anchor.lat, anchor.lng]);

      // ── Stop / group markers ───────────────────────────────────────────────
      const routeCoords: [number, number][] = [[anchor.lat, anchor.lng]];

      stops.forEach((group, idx) => {
        const count = group.addresses.length;
        const isMulti = count > 1;

        const markerHtml = isMulti
          ? `<div style="position:relative;width:38px;height:38px">
              <div style="position:absolute;top:4px;left:4px;width:30px;height:30px;border-radius:50%;
                background:#2762EA;opacity:0.25;border:2px solid rgba(255,255,255,0.5)"></div>
              <div style="position:absolute;top:0;left:0;width:30px;height:30px;border-radius:50%;
                background:#2762EA;color:#fff;
                font-family:'Outfit',sans-serif;font-size:11px;font-weight:600;
                display:flex;align-items:center;justify-content:center;
                border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28);
              ">${idx + 1}</div>
              <div style="position:absolute;top:-3px;left:20px;min-width:16px;height:16px;padding:0 4px;
                border-radius:8px;background:#F29300;color:#fff;
                font-family:'Outfit',sans-serif;font-size:9px;font-weight:700;
                display:flex;align-items:center;justify-content:center;
                border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);
              ">${count}</div>
            </div>`
          : `<div style="
              width:30px;height:30px;border-radius:50%;
              background:#2762EA;color:#fff;
              font-family:'Outfit',sans-serif;font-size:11px;font-weight:600;
              display:flex;align-items:center;justify-content:center;
              border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28);
            ">${idx + 1}</div>`;

        const icon = L.divIcon({
          className: "",
          html: markerHtml,
          iconSize: isMulti ? [38, 38] : [30, 30],
          iconAnchor: [15, 15],
        });

        const addressLines = group.addresses
          .map(
            (a) =>
              `<div style="font-family:'Outfit',sans-serif;font-size:11px;color:#333;
                padding:3px 0;border-top:1px solid #f0f0f0;margin-top:2px">${a.address}</div>`
          )
          .join("");

        L.marker([group.lat, group.lng], { icon })
          .bindPopup(
            `<div style="font-family:'Outfit',sans-serif">
              <div style="font-size:12px;font-weight:600;color:#2762EA;margin-bottom:2px">
                Stop ${idx + 1}${isMulti ? ` &middot; ${count} addresses` : ""}
              </div>
              ${addressLines}
            </div>`,
            { maxWidth: 260 }
          )
          .addTo(map);

        routeCoords.push([group.lat, group.lng]);
        allPoints.push([group.lat, group.lng]);
      });

      // ── Full route geometry ────────────────────────────────────────────────
      const fullCoords: [number, number][] =
        routeGeometry && routeGeometry.length > 1
          ? routeGeometry
          : [...routeCoords, [anchor.lat, anchor.lng]];

      // ── Compute focused segment if needed ─────────────────────────────────
      // Waypoints in trip order: anchor, stop[0], …, stop[n-1], anchor
      // focusedSegmentIdx 0 → anchor→stop[0], 1 → stop[0]→stop[1], …
      let focusedSegment: [number, number][] | null = null;

      if (focusedSegmentIdx !== null) {
        const end = endAnchor ?? anchor;
        const waypointList: [number, number][] = [
          [anchor.lat, anchor.lng],
          ...stops.map((s): [number, number] => [s.lat, s.lng]),
          [end.lat, end.lng],
        ];

        const segFrom = waypointList[focusedSegmentIdx];
        const segTo   = waypointList[focusedSegmentIdx + 1];

        if (segFrom && segTo) {
          if (routeGeometry && routeGeometry.length > 1) {
            // Build waypoint→geometry indices with monotonic forward search
            const wpIndices = buildWaypointIndices(fullCoords, waypointList);
            const startI = wpIndices[focusedSegmentIdx];
            const endI   = wpIndices[focusedSegmentIdx + 1];
            focusedSegment = fullCoords.slice(startI, endI + 1);
          } else {
            focusedSegment = [segFrom, segTo];
          }
        }
      }

      // ── Draw base route ────────────────────────────────────────────────────
      const isFocused = focusedSegment !== null;

      L.polyline(fullCoords, {
        color: isFocused ? "#b0b8c9" : "#2762EA",   // grey when something is focused
        weight: isFocused ? 3 : 4,
        dashArray: isFocused ? undefined : "16 10",
        opacity: isFocused ? 0.45 : 0.85,
        className: isFocused ? "" : "cr-route-animated",
      }).addTo(map);

      // ── Overlay focused segment in navy with animation ─────────────────────
      if (focusedSegment && focusedSegment.length > 1) {
        L.polyline(focusedSegment, {
          color: "#2762EA",
          weight: 5,
          dashArray: "16 10",
          opacity: 1,
          className: "cr-route-animated",
        }).addTo(map);
      }

      // ── Directional chevron arrows every ~350 m ────────────────────────────
      // Show arrows only on the focused segment when focused, otherwise the full route
      const arrowCoords = focusedSegment ?? fullCoords;
      const ARROW_INTERVAL_M = 350;
      let accumulated = 0;
      let nextAt = ARROW_INTERVAL_M * 0.5;

      for (let i = 1; i < arrowCoords.length; i++) {
        const from = arrowCoords[i - 1];
        const to   = arrowCoords[i];
        const segLen = distM(from, to);
        accumulated += segLen;

        while (accumulated >= nextAt) {
          const overshoot = accumulated - nextAt;
          const t = Math.max(0, 1 - overshoot / segLen);
          const lat = from[0] + (to[0] - from[0]) * t;
          const lng = from[1] + (to[1] - from[1]) * t;
          const deg = bearing(from, to);

          const arrowIcon = L.divIcon({
            className: "",
            html: `<div style="
              width:18px;height:18px;
              display:flex;align-items:center;justify-content:center;
              transform:rotate(${deg}deg);
              opacity:${isFocused ? 0.9 : 0.65};
            ">
              <svg width="10" height="13" viewBox="0 0 10 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                <polyline points="2,11 5,2 8,11"
                  stroke="#2762EA" stroke-width="2.5"
                  stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          });

          L.marker([lat, lng], { icon: arrowIcon, interactive: false, keyboard: false }).addTo(map);
          nextAt += ARROW_INTERVAL_M;
        }
      }

      // ── Custom zoom + fit-route control ───────────────────────────────────
      // Replaces the default zoom control with +  /  fit  /  − stacked vertically.
      const fitCoords = fullCoords.length > 1 ? fullCoords : allPoints;

      const FitControl = L.Control.extend({
        options: { position: "topleft" },
        onAdd() {
          const bar = L.DomUtil.create("div", "leaflet-bar leaflet-control");

          // ── Zoom in ──
          const zoomIn = L.DomUtil.create("a", "leaflet-control-zoom-in", bar) as HTMLAnchorElement;
          zoomIn.innerHTML = "+";
          zoomIn.title = "Zoom in";
          zoomIn.href = "#";
          zoomIn.setAttribute("role", "button");
          L.DomEvent.on(zoomIn, "click", L.DomEvent.stop).on(zoomIn, "click", () => map.zoomIn());

          // ── Fit route ──
          const fitBtn = L.DomUtil.create("a", "", bar) as HTMLAnchorElement;
          fitBtn.title = "Fit route to view";
          fitBtn.href = "#";
          fitBtn.setAttribute("role", "button");
          fitBtn.style.cssText = "display:flex;align-items:center;justify-content:center;";
          fitBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 4.5V1h3.5M8.5 1H12v3.5M12 8.5V12H8.5M4.5 12H1V8.5"
              stroke="#444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`;
          L.DomEvent.on(fitBtn, "click", L.DomEvent.stop).on(fitBtn, "click", () => {
            map.fitBounds(fitCoords as [number, number][], { padding: [40, 40] });
          });

          // ── Zoom out ──
          const zoomOut = L.DomUtil.create("a", "leaflet-control-zoom-out", bar) as HTMLAnchorElement;
          zoomOut.innerHTML = "&#8722;";
          zoomOut.title = "Zoom out";
          zoomOut.href = "#";
          zoomOut.setAttribute("role", "button");
          L.DomEvent.on(zoomOut, "click", L.DomEvent.stop).on(zoomOut, "click", () => map.zoomOut());

          return bar;
        },
      });
      new FitControl().addTo(map);

      // ── Initial view: fit the full road geometry ───────────────────────────
      if (fitCoords.length > 1) {
        map.fitBounds(fitCoords as [number, number][], { padding: [40, 40], animate: false });
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.lat, anchor.lng, endAnchor?.lat, endAnchor?.lng, stops, routeGeometry]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      {/* Route animation — dashes flow forward along the path direction */}
      <style>{`
        .cr-route-animated {
          stroke-dasharray: 16 10;
          stroke-dashoffset: 26;
          animation: crRouteFlow 1.4s linear infinite;
        }
        @keyframes crRouteFlow {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
      <div
        ref={containerRef}
        className="w-full h-full rounded-xl overflow-hidden"
        role="region"
        aria-label="Canvassing route map"
      />
    </>
  );
}
