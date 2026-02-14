"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CopyPlus,
  Download,
  FileUp,
  LayoutTemplate,
  GripVertical,
  Moon,
  Play,
  Redo2,
  Sun,
  Undo2,
  WandSparkles,
} from "lucide-react";
import { sankey, SankeyGraph as D3SankeyGraph } from "d3-sankey";
import { parseSankeyTextDetailed } from "@/lib/parse";
import {
  clearRecentTemplateIds,
  deleteDocumentById,
  deleteUserTemplates,
  deleteUserTemplate,
  loadAppPreferences,
  loadAllDocuments,
  loadCurrentDocument,
  loadDocumentById,
  loadUserTemplates,
  loadRecentTemplateIds,
  loadUserTemplateById,
  saveCurrentDocument,
  saveAppPreferences,
  saveRecentDocument,
  saveRecentTemplate,
  setCurrentDocumentId,
  upsertUserTemplate,
  upsertDocument,
} from "@/lib/storage";
import {
  linksToCanonicalCsv,
  linksToCanonicalJson,
  parseCsvPreview,
  parseJsonPreview,
  parseXlsxPreview,
  rowsToCanonicalJson,
  TableMapping,
  TablePreview,
  transformRowsToCanonicalLinks,
} from "@/lib/source-import";
import { blankDocument, templateById, templateList } from "@/lib/templates";
import {
  AppPreferences,
  DataFormat,
  PerformanceMode,
  SankeyDocument,
  SankeyStyle,
  TemplateSummary,
} from "@/lib/types";
import { AppIssue } from "@/lib/issues";
import {
  DARK_LABEL_COLOR,
  EXPORT_BG_DARK,
  EXPORT_BG_LIGHT,
  LIGHT_LABEL_COLOR,
} from "@/lib/theme";
import { SankeyMonacoEditor } from "@/components/editor/monaco-editor";
import { SankeyCanvas } from "@/components/editor/sankey-canvas";
import { IssueCenter } from "@/components/common/issue-center";
import { useAppDialog } from "@/components/common/app-dialog";
import {
  buttonPrimarySm,
  buttonSecondaryTiny,
  buttonDangerSoftTiny,
  withDisabled,
} from "@/components/common/interaction-styles";
import { useEditorStore } from "@/store/editor-store";

function detectFileFormat(fileName: string): DataFormat | "xlsx" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".xlsx")) return "xlsx";
  return null;
}

