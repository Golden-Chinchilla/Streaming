/**
 * Diagram Plugin Registry
 *
 * Each diagram type (Sankey, Swimlane, etc.) registers itself as a plugin
 * that provides rendering components, data defaults, parsers, and metadata.
 */

import { ComponentType } from "react";
import { DataFormat, DiagramType, EditorMode } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Plugin component prop contracts                                   */
/* ------------------------------------------------------------------ */

/**
 * Props forwarded to every diagram canvas component.
 * The `data` field is the diagram-type-specific payload from `BaseDocument.data`.
 */
export type CanvasProps<TData = Record<string, unknown>> = {
    data: TData;
    width: number;
    height: number;
    /** Opaque pass-through – plugin decides how to handle interaction state */
    interactionState?: Record<string, unknown>;
    onDataChange?: (data: TData) => void;
    onSvgReady?: (svg: SVGSVGElement | null) => void;
};

/**
 * Props forwarded to the diagram-specific style / settings panel.
 */
export type StylePanelProps<TData = Record<string, unknown>> = {
    data: TData;
    onDataChange: (data: TData) => void;
};

/**
 * Result of parsing editor text into diagram data.
 */
export type ParseResult<TData = Record<string, unknown>> = {
    data: TData;
    error?: string | null;
};

/**
 * Input modes rendered in the editor's left data source header.
 * `dsl` is currently Sankey-specific textual shorthand.
 */
export type EditorInputMode = "json" | "csv" | "dsl";

/* ------------------------------------------------------------------ */
/*  DiagramPlugin interface                                           */
/* ------------------------------------------------------------------ */

export interface DiagramPlugin<TData = Record<string, unknown>> {
    /** Unique identifier matching DiagramType union */
    type: DiagramType;
    /** Human-readable name shown in UI */
    displayName: string;
    /** Short description for the "New Diagram" dialog */
    description: string;
    /** Icon component for menus, cards, etc. */
    icon: ComponentType<{ size?: number; className?: string }>;

    /** How the editor should behave for this diagram type */
    editorMode: EditorMode;
    /** Input modes shown in the editor; defaults to ["json"] when omitted */
    inputModes?: EditorInputMode[];

    /** The main rendering component */
    Canvas: ComponentType<CanvasProps<TData>>;
    /** Optional config panel rendered in the right sidebar */
    StylePanel?: ComponentType<StylePanelProps<TData>>;
    /** Optional toolbar for visual-mode diagrams (shows in left panel) */
    ToolPanel?: ComponentType<{ data: TData; onDataChange: (data: TData) => void }>;

    /** Returns fresh default data for a new document of this type */
    defaultData: () => TData;
    /** Parse editor text (for code/hybrid modes) into typed data */
    parse?: (text: string, format: DataFormat) => ParseResult<TData>;
    /** Serialize typed data back to editor text */
    serialize?: (data: TData, format: DataFormat) => string;

    /** Supported export formats, e.g. ["png", "svg"] */
    exportFormats?: string[];
}

/* ------------------------------------------------------------------ */
/*  Global registry                                                   */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<DiagramType, DiagramPlugin<any>>();

export function registerDiagram<TData>(plugin: DiagramPlugin<TData>): void {
    if (registry.has(plugin.type)) {
        console.warn(`[DiagramRegistry] Overwriting existing plugin: ${plugin.type}`);
    }
    registry.set(plugin.type, plugin);
}

export function getDiagramPlugin<TData = Record<string, unknown>>(
    type: DiagramType,
): DiagramPlugin<TData> | undefined {
    return registry.get(type) as DiagramPlugin<TData> | undefined;
}

export function getAllDiagramPlugins(): DiagramPlugin[] {
    return Array.from(registry.values());
}
