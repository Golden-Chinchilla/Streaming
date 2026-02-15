"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Download,
  LayoutTemplate,
  GripVertical,
  Moon,
  Play,
  Redo2,
  Trash2,
  Undo2,
  Sun,
  FileUp,
  FileDown,
} from "lucide-react";
import { sankey, SankeyGraph as D3SankeyGraph } from "d3-sankey";
import { parseSankeyTextDetailed } from "@/plugins/sankey/sankey-parse";
import {
  deleteDocumentById,
  loadAppPreferences,
  loadAllDocuments,
  loadCurrentDocument,
  loadDocumentById,
  saveAppPreferences,
  setCurrentDocumentId,
  upsertDocument,
} from "@/lib/storage";
import {
  AppPreferences,
  DataFormat,
  PerformanceMode,
  BaseDocument,
} from "@/lib/types";
import { SankeyData } from "@/plugins/sankey/sankey-types";
import { AppIssue } from "@/lib/issues";
import {
  DARK_LABEL_COLOR,
  EXPORT_BG_DARK,
  EXPORT_BG_LIGHT,
  LIGHT_LABEL_COLOR,
} from "@/lib/theme";
import { SankeyMonacoEditor } from "@/components/editor/monaco-editor";
import { getDiagramPlugin } from "@/lib/diagram-registry";
import {
  FlowEditModal,
  LinkEditDraft,
  NodeEditDraft,
} from "@/components/editor/flow-edit-modal";
import { IssueCenter } from "@/components/common/issue-center";
import { useAppDialog } from "@/components/common/app-dialog";

import { useEditorStore } from "@/store/editor-store";
import { EditableLink } from "@/plugins/sankey/sankey-types";
import { serializeLinksByFormat } from "@/plugins/sankey/sankey-serialize";

function downloadFile(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function looksLikeJson(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function looksLikeCsv(text: string) {
  const firstNonEmpty = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstNonEmpty) return false;
  return firstNonEmpty.includes(",");
}

function looksLikeDsl(text: string) {
  return /\[[^\]]+\]/.test(text);
}

function resolveCssVarsInValue(
  value: string,
  lookupVar: (name: string) => string | null,
) {
  if (!value.includes("var(")) return value;
  return value.replace(
    /var\(\s*(--[A-Za-z0-9-_]+)\s*(?:,\s*([^)]+))?\)/g,
    (_match, varName: string, fallback?: string) => {
      const resolved = lookupVar(varName)?.trim();
      if (resolved) return resolved;
      return fallback?.trim() ?? "";
    },
  );
}

function isTransparentColor(value: string | null | undefined) {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "rgba(0,0,0,0)"
  );
}

type Props = {
  docId?: string;
};

const EXPORT_SETTINGS_STORAGE_KEY = "streaming-export-settings-v1";
const LEFT_WORKBENCH_MODE_STORAGE_KEY = "streaming-editor-left-workbench-mode-v1";
const CANVAS_BASE_WIDTH = 1200;
const CANVAS_BASE_HEIGHT = 700;

type AutoLayoutStrategy = "reset" | "compact" | "spacious" | "centered";
type LayoutNodeDatum = { id: string };
type LayoutLinkDatum = { source: string; target: string; value: number };
type LayoutGraph = D3SankeyGraph<LayoutNodeDatum, LayoutLinkDatum>;

const AUTO_LAYOUT_STRATEGY_OPTIONS: Array<{ id: AutoLayoutStrategy; label: string }> = [
  { id: "reset", label: "Default" },
  { id: "compact", label: "Compact" },
  { id: "spacious", label: "Spacious" },
  { id: "centered", label: "Centered" },
];
const LAYOUT_TOP = 30;
const LAYOUT_BOTTOM = 670;

function clampLayoutTop(top: number, nodeHeight: number) {
  return Math.max(LAYOUT_TOP, Math.min(LAYOUT_BOTTOM - nodeHeight, top));
}

function buildLayoutByStrategy(
  graph: { nodes: { id: string }[]; links: { source: string; target: string; value: number }[] },
  style: { nodeWidth: number; nodePadding: number },
  strategy: Exclude<AutoLayoutStrategy, "reset">,
) {
  const paddingByStrategy =
    strategy === "compact"
      ? Math.max(6, Math.round(style.nodePadding * 0.65))
      : strategy === "spacious"
        ? Math.min(48, Math.round(style.nodePadding * 1.45))
        : Math.min(52, Math.round(style.nodePadding * 1.2));

  const generator = sankey<LayoutNodeDatum, LayoutLinkDatum>()
    .nodeId((node) => node.id)
    .nodeWidth(style.nodeWidth)
    .nodePadding(paddingByStrategy)
    .extent([
      [44, LAYOUT_TOP],
      [1156, LAYOUT_BOTTOM],
    ]);

  const built: LayoutGraph = generator({
    nodes: graph.nodes.map((node) => ({ ...node })),
    links: graph.links.map((link) => ({ ...link })),
  });

  const nextPositions: Record<string, number> = {};
  if (strategy !== "centered") {
    for (const node of built.nodes) {
      nextPositions[node.id] = node.y0 ?? LAYOUT_TOP;
    }
    return nextPositions;
  }

  const columns = new Map<number, typeof built.nodes>();
  for (const node of built.nodes) {
    const columnKey = Math.round(node.x0 ?? 0);
    const inColumn = columns.get(columnKey) ?? [];
    inColumn.push(node);
    columns.set(columnKey, inColumn);
  }

  for (const [, columnNodes] of columns) {
    const minY = Math.min(...columnNodes.map((node) => node.y0 ?? LAYOUT_TOP));
    const maxY = Math.max(...columnNodes.map((node) => node.y1 ?? LAYOUT_TOP));
    const columnHeight = maxY - minY;
    const targetTop = LAYOUT_TOP + ((LAYOUT_BOTTOM - LAYOUT_TOP) - columnHeight) / 2;
    const offset = targetTop - minY;

    for (const node of columnNodes) {
      const currentTop = node.y0 ?? LAYOUT_TOP;
      const currentBottom = node.y1 ?? currentTop;
      const height = currentBottom - currentTop;
      nextPositions[node.id] = clampLayoutTop(currentTop + offset, height);
    }
  }

  return nextPositions;
}

type LeftWorkbenchMode = "collapsed" | "compact" | "expanded";
type ActiveWorkspaceOverlay = "none" | "left";
type ActiveEditorModal =
  | { type: "link"; index: number }
  | { type: "node"; id: string }
  | null;
const DEFAULT_APP_PREFERENCES: AppPreferences = {
  defaultTheme: "light",
  defaultPerformanceMode: "auto",
  defaultExportTransparentBg: false,
  defaultExportFileTemplate: "{title}-{date}",
};

