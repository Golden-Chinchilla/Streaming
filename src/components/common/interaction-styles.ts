import { cn } from "@/lib/utils";

export const disabledState40 = "disabled:cursor-not-allowed disabled:opacity-40";
export const disabledState50 = "disabled:cursor-not-allowed disabled:opacity-50";

export const buttonPrimarySm =
  "rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700";
export const buttonPrimaryMd =
  "rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700";

export const buttonSecondarySm =
  "rounded border px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50";
export const buttonSecondaryMd =
  "rounded-lg border px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50";
export const buttonSecondaryTiny =
  "rounded border px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50";

export const buttonDangerSm =
  "rounded border border-red-600 bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700";
export const buttonDangerSoftSm =
  "rounded border px-2 py-1 text-xs text-red-600 transition hover:bg-red-50";
export const buttonDangerSoftTiny =
  "rounded border px-2 py-1 text-[11px] text-red-600 transition hover:bg-red-50";

export const emptyStatePanelLg = "rounded-2xl border border-dashed bg-white p-8 text-center";
export const emptyStatePanelSm =
  "rounded-lg border border-dashed bg-white px-2 py-3 text-center text-xs text-slate-500";

export function withDisabled(className: string, strength: "40" | "50" = "40") {
  return cn(className, strength === "40" ? disabledState40 : disabledState50);
}
