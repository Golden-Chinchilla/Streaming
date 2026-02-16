"use client";

// Ensure all diagram plugins are registered before rendering
import "@/plugins/register-all";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
    BaseDocument,
    DiagramType,
} from "@/lib/types";
import {
    loadAllDocuments,
    upsertDocument,
    deleteDocumentById,
    saveAppPreferences,
    loadAppPreferences
} from "@/lib/storage";
import {
    getAllDiagramPlugins,
    getDiagramPlugin
} from "@/lib/diagram-registry";
import {
    LayoutGrid,
    List,
    FileText,
    Plus,
    Search,
    Trash2,
    Sun,
    Moon,
    Clock,
    Palette
} from "lucide-react";
import { motion } from "motion/react";

/* ------------------------------------------------------------------ */
/*  Mock Visualizations for Cards                                     */
/* ------------------------------------------------------------------ */

function SankeyPreview() {
    return (
        <svg viewBox="0 0 400 240" className="w-full h-full text-primary/20 pointer-events-none p-8">
            <path d="M 50 40 C 150 40, 150 100, 250 100" fill="none" stroke="currentColor" strokeWidth="20" opacity="0.8" />
            <path d="M 50 200 C 150 200, 150 100, 250 100" fill="none" stroke="currentColor" strokeWidth="20" opacity="0.6" />
            <path d="M 250 100 C 320 100, 320 60, 380 60" fill="none" stroke="currentColor" strokeWidth="30" opacity="0.9" />
            <rect x="30" y="20" width="20" height="200" rx="4" fill="currentColor" className="text-primary" />
            <rect x="250" y="80" width="20" height="40" rx="4" fill="currentColor" className="text-primary" />
            <rect x="380" y="40" width="20" height="100" rx="4" fill="currentColor" className="text-primary" />
        </svg>
    );
}

function SwimlanePreview() {
    return (
        <svg viewBox="0 0 400 240" className="w-full h-full text-flow-2/20 pointer-events-none p-8">
            <rect x="40" y="40" width="320" height="160" rx="8" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.5" />
            <line x1="40" y1="120" x2="360" y2="120" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />

            <rect x="80" y="60" width="60" height="40" rx="6" fill="currentColor" className="text-flow-2" opacity="0.8" />
            <rect x="200" y="140" width="60" height="40" rx="6" fill="currentColor" className="text-flow-2" opacity="0.6" />
            <rect x="280" y="70" width="40" height="40" rx="20" fill="currentColor" className="text-flow-2" opacity="0.9" />

            <path d="M 140 80 C 170 80, 170 160, 200 160" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M 260 160 C 270 160, 270 90, 280 90" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
    );
}

const PREVIEWS: Record<string, React.ReactNode> = {
    sankey: <SankeyPreview />,
    swimlane: <SwimlanePreview />,
};

/* ------------------------------------------------------------------ */
/*  Main Dashboard Component                                          */
/* ------------------------------------------------------------------ */

