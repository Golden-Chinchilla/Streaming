"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import NextImage from "next/image";
import { useRouter } from "next/navigation";
import {
  CopyPlus,
  FileText,
  Download,
  FileUp,
  Hand,
  LayoutTemplate,
  LocateFixed,
  MousePointer2,
  Play,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  WandSparkles,
} from "lucide-react";
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
  TemplateSummary,
} from "@/lib/types";
import { linkStyleKey } from "@/lib/utils";
import { SankeyMonacoEditor } from "@/components/editor/monaco-editor";
import { SankeyCanvas } from "@/components/editor/sankey-canvas";
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

type ExportPreset = {
  id: string;
  name: string;
  width: number;
  height: number;
  transparent: boolean;
  padding?: number;
  pngScale?: number;
  fileTemplate?: string;
};

const DEFAULT_EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "1080p",
    name: "1080p",
    width: 1920,
    height: 1080,
    transparent: false,
    padding: 24,
    pngScale: 1,
    fileTemplate: "{title}-{date}",
  },
  {
    id: "a4",
    name: "A4",
    width: 2480,
    height: 3508,
    transparent: false,
    padding: 48,
    pngScale: 1,
    fileTemplate: "{title}-{date}",
  },
  {
    id: "4k",
    name: "4K",
    width: 3840,
    height: 2160,
    transparent: false,
    padding: 36,
    pngScale: 2,
    fileTemplate: "{title}-{date}",
  },
];

const EXPORT_PRESET_STORAGE_KEY = "streaming-export-presets-v1";
const EXPORT_SETTINGS_STORAGE_KEY = "streaming-export-settings-v1";
const MAPPING_PRESETS_STORAGE_KEY = "streaming-mapping-presets-v1";
const CANVAS_BASE_WIDTH = 1200;
const CANVAS_BASE_HEIGHT = 700;
const USER_TEMPLATE_ACCENTS = [
  "from-blue-500 to-cyan-500",
  "from-emerald-500 to-teal-500",
  "from-fuchsia-500 to-orange-500",
  "from-indigo-500 to-sky-500",
];
type MappingPreset = {
  id: string;
  name: string;
  mode: "csv" | "json";
  mapping: TableMapping;
  createdAt: number;
};
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