function downloadFile(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

type Props = {
  templateId?: string;
  docId?: string;
};

const EXPORT_SETTINGS_STORAGE_KEY = "streaming-export-settings-v1";
const MAPPING_PRESETS_STORAGE_KEY = "streaming-mapping-presets-v1";
const STYLE_PRESET_STORAGE_KEY = "streaming-style-presets-v1";
const LEFT_WORKBENCH_MODE_STORAGE_KEY = "streaming-editor-left-workbench-mode-v1";
const CANVAS_BASE_WIDTH = 1200;
const CANVAS_BASE_HEIGHT = 700;
const USER_TEMPLATE_ACCENTS = [
  "from-blue-500 to-cyan-500",
  "from-emerald-500 to-teal-500",
  "from-fuchsia-500 to-orange-500",
  "from-indigo-500 to-sky-500",
];

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

type StylePreset = {
  id: string;
  name: string;
  style: SankeyStyle;
  builtIn?: boolean;
};

const DEFAULT_STYLE_PRESETS: StylePreset[] = [
  {
    id: "style-clean-light",
    name: "Clean Light",
    builtIn: true,
    style: {
      ...blankDocument.style,
      theme: "light",
      palette: "classic",
      nodeWidth: 20,
      nodePadding: 18,
      nodeRadius: 3,
      linkOpacity: 0.45,
      curvature: 0.5,
      labelStyle: "badge",
      linkRender: "soft",
      colorStrategy: "palette",
      showLabels: true,
      labelFontSize: 12,
      labelPosition: "outside",
      labelColor: LIGHT_LABEL_COLOR,
      labelFontFamily: "Roboto",
    },
  },
  {
    id: "style-midnight-flow",
    name: "Midnight Flow",
    builtIn: true,
    style: {
      ...blankDocument.style,
      theme: "dark",
      palette: "ocean",
      nodeWidth: 18,
      nodePadding: 16,
      nodeRadius: 4,
      linkOpacity: 0.55,
      curvature: 0.45,
      labelStyle: "badge",
      linkRender: "soft",
      colorStrategy: "palette",
      showLabels: true,
      labelFontSize: 12,
      labelPosition: "outside",
      labelColor: DARK_LABEL_COLOR,
      labelFontFamily: "Google Sans",
    },
  },
  {
    id: "style-report-compact",
    name: "Report Compact",
    builtIn: true,
    style: {
      ...blankDocument.style,
      theme: "light",
      palette: "sunset",
      nodeWidth: 14,
      nodePadding: 10,
      nodeRadius: 2,
      linkOpacity: 0.5,
      curvature: 0.4,
      labelStyle: "plain",
      linkRender: "flat",
      colorStrategy: "palette",
      showLabels: true,
      labelFontSize: 11,
      labelPosition: "inside",
      labelColor: "#0f172a",
      labelFontFamily: "System Sans",
    },
  },
  {
    id: "style-editorial-light",
    name: "Editorial Light",
    builtIn: true,
    style: {
      ...blankDocument.style,
      theme: "light",
      palette: "classic",
      nodeWidth: 22,
      nodePadding: 21,
      nodeRadius: 4,
      linkOpacity: 0.52,
      curvature: 0.48,
      labelStyle: "badge",
      linkRender: "soft",
      colorStrategy: "palette",
      showLabels: true,
      labelFontSize: 12,
      labelPosition: "outside",
      labelColor: LIGHT_LABEL_COLOR,
      labelFontFamily: "Google Sans",
    },
  },
  {
    id: "style-editorial-dark",
    name: "Editorial Dark",
    builtIn: true,
    style: {
      ...blankDocument.style,
      theme: "dark",
      palette: "ocean",
      nodeWidth: 22,
      nodePadding: 21,
      nodeRadius: 4,
      linkOpacity: 0.56,
      curvature: 0.48,
      labelStyle: "badge",
      linkRender: "soft",
      colorStrategy: "palette",
      showLabels: true,
      labelFontSize: 12,
      labelPosition: "outside",
      labelColor: DARK_LABEL_COLOR,
      labelFontFamily: "Google Sans",
    },
  },
];
type MappingPreset = {
  id: string;
  name: string;
  mode: "csv" | "json";
  mapping: TableMapping;
  createdAt: number;
};

type LeftWorkbenchMode = "collapsed" | "compact" | "expanded";
type ActiveWorkspaceOverlay = "none" | "left";
const DEFAULT_APP_PREFERENCES: AppPreferences = {
  defaultTheme: "dark",
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

export function EditorWorkspace({ templateId, docId }: Props) {
  const router = useRouter();
  const { confirm, prompt, dialogNode } = useAppDialog();
  const [initialExportSettings] = useState(loadExportSettingsFromStorage);
  const [appPreferences, setAppPreferences] = useState<AppPreferences>(
    DEFAULT_APP_PREFERENCES,
  );
  const [activeTab, setActiveTab] = useState<"source" | "editor">("editor");
  const [showDocuments, setShowDocuments] = useState(false);
  const [libraryTab, setLibraryTab] = useState<"documents" | "templates">("documents");
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryTemplateSourceMode, setLibraryTemplateSourceMode] = useState<
    "all" | "user" | "builtin"
  >("all");
  const [libraryTemplateDifficultyFilter, setLibraryTemplateDifficultyFilter] = useState<
    "all" | "Easy" | "Medium" | "Advanced"
  >("all");
  const [libraryTemplateTagFilter, setLibraryTemplateTagFilter] = useState("all");
  const [allDocuments, setAllDocuments] = useState<SankeyDocument[]>([]);
  const [recentTemplateIds, setRecentTemplateIds] = useState<string[]>([]);
  const [userTemplates, setUserTemplates] = useState<TemplateSummary[]>([]);
  const [selectedUserTemplateIds, setSelectedUserTemplateIds] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<TablePreview | null>(null);
  const [sourcePreviewMode, setSourcePreviewMode] = useState<"csv" | "json">("csv");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sourceSortKey, setSourceSortKey] = useState("");
  const [sourceSortDir, setSourceSortDir] = useState<"asc" | "desc">("asc");
  const [sourcePage, setSourcePage] = useState(1);
  const [sourcePageSize, setSourcePageSize] = useState(5);
  const [sourceNotice, setSourceNotice] = useState<string>("");
  const [valuePolicy, setValuePolicy] = useState<"drop" | "clamp">("drop");
  const [valueMinWhenClamped, setValueMinWhenClamped] = useState(1);
  const [sourceFileName, setSourceFileName] = useState<string>("");
  const [sourceError, setSourceError] = useState<string>("");
  const [pastedCsv, setPastedCsv] = useState<string>("");
  const [pastedJson, setPastedJson] = useState<string>("");
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
  const [mappingPresets, setMappingPresets] = useState<MappingPreset[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(MAPPING_PRESETS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as MappingPreset[];
      return parsed.filter(
        (item) =>
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          (item.mode === "csv" || item.mode === "json") &&
          typeof item.mapping?.source === "string" &&
          typeof item.mapping?.target === "string" &&
          typeof item.mapping?.value === "string",
      );
    } catch {
      return [];
    }
  });
  const [customStylePresets, setCustomStylePresets] = useState<StylePreset[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STYLE_PRESET_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as StylePreset[];
      return parsed.filter(
        (item) =>
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.style === "object" &&
          typeof item.style?.theme === "string" &&
          typeof item.style?.palette === "string",
      );
    } catch {
      return [];
    }
  });
  const [newStylePresetName, setNewStylePresetName] = useState("");
  const [autoLayoutStrategy, setAutoLayoutStrategy] = useState<AutoLayoutStrategy>("reset");
  const [showShortcutHints, setShowShortcutHints] = useState(false);
  const [canvasActionIssue, setCanvasActionIssue] = useState<AppIssue | null>(null);
  const [exportIssues, setExportIssues] = useState<AppIssue[]>([]);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showLabelsMenu, setShowLabelsMenu] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [showAutoLayoutMenu, setShowAutoLayoutMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showWorkspaceQuickMenu, setShowWorkspaceQuickMenu] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const labelsMenuRef = useRef<HTMLDivElement | null>(null);
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);
  const autoLayoutMenuRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceQuickMenuRef = useRef<HTMLDivElement | null>(null);
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
    setNodePosition,
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

  useEffect(() => {
    let mounted = true;
    loadAppPreferences().then((prefs) => {
      if (!mounted) return;
      setAppPreferences(prefs);
      setPerformanceMode(prefs.defaultPerformanceMode);
      if (!initialExportSettings.hasSaved) {
        setExportTransparentBg(prefs.defaultExportTransparentBg);
        setExportFileTemplate(prefs.defaultExportFileTemplate);
      }
    });
    return () => {
      mounted = false;
    };
  }, [initialExportSettings.hasSaved]);

  useEffect(() => {
    let isMounted = true;
    async function bootstrap() {
      const template = templateById(templateId) ?? (templateId ? await loadUserTemplateById(templateId) : undefined);
      if (template) {
        const nextDoc = {
          ...template.document,
          id: crypto.randomUUID(),
          updatedAt: Date.now(),
        };
        initialize(nextDoc);
        await upsertDocument(nextDoc);
        await setCurrentDocumentId(nextDoc.id);
        await saveRecentTemplate(template.id);
        if (isMounted) setHasHydrated(true);
        return;
      }

      if (docId) {
        const byId = await loadDocumentById(docId);
        if (byId) {
          initialize(byId);
          await setCurrentDocumentId(byId.id);
          if (isMounted) setHasHydrated(true);
          return;
        }
      }

      const current = await loadCurrentDocument();
      if (current) {
        initialize(current);
        await setCurrentDocumentId(current.id);
      } else {
        const newDoc = {
          ...blankDocument,
          style: { ...blankDocument.style, theme: appPreferences.defaultTheme },
          id: crypto.randomUUID(),
          updatedAt: Date.now(),
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
  }, [appPreferences.defaultTheme, docId, initialize, setHasHydrated, templateId]);

  useEffect(() => {
    if (!hasHydrated) return;
    const timer = window.setTimeout(async () => {
      await saveCurrentDocument(currentDoc);
      await saveRecentDocument(currentDoc);
      await upsertDocument(currentDoc);
      await setCurrentDocumentId(currentDoc.id);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [currentDoc, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated) return;
    let mounted = true;
    Promise.all([loadAllDocuments(), loadRecentTemplateIds(), loadUserTemplates()]).then(
      ([docs, templateIds, templates]) => {
        if (!mounted) return;
        setAllDocuments(docs);
        setRecentTemplateIds(templateIds);
        setUserTemplates(templates);
      },
    );
    return () => {
      mounted = false;
    };
  }, [currentDoc.id, currentDoc.updatedAt, hasHydrated]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", currentDoc.style.theme);
  }, [currentDoc.style.theme]);

  const allTemplates = useMemo(() => {
    return [...templateList, ...userTemplates];
  }, [userTemplates]);

  const libraryTemplateTagOptions = useMemo(() => {
    return [
      "all",
      ...new Set(
        allTemplates
          .flatMap((template) => template.tags ?? [])
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
  }, [allTemplates]);

  const filteredDocuments = useMemo(() => {
    const keyword = librarySearch.trim().toLowerCase();
    if (!keyword) return allDocuments;
    return allDocuments.filter((doc) => {
      const title = (doc.title || "Untitled Diagram").toLowerCase();
      return title.includes(keyword) || doc.format.toLowerCase().includes(keyword);
    });
  }, [allDocuments, librarySearch]);

  const recentTemplateIdSet = useMemo(() => {
    return new Set(recentTemplateIds);
  }, [recentTemplateIds]);

  const filteredTemplates = useMemo(() => {
    const keyword = librarySearch.trim().toLowerCase();
    const bySource = allTemplates.filter((template) => {
      if (libraryTemplateSourceMode === "all") return true;
      const isUserTemplate = template.id.startsWith("user-");
      return libraryTemplateSourceMode === "user" ? isUserTemplate : !isUserTemplate;
    });

    const byDifficulty =
      libraryTemplateDifficultyFilter === "all"
        ? bySource
        : bySource.filter((template) => template.difficulty === libraryTemplateDifficultyFilter);

    const byTag =
      libraryTemplateTagFilter === "all"
        ? byDifficulty
        : byDifficulty.filter((template) =>
            (template.tags ?? []).some(
              (tag) => tag.toLowerCase() === libraryTemplateTagFilter.toLowerCase(),
            ),
          );

    if (!keyword) return byTag;
    return byTag.filter((template) => {
      return (
        template.name.toLowerCase().includes(keyword) ||
        template.category.toLowerCase().includes(keyword) ||
        template.description.toLowerCase().includes(keyword) ||
        (template.tags ?? []).some((tag) => tag.toLowerCase().includes(keyword))
      );
    });
  }, [
    allTemplates,
    librarySearch,
    libraryTemplateDifficultyFilter,
    libraryTemplateSourceMode,
    libraryTemplateTagFilter,
  ]);

  const sortedFilteredTemplates = useMemo(() => {
    const rank = new Map(recentTemplateIds.map((id, index) => [id, index]));
    return [...filteredTemplates].sort((a, b) => {
      const rankA = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rankB = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.name.localeCompare(b.name);
    });
  }, [filteredTemplates, recentTemplateIds]);

  const selectableUserTemplateIds = useMemo(() => {
    return sortedFilteredTemplates
      .filter((template) => template.id.startsWith("user-"))
      .map((template) => template.id);
  }, [sortedFilteredTemplates]);

  const effectiveSelectedUserTemplateIds = useMemo(() => {
    const selectable = new Set(selectableUserTemplateIds);
    return selectedUserTemplateIds.filter((id) => selectable.has(id));
  }, [selectedUserTemplateIds, selectableUserTemplateIds]);

  const allVisibleUsersSelected =
    selectableUserTemplateIds.length > 0 &&
    selectableUserTemplateIds.every((id) => effectiveSelectedUserTemplateIds.includes(id));

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (fileMenuRef.current && !fileMenuRef.current.contains(target)) {
        setShowFileMenu(false);
      }
      if (viewMenuRef.current && !viewMenuRef.current.contains(target)) {
        setShowViewMenu(false);
      }
      if (labelsMenuRef.current && !labelsMenuRef.current.contains(target)) {
        setShowLabelsMenu(false);
      }
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(target)) {
        setShowLayoutMenu(false);
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
        (showFileMenu || showViewMenu || showLabelsMenu || showLayoutMenu || showAutoLayoutMenu || showExportMenu)
      ) {
        setShowFileMenu(false);
        setShowViewMenu(false);
        setShowLabelsMenu(false);
        setShowLayoutMenu(false);
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

      if (event.shiftKey && lower === "?" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setShowShortcutHints((value) => !value);
        return;
      }

      if (!editing && event.key === "Escape") {
        clearSelection();
        setCanvasActionIssue({
          id: `shortcut-escape-${Date.now()}`,
          level: "info",
          title: "Selection cleared",
          description: "閿熸枻鎷疯弫閿? Escape",
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
            description: "閿熸枻鎷疯弫閿? Ctrl/Cmd+A",
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
              description: "閿熸枻鎷疯弫閿? Ctrl/Cmd+Shift+L",
            });
            return;
          }
          const nextPositions = buildLayoutByStrategy(graph, currentDoc.style, autoLayoutStrategy);
          setNodePositions(nextPositions);
          setCanvasActionIssue({
            id: `shortcut-layout-${Date.now()}`,
            level: "success",
            title: `Applied auto-layout: ${AUTO_LAYOUT_STRATEGY_OPTIONS.find((item) => item.id === autoLayoutStrategy)?.label ?? autoLayoutStrategy}`,
            description: "閿熸枻鎷疯弫閿? Ctrl/Cmd+Shift+L",
          });
          return;
        }
        if (lower === "1") {
          event.preventDefault();
          setActiveTab("source");
          return;
        }
        if (lower === "2") {
          event.preventDefault();
          setActiveTab("editor");
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
          description: "閿熸枻鎷疯弫閿? Delete / Backspace",
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
    currentDoc.style,
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
    showLabelsMenu,
    showLayoutMenu,
    showViewMenu,
    leftWorkbenchVisible,
    undo,
  ]);

  useEffect(() => {
    window.localStorage.setItem(
      MAPPING_PRESETS_STORAGE_KEY,
      JSON.stringify(mappingPresets),
    );
  }, [mappingPresets]);

  useEffect(() => {
    window.localStorage.setItem(
      STYLE_PRESET_STORAGE_KEY,
      JSON.stringify(customStylePresets),
    );
  }, [customStylePresets]);

  useEffect(() => {
    void saveAppPreferences(appPreferences);
  }, [appPreferences]);

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

  const fileHint = useMemo(() => {
    return currentDoc.format === "json" ? "JSON: array or { links: [] }" : "CSV: source,target,value";
  }, [currentDoc.format]);

  const pastedJsonResult = useMemo(() => {
    if (!pastedJson.trim()) return null;
    return parseSankeyTextDetailed(pastedJson, "json");
  }, [pastedJson]);

  const sourceIssues = useMemo<AppIssue[]>(() => {
    const issues: AppIssue[] = [];
    if (sourceError) {
      issues.push({
        id: "source-error",
        level: "error",
        title: "Import issue",
        description: sourceError,
      });
    }
    if (sourceNotice) {
      issues.push({
        id: "source-notice",
        level: "success",
        title: "Import updated",
        description: sourceNotice,
      });
    }
    return issues;
  }, [sourceError, sourceNotice]);

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
  const exportSolidBackground = currentDoc.style.theme === "dark" ? EXPORT_BG_DARK : EXPORT_BG_LIGHT;

  const exportSvgString = useMemo(() => {
    if (!svgElement) return "";
    const cloned = svgElement.cloneNode(true) as SVGSVGElement;

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

    if (!exportTransparentBg) {
      const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      background.setAttribute("x", "0");
      background.setAttribute("y", "0");
      background.setAttribute("width", String(exportWidth));
      background.setAttribute("height", String(exportHeight));
      background.setAttribute("fill", exportSolidBackground);
      cloned.insertBefore(background, cloned.firstChild);
    }
    return new XMLSerializer().serializeToString(cloned);
  }, [
    exportSolidBackground,
    exportHeight,
    exportPadding,
    exportTransparentBg,
    exportWidth,
    svgElement,
  ]);

  const filteredSortedRows = useMemo(() => {
    if (!sourcePreview) return [];
    const keyword = sourceFilter.trim().toLowerCase();

    let rows = sourcePreview.rows;
    if (keyword) {
      rows = rows.filter((row) =>
        sourcePreview.headers.some((header) =>
          String(row[header] ?? "").toLowerCase().includes(keyword),
        ),
      );
    }

    const sortKey = sourceSortKey || sourcePreview.headers[0];
    if (!sortKey) return rows;

    const sorted = [...rows].sort((a, b) => {
      const av = String(a[sortKey] ?? "");
      const bv = String(b[sortKey] ?? "");
      const an = Number(av);
      const bn = Number(bv);
      const numeric = Number.isFinite(an) && Number.isFinite(bn);
      if (numeric) {
        return sourceSortDir === "asc" ? an - bn : bn - an;
      }
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return sourceSortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [sourceFilter, sourcePreview, sourceSortDir, sourceSortKey]);

  const paginatedRows = useMemo(() => {
    if (!sourcePreview) return [];
    const start = (sourcePage - 1) * sourcePageSize;
    return filteredSortedRows.slice(start, start + sourcePageSize);
  }, [filteredSortedRows, sourcePage, sourcePageSize, sourcePreview]);

  const totalSourcePages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredSortedRows.length / sourcePageSize));
  }, [filteredSortedRows.length, sourcePageSize]);

  const allStylePresets = useMemo(
    () => [...DEFAULT_STYLE_PRESETS, ...customStylePresets],
    [customStylePresets],
  );
  const mappingPresetsForMode = useMemo(
    () => mappingPresets.filter((item) => item.mode === sourcePreviewMode),
    [mappingPresets, sourcePreviewMode],
  );

  const sourceMappingIssues = useMemo(() => {
    if (!sourcePreview) return [] as string[];
    const issues: string[] = [];
    const headers = new Set(sourcePreview.headers);
    const { source, target, value } = sourcePreview.mapping;

    if (!source || !headers.has(source)) {
      issues.push('Source column "' + (source || '(empty)') + '" is missing in current data.');
    }
    if (!target || !headers.has(target)) {
      issues.push('Target column "' + (target || '(empty)') + '" is missing in current data.');
    }
    if (!value || !headers.has(value)) {
      issues.push('Value column "' + (value || '(empty)') + '" is missing in current data.');
    }
    if (new Set([source, target, value]).size < 3) {
      issues.push('Source, target, and value should map to three different columns.');
    }

    return issues;
  }, [sourcePreview]);

  const mappingTransformPreview = useMemo(() => {
    if (!sourcePreview) return null;
    if (sourceMappingIssues.length > 0) return null;
    return transformRowsToCanonicalLinks(sourcePreview.rows, sourcePreview.mapping, {
      valuePolicy,
      minValue: valueMinWhenClamped,
    });
  }, [sourcePreview, sourceMappingIssues, valuePolicy, valueMinWhenClamped]);

  const canApplyMapping =
    mappingTransformPreview != null && mappingTransformPreview.stats.outputRows > 0;


  const presetCompatibilityById = useMemo(() => {
    const status = new Map<string, { ok: boolean; reason: string }>();
    if (!sourcePreview) return status;
    const headers = new Set(sourcePreview.headers);

    mappingPresetsForMode.forEach((preset) => {
      const missing = [preset.mapping.source, preset.mapping.target, preset.mapping.value].filter(
        (column) => !headers.has(column),
      );
      if (missing.length > 0) {
        status.set(preset.id, { ok: false, reason: 'Missing columns: ' + missing.join(', ') });
        return;
      }
      status.set(preset.id, { ok: true, reason: '' });
    });

    return status;
  }, [mappingPresetsForMode, sourcePreview]);

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

  const applyAutoLayoutStrategy = (strategy: AutoLayoutStrategy, source: "toolbar" | "shortcut" = "toolbar") => {
    if (strategy === "reset") {
      clearNodePositions();
      pushCanvasActionIssue(
        "success",
        "Applied auto-layout: Default",
        source === "shortcut" ? "閿熸枻鎷疯弫閿? Ctrl/Cmd+Shift+L" : "Reset to default d3-sankey layout",
      );
      return;
    }
    const nextPositions = buildLayoutByStrategy(graph, currentDoc.style, strategy);
    setNodePositions(nextPositions);
    const label = AUTO_LAYOUT_STRATEGY_OPTIONS.find((item) => item.id === strategy)?.label ?? strategy;
    pushCanvasActionIssue(
      "success",
      `Applied auto-layout: ${label}`,
      source === "shortcut" ? "閿熸枻鎷疯弫閿? Ctrl/Cmd+Shift+L" : `${graph.nodes.length} nodes updated`,
    );
  };

  const clearSelectionWithNotice = () => {
    if (selectedNodeIds.length === 0 && selectedLinkIndex == null) return;
    clearSelection();
    pushCanvasActionIssue("info", "Selection cleared");
  };

  const saveCurrentStylePreset = async () => {
    const candidate = newStylePresetName.trim() || `${currentDoc.title || "Untitled"} Style`;
    const existing = customStylePresets.find(
      (preset) => preset.name.toLowerCase() === candidate.toLowerCase(),
    );

    if (existing) {
      const overwrite = await confirm({
        title: "Overwrite style preset?",
        message: `Preset "${candidate}" already exists.`,
        confirmLabel: "Overwrite",
      });
      if (!overwrite) return;
    }

    const preset: StylePreset = {
      id: existing?.id ?? `style-${crypto.randomUUID()}`,
      name: candidate,
      style: { ...currentDoc.style },
    };

    setCustomStylePresets((prev) => [preset, ...prev.filter((item) => item.id !== preset.id)]);
    setNewStylePresetName("");
    pushCanvasActionIssue("success", `Saved style preset: ${candidate}`);
  };

  const applyStylePreset = (preset: StylePreset) => {
    patchStyle({ ...preset.style });
    pushCanvasActionIssue("success", `Applied style preset: ${preset.name}`);
  };

  const removeStylePreset = async (presetId: string) => {
    const target = customStylePresets.find((preset) => preset.id === presetId);
    if (!target) return;
    const confirmed = await confirm({
      title: "Delete style preset?",
      message: `This action cannot be undone. Delete "${target.name}"?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    setCustomStylePresets((prev) => prev.filter((preset) => preset.id !== presetId));
    pushCanvasActionIssue("warning", `Deleted style preset: ${target.name}`);
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
      : `margin:0;background:${exportSolidBackground};display:flex;justify-content:center;align-items:center;min-height:100vh;`;
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
        if (!exportTransparentBg) {
          context.fillStyle = exportSolidBackground;
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
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

  const applyUploadedFile = async (file: File) => {
    const detected = detectFileFormat(file.name);
    if (!detected) {
      setSourceError("Only CSV, JSON, XLSX are supported.");
      return;
    }

    setSourceError("");
    setSourceNotice("");
    setSourceFileName(file.name);

    if (detected === "json") {
      const text = await file.text();
      const preview = parseJsonPreview(text);
      setSourcePreview(preview);
      setSourcePreviewMode("json");
      setSourceSortKey(preview.headers[0] ?? "");
      setSourceSortDir("asc");
      setSourceFilter("");
      setSourcePage(1);
      setPastedJson(text);
      setActiveTab("source");
      return;
    }

    if (detected === "csv") {
      const text = await file.text();
      const preview = parseCsvPreview(text);
      setSourcePreview(preview);
      setSourcePreviewMode("csv");
      setSourceSortKey(preview.headers[0] ?? "");
      setSourceSortDir("asc");
      setSourceFilter("");
      setSourcePage(1);
      return;
    }

    const buffer = await file.arrayBuffer();
    const preview = parseXlsxPreview(buffer);
    setSourcePreview(preview);
    setSourcePreviewMode("csv");
    setSourceSortKey(preview.headers[0] ?? "");
    setSourceSortDir("asc");
    setSourceFilter("");
    setSourcePage(1);
  };

  const onFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await applyUploadedFile(file);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Failed to parse file");
    }
  };

  const onDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    try {
      await applyUploadedFile(file);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Failed to parse file");
    }
  };

  const applyMappingToEditor = () => {
    if (!sourcePreview) return;
    if (sourceMappingIssues.length > 0) {
      setSourceError(sourceMappingIssues[0]);
      return;
    }
    if (!mappingTransformPreview || mappingTransformPreview.stats.outputRows === 0) {
      setSourceError("No valid rows left after applying import policy.");
      return;
    }

    const transformed = mappingTransformPreview;
    const text =
      sourcePreviewMode === "json"
        ? linksToCanonicalJson(transformed.links)
        : linksToCanonicalCsv(transformed.links);

    setSourceError("");
    setSourceNotice(
      `Imported ${transformed.stats.outputRows}/${transformed.stats.totalRows} rows` +
        (transformed.stats.droppedRows > 0
          ? `, dropped ${transformed.stats.droppedRows}`
          : "") +
        (transformed.stats.clampedRows > 0
          ? `, clamped ${transformed.stats.clampedRows}`
          : ""),
    );
    clearNodePositions();
    setFormat(sourcePreviewMode === "json" ? "json" : "csv");
    setEditorText(text);
    setActiveTab("editor");
  };

  const updateSourceMapping = (key: keyof TableMapping, value: string) => {
    if (!sourcePreview) return;
    setSourcePreview({
      ...sourcePreview,
      mapping: { ...sourcePreview.mapping, [key]: value },
    });
    setSourceError("");
    setSourceNotice("");
  };

  const saveMappingPreset = async () => {
    if (!sourcePreview) return;
    if (sourceMappingIssues.length > 0) {
      setSourceError(sourceMappingIssues[0]);
      return;
    }
    const suggested = `${sourcePreviewMode.toUpperCase()} Mapping`;
    const entered = await prompt({
      title: "Save mapping preset",
      message: "Enter preset name",
      defaultValue: suggested,
      confirmLabel: "Save",
    });
    const name = entered?.trim();
    if (!name) return;
    const existing = mappingPresets.find(
      (item) =>
        item.mode === sourcePreviewMode &&
        item.name.toLowerCase() === name.toLowerCase(),
    );
    let id = `map-${crypto.randomUUID()}`;
    if (existing) {
      const overwrite = await confirm({
        title: "Overwrite mapping preset?",
        message: `Preset "${name}" already exists.`,
        confirmLabel: "Overwrite",
      });
      if (!overwrite) return;
      id = existing.id;
    }
    const preset: MappingPreset = {
      id,
      name,
      mode: sourcePreviewMode,
      mapping: sourcePreview.mapping,
      createdAt: Date.now(),
    };
    setMappingPresets((prev) => [preset, ...prev.filter((item) => item.id !== preset.id)]);
  };

  const applyMappingPreset = (presetId: string) => {
    if (!sourcePreview) return;
    const preset = mappingPresets.find((item) => item.id === presetId);
    if (!preset) return;
    if (preset.mode !== sourcePreviewMode) {
      setSourceError("Preset mode does not match current preview mode.");
      return;
    }
    const headers = new Set(sourcePreview.headers);
    const valid =
      headers.has(preset.mapping.source) &&
      headers.has(preset.mapping.target) &&
      headers.has(preset.mapping.value);
    if (!valid) {
      setSourceError("Preset columns are not present in current data headers.");
      return;
    }
    setSourceError("");
    setSourceNotice(`Applied mapping preset: ${preset.name}`);
    setSourcePreview({ ...sourcePreview, mapping: preset.mapping });
  };

  const removeMappingPreset = (presetId: string) => {
    setMappingPresets((prev) => prev.filter((item) => item.id !== presetId));
  };

  const previewPastedCsv = () => {
    if (!pastedCsv.trim()) {
      setSourceError("Paste CSV content before preview.");
      return;
    }
    try {
      const preview = parseCsvPreview(pastedCsv);
      setSourceError("");
      setSourceNotice("");
      setSourceFileName("Pasted CSV");
      setSourcePreview(preview);
      setSourcePreviewMode("csv");
      setSourceSortKey(preview.headers[0] ?? "");
      setSourceSortDir("asc");
      setSourceFilter("");
      setSourcePage(1);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Failed to parse pasted CSV");
    }
  };

  const previewPastedJson = () => {
    if (!pastedJson.trim()) {
      setSourceError("Paste JSON content before preview.");
      return;
    }
    try {
      const preview = parseJsonPreview(pastedJson);
      setSourceError("");
      setSourceNotice("");
      setSourceFileName("Pasted JSON");
      setSourcePreview(preview);
      setSourcePreviewMode("json");
      setSourceSortKey(preview.headers[0] ?? "");
      setSourceSortDir("asc");
      setSourceFilter("");
      setSourcePage(1);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Failed to parse pasted JSON");
    }
  };

  const applyPastedJsonToEditor = () => {
    if (!pastedJsonResult || !pastedJsonResult.ok) {
      setSourceError("JSON is invalid. Fix errors before applying.");
      return;
    }
    setSourceError("");
    setSourceNotice("");
    setSourceFileName("Pasted JSON");
    clearNodePositions();
    if (sourcePreview && sourcePreviewMode === "json") {
      const mappedJson = rowsToCanonicalJson(sourcePreview.rows, sourcePreview.mapping);
      setFormat("json");
      setEditorText(mappedJson);
    } else {
      setFormat("json");
      setEditorText(pastedJson);
    }
    setActiveTab("editor");
  };

  const toggleSortBy = (header: string) => {
    if (sourceSortKey === header) {
      setSourceSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSourceSortKey(header);
    setSourceSortDir("asc");
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
    const newDoc: SankeyDocument = {
      ...blankDocument,
      style: { ...blankDocument.style, theme: appPreferences.defaultTheme },
      id: crypto.randomUUID(),
      title: "Untitled Diagram",
      updatedAt: Date.now(),
    };
    initialize(newDoc);
    await upsertDocument(newDoc);
    await setCurrentDocumentId(newDoc.id);
    setShowDocuments(false);
    router.replace(`/editor?doc=${encodeURIComponent(newDoc.id)}`);
  };

  const saveAsCopy = async () => {
    const copy: SankeyDocument = {
      ...currentDoc,
      id: crypto.randomUUID(),
      title: `${currentDoc.title || "Untitled"} Copy`,
      updatedAt: Date.now(),
    };
    initialize(copy);
    await upsertDocument(copy);
    await setCurrentDocumentId(copy.id);
    router.replace(`/editor?doc=${encodeURIComponent(copy.id)}`);
  };

  const saveAsTemplate = async () => {
    const suggested = `${currentDoc.title || "Untitled"} Template`;
    const nameInput = await prompt({
      title: "Template name",
      defaultValue: suggested,
      confirmLabel: "Next",
    });
    const name = nameInput?.trim();
    if (!name) return;

    const descriptionInput = await prompt({
      title: "Template description",
      defaultValue: "Custom template from current document",
      confirmLabel: "Next",
    });
    if (descriptionInput == null) return;
    const description = descriptionInput.trim() || "Custom template from current document";

    const categoryInput = await prompt({
      title: "Template category",
      defaultValue: "Custom",
      confirmLabel: "Next",
    });
    if (categoryInput == null) return;
    const category = categoryInput.trim() || "Custom";

    const tagsInput = await prompt({
      title: "Template tags",
      message: "Comma separated",
      defaultValue: "custom",
      confirmLabel: "Save",
    });
    if (tagsInput == null) return;

    const tags = Array.from(
      new Set(
        tagsInput
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),
    );

    const existingTemplates = await loadUserTemplates();
    const existing = existingTemplates.find(
      (item) => item.id.startsWith("user-") && item.name.toLowerCase() === name.toLowerCase(),
    );
    let templateId = `user-${crypto.randomUUID()}`;
    if (existing) {
      const overwrite = await confirm({
        title: "Overwrite template?",
        message: `A template named "${name}" already exists.`,
        confirmLabel: "Overwrite",
      });
      if (!overwrite) return;
      templateId = existing.id;
    }

    const template: TemplateSummary = {
      id: templateId,
      name,
      category,
      difficulty: "Medium",
      description,
      tags: tags.length > 0 ? tags : undefined,
      accent: USER_TEMPLATE_ACCENTS[Math.floor(Math.random() * USER_TEMPLATE_ACCENTS.length)],
      document: {
        title: currentDoc.title || "Untitled Diagram",
        format: currentDoc.format,
        editorText: currentDoc.editorText,
        style: { ...currentDoc.style },
        nodePositions: { ...currentDoc.nodePositions },
        nodeStyles: { ...currentDoc.nodeStyles },
        linkStyles: { ...currentDoc.linkStyles },
      },
    };
    await upsertUserTemplate(template);
    await saveRecentTemplate(template.id);
    const [templateIds, templates] = await Promise.all([
      loadRecentTemplateIds(),
      loadUserTemplates(),
    ]);
    setRecentTemplateIds(templateIds);
    setUserTemplates(templates);
    setLibraryTab("templates");
    setShowDocuments(true);
  };

  const applyTemplateFromLibrary = async (nextTemplateId: string) => {
    setShowDocuments(false);
    await saveRecentTemplate(nextTemplateId);
    setRecentTemplateIds(await loadRecentTemplateIds());
    router.replace(`/editor?template=${encodeURIComponent(nextTemplateId)}`);
  };

  const deleteTemplateFromLibrary = async (templateId: string) => {
    const confirmed = await confirm({
      title: "Delete template?",
      message: "This action cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    await deleteUserTemplate(templateId);
    const [templateIds, templates] = await Promise.all([
      loadRecentTemplateIds(),
      loadUserTemplates(),
    ]);
    setRecentTemplateIds(templateIds);
    setUserTemplates(templates);
    setSelectedUserTemplateIds((previous) => previous.filter((id) => id !== templateId));
  };

  const toggleSelectAllVisibleUsers = () => {
    if (allVisibleUsersSelected) {
      setSelectedUserTemplateIds((previous) =>
        previous.filter((id) => !selectableUserTemplateIds.includes(id)),
      );
      return;
    }
    setSelectedUserTemplateIds((previous) => {
      const next = new Set(previous);
      selectableUserTemplateIds.forEach((id) => next.add(id));
      return [...next];
    });
  };

  const removeSelectedUserTemplates = async () => {
    if (effectiveSelectedUserTemplateIds.length === 0) return;
    const confirmed = await confirm({
      title: "Delete selected templates?",
      message: `This action cannot be undone. Delete ${effectiveSelectedUserTemplateIds.length} selected template(s)?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    await deleteUserTemplates(effectiveSelectedUserTemplateIds);
    const [templateIds, templates] = await Promise.all([
      loadRecentTemplateIds(),
      loadUserTemplates(),
    ]);
    setRecentTemplateIds(templateIds);
    setUserTemplates(templates);
    setSelectedUserTemplateIds([]);
  };

  const clearRecentTemplatesFromLibrary = async () => {
    if (recentTemplateIds.length === 0) return;
    const confirmed = await confirm({
      title: "Clear recent template history?",
      message: "Only the recent history will be removed. Template files remain unchanged.",
      confirmLabel: "Clear",
      tone: "danger",
    });
    if (!confirmed) return;
    await clearRecentTemplateIds();
    setRecentTemplateIds([]);
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

  const isDarkTheme = currentDoc.style.theme === "dark";
  const workspaceClass =
    "hero-gradient relative flex h-screen flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]";
  const headerClass =
    "glass relative z-[90] flex h-14 items-center justify-between border-b border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-secondary)_92%,transparent)] px-4 backdrop-blur";
  const leftPanelClass =
    "glass absolute left-0 top-0 z-[120] flex h-full flex-col border-r border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-secondary)_94%,transparent)] shadow-xl transition-transform duration-220 ease-out";
  const canvasContainerClass =
    "relative min-w-0 flex-1 bg-[radial-gradient(circle_at_20%_20%,color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)_0%,var(--bg-secondary)_60%)] p-6";
  const controlButtonClass =
    "inline-flex items-center gap-1 rounded-lg border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_84%,transparent)] px-2 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]";
  const controlButtonWideClass =
    "inline-flex items-center gap-1 rounded-lg border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_84%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]";
  const documentPopoverClass =
    "glass absolute left-4 top-16 z-40 w-96 rounded-xl border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_96%,transparent)] p-3 shadow-xl";
  const rightPanelFieldCompactClass =
    "mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-[11px] text-slate-100";
  const rightPanelCardClass =
    "mt-2 rounded-lg border border-slate-600 bg-slate-900 p-2";
  const rightPanelInlineFieldClass =
    "h-8 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 text-xs text-slate-100";
  const rightPanelActionButtonSmallClass =
    "rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800";
  const libraryActionButtonClass = buttonSecondaryTiny;
  const libraryActionButtonDisabledClass = withDisabled(buttonSecondaryTiny);
  const libraryDangerButtonClass = buttonDangerSoftTiny;
  const libraryDangerButtonDisabledClass = withDisabled(buttonDangerSoftTiny);
  const sourcePrimaryActionClass = withDisabled(`w-full ${buttonPrimarySm}`);
  const libraryEmptyStateClass = "rounded-lg border border-dashed border-slate-600 bg-slate-900 px-2 py-3 text-center text-xs text-slate-400";
  const clearRecentDisabledReason = "No recent template history to clear.";
  const deleteSelectedDisabledReason = "Select at least one custom template first.";
  const isNarrowViewport = viewportWidth < 1200;
  const leftWorkbenchWidth = leftWorkbenchMode === "expanded" ? 420 : 320;
  const headerMenuClass =
    "absolute right-0 top-10 z-[140] min-w-[180px] rounded-xl border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_97%,transparent)] p-1 shadow-xl";
  const headerMenuItemClass =
    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]";
  const headerMenuItemActiveClass =
    "flex w-full items-center gap-2 rounded-lg bg-[var(--primary-subtle)] px-2 py-1.5 text-left text-xs font-semibold text-[var(--primary-text)] hover:bg-[color:color-mix(in_srgb,var(--primary)_20%,transparent)]";
  const floatingIconButtonClass =
    "pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_94%,transparent)] text-[var(--text-secondary)] shadow-lg backdrop-blur hover:bg-[var(--bg-tertiary)]";
  const themeToggleButtonClass =
    "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_90%,transparent)] text-[var(--text-secondary)] shadow hover:bg-[var(--bg-tertiary)]";

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


  if (!hasHydrated) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading editor...</div>;
  }

  return (
    <div className={workspaceClass}>
      <header className={headerClass}>
        <div className="flex items-center gap-3">
          <LayoutTemplate className="h-5 w-5 text-blue-600" />
          <input
            value={currentDoc.title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-72 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold outline-none transition focus:border-[var(--primary)] focus:bg-[var(--bg-tertiary)]"
          />
          <div className="ml-2 flex items-center gap-1">
            <div className="relative" ref={fileMenuRef}>
              <button
                onClick={() => {
                  setShowFileMenu((value) => !value);
                  setShowViewMenu(false);
                  setShowLabelsMenu(false);
                  setShowLayoutMenu(false);
                  setShowAutoLayoutMenu(false);
                  setShowExportMenu(false);
                }}
                className={controlButtonClass}
              >
                File
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {showFileMenu && (
                <div className={headerMenuClass}>
                  <button onClick={() => { router.push("/"); setShowFileMenu(false); }} className={headerMenuItemClass}>Home</button>
                  <button onClick={() => { setShowDocuments((value) => !value); setShowFileMenu(false); }} className={headerMenuItemClass}>Docs</button>
                  <button onClick={() => { createNewDocument(); setShowFileMenu(false); }} className={headerMenuItemClass}>New Document</button>
                  <button onClick={() => { saveAsCopy(); setShowFileMenu(false); }} className={headerMenuItemClass}>
                    <CopyPlus className="h-3.5 w-3.5" />Save As
                  </button>
                  <button onClick={() => { void saveAsTemplate(); setShowFileMenu(false); }} className={headerMenuItemClass}>
                    <LayoutTemplate className="h-3.5 w-3.5" />Save as Template
                  </button>
                  <button onClick={() => { void deleteCurrentDocument(); setShowFileMenu(false); }} className={headerMenuItemClass}>Delete Current</button>
                </div>
              )}
            </div>
            <div className="relative" ref={viewMenuRef}>
              <button
                onClick={() => {
                  setShowViewMenu((value) => !value);
                  setShowFileMenu(false);
                  setShowLabelsMenu(false);
                  setShowLayoutMenu(false);
                  setShowAutoLayoutMenu(false);
                  setShowExportMenu(false);
                }}
                className={controlButtonClass}
              >
                View
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {showViewMenu && (
                <div className={headerMenuClass}>
                  <button onClick={() => { undo(); setShowViewMenu(false); }} disabled={historyPast.length === 0} className={headerMenuItemClass}><Undo2 className="h-3.5 w-3.5" />Undo</button>
                  <button onClick={() => { redo(); setShowViewMenu(false); }} disabled={historyFuture.length === 0} className={headerMenuItemClass}><Redo2 className="h-3.5 w-3.5" />Redo</button>
                  <button onClick={() => { syncFromEditor(); setShowViewMenu(false); }} className={headerMenuItemClass}><Play className="h-3.5 w-3.5" />Sync</button>
                  <button onClick={() => { setCanvasResetKey((value) => value + 1); setShowViewMenu(false); }} className={headerMenuItemClass}>Fit Canvas</button>
                  <button onClick={() => { setCanvasResetKey((value) => value + 1); clearSelection(); setTraceMode("none"); setShowViewMenu(false); }} className={headerMenuItemClass}>Reset View</button>
                  <button onClick={() => { toggleLeftWorkbench(); setShowViewMenu(false); }} className={headerMenuItemClass}>{leftWorkbenchVisible ? "Hide Workbench" : "Show Workbench"}</button>
                  <button onClick={() => { setShowShortcutHints((value) => !value); }} className={headerMenuItemClass}>{showShortcutHints ? "Hide" : "Show"} Shortcut Hints</button>
                  <div className="px-2 py-1 text-[11px] text-[var(--text-tertiary)]">Hold Space to Pan</div>
                </div>
              )}
            </div>
            <div className="relative" ref={labelsMenuRef}>
              <button
                onClick={() => {
                  setShowLabelsMenu((value) => !value);
                  setShowFileMenu(false);
                  setShowViewMenu(false);
                  setShowLayoutMenu(false);
                  setShowAutoLayoutMenu(false);
                  setShowExportMenu(false);
                }}
                className={controlButtonClass}
              >
                Labels
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {showLabelsMenu && (
                <div className={`${headerMenuClass} max-h-[60vh] min-w-[240px] overflow-y-auto`}>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">
                    <input type="checkbox" checked={currentDoc.style.showLabels} onChange={(event) => patchStyle({ showLabels: event.target.checked })} className="mr-2" />
                    Show Labels
                  </label>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">
                    Position
                    <select value={currentDoc.style.labelPosition} onChange={(event) => patchStyle({ labelPosition: event.target.value as "inside" | "outside" })} className={rightPanelFieldCompactClass}>
                      <option value="outside">Outside</option>
                      <option value="inside">Inside</option>
                    </select>
                  </label>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">
                    Font Size
                    <input type="range" min={10} max={24} value={currentDoc.style.labelFontSize} onChange={(event) => patchStyle({ labelFontSize: Number(event.target.value) })} className="mt-1 w-full" />
                  </label>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">
                    Font Family
                    <select value={currentDoc.style.labelFontFamily} onChange={(event) => patchStyle({ labelFontFamily: event.target.value as "Roboto" | "Google Sans" | "System Sans" })} className={rightPanelFieldCompactClass}>
                      <option value="Google Sans">Google Sans</option>
                      <option value="Roboto">Roboto</option>
                      <option value="System Sans">System Sans</option>
                    </select>
                  </label>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">
                    Label Color
                    <input type="color" value={currentDoc.style.labelColor} onChange={(event) => patchStyle({ labelColor: event.target.value })} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1" />
                  </label>
                </div>
              )}
            </div>
            <div className="relative" ref={layoutMenuRef}>
              <button
                onClick={() => {
                  setShowLayoutMenu((value) => !value);
                  setShowFileMenu(false);
                  setShowViewMenu(false);
                  setShowLabelsMenu(false);
                  setShowAutoLayoutMenu(false);
                  setShowExportMenu(false);
                }}
                className={controlButtonClass}
              >
                Layout
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {showLayoutMenu && (
                <div className={`${headerMenuClass} max-h-[70vh] min-w-[280px] overflow-y-auto`}>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">Palette
                    <select value={currentDoc.style.palette} onChange={(event) => patchStyle({ palette: event.target.value as "classic" | "ocean" | "sunset" })} className={rightPanelFieldCompactClass}>
                      <option value="classic">Classic</option>
                      <option value="ocean">Ocean</option>
                      <option value="sunset">Sunset</option>
                    </select>
                  </label>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">Node Width
                    <input type="range" min={8} max={42} value={currentDoc.style.nodeWidth} onChange={(event) => patchStyle({ nodeWidth: Number(event.target.value) })} className="mt-1 w-full" />
                  </label>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">Node Padding
                    <input type="range" min={4} max={50} value={currentDoc.style.nodePadding} onChange={(event) => patchStyle({ nodePadding: Number(event.target.value) })} className="mt-1 w-full" />
                  </label>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">Node Radius
                    <input type="range" min={0} max={24} value={currentDoc.style.nodeRadius} onChange={(event) => patchStyle({ nodeRadius: Number(event.target.value) })} className="mt-1 w-full" />
                  </label>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">Link Opacity
                    <input type="range" min={5} max={100} value={Math.round(currentDoc.style.linkOpacity * 100)} onChange={(event) => patchStyle({ linkOpacity: Number(event.target.value) / 100 })} className="mt-1 w-full" />
                  </label>
                  <label className="block px-2 py-1 text-xs text-[var(--text-secondary)]">Curvature
                    <input type="range" min={0.15} max={0.85} step={0.01} value={currentDoc.style.curvature} onChange={(event) => patchStyle({ curvature: Number(event.target.value) })} className="mt-1 w-full" />
                  </label>
                  <div className="mt-1 border-t border-[var(--border-base)] p-2">
                    <p className="mb-1 text-[11px] font-semibold text-[var(--text-secondary)]">Trace</p>
                    <div className="grid grid-cols-3 gap-1">
                      <button onClick={() => setTraceMode("none")} className={traceMode === "none" ? headerMenuItemActiveClass : headerMenuItemClass}>None</button>
                      <button onClick={() => setTraceMode("upstream")} className={traceMode === "upstream" ? headerMenuItemActiveClass : headerMenuItemClass}>Upstream</button>
                      <button onClick={() => setTraceMode("downstream")} className={traceMode === "downstream" ? headerMenuItemActiveClass : headerMenuItemClass}>Downstream</button>
                    </div>
                    <button onClick={clearSelectionWithNotice} className={`mt-2 w-full ${headerMenuItemClass}`}>Clear Selection</button>
                  </div>
                  <div className="mt-1 border-t border-[var(--border-base)] p-2">
                    <p className="mb-1 text-[11px] font-semibold text-[var(--text-secondary)]">Style Presets</p>
                    <input value={newStylePresetName} onChange={(event) => setNewStylePresetName(event.target.value)} placeholder="Preset name" className={rightPanelInlineFieldClass} />
                    <button onClick={() => void saveCurrentStylePreset()} className={`mt-1 w-full ${rightPanelActionButtonSmallClass}`}>Save Current</button>
                    <div className="mt-2 space-y-1">
                      {allStylePresets.map((preset) => (
                        <div key={preset.id} className="flex items-center gap-1">
                          <button onClick={() => applyStylePreset(preset)} className={`${rightPanelActionButtonSmallClass} flex-1 text-left`}>{preset.name}</button>
                          {!preset.builtIn && (
                            <button onClick={() => void removeStylePreset(preset.id)} className={headerMenuItemClass}>Delete</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-[var(--text-tertiary)]">{Math.round(zoomLevel * 100)}%</div>
          <div className="relative" ref={autoLayoutMenuRef}>
            <button
              onClick={() => {
                setShowAutoLayoutMenu((value) => !value);
                setShowFileMenu(false);
                setShowViewMenu(false);
                setShowLabelsMenu(false);
                setShowLayoutMenu(false);
                setShowExportMenu(false);
              }}
              className={controlButtonWideClass}
              title="Auto-layout options"
            >
              <WandSparkles className="h-3.5 w-3.5" />
              Auto-layout
              <ChevronDown className="h-3.5 w-3.5" />
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
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs ${
                      autoLayoutStrategy === item.id
                        ? "bg-[var(--primary-subtle)] text-[var(--primary-text)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                    }`}
                  >
                    <span>{item.label}</span>
                    {autoLayoutStrategy === item.id && <span>Current</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => {
                setShowExportMenu((value) => !value);
                setShowFileMenu(false);
                setShowViewMenu(false);
                setShowLabelsMenu(false);
                setShowLayoutMenu(false);
                setShowAutoLayoutMenu(false);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-[color:color-mix(in_srgb,var(--primary)_45%,transparent)] bg-gradient-to-r from-[var(--primary)] to-[var(--flow-5)] px-3 py-1.5 text-xs font-semibold text-[var(--text-on-primary)] shadow"
              title="Export options"
            >
              <Download className="h-3.5 w-3.5" />
              Export
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {showExportMenu && (
              <div className={`${headerMenuClass} max-h-[70vh] min-w-[280px] overflow-y-auto`}>
                <button onClick={() => { runExportSvg(); setShowExportMenu(false); }} className={headerMenuItemClass}>Export SVG</button>
                <button onClick={() => { void runExportPng(); setShowExportMenu(false); }} className={headerMenuItemClass}>Export PNG</button>
                <button onClick={() => { runExportHtml(); setShowExportMenu(false); }} className={headerMenuItemClass}>Export HTML</button>
                <button onClick={() => { void runExportAll(); setShowExportMenu(false); }} className={`mt-1 ${headerMenuItemActiveClass}`}>Export All</button>
                <div className="mt-2 border-t border-[var(--border-base)] p-2 text-xs text-[var(--text-secondary)]">
                  <label className="mb-1 block">Width<input type="number" value={exportWidth} onChange={(event) => setExportWidth(Number(event.target.value) || 1200)} className={rightPanelFieldCompactClass} /></label>
                  <label className="mb-1 block">Height<input type="number" value={exportHeight} onChange={(event) => setExportHeight(Number(event.target.value) || 700)} className={rightPanelFieldCompactClass} /></label>
                  <label className="mb-1 block">Padding<input type="number" value={exportPadding} onChange={(event) => setExportPadding(Math.max(0, Number(event.target.value) || 0))} className={rightPanelFieldCompactClass} /></label>
                  <label className="mb-1 block">PNG Scale<input type="number" min={1} max={4} value={exportPngScale} onChange={(event) => setExportPngScale(Number(event.target.value))} className={rightPanelFieldCompactClass} /></label>
                  <label className="mb-1 block">File Template<input value={exportFileTemplate} onChange={(event) => setExportFileTemplate(event.target.value)} className={rightPanelFieldCompactClass} /></label>
                  <label className="mt-1 inline-flex items-center gap-2"><input type="checkbox" checked={exportTransparentBg} onChange={(event) => setExportTransparentBg(event.target.checked)} />Transparent</label>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              const nextTheme = currentDoc.style.theme === "dark" ? "light" : "dark";
              const currentDefault =
                currentDoc.style.theme === "dark" ? DARK_LABEL_COLOR : LIGHT_LABEL_COLOR;
              const nextDefault = nextTheme === "dark" ? DARK_LABEL_COLOR : LIGHT_LABEL_COLOR;
              const nextLabelColor =
                currentDoc.style.labelColor === currentDefault ? nextDefault : currentDoc.style.labelColor;
              patchStyle({ theme: nextTheme, labelColor: nextLabelColor });
            }}
            className={themeToggleButtonClass}
            title={currentDoc.style.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            aria-label={currentDoc.style.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {currentDoc.style.theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {showDocuments && (
        <div className={documentPopoverClass}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="grid grid-cols-2 rounded-lg border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-secondary)_90%,transparent)] p-1 text-[11px]">
              <button
                onClick={() => setLibraryTab("documents")}
                className={`rounded-md px-2 py-1 font-medium ${
                  libraryTab === "documents"
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)] shadow"
                    : "text-[var(--text-tertiary)]"
                }`}
              >
                Documents
              </button>
              <button
                onClick={() => setLibraryTab("templates")}
                className={`rounded-md px-2 py-1 font-medium ${
                  libraryTab === "templates"
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)] shadow"
                    : "text-[var(--text-tertiary)]"
                }`}
              >
                Templates
              </button>
            </div>
            {libraryTab === "documents" ? (
              <button
                onClick={deleteCurrentDocument}
                className={libraryDangerButtonClass}
              >
                Delete Current
              </button>
            ) : (
              <button
                onClick={() => void saveAsTemplate()}
                className={libraryActionButtonClass}
              >
                Save Current as Template
              </button>
            )}
          </div>
          <input
            value={librarySearch}
            onChange={(event) => setLibrarySearch(event.target.value)}
            placeholder={libraryTab === "documents" ? "Search documents" : "Search templates"}
            className="mb-2 w-full rounded-md border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_95%,transparent)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
          />
          {libraryTab === "templates" && (
            <div className="mb-2 space-y-2 rounded-md border border-slate-700 bg-slate-900/70 p-2">
              <div className="flex items-center gap-2">
                <select
                  value={libraryTemplateSourceMode}
                  onChange={(event) =>
                    setLibraryTemplateSourceMode(event.target.value as "all" | "user" | "builtin")
                  }
                  className="h-7 min-w-[110px] rounded border border-slate-600 bg-slate-900 px-2 text-[11px] text-slate-200"
                >
                  <option value="all">All sources</option>
                  <option value="user">My templates</option>
                  <option value="builtin">Built-in</option>
                </select>
                <select
                  value={libraryTemplateDifficultyFilter}
                  onChange={(event) =>
                    setLibraryTemplateDifficultyFilter(
                      event.target.value as "all" | "Easy" | "Medium" | "Advanced",
                    )
                  }
                  className="h-7 min-w-[110px] rounded border border-slate-600 bg-slate-900 px-2 text-[11px] text-slate-200"
                >
                  <option value="all">All levels</option>
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Advanced">Advanced</option>
                </select>
                <select
                  value={libraryTemplateTagFilter}
                  onChange={(event) => setLibraryTemplateTagFilter(event.target.value)}
                  className="h-7 min-w-[110px] rounded border border-slate-600 bg-slate-900 px-2 text-[11px] text-slate-200"
                >
                  {libraryTemplateTagOptions.map((tag) => (
                    <option key={`editor-library-tag-${tag}`} value={tag}>
                      Tag: {tag}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void clearRecentTemplatesFromLibrary()}
                  disabled={recentTemplateIds.length === 0}
                  className={libraryActionButtonDisabledClass}
                  title={recentTemplateIds.length === 0 ? clearRecentDisabledReason : "Clear recent template history"}
                >
                  Clear recent
                </button>
                <button
                  onClick={() => void removeSelectedUserTemplates()}
                  disabled={effectiveSelectedUserTemplateIds.length === 0}
                  className={libraryDangerButtonDisabledClass}
                  title={effectiveSelectedUserTemplateIds.length === 0 ? deleteSelectedDisabledReason : "Delete selected templates"}
                >
                  Delete selected ({effectiveSelectedUserTemplateIds.length})
                </button>
                {libraryTemplateSourceMode === "user" && selectableUserTemplateIds.length > 0 && (
                  <button
                    onClick={toggleSelectAllVisibleUsers}
                    className={libraryActionButtonClass}
                  >
                    {allVisibleUsersSelected ? "Clear selection" : "Select all"}
                  </button>
                )}
              </div>
            </div>

          )}
          <div className="max-h-72 space-y-1 overflow-auto pr-1">
            {libraryTab === "documents" ? (
              filteredDocuments.length === 0 ? (
                <p className={`${libraryEmptyStateClass} type-caption`}>
                  No documents found.
                </p>
              ) : (
                filteredDocuments.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => openDocumentById(doc.id)}
                    className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition ${
                      doc.id === currentDoc.id
                        ? "border-indigo-400/45 bg-indigo-500/18 text-indigo-100"
                        : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:bg-slate-800"
                    }`}
                  >
                    <p className="font-medium">{doc.title || "Untitled Diagram"}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {doc.format.toUpperCase()} | {new Date(doc.updatedAt).toLocaleString()}
                    </p>
                  </button>
                ))
              )
            ) : sortedFilteredTemplates.length === 0 ? (
              <p className={`${libraryEmptyStateClass} type-caption`}>
                No templates found.
              </p>
            ) : (
              sortedFilteredTemplates.map((template) => {
                const isUserTemplate = template.id.startsWith("user-");
                const isRecentTemplate = recentTemplateIdSet.has(template.id);
                return (
                  <div key={template.id} className="rounded-lg border px-2 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={() => void applyTemplateFromLibrary(template.id)}
                        className="flex-1 text-left"
                      >
                        <p className="text-xs font-medium text-slate-100">{template.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                            {template.difficulty}
                          </span>
                          <span className="rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                            {isUserTemplate ? "My template" : "Built-in"}
                          </span>
                          {isRecentTemplate && (
                            <span className="rounded border border-indigo-400/40 bg-indigo-500/18 px-1.5 py-0.5 text-[10px] font-medium text-indigo-100">
                              Recent
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">Category: {template.category}</p>
                        <p className="mt-1 line-clamp-2 text-[10px] text-slate-500">{template.description}</p>
                        {(template.tags ?? []).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(template.tags ?? []).slice(0, 3).map((tag) => (
                              <span
                                key={`${template.id}-library-tag-${tag}`}
                              className="rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-300"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                      {isUserTemplate && (
                        <div className="flex items-center gap-1">
                          <label className="inline-flex items-center gap-1 rounded border border-slate-600 px-1.5 py-1 text-[10px] text-slate-300 hover:bg-slate-800">
                            <input
                              type="checkbox"
                              checked={effectiveSelectedUserTemplateIds.includes(template.id)}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setSelectedUserTemplateIds((previous) => {
                                  if (checked) {
                                    if (previous.includes(template.id)) return previous;
                                    return [...previous, template.id];
                                  }
                                  return previous.filter((id) => id !== template.id);
                                });
                              }}
                            />
                            Select
                          </label>
                          <button
                            onClick={() => void deleteTemplateFromLibrary(template.id)}
                            className="rounded border border-rose-400/40 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-500/15"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
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
            className="absolute inset-0 z-[110] bg-[color:color-mix(in_srgb,var(--bg-overlay)_38%,transparent)] backdrop-blur-[1px]"
          />
        )}

        {isNarrowViewport ? (
          <div className="pointer-events-none absolute right-2 top-3 z-[121]" ref={workspaceQuickMenuRef}>
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
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
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
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
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
            <div className="pointer-events-none absolute left-1 top-1/2 z-[121] flex -translate-y-1/2 flex-col gap-2">
              <button
                type="button"
                onClick={toggleLeftWorkbench}
                className={floatingIconButtonClass}
                title={leftWorkbenchVisible ? "Collapse workbench (Shift+Tab)" : "Open workbench (Shift+Tab)"}
              >
                {leftWorkbenchVisible ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {leftWorkbenchVisible && (
                <button
                  type="button"
                  onClick={toggleLeftWorkbenchSize}
                  className={floatingIconButtonClass}
                  title="Toggle compact/expanded width"
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              )}
            </div>

          </>
        )}

        <aside
          className={`${leftPanelClass} ${leftWorkbenchVisible ? "translate-x-0" : "-translate-x-full"}`}
          style={{ width: leftWorkbenchWidth }}
        >
          <div className="p-2">
            <div className="grid grid-cols-2 rounded-lg border border-slate-700 bg-slate-800/70 p-1 text-xs">
              <button
                onClick={() => setActiveTab("source")}
                className={`rounded-md px-3 py-1.5 font-medium ${activeTab === "source" ? "bg-slate-700 text-slate-100 shadow" : "text-slate-400"}`}
              >
                Source
              </button>
              <button
                onClick={() => setActiveTab("editor")}
                className={`rounded-md px-3 py-1.5 font-medium ${activeTab === "editor" ? "bg-slate-700 text-slate-100 shadow" : "text-slate-400"}`}
              >
                Editor
              </button>
            </div>
          </div>

          {activeTab === "source" ? (
            <div className="space-y-3 overflow-auto p-4">
              <label
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center transition ${isDragOver ? "border-indigo-400 bg-indigo-500/12" : "border-slate-600 bg-slate-900/60 hover:border-indigo-400 hover:bg-indigo-500/10"}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={onDrop}
              >
                <FileUp className="h-8 w-8 text-slate-400" />
                <div>
                  <p className="type-section text-sm font-medium text-slate-200">Upload CSV / JSON / XLSX</p>
                  <p className="type-caption text-xs text-slate-400">Drop file here or click to select</p>
                </div>
                <input className="hidden" type="file" accept=".csv,.json,.xlsx" onChange={onFileUpload} />
              </label>

              {sourceFileName && (
                <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-xs text-slate-300">
                  Uploaded: <span className="type-body font-medium text-slate-100">{sourceFileName}</span>
                </div>
              )}

              <IssueCenter issues={sourceIssues} />

              <div className={`rounded-lg border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : "bg-[var(--bg-elevated)]"}`}>
                <div className="mb-2 text-xs font-medium text-slate-500">Paste CSV text</div>
                <textarea
                  value={pastedCsv}
                  onChange={(event) => setPastedCsv(event.target.value)}
                  placeholder="source,target,value&#10;A,B,120&#10;B,C,40"
                  className={`h-28 w-full rounded border px-2 py-1 text-xs font-mono outline-none ${
                    isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "border-slate-200 bg-[var(--bg-elevated)]"
                  }`}
                />
                <button
                  onClick={previewPastedCsv}
                  className="mt-2 w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                >
                  Preview Pasted CSV
                </button>
              </div>

              <div className={`rounded-lg border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : "bg-[var(--bg-elevated)]"}`}>
                <div className="mb-2 text-xs font-medium text-slate-500">Paste JSON text</div>
                <textarea
                  value={pastedJson}
                  onChange={(event) => setPastedJson(event.target.value)}
                  placeholder='[{"source":"A","target":"B","value":120}]'
                  className={`h-28 w-full rounded border px-2 py-1 text-xs font-mono outline-none ${
                    isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "border-slate-200 bg-[var(--bg-elevated)]"
                  }`}
                />
                {pastedJsonResult ? (
                  pastedJsonResult.ok ? (
                    <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
                      Valid JSON: {pastedJsonResult.graph.nodes.length} nodes, {pastedJsonResult.graph.links.length} links
                    </div>
                  ) : (
                    <div className="mt-2 rounded border border-[color:color-mix(in_srgb,var(--error)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--error)_14%,transparent)] px-2 py-1 text-[11px] text-[color:color-mix(in_srgb,var(--error)_78%,white)]">
                      {pastedJsonResult.issue.message} (Ln {pastedJsonResult.issue.line}, Col {pastedJsonResult.issue.column})
                    </div>
                  )
                ) : (
                  <div className="mt-2 text-[11px] text-slate-500">Paste JSON to validate and preview.</div>
                )}
                <button
                  onClick={previewPastedJson}
                  className="mt-2 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200"
                >
                  Preview Pasted JSON
                </button>
                <button
                  onClick={applyPastedJsonToEditor}
                  className="mt-2 w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                >
                  Apply Pasted JSON
                </button>
                {pastedJsonResult?.ok && (
                  <div className={rightPanelCardClass}>
                    <div className="mb-1 text-[11px] font-medium text-slate-600">JSON Links Preview (top 5)</div>
                    <table className="min-w-full text-left text-[11px]">
                      <thead>
                        <tr className="border-b text-slate-500">
                          <th className="px-1 py-1 font-medium">source</th>
                          <th className="px-1 py-1 font-medium">target</th>
                          <th className="px-1 py-1 font-medium">value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pastedJsonResult.graph.links.slice(0, 5).map((link, index) => (
                          <tr key={`json-link-${index}`} className="border-b last:border-0">
                            <td className="px-1 py-1 text-slate-700">{link.source}</td>
                            <td className="px-1 py-1 text-slate-700">{link.target}</td>
                            <td className="px-1 py-1 text-slate-700">{link.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {sourcePreview && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                    <p className="text-xs font-medium text-slate-600">Import Value Policy</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setValuePolicy("drop");
                          setSourceError("");
                          setSourceNotice("");
                        }}
                        className={`rounded border px-2 py-1 text-xs ${
                          valuePolicy === "drop"
                            ? "border-indigo-400/45 bg-indigo-500/18 text-indigo-100"
                            : "border-slate-600 bg-slate-900 text-slate-300"
                        }`}
                      >
                        Drop invalid/non-positive
                      </button>
                      <button
                        onClick={() => {
                          setValuePolicy("clamp");
                          setSourceError("");
                          setSourceNotice("");
                        }}
                        className={`rounded border px-2 py-1 text-xs ${
                          valuePolicy === "clamp"
                            ? "border-indigo-400/45 bg-indigo-500/18 text-indigo-100"
                            : "border-slate-600 bg-slate-900 text-slate-300"
                        }`}
                      >
                        Clamp to minimum
                      </button>
                    </div>
                    {valuePolicy === "clamp" && (
                      <label className="mt-2 block text-xs text-slate-600">
                        Minimum Value
                        <input
                          type="number"
                          min={0.0001}
                          step={0.1}
                          value={valueMinWhenClamped}
                          onChange={(event) => {
                            setValueMinWhenClamped(
                              Math.max(0.0001, Number(event.target.value) || 1),
                            );
                            setSourceError("");
                            setSourceNotice("");
                          }}
                          className="mt-1 w-full rounded border px-2 py-1 text-xs"
                        />
                      </label>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-slate-600">Mapping Presets</p>
                      <button
                        onClick={() => void saveMappingPreset()}
                        disabled={sourceMappingIssues.length > 0}
                        title={sourceMappingIssues.length > 0 ? sourceMappingIssues[0] : "Save current mapping preset"}
                        className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Save Current Mapping
                      </button>
                    </div>
                    {mappingPresetsForMode.length === 0 ? (
                      <p className="mt-2 text-[11px] text-slate-500">
                        No presets for {sourcePreviewMode.toUpperCase()} yet.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {mappingPresetsForMode.slice(0, 6).map((preset) => (
                          <div key={preset.id} className="flex items-center gap-1">
                            <button
                              onClick={() => applyMappingPreset(preset.id)}
                              disabled={!presetCompatibilityById.get(preset.id)?.ok}
                              title={presetCompatibilityById.get(preset.id)?.reason || "Apply preset mapping"}
                              className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-left text-[11px] text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {preset.name}
                            </button>
                            <button
                              onClick={() => removeMappingPreset(preset.id)}
                              className="rounded border border-[color:color-mix(in_srgb,var(--error)_50%,transparent)] px-2 py-1 text-[11px] text-[color:color-mix(in_srgb,var(--error)_78%,white)]"
                              title="Delete preset mapping"
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                    <label className="text-xs text-slate-600">
                      Source
                      <select
                        className="mt-1 w-full rounded border px-2 py-1 text-xs"
                        value={sourcePreview.mapping.source}
                        onChange={(event) => updateSourceMapping("source", event.target.value)}
                      >
                        {sourcePreview.headers.map((header) => (
                          <option key={`source-${header}`} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-slate-600">
                      Target
                      <select
                        className="mt-1 w-full rounded border px-2 py-1 text-xs"
                        value={sourcePreview.mapping.target}
                        onChange={(event) => updateSourceMapping("target", event.target.value)}
                      >
                        {sourcePreview.headers.map((header) => (
                          <option key={`target-${header}`} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-slate-600">
                      Value
                      <select
                        className="mt-1 w-full rounded border px-2 py-1 text-xs"
                        value={sourcePreview.mapping.value}
                        onChange={(event) => updateSourceMapping("value", event.target.value)}
                      >
                        {sourcePreview.headers.map((header) => (
                          <option key={`value-${header}`} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                    <div className="mb-2 text-xs font-medium text-slate-600">Mapping Health</div>
                    {sourceMappingIssues.length > 0 ? (
                      <div className="space-y-1 text-[11px] text-[color:color-mix(in_srgb,var(--error)_78%,white)]">
                        {sourceMappingIssues.map((issue) => (
                          <p key={issue}>- {issue}</p>
                        ))}
                      </div>
                    ) : mappingTransformPreview ? (
                      <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                        <div className="rounded border bg-slate-50 px-2 py-1">
                          Output: {mappingTransformPreview.stats.outputRows}
                        </div>
                        <div className="rounded border bg-slate-50 px-2 py-1">
                          Dropped: {mappingTransformPreview.stats.droppedRows}
                        </div>
                        <div className="rounded border bg-slate-50 px-2 py-1">
                          Clamped: {mappingTransformPreview.stats.clampedRows}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500">Mapping preview unavailable.</p>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                    <div className="mb-2 text-xs font-medium text-slate-600">
                      Preview ({sourcePreview.rows.length} rows)
                    </div>
                    <input
                      value={sourceFilter}
                      onChange={(event) => {
                        setSourceFilter(event.target.value);
                        setSourcePage(1);
                      }}
                      placeholder="Filter rows..."
                      className="mb-2 w-full rounded border px-2 py-1 text-xs"
                    />
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[11px] text-slate-500">
                        Page {Math.min(sourcePage, totalSourcePages)} / {totalSourcePages} ({filteredSortedRows.length} filtered)
                      </div>
                      <div className="flex items-center gap-1">
                        <select
                          value={sourcePageSize}
                          onChange={(event) => {
                            setSourcePageSize(Number(event.target.value));
                            setSourcePage(1);
                          }}
                          className="rounded border px-1 py-0.5 text-[11px]"
                        >
                          <option value={5}>5 / page</option>
                          <option value={10}>10 / page</option>
                          <option value={20}>20 / page</option>
                        </select>
                        <button
                          onClick={() => setSourcePage((p) => Math.max(1, p - 1))}
                          className="rounded border px-2 py-0.5 text-[11px]"
                          disabled={sourcePage <= 1}
                          title={sourcePage <= 1 ? "Already at first page." : "Previous page"}
                        >
                          Prev
                        </button>
                        <button
                          onClick={() => setSourcePage((p) => Math.min(totalSourcePages, p + 1))}
                          className="rounded border px-2 py-0.5 text-[11px]"
                          disabled={sourcePage >= totalSourcePages}
                          title={sourcePage >= totalSourcePages ? "Already at last page." : "Next page"}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                    <div className="overflow-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead>
                          <tr className="border-b text-slate-500">
                            {sourcePreview.headers.map((header) => (
                              <th key={`head-${header}`} className="px-2 py-1 font-medium">
                                <button
                                  onClick={() => toggleSortBy(header)}
                                  className="inline-flex items-center gap-1 hover:text-slate-800"
                                >
                                  {header}
                                  {sourceSortKey === header ? (sourceSortDir === "asc" ? "^" : "v") : ""}
                                </button>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedRows.map((row, index) => (
                            <tr key={`row-${sourcePage}-${index}`} className="border-b last:border-0">
                              {sourcePreview.headers.map((header) => (
                                <td key={`cell-${sourcePage}-${index}-${header}`} className="px-2 py-1 text-slate-700">
                                  {row[header]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <button
                    onClick={applyMappingToEditor}
                    disabled={!canApplyMapping}
                    className={sourcePrimaryActionClass}
                    title={!canApplyMapping ? (sourceMappingIssues[0] || "No valid rows with current mapping/policy.") : "Apply mapped data to editor"}
                  >
                    Apply Mapping to Editor ({sourcePreviewMode.toUpperCase()})
                  </button>
                  {!canApplyMapping && (
                    <p className="text-[11px] text-[color:color-mix(in_srgb,var(--error)_78%,white)]">
                      {sourceMappingIssues[0] || "No valid rows to import with current mapping/policy."}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 border-t">
              <div className="flex h-9 items-center justify-between border-b border-slate-700 bg-slate-900/75 px-3 text-xs text-slate-400">
                <span>{fileHint}</span>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={(event) => setAutoSync(event.target.checked)}
                  />
                  Auto-sync
                </label>
              </div>
              <div className="h-[calc(100%-36px)]">
                <SankeyMonacoEditor
                  value={currentDoc.editorText}
                  format={currentDoc.format}
                  theme={currentDoc.style.theme}
                  onChange={setEditorText}
                  marker={parseIssue}
                />
              </div>
            </div>
          )}

          <IssueCenter issues={editorIssues} className="border-t px-4 py-3" />
        </aside>

        <main className={canvasContainerClass}>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: performanceProfile.shouldReduceMotion ? 0.03 : 0.35 }}
            className="h-full"
          >
            <SankeyCanvas
              key={canvasResetKey}
              graph={graph}
              style={currentDoc.style}
              nodePositions={currentDoc.nodePositions}
              nodeStyles={currentDoc.nodeStyles}
              linkStyles={currentDoc.linkStyles}
              renderHints={renderHints}
              interactionMode="select"
              isSpacePanning={isSpacePanning}
              selectedNodeIds={selectedNodeIds}
              selectedLinkIndex={selectedLinkIndex}
              traceMode={traceMode}
              onNodePositionChange={setNodePosition}
              onSelectionChange={setSelectedNodeIds}
              onLinkSelectionChange={setSelectedLinkIndex}
              onZoomChange={setZoomLevel}
              onSvgReady={setSvgElement}
            />
          </motion.div>
        </main>

        
      {dialogNode}

      </div>
    </div>
  );
}





















































































