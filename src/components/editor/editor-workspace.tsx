"use client";

import "@/plugins/register-all";
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  LayoutTemplate,
  Moon,
  Play,
  Redo2,
  Sun,
  Undo2,
  Share2,
  GalleryVerticalEnd
} from "lucide-react";
import {
  SankeyMonacoEditor,
} from "@/components/editor/monaco-editor";
import {
  EditableLink,
  EditableNode,
} from "@/plugins/sankey/sankey-types";
import {
  serializeLinksByFormat,
} from "@/plugins/sankey/sankey-serialize";
import {
  parseSankeyText as parseSankeyFlow,
} from "@/plugins/sankey/sankey-parse";

import { getDiagramPlugin } from "@/lib/diagram-registry";
import {
  BaseDocument,
  DataFormat,
  AppPreferences,
} from "@/lib/types";
import { AppIssue } from "@/lib/issues";
import {
  loadAppPreferences,
  loadDocumentById as loadDocument,
  saveAppPreferences,
  upsertDocument,
  deleteDocumentById as removeDocument,
  loadOpenDocumentIds,
  saveOpenDocumentIds,
  loadAllDocuments
} from "@/lib/storage";
import { isMac } from "@/lib/os-utils";
import { useEditorStore } from "@/store/editor-store";
import { EditorTabs } from "@/components/editor/editor-tabs";
import {
  FlowEditModal,
} from "@/components/editor/flow-edit-modal";
import { IssueCenter } from "@/components/common/issue-center";
import { useAppDialog } from "@/components/common/app-dialog";

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function downloadFile(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function dedupeDocumentsById(documents: BaseDocument[]): BaseDocument[] {
  const map = new Map<string, BaseDocument>();
  for (const doc of documents) {
    map.set(doc.id, doc);
  }
  return Array.from(map.values());
}

type Props = {
  docId?: string;
};

const EXPORT_SETTINGS_STORAGE_KEY = "streaming-export-settings-v1";
const LEFT_WORKBENCH_MODE_STORAGE_KEY = "streaming-editor-left-workbench-mode-v1";
const CANVAS_BASE_WIDTH = 1200;
const CANVAS_BASE_HEIGHT = 700;
const EDITOR_HEADER_HEIGHT = 72;
const EDITOR_LEFT_COMPACT_WIDTH = 320;
const EDITOR_LEFT_EXPANDED_WIDTH = 384;
const EDITOR_RIGHT_PANEL_WIDTH = 352;
const EDITOR_BOTTOM_SAFE_AREA = 88;

type LeftWorkbenchMode = "collapsed" | "compact" | "expanded";
type ActiveEditorModal =
  | { type: "link"; index: number }
  | { type: "node"; id: string };
type ExportSettings = {
  width?: number;
  height?: number;
  scale?: number;
  padding?: number;
};
type NodeStats = {
  incomingCount: number;
  outgoingCount: number;
  incomingValue: number;
  outgoingValue: number;
};
type EditorRenderHints = {
  showLabels: boolean;
  enableLinkHover: boolean;
  dragThrottleMs: number;
  simplifyLinkCurves: boolean;
  lowDetailDuringDrag: boolean;
};

const DEFAULT_APP_PREFERENCES: AppPreferences = {
  defaultTheme: "light",
  defaultPerformanceMode: "auto",
  defaultExportTransparentBg: false,
  defaultExportFileTemplate: "{title}-{date}",
};

function loadExportSettingsFromStorage(): ExportSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(EXPORT_SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function defaultLeftWorkbenchModeByWidth(width: number): LeftWorkbenchMode {
  if (width < 768) return "collapsed";
  if (width < 1280) return "compact";
  return "expanded";
}

function loadLeftWorkbenchModeFromStorage(): LeftWorkbenchMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEFT_WORKBENCH_MODE_STORAGE_KEY);
    return raw === "collapsed" || raw === "compact" || raw === "expanded"
      ? (raw as LeftWorkbenchMode)
      : null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Component: EditorWorkspace
// -----------------------------------------------------------------------------

export function EditorWorkspace({ docId }: Props) {
  const router = useRouter();

  // Store usage for active document state only
  const {
    initialize: storeInitialize,
    setTitle: storeSetTitle,
  } = useEditorStore();

  const importConfigJsonInputRef = useRef<HTMLInputElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const fileMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const displayMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const displayPanelRef = useRef<HTMLDivElement>(null);
  const displayPanelCloseRef = useRef<HTMLButtonElement>(null);
  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // App & Document State
  const [hasHydrated, setHasHydrated] = useState(false);

  // Local tab management
  const [openDocuments, setOpenDocuments] = useState<BaseDocument[]>([]);

  const [currentDoc, initialize] = useState<BaseDocument>({
    id: "",
    title: "",
    diagramType: "sankey", // default
    folderId: null,
    createdAt: 0,
    updatedAt: 0,
    data: {},
  });

  // Derived state
  const docData = (currentDoc.data as Record<string, unknown>) || {};
  const docEditorText = (docData.editorText as string) || "";
  const docFormat = (docData.format as DataFormat) || "json";

  // Editor UI State
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [editorIssues, setEditorIssues] = useState<AppIssue[]>([]);
  const [editorText, setEditorTextState] = useState(docEditorText);
  const [svgElement, setSvgElement] = useState<SVGSVGElement | null>(null);

  // Layout & Workbench State
  const [leftWorkbenchMode, setLeftWorkbenchMode] = useState<LeftWorkbenchMode>("compact");

  // Menus
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [appTheme, setAppTheme] = useState<"light" | "dark">("dark");
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );

  // Canvas Interactions
  const [, setZoomLevel] = useState(1);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedLinkIndex, setSelectedLinkIndex] = useState<number | null>(null);
  const [pulseLinkIndex, setPulseLinkIndex] = useState<number | null>(null);
  const [pulseNodeId, setPulseNodeId] = useState<string | null>(null);
  const renderHints = useMemo<EditorRenderHints>(() => ({
    showLabels: true,
    enableLinkHover: true,
    dragThrottleMs: 0,
    simplifyLinkCurves: false,
    lowDetailDuringDrag: false,
  }), []);
  const [activeEditorModal, setActiveEditorModal] = useState<ActiveEditorModal | null>(null);
  const [editorModalAnchor, setEditorModalAnchor] = useState<{ x: number; y: number } | null>(null);

  // Drafts for modal editing
  const [linkEditDraft, setLinkEditDraft] = useState<EditableLink | null>(null);
  const [nodeEditDraft, setNodeEditDraft] = useState<EditableNode | null>(null);
  const [editorModalError, setEditorModalError] = useState<string | null>(null);

  // Misc
  const autoSync = true;
  const [canvasResetKey, setCanvasResetKey] = useState(0);

  // History - managed locally to match the store integration
  const [historyPast, setHistoryPast] = useState<BaseDocument[]>([]);
  const [historyFuture, setHistoryFuture] = useState<BaseDocument[]>([]);

  // Export Settings
  const [exportWidth, setExportWidth] = useState(1920);
  const [exportHeight, setExportHeight] = useState(1080);
  const [exportPngScale, setExportPngScale] = useState(2);
  const [, setExportPadding] = useState(40);
  const [exportTransparentBg, setExportTransparentBg] = useState(false);

  // Dialogs
  const { dialogNode, confirm } = useAppDialog();
  const plugin = useMemo(() => {
    return getDiagramPlugin(currentDoc.diagramType);
  }, [currentDoc.diagramType]);

  const hasOpenTabs = openDocuments.length > 0;
  const leftWorkbenchVisible = leftWorkbenchMode !== "collapsed";
  const isNarrowLayout = viewportWidth < 1280;
  const leftWorkbenchDesktopWidth = leftWorkbenchMode === "expanded"
    ? EDITOR_LEFT_EXPANDED_WIDTH
    : leftWorkbenchMode === "compact"
      ? EDITOR_LEFT_COMPACT_WIDTH
      : 0;
  const rightWorkbenchVisible = Boolean(plugin?.StylePanel && showDisplayMenu);
  const rightWorkbenchDesktopWidth = rightWorkbenchVisible ? EDITOR_RIGHT_PANEL_WIDTH : 0;
  const leftColumnWidth = isNarrowLayout ? 0 : leftWorkbenchDesktopWidth;
  const rightColumnWidth = isNarrowLayout ? 0 : rightWorkbenchDesktopWidth;
  const canUndo = historyPast.length > 0;
  const canRedo = historyFuture.length > 0;
  const undoShortcutHint = isMac() ? "Cmd+Z" : "Ctrl+Z";
  const redoShortcutHint = isMac() ? "Cmd+Shift+Z" : "Ctrl+Shift+Z";
  const canExportPng = Boolean(svgElement);
  const workspaceShellStyle = useMemo(() => ({
    "--editor-header-height": `${EDITOR_HEADER_HEIGHT}px`,
    "--editor-left-width": `${leftColumnWidth}px`,
    "--editor-right-width": `${rightColumnWidth}px`,
    "--editor-bottom-safe-area": `${EDITOR_BOTTOM_SAFE_AREA}px`,
  }) as CSSProperties, [leftColumnWidth, rightColumnWidth]);

  // ---------------------------------------------------------------------------
  // Tab Management Helpers
  // ---------------------------------------------------------------------------

  const syncOpenDocsToStorage = (docs: BaseDocument[]) => {
    saveOpenDocumentIds(dedupeDocumentsById(docs).map(d => d.id));
  };

  const addOpenDocument = (doc: BaseDocument) => {
    setOpenDocuments(prev => {
      if (prev.some(d => d.id === doc.id)) return prev;
      const next = [...prev, doc];
      syncOpenDocsToStorage(next);
      return next;
    });
  };

  const closeDocument = (id: string, skipStorageSync = false) => {
    setOpenDocuments(prev => {
      const next = prev.filter(d => d.id !== id);
      if (!skipStorageSync) syncOpenDocsToStorage(next);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Parsing & Validation
  // ---------------------------------------------------------------------------
  const parseResult = useMemo(() => {
    if (!docEditorText) return { nodes: [], links: [] };
    try {
      const graph = parseSankeyFlow(docEditorText, docFormat);
      return graph;
    } catch {
      return { nodes: [], links: [] };
    }
  }, [docEditorText, docFormat]);

  const graph = useMemo(() => ({ nodes: parseResult.nodes, links: parseResult.links }), [parseResult.links, parseResult.nodes]);

  const nodeStatsById = useMemo(() => {
    const map = new Map<string, NodeStats>();
    for (const n of graph.nodes) {
      map.set(n.id, { incomingCount: 0, outgoingCount: 0, incomingValue: 0, outgoingValue: 0 });
    }
    for (const link of graph.links) {
      const src = map.get(link.source);
      const tgt = map.get(link.target);
      if (src) {
        src.outgoingCount++;
        src.outgoingValue += link.value;
      }
      if (tgt) {
        tgt.incomingCount++;
        tgt.incomingValue += link.value;
      }
    }
    return map;
  }, [graph]);

  const linkDraftValidationError = useMemo(() => {
    if (!linkEditDraft) return null;
    if (!linkEditDraft.source.trim()) return "Source node cannot be empty";
    if (!linkEditDraft.target.trim()) return "Target node cannot be empty";
    if (linkEditDraft.source.trim() === linkEditDraft.target.trim()) return "Source and target cannot be the same";
    const val = Number(linkEditDraft.value);
    if (isNaN(val) || val <= 0) return "Value must be a positive number";
    return null;
  }, [linkEditDraft]);

  const nodeDraftValidationError = useMemo(() => {
    if (!nodeEditDraft) return null;
    if (!nodeEditDraft.id.trim()) return "Node ID cannot be empty";
    if (nodeEditDraft.id !== nodeEditDraft.originalId && graph.nodes.some((n) => n.id === nodeEditDraft.id)) {
      return "Node ID already exists";
    }
    return null;
  }, [graph.nodes, nodeEditDraft]);

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => setHasHydrated(true));

    loadAppPreferences().then((prefs) => {
      const merged = { ...DEFAULT_APP_PREFERENCES, ...prefs };
      document.documentElement.setAttribute("data-theme", merged.defaultTheme);
      setAppTheme(merged.defaultTheme);
      setExportTransparentBg(merged.defaultExportTransparentBg ?? false);
    });

    Promise.resolve().then(() => {
      const savedExport = loadExportSettingsFromStorage();
      if (savedExport?.width) setExportWidth(savedExport.width);
      if (savedExport?.height) setExportHeight(savedExport.height);
      if (savedExport?.scale) setExportPngScale(savedExport.scale);
      if (savedExport?.padding) setExportPadding(savedExport.padding);

      const savedLayout = loadLeftWorkbenchModeFromStorage();
      if (savedLayout) {
        setLeftWorkbenchMode(savedLayout);
      } else {
        setLeftWorkbenchMode(defaultLeftWorkbenchModeByWidth(window.innerWidth));
      }
    });

    // Load tabs and current doc
    const bootstrap = async () => {
      // Load open tabs
      const openIds = await loadOpenDocumentIds();
      const allDocs = await loadAllDocuments();
      const opened = allDocs.filter(d => openIds.includes(d.id));
      setOpenDocuments(dedupeDocumentsById(opened));

      // Load active doc
      if (!docId) return;
      try {
        const loaded = await loadDocument(docId);
        if (loaded) {
          initialize(loaded);
          storeInitialize(loaded); // Sync store
          setEditorTextState((loaded.data.editorText as string) || "");

          // Add to tabs if not present
          if (!openIds.includes(loaded.id)) {
            setOpenDocuments(prev => {
              if (prev.some((d) => d.id === loaded.id)) return prev;
              const next = [...prev, loaded];
              syncOpenDocsToStorage(next);
              return next;
            });
          }
        } else {
          router.replace("/editor");
        }
      } catch (err) {
        console.error("Failed to load doc", err);
      }
    };

    void bootstrap();
    return () => window.cancelAnimationFrame(rafId);
  }, [docId, router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onResizeWindow = () => {
      const w = window.innerWidth;
      setViewportWidth(w);
      if (w < 768 && leftWorkbenchMode !== "collapsed") {
        setLeftWorkbenchMode("collapsed");
      }
      if (w < 1280 && showDisplayMenu && leftWorkbenchMode !== "collapsed") {
        setLeftWorkbenchMode("collapsed");
      }
    };
    window.addEventListener("resize", onResizeWindow);
    onResizeWindow();
    return () => window.removeEventListener("resize", onResizeWindow);
  }, [leftWorkbenchMode, showDisplayMenu]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LEFT_WORKBENCH_MODE_STORAGE_KEY, leftWorkbenchMode);
    } catch {
      // Ignore storage write failures; layout still works in-memory.
    }
  }, [leftWorkbenchMode]);

  useEffect(() => {
    if (!showFileMenu) return;

    const onMouseDownWindow = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && fileMenuRef.current && !fileMenuRef.current.contains(target)) {
        setShowFileMenu(false);
      }
    };

    const onKeyDownWindow = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowFileMenu(false);
        window.requestAnimationFrame(() => fileMenuTriggerRef.current?.focus());
      }
    };

    window.addEventListener("mousedown", onMouseDownWindow);
    window.addEventListener("keydown", onKeyDownWindow);
    return () => {
      window.removeEventListener("mousedown", onMouseDownWindow);
      window.removeEventListener("keydown", onKeyDownWindow);
    };
  }, [showFileMenu]);

  useEffect(() => {
    if (!showDisplayMenu) return;

    const onMouseDownWindow = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const clickedTrigger = Boolean(
        target && displayMenuTriggerRef.current?.contains(target),
      );
      if (clickedTrigger) return;
      if (target && displayPanelRef.current && !displayPanelRef.current.contains(target)) {
        setShowDisplayMenu(false);
      }
    };

    const onKeyDownWindow = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowDisplayMenu(false);
        window.requestAnimationFrame(() => displayMenuTriggerRef.current?.focus());
      }
    };

    window.addEventListener("mousedown", onMouseDownWindow);
    window.addEventListener("keydown", onKeyDownWindow);
    return () => {
      window.removeEventListener("mousedown", onMouseDownWindow);
      window.removeEventListener("keydown", onKeyDownWindow);
    };
  }, [showDisplayMenu]);

  useEffect(() => {
    if (!showDisplayMenu) return;
    window.requestAnimationFrame(() => displayPanelCloseRef.current?.focus());
  }, [showDisplayMenu]);

  useEffect(() => {
    return () => {
      if (titleSaveTimerRef.current) {
        clearTimeout(titleSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showFileMenu) return;
    window.requestAnimationFrame(() => {
      const firstItem = fileMenuItemRefs.current[0];
      firstItem?.focus();
    });
  }, [showFileMenu]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const setEditorText = useCallback((text: string) => {
    setEditorTextState(text);
  }, []);

  const pushCanvasActionIssue = (level: AppIssue["level"], title: string, description?: string) => {
    const id = crypto.randomUUID();
    setEditorIssues((prev) => [...prev, { id, level, title, description, timestamp: Date.now() }]);
    if (level === "success") {
      setTimeout(() => {
        setEditorIssues((prev) => prev.filter((i) => i.id !== id));
      }, 3000);
    }
  };

  const handleOpenDocument = (id: string) => {
    if (id === currentDoc.id) return;
    router.push(`/editor?id=${id}`);
  };

  const handleCloseDocument = async (idToClose: string) => {
    closeDocument(idToClose);
    if (idToClose === currentDoc.id) {
      const remaining = openDocuments.filter((d) => d.id !== idToClose);
      if (remaining.length > 0) {
        router.push(`/editor?id=${remaining[remaining.length - 1].id}`);
      } else {
        router.push("/editor");
        initialize({
          id: "",
          title: "",
          diagramType: "sankey",
          folderId: null,
          createdAt: 0,
          updatedAt: 0,
          data: {},
        });
      }
    }
  };

  const handleDeleteFromTab = async (idToDelete: string) => {
    const confirmed = await confirm({
      title: "Delete Diagram?",
      message: "This action cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;

    await removeDocument(idToDelete);
    if (idToDelete === currentDoc.id) {
      handleCloseDocument(idToDelete);
    } else {
      closeDocument(idToDelete);
    }
  };

  const handleCreateNewDiagram = async () => {
    const plugin = getDiagramPlugin("sankey");
    if (!plugin) return;
    const now = Date.now();
    const newDoc: BaseDocument = {
      id: crypto.randomUUID(),
      title: `Untitled ${plugin.displayName}`,
      diagramType: "sankey",
      folderId: null,
      createdAt: now,
      updatedAt: now,
      data: plugin.defaultData(),
    };
    await upsertDocument(newDoc);
    addOpenDocument(newDoc);
    router.push(`/editor?id=${newDoc.id}`);
  };

  const focusFileMenuItem = useCallback((index: number) => {
    const items = fileMenuItemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item));
    if (items.length === 0) return;
    const nextIndex = ((index % items.length) + items.length) % items.length;
    items[nextIndex].focus();
  }, []);

  const handleFileMenuTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setShowDisplayMenu(false);
      setShowFileMenu(true);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setShowDisplayMenu(false);
      setShowFileMenu(true);
      window.requestAnimationFrame(() => {
        const lastIndex = fileMenuItemRefs.current.filter(Boolean).length - 1;
        if (lastIndex >= 0) focusFileMenuItem(lastIndex);
      });
    }
  };

  const handleFileMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = fileMenuItemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item));
    if (items.length === 0) return;
    const currentIndex = items.findIndex((item) => item === document.activeElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusFileMenuItem(currentIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusFileMenuItem(currentIndex - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusFileMenuItem(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusFileMenuItem(items.length - 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setShowFileMenu(false);
      fileMenuTriggerRef.current?.focus();
    }
  };

  const setTitle = (newTitle: string) => {
    initialize((prev) => ({ ...prev, title: newTitle }));
    storeSetTitle(newTitle); // Sync store

    // Initializing prev state properly for local update
    updateDocumentTitle(currentDoc.id, newTitle);

    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
    }
    const docSnapshot = currentDoc;
    titleSaveTimerRef.current = setTimeout(() => {
      void upsertDocument({ ...docSnapshot, title: newTitle, updatedAt: Date.now() });
      titleSaveTimerRef.current = null;
    }, 500);
  };

  // Helper to update title in open tabs list locally
  const updateDocumentTitle = (id: string, title: string) => {
    setOpenDocuments(prev => prev.map(p => p.id === id ? { ...p, title } : p));
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button === 1 || (event.button === 0 && isSpacePanning)) {
      document.body.style.cursor = "grabbing";
      const onUp = () => {
        document.body.style.cursor = "";
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointerup", onUp);
    }
  };

  const onPluginDataChange = useCallback((newData: Record<string, unknown>) => {
    setHistoryPast((prev) => [...prev.slice(-19), currentDoc]);
    setHistoryFuture([]);
    const updated = { ...currentDoc, data: newData, updatedAt: Date.now() };
    initialize(updated);
    void upsertDocument(updated);
    if (typeof newData.editorText === "string") {
      setEditorTextState(newData.editorText);
    }
  }, [currentDoc]);

  const undo = useCallback(async () => {
    if (historyPast.length === 0) return;
    const previous = historyPast[historyPast.length - 1];
    setHistoryFuture((prev) => [currentDoc, ...prev]);
    setHistoryPast(historyPast.slice(0, -1));
    initialize(previous);
    if (typeof previous.data.editorText === "string") setEditorTextState(previous.data.editorText);
    await upsertDocument(previous);
  }, [currentDoc, historyPast]);

  const redo = useCallback(async () => {
    if (historyFuture.length === 0) return;
    const next = historyFuture[0];
    setHistoryFuture(historyFuture.slice(1));
    setHistoryPast((prev) => [...prev, currentDoc]);
    initialize(next);
    if (typeof next.data.editorText === "string") setEditorTextState(next.data.editorText);
    await upsertDocument(next);
  }, [currentDoc, historyFuture]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCmd = isMac() ? e.metaKey : e.ctrlKey;
      if (isCmd && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) void redo();
        else void undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (isTypingTarget(event.target)) return;
      if (!event.repeat) {
        setIsSpacePanning(true);
      }
      event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      setIsSpacePanning(false);
      event.preventDefault();
    };

    const onWindowBlur = () => {
      setIsSpacePanning(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  const syncFromEditor = () => {
    onPluginDataChange({ ...docData, editorText: editorText });
    pushCanvasActionIssue("success", "Synced", "Visual validation complete");
  };

  const handleToggleTheme = async () => {
    const next = appTheme === "dark" ? "light" : "dark";
    setAppTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    const prefs = await loadAppPreferences();
    await saveAppPreferences({ ...prefs, defaultTheme: next });
  };

  // ---------------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------------

  const stripAnimatedStyles = (element: Element) => {
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
    element.style.animation = "none";
    element.style.transition = "none";
    element.style.strokeDasharray = "none";
    element.style.strokeDashoffset = "0";
    element.style.mixBlendMode = "normal";
  };

  const buildExportReadySvg = useCallback((sourceSvg: SVGSVGElement, theme: "light" | "dark") => {
    const clone = sourceSvg.cloneNode(true) as SVGSVGElement;
    const sourceNodes = [sourceSvg, ...Array.from(sourceSvg.querySelectorAll("*"))];
    const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];
    const fallbackTextColor = theme === "dark" ? "#f8fafc" : "#0f172a";
    const fallbackBackground = theme === "dark" ? "#050505" : "#ffffff";

    cloneNodes.forEach((node) => stripAnimatedStyles(node));

    for (let index = 0; index < cloneNodes.length; index++) {
      const sourceNode = sourceNodes[index];
      const cloneNode = cloneNodes[index];
      if (!sourceNode || !cloneNode) continue;
      const computed = window.getComputedStyle(sourceNode);

      if (cloneNode instanceof SVGElement) {
        const fill = computed.fill;
        const stroke = computed.stroke;
        const color = computed.color;

        if (fill && fill !== "none") cloneNode.setAttribute("fill", fill);
        if (stroke && stroke !== "none") cloneNode.setAttribute("stroke", stroke);
        if (computed.strokeWidth) cloneNode.setAttribute("stroke-width", computed.strokeWidth);
        if (computed.fillOpacity) cloneNode.setAttribute("fill-opacity", computed.fillOpacity);
        if (computed.strokeOpacity) cloneNode.setAttribute("stroke-opacity", computed.strokeOpacity);
        if (computed.opacity) cloneNode.setAttribute("opacity", computed.opacity);

        if (cloneNode.tagName.toLowerCase() === "text") {
          cloneNode.setAttribute("fill", fill && fill !== "none" ? fill : (color || fallbackTextColor));
          cloneNode.setAttribute("stroke", "none");
        }
      }
    }

    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

    if (!exportTransparentBg) {
      const bgRect = clone.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
      bgRect.setAttribute("x", "0");
      bgRect.setAttribute("y", "0");
      bgRect.setAttribute("width", "100%");
      bgRect.setAttribute("height", "100%");
      bgRect.setAttribute("fill", fallbackBackground);
      clone.insertBefore(bgRect, clone.firstChild);
    }

    return new XMLSerializer().serializeToString(clone);
  }, [exportTransparentBg]);

  const handleExport = async (format: "svg" | "png" | "html") => {
    if (!svgElement) {
      pushCanvasActionIssue("error", "Canvas not ready", "Wait for render");
      return;
    }
    const { title } = currentDoc;
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = (DEFAULT_APP_PREFERENCES.defaultExportFileTemplate || "{title}-{date}")
      .replace("{title}", title || "untitled")
      .replace("{date}", dateStr);

    try {
      if (format === "svg") {
        const svgString = buildExportReadySvg(svgElement, appTheme);
        downloadFile(`${filename}.svg`, "image/svg+xml", svgString);
      } else if (format === "png") {
        const canvas = document.createElement("canvas");
        canvas.width = exportWidth * exportPngScale;
        canvas.height = exportHeight * exportPngScale;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        if (!exportTransparentBg) {
          ctx.fillStyle = appTheme === "dark" ? "#050505" : "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        const img = new Image();
        const svgString = buildExportReadySvg(svgElement, appTheme);
        const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        try {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              canvas.toBlob((pngBlob) => {
                if (!pngBlob) {
                  reject(new Error("PNG export failed"));
                  return;
                }
                const downloadUrl = URL.createObjectURL(pngBlob);
                const a = document.createElement("a");
                a.href = downloadUrl;
                a.download = `${filename}.png`;
                a.click();
                URL.revokeObjectURL(downloadUrl);
                resolve();
              }, "image/png");
            };
            img.onerror = () => reject(new Error("SVG image decode failed"));
            img.src = url;
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      } else if (format === "html") {
        const html = `<html><body>${buildExportReadySvg(svgElement, appTheme)}</body></html>`;
        downloadFile(`${filename}.html`, "text/html", html);
      }
    } catch (e) {
      pushCanvasActionIssue("error", "Export failed", String(e));
    }
  };

  const exportConfigJson = () => {
    const configPayload = {
      _format: "streaming-ide-config-v1",
      title: currentDoc.title,
      diagramType: currentDoc.diagramType,
      data: currentDoc.data,
      exportedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(configPayload, null, 2);
    const safeTitle = (currentDoc.title || "diagram").trim().replace(/[\\/:*?"<>|]/g, "-");
    downloadFile(`${safeTitle}.streaming.json`, "application/json", json);
    pushCanvasActionIssue("success", "Config exported", "Configuration saved");
  };

  const importConfigJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed._format !== "streaming-ide-config-v1") {
        pushCanvasActionIssue("error", "Import failed", "Invalid config file.");
        return;
      }
      const newDoc: BaseDocument = {
        id: crypto.randomUUID(),
        title: parsed.title || "Imported Diagram",
        diagramType: parsed.diagramType || "sankey",
        folderId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        data: parsed.data,
      };
      initialize(newDoc);
      await upsertDocument(newDoc);
      addOpenDocument(newDoc);
      router.push(`/editor?id=${newDoc.id}`);
      pushCanvasActionIssue("success", "Config imported", `Loaded "${newDoc.title}"`);
    } catch {
      pushCanvasActionIssue("error", "Import failed", "Failed to parse JSON");
    }
  };

  // ---------------------------------------------------------------------------
  // Modals & Editing
  // ---------------------------------------------------------------------------

  const closeEditorModal = () => {
    setActiveEditorModal(null);
    setLinkEditDraft(null);
    setNodeEditDraft(null);
    setEditorModalAnchor(null);
    setEditorModalError(null);
  };

  const openLinkEditor = useCallback((index: number, anchor?: { x: number; y: number }) => {
    const link = graph.links[index];
    if (!link) return;
    setSelectedLinkIndex(index);
    setLinkEditDraft({ source: link.source, target: link.target, value: link.value });
    setNodeEditDraft(null);
    setEditorModalError(null);
    setEditorModalAnchor(anchor ?? null);
    setActiveEditorModal({ type: "link", index });
  }, [graph.links]);

  const openNodeEditor = useCallback((nodeId: string, anchor?: { x: number; y: number }) => {
    const exists = graph.nodes.some((node) => node.id === nodeId);
    if (!exists) return;
    setSelectedNodeIds([nodeId]);
    setNodeEditDraft({ id: nodeId, nextId: nodeId, originalId: nodeId });
    setLinkEditDraft(null);
    setEditorModalError(null);
    setEditorModalAnchor(anchor ?? null);
    setActiveEditorModal({ type: "node", id: nodeId });
  }, [graph.nodes]);

  const applyNextLinksToEditor = (nextLinks: EditableLink[], successTitle: string, successDescription?: string) => {
    const nextText = serializeLinksByFormat(nextLinks, docFormat);
    setEditorText(nextText); // Also handled by plugin data change sync usually, but here immediate
    onPluginDataChange({ ...docData, editorText: nextText });

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
    }
  };

  const saveLinkEdit = () => {
    if (!activeEditorModal || activeEditorModal.type !== "link" || !linkEditDraft) return;
    if (linkDraftValidationError) {
      setEditorModalError(linkDraftValidationError);
      return;
    }
    const { source, target, value } = linkEditDraft;
    const nextLinks = graph.links.map((link, index) =>
      index === activeEditorModal.index ? { source, target, value: Number(value) } : { ...link }
    );
    applyNextLinksToEditor(nextLinks, "Flow updated", `${source} -> ${target}`);
  };

  const deleteLinkEdit = () => {
    if (!activeEditorModal || activeEditorModal.type !== "link") return;
    const nextLinks = graph.links.filter((_, index) => index !== activeEditorModal.index);
    applyNextLinksToEditor(nextLinks, "Flow removed");
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

  const jumpToRelatedLink = (mode: "source" | "target") => {
    if (!activeEditorModal || activeEditorModal.type !== "link") return;
    const current = graph.links[activeEditorModal.index];
    if (!current) return;
    const matchIndices = graph.links.flatMap((link, index) => {
      if (index === activeEditorModal.index) return [];
      const match = mode === "source" ? link.source === current.source : link.target === current.target;
      return match ? [index] : [];
    });
    if (matchIndices.length === 0) return;
    const next = matchIndices.find(idx => idx > activeEditorModal.index) ?? matchIndices[0];
    openLinkEditor(next, editorModalAnchor ?? undefined);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const leftWorkbenchPanel = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-container-high/90 shadow-(--shadow-lg) backdrop-blur-2xl">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h3 className="text-sm font-semibold tracking-wide text-foreground">Data Source</h3>
        <div className="flex items-center gap-1">
          {!isNarrowLayout && (
            <>
              <button
                type="button"
                onClick={() => setLeftWorkbenchMode("compact")}
                className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${leftWorkbenchMode === "compact" ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-surface-container hover:text-foreground"}`}
              >
                Compact
              </button>
              <button
                type="button"
                onClick={() => setLeftWorkbenchMode("expanded")}
                className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${leftWorkbenchMode === "expanded" ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-surface-container hover:text-foreground"}`}
              >
                Wide
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setLeftWorkbenchMode("collapsed")}
            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-container hover:text-foreground"
            title="Collapse panel"
            aria-label="Collapse data source panel"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          {!autoSync && (
            <button onClick={syncFromEditor} className="rounded-md p-1.5 text-primary hover:bg-surface-container" title="Sync">
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-transparent/20">
        <SankeyMonacoEditor
          value={editorText}
          onChange={setEditorTextState}
          format={docFormat}
          theme={appTheme}
          className="bg-transparent"
        />
      </div>

      <div className="flex justify-between border-t border-border p-3 text-[10px] text-muted">
        <span>{editorText.length} chars</span>
        <span>{autoSync ? "Auto-sync on" : "Manual sync"}</span>
      </div>
    </div>
  );

  const rightWorkbenchPanel = plugin?.StylePanel ? (
    <div
      id="editor-display-panel"
      ref={displayPanelRef}
      role="dialog"
      aria-label="Display options"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-container-high/90 shadow-(--shadow-lg) backdrop-blur-2xl"
    >
      <div className="flex items-center justify-between border-b border-border p-4">
        <h3 className="text-sm font-semibold tracking-wide text-foreground">Visuals</h3>
        <button
          ref={displayPanelCloseRef}
          type="button"
          onClick={() => {
            setShowDisplayMenu(false);
            displayMenuTriggerRef.current?.focus();
          }}
          className="text-text-secondary hover:text-foreground"
        >
          <GalleryVerticalEnd className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scrollbar">
        <plugin.StylePanel
          data={currentDoc.data}
          onDataChange={onPluginDataChange}
        />
      </div>
    </div>
  ) : null;

  if (!hasHydrated) return <div className="h-screen w-screen bg-bg-primary" />;

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-bg-primary text-foreground font-sans selection:bg-primary/20"
      onPointerDown={onPointerDown}
    >
      {/* 0. Background Parallax Layer */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,color-mix(in_srgb,var(--primary)_14%,transparent)_0%,transparent_52%),radial-gradient(circle_at_80%_80%,color-mix(in_srgb,var(--text-primary)_8%,transparent)_0%,transparent_48%)]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(var(--canvas-grid-accent) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-grid-accent) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      {hasOpenTabs && (
        <>
          <div className="absolute inset-0 z-10 flex flex-col" style={workspaceShellStyle}>
            {isNarrowLayout && (leftWorkbenchVisible || showDisplayMenu) && (
              <button
                type="button"
                aria-label="Close side panels"
                onClick={() => {
                  setLeftWorkbenchMode("collapsed");
                  setShowDisplayMenu(false);
                }}
                className="absolute inset-0 z-30 bg-black/22 backdrop-blur-[1px]"
              />
            )}

            <header className="pointer-events-none relative z-50 px-3 pt-3 md:px-4 md:pt-4">
              <motion.div
                initial={{ y: -16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="pointer-events-auto grid h-(--editor-header-height) grid-cols-[auto_minmax(0,16rem)_minmax(0,1fr)_auto] items-center gap-2 rounded-full border border-border/70 bg-surface-container-high/85 px-2 shadow-(--shadow-base) backdrop-blur-xl md:gap-3 md:px-3"
              >
                <button
                  onClick={() => router.push("/")}
                  className="grid h-10 w-10 place-items-center rounded-full bg-surface-container text-primary transition-colors hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <LayoutTemplate className="h-4 w-4" />
                </button>

                <div className="min-w-0 flex items-center gap-2">
                  <input
                    value={currentDoc.title || ""}
                    onChange={(e) => setTitle(e.target.value)}
                    className="min-w-0 flex-1 truncate bg-transparent text-lg font-semibold text-foreground placeholder:text-muted focus:outline-none"
                    placeholder="Untitled Flow"
                    style={{ fontFamily: "var(--font-syne)" }}
                  />

                  <div className="relative" ref={fileMenuRef}>
                    <button
                      type="button"
                      ref={fileMenuTriggerRef}
                      aria-haspopup="menu"
                      aria-expanded={showFileMenu}
                      aria-controls="editor-file-menu"
                      onClick={() => {
                        setShowDisplayMenu(false);
                        setShowFileMenu((value) => !value);
                      }}
                      onPointerDown={() => setShowDisplayMenu(false)}
                      onKeyDown={handleFileMenuTriggerKeyDown}
                      className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-container hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      File
                    </button>
                    <div
                      id="editor-file-menu"
                      role="menu"
                      aria-hidden={!showFileMenu}
                      onKeyDown={handleFileMenuKeyDown}
                      className={`absolute top-full left-0 mt-2 min-w-40 rounded-xl border border-border bg-surface-container-highest p-1 shadow-(--shadow-lg) transition-all ${showFileMenu ? "pointer-events-auto visible opacity-100" : "pointer-events-none invisible opacity-0"}`}
                    >
                      <button
                        type="button"
                        ref={(node) => {
                          fileMenuItemRefs.current[0] = node;
                        }}
                        tabIndex={showFileMenu ? 0 : -1}
                        role="menuitem"
                        onClick={() => {
                          setShowFileMenu(false);
                          void handleCreateNewDiagram();
                        }}
                        className="w-full rounded-lg px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-container hover:text-foreground"
                      >
                        New Diagram
                      </button>
                      <button
                        type="button"
                        ref={(node) => {
                          fileMenuItemRefs.current[1] = node;
                        }}
                        tabIndex={showFileMenu ? 0 : -1}
                        role="menuitem"
                        onClick={() => {
                          setShowFileMenu(false);
                          exportConfigJson();
                        }}
                        className="w-full rounded-lg px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-container hover:text-foreground"
                      >
                        Export JSON
                      </button>
                      <button
                        type="button"
                        ref={(node) => {
                          fileMenuItemRefs.current[2] = node;
                        }}
                        tabIndex={showFileMenu ? 0 : -1}
                        role="menuitem"
                        onClick={() => {
                          setShowFileMenu(false);
                          importConfigJsonInputRef.current?.click();
                        }}
                        className="w-full rounded-lg px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-container hover:text-foreground"
                      >
                        Import JSON
                      </button>
                      <input
                        ref={importConfigJsonInputRef}
                        type="file"
                        className="hidden"
                        accept=".json"
                        onChange={(e) => {
                          if (e.target.files?.[0]) importConfigJson(e.target.files[0]);
                        }}
                      />
                    </div>
                  </div>

                  {plugin?.StylePanel && (
                    <button
                      ref={displayMenuTriggerRef}
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={showDisplayMenu}
                      aria-controls="editor-display-panel"
                      onClick={() => {
                        setShowFileMenu(false);
                        if (!showDisplayMenu && isNarrowLayout && leftWorkbenchMode !== "collapsed") {
                          setLeftWorkbenchMode("collapsed");
                        }
                        setShowDisplayMenu((v) => !v);
                      }}
                      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${showDisplayMenu ? "bg-primary/10 text-primary" : "text-text-secondary hover:text-foreground"}`}
                    >
                      View
                    </button>
                  )}
                </div>

                <div className="min-w-0 overflow-hidden">
                  <EditorTabs
                    documents={openDocuments}
                    activeDocId={currentDoc.id}
                    onSelect={handleOpenDocument}
                    onClose={handleCloseDocument}
                    onNew={handleCreateNewDiagram}
                    onDelete={handleDeleteFromTab}
                  />
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <motion.button
                    initial={{ scale: 0.92, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    onClick={handleToggleTheme}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-surface-container-high text-text-secondary transition hover:border-primary/50 hover:text-primary hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {appTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </motion.button>

                  <motion.button
                    initial={{ scale: 0.92, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex h-10 items-center gap-2 rounded-full border border-primary/30 bg-primary px-5 text-sm font-semibold text-on-primary shadow-(--shadow-base) transition-all hover:brightness-95 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-55"
                    onClick={() => handleExport("png")}
                    disabled={!canExportPng}
                    title={canExportPng ? "Export PNG" : "Canvas is not ready yet"}
                  >
                    <Share2 className="h-4 w-4" />
                    <span>Export</span>
                  </motion.button>
                </div>
              </motion.div>
            </header>

            <div className="relative z-20 min-h-0 flex-1 px-3 pb-4 pt-3 md:px-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="grid h-full min-h-0"
                style={{ gridTemplateColumns: "var(--editor-left-width) minmax(0,1fr) var(--editor-right-width)" }}
              >
                {!isNarrowLayout && leftWorkbenchVisible ? (
                  <aside className="min-h-0 pr-3">{leftWorkbenchPanel}</aside>
                ) : (
                  <div />
                )}

                <div className="relative min-h-0 min-w-0">
                  {plugin && plugin.Canvas ? (
                    <plugin.Canvas
                      key={canvasResetKey}
                      data={currentDoc.data}
                      width={CANVAS_BASE_WIDTH}
                      height={CANVAS_BASE_HEIGHT}
                      onDataChange={onPluginDataChange}
                      interactionState={{
                        width: 0,
                        height: 0,
                        interactionMode: "select",
                        isSpacePanning,
                        selectedNodeIds,
                        selectedLinkIndex,
                        pulseLinkIndex,
                        pulseNodeId,
                        renderHints,
                        onSelectionChange: setSelectedNodeIds,
                        onLinkSelectionChange: setSelectedLinkIndex,
                        onLinkEditRequest: openLinkEditor,
                        onNodeEditRequest: openNodeEditor,
                        onZoomChange: setZoomLevel,
                      }}
                      onSvgReady={setSvgElement}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted/50 font-light tracking-wide">
                      Initialize Canvas...
                    </div>
                  )}
                </div>

                {!isNarrowLayout && rightWorkbenchVisible ? (
                  <aside className="min-h-0 pl-3">{rightWorkbenchPanel}</aside>
                ) : (
                  <div />
                )}
              </motion.div>

              <AnimatePresence mode="wait">
                {isNarrowLayout && leftWorkbenchVisible && (
                  <motion.aside
                    initial={{ x: -320, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -320, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="absolute left-0 top-0 z-40 flex h-full w-[min(24rem,calc(100vw-1.5rem))] max-w-[24rem] flex-col"
                  >
                    {leftWorkbenchPanel}
                  </motion.aside>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {isNarrowLayout && rightWorkbenchVisible && (
                  <motion.aside
                    initial={{ x: 320, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 320, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="absolute right-0 top-0 z-40 flex h-full w-[min(22rem,calc(100vw-1.5rem))] flex-col"
                  >
                    {rightWorkbenchPanel}
                  </motion.aside>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Toggle Workbench Trigger */}
          <motion.div
            className="absolute left-0 top-1/2 -translate-y-1/2 z-30 group"
          >
            {!leftWorkbenchVisible && (
              <button
                onClick={() => {
                  if (window.innerWidth < 1280) {
                    setShowDisplayMenu(false);
                  }
                  setLeftWorkbenchMode("compact");
                }}
                className="flex h-12 w-6 items-center justify-center rounded-r-xl border-y border-r border-border bg-surface-container-high/85 text-text-secondary transition-all hover:w-8 hover:text-primary"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </motion.div>

          {/* Bottom Dock - Floating Controls */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="flex items-center gap-2 rounded-full border border-border bg-surface-container-high/90 p-1.5 shadow-(--shadow-lg) backdrop-blur-2xl"
            >
              <button
                onClick={undo}
                disabled={!canUndo}
                title={`Undo (${undoShortcutHint})`}
                aria-label={`Undo (${undoShortcutHint})`}
                className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-container hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                title={`Redo (${redoShortcutHint})`}
                aria-label={`Redo (${redoShortcutHint})`}
                className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-container hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <div className="mx-1 h-4 w-px bg-border" />
              <button onClick={() => setCanvasResetKey(k => k + 1)} className="h-8 rounded-full bg-surface-container px-4 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-container-high hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                Fit Canvas
              </button>
            </motion.div>
          </div>

          {/* Issue Center - Floating Notification */}
          <div className="absolute bottom-6 right-6 z-50 max-w-sm pointer-events-none">
            <IssueCenter issues={editorIssues} className="pointer-events-auto" />
          </div>

          {/* Modals */}
          {activeEditorModal && activeEditorModal.type === "link" && linkEditDraft && (
            <FlowEditModal
              mode="link"
              draft={linkEditDraft}
              anchor={editorModalAnchor}
              related={{
                sameSourceCount: graph.links.filter((l, i) => i !== activeEditorModal.index && l.source === linkEditDraft.source).length,
                sameTargetCount: graph.links.filter((l, i) => i !== activeEditorModal.index && l.target === linkEditDraft.target).length,
              }}
              onJumpSameSource={() => jumpToRelatedLink("source")}
              onJumpSameTarget={() => jumpToRelatedLink("target")}
              nodeOptions={graph.nodes.map(n => n.id)}
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
              nodeOptions={graph.nodes.map(n => n.id)}
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

        </>
      )}

      {!hasOpenTabs && (
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          <div className="text-center space-y-6">
            <h1 className="text-5xl font-display font-medium tracking-tight text-foreground" style={{ fontFamily: "var(--font-syne)" }}>
              Ready to create?
            </h1>
            <p className="text-sm text-text-secondary">Start with a new Sankey diagram and shape the flow from raw data.</p>
            <button
              onClick={handleCreateNewDiagram}
              className="rounded-full border border-primary/30 bg-primary px-8 py-4 text-lg font-semibold text-on-primary shadow-(--shadow-base) transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Start New Project
            </button>
          </div>
        </div>
      )}

      {dialogNode}
    </div>
  );
}
