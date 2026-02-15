"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, ChevronUp, Moon, Plus, Search, Sun, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
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

  // M3 Card Styles
  const galleryCardClass = "group relative overflow-hidden rounded-[24px] border border-[var(--border-light)] bg-[var(--bg-elevated)] px-5 py-4 shadow-[var(--shadow-sm)] transition-all duration-300 hover:shadow-[var(--shadow-lg)] hover:-translate-y-1 hover:border-[var(--primary)]";

  // M3 Input/Select Styles
  const filterSelectClass = "rounded-full border border-[var(--border-base)] bg-[var(--bg-secondary)] px-4 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-all";

  const tinyNeutralButtonClass = buttonSecondaryTiny;
  // M3 Error Container for Delete
  const dangerBulkButtonClass = withDisabled("rounded-full border border-[color:color-mix(in_srgb,var(--error)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--error)_10%,transparent)] px-4 py-2 text-sm font-medium text-[var(--error)] transition hover:bg-[color:color-mix(in_srgb,var(--error)_15%,transparent)]");
  const deleteSelectedDisabledReason = "Select at least one custom template to enable bulk delete.";

  return (
    <div className="hero-gradient min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-slate-700/60 bg-slate-950/55 backdrop-blur">
        <div className="mx-auto flex h-20 w-full max-w-[1600px] items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[var(--primary)] text-base font-bold text-[var(--text-on-primary)] shadow-md">
              ST
            </div>
            <div>
              <p className="font-display type-section text-lg font-medium text-[var(--text-primary)]">Streaming</p>
              <p className="type-caption text-xs text-[var(--text-tertiary)]">Visual Studio</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleHomeTheme()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-base)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] shadow-sm transition hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              title={homeTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label={homeTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {homeTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-8 py-10">
        <section className="mb-14 grid grid-cols-1 gap-8 xl:grid-cols-12">
          {/* Hero Card */}
          <div className="relative overflow-hidden rounded-[32px] bg-[var(--primary)] p-10 text-[var(--text-on-primary)] shadow-[var(--shadow-flow)] xl:col-span-7">
            <div className="relative z-10">
              <h1 className="type-hero max-w-2xl text-5xl font-medium tracking-tight">
                Start your Sankey.
              </h1>
              <p className="type-body mt-4 max-w-xl text-lg opacity-90">
                Create beautiful flow diagrams from blank canvas or import your data instantly.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Link
                  href="/editor"
                  className="rounded-full bg-white px-8 py-3.5 text-sm font-bold text-[var(--primary)] shadow-md transition hover:bg-opacity-90 hover:shadow-lg active:scale-95"
                >
                  <span className="flex items-center gap-2">
                    New Diagram
                    <Plus className="h-5 w-5" />
                  </span>
                </Link>
              </div>
            </div>
            {/* Abstract Decorative Circles */}
            <div className="absolute -right-20 -top-20 h-96 w-96 rounded-full bg-white opacity-10 blur-3xl" />
            <div className="absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-white opacity-10 blur-3xl" />
          </div>

          {/* Recent Documents Panel */}
          <div className="rounded-[32px] border border-[var(--border-light)] bg-[var(--bg-elevated)] p-6 shadow-sm xl:col-span-5">
            <div className="mb-6 flex items-center justify-between px-2">
              <h2 className="type-section text-xl font-medium text-[var(--text-primary)]">Recent</h2>
            </div>
            {recentDocs.length === 0 ? (
              <div className={emptyStatePanelLg}>
                <p className="type-caption text-sm text-[var(--text-tertiary)]">No recent documents yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <AnimatePresence mode="popLayout">
                  {recentDocs.slice(0, 4).map((doc, index) => (
                    <motion.div
                      key={doc.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2, delay: index * 0.05 }}
                      className="group relative"
                    >
                      <Link
                        href={`/editor?doc=${encodeURIComponent(doc.id)}`}
                        className={`block w-full ${galleryCardClass} pr-12`}
                      >
                        <p className="type-body text-base font-medium text-[var(--text-primary)]">{doc.title || "Untitled Diagram"}</p>
                        <p className="type-caption mt-1 text-xs text-[var(--text-secondary)]">
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
                        className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-2 text-[var(--text-tertiary)] opacity-0 transition hover:bg-[var(--bg-tertiary)] hover:text-[var(--error)] group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[32px] border border-[var(--border-light)] bg-[var(--bg-elevated)] p-8">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="type-section text-2xl font-medium text-[var(--text-primary)]">
                Templates
              </h2>
              <p className="type-caption mt-2 text-base text-[var(--text-secondary)]">
                Jump start your visualization.
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
              <div className="relative min-w-[280px] flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search templates..."
                  className="w-full rounded-full border border-[var(--border-base)] bg-[var(--bg-secondary)] py-2.5 pl-11 pr-4 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
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
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${category === item
                  ? "bg-[var(--primary-subtle)] text-[var(--primary-text)] ring-1 ring-[var(--primary)]"
                  : "border border-[var(--border-base)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
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

          <div className="mb-6 flex items-center justify-between">
            <h2 className="type-section text-xl font-medium text-[var(--text-primary)]">
              Featured <span className="text-[var(--primary)]">Templates</span>
            </h2>
            <p className="type-caption text-sm text-[var(--text-tertiary)]">{filteredTemplates.length} templates</p>
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
            <motion.div
              layout
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"
            >
              <AnimatePresence mode="popLayout">
                {filteredTemplates.map((template, index) => {
                  const isUser = template.id.startsWith("user-");
                  const selected = effectiveSelectedUserTemplateIds.includes(template.id);
                  const isRecent = recentTemplateIds.includes(template.id);
                  return (
                    <motion.div
                      layout
                      key={template.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                    >
                      <Link
                        href={`/editor?template=${encodeURIComponent(template.id)}`}
                        className="group relative block overflow-hidden rounded-[24px] border border-[var(--border-light)] bg-[var(--bg-secondary)] shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
                      >
                        <div className={`relative h-48 bg-gradient-to-br ${template.accent} p-6 text-white`}>
                          {isRecent && (
                            <span className="absolute right-4 top-4 rounded-full bg-white/20 px-3 py-1 text-[10px] font-bold uppercase backdrop-blur-md">
                              Recent
                            </span>
                          )}
                          <div className="absolute bottom-6 left-6 right-6">
                            <p className="type-caption text-sm font-medium opacity-90">{template.category}</p>
                            <h3 className="type-hero mt-1 text-2xl font-bold">{template.name}</h3>
                          </div>
                        </div>
                        <div className="p-4">
                          <p className="type-caption mt-2 text-xs text-[var(--text-tertiary)]">Category: {template.category}</p>
                          <p className="type-caption mt-1 text-xs text-[var(--text-tertiary)]">Difficulty: {template.difficulty}</p>
                          <p className="type-caption mt-2 text-xs text-[var(--text-secondary)]">
                            {isUser ? "My template" : "Built-in"}
                          </p>
                          <div className="mt-3 inline-flex items-center text-[var(--primary)] font-medium">
                            <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
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
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}
        </section>
      </main>

      {dialogNode}
    </div>
  );
}










































































































