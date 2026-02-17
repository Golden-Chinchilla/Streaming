"use client";

import React from "react";
import { StylePanelProps } from "@/lib/diagram-registry";
import { SwimlaneData, SwimlaneStyle } from "./swimlane-types";

export function SwimlaneStylePanel({
    data,
    onDataChange,
}: StylePanelProps<SwimlaneData>) {
    const style: SwimlaneStyle = data.style;

    const updateStyle = (patch: Partial<SwimlaneStyle>) => {
        onDataChange({
            ...data,
            style: { ...style, ...patch },
        });
    };

    const labelClass = "text-xs font-medium text-muted block mb-1";
    const sliderClass = "w-full accent-primary";
    const sectionClass = "space-y-2 pb-4 border-b border-border last:border-b-0";

    return (
        <div className="space-y-4 p-4 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Swimlane Style
            </h3>

            {/* Theme Switcher */}
            <div className={sectionClass}>
                <label className={labelClass}>Theme</label>
                <div className="grid grid-cols-2 gap-1.5">
                    {(["light", "dark"] as const).map((t) => (
                        <button
                            key={t}
                            onClick={() => updateStyle({ theme: t })}
                            className={`rounded-lg px-2 py-1.5 text-xs font-medium capitalize transition-all ${style.theme === t
                                ? "bg-primary text-on-primary shadow-sm"
                                : "bg-surface-container text-foreground/70 hover:bg-surface-container-high"
                                }`}
                        >
                            {t}
                        </button>
                    ))}
                </div>
            </div>

            <div className={sectionClass}>
                <label className={labelClass}>Lane Orientation</label>
                <div className="grid grid-cols-2 gap-1.5">
                    {([
                        { value: "horizontal", label: "Horizontal Lanes" },
                        { value: "vertical", label: "Vertical Lanes" },
                    ] as const).map((option) => (
                        <button
                            key={option.value}
                            onClick={() => updateStyle({ orientation: option.value })}
                            className={`rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${((style.orientation ?? "horizontal") === option.value)
                                ? "bg-primary text-on-primary shadow-sm"
                                : "bg-surface-container text-foreground/70 hover:bg-surface-container-high"
                                }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Lane Header Width */}
            <div className={sectionClass}>
                <label className={labelClass}>
                    Lane Header Width — {style.laneHeaderWidth}px
                </label>
                <input
                    type="range"
                    min={60}
                    max={200}
                    step={5}
                    value={style.laneHeaderWidth}
                    onChange={(e) =>
                        updateStyle({ laneHeaderWidth: Number(e.target.value) })
                    }
                    className={sliderClass}
                />
            </div>

            {/* Node Radius */}
            <div className={sectionClass}>
                <label className={labelClass}>
                    Node Radius — {style.nodeRadius}px
                </label>
                <input
                    type="range"
                    min={0}
                    max={20}
                    step={1}
                    value={style.nodeRadius}
                    onChange={(e) =>
                        updateStyle({ nodeRadius: Number(e.target.value) })
                    }
                    className={sliderClass}
                />
            </div>

            {/* Edge Opacity */}
            <div className={sectionClass}>
                <label className={labelClass}>
                    Edge Opacity — {Math.round(style.edgeOpacity * 100)}%
                </label>
                <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={Math.round(style.edgeOpacity * 100)}
                    onChange={(e) =>
                        updateStyle({ edgeOpacity: Number(e.target.value) / 100 })
                    }
                    className={sliderClass}
                />
            </div>

            {/* Edge Curvature */}
            <div className={sectionClass}>
                <label className={labelClass}>
                    Edge Curvature — {Math.round(style.edgeCurvature * 100)}%
                </label>
                <input
                    type="range"
                    min={10}
                    max={90}
                    step={5}
                    value={Math.round(style.edgeCurvature * 100)}
                    onChange={(e) =>
                        updateStyle({ edgeCurvature: Number(e.target.value) / 100 })
                    }
                    className={sliderClass}
                />
            </div>

            {/* Label Font Size */}
            <div className={sectionClass}>
                <label className={labelClass}>
                    Label Size — {style.labelFontSize}px
                </label>
                <input
                    type="range"
                    min={8}
                    max={18}
                    step={1}
                    value={style.labelFontSize}
                    onChange={(e) =>
                        updateStyle({ labelFontSize: Number(e.target.value) })
                    }
                    className={sliderClass}
                />
            </div>

            {/* Show Labels */}
            <div className={sectionClass}>
                <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted hover:text-foreground transition-colors">
                    <div className="relative">
                        <input
                            type="checkbox"
                            checked={style.showLabels}
                            onChange={(e) =>
                                updateStyle({ showLabels: e.target.checked })
                            }
                            className="peer sr-only"
                        />
                        <div
                            className={`h-5 w-9 rounded-full transition-colors ${style.showLabels ? "bg-primary" : "bg-border"
                                }`}
                        />
                        <div
                            className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${style.showLabels ? "translate-x-4" : ""
                                }`}
                        />
                    </div>
                    Show Labels
                </label>
            </div>

            {/* Color Palette */}
            <div className={sectionClass}>
                <label className={labelClass}>Color Palette</label>
                <div className="grid grid-cols-3 gap-1.5">
                    {(["classic", "ocean", "sunset"] as const).map((p) => (
                        <button
                            key={p}
                            onClick={() => updateStyle({ palette: p })}
                            className={`rounded-lg px-2 py-1.5 text-xs font-medium capitalize transition-all ${style.palette === p
                                ? "bg-primary text-on-primary shadow-sm"
                                : "bg-surface-container text-foreground/70 hover:bg-surface-container-high"
                                }`}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
