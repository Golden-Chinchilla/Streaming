"use client";

import { create } from "zustand";
import {
  ParseIssue,
  parseSankeyText,
  parseSankeyTextDetailed,
  SankeyData,
  SankeyGraph,
  SankeyStyle,
  defaultSankeyData,
} from "@/plugins/sankey";
import { BaseDocument, DataFormat } from "@/lib/types";
import { linkStyleKey } from "@/lib/utils";
import { DARK_LABEL_COLOR, LIGHT_LABEL_COLOR } from "@/lib/theme";

// Register the sankey plugin on first import
import "@/plugins/sankey/sankey-plugin";

const HISTORY_LIMIT = 60;
const TEXT_HISTORY_GROUP_WINDOW_MS = 900;
const TEXT_PARSE_DEBOUNCE_MS = 220;

let lastTextHistoryAt = 0;
let textParseTimer: ReturnType<typeof setTimeout> | null = null;

/* ------------------------------------------------------------------ */
/*  Helpers to read/write the Sankey-specific `data` blob              */
/* ------------------------------------------------------------------ */

function getSankeyData(doc: BaseDocument): SankeyData {
  return doc.data as unknown as SankeyData;
}

function withSankeyData(doc: BaseDocument, patch: Partial<SankeyData>): BaseDocument {
  const current = getSankeyData(doc);
  return {
    ...doc,
    updatedAt: Date.now(),
    data: { ...current, ...patch } as unknown as Record<string, unknown>,
  };
}

function withTimestamp(doc: BaseDocument): BaseDocument {
  return { ...doc, updatedAt: Date.now() };
}

/* ------------------------------------------------------------------ */
/*  Store types                                                       */
/* ------------------------------------------------------------------ */

type EditorState = {
  document: BaseDocument;
  graph: SankeyGraph;
  parseError: string | null;
  parseIssue: ParseIssue | null;
  autoSync: boolean;
  hasHydrated: boolean;
  selectedNodeIds: string[];
  selectedLinkIndex: number | null;
  traceMode: "none" | "upstream" | "downstream";
  historyPast: BaseDocument[];
  historyFuture: BaseDocument[];

  // Lifecycle
  initialize: (doc: BaseDocument) => void;
  setHasHydrated: (value: boolean) => void;

  // Document metadata
  setTitle: (title: string) => void;
  setFormat: (format: DataFormat) => void;
  setEditorText: (text: string) => void;
  setAutoSync: (value: boolean) => void;
  syncFromEditor: () => void;

  // Sankey-specific style & layout (delegated to plugin data)
  patchStyle: (stylePatch: Partial<SankeyStyle>) => void;
  setNodePosition: (nodeId: string, y: number) => void;
  setNodePositions: (positions: Record<string, number>) => void;
  clearNodePositions: () => void;

  // Selection
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedLinkIndex: (index: number | null) => void;
  toggleNodeSelection: (nodeId: string, additive: boolean) => void;
  clearSelection: () => void;
  setTraceMode: (mode: "none" | "upstream" | "downstream") => void;

  // Node/link styling
  applyNodeColorToSelection: (color: string) => void;
  applyNodeOpacityToSelection: (opacity: number) => void;
  clearNodeColorFromSelection: () => void;
  clearSelectedNodeStyles: () => void;
  patchSelectedLinkStyle: (style: { color?: string; opacity?: number; widthScale?: number }) => void;
  clearSelectedLinkStyle: () => void;

  // History
  undo: () => void;
  redo: () => void;
};

/* ------------------------------------------------------------------ */
/*  Normalisation & parsing                                           */
/* ------------------------------------------------------------------ */

function createNewDocument(data: SankeyData): BaseDocument {
  return {
    id: crypto.randomUUID(),
    title: "Untitled Diagram",
    diagramType: "sankey",
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: data as unknown as Record<string, unknown>,
  };
}

function normalizeDocument(doc: BaseDocument): BaseDocument {
  const sd = getSankeyData(doc);
  const style = sd.style ?? {};
  return withSankeyData(doc, {
    ...sd,
    nodePositions: sd.nodePositions ?? {},
    nodeStyles: sd.nodeStyles ?? {},
    linkStyles: sd.linkStyles ?? {},
    style: {
      ...style,
      theme: style.theme ?? "light",
      palette: style.palette ?? "classic",
      labelStyle: style.labelStyle ?? "badge",
      linkRender: style.linkRender ?? "soft",
      colorStrategy: style.colorStrategy === "semantic" ? "palette" : (style.colorStrategy ?? "palette"),
      labelFontSize: style.labelFontSize ?? 12,
      labelPosition: style.labelPosition ?? "outside",
      labelColor: style.labelColor ?? (style.theme === "dark" ? DARK_LABEL_COLOR : LIGHT_LABEL_COLOR),
      labelFontFamily: style.labelFontFamily ?? "Roboto",
    },
  });
}

function addPastSnapshot(past: BaseDocument[], snapshot: BaseDocument) {
  const next = [...past, snapshot];
  if (next.length > HISTORY_LIMIT) {
    next.shift();
  }
  return next;
}