export function EditorWorkspace({ templateId, docId }: Props) {
  const router = useRouter();
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
  const [importFlowAppliedCount, setImportFlowAppliedCount] = useState(0);
  const [pastedCsv, setPastedCsv] = useState<string>("");
  const [pastedJson, setPastedJson] = useState<string>("");
  const [svgElement, setSvgElement] = useState<SVGSVGElement | null>(null);
  const [interactionMode, setInteractionMode] = useState<"select" | "pan">("select");
  const [canvasResetKey, setCanvasResetKey] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectionColor, setSelectionColor] = useState("#3b82f6");
  const [selectionOpacity, setSelectionOpacity] = useState(100);
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>("auto");
  const [exportWidth, setExportWidth] = useState(initialExportSettings.width);
  const [exportHeight, setExportHeight] = useState(initialExportSettings.height);
  const [exportPadding, setExportPadding] = useState(initialExportSettings.padding);
  const [exportPngScale, setExportPngScale] = useState(initialExportSettings.pngScale);
  const [exportTransparentBg, setExportTransparentBg] = useState(initialExportSettings.transparent);
  const [exportFileTemplate, setExportFileTemplate] = useState(initialExportSettings.fileTemplate);
  const [exportAllFormats, setExportAllFormats] = useState<{ svg: boolean; png: boolean; html: boolean }>({
    svg: true,
    png: true,
    html: true,
  });
  const [exportAllNamingMode, setExportAllNamingMode] = useState<"same" | "suffix">("suffix");
  const [rightPanelTab, setRightPanelTab] = useState<"inspect" | "style" | "export" | "studio">("inspect");
  const [customExportPresets, setCustomExportPresets] = useState<ExportPreset[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = window.localStorage.getItem(EXPORT_PRESET_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved) as ExportPreset[];
      return parsed.filter(
        (item) =>
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          Number.isFinite(item.width) &&
          Number.isFinite(item.height) &&
          typeof item.transparent === "boolean",
      );
    } catch {
      return [];
    }
  });
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
  const [newPresetName, setNewPresetName] = useState("");

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
    clearNodePositions,
    setSelectedNodeIds,
    setSelectedLinkIndex,
    clearSelection,
    setTraceMode,
    applyNodeColorToSelection,
    applyNodeOpacityToSelection,
    clearNodeColorFromSelection,
    clearSelectedNodeStyles,
    patchSelectedLinkStyle,
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

  const allTemplates = useMemo(() => {
    return [...templateList, ...userTemplates];
  }, [userTemplates]);

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
    if (!keyword) return bySource;
    return bySource.filter((template) => {
      return (
        template.name.toLowerCase().includes(keyword) ||
        template.category.toLowerCase().includes(keyword) ||
        template.description.toLowerCase().includes(keyword) ||
        (template.tags ?? []).some((tag) => tag.toLowerCase().includes(keyword))
      );
    });
  }, [allTemplates, librarySearch, libraryTemplateSourceMode]);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearSelection();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (
        event.key.toLowerCase() === "y" ||
        (event.key.toLowerCase() === "z" && event.shiftKey)
      ) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection, redo, undo]);

  useEffect(() => {
    window.localStorage.setItem(
      EXPORT_PRESET_STORAGE_KEY,
      JSON.stringify(customExportPresets),
    );
  }, [customExportPresets]);

  useEffect(() => {
    window.localStorage.setItem(
      MAPPING_PRESETS_STORAGE_KEY,
      JSON.stringify(mappingPresets),
    );
  }, [mappingPresets]);

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
      background.setAttribute("fill", currentDoc.style.theme === "dark" ? "#0f172a" : "#ffffff");
      cloned.insertBefore(background, cloned.firstChild);
    }
    return new XMLSerializer().serializeToString(cloned);
  }, [
    currentDoc.style.theme,
    exportHeight,
    exportPadding,
    exportTransparentBg,
    exportWidth,
    svgElement,
  ]);

  const exportPreviewUrl = useMemo(() => {
    if (!exportSvgString) return null;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(exportSvgString)}`;
  }, [exportSvgString]);

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

  const allExportPresets = useMemo(
    () => [...DEFAULT_EXPORT_PRESETS, ...customExportPresets],
    [customExportPresets],
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


  const sourceFlowSteps = useMemo(() => {
    const ingested = !!sourcePreview;
    const mapped = ingested && sourceMappingIssues.length === 0;
    const reviewed = mapped && mappingTransformPreview != null;
    const applied = importFlowAppliedCount > 0;

    const steps = [
      {
        id: 1,
        title: "1. Ingest",
        done: ingested,
        hint: ingested ? `${sourcePreviewMode.toUpperCase()} data loaded` : "Upload or paste source",
      },
      {
        id: 2,
        title: "2. Map",
        done: mapped,
        hint: mapped ? "Mapping columns valid" : "Choose source/target/value",
      },
      {
        id: 3,
        title: "3. Review",
        done: reviewed,
        hint: reviewed ? "Preview and policy checked" : "Check health and table preview",
      },
      {
        id: 4,
        title: "4. Apply",
        done: applied,
        hint: applied ? "Applied to editor" : "Apply mapping to editor",
      },
    ];

    const firstPending = steps.find((step) => !step.done)?.id ?? 4;
    return steps.map((step) => ({ ...step, active: step.id === firstPending }));
  }, [
    sourcePreview,
    sourceMappingIssues.length,
    mappingTransformPreview,
    importFlowAppliedCount,
    sourcePreviewMode,
  ]);
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

  const effectivePerformanceMode = useMemo<Exclude<PerformanceMode, "auto">>(() => {
    if (performanceMode !== "auto") return performanceMode;
    if (graphMetrics.nodes >= 500 || graphMetrics.links >= 1400) return "performance";
    if (graphMetrics.nodes >= 220 || graphMetrics.links >= 650) return "balanced";
    return "quality";
  }, [graphMetrics.links, graphMetrics.nodes, performanceMode]);

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
    return {
      showLabels: false,
      enableLinkHover: graphMetrics.links <= 900,
      dragThrottleMs: 36,
      simplifyLinkCurves: true,
      lowDetailDuringDrag: true,
    };
  }, [effectivePerformanceMode, graphMetrics.links, graphMetrics.nodes]);

  const selectedLink = useMemo(() => {
    if (selectedLinkIndex == null) return null;
    return graph.links[selectedLinkIndex] ?? null;
  }, [graph.links, selectedLinkIndex]);

  const selectedLinkStyle = useMemo(() => {
    if (selectedLinkIndex == null) return null;
    return currentDoc.linkStyles[linkStyleKey(selectedLinkIndex)] ?? null;
  }, [currentDoc.linkStyles, selectedLinkIndex]);

  const selectedNodeSummary = useMemo(() => {
    if (selectedNodeIds.length === 0) return null;
    const selectedSet = new Set(selectedNodeIds);
    const inValue = graph.links
      .filter((link) => selectedSet.has(link.target))
      .reduce((sum, link) => sum + link.value, 0);
    const outValue = graph.links
      .filter((link) => selectedSet.has(link.source))
      .reduce((sum, link) => sum + link.value, 0);
    return { inValue, outValue };
  }, [graph.links, selectedNodeIds]);

  const singleSelectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const singleSelectedNodeColor = singleSelectedNodeId
    ? currentDoc.nodeStyles[singleSelectedNodeId]?.color ?? ""
    : "";
  const singleSelectedNodeOpacity = singleSelectedNodeId
    ? Math.round((currentDoc.nodeStyles[singleSelectedNodeId]?.opacity ?? 1) * 100)
    : 100;
  const batchSelectionOpacityValue = selectedNodeIds.length === 1 ? singleSelectedNodeOpacity : selectionOpacity;
  const selectedLinkWidthScale = selectedLinkStyle?.widthScale ?? 1;

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
      : `margin:0;background:${currentDoc.style.theme === "dark" ? "#0f172a" : "#ffffff"};display:flex;justify-content:center;align-items:center;min-height:100vh;`;
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
          context.fillStyle = currentDoc.style.theme === "dark" ? "#0f172a" : "#ffffff";
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
      setImportFlowAppliedCount(0);
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
      setImportFlowAppliedCount(0);
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
    setImportFlowAppliedCount(0);
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
    setFormat(sourcePreviewMode === "json" ? "json" : "csv");
    setEditorText(text);
    setImportFlowAppliedCount((value) => value + 1);
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
    setImportFlowAppliedCount(0);
  };

  const saveMappingPreset = () => {
    if (!sourcePreview) return;
    if (sourceMappingIssues.length > 0) {
      setSourceError(sourceMappingIssues[0]);
      return;
    }
    const suggested = `${sourcePreviewMode.toUpperCase()} Mapping`;
    const name = window.prompt("Preset name", suggested)?.trim();
    if (!name) return;
    const existing = mappingPresets.find(
      (item) =>
        item.mode === sourcePreviewMode &&
        item.name.toLowerCase() === name.toLowerCase(),
    );
    let id = `map-${crypto.randomUUID()}`;
    if (existing) {
      const overwrite = window.confirm(`Preset "${name}" exists. Overwrite it?`);
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
    setImportFlowAppliedCount(0);
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
      setImportFlowAppliedCount(0);
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
      setImportFlowAppliedCount(0);
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

  const applyExportPreset = (preset: ExportPreset) => {
    setExportWidth(preset.width);
    setExportHeight(preset.height);
    setExportTransparentBg(preset.transparent);
    if (typeof preset.padding === "number") {
      setExportPadding(Math.max(0, Math.min(300, preset.padding)));
    }
    if (typeof preset.pngScale === "number") {
      setExportPngScale(Math.max(1, Math.min(4, Math.round(preset.pngScale))));
    }
    if (typeof preset.fileTemplate === "string" && preset.fileTemplate.trim().length > 0) {
      setExportFileTemplate(preset.fileTemplate);
    }
  };

  const saveCurrentAsPreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    const preset: ExportPreset = {
      id: crypto.randomUUID(),
      name,
      width: exportWidth,
      height: exportHeight,
      transparent: exportTransparentBg,
      padding: exportPadding,
      pngScale: exportPngScale,
      fileTemplate: exportFileTemplate,
    };
    setCustomExportPresets((prev) => [preset, ...prev]);
    setNewPresetName("");
  };

  const removeCustomPreset = (presetId: string) => {
    setCustomExportPresets((prev) => prev.filter((preset) => preset.id !== presetId));
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
    const name = window.prompt("Template name", suggested)?.trim();
    if (!name) return;
    const description =
      window.prompt("Template description", "Custom template from current document")?.trim() ||
      "Custom template from current document";
    const category = window.prompt("Template category", "Custom")?.trim() || "Custom";
    const tagsInput =
      window.prompt("Template tags (comma separated)", "custom")?.trim() || "";
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
      const overwrite = window.confirm(
        `A template named "${name}" already exists. Overwrite it?`,
      );
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
    const confirmed = window.confirm("Delete this template?");
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
    const confirmed = window.confirm(
      `Delete ${effectiveSelectedUserTemplateIds.length} selected template(s)?`,
    );
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
    const confirmed = window.confirm("Clear recent template history?");
    if (!confirmed) return;
    await clearRecentTemplateIds();
    setRecentTemplateIds([]);
  };

  const deleteCurrentDocument = async () => {
    if (allDocuments.length <= 1) {
      await createNewDocument();
      return;
    }
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
  const workspaceClass = isDarkTheme
    ? "relative flex h-screen flex-col overflow-hidden bg-[#0b1220] text-slate-100"
    : "relative flex h-screen flex-col overflow-hidden";
  const headerClass = isDarkTheme
    ? "flex h-14 items-center justify-between border-b border-slate-700 bg-slate-900/90 px-4 backdrop-blur"
    : "flex h-14 items-center justify-between border-b bg-white/90 px-4 backdrop-blur";
  const leftPanelClass = isDarkTheme
    ? "flex w-[400px] min-w-[360px] flex-col border-r border-slate-700 bg-slate-900"
    : "flex w-[400px] min-w-[360px] flex-col border-r bg-white";
  const rightPanelClass = isDarkTheme
    ? "w-[280px] min-w-[260px] space-y-4 border-l border-slate-700 bg-slate-900 p-4"
    : "w-[280px] min-w-[260px] space-y-4 border-l bg-white p-4";
  const canvasContainerClass = isDarkTheme
    ? "min-w-0 flex-1 bg-[radial-gradient(circle_at_20%_20%,#1e293b_0%,#0f172a_60%)] p-6"
    : "min-w-0 flex-1 bg-[radial-gradient(circle_at_20%_20%,#ffffff_0%,#f2f6fc_55%)] p-6";

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
            className="w-72 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold outline-none transition focus:border-slate-300 focus:bg-slate-50"
          />
          <span className="text-xs text-slate-400">Auto-saved locally</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDocuments((value) => !value)}
            className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1.5 text-xs font-medium text-slate-600"
            title="Documents"
          >
            <FileText className="h-3.5 w-3.5" />
            Docs
          </button>
          <button
            onClick={createNewDocument}
            className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1.5 text-xs font-medium text-slate-600"
            title="New document"
          >
            New
          </button>
          <button
            onClick={saveAsCopy}
            className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1.5 text-xs font-medium text-slate-600"
            title="Save as copy"
          >
            <CopyPlus className="h-3.5 w-3.5" />
            Save As
          </button>
          <button
            onClick={saveAsTemplate}
            className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1.5 text-xs font-medium text-slate-600"
            title="Save as template"
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            Save Template
          </button>
          <button
            onClick={undo}
            disabled={historyPast.length === 0}
            className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1.5 text-xs font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="Undo (Ctrl/Cmd+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={historyFuture.length === 0}
            className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1.5 text-xs font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="Redo (Ctrl/Cmd+Y)"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => syncFromEditor()}
            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
          >
            <Play className="h-3.5 w-3.5" />
            Sync
          </button>
          <button
            onClick={() => clearNodePositions()}
            className="inline-flex items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            Auto-layout
          </button>
          <button
            onClick={() => exportSvg()}
            className="inline-flex items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
          >
            <Download className="h-3.5 w-3.5" />
            SVG
          </button>
          <button
            onClick={() => void exportPng()}
            className="inline-flex items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
          >
            <Download className="h-3.5 w-3.5" />
            PNG
          </button>
          <button
            onClick={() => exportHtml()}
            className="inline-flex items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
          >
            <Download className="h-3.5 w-3.5" />
            HTML
          </button>
          <button
            onClick={() => void exportAll()}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
          >
            <Download className="h-3.5 w-3.5" />
            All
          </button>
        </div>
      </header>

      {showDocuments && (
        <div className="absolute left-4 top-16 z-40 w-96 rounded-xl border bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-[11px]">
              <button
                onClick={() => setLibraryTab("documents")}
                className={`rounded-md px-2 py-1 font-medium ${
                  libraryTab === "documents" ? "bg-white text-slate-900 shadow" : "text-slate-500"
                }`}
              >
                Documents
              </button>
              <button
                onClick={() => setLibraryTab("templates")}
                className={`rounded-md px-2 py-1 font-medium ${
                  libraryTab === "templates" ? "bg-white text-slate-900 shadow" : "text-slate-500"
                }`}
              >
                Templates
              </button>
            </div>
            {libraryTab === "documents" ? (
              <button
                onClick={deleteCurrentDocument}
                className="rounded border px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
              >
                Delete Current
              </button>
            ) : (
              <button
                onClick={saveAsTemplate}
                className="rounded border px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
              >
                Save Current as Template
              </button>
            )}
          </div>
          <input
            value={librarySearch}
            onChange={(event) => setLibrarySearch(event.target.value)}
            placeholder={libraryTab === "documents" ? "Search documents" : "Search templates"}
            className="mb-2 w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:border-blue-300"
          />
          {libraryTab === "templates" && (
            <div className="mb-2 space-y-2 rounded-md border bg-slate-50 p-2">
              <div className="flex items-center gap-2">
                <select
                  value={libraryTemplateSourceMode}
                  onChange={(event) =>
                    setLibraryTemplateSourceMode(event.target.value as "all" | "user" | "builtin")
                  }
                  className="h-7 min-w-[120px] rounded border bg-white px-2 text-[11px] text-slate-700"
                >
                  <option value="all">All sources</option>
                  <option value="user">My templates</option>
                  <option value="builtin">Built-in</option>
                </select>
                <button
                  onClick={() => void clearRecentTemplatesFromLibrary()}
                  disabled={recentTemplateIds.length === 0}
                  className="rounded border px-2 py-1 text-[11px] text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear recent
                </button>
                <button
                  onClick={() => void removeSelectedUserTemplates()}
                  disabled={effectiveSelectedUserTemplateIds.length === 0}
                  className="rounded border px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delete selected ({effectiveSelectedUserTemplateIds.length})
                </button>
              </div>
              {libraryTemplateSourceMode === "user" && selectableUserTemplateIds.length > 0 && (
                <button
                  onClick={toggleSelectAllVisibleUsers}
                  className="rounded border px-2 py-1 text-[11px] text-slate-700 hover:bg-white"
                >
                  {allVisibleUsersSelected ? "Unselect all" : "Select all"}
                </button>
              )}
            </div>
          )}
          <div className="max-h-72 space-y-1 overflow-auto pr-1">
            {libraryTab === "documents" ? (
              filteredDocuments.length === 0 ? (
                <p className="rounded-lg border border-dashed px-2 py-3 text-center text-xs text-slate-500">
                  No documents found.
                </p>
              ) : (
                filteredDocuments.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => openDocumentById(doc.id)}
                    className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition ${
                      doc.id === currentDoc.id
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <p className="font-medium">{doc.title || "Untitled Diagram"}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {doc.format.toUpperCase()} 路 {new Date(doc.updatedAt).toLocaleString()}
                    </p>
                  </button>
                ))
              )
            ) : sortedFilteredTemplates.length === 0 ? (
              <p className="rounded-lg border border-dashed px-2 py-3 text-center text-xs text-slate-500">
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
                        <p className="text-xs font-medium text-slate-800">{template.name}</p>
                        {isRecentTemplate && (
                          <span className="mt-1 inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                            Recent
                          </span>
                        )}
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {template.category} | {isUserTemplate ? "My Template" : "Built-in"}
                        </p>
                      </button>
                      {isUserTemplate && (
                        <div className="flex items-center gap-1">
                          <label className="inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] text-slate-600 hover:bg-slate-50">
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
                            className="rounded border px-2 py-1 text-[10px] text-red-600 hover:bg-red-50"
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
      <div className="flex min-h-0 flex-1">
        <aside className={leftPanelClass}>
          <div className="p-2">
            <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-xs">
              <button
                onClick={() => setActiveTab("source")}
                className={`rounded-md px-3 py-1.5 font-medium ${activeTab === "source" ? "bg-white text-slate-900 shadow" : "text-slate-500"}`}
              >
                Source
              </button>
              <button
                onClick={() => setActiveTab("editor")}
                className={`rounded-md px-3 py-1.5 font-medium ${activeTab === "editor" ? "bg-white text-slate-900 shadow" : "text-slate-500"}`}
              >
                Editor
              </button>
            </div>
          </div>

          {activeTab === "source" ? (
            <div className="space-y-3 overflow-auto p-4">
              <div className="rounded-lg border bg-white p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Import Flow
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {sourceFlowSteps.map((step) => (
                    <div
                      key={step.id}
                      className={`rounded border px-2 py-2 text-xs ${
                        step.done
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : step.active
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-500"
                      }`}
                    >
                      <p className="font-medium">{step.title}</p>
                      <p className="mt-0.5 text-[11px]">{step.hint}</p>
                    </div>
                  ))}
                </div>
              </div>
              <label
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center transition ${isDragOver ? "border-blue-500 bg-blue-50/50" : "bg-slate-50 hover:border-blue-400 hover:bg-blue-50/40"}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={onDrop}
              >
                <FileUp className="h-8 w-8 text-slate-400" />
                <div>
                  <p className="text-sm font-medium text-slate-700">Upload CSV / JSON / XLSX</p>
                  <p className="text-xs text-slate-400">Drop file here or click to select</p>
                </div>
                <input className="hidden" type="file" accept=".csv,.json,.xlsx" onChange={onFileUpload} />
              </label>

              {sourceFileName && (
                <div className="rounded-lg border bg-white p-3 text-xs text-slate-600">
                  Uploaded: <span className="font-medium text-slate-900">{sourceFileName}</span>
                </div>
              )}

              {sourceError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {sourceError}
                </div>
              )}
              {sourceNotice && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                  {sourceNotice}
                </div>
              )}

              <div className={`rounded-lg border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : "bg-white"}`}>
                <div className="mb-2 text-xs font-medium text-slate-500">Paste CSV text</div>
                <textarea
                  value={pastedCsv}
                  onChange={(event) => setPastedCsv(event.target.value)}
                  placeholder="source,target,value&#10;A,B,120&#10;B,C,40"
                  className={`h-28 w-full rounded border px-2 py-1 text-xs font-mono outline-none ${
                    isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "border-slate-200 bg-white"
                  }`}
                />
                <button
                  onClick={previewPastedCsv}
                  className="mt-2 w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                >
                  Preview Pasted CSV
                </button>
              </div>

              <div className={`rounded-lg border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : "bg-white"}`}>
                <div className="mb-2 text-xs font-medium text-slate-500">Paste JSON text</div>
                <textarea
                  value={pastedJson}
                  onChange={(event) => setPastedJson(event.target.value)}
                  placeholder='[{"source":"A","target":"B","value":120}]'
                  className={`h-28 w-full rounded border px-2 py-1 text-xs font-mono outline-none ${
                    isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "border-slate-200 bg-white"
                  }`}
                />
                {pastedJsonResult ? (
                  pastedJsonResult.ok ? (
                    <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
                      Valid JSON: {pastedJsonResult.graph.nodes.length} nodes, {pastedJsonResult.graph.links.length} links
                    </div>
                  ) : (
                    <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                      {pastedJsonResult.issue.message} (Ln {pastedJsonResult.issue.line}, Col {pastedJsonResult.issue.column})
                    </div>
                  )
                ) : (
                  <div className="mt-2 text-[11px] text-slate-500">Paste JSON to validate and preview.</div>
                )}
                <button
                  onClick={previewPastedJson}
                  className="mt-2 w-full rounded-md border bg-white px-3 py-2 text-xs font-medium text-slate-700"
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
                  <div className="mt-2 rounded border bg-white p-2">
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
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs font-medium text-slate-600">Import Value Policy</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setValuePolicy("drop");
                          setSourceError("");
                          setSourceNotice("");
                          setImportFlowAppliedCount(0);
                        }}
                        className={`rounded border px-2 py-1 text-xs ${
                          valuePolicy === "drop"
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "bg-white text-slate-600"
                        }`}
                      >
                        Drop invalid/non-positive
                      </button>
                      <button
                        onClick={() => {
                          setValuePolicy("clamp");
                          setSourceError("");
                          setSourceNotice("");
                          setImportFlowAppliedCount(0);
                        }}
                        className={`rounded border px-2 py-1 text-xs ${
                          valuePolicy === "clamp"
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "bg-white text-slate-600"
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
                            setImportFlowAppliedCount(0);
                          }}
                          className="mt-1 w-full rounded border px-2 py-1 text-xs"
                        />
                      </label>
                    )}
                  </div>

                  <div className="rounded-lg border bg-white p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-slate-600">Mapping Presets</p>
                      <button
                        onClick={saveMappingPreset}
                        disabled={sourceMappingIssues.length > 0}
                        title={sourceMappingIssues.length > 0 ? sourceMappingIssues[0] : ""}
                        className="rounded border px-2 py-1 text-[11px] text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
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
                              title={presetCompatibilityById.get(preset.id)?.reason || ""}
                              className="flex-1 rounded border px-2 py-1 text-left text-[11px] text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {preset.name}
                            </button>
                            <button
                              onClick={() => removeMappingPreset(preset.id)}
                              className="rounded border px-2 py-1 text-[11px] text-red-600"
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-lg border bg-white p-3">
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

                  <div className="rounded-lg border bg-white p-3">
                    <div className="mb-2 text-xs font-medium text-slate-600">Mapping Health</div>
                    {sourceMappingIssues.length > 0 ? (
                      <div className="space-y-1 text-[11px] text-red-600">
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

                  <div className="rounded-lg border bg-white p-3">
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
                        >
                          Prev
                        </button>
                        <button
                          onClick={() => setSourcePage((p) => Math.min(totalSourcePages, p + 1))}
                          className="rounded border px-2 py-0.5 text-[11px]"
                          disabled={sourcePage >= totalSourcePages}
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
                    className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Apply Mapping to Editor ({sourcePreviewMode.toUpperCase()})
                  </button>
                  {!canApplyMapping && (
                    <p className="text-[11px] text-red-600">
                      {sourceMappingIssues[0] || "No valid rows to import with current mapping/policy."}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 border-t">
              <div className="flex h-9 items-center justify-between border-b bg-slate-50 px-3 text-xs text-slate-500">
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
                  onChange={setEditorText}
                  marker={parseIssue}
                />
              </div>
            </div>
          )}

          {parseError ? (
            <div className="border-t bg-red-50 px-4 py-3 text-xs text-red-700">{parseError}</div>
          ) : (
            <div className="border-t bg-emerald-50 px-4 py-3 text-xs text-emerald-700">Data is valid.</div>
          )}
        </aside>

        <main className={canvasContainerClass}>
          <div className="mb-2 flex items-center justify-between rounded-lg border bg-white/85 px-2 py-1 text-xs">
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setInteractionMode("select");
                  setCanvasResetKey((value) => value + 1);
                }}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 ${
                  interactionMode === "select" ? "bg-slate-900 text-white" : "text-slate-600"
                }`}
              >
                <MousePointer2 className="h-3.5 w-3.5" />
                Select
              </button>
              <button
                onClick={() => {
                  setInteractionMode("pan");
                  setCanvasResetKey((value) => value + 1);
                }}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 ${
                  interactionMode === "pan" ? "bg-slate-900 text-white" : "text-slate-600"
                }`}
              >
                <Hand className="h-3.5 w-3.5" />
                Pan
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setCanvasResetKey((value) => value + 1);
                }}
                className="inline-flex items-center gap-1 rounded border px-2 py-1 text-slate-600"
              >
                <LocateFixed className="h-3.5 w-3.5" />
                Fit
              </button>
              <button
                onClick={() => {
                  setCanvasResetKey((value) => value + 1);
                  setInteractionMode("select");
                  clearSelection();
                  setTraceMode("none");
                }}
                className="inline-flex items-center gap-1 rounded border px-2 py-1 text-slate-600"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
              <span className="rounded border bg-slate-50 px-2 py-1 font-medium text-slate-600">
                {Math.round(zoomLevel * 100)}%
              </span>
            </div>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: effectivePerformanceMode === "performance" ? 0.05 : 0.35 }}
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
              interactionMode={interactionMode}
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

        <aside className={rightPanelClass}>
          <div className={`grid grid-cols-4 gap-1 rounded-lg border p-1 text-[11px] ${
            isDarkTheme ? "border-slate-700 bg-slate-800" : "bg-slate-50"
          }`}>
            <button
              onClick={() => setRightPanelTab("inspect")}
              className={`rounded px-2 py-1 font-medium ${
                rightPanelTab === "inspect"
                  ? "bg-slate-900 text-white"
                  : isDarkTheme
                    ? "text-slate-300 hover:bg-slate-700"
                    : "text-slate-600 hover:bg-white"
              }`}
            >
              Inspect
            </button>
            <button
              onClick={() => setRightPanelTab("style")}
              className={`rounded px-2 py-1 font-medium ${
                rightPanelTab === "style"
                  ? "bg-slate-900 text-white"
                  : isDarkTheme
                    ? "text-slate-300 hover:bg-slate-700"
                    : "text-slate-600 hover:bg-white"
              }`}
            >
              Style
            </button>
            <button
              onClick={() => setRightPanelTab("export")}
              className={`rounded px-2 py-1 font-medium ${
                rightPanelTab === "export"
                  ? "bg-slate-900 text-white"
                  : isDarkTheme
                    ? "text-slate-300 hover:bg-slate-700"
                    : "text-slate-600 hover:bg-white"
              }`}
            >
              Export
            </button>
            <button
              onClick={() => setRightPanelTab("studio")}
              className={`rounded px-2 py-1 font-medium ${
                rightPanelTab === "studio"
                  ? "bg-slate-900 text-white"
                  : isDarkTheme
                    ? "text-slate-300 hover:bg-slate-700"
                    : "text-slate-600 hover:bg-white"
              }`}
            >
              Studio
            </button>
          </div>
          {rightPanelTab === "studio" && (
            <>
          <div className={`rounded-lg border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : "bg-slate-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Studio Settings</p>
            <label className="mt-2 block text-xs text-slate-600">
              Default Theme
              <select
                value={appPreferences.defaultTheme}
                onChange={(event) =>
                  setAppPreferences((prev) => ({
                    ...prev,
                    defaultTheme: event.target.value as "light" | "dark",
                  }))
                }
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "bg-white"
                }`}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              Default Performance
              <select
                value={appPreferences.defaultPerformanceMode}
                onChange={(event) =>
                  setAppPreferences((prev) => ({
                    ...prev,
                    defaultPerformanceMode: event.target.value as PerformanceMode,
                  }))
                }
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "bg-white"
                }`}
              >
                <option value="auto">Auto</option>
                <option value="quality">Quality</option>
                <option value="balanced">Balanced</option>
                <option value="performance">Performance</option>
              </select>
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              Default Export Name Template
              <input
                value={appPreferences.defaultExportFileTemplate}
                onChange={(event) =>
                  setAppPreferences((prev) => ({
                    ...prev,
                    defaultExportFileTemplate: event.target.value || "{title}-{date}",
                  }))
                }
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "bg-white"
                }`}
              />
            </label>
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={appPreferences.defaultExportTransparentBg}
                onChange={(event) =>
                  setAppPreferences((prev) => ({
                    ...prev,
                    defaultExportTransparentBg: event.target.checked,
                  }))
                }
              />
              Default export transparent background
            </label>
            <button
              onClick={() => {
                patchStyle({ theme: appPreferences.defaultTheme });
                setPerformanceMode(appPreferences.defaultPerformanceMode);
              }}
              className="mt-2 w-full rounded border bg-white px-2 py-1 text-xs font-medium text-slate-700"
            >
              Apply Defaults to Current Document
            </button>
          </div>

          <div className={`rounded-lg border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : "bg-slate-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Performance</p>
            <label className="mt-2 block text-xs text-slate-600">
              Mode
              <select
                value={performanceMode}
                onChange={(event) => setPerformanceMode(event.target.value as PerformanceMode)}
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "bg-white"
                }`}
              >
                <option value="auto">Auto</option>
                <option value="quality">Quality</option>
                <option value="balanced">Balanced</option>
                <option value="performance">Performance</option>
              </select>
            </label>
            <p className="mt-2 text-[11px] text-slate-500">
              Graph: {graphMetrics.nodes} nodes, {graphMetrics.links} links
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Effective: {effectivePerformanceMode}</p>
          </div>
            </>
          )}

          {rightPanelTab === "inspect" && (
            <>
          <div className={`rounded-lg border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : "bg-slate-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inspector</p>
            {selectedLink ? (
              <div className="mt-2 rounded border bg-white p-2 text-xs text-slate-700">
                <p className="font-medium text-slate-900">Link</p>
                <p className="mt-1">
                  {selectedLink.source} -&gt; {selectedLink.target}
                </p>
                <p className="text-slate-500">Value: {selectedLink.value}</p>
                <div className="mt-2">
                  <label className="text-[11px] text-slate-600">Link Color Override</label>
                  <input
                    type="color"
                    value={selectedLinkStyle?.color ?? "#3b82f6"}
                    onChange={(event) => patchSelectedLinkStyle({ color: event.target.value })}
                    className="mt-1 h-8 w-full rounded border bg-white p-1"
                  />
                </div>
                <label className="mt-2 block text-[11px] text-slate-600">
                  Link Opacity:{" "}
                  {Math.round(
                    (selectedLinkStyle?.opacity ?? currentDoc.style.linkOpacity) * 100,
                  )}
                  %
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={Math.round(
                      (selectedLinkStyle?.opacity ?? currentDoc.style.linkOpacity) * 100,
                    )}
                    onChange={(event) =>
                      patchSelectedLinkStyle({ opacity: Number(event.target.value) / 100 })
                    }
                    className="mt-1 w-full"
                  />
                </label>
                <label className="mt-2 block text-[11px] text-slate-600">
                  Link Width: {selectedLinkWidthScale.toFixed(2)}x
                  <input
                    type="range"
                    min={0.5}
                    max={2.5}
                    step={0.05}
                    value={selectedLinkWidthScale}
                    onChange={(event) =>
                      patchSelectedLinkStyle({ widthScale: Number(event.target.value) })
                    }
                    className="mt-1 w-full"
                  />
                </label>
                <button
                  onClick={clearSelectedLinkStyle}
                  className="mt-2 w-full rounded border px-2 py-1 text-[11px] text-slate-600"
                >
                  Reset Link Style
                </button>
                <button
                  onClick={() => setSelectedLinkIndex(null)}
                  className="mt-2 w-full rounded border px-2 py-1 text-[11px] text-slate-600"
                >
                  Clear Link Selection
                </button>
              </div>
            ) : selectedNodeIds.length > 0 ? (
              <div className="mt-2 rounded border bg-white p-2 text-xs text-slate-700">
                <p className="font-medium text-slate-900">
                  {selectedNodeIds.length === 1 ? "Node" : "Nodes"} ({selectedNodeIds.length})
                </p>
                {singleSelectedNodeId ? (
                  <p className="mt-1 text-slate-600">{singleSelectedNodeId}</p>
                ) : (
                  <p className="mt-1 text-slate-500">Batch selection</p>
                )}
                {selectedNodeSummary && (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded border bg-slate-50 px-2 py-1">
                      In: {selectedNodeSummary.inValue.toLocaleString()}
                    </div>
                    <div className="rounded border bg-slate-50 px-2 py-1">
                      Out: {selectedNodeSummary.outValue.toLocaleString()}
                    </div>
                  </div>
                )}
                {singleSelectedNodeId && (
                  <div className="mt-2">
                    <label className="text-[11px] text-slate-600">Node Color Override</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="color"
                        value={singleSelectedNodeColor || "#3b82f6"}
                        onChange={(event) => {
                          setSelectionColor(event.target.value);
                          applyNodeColorToSelection(event.target.value);
                        }}
                        className="h-8 w-10 rounded border bg-white p-1"
                      />
                      <button
                        onClick={clearNodeColorFromSelection}
                        className="flex-1 rounded border px-2 py-1 text-[11px] text-slate-600"
                      >
                        Remove Color Override
                      </button>
                    </div>
                    <label className="mt-2 block text-[11px] text-slate-600">
                      Node Opacity: {singleSelectedNodeOpacity}%
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={singleSelectedNodeOpacity}
                        onChange={(event) =>
                          applyNodeOpacityToSelection(Number(event.target.value) / 100)
                        }
                        className="mt-1 w-full"
                      />
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Select a node or link on canvas.</p>
            )}
          </div>

          <div className={`rounded-lg border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : "bg-slate-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selection</p>
            <p className="mt-2 text-xs text-slate-600">
              Selected nodes: {selectedNodeIds.length} {selectedLinkIndex != null ? "| 1 link" : ""}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1">
              <button
                onClick={() => setTraceMode("none")}
                className={`rounded border px-2 py-1 text-[11px] ${
                  traceMode === "none" ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-600"
                }`}
              >
                None
              </button>
              <button
                onClick={() => setTraceMode("upstream")}
                disabled={selectedNodeIds.length === 0}
                className={`rounded border px-2 py-1 text-[11px] ${
                  traceMode === "upstream"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "bg-white text-slate-600"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                Upstream
              </button>
              <button
                onClick={() => setTraceMode("downstream")}
                disabled={selectedNodeIds.length === 0}
                className={`rounded border px-2 py-1 text-[11px] ${
                  traceMode === "downstream"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "bg-white text-slate-600"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                Downstream
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="color"
                value={selectionColor}
                onChange={(event) => setSelectionColor(event.target.value)}
                className="h-8 w-10 rounded border bg-white p-1"
              />
              <button
                onClick={() => applyNodeColorToSelection(selectionColor)}
                disabled={selectedNodeIds.length === 0}
                className="flex-1 rounded border bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply Color to Selection
              </button>
            </div>
            <label className="mt-2 block text-xs text-slate-600">
              Node Opacity (Batch): {batchSelectionOpacityValue}%
              <input
                type="range"
                min={10}
                max={100}
                value={batchSelectionOpacityValue}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSelectionOpacity(next);
                  applyNodeOpacityToSelection(next / 100);
                }}
                className="mt-1 w-full"
              />
            </label>
            <button
              onClick={clearSelectedNodeStyles}
              disabled={selectedNodeIds.length === 0}
              className="mt-2 w-full rounded border bg-white px-2 py-1 text-xs text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset Selected Node Styles
            </button>
            <button
              onClick={clearSelection}
              disabled={selectedNodeIds.length === 0 && selectedLinkIndex == null}
              className="mt-2 w-full rounded border bg-white px-2 py-1 text-xs text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear Selection
            </button>
            <p className="mt-2 text-[10px] text-slate-500">
              Shift+click for multi-select, drag on blank canvas for box-select.
            </p>
          </div>
            </>
          )}

          {rightPanelTab === "style" && (
            <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Appearance</p>
            <label className="mt-2 block text-xs text-slate-600">
              Theme
              <select
                value={currentDoc.style.theme}
                onChange={(event) =>
                  patchStyle({ theme: event.target.value as "light" | "dark" })
                }
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "bg-white"
                }`}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              Palette
              <select
                value={currentDoc.style.palette}
                onChange={(event) =>
                  patchStyle({
                    palette: event.target.value as "classic" | "ocean" | "sunset",
                  })
                }
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "bg-white"
                }`}
              >
                <option value="classic">Classic</option>
                <option value="ocean">Ocean</option>
                <option value="sunset">Sunset</option>
              </select>
            </label>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Node</p>
            <label className="mt-2 block text-xs text-slate-600">
              Width: {currentDoc.style.nodeWidth}
              <input
                type="range"
                min={8}
                max={40}
                value={currentDoc.style.nodeWidth}
                onChange={(event) => patchStyle({ nodeWidth: Number(event.target.value) })}
                className="mt-1 w-full"
              />
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              Padding: {currentDoc.style.nodePadding}
              <input
                type="range"
                min={4}
                max={40}
                value={currentDoc.style.nodePadding}
                onChange={(event) => patchStyle({ nodePadding: Number(event.target.value) })}
                className="mt-1 w-full"
              />
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              Radius: {currentDoc.style.nodeRadius}
              <input
                type="range"
                min={0}
                max={14}
                value={currentDoc.style.nodeRadius}
                onChange={(event) => patchStyle({ nodeRadius: Number(event.target.value) })}
                className="mt-1 w-full"
              />
            </label>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Link</p>
            <label className="mt-2 block text-xs text-slate-600">
              Opacity: {Math.round(currentDoc.style.linkOpacity * 100)}%
              <input
                type="range"
                min={10}
                max={100}
                value={currentDoc.style.linkOpacity * 100}
                onChange={(event) => patchStyle({ linkOpacity: Number(event.target.value) / 100 })}
                className="mt-1 w-full"
              />
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              Curvature: {currentDoc.style.curvature.toFixed(2)}
              <input
                type="range"
                min={0.2}
                max={0.8}
                step={0.05}
                value={currentDoc.style.curvature}
                onChange={(event) => patchStyle({ curvature: Number(event.target.value) })}
                className="mt-1 w-full"
              />
            </label>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={currentDoc.style.showLabels}
              onChange={(event) => patchStyle({ showLabels: event.target.checked })}
            />
            Show labels
          </label>
          <label className="block text-xs text-slate-600">
            Label Font Size: {currentDoc.style.labelFontSize}px
            <input
              type="range"
              min={9}
              max={18}
              value={currentDoc.style.labelFontSize}
              onChange={(event) => patchStyle({ labelFontSize: Number(event.target.value) })}
              className="mt-1 w-full"
            />
          </label>
          <label className="block text-xs text-slate-600">
            Label Font
            <select
              value={currentDoc.style.labelFontFamily}
              onChange={(event) =>
                patchStyle({
                  labelFontFamily: event.target.value as
                    | "Roboto"
                    | "Google Sans"
                    | "System Sans",
                })
              }
              className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                isDarkTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "bg-white"
              }`}
            >
              <option value="Roboto">Roboto</option>
              <option value="Google Sans">Google Sans</option>
              <option value="System Sans">System Sans</option>
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            Label Color
            <input
              type="color"
              value={currentDoc.style.labelColor}
              onChange={(event) => patchStyle({ labelColor: event.target.value })}
              className="mt-1 h-8 w-full rounded border bg-white p-1"
            />
          </label>
          <label className="block text-xs text-slate-600">
            Label Position
            <select
              value={currentDoc.style.labelPosition}
              onChange={(event) =>
                patchStyle({ labelPosition: event.target.value as "inside" | "outside" })
              }
              className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                isDarkTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "bg-white"
              }`}
            >
              <option value="outside">Outside</option>
              <option value="inside">Inside</option>
            </select>
          </label>

            </>
          )}
          {rightPanelTab === "export" && (
          <div className={`rounded-lg border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : "bg-slate-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Export Settings</p>
            {exportPreviewUrl && (
              <div className="mt-2 overflow-hidden rounded border bg-white p-1">
                <NextImage
                  src={exportPreviewUrl}
                  alt="Export preview"
                  width={240}
                  height={96}
                  unoptimized
                  className="h-24 w-full rounded object-contain"
                />
              </div>
            )}
            <div className="mt-2 space-y-1">
              {allExportPresets.map((preset) => {
                const builtIn = DEFAULT_EXPORT_PRESETS.some((item) => item.id === preset.id);
                return (
                  <div key={preset.id} className="flex items-center gap-1">
                    <button
                      onClick={() => applyExportPreset(preset)}
                      className="flex-1 rounded border bg-white px-2 py-1 text-left text-[10px] font-medium text-slate-700"
                    >
                      {preset.name} ({preset.width}x{preset.height}, p{preset.padding ?? 0}, {preset.pngScale ?? 1}x)
                    </button>
                    {!builtIn && (
                      <button
                        onClick={() => removeCustomPreset(preset.id)}
                        className="rounded border bg-white p-1 text-slate-500 hover:text-red-600"
                        title="Delete preset"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-1">
              <input
                value={newPresetName}
                onChange={(event) => setNewPresetName(event.target.value)}
                placeholder="New preset name"
                className={`flex-1 rounded border px-2 py-1 text-[11px] ${
                  isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "bg-white"
                }`}
              />
              <button
                onClick={saveCurrentAsPreset}
                className="rounded border bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
              >
                Save
              </button>
            </div>
            <label className="mt-2 block text-xs text-slate-600">
              Width
              <input
                type="number"
                min={400}
                max={6000}
                value={exportWidth}
                onChange={(event) => setExportWidth(Number(event.target.value) || 1200)}
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "bg-white"
                }`}
              />
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              Height
              <input
                type="number"
                min={300}
                max={6000}
                value={exportHeight}
                onChange={(event) => setExportHeight(Number(event.target.value) || 700)}
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "bg-white"
                }`}
              />
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              Padding
              <input
                type="number"
                min={0}
                max={300}
                value={exportPadding}
                onChange={(event) => setExportPadding(Math.max(0, Number(event.target.value) || 0))}
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "bg-white"
                }`}
              />
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              PNG Scale
              <select
                value={exportPngScale}
                onChange={(event) => setExportPngScale(Number(event.target.value))}
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "bg-white"
                }`}
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={3}>3x</option>
                <option value={4}>4x</option>
              </select>
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              File Name Template
              <input
                value={exportFileTemplate}
                onChange={(event) => setExportFileTemplate(event.target.value)}
                className={`mt-1 w-full rounded border px-2 py-1 text-xs ${
                  isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "bg-white"
                }`}
                placeholder="{title}-{date}"
              />
              <span className="mt-1 block text-[10px] text-slate-400">
                Use {"{title}"} and {"{date}"}
              </span>
            </label>
            <div className="mt-2 rounded border bg-white p-2">
              <p className="text-[11px] font-medium text-slate-600">Export All Options</p>
              <div className="mt-1 grid grid-cols-3 gap-1 text-[11px] text-slate-600">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={exportAllFormats.svg}
                    onChange={(event) =>
                      setExportAllFormats((prev) => ({ ...prev, svg: event.target.checked }))
                    }
                  />
                  SVG
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={exportAllFormats.png}
                    onChange={(event) =>
                      setExportAllFormats((prev) => ({ ...prev, png: event.target.checked }))
                    }
                  />
                  PNG
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={exportAllFormats.html}
                    onChange={(event) =>
                      setExportAllFormats((prev) => ({ ...prev, html: event.target.checked }))
                    }
                  />
                  HTML
                </label>
              </div>
              <label className="mt-2 block text-[11px] text-slate-600">
                Naming
                <select
                  value={exportAllNamingMode}
                  onChange={(event) => setExportAllNamingMode(event.target.value as "same" | "suffix")}
                  className="mt-1 w-full rounded border px-2 py-1 text-[11px]"
                >
                  <option value="suffix">Append format suffix</option>
                  <option value="same">Use same base name</option>
                </select>
              </label>
            </div>
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={exportTransparentBg}
                onChange={(event) => setExportTransparentBg(event.target.checked)}
              />
              Transparent background (PNG/HTML/SVG)
            </label>
          </div>
          )}
        </aside>
      </div>
    </div>
  );
}









