import React from "react";
import { SankeyData } from "./sankey-types";

// Constants from theme or constants file if needed, but for now we can keep them local or import if valid
const DARK_LABEL_COLOR = "#e2e8f0";
const LIGHT_LABEL_COLOR = "#1e293b";

export type SankeyStylePanelProps = {
    data: SankeyData;
    onDataChange: (data: SankeyData) => void;
};

export function SankeyStylePanel({ data, onDataChange }: SankeyStylePanelProps) {
    const { style } = data;

    const patchStyle = (updates: Partial<typeof style>) => {
        onDataChange({
            ...data,
            style: { ...style, ...updates },
        });
    };

    const rightPanelFieldCompactClass =
        "mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors";

    return (
        <div className="space-y-4 px-4 py-2">
            {/* Node Layout Section */}
            <div className="space-y-3 border-b border-border pb-4">
                <h3 className="text-xs font-semibold uppercase text-muted">Layout</h3>
                <label className="block text-xs text-foreground/80">
                    Node Width ({style.nodeWidth}px)
                    <input
                        type="range"
                        min={8}
                        max={42}
                        value={style.nodeWidth}
                        onChange={(e) => patchStyle({ nodeWidth: Number(e.target.value) })}
                        className="mt-1 w-full accent-primary"
                    />
                </label>
                <label className="block text-xs text-foreground/80">
                    Node Padding ({style.nodePadding}px)
                    <input
                        type="range"
                        min={4}
                        max={50}
                        value={style.nodePadding}
                        onChange={(e) => patchStyle({ nodePadding: Number(e.target.value) })}
                        className="mt-1 w-full accent-primary"
                    />
                </label>
                <label className="block text-xs text-foreground/80">
                    Node Radius ({style.nodeRadius}px)
                    <input
                        type="range"
                        min={0}
                        max={24}
                        value={style.nodeRadius}
                        onChange={(e) => patchStyle({ nodeRadius: Number(e.target.value) })}
                        className="mt-1 w-full accent-primary"
                    />
                </label>
            </div>

            {/* Link Style Section */}
            <div className="space-y-3 border-b border-border pb-4">
                <h3 className="text-xs font-semibold uppercase text-muted">Links</h3>
                <label className="block text-xs text-foreground/80">
                    Link Opacity ({Math.round(style.linkOpacity * 100)}%)
                    <input
                        type="range"
                        min={5}
                        max={100}
                        value={Math.round(style.linkOpacity * 100)}
                        onChange={(e) => patchStyle({ linkOpacity: Number(e.target.value) / 100 })}
                        className="mt-1 w-full accent-primary"
                    />
                </label>
                <label className="block text-xs text-foreground/80">
                    Curvature
                    <input
                        type="range"
                        min={0.15}
                        max={0.85}
                        step={0.01}
                        value={style.curvature}
                        onChange={(e) => patchStyle({ curvature: Number(e.target.value) })}
                        className="mt-1 w-full accent-primary"
                    />
                </label>
                <label className="block text-xs text-foreground/80">
                    Color Mode
                    <select
                        value={style.linkGradient ? "gradient" : "static"}
                        onChange={(e) => patchStyle({ linkGradient: e.target.value === "gradient" })}
                        className={rightPanelFieldCompactClass}
                    >
                        <option value="static">Static (Source)</option>
                        <option value="gradient">Gradient (Source → Target)</option>
                    </select>
                </label>
            </div>

            {/* Label Style Section */}
            <div className="space-y-3 border-b border-border pb-4">
                <h3 className="text-xs font-semibold uppercase text-muted">Labels</h3>
                <label className="flex items-center justify-between text-xs text-foreground/80">
                    Show Labels
                    <input
                        type="checkbox"
                        checked={style.showLabels}
                        onChange={(e) => patchStyle({ showLabels: e.target.checked })}
                        className="rounded border-border bg-surface"
                    />
                </label>
                <label className="block text-xs text-foreground/80">
                    Position
                    <select
                        value={style.labelPosition}
                        onChange={(e) => patchStyle({ labelPosition: e.target.value as "inside" | "outside" })}
                        className={rightPanelFieldCompactClass}
                    >
                        <option value="outside">Outside</option>
                        <option value="inside">Inside</option>
                    </select>
                </label>
                <label className="block text-xs text-foreground/80">
                    Font Size ({style.labelFontSize}px)
                    <input
                        type="range"
                        min={10}
                        max={24}
                        value={style.labelFontSize}
                        onChange={(e) => patchStyle({ labelFontSize: Number(e.target.value) })}
                        className="mt-1 w-full accent-primary"
                    />
                </label>
                <label className="block text-xs text-foreground/80">
                    Label Color
                    <div className="mt-1 flex gap-2">
                        <input
                            type="color"
                            value={style.labelColor}
                            onChange={(e) => patchStyle({ labelColor: e.target.value })}
                            className="h-8 w-full rounded-lg cursor-pointer border border-border"
                        />
                    </div>
                </label>
            </div>
            {/* Theme Section */}
            <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-muted">Theme</h3>
                <label className="block text-xs text-foreground/80">
                    Background Theme
                    <select
                        value={style.theme}
                        onChange={(e) => {
                            const nextTheme = e.target.value as "light" | "dark";
                            const nextLabelColor = nextTheme === "dark" ? DARK_LABEL_COLOR : LIGHT_LABEL_COLOR;
                            // Auto-switch label color if it matches the default
                            const currentDefault = style.theme === "dark" ? DARK_LABEL_COLOR : LIGHT_LABEL_COLOR;
                            const newLabelColor = style.labelColor === currentDefault ? nextLabelColor : style.labelColor;

                            patchStyle({ theme: nextTheme, labelColor: newLabelColor });
                        }}
                        className={rightPanelFieldCompactClass}
                    >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                    </select>
                </label>
                <label className="flex items-center justify-between text-xs text-foreground/80">
                    Transparent Background
                    <input
                        type="checkbox"
                        checked={style.transparent}
                        onChange={(e) => patchStyle({ transparent: e.target.checked })}
                        className="rounded border-border bg-surface"
                    />
                </label>
            </div>
        </div>
    );
}