function parseDocument(doc: BaseDocument) {
  const sd = getSankeyData(doc);
  const result = parseSankeyTextDetailed(sd.editorText, sd.format);
  if (result.ok) {
    return { graph: result.graph, parseError: null, parseIssue: null };
  }
  return {
    graph: null,
    parseError: result.issue.message,
    parseIssue: result.issue,
  };
}

/* ------------------------------------------------------------------ */
/*  Initial state                                                     */
/* ------------------------------------------------------------------ */

const initialDocument = createNewDocument(defaultSankeyData);
const initialGraph = parseSankeyText(defaultSankeyData.editorText, defaultSankeyData.format);

/* ------------------------------------------------------------------ */
/*  Zustand store                                                     */
/* ------------------------------------------------------------------ */

export const useEditorStore = create<EditorState>((set, get) => ({
  document: initialDocument,
  graph: initialGraph,
  parseError: null,
  parseIssue: null,
  autoSync: true,
  hasHydrated: false,
  selectedNodeIds: [],
  selectedLinkIndex: null,
  traceMode: "none",
  historyPast: [],
  historyFuture: [],

  initialize: (doc) => {
    if (textParseTimer) {
      clearTimeout(textParseTimer);
      textParseTimer = null;
    }
    lastTextHistoryAt = 0;
    const normalizedDoc = normalizeDocument(doc);
    const parsed = parseDocument(normalizedDoc);
    if (!parsed.graph) {
      set({
        document: normalizedDoc,
        parseError: parsed.parseError,
        parseIssue: parsed.parseIssue,
        historyPast: [],
        historyFuture: [],
        selectedNodeIds: [],
        selectedLinkIndex: null,
      });
      return;
    }
    set({
      document: normalizedDoc,
      graph: parsed.graph,
      parseError: null,
      parseIssue: null,
      historyPast: [],
      historyFuture: [],
      selectedNodeIds: [],
      selectedLinkIndex: null,
    });
  },

  setHasHydrated: (value) => set({ hasHydrated: value }),

  setTitle: (title) =>
    set((state) => {
      const nextDocument = withTimestamp({ ...state.document, title });
      return {
        document: nextDocument,
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),

  setFormat: (format) =>
    set((state) => {
      const nextDocument = withSankeyData(state.document, { format });
      const parsed = parseDocument(nextDocument);
      return {
        document: nextDocument,
        graph: parsed.graph ?? state.graph,
        parseError: parsed.parseError,
        parseIssue: parsed.parseIssue,
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),

  setEditorText: (text) => {
    const { autoSync } = get();
    const now = Date.now();

    set((state) => {
      const nextDocument = withSankeyData(state.document, { editorText: text });
      const shouldCreateHistoryPoint =
        state.historyPast.length === 0 || now - lastTextHistoryAt > TEXT_HISTORY_GROUP_WINDOW_MS;

      if (shouldCreateHistoryPoint) {
        lastTextHistoryAt = now;
      }

      return {
        document: nextDocument,
        historyPast: shouldCreateHistoryPoint
          ? addPastSnapshot(state.historyPast, state.document)
          : state.historyPast,
        historyFuture: shouldCreateHistoryPoint ? [] : state.historyFuture,
      };
    });

    if (!autoSync) return;

    if (textParseTimer) {
      clearTimeout(textParseTimer);
    }

    textParseTimer = setTimeout(() => {
      const state = get();
      const parsed = parseDocument(state.document);
      set((current) => ({
        graph: parsed.graph ?? current.graph,
        parseError: parsed.parseError,
        parseIssue: parsed.parseIssue,
      }));
    }, TEXT_PARSE_DEBOUNCE_MS);
  },

  setAutoSync: (value) => set({ autoSync: value }),

  syncFromEditor: () => {
    const { document } = get();
    const sd = getSankeyData(document);
    try {
      const graph = parseSankeyText(sd.editorText, sd.format);
      set((state) => ({
        graph,
        parseError: null,
        parseIssue: null,
        document: withTimestamp(state.document),
      }));
    } catch (error) {
      set({
        parseError: error instanceof Error ? error.message : "Invalid input",
        parseIssue: {
          message: error instanceof Error ? error.message : "Invalid input",
          line: 1,
          column: 1,
        },
      });
    }
  },

  patchStyle: (stylePatch) =>
    set((state) => {
      const sd = getSankeyData(state.document);
      return {
        document: withSankeyData(state.document, {
          style: { ...sd.style, ...stylePatch },
        }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),

  setNodePosition: (nodeId, y) =>
    set((state) => {
      const sd = getSankeyData(state.document);
      return {
        document: withSankeyData(state.document, {
          nodePositions: { ...sd.nodePositions, [nodeId]: y },
        }),
      };
    }),

  setNodePositions: (positions) =>
    set((state) => ({
      document: withSankeyData(state.document, { nodePositions: { ...positions } }),
      historyPast: addPastSnapshot(state.historyPast, state.document),
      historyFuture: [],
    })),

  clearNodePositions: () =>
    set((state) => ({
      document: withSankeyData(state.document, { nodePositions: {} }),
      historyPast: addPastSnapshot(state.historyPast, state.document),
      historyFuture: [],
    })),

  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids, selectedLinkIndex: null }),
  setSelectedLinkIndex: (index) => set({ selectedLinkIndex: index, selectedNodeIds: [] }),

  toggleNodeSelection: (nodeId, additive) =>
    set((state) => {
      if (!additive) {
        return { selectedNodeIds: [nodeId] };
      }
      const exists = state.selectedNodeIds.includes(nodeId);
      return {
        selectedNodeIds: exists
          ? state.selectedNodeIds.filter((id) => id !== nodeId)
          : [...state.selectedNodeIds, nodeId],
      };
    }),

  clearSelection: () => set({ selectedNodeIds: [], selectedLinkIndex: null }),
  setTraceMode: (mode) => set({ traceMode: mode }),

  applyNodeColorToSelection: (color) =>
    set((state) => {
      if (state.selectedNodeIds.length === 0) return {};
      const sd = getSankeyData(state.document);
      const nextNodeStyles = { ...sd.nodeStyles };
      for (const nodeId of state.selectedNodeIds) {
        nextNodeStyles[nodeId] = { ...(nextNodeStyles[nodeId] ?? {}), color };
      }
      return {
        document: withSankeyData(state.document, { nodeStyles: nextNodeStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),

  applyNodeOpacityToSelection: (opacity) =>
    set((state) => {
      if (state.selectedNodeIds.length === 0) return {};
      const clamped = Math.max(0.1, Math.min(1, opacity));
      const sd = getSankeyData(state.document);
      const nextNodeStyles = { ...sd.nodeStyles };
      for (const nodeId of state.selectedNodeIds) {
        nextNodeStyles[nodeId] = { ...(nextNodeStyles[nodeId] ?? {}), opacity: clamped };
      }
      return {
        document: withSankeyData(state.document, { nodeStyles: nextNodeStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),

  clearNodeColorFromSelection: () =>
    set((state) => {
      if (state.selectedNodeIds.length === 0) return {};
      const sd = getSankeyData(state.document);
      const nextNodeStyles = { ...sd.nodeStyles };
      for (const nodeId of state.selectedNodeIds) {
        if (!nextNodeStyles[nodeId]) continue;
        const rest = { ...nextNodeStyles[nodeId] };
        delete rest.color;
        if (Object.keys(rest).length === 0) {
          delete nextNodeStyles[nodeId];
        } else {
          nextNodeStyles[nodeId] = rest;
        }
      }
      return {
        document: withSankeyData(state.document, { nodeStyles: nextNodeStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),

  clearSelectedNodeStyles: () =>
    set((state) => {
      if (state.selectedNodeIds.length === 0) return {};
      const sd = getSankeyData(state.document);
      const nextNodeStyles = { ...sd.nodeStyles };
      for (const nodeId of state.selectedNodeIds) {
        delete nextNodeStyles[nodeId];
      }
      return {
        document: withSankeyData(state.document, { nodeStyles: nextNodeStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),

  patchSelectedLinkStyle: (stylePatch) =>
    set((state) => {
      if (state.selectedLinkIndex == null) return {};
      const sd = getSankeyData(state.document);
      const key = linkStyleKey(state.selectedLinkIndex);
      const nextLinkStyles = {
        ...sd.linkStyles,
        [key]: {
          ...(sd.linkStyles[key] ?? {}),
          ...stylePatch,
        },
      };
      return {
        document: withSankeyData(state.document, { linkStyles: nextLinkStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),

  clearSelectedLinkStyle: () =>
    set((state) => {
      if (state.selectedLinkIndex == null) return {};
      const sd = getSankeyData(state.document);
      const key = linkStyleKey(state.selectedLinkIndex);
      if (!sd.linkStyles[key]) return {};
      const nextLinkStyles = { ...sd.linkStyles };
      delete nextLinkStyles[key];
      return {
        document: withSankeyData(state.document, { linkStyles: nextLinkStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),

  undo: () =>
    set((state) => {
      if (state.historyPast.length === 0) return {};
      const previous = state.historyPast[state.historyPast.length - 1];
      const nextPast = state.historyPast.slice(0, -1);
      const parsed = parseDocument(previous);
      return {
        document: previous,
        graph: parsed.graph ?? state.graph,
        parseError: parsed.parseError,
        parseIssue: parsed.parseIssue,
        historyPast: nextPast,
        historyFuture: [state.document, ...state.historyFuture].slice(0, HISTORY_LIMIT),
        selectedNodeIds: [],
        selectedLinkIndex: null,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.historyFuture.length === 0) return {};
      const [nextDocument, ...restFuture] = state.historyFuture;
      const parsed = parseDocument(nextDocument);
      return {
        document: nextDocument,
        graph: parsed.graph ?? state.graph,
        parseError: parsed.parseError,
        parseIssue: parsed.parseIssue,
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: restFuture,
        selectedNodeIds: [],
        selectedLinkIndex: null,
      };
    }),
}));
