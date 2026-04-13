"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-context";
import { useLocalStorage } from "@/lib/use-local-storage";
import {
  useUISettings,
  DEFAULT_PILL_STYLES,
  PillTarget,
  UISettings,
} from "@/lib/ui-settings";
import BasesManager from "./bases-manager";
import TagsManager, { CustomTag } from "./tags-manager";
import { SalesBase } from "@/lib/appt-scheduler";

const defaultCustomTags: CustomTag[] = [
  { id: "door", label: "Door" },
  { id: "8_units", label: "8+ Units" },
  { id: "14_units", label: "14+ Units" },
];

const PILL_LABELS: Record<PillTarget, string> = {
  appointments: "Appointments",
  canvass:      "Canvass",
  private:      "Private",
  shared:       "Shared",
  link:         "Link",
  admin:        "Admin",
  editor:       "Editor",
  viewer:       "Viewer",
};

const PILL_GROUPS: { label: string; targets: PillTarget[] }[] = [
  { label: "Plan type",   targets: ["appointments", "canvass"] },
  { label: "Visibility",  targets: ["private", "shared", "link"] },
  { label: "Role",        targets: ["admin", "editor", "viewer"] },
];

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { session } = useSession();
  const isAdmin = session?.role === "admin";

  type Tab = "bases" | "tags" | "ui";
  const [activeTab, setActiveTab] = useState<Tab>("bases");

  // ── Bases ──────────────────────────────────────────────────────────────────
  const [bases, setBasesState] = useState<SalesBase[]>([]);
  const [baseSaveError, setBaseSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bases")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setBasesState(data as SalesBase[]); })
      .catch(console.error);
  }, []);

  const handleBasesChange = useCallback((next: SalesBase[]) => {
    setBasesState(next);
    fetch("/api/bases", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("save failed");
        setBaseSaveError(null);
      })
      .catch((e: Error) => setBaseSaveError(e.message));
  }, []);

  // ── Tags ───────────────────────────────────────────────────────────────────
  const [customTags, setCustomTags] = useLocalStorage<CustomTag[]>(
    "cr-smith-custom-tags",
    defaultCustomTags
  );

  function handleTagsChange(tags: CustomTag[]) { setCustomTags(tags); }
  function handleRemoveTag(tagId: string) {
    setCustomTags(customTags.filter((t) => t.id !== tagId));
  }

  // ── UI / pill colours ─────────────────────────────────────────────────────
  const [uiSettings, setUISettings] = useUISettings();

  function handlePillChange(target: PillTarget, field: "bg" | "text", value: string) {
    const next: UISettings = {
      pillStyles: {
        ...uiSettings.pillStyles,
        [target]: {
          ...uiSettings.pillStyles[target],
          [field]: value,
        },
      },
    };
    setUISettings(next);
  }

  function resetPillStyles() {
    setUISettings({ pillStyles: { ...DEFAULT_PILL_STYLES } });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "bases", label: "Bases" },
    { id: "tags",  label: "Tags" },
    ...(isAdmin ? [{ id: "ui" as Tab, label: "UI" }] : []),
  ];

  return (
    <div className="fixed inset-0 z-[300] flex items-stretch justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative z-10 w-full max-w-sm bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-coal">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-coal/40 hover:text-coal hover:bg-gray-100 transition-colors"
            aria-label="Close settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`mr-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? "border-loch text-loch"
                  : "border-transparent text-coal/50 hover:text-coal"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {activeTab === "bases" && (
            <>
              {baseSaveError && (
                <p className="text-xs text-red-600 bg-red-50 px-5 py-2 border-b border-red-100">
                  ⚠ Could not save: {baseSaveError}
                </p>
              )}
              <BasesManager bases={bases} onChange={handleBasesChange} />
            </>
          )}

          {activeTab === "tags" && (
            <TagsManager
              customTags={customTags}
              onTagsChange={handleTagsChange}
              onRemoveTag={handleRemoveTag}
            />
          )}

          {activeTab === "ui" && isAdmin && (
            <div className="p-5 space-y-6">
              {PILL_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-xs font-semibold text-coal/50 uppercase tracking-widest mb-3">
                    {group.label}
                  </p>
                  <div className="space-y-3">
                    {group.targets.map((target) => {
                      const style = uiSettings.pillStyles[target];
                      return (
                        <div key={target} className="flex items-center gap-3">
                          {/* Preview */}
                          <span
                            className="flex-shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide min-w-[80px] text-center"
                            style={{ backgroundColor: style.bg, color: style.text }}
                          >
                            {PILL_LABELS[target]}
                          </span>

                          {/* Colour inputs */}
                          <div className="flex items-center gap-2 flex-1">
                            <label className="flex items-center gap-1.5 text-xs text-coal/50">
                              Fill
                              <input
                                type="color"
                                value={style.bg}
                                onChange={(e) => handlePillChange(target, "bg", e.target.value)}
                                className="w-7 h-6 rounded cursor-pointer border border-gray-200 p-0.5"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-coal/50">
                              Text
                              <input
                                type="color"
                                value={style.text}
                                onChange={(e) => handlePillChange(target, "text", e.target.value)}
                                className="w-7 h-6 rounded cursor-pointer border border-gray-200 p-0.5"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <button
                onClick={resetPillStyles}
                className="text-xs text-coal/40 hover:text-coal/60 transition-colors pt-2"
              >
                Reset to defaults
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
