"use client";

import { create } from "zustand";
import { ParseIssue, parseSankeyText, parseSankeyTextDetailed } from "@/lib/parse";
import { blankDocument } from "@/lib/templates";
import { DataFormat, SankeyDocument, SankeyGraph, SankeyStyle } from "@/lib/types";
import { linkStyleKey } from "@/lib/utils";

const HISTORY_LIMIT = 60;
const TEXT_HISTORY_GROUP_WINDOW_MS = 900;
const TEXT_PARSE_DEBOUNCE_MS = 220;

let lastTextHistoryAt = 0;
let textParseTimer: ReturnType<typeof setTimeout> | null = null;

type EditorState = {
  document: SankeyDocument;
  graph: SankeyGraph;
  parseError: string | null;
  parseIssue: ParseIssue | null;
  autoSync: boolean;
  hasHydrated: boolean;
  selectedNodeIds: string[];
  selectedLinkIndex: number | null;
  traceMode: "none" | "upstream" | "downstream";
  historyPast: SankeyDocument[];
  historyFuture: SankeyDocument[];
  initialize: (doc: SankeyDocument) => void;
  setHasHydrated: (value: boolean) => void;
  setTitle: (title: string) => void;
  setFormat: (format: DataFormat) => void;
  setEditorText: (text: string) => void;
  setAutoSync: (value: boolean) => void;
  syncFromEditor: () => void;
  patchStyle: (stylePatch: Partial<SankeyStyle>) => void;
  setNodePosition: (nodeId: string, y: number) => void;
  setNodePositions: (positions: Record<string, number>) => void;
  clearNodePositions: () => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedLinkIndex: (index: number | null) => void;
  toggleNodeSelection: (nodeId: string, additive: boolean) => void;
  clearSelection: () => void;
  setTraceMode: (mode: "none" | "upstream" | "downstream") => void;
  applyNodeColorToSelection: (color: string) => void;
  applyNodeOpacityToSelection: (opacity: number) => void;
  clearNodeColorFromSelection: () => void;
  clearSelectedNodeStyles: () => void;
  patchSelectedLinkStyle: (style: { color?: string; opacity?: number; widthScale?: number }) => void;
  clearSelectedLinkStyle: () => void;
  undo: () => void;
  redo: () => void;
};

function toDocument(source: Omit<SankeyDocument, "id" | "updatedAt">): SankeyDocument {
  return {
    id: crypto.randomUUID(),
    updatedAt: Date.now(),
    ...source,
  };
}

function normalizeDocument(document: SankeyDocument): SankeyDocument {
  const style = document.style;
  return {
    ...document,
    nodePositions: document.nodePositions ?? {},
    nodeStyles: document.nodeStyles ?? {},
    linkStyles: document.linkStyles ?? {},
    style: {
      ...style,
      theme: style.theme ?? "light",
      palette: style.palette ?? "classic",
      labelFontSize: style.labelFontSize ?? 12,
      labelPosition: style.labelPosition ?? "outside",
      labelColor: style.labelColor ?? (style.theme === "dark" ? "#cbd5e1" : "#334155"),
      labelFontFamily: style.labelFontFamily ?? "Roboto",
    },
  };
}

function withTimestamp(document: SankeyDocument) {
  return { ...document, updatedAt: Date.now() };
}

function addPastSnapshot(past: SankeyDocument[], snapshot: SankeyDocument) {
  const next = [...past, snapshot];
  if (next.length > HISTORY_LIMIT) {
    next.shift();
  }
  return next;
}

function parseDocument(document: SankeyDocument) {
  const result = parseSankeyTextDetailed(document.editorText, document.format);
  if (result.ok) {
    return {
      graph: result.graph,
      parseError: null,
      parseIssue: null,
    };
  }
  return {
    graph: null,
    parseError: result.issue.message,
    parseIssue: result.issue,
  };
}

const initialDocument = toDocument(blankDocument);
const initialGraph = parseSankeyText(initialDocument.editorText, initialDocument.format);

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
      const nextDocument = withTimestamp({ ...state.document, format });
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
      const nextDocument = withTimestamp({ ...state.document, editorText: text });
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
    try {
      const graph = parseSankeyText(document.editorText, document.format);
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
    set((state) => ({
      document: withTimestamp({
        ...state.document,
        style: { ...state.document.style, ...stylePatch },
      }),
      historyPast: addPastSnapshot(state.historyPast, state.document),
      historyFuture: [],
    })),
  setNodePosition: (nodeId, y) =>
    set((state) => ({
      document: withTimestamp({
        ...state.document,
        nodePositions: { ...state.document.nodePositions, [nodeId]: y },
      }),
    })),
  setNodePositions: (positions) =>
    set((state) => ({
      document: withTimestamp({
        ...state.document,
        nodePositions: { ...positions },
      }),
      historyPast: addPastSnapshot(state.historyPast, state.document),
      historyFuture: [],
    })),
  clearNodePositions: () =>
    set((state) => ({
      document: withTimestamp({ ...state.document, nodePositions: {} }),
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
      const nextNodeStyles = { ...state.document.nodeStyles };
      for (const nodeId of state.selectedNodeIds) {
        nextNodeStyles[nodeId] = { ...(nextNodeStyles[nodeId] ?? {}), color };
      }
      return {
        document: withTimestamp({ ...state.document, nodeStyles: nextNodeStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),
  applyNodeOpacityToSelection: (opacity) =>
    set((state) => {
      if (state.selectedNodeIds.length === 0) return {};
      const clamped = Math.max(0.1, Math.min(1, opacity));
      const nextNodeStyles = { ...state.document.nodeStyles };
      for (const nodeId of state.selectedNodeIds) {
        nextNodeStyles[nodeId] = { ...(nextNodeStyles[nodeId] ?? {}), opacity: clamped };
      }
      return {
        document: withTimestamp({ ...state.document, nodeStyles: nextNodeStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),
  clearNodeColorFromSelection: () =>
    set((state) => {
      if (state.selectedNodeIds.length === 0) return {};
      const nextNodeStyles = { ...state.document.nodeStyles };
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
        document: withTimestamp({ ...state.document, nodeStyles: nextNodeStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),
  clearSelectedNodeStyles: () =>
    set((state) => {
      if (state.selectedNodeIds.length === 0) return {};
      const nextNodeStyles = { ...state.document.nodeStyles };
      for (const nodeId of state.selectedNodeIds) {
        delete nextNodeStyles[nodeId];
      }
      return {
        document: withTimestamp({ ...state.document, nodeStyles: nextNodeStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),
  patchSelectedLinkStyle: (stylePatch) =>
    set((state) => {
      if (state.selectedLinkIndex == null) return {};
      const key = linkStyleKey(state.selectedLinkIndex);
      const nextLinkStyles = {
        ...state.document.linkStyles,
        [key]: {
          ...(state.document.linkStyles[key] ?? {}),
          ...stylePatch,
        },
      };
      return {
        document: withTimestamp({ ...state.document, linkStyles: nextLinkStyles }),
        historyPast: addPastSnapshot(state.historyPast, state.document),
        historyFuture: [],
      };
    }),
  clearSelectedLinkStyle: () =>
    set((state) => {
      if (state.selectedLinkIndex == null) return {};
      const key = linkStyleKey(state.selectedLinkIndex);
      if (!state.document.linkStyles[key]) return {};
      const nextLinkStyles = { ...state.document.linkStyles };
      delete nextLinkStyles[key];
      return {
        document: withTimestamp({ ...state.document, linkStyles: nextLinkStyles }),
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






