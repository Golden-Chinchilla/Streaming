import React from "react";
import { SankeyData } from "./sankey-types";

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
                    Align
                    <select
                        value={style.align || "justify"}
                        onChange={(e) => patchStyle({ align: e.target.value as "justify" | "left" | "right" | "center" })}
                        className={rightPanelFieldCompactClass}
                    >
                        <option value="justify">Justify</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="center">Center</option>
                    </select>
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
                <label className="block text-xs text-foreground/80">
                    Blend Mode
                    <select
                        value={style.linkBlendMode || "normal"}
                        onChange={(e) => patchStyle({ linkBlendMode: e.target.value as "normal" | "multiply" })}
                        className={rightPanelFieldCompactClass}
                    >
                        <option value="normal">Normal</option>
                        <option value="multiply">Multiply</option>
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
                    Hide Value &lt; {style.labelThreshold || 0}
                    <input
                        type="number"
                        min={0}
                        value={style.labelThreshold || 0}
                        onChange={(e) => patchStyle({ labelThreshold: Number(e.target.value) })}
                        className={rightPanelFieldCompactClass}
                    />
                </label>
                <label className="block text-xs text-foreground/80">
                    Label Color
                    <div className="mt-1 flex gap-2 items-center">
                        <div className="relative flex-1">
                            <input
                                type="color"
                                value={style.labelColor || "#000000"} // Show black if empty/auto, but effective color logic is in canvas
                                onChange={(e) => patchStyle({ labelColor: e.target.value })}
                                className="h-8 w-full rounded-lg cursor-pointer border border-border bg-transparent p-0"
                            />
                        </div>
                        <button
                            onClick={() => patchStyle({ labelColor: "" })}
                            className="px-2 py-1.5 text-xs font-medium text-muted hover:text-foreground bg-surface-container rounded-md transition-colors"
                            title="Reset to Auto (Theme Adaptive)"
                        >
                            Auto
                        </button>
                    </div>
                </label>
            </div>
            {/* Theme Section */}
            <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-muted">Theme</h3>

                <label className="flex items-center justify-between text-xs text-foreground/80">
                    Transparent Background
                    <input
                        type="checkbox"
                        checked={!!style.transparent}
                        onChange={(e) => patchStyle({ transparent: e.target.checked })}
                        className="rounded border-border bg-surface"
                    />
                </label>
            </div>
        </div>
    );
}
