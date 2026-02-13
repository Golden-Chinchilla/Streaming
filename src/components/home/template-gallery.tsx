"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, Search, Trash2 } from "lucide-react";
import {
  clearRecentTemplateIds,
  deleteUserTemplate,
  deleteUserTemplates,
  loadRecentDocuments,
  loadRecentTemplateIds,
  loadUserTemplates,
  upsertUserTemplate,
} from "@/lib/storage";
import { templateList } from "@/lib/templates";
import { SankeyDocument, TemplateSummary } from "@/lib/types";

type SortMode = "name" | "difficulty" | "category";
type SourceMode = "all" | "user" | "builtin";
type DifficultyFilter = "All" | "Easy" | "Medium" | "Advanced";

const difficultyRank: Record<string, number> = {
  Easy: 1,
  Medium: 2,
  Advanced: 3,
};

export function TemplateGallery() {
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
    const confirmed = window.confirm("Delete this template?");
    if (!confirmed) return;
    await deleteUserTemplate(templateId);
    await refreshData();
  };

  const removeSelectedUserTemplates = async () => {
    if (effectiveSelectedUserTemplateIds.length === 0) return;
    const confirmed = window.confirm(
      `Delete ${effectiveSelectedUserTemplateIds.length} selected templates?`,
    );
    if (!confirmed) return;
    await deleteUserTemplates(effectiveSelectedUserTemplateIds);
    setSelectedUserTemplateIds([]);
    await refreshData();
  };

  const clearRecentTemplates = async () => {
    if (recentTemplateIds.length === 0) return;
    await clearRecentTemplateIds();
    setRecentTemplateIds([]);
  };

  const editUserTemplate = async (template: TemplateSummary) => {
    const name = window.prompt("Template name", template.name)?.trim();
    if (!name) return;
    const category = window.prompt("Template category", template.category)?.trim() || "Custom";
    const description =
      window.prompt("Template description", template.description)?.trim() ||
      "Custom template from current document";
    const tagsInput =
      window.prompt("Template tags (comma separated)", (template.tags ?? []).join(", "))?.trim() || "";
    const tags = Array.from(
      new Set(
        tagsInput
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
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
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
                  className="rounded-xl border bg-white px-4 py-3 shadow-sm transition hover:border-blue-300"
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
                onClick={clearRecentTemplates}
                className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Recent
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {recentTemplates.slice(0, 6).map((template) => (
                <Link
                  key={template.id}
                  href={`/editor?template=${encodeURIComponent(template.id)}`}
                  className="rounded-xl border bg-white px-4 py-3 shadow-sm transition hover:border-blue-300"
                >
                  <p className="text-sm font-semibold text-slate-900">{template.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {template.category} | {template.id.startsWith("user-") ? "My Template" : "Built-in"}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mb-8">
          <h2 className="mb-4 text-lg font-medium text-slate-900">Start a new diagram</h2>
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
          </div>
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
              className="rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <option value="all">Source: All</option>
              <option value="user">Source: My Template</option>
              <option value="builtin">Source: Built-in</option>
            </select>
            <select
              value={difficultyFilter}
              onChange={(event) => setDifficultyFilter(event.target.value as DifficultyFilter)}
              className="rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <option value="All">Difficulty: All</option>
              <option value="Easy">Difficulty: Easy</option>
              <option value="Medium">Difficulty: Medium</option>
              <option value="Advanced">Difficulty: Advanced</option>
            </select>
            <select
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              className="rounded-lg border bg-white px-3 py-2 text-sm"
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
              className="rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <option value="name">Sort: Name</option>
              <option value="difficulty">Sort: Difficulty</option>
              <option value="category">Sort: Category</option>
            </select>
            <button
              onClick={removeSelectedUserTemplates}
              disabled={effectiveSelectedUserTemplateIds.length === 0}
              className="rounded-lg border px-3 py-2 text-sm text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete Selected ({effectiveSelectedUserTemplateIds.length})
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
                className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {allFilteredUsersSelected ? "Unselect All" : "Select All"}
              </button>
            )}
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-slate-900">Featured Templates</h2>
            <p className="text-sm text-slate-500">{filteredTemplates.length} templates</p>
          </div>

          {filteredTemplates.length === 0 ? (
            <div className="rounded-2xl border bg-white p-8 text-center">
              <p className="text-base font-medium text-slate-900">No templates found</p>
              <p className="mt-1 text-sm text-slate-500">
                Try another keyword or reset filters to view all templates.
              </p>
              <button
                onClick={resetFilters}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {filteredTemplates.map((template) => {
                const isUser = template.id.startsWith("user-");
                const selected = effectiveSelectedUserTemplateIds.includes(template.id);
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
                        {isUser ? "My Template" : "Built-in"}
                      </span>
                      {recentTemplateIds.includes(template.id) && (
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
                      <p className="text-sm text-slate-500">{template.description}</p>
                      {(template.tags ?? []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(template.tags ?? []).slice(0, 4).map((tag) => (
                            <span
                              key={`${template.id}-tag-${tag}`}
                              className="rounded border bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600"
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
                              editUserTemplate(template);
                            }}
                            className="rounded border px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={(event) => {
                              event.preventDefault();
                              removeUserTemplate(template.id);
                            }}
                            className="rounded border px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
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
    </div>
  );
}

