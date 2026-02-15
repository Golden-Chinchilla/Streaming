"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, ChevronUp, Moon, Plus, Search, Sun, Trash2 } from "lucide-react";
import {
  clearRecentTemplateIds,
  deleteDocumentById,
  deleteUserTemplate,
  deleteUserTemplates,
  loadAppPreferences,
  loadRecentDocuments,
  loadRecentTemplateIds,
  loadUserTemplates,
  saveAppPreferences,
  upsertUserTemplate,
} from "@/lib/storage";
import { templateList } from "@/lib/templates";
import { SankeyDocument, TemplateSummary } from "@/lib/types";
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

const difficultyRank: Record<string, number> = {
  Easy: 1,
  Medium: 2,
  Advanced: 3,
};

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function TemplateGallery() {
  const { confirm, prompt, dialogNode } = useAppDialog();
  const [homeTheme, setHomeTheme] = useState<"light" | "dark">("dark");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [sourceMode, setSourceMode] = useState<SourceMode>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("All");
  const [tagFilter, setTagFilter] = useState("All");
  const [showRecentTemplatesInWorkspace, setShowRecentTemplatesInWorkspace] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [recentDocs, setRecentDocs] = useState<SankeyDocument[]>([]);
  const [recentTemplateIds, setRecentTemplateIds] = useState<string[]>([]);
  const [userTemplates, setUserTemplates] = useState<TemplateSummary[]>([]);
  const [selectedUserTemplateIds, setSelectedUserTemplateIds] = useState<string[]>([]);
  const router = useRouter();

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

  useEffect(() => {
    let mounted = true;
    loadAppPreferences().then((prefs) => {
      if (!mounted) return;
      const nextTheme = prefs.defaultTheme === "light" ? "light" : "dark";
      setHomeTheme(nextTheme);
      document.documentElement.setAttribute("data-theme", nextTheme);
    });
    return () => {
      mounted = false;
    };
  }, []);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target !== document.body) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      event.preventDefault();
      router.push("/editor");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

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

  const deleteRecentDocument = async (doc: SankeyDocument) => {
    const confirmed = await confirm({
      title: "Delete recent document?",
      message: `This will permanently delete "${doc.title || "Untitled Diagram"}".`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    await deleteDocumentById(doc.id);
    setRecentDocs((current) => current.filter((item) => item.id !== doc.id));
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

  const toggleHomeTheme = async () => {
    const nextTheme = homeTheme === "dark" ? "light" : "dark";
    setHomeTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    const prefs = await loadAppPreferences();
    await saveAppPreferences({
      ...prefs,
      defaultTheme: nextTheme,
    });
  };

  const galleryCardClass = "glass rounded-2xl px-4 py-3 shadow-sm transition hover:border-indigo-300/50";
  const filterSelectClass = "rounded-lg border border-slate-600/70 bg-slate-900/70 px-3 py-2 text-sm text-slate-200";
  const tinyNeutralButtonClass = buttonSecondaryTiny;
  const dangerBulkButtonClass = withDisabled("rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300 transition hover:bg-rose-500/20");
  const deleteSelectedDisabledReason = "Select at least one custom template to enable bulk delete.";

  return (
    <div className="hero-gradient min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-slate-700/60 bg-slate-950/55 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1500px] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="animate-pulse-glow flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 text-sm font-bold text-white">
              ST
            </div>
            <div>
              <p className="font-display type-section text-sm font-semibold text-slate-100">Streaming</p>
              <p className="type-caption text-xs text-slate-500">Professional Diagram Editor</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleHomeTheme()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-base)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_90%,transparent)] text-[var(--text-secondary)] shadow hover:bg-[var(--bg-tertiary)]"
              title={homeTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label={homeTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {homeTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] px-6 py-8">
        <section className="mb-12 grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="glass rounded-3xl border border-indigo-400/20 p-8 xl:col-span-7">
            <h1 className="type-hero max-w-2xl text-4xl font-semibold text-slate-100">
              Start your Sankey.
            </h1>
            <p className="type-body mt-4 max-w-xl text-sm text-slate-300">
              From blank or from data.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/editor"
                className={`inline-flex items-center gap-2 ${buttonPrimaryMd}`}
              >
                New Diagram
                <Plus className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="glass rounded-3xl border border-slate-700/70 p-5 xl:col-span-5">
            <div className="mb-4">
              <h2 className="type-section text-lg font-semibold text-slate-100">Recent</h2>
            </div>
            {recentDocs.length === 0 ? (
              <div className={emptyStatePanelLg}>
                <p className="type-caption text-sm text-slate-400">No recent documents yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {recentDocs.slice(0, 4).map((doc) => (
                  <div key={doc.id} className="group relative">
                    <Link
                      href={`/editor?doc=${encodeURIComponent(doc.id)}`}
                      className={`block w-full ${galleryCardClass} pr-11`}
                    >
                      <p className="type-body text-sm font-semibold text-slate-100">{doc.title || "Untitled Diagram"}</p>
                      <p className="type-caption mt-1 text-xs text-slate-400">
                        {formatRelativeTime(doc.updatedAt)} • {doc.format.toUpperCase()}
                      </p>
                    </Link>
                    <button
                      type="button"
                      aria-label={`Delete ${doc.title || "Untitled Diagram"}`}
                      title="Delete"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void deleteRecentDocument(doc);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-[color:color-mix(in_srgb,var(--error)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--error)_10%,transparent)] p-1.5 text-[color:color-mix(in_srgb,var(--error)_78%,white)] opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="glass rounded-3xl border border-indigo-400/20 p-5 md:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="type-section text-xl font-semibold text-slate-100">
                Templates
              </h2>
              <p className="type-caption mt-1 text-sm text-slate-400">
                Find one and start.
              </p>
            </div>
            <button
              onClick={() => setShowRecentTemplatesInWorkspace((prev) => !prev)}
              className={`inline-flex items-center gap-1 ${buttonSecondarySm}`}
              title={showRecentTemplatesInWorkspace ? "Hide recent templates" : "Show recent templates"}
            >
              Recent
              {showRecentTemplatesInWorkspace ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          {showRecentTemplatesInWorkspace && (
            <div className="mb-6 rounded-2xl border border-slate-700/70 bg-slate-900/45 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="type-section text-base font-medium text-slate-100">Recent templates</h3>
                {recentTemplates.length > 0 && (
                  <button
                    onClick={() => void clearRecentTemplates()}
                    className={`inline-flex items-center gap-1 ${buttonSecondarySm}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear
                  </button>
                )}
              </div>
              {recentTemplates.length === 0 ? (
                <div className="type-caption rounded-xl border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-400">
                  No recent templates yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {recentTemplates.slice(0, 6).map((template) => {
                    return (
                      <Link
                        key={template.id}
                        href={`/editor?template=${encodeURIComponent(template.id)}`}
                        className={galleryCardClass}
                      >
                        <p className="type-body text-sm font-semibold text-slate-100">{template.name}</p>
                        <p className="type-caption mt-2 text-[11px] text-slate-400">Category: {template.category}</p>
                        <p className="type-caption mt-1 text-xs text-slate-400">Difficulty: {template.difficulty}</p>
                        <span className="mt-2 inline-flex rounded border border-indigo-400/35 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-200">
                          Recent
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                  className="w-full rounded-lg border border-slate-600/70 bg-slate-900/70 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-indigo-400"
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
              <button
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
                className={`inline-flex items-center gap-1 ${buttonSecondarySm}`}
                title={showAdvancedFilters ? "Hide filters" : "Show filters"}
              >
                Filters
                {showAdvancedFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>

            {showAdvancedFilters && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
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
                  Delete ({effectiveSelectedUserTemplateIds.length})
                </button>
              </div>
            )}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {categories.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  category === item
                    ? "border border-indigo-400/50 bg-indigo-500/20 text-indigo-100"
                    : "border border-slate-600 bg-slate-900/70 text-slate-300 hover:bg-slate-800"
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

          <div className="mb-3 flex items-center justify-between">
            <h2 className="type-section text-lg font-semibold text-slate-100">
              Featured <span className="gradient-text">Templates</span>
            </h2>
            <p className="type-caption text-sm text-slate-400">{filteredTemplates.length} templates</p>
          </div>

          {filteredTemplates.length === 0 ? (
            <div className={emptyStatePanelLg}>
              <p className="type-section text-base font-medium text-slate-100">No results</p>
              <p className="type-body mt-1 text-sm text-slate-400">
                Try another filter.
              </p>
              <button
                onClick={resetFilters}
                className={`mt-4 ${buttonPrimaryMd}`}
              >
                Reset
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
                    className="group glass overflow-hidden rounded-2xl shadow-sm transition duration-300 hover:-translate-y-1 hover:border-indigo-300/50 hover:shadow-lg"
                  >
                    <div className={`relative h-44 bg-gradient-to-br ${template.accent} p-5 text-white`}>
                      {isRecent && (
                        <span className="rounded-md border border-indigo-300/35 bg-indigo-500/25 px-2 py-1 text-[10px] font-semibold uppercase">
                          Recent
                        </span>
                      )}
                      <div className="absolute bottom-4 left-5 right-5">
                        <p className="type-caption text-sm opacity-85">{template.category}</p>
                        <h3 className="type-hero text-xl font-semibold">{template.name}</h3>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="type-caption mt-2 text-[11px] text-slate-400">Category: {template.category}</p>
                      <p className="type-caption mt-1 text-xs text-slate-400">Difficulty: {template.difficulty}</p>
                      <p className="type-caption mt-2 text-xs text-slate-500">
                        {isUser ? "My template" : "Built-in"}
                      </p>
                      <div className="mt-2 inline-flex items-center text-indigo-300">
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

      {dialogNode}
    </div>
  );
}










































































































