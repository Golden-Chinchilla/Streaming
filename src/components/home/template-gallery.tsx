"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileUp, Plus, Search, Trash2 } from "lucide-react";
import {
  clearRecentTemplateIds,
  deleteUserTemplate,
  deleteUserTemplates,
  loadRecentDocuments,
  loadRecentTemplateIds,
  loadUserTemplates,
  saveCurrentDocument,
  saveRecentDocument,
  setCurrentDocumentId,
  upsertDocument,
  upsertUserTemplate,
} from "@/lib/storage";
import {
  TableMapping,
  TablePreview,
  linksToCanonicalCsv,
  linksToCanonicalJson,
  parseCsvPreview,
  parseJsonPreview,
  parseXlsxPreview,
  transformRowsToCanonicalLinks,
} from "@/lib/source-import";
import { blankDocument, templateList } from "@/lib/templates";
import { DataFormat, SankeyDocument, TemplateSummary } from "@/lib/types";
import { AppIssue } from "@/lib/issues";
import { ImportMappingModal } from "@/components/home/import-mapping-modal";
import { IssueCenter } from "@/components/common/issue-center";
import { useAppDialog } from "@/components/common/app-dialog";
import {
  buttonPrimaryMd,
  buttonSecondarySm,
  buttonSecondaryTiny,
  buttonDangerSoftTiny,
  emptyStatePanelLg,
  withDisabled,
} from "@/components/common/interaction-styles";

type SortMode = "name" | "difficulty" | "category";
type SourceMode = "all" | "user" | "builtin";
type DifficultyFilter = "All" | "Easy" | "Medium" | "Advanced";

type UploadFeedback = {
  kind: "error" | "success";
  title: string;
  details: string[];
};

type PendingImport = {
  fileName: string;
  preview: TablePreview;
  outputFormat: DataFormat;
};

type MappingPreset = {
  id: string;
  name: string;
  mode: "csv" | "json";
  mapping: TableMapping;
  createdAt: number;
  lastUsedAt?: number;
};

const difficultyRank: Record<string, number> = {
  Easy: 1,
  Medium: 2,
  Advanced: 3,
};

const MAPPING_PRESETS_STORAGE_KEY = "streaming-mapping-presets-v1";

function detectFileFormat(fileName: string): DataFormat | "xlsx" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".xlsx")) return "xlsx";
  return null;
}

