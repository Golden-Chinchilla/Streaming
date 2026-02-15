import { cn } from "@/lib/utils";

export const disabledState40 = "disabled:cursor-not-allowed disabled:opacity-40";
export const disabledState50 = "disabled:cursor-not-allowed disabled:opacity-50";

// M3: Filled Button (Primary)
export const buttonPrimarySm =
  "rounded-full bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--text-on-primary)] shadow-sm transition hover:bg-[var(--primary-hover)] hover:shadow active:bg-[var(--primary-active)]";
export const buttonPrimaryMd =
  "rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-medium text-[var(--text-on-primary)] shadow-sm transition hover:bg-[var(--primary-hover)] hover:shadow-md active:bg-[var(--primary-active)]";

// M3: Tonal Button (Secondary/Filled Tonal) -> Mapping to Secondary here
export const buttonSecondarySm =
  "rounded-full bg-[var(--bg-tertiary)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[color:color-mix(in_srgb,var(--text-secondary)_8%,var(--bg-tertiary))] active:bg-[color:color-mix(in_srgb,var(--text-secondary)_12%,var(--bg-tertiary))]";
export const buttonSecondaryMd =
  "rounded-full bg-[var(--bg-tertiary)] px-6 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[color:color-mix(in_srgb,var(--text-secondary)_8%,var(--bg-tertiary))] active:bg-[color:color-mix(in_srgb,var(--text-secondary)_12%,var(--bg-tertiary))]";
export const buttonSecondaryTiny =
  "rounded-full bg-[var(--bg-tertiary)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[color:color-mix(in_srgb,var(--text-secondary)_8%,var(--bg-tertiary))]";

// M3: Error/Danger (using Error container logic)
export const buttonDangerSm =
  "rounded-full bg-[var(--error)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:shadow hover:bg-[color:color-mix(in_srgb,white_10%,var(--error))]";
export const buttonDangerSoftSm =
  "rounded-full bg-[color:color-mix(in_srgb,var(--error)_10%,transparent)] px-4 py-2 text-xs font-medium text-[var(--error)] transition hover:bg-[color:color-mix(in_srgb,var(--error)_15%,transparent)]";
export const buttonDangerSoftTiny =
  "rounded-full bg-[color:color-mix(in_srgb,var(--error)_10%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--error)] transition hover:bg-[color:color-mix(in_srgb,var(--error)_15%,transparent)]";

export const emptyStatePanelLg =
  "rounded-[28px] border border-dashed border-[var(--border-base)] bg-[var(--bg-secondary)] p-8 text-center";
export const emptyStatePanelSm =
  "rounded-[16px] border border-dashed border-[var(--border-base)] bg-[var(--bg-secondary)] px-4 py-4 text-center text-xs text-[var(--text-tertiary)]";

export function withDisabled(className: string, strength: "40" | "50" = "40") {
  return cn(className, strength === "40" ? disabledState40 : disabledState50);
}

