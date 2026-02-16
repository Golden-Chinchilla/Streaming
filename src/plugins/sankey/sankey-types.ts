/* ------------------------------------------------------------------ */
/*  Sankey-specific type definitions (plugin-scoped)                  */
/* ------------------------------------------------------------------ */

import { DataFormat } from "@/lib/types";

export type SankeyLinkInput = {
    source: string;
    target: string;
    value: number;
};

export type SankeyGraph = {
    nodes: { id: string }[];
    links: SankeyLinkInput[];
};

export type SankeyStyle = {
    nodeWidth: number;
    nodePadding: number;
    nodeRadius: number;
    linkOpacity: number;
    curvature: number;
    labelStyle?: "plain" | "badge";
    linkRender?: "flat" | "soft";
    colorStrategy?: "palette" | "semantic";
    showLabels: boolean;
    labelFontSize: number;
    labelPosition: "inside" | "outside";
    labelColor: string;
    labelFontFamily: "Roboto" | "Google Sans" | "System Sans";
    theme: "light" | "dark";
    palette: "classic" | "ocean" | "sunset";
    linkGradient?: boolean;
    transparent?: boolean;
    align?: "justify" | "left" | "right" | "center";
    linkBlendMode?: "normal" | "multiply";
    labelThreshold?: number;
};

/**
 * The `data` blob stored inside a BaseDocument when diagramType === "sankey".
 * This replaces the old flat `SankeyDocument` fields.
 */
export type SankeyData = {
    format: DataFormat;
    editorText: string;
    style: SankeyStyle;
    nodePositions: Record<string, number>;
    nodeStyles: Record<string, { color?: string; opacity?: number }>;
    linkStyles: Record<string, { color?: string; opacity?: number; widthScale?: number }>;
};

export type EditableLink = {
    source: string;
    target: string;
    value: number;
};
