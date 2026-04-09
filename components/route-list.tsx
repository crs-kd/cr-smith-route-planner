"use client";

const KM_TO_MI = 0.621371;

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function haversineMi(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * KM_TO_MI;
}

interface Address {
  address: string;
  lat: number;
  lng: number;
  name?: string;
}

interface StopGroup {
  id: number;
  lat: number;
  lng: number;
  addresses: Address[];
}

interface RouteListProps {
  mode: "canvass" | "appointments";
  anchor: Address;
  endAnchor?: Address;
  stops: StopGroup[];
  legDurationsS?: number[] | null;
  hiddenStopIds: Set<number>;
  onToggleStop: (id: number) => void;
  focusedStopId: number | "start" | null;
  onFocusStop: (id: number | "start") => void;
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function RouteList({
  mode,
  anchor,
  endAnchor,
  stops,
  legDurationsS,
  hiddenStopIds,
  onToggleStop,
  focusedStopId,
  onFocusStop,
}: RouteListProps) {
  const end = endAnchor ?? anchor;
  const visibleStops = stops.filter((g) => !hiddenStopIds.has(g.id));
  const anyFocused = focusedStopId !== null;

  // Map each stop id → its index within the visible list so we can look up the
  // correct leg duration (durations only cover visible stops, not hidden ones).
  const visibleIdxMap = new Map<number, number>();
  visibleStops.forEach((g, i) => visibleIdxMap.set(g.id, i));

  function handlePrint() {
    window.print();
  }

  function handleDownloadCSV() {
    const isAppts = mode === "appointments";
    const header  = isAppts
      ? ["stop", "name", "address", "distance_from_prev_mi", "est_travel_time"]
      : ["stop", "address", "distance_from_prev_mi", "est_travel_time"];
    const rows: string[][] = [header];
    rows.push(isAppts
      ? ["0", "", `"${anchor.address}"`, "0", ""]
      : ["0", `"${anchor.address}"`, "0", ""]
    );

    let prev: Address = anchor;
    let visibleIdx = 0;
    stops.forEach((group) => {
      if (hiddenStopIds.has(group.id)) return;
      visibleIdx++;
      const groupPt: Address = { address: group.addresses[0]?.address ?? "", lat: group.lat, lng: group.lng };
      const dist = haversineMi(prev, groupPt).toFixed(2);
      const vi = visibleIdxMap.get(group.id);
      const durStr = vi !== undefined && legDurationsS?.[vi] != null
        ? formatDuration(legDurationsS[vi])
        : "";
      group.addresses.forEach((a) => {
        rows.push(isAppts
          ? [String(visibleIdx), `"${a.name ?? ""}"`, `"${a.address}"`, dist, durStr]
          : [String(visibleIdx), `"${a.address}"`, dist, durStr]
        );
      });
      prev = groupPt;
    });

    const returnDist = haversineMi(prev, end).toFixed(2);
    const returnDurStr = legDurationsS?.[visibleIdx] != null
      ? formatDuration(legDurationsS[visibleIdx])
      : "";
    rows.push(isAppts
      ? [String(visibleIdx + 1), "", `"${end.address} (return)"`, returnDist, returnDurStr]
      : [String(visibleIdx + 1), `"${end.address} (return)"`, returnDist, returnDurStr]
    );

    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const el = document.createElement("a");
    el.href = URL.createObjectURL(blob);
    el.download = `cr-smith-${isAppts ? "appointments" : "canvassing"}-route.csv`;
    el.click();
    URL.revokeObjectURL(el.href);
  }

  const totalAddresses = stops.reduce((n, g) => n + g.addresses.length, 0);

  return (
    <div>
      {/* ── Print-only header ───────────────────────────────────────────────── */}
      <div className="hidden print:block mb-6">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", paddingBottom: "14px", marginBottom: "14px", borderBottom: "2px solid #041244" }}>
          {/* CR Smith logo — inline SVG with navy fill so it prints on white paper */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144.9 22.5" style={{ height: "32px", width: "auto" }} aria-label="CR Smith">
            <path fill="#041244" d="M0,11.3C0,4.2,5.1,0,11.2,0s4.3.5,5.1.9l-1.5,4.8c-.9-.4-2.5-.6-3.3-.6-3.8,0-5.7,2.6-5.7,6.4s2,6.4,5.6,6.4,2.8-.3,3.4-.6l1.5,4.3c-1.1.5-3,1-5.1,1C5.1,22.5,0,18.3,0,11.3"/>
            <path fill="#041244" d="M26.3,11.7c3.9,0,5.2-1.1,5.2-3.2s-1.3-3.2-5.2-3.2h-1.2v6.3h1.2ZM38.4,22.1h-6.2l-4-6c-.6,0-1.2,0-1.8,0h-1.3v5.9h-5.5V.4h5.1c8.1,0,12.3,2.2,12.3,8.1s-1.3,5-3.6,6.2l4.9,7.4h0Z"/>
            <path fill="#041244" d="M46.5,20.8l1.6-4.5c1.5.6,4.4,1.4,7.6,1.4s3.4-.4,3.4-1.6-1.9-1.8-4.2-2.5c-3.6-1.1-7.7-2.5-7.7-7S51.3.1,56.4.1s6.2.7,7.1,1.1l-1.5,4.6c-1.6-.5-3.9-.9-6.2-.9s-3,.3-3,1.4,1.9,1.8,4.1,2.5c3.6,1.1,7.7,2.5,7.7,7s-2.5,6.5-9.9,6.5-6.7-.8-8.3-1.5"/>
            <polygon fill="#041244" points="69 .1 71.1 .1 79.6 12.7 88.1 .1 90.2 .1 91.8 22.1 86.2 22.1 85.5 12.7 80 20.7 78.8 20.7 73.3 12.7 72.7 22.1 67.4 22.1 69 .1 69 .1"/>
            <polygon fill="#041244" points="95.7 .4 101.3 .4 101.3 22.1 95.7 22.1 95.7 .4 95.7 .4"/>
            <polygon fill="#041244" points="110.5 5.4 103.8 5.4 103.8 .4 122.8 .4 122.8 5.4 116.1 5.4 116.1 22.1 110.5 22.1 110.5 5.4 110.5 5.4"/>
            <polygon fill="#041244" points="139.3 .4 139.3 8.6 131 8.6 131 .4 125.4 .4 125.4 22.1 131 22.1 131 13.5 137.9 13.5 137.9 11.1 139.3 11.1 139.3 13.5 139.3 14.5 139.3 22.1 144.9 22.1 144.9 .4 139.3 .4 139.3 .4"/>
            <polygon fill="#041244" points="136.1 19.1 134.2 19.1 134.2 22.1 136.1 22.1 136.1 19.1 136.1 19.1"/>
            <polygon fill="#041244" points="134.1 15.4 132.5 15.4 132.5 17.1 134.1 17.1 134.1 15.4 134.1 15.4"/>
            <polygon fill="#041244" points="137.8 15.4 136.2 15.4 136.2 17.1 137.8 17.1 137.8 15.4 137.8 15.4"/>
          </svg>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: "13pt", fontWeight: 700, color: "#041244", margin: 0 }}>Route Planner</p>
            <p style={{ fontSize: "9pt", color: "#666", margin: "2px 0 0" }}>
              Printed {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </div>

        {/* Summary stats */}
        {(() => {
          const chain: Array<{ lat: number; lng: number }> = [anchor, ...visibleStops, end];
          let totalMi = 0;
          for (let i = 0; i < chain.length - 1; i++) totalMi += haversineMi(chain[i], chain[i + 1]);
          return (
            <div style={{ display: "flex", gap: "16px", marginBottom: "14px" }}>
              {[
                { label: mode === "appointments" ? "Appointments" : "Addresses", value: `${visibleStops.reduce((n, g) => n + g.addresses.length, 0)} / ${totalAddresses}` },
                { label: "Areas", value: String(visibleStops.length) },
                { label: "Distance (Miles)", value: totalMi.toFixed(1) },
                { label: "Est. Drive Time", value: legDurationsS ? formatDuration(legDurationsS.reduce((s, d) => s + d, 0)) : "—" },
              ].map(({ label, value }) => (
                <div key={label} style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 12px", minWidth: "80px", textAlign: "center" }}>
                  <p style={{ fontSize: "14pt", fontWeight: 700, color: "#041244", margin: 0 }}>{value}</p>
                  <p style={{ fontSize: "8pt", color: "#666", margin: 0 }}>{label}</p>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-4 print:hidden">
        <button
          onClick={handleDownloadCSV}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-saltire border border-saltire/30 rounded-lg hover:bg-snow transition-colors duration-150"
          aria-label="Download route as CSV"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 1v9m0 0L5 7m3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Download CSV
        </button>
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-coal/60 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors duration-150"
          aria-label="Print route"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 5V2h8v3M4 11H2V7a1 1 0 011-1h10a1 1 0 011 1v4h-2m-8 0v3h8v-3H4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Print
        </button>
      </div>

      {/* Hidden hint */}
      {hiddenStopIds.size > 0 && (
        <p className="text-xs text-coal/50 mb-3 flex items-center gap-1.5 print:hidden">
          <EyeOffIcon />
          {hiddenStopIds.size} stop{hiddenStopIds.size === 1 ? "" : "s"} hidden from route
        </p>
      )}

      {/* Route list */}
      <ol className="space-y-1" aria-label="Ordered route stops">
        {/* Start */}
        <li className={`flex items-start gap-3 py-2.5 border-b border-gray-100 transition-all duration-200 ${
          anyFocused && focusedStopId !== "start" ? "opacity-40" : ""
        } ${focusedStopId === "start" ? "border-l-2 border-l-map-anchor -ml-px pl-px" : ""}`}>
          <span
            className={`flex-shrink-0 w-7 h-7 rounded-full bg-map-anchor text-white text-xs font-semibold flex items-center justify-center mt-0.5 transition-all ${
              focusedStopId === "start" ? "ring-2 ring-map-anchor/30 ring-offset-1" : ""
            }`}
            aria-label="Start"
          >
            S
          </span>
          <button
            className="flex-1 min-w-0 text-left cursor-pointer"
            onClick={() => onFocusStop("start")}
            aria-pressed={focusedStopId === "start"}
            aria-label={focusedStopId === "start" ? "Deselect start segment" : "Highlight route from start to first stop"}
          >
            <p className="text-sm font-semibold text-loch">Start</p>
            <p className="text-sm text-coal truncate">{anchor.address}</p>
            {focusedStopId === "start" && (
              <p className="text-xs text-map-anchor/80 font-medium mt-1">↗ route to first stop highlighted</p>
            )}
          </button>
        </li>

        {/* Stops */}
        {stops.map((group, idx) => {
          const isHidden = hiddenStopIds.has(group.id);
          const isFocused = focusedStopId === group.id;
          const isDimmed = !isHidden && anyFocused && !isFocused;
          const isMulti = group.addresses.length > 1;

          // Distance from previous waypoint
          const prevPt = idx === 0 ? anchor : stops[idx - 1];
          const distMi = haversineMi(
            { lat: prevPt.lat, lng: prevPt.lng },
            { lat: group.lat, lng: group.lng }
          );

          return (
            <li
              key={group.id}
              className={`flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-b-0 transition-all duration-200 ${
                isHidden ? "opacity-35" : isDimmed ? "opacity-40" : "animate-fadeIn"
              } ${isFocused ? "border-l-2 border-l-loch -ml-px pl-px" : ""}`}
              style={!isHidden ? { animationDelay: `${idx * 30}ms` } : undefined}
            >
              {/* Number badge */}
              <div className="flex-shrink-0 relative mt-0.5">
                <span
                  className={`w-7 h-7 rounded-full text-white text-xs font-semibold flex items-center justify-center transition-colors duration-200 ${
                    isHidden ? "bg-coal/25" : isFocused ? "bg-loch ring-2 ring-loch/30 ring-offset-1" : "bg-loch"
                  }`}
                  aria-label={`Stop ${idx + 1}`}
                >
                  {idx + 1}
                </span>
                {isMulti && !isHidden && (
                  <span
                    className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-whisky text-white text-[9px] font-bold flex items-center justify-center border border-white"
                    aria-label={`${group.addresses.length} addresses`}
                  >
                    {group.addresses.length}
                  </span>
                )}
              </div>

              {/* Address content */}
              <button
                className="flex-1 min-w-0 text-left cursor-pointer"
                onClick={() => !isHidden && onFocusStop(group.id)}
                disabled={isHidden}
                aria-pressed={isFocused}
                aria-label={`${isFocused ? "Deselect" : "Highlight route from"} stop ${idx + 1}`}
              >
                {isMulti ? (
                  <>
                    <p className={`text-xs font-semibold mb-1.5 ${isHidden ? "text-coal/40" : "text-whisky"}`}>
                      {group.addresses.length} {mode === "appointments" ? "appointments" : "addresses"} at this location
                    </p>
                    <ul className="space-y-1">
                      {group.addresses.map((a, ai) => (
                        <li key={ai} className="flex items-start gap-1.5">
                          <span className="text-coal/30 text-sm leading-5 flex-shrink-0">·</span>
                          <span className={`text-sm ${isHidden ? "line-through text-coal/40" : "text-coal"}`}>
                            {mode === "appointments" && a.name ? (
                              <>
                                <span className="font-medium">{a.name}</span>
                                <span className={`block text-xs mt-0.5 ${isHidden ? "text-coal/30" : "text-coal/50"}`}>{a.address}</span>
                              </>
                            ) : a.address}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : mode === "appointments" && group.addresses[0].name ? (
                  <>
                    <p className={`text-sm font-medium ${isHidden ? "line-through text-coal/40" : "text-coal"}`}>
                      {group.addresses[0].name}
                    </p>
                    <p className={`text-xs mt-0.5 ${isHidden ? "text-coal/30" : "text-coal/50"}`}>
                      {group.addresses[0].address}
                    </p>
                  </>
                ) : (
                  <p className={`text-sm ${isHidden ? "line-through text-coal/40" : "text-coal"}`}>
                    {group.addresses[0].address}
                  </p>
                )}
                <p className="text-xs text-coal/40 mt-1">
                  {(() => {
                    const vi = visibleIdxMap.get(group.id);
                    const dur = vi !== undefined ? legDurationsS?.[vi] : undefined;
                    return dur != null ? `~${formatDuration(dur)} · ` : "";
                  })()}
                  {distMi.toFixed(2)} mi from {idx === 0 ? "start" : `stop ${idx}`}
                </p>
                {isFocused && (
                  <p className="text-xs text-loch/70 font-medium mt-0.5">↗ route to next stop highlighted</p>
                )}
              </button>

              {/* Toggle visibility */}
              <button
                onClick={() => onToggleStop(group.id)}
                className={`flex-shrink-0 p-1.5 rounded-md mt-0.5 transition-colors duration-150 print:hidden ${
                  isHidden
                    ? "text-coal/30 hover:text-coal/60 hover:bg-gray-100"
                    : "text-coal/30 hover:text-loch hover:bg-snow"
                }`}
                aria-label={isHidden ? `Show stop ${idx + 1}` : `Hide stop ${idx + 1}`}
                aria-pressed={!isHidden}
              >
                {isHidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </li>
          );
        })}

        {/* End */}
        <li className="flex items-start gap-3 py-2.5">
          <span
            className="flex-shrink-0 w-7 h-7 rounded-full bg-map-anchor text-white text-xs font-semibold flex items-center justify-center mt-0.5"
            aria-label="End"
          >
            E
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-loch">
              End{endAnchor ? "" : " — return to start"}
            </p>
            <p className="text-sm text-coal truncate">{end.address}</p>
            {visibleStops.length > 0 && (
              <p className="text-xs text-coal/40 mt-0.5">
                {(() => {
                  const returnDur = legDurationsS?.[visibleStops.length];
                  return returnDur != null ? `~${formatDuration(returnDur)} · ` : "";
                })()}
                {haversineMi(
                  visibleStops[visibleStops.length - 1],
                  end
                ).toFixed(2)} mi from last stop
              </p>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}
