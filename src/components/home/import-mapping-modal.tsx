"use client";

import {
  buttonPrimarySm,
  buttonSecondarySm,
  buttonDangerSoftSm,
  withDisabled,
} from "@/components/common/interaction-styles";
import { TableMapping } from "@/lib/source-import";

type MappingPresetOption = {
  id: string;
  name: string;
  compatible: boolean;
};

type PendingPreviewStats = {
  totalRows: number;
  outputRows: number;
  droppedRows: number;
  clampedRows: number;
};

type Props = {
  fileName: string;
  headers: string[];
  pendingMode: "csv" | "json";
  presetSearch: string;
  onPresetSearchChange: (value: string) => void;
  canClearModePresets: boolean;
  onClearModePresets: () => void;
  presets: MappingPresetOption[];
  selectedPresetId: string;
  onSelectedPresetIdChange: (value: string) => void;
  selectedPresetCompatible: boolean;
  onApplyPreset: () => void;
  onSavePreset: () => void;
  onRenamePreset: () => void;
  onDeletePreset: () => void;
  pendingMapping: TableMapping;
  onPendingMappingChange: (next: TableMapping) => void;
  pendingValuePolicy: "drop" | "clamp";
  onPendingValuePolicyChange: (value: "drop" | "clamp") => void;
  pendingMinValue: number;
  onPendingMinValueChange: (value: number) => void;
  pendingPreviewStats: PendingPreviewStats | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function ImportMappingModal({
  fileName,
  headers,
  pendingMode,
  presetSearch,
  onPresetSearchChange,
  canClearModePresets,
  onClearModePresets,
  presets,
  selectedPresetId,
  onSelectedPresetIdChange,
  selectedPresetCompatible,
  onApplyPreset,
  onSavePreset,
  onRenamePreset,
  onDeletePreset,
  pendingMapping,
  onPendingMappingChange,
  pendingValuePolicy,
  onPendingValuePolicyChange,
  pendingMinValue,
  onPendingMinValueChange,
  pendingPreviewStats,
  onClose,
  onConfirm,
}: Props) {
  const fieldClass = "mt-1 w-full rounded border bg-white px-2 py-1 text-xs";
  const compactFieldClass = "min-w-[220px] flex-1 rounded border bg-white px-2 py-1 text-xs";
  const neutralButtonClass = buttonSecondarySm;
  const neutralButtonSoftClass = withDisabled(buttonSecondarySm, "50");
  const dangerButtonSoftClass = withDisabled(buttonDangerSoftSm, "50");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="w-full max-w-2xl rounded-xl border bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Confirm import mapping</p>
            <p className="text-xs text-slate-500">{fileName}</p>
          </div>
          <button type="button" onClick={onClose} className={neutralButtonClass}>
            Cancel
          </button>
        </div>

        <div className="mt-3 rounded border bg-slate-50 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Mapping presets</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={presetSearch}
              onChange={(event) => onPresetSearchChange(event.target.value)}
              placeholder="Search presets"
              className={compactFieldClass}
            />
            <button
              type="button"
              onClick={onClearModePresets}
              disabled={!canClearModePresets}
              className={dangerButtonSoftClass}
              title={!canClearModePresets ? "No presets in this mode to clear." : "Clear all presets in current mode"}
            >
              Clear {pendingMode.toUpperCase()}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={selectedPresetId}
              onChange={(event) => onSelectedPresetIdChange(event.target.value)}
              className={compactFieldClass}
            >
              <option value="">Select preset ({pendingMode.toUpperCase()})</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                  {preset.compatible ? "" : " (incompatible)"}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onApplyPreset}
              disabled={!selectedPresetId || !selectedPresetCompatible}
              className={neutralButtonSoftClass}
              title={!selectedPresetId ? "Select a preset first." : !selectedPresetCompatible ? "Selected preset is incompatible with current headers." : "Apply selected preset"}
            >
              Apply preset
            </button>
            <button
              type="button"
              onClick={onSavePreset}
              className={neutralButtonSoftClass}
              title="Save current mapping as preset"
            >
              Save preset
            </button>
            <button
              type="button"
              onClick={onRenamePreset}
              disabled={!selectedPresetId}
              className={neutralButtonSoftClass}
              title={!selectedPresetId ? "Select a preset first." : "Rename selected preset"}
            >
              Rename preset
            </button>
            <button
              type="button"
              onClick={onDeletePreset}
              disabled={!selectedPresetId}
              className={dangerButtonSoftClass}
              title={!selectedPresetId ? "Select a preset first." : "Delete selected preset"}
            >
              Delete preset
            </button>
          </div>
          {presetSearch.trim().length > 0 && presets.length === 0 && (
            <p className="mt-2 text-[11px] text-slate-500">No presets match current search.</p>
          )}
          {selectedPresetId && !selectedPresetCompatible && (
            <p className="mt-2 text-[11px] text-amber-700">
              This preset does not match current headers and cannot be applied.
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-xs text-slate-600">
            Source column
            <select
              value={pendingMapping.source}
              onChange={(event) => onPendingMappingChange({ ...pendingMapping, source: event.target.value })}
              className={fieldClass}
            >
              {headers.map((header) => (
                <option key={`pending-source-${header}`} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Target column
            <select
              value={pendingMapping.target}
              onChange={(event) => onPendingMappingChange({ ...pendingMapping, target: event.target.value })}
              className={fieldClass}
            >
              {headers.map((header) => (
                <option key={`pending-target-${header}`} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Value column
            <select
              value={pendingMapping.value}
              onChange={(event) => onPendingMappingChange({ ...pendingMapping, value: event.target.value })}
              className={fieldClass}
            >
              {headers.map((header) => (
                <option key={`pending-value-${header}`} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-xs text-slate-600">
            Invalid value handling
            <select
              value={pendingValuePolicy}
              onChange={(event) => onPendingValuePolicyChange(event.target.value as "drop" | "clamp")}
              className={fieldClass}
            >
              <option value="drop">Drop invalid rows</option>
              <option value="clamp">Clamp invalid to min</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Min value when clamped
            <input
              type="number"
              min={0.0001}
              step={0.1}
              value={pendingMinValue}
              onChange={(event) => onPendingMinValueChange(Math.max(0.0001, Number(event.target.value) || 1))}
              className={fieldClass}
            />
          </label>
        </div>

        {pendingPreviewStats && (
          <div className="mt-3 rounded border bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Rows: total {pendingPreviewStats.totalRows}, output {pendingPreviewStats.outputRows}, dropped {pendingPreviewStats.droppedRows}, clamped {pendingPreviewStats.clampedRows}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonSecondarySm}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={buttonPrimarySm}
          >
            Import to Editor
          </button>
        </div>
      </div>
    </div>
  );
}
