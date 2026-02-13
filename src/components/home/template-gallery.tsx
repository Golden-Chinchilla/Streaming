"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, Search } from "lucide-react";
import {
  deleteUserTemplate,
  loadRecentDocuments,
  loadUserTemplates,
  upsertUserTemplate,
} from "@/lib/storage";
import { templateList } from "@/lib/templates";
import { SankeyDocument, TemplateSummary } from "@/lib/types";

type SortMode = "name" | "difficulty" | "category";

const difficultyRank: Record<string, number> = {
  Easy: 1,
  Medium: 2,
  Advanced: 3,
};

export function TemplateGallery() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [recentDocs, setRecentDocs] = useState<SankeyDocument[]>([]);
  const [userTemplates, setUserTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadRecentDocuments(), loadUserTemplates()]).then(([items, templates]) => {
      if (!mounted) return;
      setRecentDocs(items);
      setUserTemplates(templates);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const resetFilters = () => {
    setSearch("");
    setCategory("All");
    setSortMode("name");
  };

  const categories = useMemo(() => {
    const allTemplates = [...templateList, ...userTemplates];
    return ["All", ...new Set(allTemplates.map((template) => template.category))];
  }, [userTemplates]);

  const filteredTemplates = useMemo<TemplateSummary[]>(() => {
    const keyword = search.trim().toLowerCase();
    const allTemplates = [...templateList, ...userTemplates];

    const filtered = allTemplates.filter((template) => {
      const matchCategory = category === "All" || template.category === category;
      if (!matchCategory) return false;
      if (!keyword) return true;
      return (
        template.name.toLowerCase().includes(keyword) ||
        template.description.toLowerCase().includes(keyword) ||
        template.category.toLowerCase().includes(keyword)
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
  }, [category, search, sortMode, userTemplates]);

  const removeUserTemplate = async (templateId: string) => {
    const confirmed = window.confirm("Delete this template?");
    if (!confirmed) return;
    await deleteUserTemplate(templateId);
    setUserTemplates((prev) => prev.filter((item) => item.id !== templateId));
  };

  const editUserTemplate = async (template: TemplateSummary) => {
    const name = window.prompt("Template name", template.name)?.trim();
    if (!name) return;
    const category = window.prompt("Template category", template.category)?.trim() || "Custom";
    const description =
      window.prompt("Template description", template.description)?.trim() ||
      "Custom template from current document";
    const updated: TemplateSummary = {
      ...template,
      name,
      category,
      description,
    };
    await upsertUserTemplate(updated);
    setUserTemplates((prev) => [updated, ...prev.filter((item) => item.id !== updated.id)]);
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
                    {doc.format.toUpperCase()} · {new Date(doc.updatedAt).toLocaleString()}
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
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <option value="name">Sort: Name</option>
              <option value="difficulty">Sort: Difficulty</option>
              <option value="category">Sort: Category</option>
            </select>
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
              {filteredTemplates.map((template) => (
                <Link
                  key={template.id}
                  href={`/editor?template=${template.id}`}
                  className="group overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:border-blue-300 hover:shadow-lg"
                >
                  <div className={`relative h-44 bg-gradient-to-br ${template.accent} p-5 text-white`}>
                    <span className="rounded-md bg-white/20 px-2 py-1 text-[11px] font-semibold uppercase">
                      {template.difficulty}
                    </span>
                    {template.id.startsWith("user-") && (
                      <span className="ml-2 rounded-md bg-black/20 px-2 py-1 text-[10px] font-semibold uppercase">
                        My Template
                      </span>
                    )}
                    <div className="absolute bottom-4 left-5 right-5">
                      <p className="text-sm opacity-85">{template.category}</p>
                      <h3 className="text-xl font-semibold">{template.name}</h3>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-slate-500">{template.description}</p>
                    <div className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-blue-600">
                      Use template
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                    </div>
                    {template.id.startsWith("user-") && (
                      <div className="mt-2 flex items-center gap-2">
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
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
