import { cn } from "@/lib/utils";

export const disabledState40 = "disabled:cursor-not-allowed disabled:opacity-40";
export const disabledState50 = "disabled:cursor-not-allowed disabled:opacity-50";

// M3: Filled Button (Primary)
export const buttonPrimarySm =
  "rounded-full bg-primary px-4 py-2 text-xs font-medium text-(--text-on-primary) shadow-sm transition hover:bg-(--primary-hover) hover:shadow active:bg-(--primary-active)";
export const buttonPrimaryMd =
  "rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-(--text-on-primary) shadow-sm transition hover:bg-(--primary-hover) hover:shadow-md active:bg-(--primary-active)";

// M3: Tonal Button (Secondary/Filled Tonal) -> Mapping to Secondary here
export const buttonSecondarySm =
  "rounded-full bg-(--bg-tertiary) px-4 py-2 text-xs font-medium text-(--text-secondary) transition hover:bg-[color-mix(in_srgb,var(--text-secondary)_8%,var(--bg-tertiary))] active:bg-[color-mix(in_srgb,var(--text-secondary)_12%,var(--bg-tertiary))]";
export const buttonSecondaryMd =
  "rounded-full bg-(--bg-tertiary) px-6 py-2.5 text-sm font-medium text-(--text-secondary) transition hover:bg-[color-mix(in_srgb,var(--text-secondary)_8%,var(--bg-tertiary))] active:bg-[color-mix(in_srgb,var(--text-secondary)_12%,var(--bg-tertiary))]";
export const buttonSecondaryTiny =
  "rounded-full bg-(--bg-tertiary) px-3 py-1 text-[11px] font-medium text-(--text-secondary) transition hover:bg-[color-mix(in_srgb,var(--text-secondary)_8%,var(--bg-tertiary))]";

// M3: Error/Danger (using Error container logic)
export const buttonDangerSm =
  "rounded-full bg-(--error) px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:shadow hover:bg-[color-mix(in_srgb,white_10%,var(--error))]";
export const buttonDangerSoftSm =
  "rounded-full bg-[color-mix(in_srgb,var(--error)_10%,transparent)] px-4 py-2 text-xs font-medium text-(--error) transition hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)]";
export const buttonDangerSoftTiny =
  "rounded-full bg-[color-mix(in_srgb,var(--error)_10%,transparent)] px-3 py-1 text-[11px] font-medium text-(--error) transition hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)]";

export const emptyStatePanelLg =
  "rounded-3xl border border-dashed border-border bg-surface p-8 text-center";
export const emptyStatePanelSm =
  "rounded-lg border border-dashed border-border bg-surface px-4 py-4 text-center text-xs text-muted";

export function withDisabled(className: string, strength: "40" | "50" = "40") {
  return cn(className, strength === "40" ? disabledState40 : disabledState50);
}

