/* ------------------------------------------------------------------ */
/*  Common types shared across the entire application                 */
/* ------------------------------------------------------------------ */

export type DataFormat = "json" | "csv";
export type PerformanceMode = "auto" | "quality" | "balanced" | "performance";

/* ------------------------------------------------------------------ */
/*  Diagram type system                                               */
/* ------------------------------------------------------------------ */

/**
 * Every diagram type has a unique string identifier.
 * New diagram types are added here as a union member.
 */
export type DiagramType = "sankey";
// Future: | "swimlane" | "flowchart" | ...

/**
 * The editor can operate in different modes depending on the diagram type.
 * - "code"   : user edits text (Monaco) and diagram reacts
 * - "visual" : user edits directly on canvas (drag & drop)
 * - "hybrid" : both code and visual editing available
 */
export type EditorMode = "code" | "visual" | "hybrid";

/* ------------------------------------------------------------------ */
/*  Document model                                                    */
/* ------------------------------------------------------------------ */

/**
 * Base document that all diagram types share.
 * Diagram-specific payload lives inside `data`.
 */
export type BaseDocument = {
  id: string;
  title: string;
  diagramType: DiagramType;
  folderId: string | null; // null = root level
  createdAt: number;
  updatedAt: number;
  /**
   * Diagram-type-specific data blob, fully owned by the DiagramPlugin.
   * The core system never inspects this – it only persists and forwards it.
   */
  data: Record<string, unknown>;
};

/* ------------------------------------------------------------------ */
/*  Folder / project model                                            */
/* ------------------------------------------------------------------ */

export type Folder = {
  id: string;
  name: string;
  parentId: string | null; // null = root level
  color?: string;
  createdAt: number;
};

/* ------------------------------------------------------------------ */
/*  App preferences                                                   */
/* ------------------------------------------------------------------ */

export type AppPreferences = {
  defaultTheme: "light" | "dark";
  defaultPerformanceMode: PerformanceMode;
  defaultExportTransparentBg: boolean;
  defaultExportFileTemplate: string;
};
