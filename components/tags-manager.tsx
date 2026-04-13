"use client";

import { useState } from "react";

export interface CustomTag {
  id: string;
  label: string;
}

export default function TagsManager({
  customTags,
  onTagsChange,
  onRemoveTag,
  onBack,
}: {
  customTags: CustomTag[];
  onTagsChange: (tags: CustomTag[]) => void;
  onRemoveTag: (tagId: string) => void;
  onBack?: () => void;
}) {
  const [newLabel, setNewLabel] = useState("");

  function addTag() {
    const label = newLabel.trim();
    if (!label) return;
    const id = label
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (!id || customTags.some((t) => t.id === id)) return;
    onTagsChange([...customTags, { id, label }]);
    setNewLabel("");
  }

  return (
    <div className="flex flex-col h-full">
      {onBack && (
        <div className="sticky top-0 z-10 flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-white">
          <button
            onClick={onBack}
            className="p-1.5 rounded-md text-coal/50 hover:text-coal hover:bg-gray-100 transition-colors"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h2 className="text-sm font-semibold text-coal">Tags</h2>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-2">
        {customTags.map((tag) => (
          <div
            key={tag.id}
            className="flex items-center justify-between px-3 py-2 bg-white border border-gray-200 rounded-lg"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium px-2 py-1 rounded bg-saltire text-white leading-none">
                {tag.label}
              </span>
              <span className="text-xs text-coal/50 font-mono">{tag.id}</span>
            </div>
            <button
              onClick={() => onRemoveTag(tag.id)}
              className="p-1.5 text-coal/30 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
              aria-label={`Remove ${tag.label}`}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M3 4h10M6 4V2h4v2M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ))}

        <div className="flex gap-2 pt-1">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            placeholder="New tag label (e.g. 6+ Units)"
            className="flex-1 px-3 py-2 text-sm bg-snow border border-loch/10 rounded-lg outline-none focus:ring-2 focus:ring-loch/20 focus:border-loch/30 transition-all"
          />
          <button
            onClick={addTag}
            className="px-3 py-2 bg-loch text-white text-sm font-medium rounded-lg hover:bg-loch/90 transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