export function Dashboard() {
    const router = useRouter();
    const [documents, setDocuments] = useState<BaseDocument[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [theme, setTheme] = useState<"light" | "dark">("light");

    // Initial Load
    useEffect(() => {
        loadAllDocuments().then(setDocuments);
        loadAppPreferences().then((prefs) => {
            setTheme(prefs.defaultTheme);
            document.documentElement.setAttribute("data-theme", prefs.defaultTheme);
        });
    }, []);

    const filteredDocs = useMemo(() => {
        if (!searchQuery) return documents;
        return documents.filter(d => d.title.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [documents, searchQuery]);

    // Handlers
    const handleCreate = async (type: DiagramType) => {
        const plugin = getDiagramPlugin(type);
        if (!plugin) return;

        const now = Date.now();
        const newDoc: BaseDocument = {
            id: crypto.randomUUID(),
            title: `Untitled ${plugin.displayName}`,
            diagramType: type,
            folderId: null,
            createdAt: now,
            updatedAt: now,
            data: plugin.defaultData()
        };

        await upsertDocument(newDoc);
        router.push(`/editor?id=${newDoc.id}`);
    };

    const handleToggleTheme = async () => {
        const next = theme === "dark" ? "light" : "dark";
        setTheme(next);
        document.documentElement.setAttribute("data-theme", next);
        const prefs = await loadAppPreferences();
        await saveAppPreferences({ ...prefs, defaultTheme: next });
    };

    const handleDelete = async (docId: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (confirm("Move this document to trash?")) {
            await deleteDocumentById(docId);
            setDocuments(prev => prev.filter(d => d.id !== docId));
        }
    };

    const plugins = getAllDiagramPlugins();

    return (
        <div className="min-h-screen bg-bg-primary text-foreground font-sans selection:bg-primary/20">
            {/* Top Bar */}
            <header className="h-16 px-6 flex items-center justify-between border-b border-border-base bg-surface/50 backdrop-blur-md sticky top-0 z-30">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center font-bold text-lg shadow-sm">
                        V
                    </div>
                    <span className="font-medium text-lg tracking-tight">Vibe Coding</span>
                </div>

                <div className="flex-1 max-w-xl mx-8">
                    <div className="relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary group-focus-within:text-primary transition-colors" />
                        <input
                            type="text"
                            placeholder="Search your creations..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full h-10 pl-11 pr-4 rounded-full bg-surface-container-high border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium text-sm placeholder:text-text-tertiary"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleToggleTheme}
                        className="p-2.5 rounded-full text-text-secondary hover:bg-surface-container transition-colors"
                    >
                        {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium text-sm">
                        U
                    </div>
                </div>
            </header>

            <main className="max-w-[1600px] mx-auto p-6 space-y-12">

                {/* 1. Template Gallery */}
                <section>
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-medium text-text-primary">Start a new creation</h2>
                        <button className="text-sm font-medium text-primary hover:bg-primary/5 px-4 py-2 rounded-full transition-colors flex items-center gap-2">
                            <Palette className="w-4 h-4" />
                            Template Gallery
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Blank / Custom */}
                        {plugins.map(plugin => (
                            <motion.button
                                key={plugin.type}
                                whileHover={{ y: -4, boxShadow: "0 10px 30px -10px rgba(0,0,0,0.1)" }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => handleCreate(plugin.type)}
                                className="group relative aspect-[1.4/1] bg-surface-container rounded-2xl overflow-hidden border border-border-base hover:border-primary/50 text-left transition-all"
                            >
                                {/* Preview Area */}
                                <div className="absolute inset-0 pb-16 flex items-center justify-center bg-surface-container-low group-hover:bg-surface transition-colors">
                                    {PREVIEWS[plugin.type] || <plugin.icon className="w-12 h-12 text-text-tertiary/50" />}
                                </div>

                                {/* Label Area */}
                                <div className="absolute bottom-0 left-0 right-0 h-16 bg-surface px-5 flex flex-col justify-center border-t border-border-base group-hover:border-primary/20">
                                    <h3 className="font-medium text-text-primary group-hover:text-primary transition-colors">{plugin.displayName}</h3>
                                    <p className="text-xs text-text-tertiary truncate">{plugin.description}</p>
                                </div>

                                {/* Floating Action Button (Google Style) */}
                                <div className="absolute right-4 top-4 w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all shadow-md">
                                    <Plus className="w-5 h-5" />
                                </div>
                            </motion.button>
                        ))}
                    </div>
                </section>

                {/* 2. Recent Documents */}
                <section>
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-medium text-text-primary">Recent documents</h2>

                        <div className="flex items-center bg-surface-container rounded-lg p-1 border border-border-base">
                            <button
                                onClick={() => setViewMode("grid")}
                                className={`p-2 rounded-md transition-all ${viewMode === "grid" ? "bg-surface shadow-sm text-primary" : "text-text-tertiary hover:text-text-primary"}`}
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setViewMode("list")}
                                className={`p-2 rounded-md transition-all ${viewMode === "list" ? "bg-surface shadow-sm text-primary" : "text-text-tertiary hover:text-text-primary"}`}
                            >
                                <List className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {documents.length === 0 ? (
                        <div className="py-20 flex flex-col items-center justify-center text-text-tertiary bg-surface-container/30 rounded-3xl border border-dashed border-border-base">
                            <div className="w-16 h-16 rounded-full bg-surface-container mb-4 flex items-center justify-center">
                                <Clock className="w-8 h-8 opacity-50" />
                            </div>
                            <p className="text-lg font-medium text-text-primary">No recent documents</p>
                            <p className="text-sm">Create specific visualization above to get started</p>
                        </div>
                    ) : (
                        viewMode === "grid" ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {filteredDocs.map(doc => {
                                    const plugin = getDiagramPlugin(doc.diagramType);
                                    const Icon = plugin?.icon || FileText;

                                    return (
                                        <motion.div
                                            key={doc.id}
                                            layout
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            whileHover={{ y: -2 }}
                                            onClick={() => router.push(`/editor?id=${doc.id}`)}
                                            className="group cursor-pointer bg-surface rounded-2xl border border-border-base hover:border-primary/50 shadow-sm hover:shadow-md transition-all overflow-hidden"
                                        >
                                            {/* Thumbnail Placeholder */}
                                            <div className="h-32 bg-surface-container-low border-b border-border-base flex items-center justify-center relative">
                                                <div className="absolute inset-0 flex items-center justify-center opacity-10 group-hover:opacity-20 transition-opacity">
                                                    {PREVIEWS[doc.diagramType] || <Icon className="w-16 h-16" />}
                                                </div>
                                                {/* Actual Icon */}
                                                <div className="w-12 h-12 rounded-xl bg-surface shadow-sm flex items-center justify-center z-10 text-primary">
                                                    <Icon className="w-6 h-6" />
                                                </div>
                                            </div>

                                            <div className="p-4">
                                                <div className="flex items-start justify-between mb-1">
                                                    <h3 className="font-medium text-text-primary truncate pr-4">{doc.title}</h3>
                                                    <button
                                                        onClick={(e) => handleDelete(doc.id, e)}
                                                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-surface-container rounded-md text-text-tertiary hover:text-error transition-all"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                                                    <span>{plugin?.displayName || doc.diagramType}</span>
                                                    <span>•</span>
                                                    <span>{new Date(doc.updatedAt).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="bg-surface rounded-2xl border border-border-base overflow-hidden">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-surface-container text-xs font-medium text-text-secondary uppercase tracking-wider">
                                        <tr>
                                            <th className="px-6 py-4">Name</th>
                                            <th className="px-6 py-4">Type</th>
                                            <th className="px-6 py-4">Last Modified</th>
                                            <th className="px-6 py-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border-base">
                                        {filteredDocs.map(doc => {
                                            const plugin = getDiagramPlugin(doc.diagramType);
                                            const Icon = plugin?.icon || FileText;
                                            return (
                                                <tr
                                                    key={doc.id}
                                                    onClick={() => router.push(`/editor?id=${doc.id}`)}
                                                    className="hover:bg-surface-container-low transition-colors cursor-pointer group"
                                                >
                                                    <td className="px-6 py-4 font-medium text-text-primary flex items-center gap-3">
                                                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                                            <Icon className="w-4 h-4" />
                                                        </div>
                                                        {doc.title}
                                                    </td>
                                                    <td className="px-6 py-4 text-text-secondary">
                                                        {plugin?.displayName || doc.diagramType}
                                                    </td>
                                                    <td className="px-6 py-4 text-text-tertiary">
                                                        {new Date(doc.updatedAt).toLocaleDateString()} {new Date(doc.updatedAt).toLocaleTimeString()}
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button
                                                            onClick={(e) => handleDelete(doc.id, e)}
                                                            className="p-2 rounded-full hover:bg-surface-container text-text-tertiary hover:text-error opacity-0 group-hover:opacity-100 transition-all"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )
                    )}
                </section>
            </main>
        </div>
    );
}
