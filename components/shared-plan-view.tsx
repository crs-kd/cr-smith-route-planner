"use client";

interface SharedPlan {
  id: string;
  name: string;
  notes: string | null;
  type: "appointments" | "canvass";
  created_at: string;
  creator_name: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
}

export default function SharedPlanView({ plan }: { plan: SharedPlan }) {
  const typeLabel = plan.type === "appointments" ? "Appointments" : "Canvass";
  const typeBadge = plan.type === "appointments" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800";

  const dateLabel = new Date(plan.created_at).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="header-gradient h-16 flex items-center px-5 lg:px-8 shadow-md sticky top-0 z-50">
        <div className="flex items-center gap-4 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cr-smith-logo-white.svg" alt="CR Smith" className="h-7 w-auto" />
          <span className="text-white/70 text-sm font-medium hidden sm:block">Shared Route Plan</span>
        </div>
        <a href="/login" className="text-white/70 hover:text-white text-xs font-medium transition-colors">Sign in →</a>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Plan header */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${typeBadge}`}>
                {typeLabel}
              </span>
              <h1 className="text-xl font-bold text-coal mt-2">{plan.name}</h1>
              {plan.notes && <p className="text-sm text-coal/60 mt-1">{plan.notes}</p>}
            </div>
          </div>
          <div className="flex gap-4 mt-4 text-xs text-coal/40 border-t border-gray-100 pt-3">
            <span>Created by {plan.creator_name}</span>
            <span>{dateLabel}</span>
          </div>
        </div>

        {/* Plan result */}
        {plan.type === "canvass" ? (
          <CanvassResultView result={plan.result} />
        ) : (
          <AppointmentsResultView result={plan.result} inputs={plan.inputs} />
        )}
      </div>
    </div>
  );
}

// ── Canvass result view ────────────────────────────────────────────────────

function CanvassResultView({ result }: { result: Record<string, unknown> }) {
  const days = result.days as Array<{
    date: string;
    routes: Array<{
      canvasserId: string;
      stops: Array<{ addressIds: string[]; travelSec: number }>;
    }>;
  }> ?? [];

  const geocodedAddresses = result.geocodedAddresses as Array<{ id: string; address: string }> ?? [];
  const addrById = new Map(geocodedAddresses.map((a) => [a.id, a.address]));

  if (days.length === 0) {
    return <p className="text-sm text-coal/50 text-center py-8">No canvass plan data available.</p>;
  }

  return (
    <div className="space-y-4">
      {days.map((day) => {
        const dateLabel = new Date(day.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
        const totalAddresses = day.routes.reduce((n, r) => n + r.stops.reduce((m, s) => m + s.addressIds.length, 0), 0);
        return (
          <div key={day.date} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-sm font-semibold text-coal">{dateLabel}</p>
              <p className="text-xs text-coal/50 mt-0.5">{day.routes.length} canvasser{day.routes.length !== 1 ? "s" : ""} · {totalAddresses} addresses</p>
            </div>
            {day.routes.map((route) => {
              const totalAddrs = route.stops.reduce((n, s) => n + s.addressIds.length, 0);
              return (
                <div key={route.canvasserId} className="border-t border-gray-100 px-4 py-3">
                  <p className="text-sm font-semibold text-coal mb-2">{totalAddrs} addresses</p>
                  <ol className="space-y-1">
                    {route.stops.map((stop, idx) => {
                      const addrs = stop.addressIds.map((id) => addrById.get(id) ?? id);
                      return (
                        <li key={idx} className="flex gap-2 text-xs">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-loch/10 text-loch font-semibold flex items-center justify-center text-[10px]">{idx + 1}</span>
                          <div>{addrs.map((a, i) => <p key={i} className="text-coal/70">{a}</p>)}</div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Appointments result view ───────────────────────────────────────────────

function AppointmentsResultView({ result, inputs }: { result: Record<string, unknown>; inputs: Record<string, unknown> }) {
  const schedules = result.schedules as Array<{
    repId: string;
    assignments: Array<{ apptId: string; travelSec: number }>;
  }> ?? [];

  const geocodedAppts = result.geocodedAppts as Array<{ id: string; address: string; timeHHMM: string; urn?: string }> ?? [];
  const apptById = new Map(geocodedAppts.map((a) => [a.id, a]));
  const durationHours = (inputs.durationHours as number) ?? 1;

  if (schedules.length === 0) {
    return <p className="text-sm text-coal/50 text-center py-8">No appointments plan data available.</p>;
  }

  function fmt(hhmm: string) {
    const s = (hhmm ?? "").replace(":", "").trim();
    return s.length === 4 ? `${s.slice(0, 2)}:${s.slice(2)}` : s;
  }

  return (
    <div className="space-y-3">
      {schedules.map((sched) => (
        <div key={sched.repId} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
            <p className="text-sm font-semibold text-coal">{sched.assignments.length} appointment{sched.assignments.length !== 1 ? "s" : ""}</p>
          </div>
          <ol className="divide-y divide-gray-50">
            {sched.assignments.map((a, idx) => {
              const appt = apptById.get(a.apptId);
              if (!appt) return null;
              const endMins = parseInt(appt.timeHHMM.slice(0, 2)) * 60 + parseInt(appt.timeHHMM.slice(2)) + durationHours * 60;
              const endH = String(Math.floor(endMins / 60) % 24).padStart(2, "0");
              const endM = String(endMins % 60).padStart(2, "0");
              return (
                <li key={a.apptId} className="flex items-start gap-3 px-4 py-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-loch text-white text-xs font-bold flex items-center justify-center mt-0.5">{idx + 1}</span>
                  <div>
                    {a.travelSec > 0 && <p className="text-xs text-green-600 mb-0.5">↓ ~{Math.round(a.travelSec / 60)}m travel</p>}
                    <p className="text-sm font-semibold text-coal">{appt.urn || appt.address}</p>
                    {appt.urn && <p className="text-xs text-coal/50">{appt.address}</p>}
                    <p className="text-xs text-coal/60">{fmt(appt.timeHHMM)} – {endH}:{endM}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