export function TemplateGallery() {
  const { confirm, prompt, dialogNode } = useAppDialog();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [sourceMode, setSourceMode] = useState<SourceMode>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("All");
  const [tagFilter, setTagFilter] = useState("All");
  const [recentDocs, setRecentDocs] = useState<SankeyDocument[]>([]);
  const [recentTemplateIds, setRecentTemplateIds] = useState<string[]>([]);
  const [userTemplates, setUserTemplates] = useState<TemplateSummary[]>([]);
  const [selectedUserTemplateIds, setSelectedUserTemplateIds] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<UploadFeedback | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [pendingMapping, setPendingMapping] = useState<TableMapping>({ source: "", target: "", value: "" });
  const [pendingValuePolicy, setPendingValuePolicy] = useState<"drop" | "clamp">("drop");
  const [pendingMinValue, setPendingMinValue] = useState(1);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetSearch, setPresetSearch] = useState("");
  const [mappingPresets, setMappingPresets] = useState<MappingPreset[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const rawValue = window.localStorage.getItem(MAPPING_PRESETS_STORAGE_KEY);
      if (!rawValue) return [];
      const parsed = JSON.parse(rawValue) as MappingPreset[];
      return parsed.filter((item) =>
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
  const router = useRouter();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const refreshData = async () => {
    const [items, templateIds, templates] = await Promise.all([
      loadRecentDocuments(),
      loadRecentTemplateIds(),
      loadUserTemplates(),
    ]);
    setRecentDocs(items);
    setRecentTemplateIds(templateIds);
    setUserTemplates(templates);
  };
  const importFromFile = async (file: File) => {
    const detected = detectFileFormat(file.name);
    if (!detected) {
      setUploadFeedback({
        kind: "error",
        title: "Unsupported file type",
        details: ["Only CSV, JSON, and XLSX are supported."],
      });
      return;
    }

    setUploadFeedback(null);
    setIsUploading(true);
    try {
      const preview =
        detected === "json"
          ? parseJsonPreview(await file.text())
          : detected === "csv"
            ? parseCsvPreview(await file.text())
            : parseXlsxPreview(await file.arrayBuffer());

      setPendingImport({
        fileName: file.name,
        preview,
        outputFormat: detected === "json" ? "json" : "csv",
      });
      setPendingMapping(preview.mapping);
      setPendingValuePolicy("drop");
      setPendingMinValue(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse file";
      setUploadFeedback({
        kind: "error",
        title: "Import failed",
        details: [message],
      });
    } finally {
      setIsUploading(false);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
    }
  };

  const confirmPendingImport = async () => {
    if (!pendingImport) return;

    const transformed = transformRowsToCanonicalLinks(pendingImport.preview.rows, pendingMapping, {
      valuePolicy: pendingValuePolicy,
      minValue: pendingMinValue,
    });

    if (transformed.links.length === 0) {
      setUploadFeedback({
        kind: "error",
        title: "No valid rows after mapping",
        details: [
          `Headers detected: ${pendingImport.preview.headers.join(", ") || "(none)"}`,
          `Mapped columns: source=${pendingMapping.source || "(empty)"}, target=${pendingMapping.target || "(empty)"}, value=${pendingMapping.value || "(empty)"}`,
          `Rows: total ${transformed.stats.totalRows}, dropped ${transformed.stats.droppedRows}, output ${transformed.stats.outputRows}`,
          "Please check source/target/value columns and ensure value is a positive number.",
        ],
      });
      return;
    }

    const editorText =
      pendingImport.outputFormat === "json"
        ? linksToCanonicalJson(transformed.links)
        : linksToCanonicalCsv(transformed.links);
    const title =
      (pendingImport.fileName.replace(/\.[^/.]+$/, "").trim() || "Imported Diagram").slice(0, 80);
    const now = Date.now();
    const nextDoc: SankeyDocument = {
      ...blankDocument,
      id: crypto.randomUUID(),
      title,
      format: pendingImport.outputFormat,
      editorText,
      updatedAt: now,
    };

    setUploadFeedback({
      kind: "success",
      title: "Import successful",
      details: [
        `${transformed.links.length} links generated from ${transformed.stats.totalRows} rows.`,
        `Dropped rows: ${transformed.stats.droppedRows}.`,
      ],
    });

    await Promise.all([
      upsertDocument(nextDoc),
      saveCurrentDocument(nextDoc),
      saveRecentDocument(nextDoc),
      setCurrentDocumentId(nextDoc.id),
    ]);

    setPendingImport(null);
    await refreshData();
    router.push(`/editor?doc=${encodeURIComponent(nextDoc.id)}`);
  };

  const onUploadInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await importFromFile(file);
  };

  const closePendingImport = () => {
    setPendingImport(null);
  };

  const pendingMode = pendingImport?.outputFormat ?? "csv";
  const mappingPresetsForMode = useMemo(
    () =>
      mappingPresets
        .filter((preset) => preset.mode === pendingMode)
        .sort(
          (a, b) =>
            (b.lastUsedAt ?? b.createdAt ?? 0) -
            (a.lastUsedAt ?? a.createdAt ?? 0),
        ),
    [mappingPresets, pendingMode],
  );
  const filteredMappingPresetsForMode = useMemo(() => {
    const keyword = presetSearch.trim().toLowerCase();
    if (!keyword) return mappingPresetsForMode;
    return mappingPresetsForMode.filter((preset) => preset.name.toLowerCase().includes(keyword));
  }, [mappingPresetsForMode, presetSearch]);
  const presetCompatibilityById = useMemo(() => {
    const headers = new Set(pendingImport?.preview.headers ?? []);
    const status: Record<string, boolean> = {};
    for (const preset of mappingPresetsForMode) {
      status[preset.id] =
        headers.has(preset.mapping.source) &&
        headers.has(preset.mapping.target) &&
        headers.has(preset.mapping.value);
    }
    return status;
  }, [mappingPresetsForMode, pendingImport?.preview.headers]);
  const selectedPresetCompatible = selectedPresetId
    ? (presetCompatibilityById[selectedPresetId] ?? false)
    : false;

  const savePendingMappingPreset = async () => {
    if (!pendingImport) return;
    const entered = await prompt({
      title: "Save mapping preset",
      defaultValue: `${pendingImport.outputFormat.toUpperCase()} mapping`,
      confirmLabel: "Save",
    });
    const name = entered?.trim();
    if (!name) return;
    const now = Date.now();
    const preset: MappingPreset = {
      id: crypto.randomUUID(),
      name,
      mode: pendingImport.outputFormat,
      mapping: { ...pendingMapping },
      createdAt: now,
      lastUsedAt: now,
    };
    setMappingPresets((prev) => [preset, ...prev].slice(0, 30));
    setSelectedPresetId(preset.id);
  };

  const renameSelectedPreset = async () => {
    if (!selectedPresetId) return;
    const current = mappingPresets.find((preset) => preset.id === selectedPresetId);
    if (!current) return;
    const entered = await prompt({
      title: "Rename preset",
      defaultValue: current.name,
      confirmLabel: "Rename",
    });
    const nextName = entered?.trim();
    if (!nextName || nextName === current.name) return;
    setMappingPresets((prev) =>
      prev.map((preset) =>
        preset.id === selectedPresetId
          ? {
              ...preset,
              name: nextName,
            }
          : preset,
      ),
    );
  };

  const applySelectedPreset = () => {
    if (!selectedPresetId) return;
    if (!selectedPresetCompatible) {
      setUploadFeedback({
        kind: "error",
        title: "Preset incompatible with current file",
        details: ["Preset columns are not all present in this dataset."],
      });
      return;
    }
    const preset = mappingPresetsForMode.find((item) => item.id === selectedPresetId);
    if (!preset) return;

    const now = Date.now();
    setMappingPresets((prev) => {
      const target = prev.find((item) => item.id === selectedPresetId);
      if (!target) return prev;
      const updated = { ...target, lastUsedAt: now };
      return [updated, ...prev.filter((item) => item.id !== selectedPresetId)];
    });
    setPendingMapping({ ...preset.mapping });
  };

  const deleteSelectedPreset = () => {
    if (!selectedPresetId) return;
    setMappingPresets((prev) => prev.filter((preset) => preset.id !== selectedPresetId));
    setSelectedPresetId("");
  };

  const clearPresetsForMode = async () => {
    const count = mappingPresetsForMode.length;
    if (count === 0) return;
    const confirmed = await confirm({
      title: `Delete all ${pendingMode.toUpperCase()} presets?`,
      message: `${count} preset(s) will be removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    setMappingPresets((prev) => prev.filter((preset) => preset.mode !== pendingMode));
    setSelectedPresetId("");
  };

  useEffect(() => {
    let mounted = true;
    Promise.all([loadRecentDocuments(), loadRecentTemplateIds(), loadUserTemplates()]).then(
      ([items, templateIds, templates]) => {
        if (!mounted) return;
        setRecentDocs(items);
        setRecentTemplateIds(templateIds);
        setUserTemplates(templates);
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MAPPING_PRESETS_STORAGE_KEY, JSON.stringify(mappingPresets));
  }, [mappingPresets]);

  useEffect(() => {
    if (!pendingImport) {
      setSelectedPresetId("");
      return;
    }
    const hasSelected = mappingPresets.some((preset) => preset.id === selectedPresetId);
    if (!hasSelected) {
      setSelectedPresetId("");
    }
  }, [mappingPresets, pendingImport, selectedPresetId]);

  useEffect(() => {
    if (!pendingImport) {
      setPresetSearch("");
    }
  }, [pendingImport]);

  const resetFilters = () => {
    setSearch("");
    setCategory("All");
    setSortMode("name");
    setSourceMode("all");
    setDifficultyFilter("All");
    setTagFilter("All");
  };

  const userTemplateIdSet = useMemo(() => {
    return new Set(userTemplates.map((item) => item.id));
  }, [userTemplates]);

  const effectiveSelectedUserTemplateIds = useMemo(() => {
    return selectedUserTemplateIds.filter((id) => userTemplateIdSet.has(id));
  }, [selectedUserTemplateIds, userTemplateIdSet]);
  const allTemplates = useMemo<TemplateSummary[]>(() => {
    return [...templateList, ...userTemplates];
  }, [userTemplates]);

  const categories = useMemo(() => {
    return ["All", ...new Set(allTemplates.map((template) => template.category))];
  }, [allTemplates]);

  const tags = useMemo(() => {
    return [
      "All",
      ...new Set(
        allTemplates
          .flatMap((template) => template.tags ?? [])
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
  }, [allTemplates]);

  const filteredTemplates = useMemo<TemplateSummary[]>(() => {
    const keyword = search.trim().toLowerCase();
    const filtered = allTemplates.filter((template) => {
      const isUser = template.id.startsWith("user-");
      const matchSource =
        sourceMode === "all" || (sourceMode === "user" ? isUser : !isUser);
      if (!matchSource) return false;

      const matchCategory = category === "All" || template.category === category;
      if (!matchCategory) return false;

      const matchDifficulty = difficultyFilter === "All" || template.difficulty === difficultyFilter;
      if (!matchDifficulty) return false;

      const normalizedTags = (template.tags ?? []).map((tag) => tag.toLowerCase());
      const matchTag = tagFilter === "All" || normalizedTags.includes(tagFilter.toLowerCase());
      if (!matchTag) return false;
      if (!keyword) return true;
      return (
        template.name.toLowerCase().includes(keyword) ||
        template.description.toLowerCase().includes(keyword) ||
        template.category.toLowerCase().includes(keyword)
        || normalizedTags.some((tag) => tag.includes(keyword))
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === "difficulty") {
        return difficultyRank[a.difficulty] - difficultyRank[b.difficulty];
      }
      if (sortMode === "category") {
        return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [allTemplates, category, difficultyFilter, search, sortMode, sourceMode, tagFilter]);

  const recentTemplates = useMemo(() => {
    if (recentTemplateIds.length === 0) return [] as TemplateSummary[];
    const rank = new Map(recentTemplateIds.map((id, index) => [id, index]));
    return allTemplates
      .filter((template) => rank.has(template.id))
      .sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }, [allTemplates, recentTemplateIds]);

  const userTemplateIdsInFiltered = useMemo(() => {
    return filteredTemplates
      .filter((template) => template.id.startsWith("user-"))
      .map((template) => template.id);
  }, [filteredTemplates]);

  const allFilteredUsersSelected =
    userTemplateIdsInFiltered.length > 0 &&
    userTemplateIdsInFiltered.every((id) => effectiveSelectedUserTemplateIds.includes(id));

  const toggleSelectAllFilteredUsers = () => {
    if (allFilteredUsersSelected) {
      setSelectedUserTemplateIds((prev) =>
        prev.filter((id) => !userTemplateIdsInFiltered.includes(id)),
      );
      return;
    }
    setSelectedUserTemplateIds((prev) => {
      const next = new Set(prev);
      for (const id of userTemplateIdsInFiltered) next.add(id);
      return Array.from(next);
    });
  };

  const removeUserTemplate = async (templateId: string) => {
    const confirmed = await confirm({
      title: "Delete template?",
      message: "This action cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    await deleteUserTemplate(templateId);
    await refreshData();
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
    setSelectedUserTemplateIds([]);
    await refreshData();
  };

  const clearRecentTemplates = async () => {
    if (recentTemplateIds.length === 0) return;
    const confirmed = await confirm({
      title: "Clear recent templates?",
      message: "Only the recent history will be removed. Template files remain unchanged.",
      confirmLabel: "Clear",
      tone: "danger",
    });
    if (!confirmed) return;
    await clearRecentTemplateIds();
    setRecentTemplateIds([]);
  };

  const editUserTemplate = async (template: TemplateSummary) => {
    const nameInput = await prompt({
      title: "Template name",
      defaultValue: template.name,
      confirmLabel: "Next",
    });
    const name = nameInput?.trim();
    if (!name) return;

    const categoryInput = await prompt({
      title: "Template category",
      defaultValue: template.category,
      confirmLabel: "Next",
    });
    if (categoryInput == null) return;
    const category = categoryInput.trim() || "Custom";

    const descriptionInput = await prompt({
      title: "Template description",
      defaultValue: template.description,
      confirmLabel: "Next",
    });
    if (descriptionInput == null) return;
    const description = descriptionInput.trim() || "Custom template from current document";

    const tagsInputValue = await prompt({
      title: "Template tags",
      message: "Comma separated",
      defaultValue: (template.tags ?? []).join(", "),
      confirmLabel: "Save",
    });
    if (tagsInputValue == null) return;
    const tags = Array.from(
      new Set(
        tagsInputValue
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),
    );

    const updated: TemplateSummary = {
      ...template,
      name,
      category,
      description,
      tags: tags.length > 0 ? tags : undefined,
    };
    await upsertUserTemplate(updated);
    await refreshData();
  };

  const uploadIssues = useMemo<AppIssue[]>(() => {
    if (!uploadFeedback) return [];
    return [
      {
        id: "home-upload-feedback",
        level: uploadFeedback.kind === "error" ? "error" : "success",
        title: uploadFeedback.title,
        details: uploadFeedback.details,
      },
    ];
  }, [uploadFeedback]);

  const pendingPreviewStats = useMemo(() => {
    if (!pendingImport) return null;
    return transformRowsToCanonicalLinks(pendingImport.preview.rows, pendingMapping, {
      valuePolicy: pendingValuePolicy,
      minValue: pendingMinValue,
    }).stats;
  }, [pendingImport, pendingMapping, pendingMinValue, pendingValuePolicy]);

  const galleryCardClass = "rounded-xl border bg-white px-4 py-3 shadow-sm transition hover:border-blue-300";
  const infoChipClass = "rounded border bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600";
  const tagChipClass = "rounded border bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600";
  const filterSelectClass = "rounded-lg border bg-white px-3 py-2 text-sm";
  const tinyNeutralButtonClass = buttonSecondaryTiny;
  const dangerBulkButtonClass = withDisabled("rounded-lg border px-3 py-2 text-sm text-red-600 transition hover:bg-red-50");
  const deleteSelectedDisabledReason = "Select at least one custom template to enable bulk delete.";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1500px] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-sm font-bold text-blue-600">
              ST
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Streaming</p>
              <p className="text-xs text-slate-500">Professional Diagram Editor</p>
            </div>
          </div>
          <Link
            href="/editor"
            className={`inline-flex items-center gap-2 ${buttonPrimaryMd}`}
          >
            Continue Editing
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] px-6 py-8">
        {recentDocs.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-medium text-slate-900">Recent diagrams</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {recentDocs.slice(0, 4).map((doc) => (
                <Link
                  key={doc.id}
                  href={`/editor?doc=${encodeURIComponent(doc.id)}`}
                  className={galleryCardClass}
                >
                  <p className="text-sm font-semibold text-slate-900">{doc.title || "Untitled Diagram"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {doc.format.toUpperCase()} | {new Date(doc.updatedAt).toLocaleString()}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {recentTemplates.length > 0 && (
          <section className="mb-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium text-slate-900">Recent templates</h2>
              <button
                onClick={() => void clearRecentTemplates()}
                className={`inline-flex items-center gap-1 ${buttonSecondarySm}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Recent
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {recentTemplates.slice(0, 6).map((template) => {
                const isUser = template.id.startsWith("user-");
                return (
                  <Link
                    key={template.id}
                    href={`/editor?template=${encodeURIComponent(template.id)}`}
                    className={galleryCardClass}
                  >
                    <p className="text-sm font-semibold text-slate-900">{template.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className={infoChipClass}>
                        {template.difficulty}
                      </span>
                      <span className={infoChipClass}>
                        {isUser ? "My template" : "Built-in"}
                      </span>
                      <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        Recent
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">Category: {template.category}</p>
                    <p className="mt-1 text-xs text-slate-500">{template.description}</p>
                    {(template.tags ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(template.tags ?? []).slice(0, 4).map((tag) => (
                          <span
                            key={`${template.id}-recent-tag-${tag}`}
                            className={tagChipClass}
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <section className="mb-8">
          <h2 className="mb-4 text-lg font-medium text-slate-900">Start a new diagram</h2>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".csv,.json,.xlsx"
            className="hidden"
            onChange={onUploadInputChange}
          />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Link
              href="/editor"
              className="group rounded-2xl border border-dashed border-slate-300 bg-white p-6 shadow-sm transition hover:border-blue-400 hover:shadow-md"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700 group-hover:bg-blue-600 group-hover:text-white">
                <Plus className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">Blank Diagram</h3>
              <p className="mt-1 text-sm text-slate-500">Start from scratch and import your data.</p>
            </Link>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={isUploading}
              title={isUploading ? "Import in progress. Please wait." : "Upload CSV / JSON / XLSX"}
              className="group rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-left shadow-sm transition hover:border-emerald-400 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white">
                <FileUp className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">Upload Data</h3>
              <p className="mt-1 text-sm text-slate-500">
                {isUploading ? "Importing..." : "Upload CSV / JSON / XLSX and jump into editor."}
              </p>
            </button>
          </div>
                      <IssueCenter issues={uploadIssues} className="mt-4" />
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[280px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search templates"
                className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm outline-none ring-0 transition focus:border-blue-300"
              />
            </div>
            <select
              value={sourceMode}
              onChange={(event) => setSourceMode(event.target.value as SourceMode)}
              className={filterSelectClass}
            >
              <option value="all">Source: All</option>
              <option value="user">Source: My templates</option>
              <option value="builtin">Source: Built-in</option>
            </select>
            <select
              value={difficultyFilter}
              onChange={(event) => setDifficultyFilter(event.target.value as DifficultyFilter)}
              className={filterSelectClass}
            >
              <option value="All">Difficulty: All</option>
              <option value="Easy">Difficulty: Easy</option>
              <option value="Medium">Difficulty: Medium</option>
              <option value="Advanced">Difficulty: Advanced</option>
            </select>
            <select
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              className={filterSelectClass}
            >
              {tags.map((tag) => (
                <option key={`tag-filter-${tag}`} value={tag}>
                  Tag: {tag}
                </option>
              ))}
            </select>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className={filterSelectClass}
            >
              <option value="name">Sort: Name</option>
              <option value="difficulty">Sort: Difficulty</option>
              <option value="category">Sort: Category</option>
            </select>
            <button
              onClick={() => void removeSelectedUserTemplates()}
              disabled={effectiveSelectedUserTemplateIds.length === 0}
              className={dangerBulkButtonClass}
              title={effectiveSelectedUserTemplateIds.length === 0 ? deleteSelectedDisabledReason : "Delete selected custom templates"}
            >
              Delete selected ({effectiveSelectedUserTemplateIds.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {categories.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  category === item
                    ? "bg-slate-900 text-white"
                    : "border bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {item}
              </button>
            ))}
            {sourceMode === "user" && userTemplateIdsInFiltered.length > 0 && (
              <button
                onClick={toggleSelectAllFilteredUsers}
                className={buttonSecondaryTiny}
              >
                {allFilteredUsersSelected ? "Clear selection" : "Select all"}
              </button>
            )}
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-slate-900">Featured Templates</h2>
            <p className="text-sm text-slate-500">{filteredTemplates.length} templates</p>
          </div>

          {filteredTemplates.length === 0 ? (
            <div className={emptyStatePanelLg}>
              <p className="text-base font-medium text-slate-900">No templates found</p>
              <p className="mt-1 text-sm text-slate-500">
                Try another keyword or reset filters to view all templates.
              </p>
              <button
                onClick={resetFilters}
                className={`mt-4 ${buttonPrimaryMd}`}
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {filteredTemplates.map((template) => {
                const isUser = template.id.startsWith("user-");
                const selected = effectiveSelectedUserTemplateIds.includes(template.id);
                const isRecent = recentTemplateIds.includes(template.id);
                return (
                  <Link
                    key={template.id}
                    href={`/editor?template=${encodeURIComponent(template.id)}`}
                    className="group overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:border-blue-300 hover:shadow-lg"
                  >
                    <div className={`relative h-44 bg-gradient-to-br ${template.accent} p-5 text-white`}>
                      <span className="rounded-md bg-white/20 px-2 py-1 text-[11px] font-semibold uppercase">
                        {template.difficulty}
                      </span>
                      <span className="ml-2 rounded-md bg-black/20 px-2 py-1 text-[10px] font-semibold uppercase">
                        {isUser ? "My template" : "Built-in"}
                      </span>
                      {isRecent && (
                        <span className="ml-2 rounded-md bg-blue-500/30 px-2 py-1 text-[10px] font-semibold uppercase">
                          Recent
                        </span>
                      )}
                      <div className="absolute bottom-4 left-5 right-5">
                        <p className="text-sm opacity-85">{template.category}</p>
                        <h3 className="text-xl font-semibold">{template.name}</h3>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={infoChipClass}>
                          {template.difficulty}
                        </span>
                        <span className={infoChipClass}>
                          {isUser ? "My template" : "Built-in"}
                        </span>
                        {isRecent && (
                          <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                            Recent
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">Category: {template.category}</p>
                      <p className="mt-1 text-sm text-slate-500">{template.description}</p>
                      {(template.tags ?? []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(template.tags ?? []).slice(0, 4).map((tag) => (
                            <span
                              key={`${template.id}-tag-${tag}`}
                              className={tagChipClass}
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-blue-600">
                        Use template
                        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                      </div>
                      {isUser && (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onChange={() => {
                              setSelectedUserTemplateIds((prev) => {
                                if (prev.includes(template.id)) {
                                  return prev.filter((id) => id !== template.id);
                                }
                                return [...prev, template.id];
                              });
                            }}
                          />
                          <button
                            onClick={(event) => {
                              event.preventDefault();
                              void editUserTemplate(template);
                            }}
                            className={tinyNeutralButtonClass}
                          >
                            Edit
                          </button>
                          <button
                            onClick={(event) => {
                              event.preventDefault();
                              void removeUserTemplate(template.id);
                            }}
                            className={buttonDangerSoftTiny}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {pendingImport && (
        <ImportMappingModal
          fileName={pendingImport.fileName}
          headers={pendingImport.preview.headers}
          pendingMode={pendingMode}
          presetSearch={presetSearch}
          onPresetSearchChange={setPresetSearch}
          canClearModePresets={mappingPresetsForMode.length > 0}
          onClearModePresets={() => void clearPresetsForMode()}
          presets={filteredMappingPresetsForMode.map((preset) => ({
            id: preset.id,
            name: preset.name,
            compatible: presetCompatibilityById[preset.id] ?? false,
          }))}
          selectedPresetId={selectedPresetId}
          onSelectedPresetIdChange={setSelectedPresetId}
          selectedPresetCompatible={selectedPresetCompatible}
          onApplyPreset={applySelectedPreset}
          onSavePreset={() => void savePendingMappingPreset()}
          onRenamePreset={() => void renameSelectedPreset()}
          onDeletePreset={deleteSelectedPreset}
          pendingMapping={pendingMapping}
          onPendingMappingChange={setPendingMapping}
          pendingValuePolicy={pendingValuePolicy}
          onPendingValuePolicyChange={setPendingValuePolicy}
          pendingMinValue={pendingMinValue}
          onPendingMinValueChange={setPendingMinValue}
          pendingPreviewStats={pendingPreviewStats}
          onClose={closePendingImport}
          onConfirm={() => void confirmPendingImport()}
        />
      )}

      {dialogNode}
    </div>
  );
}










































































































