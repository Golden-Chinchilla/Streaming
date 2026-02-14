import { cn } from "@/lib/utils";

export const disabledState40 = "disabled:cursor-not-allowed disabled:opacity-40";
export const disabledState50 = "disabled:cursor-not-allowed disabled:opacity-50";

export const buttonPrimarySm =
  "rounded-lg border border-[color:color-mix(in_srgb,var(--primary)_45%,transparent)] bg-gradient-to-r from-[var(--primary)] to-[var(--flow-3)] px-3 py-1.5 text-xs font-semibold text-[var(--text-on-primary)] shadow transition hover:from-[var(--primary-hover)] hover:to-[var(--flow-6)]";
export const buttonPrimaryMd =
  "rounded-xl border border-[color:color-mix(in_srgb,var(--primary)_45%,transparent)] bg-gradient-to-r from-[var(--primary)] to-[var(--flow-3)] px-4 py-2 text-sm font-semibold text-[var(--text-on-primary)] shadow transition hover:from-[var(--primary-hover)] hover:to-[var(--flow-6)]";

export const buttonSecondarySm =
  "rounded-lg border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-secondary)_88%,transparent)] px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-tertiary)]";
export const buttonSecondaryMd =
  "rounded-xl border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-secondary)_88%,transparent)] px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-tertiary)]";
export const buttonSecondaryTiny =
  "rounded-lg border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-secondary)_88%,transparent)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-tertiary)]";

export const buttonDangerSm =
  "rounded-lg border border-[color:color-mix(in_srgb,var(--error)_55%,transparent)] bg-[var(--error)] px-3 py-1.5 text-sm font-medium text-[var(--text-on-primary)] transition hover:bg-[color:color-mix(in_srgb,var(--error)_82%,white)]";
export const buttonDangerSoftSm =
  "rounded-lg border border-[color:color-mix(in_srgb,var(--error)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--error)_14%,transparent)] px-2 py-1 text-xs text-[color:color-mix(in_srgb,var(--error)_75%,white)] transition hover:bg-[color:color-mix(in_srgb,var(--error)_22%,transparent)]";
export const buttonDangerSoftTiny =
  "rounded-lg border border-[color:color-mix(in_srgb,var(--error)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--error)_14%,transparent)] px-2 py-1 text-[11px] text-[color:color-mix(in_srgb,var(--error)_75%,white)] transition hover:bg-[color:color-mix(in_srgb,var(--error)_22%,transparent)]";

export const emptyStatePanelLg =
  "rounded-2xl border border-dashed border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-secondary)_82%,transparent)] p-8 text-center";
export const emptyStatePanelSm =
  "rounded-lg border border-dashed border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-secondary)_82%,transparent)] px-2 py-3 text-center text-xs text-[var(--text-tertiary)]";

export function withDisabled(className: string, strength: "40" | "50" = "40") {
  return cn(className, strength === "40" ? disabledState40 : disabledState50);
}