function loadExportSettingsFromStorage() {
  const defaults = {
    width: 2000,
    height: 1200,
    padding: 24,
    pngScale: 1,
    transparent: false,
    fileTemplate: "{title}-{date}",
    hasSaved: false,
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(EXPORT_SETTINGS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<{
      width: number;
      height: number;
      padding: number;
      pngScale: number;
      transparent: boolean;
      fileTemplate: string;
    }>;
    return {
      width: Number.isFinite(parsed.width) ? Math.max(400, Math.min(6000, parsed.width!)) : defaults.width,
      height: Number.isFinite(parsed.height) ? Math.max(300, Math.min(6000, parsed.height!)) : defaults.height,
      padding: Number.isFinite(parsed.padding) ? Math.max(0, Math.min(300, parsed.padding!)) : defaults.padding,
      pngScale: Number.isFinite(parsed.pngScale) ? Math.max(1, Math.min(4, Math.round(parsed.pngScale!))) : defaults.pngScale,
      transparent: typeof parsed.transparent === "boolean" ? parsed.transparent : defaults.transparent,
      fileTemplate:
        typeof parsed.fileTemplate === "string" && parsed.fileTemplate.trim().length > 0
          ? parsed.fileTemplate
          : defaults.fileTemplate,
      hasSaved: true,
    };
  } catch {
    return defaults;
  }
}

function defaultLeftWorkbenchModeByWidth(width: number): LeftWorkbenchMode {
  if (width >= 1600) return "compact";
  if (width >= 1200) return "collapsed";
  return "collapsed";
}

function loadLeftWorkbenchModeFromStorage(): LeftWorkbenchMode {
  if (typeof window === "undefined") return "compact";
  const byWidth = defaultLeftWorkbenchModeByWidth(window.innerWidth);
  try {
    const raw = window.localStorage.getItem(LEFT_WORKBENCH_MODE_STORAGE_KEY);
    if (raw === "collapsed" || raw === "compact" || raw === "expanded") return raw;
    return byWidth;
  } catch {
    return byWidth;
  }
}

function viewportRange(width: number): "wide" | "medium" | "narrow" {
  if (width >= 1600) return "wide";
  if (width >= 1200) return "medium";
  return "narrow";
}

export function EditorWorkspace({ docId }: Props) {
  const router = useRouter();
  const { confirm, dialogNode } = useAppDialog();
  const [initialExportSettings] = useState(loadExportSettingsFromStorage);
  const [isAppPreferencesReady, setIsAppPreferencesReady] = useState(false);
  const [appPreferences, setAppPreferences] = useState<AppPreferences>(
    DEFAULT_APP_PREFERENCES,
  );
  const [showDocuments, setShowDocuments] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [allDocuments, setAllDocuments] = useState<BaseDocument[]>([]);

  const filteredDocuments = useMemo(() => {
    if (!librarySearch.trim()) return allDocuments;
    const lower = librarySearch.toLowerCase();
    return allDocuments.filter(d => (d.title || "Untitled").toLowerCase().includes(lower));
  }, [allDocuments, librarySearch]);

  const [isDragOver, setIsDragOver] = useState(false);
  const [svgElement, setSvgElement] = useState<SVGSVGElement | null>(null);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [canvasResetKey, setCanvasResetKey] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>("auto");
  const [exportWidth, setExportWidth] = useState(initialExportSettings.width);
  const [exportHeight, setExportHeight] = useState(initialExportSettings.height);
  const [exportPadding, setExportPadding] = useState(initialExportSettings.padding);
  const [exportPngScale, setExportPngScale] = useState(initialExportSettings.pngScale);
  const [exportTransparentBg, setExportTransparentBg] = useState(initialExportSettings.transparent);
  const [exportFileTemplate, setExportFileTemplate] = useState(initialExportSettings.fileTemplate);
  const [exportAllFormats] = useState<{ svg: boolean; png: boolean; html: boolean }>({
    svg: true,
    png: true,
    html: true,
  });
  const [exportAllNamingMode] = useState<"same" | "suffix">("suffix");
  const [viewportWidth, setViewportWidth] = useState<number>(typeof window === "undefined" ? 1600 : window.innerWidth);
  const [leftWorkbenchMode, setLeftWorkbenchMode] = useState<LeftWorkbenchMode>(loadLeftWorkbenchModeFromStorage);
  const leftWorkbenchVisible = leftWorkbenchMode !== "collapsed";
  const [activeWorkspaceOverlay, setActiveWorkspaceOverlay] = useState<ActiveWorkspaceOverlay>("none");
  const [autoLayoutStrategy, setAutoLayoutStrategy] = useState<AutoLayoutStrategy>("reset");
  const [canvasActionIssue, setCanvasActionIssue] = useState<AppIssue | null>(null);
  const [exportIssues, setExportIssues] = useState<AppIssue[]>([]);
  const [activeEditorModal, setActiveEditorModal] = useState<ActiveEditorModal>(null);
  const [linkEditDraft, setLinkEditDraft] = useState<LinkEditDraft | null>(null);
  const [nodeEditDraft, setNodeEditDraft] = useState<NodeEditDraft | null>(null);
  const [editorModalError, setEditorModalError] = useState<string | null>(null);



  // If we have a plugin, use its editor mode. Otherwise default to 'code' (legacy safe).

  // For now we assume Sankey is always code mode, as per existing logic.

  // --- Theme Sync & Auto-save ---
  const [editorModalAnchor, setEditorModalAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [pulseLinkIndex, setPulseLinkIndex] = useState<number | null>(null);
  const [pulseNodeId, setPulseNodeId] = useState<string | null>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showAutoLayoutMenu, setShowAutoLayoutMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [displayMenuTab, setDisplayMenuTab] = useState<"view" | "style">("view");
  const [showWorkspaceQuickMenu, setShowWorkspaceQuickMenu] = useState(false);


  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const displayMenuRef = useRef<HTMLDivElement | null>(null);
  const autoLayoutMenuRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceQuickMenuRef = useRef<HTMLDivElement | null>(null);
  const rawImportInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRangeRef = useRef<"wide" | "medium" | "narrow">(
    viewportRange(typeof window === "undefined" ? 1600 : window.innerWidth),
  );

  const {
    document: currentDoc,
    graph,
    parseError,
    parseIssue,
    autoSync,
    hasHydrated,
    selectedNodeIds,
    selectedLinkIndex,
    traceMode,
    historyPast,
    historyFuture,
    initialize,
    setHasHydrated,
    setTitle,
    setFormat,
    setEditorText,
    setAutoSync,
    syncFromEditor,
    patchStyle,
    setNodePositions,
    clearNodePositions,
    setSelectedNodeIds,
    setSelectedLinkIndex,
    clearSelection,
    setTraceMode,
    clearSelectedNodeStyles,
    clearSelectedLinkStyle,
    undo,
    redo,
  } = useEditorStore();

  const sankeyData = currentDoc.data as unknown as SankeyData;

  const alignDocThemeWithPreference = useCallback((doc: BaseDocument): BaseDocument => {
    const preferredTheme = appPreferences.defaultTheme;
    // We only know how to update usage for Sankey diagrams right now
    if (doc.diagramType !== 'sankey') return doc;

    const data = doc.data as unknown as SankeyData;
    if (data.style.theme === preferredTheme) return doc;

    const prevDefaultLabelColor = data.style.theme === "dark" ? DARK_LABEL_COLOR : LIGHT_LABEL_COLOR;
    const nextDefaultLabelColor = preferredTheme === "dark" ? DARK_LABEL_COLOR : LIGHT_LABEL_COLOR;

    return {
      ...doc,
      data: {
        ...data,
        style: {
          ...data.style,
          theme: preferredTheme,
          labelColor: data.style.labelColor === prevDefaultLabelColor
            ? nextDefaultLabelColor
            : data.style.labelColor,
        },
      } as unknown as Record<string, unknown>,
    };
  }, [appPreferences.defaultTheme]);



  useEffect(() => {
    let mounted = true;
    loadAppPreferences()
      .then((prefs) => {
        if (!mounted) return;
        setAppPreferences(prefs);
        setPerformanceMode(prefs.defaultPerformanceMode);
        if (!initialExportSettings.hasSaved) {
          setExportTransparentBg(prefs.defaultExportTransparentBg);
          setExportFileTemplate(prefs.defaultExportFileTemplate);
        }
      })
      .finally(() => {
        if (!mounted) return;
        setIsAppPreferencesReady(true);
      });
    return () => {
      mounted = false;
    };
  }, [initialExportSettings.hasSaved]);

  useEffect(() => {
    if (!isAppPreferencesReady) return;
    let isMounted = true;
    async function bootstrap() {
      if (docId) {
        const byId = await loadDocumentById(docId);
        if (byId) {
          // alignDocThemeWithPreference needs to work with BaseDocument
          const themedDoc = alignDocThemeWithPreference(byId);
          initialize(themedDoc);
          await setCurrentDocumentId(themedDoc.id);
          if (isMounted) setHasHydrated(true);
          return;
        }
      }

      const current = await loadCurrentDocument();
      if (current) {
        // alignDocThemeWithPreference
        const themedDoc = alignDocThemeWithPreference(current);
        initialize(themedDoc);
        await setCurrentDocumentId(themedDoc.id);
      } else {
        // No current doc, no ID -> create new blank Sankey doc
        // We need a way to create a default document here.
        // For now, let's redirect to home or create a dummy one?
        // Actually, the store has an initial blank document.
        const { defaultSankeyData } = await import("@/plugins/sankey");
        const newDoc: BaseDocument = {
          id: crypto.randomUUID(),
          title: "Untitled Diagram",
          diagramType: "sankey",
          folderId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          data: {
            ...defaultSankeyData,
            style: { ...defaultSankeyData.style, theme: appPreferences.defaultTheme }
          } as Record<string, unknown>
        };

        initialize(newDoc);
        await upsertDocument(newDoc);
        await setCurrentDocumentId(newDoc.id);
      }
      if (isMounted) setHasHydrated(true);
    }
    bootstrap();
    return () => {
      isMounted = false;
    };
  }, [
    appPreferences.defaultTheme,
    docId,
    initialize,
    isAppPreferencesReady,
    setHasHydrated,
    alignDocThemeWithPreference
  ]);

  useEffect(() => {
    if (!hasHydrated) return;
    const timer = window.setTimeout(async () => {
      await upsertDocument(currentDoc);
      await setCurrentDocumentId(currentDoc.id);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [currentDoc, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated) return;
    let mounted = true;
    Promise.all([loadAllDocuments()]).then(
      ([docs]) => {
        if (!mounted) return;
        setAllDocuments(docs);
      },
    );
    return () => {
      mounted = false;
    };
  }, [currentDoc.id, currentDoc.updatedAt, hasHydrated]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", sankeyData.style.theme);
  }, [sankeyData.style.theme]);



  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (fileMenuRef.current && !fileMenuRef.current.contains(target)) {
        setShowFileMenu(false);
      }
      if (displayMenuRef.current && !displayMenuRef.current.contains(target)) {
        setShowDisplayMenu(false);
      }
      if (autoLayoutMenuRef.current && !autoLayoutMenuRef.current.contains(target)) {
        setShowAutoLayoutMenu(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(target)) {
        setShowExportMenu(false);
      }
      if (workspaceQuickMenuRef.current && !workspaceQuickMenuRef.current.contains(target)) {
        setShowWorkspaceQuickMenu(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LEFT_WORKBENCH_MODE_STORAGE_KEY, leftWorkbenchMode);
  }, [leftWorkbenchMode]);

  useEffect(() => {
    const nextRange = viewportRange(viewportWidth);
    if (nextRange === viewportRangeRef.current) return;
    viewportRangeRef.current = nextRange;

    if (nextRange === "wide") {
      setLeftWorkbenchMode("compact");
      setShowWorkspaceQuickMenu(false);
      return;
    }
    setLeftWorkbenchMode("collapsed");
    setShowWorkspaceQuickMenu(false);
  }, [viewportWidth]);

  useEffect(() => {
    if (leftWorkbenchVisible) {
      setActiveWorkspaceOverlay("left");
      return;
    }
    setActiveWorkspaceOverlay("none");
  }, [leftWorkbenchVisible]);

  useEffect(() => {
    const isEditingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tagName = element.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return true;
      if (element.isContentEditable) return true;
      if (element.closest("[role='textbox']")) return true;
      return false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const editing = isEditingTarget(event.target);
      const lower = event.key.toLowerCase();
      if (
        event.key === "Escape" &&
        (showFileMenu || showDisplayMenu || showAutoLayoutMenu || showExportMenu)
      ) {
        setShowFileMenu(false);
        setShowDisplayMenu(false);
        setShowAutoLayoutMenu(false);
        setShowExportMenu(false);
        event.preventDefault();
        return;
      }
      if (!editing && event.key === "Escape" && leftWorkbenchVisible) {
        setLeftWorkbenchMode("collapsed");
        setActiveWorkspaceOverlay("none");
        event.preventDefault();
        return;
      }
      if (!editing && event.code === "Space") {
        if (!event.repeat) {
          setIsSpacePanning(true);
        }
        event.preventDefault();
        return;
      }

      if (!editing && event.key === "Escape") {
        clearSelection();
        setCanvasActionIssue({
          id: `shortcut-escape-${Date.now()}`,
          level: "info",
          title: "Selection cleared",
          description: "閿熸枻鎷疯弫? Escape",
        });
        return;
      }

      if (editing) return;

      if (event.ctrlKey || event.metaKey) {
        if (lower === "z" && !event.shiftKey) {
          event.preventDefault();
          undo();
          return;
        }
        if (lower === "y" || (lower === "z" && event.shiftKey)) {
          event.preventDefault();
          redo();
          return;
        }
        if (lower === "a") {
          event.preventDefault();
          setSelectedNodeIds(graph.nodes.map((node) => node.id));
          setSelectedLinkIndex(null);
          setCanvasActionIssue({
            id: `shortcut-select-all-${Date.now()}`,
            level: "info",
            title: `Selected ${graph.nodes.length} nodes`,
            description: "閿熸枻鎷疯弫? Ctrl/Cmd+A",
          });
          return;
        }
        if (event.shiftKey && lower === "l") {
          event.preventDefault();
          if (autoLayoutStrategy === "reset") {
            clearNodePositions();
            setCanvasActionIssue({
              id: `shortcut-layout-reset-${Date.now()}`,
              level: "success",
              title: "Applied auto-layout: Default",
              description: "閿熸枻鎷疯弫? Ctrl/Cmd+Shift+L",
            });
            return;
          }
          const nextPositions = buildLayoutByStrategy(graph, sankeyData.style, autoLayoutStrategy);
          setNodePositions(nextPositions);
          setCanvasActionIssue({
            id: `shortcut-layout-${Date.now()}`,
            level: "success",
            title: `Applied auto-layout: ${AUTO_LAYOUT_STRATEGY_OPTIONS.find((item) => item.id === autoLayoutStrategy)?.label ?? autoLayoutStrategy}`,
            description: "閿熸枻鎷疯弫? Ctrl/Cmd+Shift+L",
          });
          return;
        }
        if (lower === "1") {
          event.preventDefault();
          // setActiveTab("source"); // Removed
          return;
        }
        if (lower === "2") {
          event.preventDefault();
          // setActiveTab("editor"); // Removed
          return;
        }
      }

      if ((event.key === "Delete" || event.key === "Backspace") && (selectedNodeIds.length > 0 || selectedLinkIndex != null)) {
        event.preventDefault();
        if (selectedNodeIds.length > 0) {
          clearSelectedNodeStyles();
        }
        if (selectedLinkIndex != null) {
          clearSelectedLinkStyle();
        }
        clearSelection();
        setCanvasActionIssue({
          id: `shortcut-delete-${Date.now()}`,
          level: "warning",
          title: "Cleared selected styles",
          description: "閿熸枻鎷疯弫? Delete / Backspace",
        });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setIsSpacePanning(false);
      }
    };
    const onBlur = () => {
      setIsSpacePanning(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    autoLayoutStrategy,
    clearNodePositions,
    clearSelectedLinkStyle,
    clearSelectedNodeStyles,
    clearSelection,
    sankeyData.style,
    graph,
    redo,
    selectedLinkIndex,
    selectedNodeIds.length,
    setNodePositions,
    setSelectedLinkIndex,
    setSelectedNodeIds,
    showAutoLayoutMenu,
    showExportMenu,
    showFileMenu,
    showDisplayMenu,
    leftWorkbenchVisible,
    undo,
  ]);

  useEffect(() => {
    if (!isAppPreferencesReady) return;
    void saveAppPreferences(appPreferences);
  }, [appPreferences, isAppPreferencesReady]);

  useEffect(() => {
    window.localStorage.setItem(
      EXPORT_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        width: exportWidth,
        height: exportHeight,
        padding: exportPadding,
        pngScale: exportPngScale,
        transparent: exportTransparentBg,
        fileTemplate: exportFileTemplate,
      }),
    );
  }, [
    exportFileTemplate,
    exportHeight,
    exportPadding,
    exportPngScale,
    exportTransparentBg,
    exportWidth,
  ]);

  useEffect(() => {
    if (exportIssues.length === 0) return;
    setExportIssues([]);
  }, [
    exportAllFormats.html,
    exportAllFormats.png,
    exportAllFormats.svg,
    exportAllNamingMode,
    exportHeight,
    exportPadding,
    exportPngScale,
    exportTransparentBg,
    exportWidth,
    exportIssues.length,
  ]);

  useEffect(() => {
    if (!graph) return;
    if (selectedNodeIds.length === 0) return;
    const existing = new Set(graph.nodes.map((node) => node.id));
    const filtered = selectedNodeIds.filter((id) => existing.has(id));
    if (filtered.length !== selectedNodeIds.length) {
      setSelectedNodeIds(filtered);
    }
  }, [graph, selectedNodeIds, setSelectedNodeIds]);

  useEffect(() => {
    if (selectedNodeIds.length > 0) return;
    if (traceMode !== "none") {
      setTraceMode("none");
    }
  }, [selectedNodeIds, traceMode, setTraceMode]);

  useEffect(() => {
    if (selectedLinkIndex == null) return;
    if (selectedLinkIndex < 0 || selectedLinkIndex >= graph.links.length) {
      setSelectedLinkIndex(null);
    }
  }, [graph.links.length, selectedLinkIndex, setSelectedLinkIndex]);

  useEffect(() => {
    if (!activeEditorModal) return;
    if (activeEditorModal.type === "link") {
      if (activeEditorModal.index < 0 || activeEditorModal.index >= graph.links.length) {
        closeEditorModal();
      }
      return;
    }
    const exists = graph.nodes.some((node) => node.id === activeEditorModal.id);
    if (!exists) {
      closeEditorModal();
    }
  }, [activeEditorModal, graph.links.length, graph.nodes]);


  const editorIssues = useMemo<AppIssue[]>(() => {
    if (parseError) {
      return [
        {
          id: "editor-parse-error",
          level: "error",
          title: "Parse error",
          description: parseError,
        },
      ];
    }
    return [
      {
        id: "editor-parse-ok",
        level: "success",
        title: "Data is valid",
      },
    ];
  }, [parseError]);

  useEffect(() => {
    if (!canvasActionIssue) return;
    const timeoutId = window.setTimeout(() => {
      setCanvasActionIssue(null);
    }, 2600);
    return () => window.clearTimeout(timeoutId);
  }, [canvasActionIssue]);

  const resolvedExportBaseName = useMemo(() => {
    const today = new Date();
    const date =
      `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const safeTitle = (currentDoc.title || "diagram").trim().replace(/[\\/:*?"<>|]/g, "-");
    const base = exportFileTemplate
      .replaceAll("{title}", safeTitle)
      .replaceAll("{date}", date)
      .trim();
    return base.length > 0 ? base : safeTitle;
  }, [currentDoc.title, exportFileTemplate]);
  const exportSolidBackground = sankeyData.style.theme === "dark" ? EXPORT_BG_DARK : EXPORT_BG_LIGHT;
  const effectiveExportBackground = useMemo(() => {
    if (!svgElement) return exportSolidBackground;
    const container = svgElement.parentElement?.parentElement;
    if (!container) return exportSolidBackground;
    const bg = getComputedStyle(container).backgroundColor;
    if (isTransparentColor(bg)) return exportSolidBackground;
    return bg;
  }, [exportSolidBackground, svgElement]);

  const exportSvgString = useMemo(() => {
    if (!svgElement) return "";
    const cloned = svgElement.cloneNode(true) as SVGSVGElement;
    const rootComputed = getComputedStyle(document.documentElement);
    const svgComputed = getComputedStyle(svgElement);
    const lookupVar = (name: string) =>
      svgComputed.getPropertyValue(name) || rootComputed.getPropertyValue(name) || null;

    const clampedPadding = Math.max(0, Math.min(300, exportPadding));
    const innerWidth = Math.max(1, exportWidth - clampedPadding * 2);
    const innerHeight = Math.max(1, exportHeight - clampedPadding * 2);
    const fitScale = Math.min(
      innerWidth / CANVAS_BASE_WIDTH,
      innerHeight / CANVAS_BASE_HEIGHT,
    );
    const usedWidth = CANVAS_BASE_WIDTH * fitScale;
    const usedHeight = CANVAS_BASE_HEIGHT * fitScale;
    const offsetX = clampedPadding + (innerWidth - usedWidth) / 2;
    const offsetY = clampedPadding + (innerHeight - usedHeight) / 2;

    const contentGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    contentGroup.setAttribute(
      "transform",
      `translate(${offsetX.toFixed(3)} ${offsetY.toFixed(3)}) scale(${fitScale.toFixed(6)})`,
    );
    while (cloned.firstChild) {
      contentGroup.appendChild(cloned.firstChild);
    }

    cloned.setAttribute("viewBox", `0 0 ${exportWidth} ${exportHeight}`);
    cloned.setAttribute("width", String(exportWidth));
    cloned.setAttribute("height", String(exportHeight));
    cloned.appendChild(contentGroup);

    const colorAttrs = ["fill", "stroke", "stop-color", "color"];
    const allElements = [cloned, ...Array.from(cloned.querySelectorAll("*"))];
    for (const element of allElements) {
      for (const attr of colorAttrs) {
        const raw = element.getAttribute(attr);
        if (!raw || !raw.includes("var(")) continue;
        const resolved = resolveCssVarsInValue(raw, lookupVar);
        if (resolved) {
          element.setAttribute(attr, resolved);
        } else {
          element.removeAttribute(attr);
        }
      }
      const styleAttr = element.getAttribute("style");
      if (styleAttr && styleAttr.includes("var(")) {
        element.setAttribute("style", resolveCssVarsInValue(styleAttr, lookupVar));
      }
    }

    if (!exportTransparentBg) {
      const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      background.setAttribute("x", "0");
      background.setAttribute("y", "0");
      background.setAttribute("width", String(exportWidth));
      background.setAttribute("height", String(exportHeight));
      background.setAttribute("fill", effectiveExportBackground);
      cloned.insertBefore(background, cloned.firstChild);
    }
    return new XMLSerializer().serializeToString(cloned);
  }, [
    effectiveExportBackground,
    exportHeight,
    exportPadding,
    exportTransparentBg,
    exportWidth,
    svgElement,
  ]);

  const graphMetrics = useMemo(
    () => ({ nodes: graph.nodes.length, links: graph.links.length }),
    [graph.links.length, graph.nodes.length],
  );

  const performanceProfile = useMemo(() => {
    if (graphMetrics.nodes >= 900 || graphMetrics.links >= 2500) {
      return {
        tier: "extreme",
        recommendedMode: "performance" as Exclude<PerformanceMode, "auto">,
        shouldReduceMotion: true,
      };
    }
    if (graphMetrics.nodes >= 500 || graphMetrics.links >= 1400) {
      return {
        tier: "heavy",
        recommendedMode: "performance" as Exclude<PerformanceMode, "auto">,
        shouldReduceMotion: true,
      };
    }
    if (graphMetrics.nodes >= 220 || graphMetrics.links >= 650) {
      return {
        tier: "medium",
        recommendedMode: "balanced" as Exclude<PerformanceMode, "auto">,
        shouldReduceMotion: false,
      };
    }
    return {
      tier: "light",
      recommendedMode: "quality" as Exclude<PerformanceMode, "auto">,
      shouldReduceMotion: false,
    };
  }, [graphMetrics.links, graphMetrics.nodes]);

  const effectivePerformanceMode = useMemo<Exclude<PerformanceMode, "auto">>(() => {
    if (performanceMode !== "auto") return performanceMode;
    return performanceProfile.recommendedMode;
  }, [performanceMode, performanceProfile.recommendedMode]);

  const renderHints = useMemo(() => {
    if (effectivePerformanceMode === "quality") {
      return {
        showLabels: true,
        enableLinkHover: true,
        dragThrottleMs: 0,
        simplifyLinkCurves: false,
        lowDetailDuringDrag: false,
      };
    }
    if (effectivePerformanceMode === "balanced") {
      return {
        showLabels: graphMetrics.nodes <= 320,
        enableLinkHover: graphMetrics.links <= 1800,
        dragThrottleMs: 16,
        simplifyLinkCurves: graphMetrics.links >= 900,
        lowDetailDuringDrag: true,
      };
    }

    if (performanceProfile.tier === "extreme") {
      return {
        showLabels: false,
        enableLinkHover: false,
        dragThrottleMs: 52,
        simplifyLinkCurves: true,
        lowDetailDuringDrag: true,
      };
    }

    return {
      showLabels: false,
      enableLinkHover: graphMetrics.links <= 900,
      dragThrottleMs: 36,
      simplifyLinkCurves: true,
      lowDetailDuringDrag: true,
    };
  }, [effectivePerformanceMode, graphMetrics.links, graphMetrics.nodes, performanceProfile.tier]);

  const pushCanvasActionIssue = (
    level: AppIssue["level"],
    title: string,
    description?: string,
  ) => {
    setCanvasActionIssue({
      id: `canvas-action-${crypto.randomUUID()}`,
      level,
      title,
      description,
    });
  };

  const nodeIdOptions = useMemo(
    () => graph.nodes.map((node) => node.id).sort((a, b) => a.localeCompare(b)),
    [graph.nodes],
  );

  const nodeStatsById = useMemo(() => {
    const stats = new Map<
      string,
      {
        incomingCount: number;
        outgoingCount: number;
        incomingValue: number;
        outgoingValue: number;
      }
    >();
    graph.nodes.forEach((node) => {
      stats.set(node.id, {
        incomingCount: 0,
        outgoingCount: 0,
        incomingValue: 0,
        outgoingValue: 0,
      });
    });
    graph.links.forEach((link) => {
      const source = stats.get(link.source);
      if (source) {
        source.outgoingCount += 1;
        source.outgoingValue += link.value;
      }
      const target = stats.get(link.target);
      if (target) {
        target.incomingCount += 1;
        target.incomingValue += link.value;
      }
    });
    return stats;
  }, [graph.links, graph.nodes]);

  const linkDraftValidationError = useMemo(() => {
    if (!linkEditDraft) return null;
    const source = linkEditDraft.source.trim();
    const target = linkEditDraft.target.trim();
    const value = Number(linkEditDraft.value);
    if (!source || !target) return "From and To are required.";
    if (source === target) return "From and To cannot be the same node.";
    if (!Number.isFinite(value) || value <= 0) return "Value must be a positive number.";
    return null;
  }, [linkEditDraft]);

  const nodeDraftValidationError = useMemo(() => {
    if (!nodeEditDraft) return null;
    const nextId = nodeEditDraft.nextId.trim();
    if (!nextId) return "Node name cannot be empty.";
    if (
      nextId !== nodeEditDraft.id &&
      graph.nodes.some((node) => node.id.toLowerCase() === nextId.toLowerCase())
    ) {
      return "A node with this name already exists.";
    }
    return null;
  }, [graph.nodes, nodeEditDraft]);

  const closeEditorModal = () => {
    setActiveEditorModal(null);
    setLinkEditDraft(null);
    setNodeEditDraft(null);
    setEditorModalAnchor(null);
    setEditorModalError(null);
  };

  const openLinkEditor = useCallback(
    (index: number, anchor?: { x: number; y: number }) => {
      const link = graph.links[index];
      if (!link) return;
      setSelectedLinkIndex(index);
      setLinkEditDraft({
        source: link.source,
        target: link.target,
        value: link.value,
      });
      setNodeEditDraft(null);
      setEditorModalError(null);
      setEditorModalAnchor(anchor ?? null);
      setActiveEditorModal({ type: "link", index });
    },
    [graph.links, setSelectedLinkIndex],
  );

  const openNodeEditor = useCallback(
    (nodeId: string, anchor?: { x: number; y: number }) => {
      const exists = graph.nodes.some((node) => node.id === nodeId);
      if (!exists) return;
      setSelectedNodeIds([nodeId]);
      setNodeEditDraft({
        id: nodeId,
        nextId: nodeId,
      });
      setLinkEditDraft(null);
      setEditorModalError(null);
      setEditorModalAnchor(anchor ?? null);
      setActiveEditorModal({ type: "node", id: nodeId });
    },
    [graph.nodes, setSelectedNodeIds],
  );

  const applyNextLinksToEditor = (
    nextLinks: EditableLink[],
    successTitle: string,
    successDescription?: string,
  ) => {
    const nextText = serializeLinksByFormat(nextLinks, sankeyData.format);
    clearNodePositions();
    setEditorText(nextText);
    if (activeEditorModal?.type === "link") {
      setPulseLinkIndex(activeEditorModal.index);
      setPulseNodeId(null);
    }
    if (activeEditorModal?.type === "node") {
      setPulseNodeId(nodeEditDraft?.nextId.trim() || nodeEditDraft?.id || null);
      setPulseLinkIndex(null);
    }
    closeEditorModal();
    if (autoSync) {
      pushCanvasActionIssue("success", successTitle, successDescription);
      return;
    }
    pushCanvasActionIssue(
      "info",
      `${successTitle} (Text Updated)`,
      "Auto-sync is off. Press Sync to refresh the graph.",
    );
  };

  const saveLinkEdit = () => {
    if (!activeEditorModal || activeEditorModal.type !== "link" || !linkEditDraft) return;
    if (linkDraftValidationError) {
      setEditorModalError(linkDraftValidationError);
      return;
    }
    const source = linkEditDraft.source.trim();
    const target = linkEditDraft.target.trim();
    const value = Number(linkEditDraft.value);

    const nextLinks = graph.links.map((link, index) =>
      index === activeEditorModal.index ? { source, target, value } : { ...link },
    );
    applyNextLinksToEditor(nextLinks, "Flow updated", `${source} -> ${target}`);
  };

  const jumpToRelatedLink = (mode: "source" | "target") => {
    if (!activeEditorModal || activeEditorModal.type !== "link") return;
    const current = graph.links[activeEditorModal.index];
    if (!current) return;
    const matchIndices = graph.links
      .map((link, index) => ({ link, index }))
      .filter(({ link, index }) => {
        if (index === activeEditorModal.index) return false;
        return mode === "source"
          ? link.source === current.source
          : link.target === current.target;
      })
      .map(({ index }) => index)
      .sort((a, b) => a - b);
    if (matchIndices.length === 0) return;
    const next =
      matchIndices.find((index) => index > activeEditorModal.index) ?? matchIndices[0];
    openLinkEditor(next, editorModalAnchor ?? undefined);
  };

  const deleteLinkEdit = () => {
    if (!activeEditorModal || activeEditorModal.type !== "link") return;
    const targetLink = graph.links[activeEditorModal.index];
    const nextLinks = graph.links
      .filter((_, index) => index !== activeEditorModal.index)
      .map((link) => ({ ...link }));
    applyNextLinksToEditor(
      nextLinks,
      "Flow removed",
      targetLink ? `${targetLink.source} -> ${targetLink.target}` : undefined,
    );
  };

  const saveNodeEdit = () => {
    if (!activeEditorModal || activeEditorModal.type !== "node" || !nodeEditDraft) return;
    if (nodeDraftValidationError) {
      setEditorModalError(nodeDraftValidationError);
      return;
    }
    const nextId = nodeEditDraft.nextId.trim();
    const originalId = nodeEditDraft.id;

    const nextLinks = graph.links.map((link) => ({
      source: link.source === originalId ? nextId : link.source,
      target: link.target === originalId ? nextId : link.target,
      value: link.value,
    }));
    applyNextLinksToEditor(nextLinks, "Node renamed", `${originalId} -> ${nextId}`);
  };

  useEffect(() => {
    if (pulseLinkIndex == null && !pulseNodeId) return;
    const timer = window.setTimeout(() => {
      setPulseLinkIndex(null);
      setPulseNodeId(null);
    }, 620);
    return () => window.clearTimeout(timer);
  }, [pulseLinkIndex, pulseNodeId]);

  const applyAutoLayoutStrategy = (strategy: AutoLayoutStrategy, source: "toolbar" | "shortcut" = "toolbar") => {
    if (strategy === "reset") {
      clearNodePositions();
      pushCanvasActionIssue(
        "success",
        "Applied auto-layout: Default",
        source === "shortcut" ? "閿熸枻鎷疯弫? Ctrl/Cmd+Shift+L" : "Reset to default d3-sankey layout",
      );
      return;
    }
    const nextPositions = buildLayoutByStrategy(graph, sankeyData.style, strategy);
    setNodePositions(nextPositions);
    const label = AUTO_LAYOUT_STRATEGY_OPTIONS.find((item) => item.id === strategy)?.label ?? strategy;
    pushCanvasActionIssue(
      "success",
      `Applied auto-layout: ${label}`,
      source === "shortcut" ? "閿熸枻鎷疯弫? Ctrl/Cmd+Shift+L" : `${graph.nodes.length} nodes updated`,
    );
  };

  const clearSelectionWithNotice = () => {
    if (selectedNodeIds.length === 0 && selectedLinkIndex == null) return;
    clearSelection();
    pushCanvasActionIssue("info", "Selection cleared");
  };

  const validateExportRequest = (target: "svg" | "png" | "html" | "all") => {
    const issues: AppIssue[] = [];

    const push = (level: AppIssue["level"], title: string, description?: string) => {
      issues.push({
        id: `export-issue-${crypto.randomUUID()}`,
        level,
        title,
        description,
      });
    };

    if (!Number.isFinite(exportWidth) || exportWidth < 400 || exportWidth > 6000) {
      push("error", "Invalid export width", "Width must be between 400 and 6000.");
    }
    if (!Number.isFinite(exportHeight) || exportHeight < 300 || exportHeight > 6000) {
      push("error", "Invalid export height", "Height must be between 300 and 6000.");
    }
    if (!Number.isFinite(exportPadding) || exportPadding < 0 || exportPadding > 300) {
      push("error", "Invalid export padding", "Padding must be between 0 and 300.");
    }
    if (exportPadding * 2 >= exportWidth || exportPadding * 2 >= exportHeight) {
      push("error", "Padding is too large", "Padding must be smaller than half of width and height.");
    }
    if (!Number.isFinite(exportPngScale) || exportPngScale < 1 || exportPngScale > 4) {
      push("error", "Invalid PNG scale", "PNG scale must be between 1x and 4x.");
    }

    const pixelCount = exportWidth * exportHeight * Math.max(1, exportPngScale) * Math.max(1, exportPngScale);
    if ((target === "png" || target === "all") && pixelCount > 40_000_000) {
      push("warning", "Large PNG output", "Current size may fail on low-memory devices. Consider lowering size or PNG scale.");
    }

    if (target === "all") {
      const selectedCount = Number(exportAllFormats.svg) + Number(exportAllFormats.png) + Number(exportAllFormats.html);
      if (selectedCount === 0) {
        push("error", "No export format selected", "Select at least one format in Export All Options.");
      }
      if (selectedCount > 1 && exportAllNamingMode === "same") {
        push("error", "Conflicting file names", "Use suffix naming when exporting multiple formats.");
      }
    }

    const includesHtml = target === "html" || (target === "all" && exportAllFormats.html);
    if (includesHtml && exportTransparentBg) {
      push("warning", "Transparent HTML background", "HTML export may appear transparent depending on viewer background color.");
    }

    return issues;
  };

  const runExportSvg = () => {
    const issues = validateExportRequest("svg");
    setExportIssues(issues);
    if (issues.some((issue) => issue.level === "error")) return;
    exportSvg();
    setExportIssues((prev) => [
      ...prev,
      {
        id: `export-success-${crypto.randomUUID()}`,
        level: "success",
        title: "SVG exported",
      },
    ]);
  };

  const runExportHtml = () => {
    const issues = validateExportRequest("html");
    setExportIssues(issues);
    if (issues.some((issue) => issue.level === "error")) return;
    exportHtml();
    setExportIssues((prev) => [
      ...prev,
      {
        id: `export-success-${crypto.randomUUID()}`,
        level: "success",
        title: "HTML exported",
      },
    ]);
  };

  const runExportPng = async () => {
    const issues = validateExportRequest("png");
    setExportIssues(issues);
    if (issues.some((issue) => issue.level === "error")) return;
    try {
      await exportPng();
      setExportIssues((prev) => [
        ...prev,
        {
          id: `export-success-${crypto.randomUUID()}`,
          level: "success",
          title: "PNG exported",
        },
      ]);
    } catch (error) {
      setExportIssues((prev) => [
        ...prev,
        {
          id: `export-failed-${crypto.randomUUID()}`,
          level: "error",
          title: "PNG export failed",
          description: error instanceof Error ? error.message : "Failed to render PNG",
        },
      ]);
    }
  };

  const runExportAll = async () => {
    const issues = validateExportRequest("all");
    setExportIssues(issues);
    if (issues.some((issue) => issue.level === "error")) return;
    try {
      await exportAll();
      setExportIssues((prev) => [
        ...prev,
        {
          id: `export-success-${crypto.randomUUID()}`,
          level: "success",
          title: "Export All completed",
        },
      ]);
    } catch (error) {
      setExportIssues((prev) => [
        ...prev,
        {
          id: `export-failed-${crypto.randomUUID()}`,
          level: "error",
          title: "Export All failed",
          description: error instanceof Error ? error.message : "Unexpected export error",
        },
      ]);
    }
  };

  const exportSvg = (customBaseName?: string) => {
    if (!exportSvgString) return;
    const baseName = customBaseName ?? resolvedExportBaseName;
    downloadFile(`${baseName}.svg`, "image/svg+xml;charset=utf-8", exportSvgString);
  };

  const exportHtml = (customBaseName?: string) => {
    if (!svgElement) return;
    const serialized = exportSvgString;
    if (!serialized) return;
    const baseName = customBaseName ?? resolvedExportBaseName;
    const bodyStyle = exportTransparentBg
      ? "margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;"
      : `margin:0;background:${effectiveExportBackground};display:flex;justify-content:center;align-items:center;min-height:100vh;`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${currentDoc.title}</title></head><body style="${bodyStyle}">${serialized}</body></html>`;
    downloadFile(`${baseName}.html`, "text/html;charset=utf-8", html);
  };

  const exportPng = async (customBaseName?: string) => {
    const serialized = exportSvgString;
    if (!serialized) return;

    const baseName = customBaseName ?? resolvedExportBaseName;

    await new Promise<void>((resolve, reject) => {
      const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const image = new Image();

      image.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.max(1, Math.min(4, exportPngScale));
        canvas.width = Math.round(exportWidth * scale);
        canvas.height = Math.round(exportHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          URL.revokeObjectURL(url);
          resolve();
          return;
        }
        // Keep PNG export WYSIWYG: always flatten with the resolved background color.
        // Transparent PNG previews often look black in file explorers.
        context.fillStyle = effectiveExportBackground;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = canvas.toDataURL("image/png");
        const anchor = document.createElement("a");
        anchor.href = png;
        anchor.download = `${baseName}.png`;
        anchor.click();
        URL.revokeObjectURL(url);
        resolve();
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to render PNG"));
      };

      image.src = url;
    });
  };

  const exportAll = async () => {
    const jobs: Promise<void>[] = [];

    if (exportAllFormats.svg) {
      const baseName =
        exportAllNamingMode === "suffix" ? `${resolvedExportBaseName}-svg` : resolvedExportBaseName;
      exportSvg(baseName);
    }
    if (exportAllFormats.html) {
      const baseName =
        exportAllNamingMode === "suffix" ? `${resolvedExportBaseName}-html` : resolvedExportBaseName;
      exportHtml(baseName);
    }
    if (exportAllFormats.png) {
      const baseName =
        exportAllNamingMode === "suffix" ? `${resolvedExportBaseName}-png` : resolvedExportBaseName;
      jobs.push(exportPng(baseName));
    }

    if (jobs.length > 0) {
      await Promise.all(jobs);
    }
  };

  const applyRawInputToEditor = (text: string) => {
    const candidate = text.trim();
    if (!candidate) {
      pushCanvasActionIssue("error", "Import failed", "Input is empty.");
      return;
    }

    const isJsonCandidate = looksLikeJson(candidate);
    const isCsvCandidate = looksLikeCsv(candidate);
    const isDslCandidate = !isJsonCandidate && !isCsvCandidate && looksLikeDsl(candidate);

    const jsonResult = parseSankeyTextDetailed(candidate, "json");
    const csvResult = parseSankeyTextDetailed(candidate, "csv");

    let formatToApply: DataFormat | null = null;
    let parseResult = jsonResult;
    let detected = "DSL";

    if (isJsonCandidate && jsonResult.ok) {
      formatToApply = "json";
      parseResult = jsonResult;
      detected = "JSON";
    } else if (isCsvCandidate && csvResult.ok) {
      formatToApply = "csv";
      parseResult = csvResult;
      detected = "CSV";
    } else if (jsonResult.ok) {
      formatToApply = isDslCandidate ? "json" : "json";
      parseResult = jsonResult;
      detected = isDslCandidate ? "DSL" : "JSON";
    } else if (csvResult.ok) {
      formatToApply = "csv";
      parseResult = csvResult;
      detected = "CSV";
    } else {
      const issue = jsonResult.issue ?? csvResult.issue;
      pushCanvasActionIssue(
        "error",
        "Import failed",
        `${issue.message}${issue.line ? ` (Ln ${issue.line}, Col ${issue.column})` : ""}`,
      );
      return;
    }

    if (!formatToApply || !parseResult.ok) return;

    clearNodePositions();
    setFormat(formatToApply);
    setEditorText(candidate);
    pushCanvasActionIssue(
      "success",
      "Import successful",
      `Detected ${detected}: ${parseResult.graph.nodes.length} nodes, ${parseResult.graph.links.length} links.`,
    );
  };

  const importRawFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".json") && !lower.endsWith(".txt") && !lower.endsWith(".dsl")) {
      pushCanvasActionIssue("error", "Import failed", "Only .csv, .json, .txt, .dsl are supported in quick import.");
      return;
    }
    const text = await file.text();
    applyRawInputToEditor(text);
  };

  const onRawFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await importRawFile(file);
    } catch (error) {
      pushCanvasActionIssue("error", "Import failed", error instanceof Error ? error.message : "Failed to parse file");
    } finally {
      if (rawImportInputRef.current) rawImportInputRef.current.value = "";
    }
  };

  const onRawDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    try {
      await importRawFile(file);
    } catch (error) {
      pushCanvasActionIssue("error", "Import failed", error instanceof Error ? error.message : "Failed to parse dropped file");
    }
  };

  const openDocumentById = async (nextDocId: string) => {
    const hit = await loadDocumentById(nextDocId);
    if (!hit) return;
    initialize(hit);
    await setCurrentDocumentId(hit.id);
    setShowDocuments(false);
    router.replace(`/editor?doc=${encodeURIComponent(hit.id)}`);
  };

  const createNewDocument = async () => {
    const { defaultSankeyData } = await import("@/plugins/sankey");
    const newDoc: BaseDocument = {
      id: crypto.randomUUID(),
      title: "Untitled Diagram",
      diagramType: "sankey",
      folderId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: {
        ...defaultSankeyData,
        style: { ...defaultSankeyData.style, theme: appPreferences.defaultTheme }
      } as Record<string, unknown>
    };
    initialize(newDoc);
    await upsertDocument(newDoc);
    await setCurrentDocumentId(newDoc.id);
    setShowDocuments(false);
    router.replace(`/editor?doc=${encodeURIComponent(newDoc.id)}`);
  };

  const saveAsCopy = async () => {
    const copy: BaseDocument = {
      ...currentDoc,
      id: crypto.randomUUID(),
      title: `${currentDoc.title || "Untitled"} Copy`,
      diagramType: currentDoc.diagramType,
      folderId: currentDoc.folderId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: JSON.parse(JSON.stringify(currentDoc.data)),
    };
    initialize(copy);
    await upsertDocument(copy);
    await setCurrentDocumentId(copy.id);
    router.replace(`/editor?doc=${encodeURIComponent(copy.id)}`);
  };



  const deleteCurrentDocument = async () => {
    if (allDocuments.length <= 1) {
      await createNewDocument();
      return;
    }
    const confirmed = await confirm({
      title: "Delete current document?",
      message: "This action cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    await deleteDocumentById(currentDoc.id);
    const nextDocs = await loadAllDocuments();
    const nextDoc = nextDocs[0];
    if (!nextDoc) {
      await createNewDocument();
      return;
    }
    initialize(nextDoc);
    await setCurrentDocumentId(nextDoc.id);
    setShowDocuments(false);
    router.replace(`/editor?doc=${encodeURIComponent(nextDoc.id)}`);
  };


  const workspaceClass =
    "relative flex h-screen flex-col overflow-hidden bg-background text-foreground font-sans";
  const leftPanelClass =
    "absolute left-2 top-2 bottom-2 z-120 flex flex-col bg-surface sidebar-card transition-all duration-220 ease-out";
  const canvasContainerClass =
    "relative min-w-0 flex-1 bg-surface-light";

  // MD3 Menu text buttons — Google Docs style
  const controlButtonClass =
    "md3-state-layer inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-foreground/80 transition-colors";
  const controlButtonWideClass = controlButtonClass;

  const toolbarIconButtonClass =
    "md3-state-layer inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground/60 hover:text-foreground transition-all";

  const documentPopoverClass =
    "absolute left-4 top-[calc(var(--header-row1-height)+var(--header-row2-height)+4px)] z-40 w-96 rounded-xl border border-border bg-surface-container-high p-3 shadow-(--shadow-base) ring-1 ring-black/5";

  const rightPanelFieldCompactClass =
    "mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors";



  // MD3 Dropdown menus — rounded-lg, shadow-base, menu-open animation
  const headerMenuClass =
    "absolute left-0 top-full mt-1 z-140 min-w-[220px] origin-top-left rounded-lg border border-border bg-surface-container-high p-1.5 shadow-(--shadow-base) ring-1 ring-black/5 focus:outline-none animate-menu-open";
  const headerMenuRightClass =
    "absolute right-0 top-full mt-1 z-140 min-w-[220px] origin-top-right rounded-lg border border-border bg-surface-container-high p-1.5 shadow-(--shadow-base) ring-1 ring-black/5 focus:outline-none animate-menu-open";
  const headerMenuItemClass =
    "md3-state-layer flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground/80 transition-colors";
  const headerMenuItemActiveClass =
    "md3-state-layer flex w-full items-center gap-2.5 rounded-lg bg-primary/8 px-3 py-2 text-left text-sm font-semibold text-primary";

  // Floating toggle button for sidebar
  const floatingIconButtonClass =
    "pointer-events-auto md3-state-layer inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-container-high text-foreground shadow-(--shadow-sm) transition-all hover:shadow-(--shadow-base) active:scale-95";

  const themeToggleButtonClass =
    "md3-state-layer inline-flex h-9 w-9 items-center justify-2 rounded-full text-foreground/60 transition-all";

  // MD3 Tonal button for Export
  const exportButtonClass =
    "md3-state-layer inline-flex items-center gap-2 rounded-full bg-primary/10 px-5 py-2 text-sm font-medium text-primary transition-all hover:bg-primary/16 hover:shadow-(--shadow-sm) active:scale-[0.97]";


  const libraryEmptyStateClass = "rounded-xl border border-dashed border-border bg-[color-mix(in_srgb,var(--surface-container)_60%,transparent)] px-4 py-8 text-center text-sm text-muted";
  const isNarrowViewport = viewportWidth < 1200;
  const leftWorkbenchWidth = 360;


  const toggleLeftWorkbench = () => {
    setLeftWorkbenchMode((current) => {
      const next = current === "collapsed" ? "compact" : "collapsed";
      setActiveWorkspaceOverlay(next === "collapsed" ? "none" : "left");
      return next;
    });
  };
  const toggleLeftWorkbenchSize = () => {
    setLeftWorkbenchMode((current) => {
      if (current === "collapsed") {
        setActiveWorkspaceOverlay("left");
        return "compact";
      }
      return current === "compact" ? "expanded" : "compact";
    });
  };
  const closeWorkspaceOverlays = () => {
    setLeftWorkbenchMode("collapsed");
    setActiveWorkspaceOverlay("none");
    setShowWorkspaceQuickMenu(false);
  };

  // Get the plugin for the current diagram type
  const plugin = useMemo(() => {
    return getDiagramPlugin(currentDoc.diagramType);
  }, [currentDoc.diagramType]);

  // Generic data change handler for the plugin
  const onPluginDataChange = useCallback(
    (newData: Record<string, unknown>) => {
      // Update store state
      initialize({
        ...currentDoc,
        data: newData,
        updatedAt: Date.now(),
      });

      // Persist to storage
      void upsertDocument({
        ...currentDoc,
        data: newData,
        updatedAt: Date.now(),
      });
    },
    [currentDoc, initialize],
  );

  // Prepare interaction state for the plugin
  const interactionState = useMemo(() => ({
    width: 0,
    height: 0,
    interactionMode: "select",
    isSpacePanning,
    selectedNodeIds: selectedNodeIds || [],
    selectedLinkIndex: selectedLinkIndex || null,
    traceMode: traceMode || "none",
    pulseLinkIndex: pulseLinkIndex || null,
    pulseNodeId: pulseNodeId || null,
    renderHints,
    onSelectionChange: setSelectedNodeIds,
    onLinkSelectionChange: setSelectedLinkIndex,
    onLinkEditRequest: openLinkEditor,
    onNodeEditRequest: openNodeEditor,
    onZoomChange: setZoomLevel,
  }), [
    isSpacePanning,
    selectedNodeIds,
    selectedLinkIndex,
    traceMode,
    pulseLinkIndex,
    pulseNodeId,
    renderHints,
    openLinkEditor,
    openNodeEditor,
    setZoomLevel,
    setSelectedNodeIds,
    setSelectedLinkIndex
  ]);

  if (!hasHydrated) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading editor...</div>;
  }

  return (
    <div className={workspaceClass}>
      {/* ===== Two-Row Header (Google Docs style) ===== */}
      <header className="relative z-90 flex flex-col bg-background border-b border-border">
        {/* Row 1: Logo + Title + Actions */}
        <div className="flex h-(--header-row1-height) items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="md3-state-layer inline-flex h-10 w-10 items-center justify-center rounded-full text-primary transition-colors"
              title="Back to Home"
              aria-label="Back to Home"
            >
              <LayoutTemplate className="h-6 w-6" />
            </button>

            <input
              value={currentDoc.title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-72 rounded-lg px-2.5 py-1.5 text-lg font-normal text-foreground placeholder:text-muted outline-none border border-transparent hover:border-border focus:border-primary focus:ring-2 focus:ring-primary/20 focus:bg-background transition-all"
              placeholder="Untitled Document"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => {
                  setShowExportMenu((value) => !value);
                  setShowFileMenu(false);
                  setShowDisplayMenu(false);
                  setShowAutoLayoutMenu(false);
                }}
                className={exportButtonClass}
                title="Export options"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
              {showExportMenu && (
                <div className={`${headerMenuRightClass} max-h-[70vh] min-w-[280px] overflow-y-auto`}>
                  <button onClick={() => { runExportSvg(); setShowExportMenu(false); }} className={headerMenuItemClass}>Export SVG</button>
                  <button onClick={() => { void runExportPng(); setShowExportMenu(false); }} className={headerMenuItemClass}>Export PNG</button>
                  <button onClick={() => { runExportHtml(); setShowExportMenu(false); }} className={headerMenuItemClass}>Export HTML</button>
                  <button onClick={() => { void runExportAll(); setShowExportMenu(false); }} className={`mt-1 ${headerMenuItemActiveClass}`}>Export All</button>
                  <div className="mt-2 border-t border-border p-2.5 text-xs text-foreground/80 space-y-2">
                    <label className="block">Width<input type="number" value={exportWidth} onChange={(event) => setExportWidth(Number(event.target.value) || 1200)} className={rightPanelFieldCompactClass} /></label>
                    <label className="block">Height<input type="number" value={exportHeight} onChange={(event) => setExportHeight(Number(event.target.value) || 700)} className={rightPanelFieldCompactClass} /></label>
                    <label className="block">Padding<input type="number" value={exportPadding} onChange={(event) => setExportPadding(Math.max(0, Number(event.target.value) || 0))} className={rightPanelFieldCompactClass} /></label>
                    <label className="block">PNG Scale<input type="number" min={1} max={4} value={exportPngScale} onChange={(event) => setExportPngScale(Number(event.target.value))} className={rightPanelFieldCompactClass} /></label>
                    <label className="block">File Template<input value={exportFileTemplate} onChange={(event) => setExportFileTemplate(event.target.value)} className={rightPanelFieldCompactClass} /></label>
                    <label className="mt-2 inline-flex items-center gap-2"><input type="checkbox" checked={exportTransparentBg} onChange={(event) => setExportTransparentBg(event.target.checked)} className="rounded" />Transparent</label>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                const nextTheme = sankeyData.style.theme === "dark" ? "light" : "dark";
                const currentDefault =
                  sankeyData.style.theme === "dark" ? DARK_LABEL_COLOR : LIGHT_LABEL_COLOR;
                const nextDefault = nextTheme === "dark" ? DARK_LABEL_COLOR : LIGHT_LABEL_COLOR;
                const nextLabelColor =
                  sankeyData.style.labelColor === currentDefault ? nextDefault : sankeyData.style.labelColor;
                patchStyle({ theme: nextTheme, labelColor: nextLabelColor });
              }}
              className={themeToggleButtonClass}
              title={sankeyData.style.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label={sankeyData.style.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {sankeyData.style.theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {/* Row 2: Text Menus */}
        <div className="flex h-(--header-row2-height) items-center gap-0.5 px-14">
          <div className="relative" ref={fileMenuRef}>
            <button
              onClick={() => {
                setShowFileMenu((value) => !value);
                setShowDisplayMenu(false);
                setShowAutoLayoutMenu(false);
                setShowExportMenu(false);
              }}
              className={`${controlButtonClass} ${showFileMenu ? "bg-black/8 dark:bg-white/12" : ""}`}
            >
              File
            </button>
            {showFileMenu && (
              <div className={headerMenuClass}>
                <button onClick={() => { router.push("/"); setShowFileMenu(false); }} className={headerMenuItemClass}>Home</button>
                <button onClick={() => { setShowDocuments((value) => !value); setShowFileMenu(false); }} className={headerMenuItemClass}>Docs</button>
                <button onClick={() => { createNewDocument(); setShowFileMenu(false); }} className={headerMenuItemClass}>New Document</button>
                <button onClick={() => { saveAsCopy(); setShowFileMenu(false); }} className={headerMenuItemClass}>
                  <CopyPlus className="h-4 w-4" />Save As
                </button>
                <div className="my-1 border-t border-border" />
                <button onClick={() => { void deleteCurrentDocument(); setShowFileMenu(false); }} className={`${headerMenuItemClass} text-red-600 dark:text-red-400`}>
                  <Trash2 className="h-4 w-4" />Delete Current
                </button>
              </div>
            )}
          </div>

          <div className="relative" ref={displayMenuRef}>
            <button
              onClick={() => {
                setShowDisplayMenu((value) => !value);
                setShowFileMenu(false);
                setShowAutoLayoutMenu(false);
                setShowExportMenu(false);
              }}
              className={`${controlButtonClass} ${showDisplayMenu ? "bg-black/8 dark:bg-white/12" : ""}`}
              title="Display Settings"
            >
              Display
            </button>
            {showDisplayMenu && (
              <div className={`${headerMenuClass} w-[280px]`}>
                <div className="mb-2 flex gap-0.5 p-1 bg-surface-container rounded-lg">
                  <button
                    onClick={() => setDisplayMenuTab("view")}
                    className={`flex-1 rounded-md py-1.5 text-xs font-medium capitalize transition-all ${displayMenuTab === "view"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                      }`}
                  >
                    View
                  </button>
                  {plugin?.StylePanel && (
                    <button
                      onClick={() => setDisplayMenuTab("style")}
                      className={`flex-1 rounded-md py-1.5 text-xs font-medium capitalize transition-all ${displayMenuTab === "style" // mapped "labels"/"layout" to "style" for now
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted hover:text-foreground"
                        }`}
                    >
                      Design
                    </button>
                  )}
                </div>

                {displayMenuTab === "view" && (
                  <div className="space-y-0.5">
                    <button onClick={() => { undo(); }} disabled={historyPast.length === 0} className={headerMenuItemClass}><Undo2 className="h-4 w-4" />Undo</button>
                    <button onClick={() => { redo(); }} disabled={historyFuture.length === 0} className={headerMenuItemClass}><Redo2 className="h-4 w-4" />Redo</button>
                    <button onClick={() => { syncFromEditor(); }} className={headerMenuItemClass}><Play className="h-4 w-4" />Sync</button>
                    <button onClick={() => { setCanvasResetKey((value) => value + 1); }} className={headerMenuItemClass}>Fit Canvas</button>
                    <div className="mt-2 border-t border-border pt-2 px-2">
                      <p className="mb-2 text-xs font-medium text-muted">Trace Mode</p>
                      <div className="grid grid-cols-3 gap-1">
                        <button onClick={() => setTraceMode("none")} className={`rounded-lg px-2 py-1 text-xs font-medium transition ${traceMode === "none" ? "bg-primary text-white" : "bg-surface-container text-foreground/70 hover:bg-surface-container-high"}`}>None</button>
                        <button onClick={() => setTraceMode("upstream")} className={`rounded-lg px-2 py-1 text-xs font-medium transition ${traceMode === "upstream" ? "bg-primary text-white" : "bg-surface-container text-foreground/70 hover:bg-surface-container-high"}`}>Up</button>
                        <button onClick={() => setTraceMode("downstream")} className={`rounded-lg px-2 py-1 text-xs font-medium transition ${traceMode === "downstream" ? "bg-primary text-white" : "bg-surface-container text-foreground/70 hover:bg-surface-container-high"}`}>Down</button>
                      </div>
                      <button onClick={clearSelectionWithNotice} className="mt-2 w-full text-left text-xs text-muted hover:text-foreground transition-colors">Clear Selection</button>
                    </div>
                  </div>
                )}

                {displayMenuTab === "style" && plugin?.StylePanel && (
                  <plugin.StylePanel
                    data={currentDoc.data}
                    onDataChange={onPluginDataChange}
                  />
                )}
              </div>
            )}
          </div>

          <div className="relative" ref={autoLayoutMenuRef}>
            <button
              onClick={() => {
                setShowAutoLayoutMenu((value) => !value);
                setShowFileMenu(false);
                setShowDisplayMenu(false);
                setShowExportMenu(false);
              }}
              className={`${controlButtonWideClass} ${showAutoLayoutMenu ? "bg-black/8 dark:bg-white/12" : ""}`}
              title="Auto-layout options"
            >
              Auto-layout
            </button>
            {showAutoLayoutMenu && (
              <div className={headerMenuClass}>
                {AUTO_LAYOUT_STRATEGY_OPTIONS.map((item) => (
                  <button
                    key={`layout-menu-${item.id}`}
                    onClick={() => {
                      setAutoLayoutStrategy(item.id);
                      applyAutoLayoutStrategy(item.id);
                      setShowAutoLayoutMenu(false);
                    }}
                    className={`md3-state-layer flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${autoLayoutStrategy === item.id
                      ? "bg-primary/8 text-primary font-semibold"
                      : "text-foreground/80"
                      }`}
                  >
                    <span>{item.label}</span>
                    {autoLayoutStrategy === item.id && <span className="text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">Current</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {showDocuments && (
        <div className={documentPopoverClass}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase text-muted">All Documents</span>
          </div>
          <input
            value={librarySearch}
            onChange={(event) => setLibrarySearch(event.target.value)}
            placeholder={"Search documents"}
            className="mb-2 w-full rounded-md border border-border bg-[color-mix(in_srgb,var(--bg-elevated)_95%,transparent)] px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
          />

          <div className="max-h-72 space-y-1 overflow-auto pr-1">
            {filteredDocuments.length === 0 ? (
              <p className={`${libraryEmptyStateClass} type-caption`}>
                No documents found.
              </p>
            ) : (
              filteredDocuments.map((doc) => {
                const docData = doc.data as unknown as SankeyData;
                return (
                  <button
                    key={doc.id}
                    onClick={() => openDocumentById(doc.id)}
                    className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition ${doc.id === currentDoc.id
                      ? "border-indigo-400/45 bg-indigo-500/18 text-indigo-100"
                      : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:bg-slate-800"
                      }`}
                  >
                    <p className="font-medium">{doc.title || "Untitled Diagram"}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {docData.format?.toUpperCase()} | {new Date(doc.updatedAt).toLocaleString()}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {activeWorkspaceOverlay !== "none" && (
          <button
            type="button"
            aria-label="Close workspace overlays"
            onClick={closeWorkspaceOverlays}
            className="absolute inset-0 z-110 bg-[color-mix(in_srgb,var(--bg-overlay)_38%,transparent)] backdrop-blur-[1px]"
          />
        )}

        {isNarrowViewport ? (
          <div className="pointer-events-none absolute right-2 top-3 z-121" ref={workspaceQuickMenuRef}>
            <button
              type="button"
              onClick={() => setShowWorkspaceQuickMenu((value) => !value)}
              className={floatingIconButtonClass}
              title="Workspace controls"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            {showWorkspaceQuickMenu && (
              <div className={`pointer-events-auto min-w-[170px] ${headerMenuClass}`}>
                <button
                  type="button"
                  onClick={() => {
                    toggleLeftWorkbench();
                    setShowWorkspaceQuickMenu(false);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-(--text-secondary) hover:bg-bg-tertiary"
                >
                  <span>{leftWorkbenchVisible ? "Hide Workbench" : "Show Workbench"}</span>
                  <span>Shift+Tab</span>
                </button>
                {leftWorkbenchVisible && (
                  <button
                    type="button"
                    onClick={() => {
                      toggleLeftWorkbenchSize();
                      setShowWorkspaceQuickMenu(false);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-(--text-secondary) hover:bg-bg-tertiary"
                  >
                    <span>{leftWorkbenchMode === "expanded" ? "Compact Width" : "Expand Width"}</span>
                    <span>Left</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="pointer-events-none absolute left-0 top-1/2 z-121 flex -translate-y-1/2 flex-col gap-2 pl-2">
              <button
                type="button"
                onClick={toggleLeftWorkbench}
                className={`${floatingIconButtonClass} ${!leftWorkbenchVisible ? "animate-pulse-subtle border-primary text-primary" : ""}`}
                title={leftWorkbenchVisible ? "Collapse workbench (Shift+Tab)" : "Open workbench (Shift+Tab)"}
              >
                {leftWorkbenchVisible ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
              </button>

            </div>

          </>
        )}

        <aside
          className={`${leftPanelClass} ${leftWorkbenchVisible ? "translate-x-0 animate-sidebar-in" : "-translate-x-[calc(100%+16px)]"}`}
          style={{ width: leftWorkbenchWidth }}
        >
          {plugin?.editorMode === "visual" ? (
            plugin.ToolPanel ? (
              <plugin.ToolPanel data={currentDoc.data} onDataChange={onPluginDataChange} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-4 text-center text-sm text-muted">
                <p>Visual editing mode active</p>
              </div>
            )
          ) : (
            <>
              {/* Sidebar Header — Format selector + actions */}
              <div className="flex flex-col gap-2 border-b border-border px-3 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Source</span>
                  <div className="flex items-center gap-0.5">
                    <input
                      ref={rawImportInputRef}
                      className="hidden"
                      type="file"
                      accept=".csv,.json,.txt,.dsl"
                      onChange={onRawFileUpload}
                    />
                    <button
                      onClick={() => rawImportInputRef.current?.click()}
                      className={toolbarIconButtonClass}
                      title="Import File"
                    >
                      <FileUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        const content = sankeyData.editorText;
                        const mime = sankeyData.format === "json" ? "application/json" : "text/plain";
                        const ext = sankeyData.format === "json" ? "json" : sankeyData.format === "csv" ? "csv" : "dsl";
                        downloadFile(`sankey-data.${ext}`, mime, content);
                      }}
                      className={toolbarIconButtonClass}
                      title="Download Source"
                    >
                      <FileDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {/* MD3 Segmented Button — Format Selector */}
                <div className="flex rounded-full border border-border p-0.5 bg-surface-container">
                  {([
                    { id: "sankey", label: "DSL" },
                    { id: "json", label: "JSON" },
                    { id: "csv", label: "CSV" },
                  ] as const).map((fmt) => (
                    <button
                      key={fmt.id}
                      onClick={() => {
                        const newDoc = {
                          ...currentDoc,
                          data: { ...sankeyData, format: fmt.id as DataFormat } as unknown as Record<string, unknown>
                        };
                        void upsertDocument(newDoc).then(() => {
                          setCurrentDocumentId(newDoc.id);
                        });
                      }}
                      className={`md3-segmented-btn flex-1 ${sankeyData.format === fmt.id ? "active" : ""}`}
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editor Area */}
              <div
                className="relative flex-1 min-h-0 bg-surface"
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={onRawDrop}
              >
                {isDragOver && (
                  <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-[1px] border-2 border-dashed border-primary m-2 rounded-xl">
                    <div className="pointer-events-none rounded-xl bg-surface-container-high px-4 py-2 font-medium text-primary shadow-lg">
                      Drop file to import
                    </div>
                  </div>
                )}

                <SankeyMonacoEditor
                  value={sankeyData.editorText}
                  format={sankeyData.format}
                  theme={sankeyData.style.theme}
                  onChange={setEditorText}
                  marker={parseIssue}
                />
              </div>

              {/* Footer / Status Bar */}
              <div className="border-t border-border">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <label className="md3-state-layer flex cursor-pointer items-center gap-2.5 rounded-full px-2 py-1 text-xs text-muted hover:text-foreground transition-colors">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={autoSync}
                        onChange={(event) => setAutoSync(event.target.checked)}
                        className="peer sr-only"
                      />
                      <div className={`h-5 w-9 rounded-full transition-colors ${autoSync ? "bg-primary" : "bg-border"}`} />
                      <div className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${autoSync ? "translate-x-4" : ""}`} />
                    </div>
                    Auto-sync
                  </label>
                  <div className="flex items-center gap-2 text-[11px] font-medium text-muted">
                    <span>{Math.round(zoomLevel * 100)}%</span>
                  </div>
                </div>
                {(editorIssues.length > 0) && (
                  <div className="border-t border-border">
                    <IssueCenter issues={editorIssues} className="px-3 py-2.5" />
                  </div>
                )}
              </div>
            </>
          )}
        </aside>

        <main className={canvasContainerClass}>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: performanceProfile.shouldReduceMotion ? 0.03 : 0.35 }}
            className="h-full"
          >
            {plugin && plugin.Canvas ? (
              <plugin.Canvas
                key={canvasResetKey}
                data={currentDoc.data}
                width={CANVAS_BASE_WIDTH}
                height={CANVAS_BASE_HEIGHT}
                onDataChange={onPluginDataChange}
                interactionState={interactionState}
                onSvgReady={setSvgElement}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted">
                {plugin ? "Initializing Canvas..." : "Unknown diagram type"}
              </div>
            )}
          </motion.div>
        </main>

        {activeEditorModal && activeEditorModal.type === "link" && linkEditDraft && (
          <FlowEditModal
            mode="link"
            draft={linkEditDraft}
            anchor={editorModalAnchor}
            related={{
              sameSourceCount: graph.links.filter(
                (link, index) =>
                  index !== activeEditorModal.index && link.source === linkEditDraft.source,
              ).length,
              sameTargetCount: graph.links.filter(
                (link, index) =>
                  index !== activeEditorModal.index && link.target === linkEditDraft.target,
              ).length,
            }}
            onJumpSameSource={() => jumpToRelatedLink("source")}
            onJumpSameTarget={() => jumpToRelatedLink("target")}
            nodeOptions={nodeIdOptions}
            error={editorModalError ?? linkDraftValidationError}
            canSave={!linkDraftValidationError}
            onDraftChange={(draft) => {
              setEditorModalError(null);
              setLinkEditDraft(draft);
            }}
            onSave={saveLinkEdit}
            onDelete={deleteLinkEdit}
            onClose={closeEditorModal}
          />
        )}

        {activeEditorModal && activeEditorModal.type === "node" && nodeEditDraft && (
          <FlowEditModal
            mode="node"
            draft={nodeEditDraft}
            anchor={editorModalAnchor}
            nodeOptions={nodeIdOptions}
            stats={nodeStatsById.get(nodeEditDraft.id)}
            error={editorModalError ?? nodeDraftValidationError}
            canSave={!nodeDraftValidationError}
            onDraftChange={(draft) => {
              setEditorModalError(null);
              setNodeEditDraft(draft);
            }}
            onSave={saveNodeEdit}
            onClose={closeEditorModal}
          />
        )}


        {dialogNode}

      </div>
    </div>
  );
}





















































































