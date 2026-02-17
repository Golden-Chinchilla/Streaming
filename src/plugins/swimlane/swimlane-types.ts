/* ------------------------------------------------------------------ */
/*  Swimlane-specific type definitions (plugin-scoped)                */
/* ------------------------------------------------------------------ */

import { DataFormat } from "@/lib/types";

export type SwimlaneNodeType = "start" | "end" | "task" | "decision" | "subprocess";

export type SwimlaneNode = {
    id: string;
    label: string;
    type: SwimlaneNodeType;
    laneId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
};

export type SwimlaneEdge = {
    id: string;
    source: string;
    target: string;
    label?: string;
};

export type SwimlaneLane = {
    id: string;
    label: string;
    color?: string;
};

export type SwimlaneStyle = {
    theme: "light" | "dark";
    orientation?: "horizontal" | "vertical";
    laneHeaderWidth: number;
    nodeRadius: number;
    edgeOpacity: number;
    showLabels: boolean;
    labelFontSize: number;
    edgeCurvature: number;
    palette: "classic" | "ocean" | "sunset";
};

/**
 * The `data` blob stored inside a BaseDocument when diagramType === "swimlane".
 */
export type SwimlaneData = {
    format: DataFormat;
    editorText: string;
    lanes: SwimlaneLane[];
    nodes: SwimlaneNode[];
    edges: SwimlaneEdge[];
    style: SwimlaneStyle;
};

export type SwimlaneGraph = {
    lanes: SwimlaneLane[];
    nodes: SwimlaneNode[];
    edges: SwimlaneEdge[];
};
