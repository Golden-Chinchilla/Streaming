"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
    Folder,
    BaseDocument,
    DiagramType,
} from "@/lib/types";
import {
    loadAllDocuments,
    loadFolders,
    createFolder,
    upsertDocument
} from "@/lib/storage";
import {
    getAllDiagramPlugins,
    getDiagramPlugin
} from "@/lib/diagram-registry";
import {
    LayoutGrid,
    List,
    Folder as FolderIcon,
    FolderOpen,
    FileText,
    Plus,
    Search,
    MoreVertical,
    X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

/* ------------------------------------------------------------------ */
/*  Types & Props                                                     */
/* ------------------------------------------------------------------ */

type ViewMode = "grid" | "list";

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export function DocumentHub() {
    const router = useRouter();
    const [documents, setDocuments] = useState<BaseDocument[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<ViewMode>("grid");

    // Dialog states
    const [isNewDiagramOpen, setIsNewDiagramOpen] = useState(false);
    const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");

    // Load data
    const refreshData = async () => {
        try {
            const [docs, flds] = await Promise.all([loadAllDocuments(), loadFolders()]);
            setDocuments(docs);
            setFolders(flds);
        } catch (error) {
            console.error("Failed to load data:", error);
        }
    };

    useEffect(() => {
        void refreshData();
    }, []);

    // Filtered documents
    const filteredDocuments = useMemo(() => {
        let docs = documents;

        // Filter by folder (unless searching)
        if (!searchQuery) {
            docs = docs.filter(d => d.folderId === currentFolderId);
        }

        // Filter by search
        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase();
            docs = docs.filter(d => d.title.toLowerCase().includes(lowerQuery));
        }

        return docs;
    }, [documents, currentFolderId, searchQuery]);

    // Current folder details
    const currentFolder = folders.find(f => f.id === currentFolderId);

    // Handlers
    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        // eslint-disable-next-line
        const now = Date.now();
        const newFolder: Folder = {
            id: crypto.randomUUID(),
            name: newFolderName.trim(),
            parentId: null, // Basic flat structure for now / or root level
            createdAt: now
        };
        await createFolder(newFolder);
        setNewFolderName("");
        setIsNewFolderOpen(false);
        void refreshData();
    };

    const handleCreateDiagram = async (type: DiagramType) => {
        const plugin = getDiagramPlugin(type);
        if (!plugin) return;

        // eslint-disable-next-line
        const now = Date.now();
        const newDoc: BaseDocument = {
            id: crypto.randomUUID(),
            title: "Untitled Diagram",
            diagramType: type,
            folderId: currentFolderId,
            createdAt: now,
            updatedAt: now,
            data: plugin.defaultData()
        };

        await upsertDocument(newDoc);
        router.push(`/editor?id=${newDoc.id}`);
    };

    return (
        <div className="flex h-screen bg-surface-container-low text-foreground">
            {/* Sidebar (Folder Tree) */}
            <aside className="w-64 border-r border-border bg-surface flex flex-col">
                <div className="p-4 border-b border-border flex items-center justify-between">
                    <h1 className="text-lg font-semibold tracking-tight">Vibe Coding</h1>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                    <button
                        onClick={() => setCurrentFolderId(null)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${currentFolderId === null ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface-container"
                            }`}
                    >
                        <LayoutGrid className="w-4 h-4" />
                        All Documents
                    </button>

                    <div className="pt-4 pb-2 px-3 text-xs font-medium text-muted uppercase tracking-wider flex justify-between items-center">
                        <span>Folders</span>
                        <button
                            onClick={() => setIsNewFolderOpen(true)}
                            className="hover:text-foreground transition-colors"
                            title="New Folder"
                        >
                            <Plus className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {folders.map(folder => (
                        <button
                            key={folder.id}
                            onClick={() => setCurrentFolderId(folder.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${currentFolderId === folder.id ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface-container"
                                }`}
                        >
                            {currentFolderId === folder.id ? (
                                <FolderOpen className="w-4 h-4" />
                            ) : (
                                <FolderIcon className="w-4 h-4" />
                            )}
                            {folder.name}
                        </button>
                    ))}
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <header className="h-16 border-b border-border bg-surface px-6 flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                        <h2 className="text-xl font-medium">
                            {currentFolder ? currentFolder.name : "All Documents"}
                        </h2>
                        <div className="h-8 w-px bg-border mx-2" />
                        <div className="relative max-w-md w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                            <input
                                type="text"
                                placeholder="Search documents..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 rounded-full bg-surface-container border-none text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex bg-surface-container rounded-lg p-0.5 border border-border">
                            <button
                                onClick={() => setViewMode("grid")}
                                className={`p-1.5 rounded-md transition-all ${viewMode === "grid" ? "bg-surface shadow-sm text-foreground" : "text-muted hover:text-foreground"}`}
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setViewMode("list")}
                                className={`p-1.5 rounded-md transition-all ${viewMode === "list" ? "bg-surface shadow-sm text-foreground" : "text-muted hover:text-foreground"}`}
                            >
                                <List className="w-4 h-4" />
                            </button>
                        </div>
                        <button
                            onClick={() => setIsNewDiagramOpen(true)}
                            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-medium hover:opacity-90 transition-opacity shadown-sm"
                        >
                            <Plus className="w-4 h-4" />
                            New Diagram
                        </button>
                    </div>
                </header>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-6">
                    {filteredDocuments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted">
                            <div className="bg-surface-container rounded-full p-4 mb-4">
                                <FileText className="w-8 h-8 opacity-50" />
                            </div>
                            <p className="text-sm">No documents found</p>
                            {searchQuery && <button onClick={() => setSearchQuery("")} className="text-xs text-primary mt-2 hover:underline">Clear search</button>}
                        </div>
                    ) : viewMode === "grid" ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {filteredDocuments.map(doc => {
                                const plugin = getDiagramPlugin(doc.diagramType);
                                const Icon = plugin?.icon || FileText;
                                return (
                                    <motion.div
                                        key={doc.id}
                                        layout
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        whileHover={{ y: -2 }}
                                        className="group relative bg-surface border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer"
                                        onClick={() => router.push(`/editor?id=${doc.id}`)}
                                    >
                                        <div className="flex items-start justify-between mb-4">
                                            <div className={`p-2 rounded-lg ${plugin ? "bg-primary/10 text-primary" : "bg-surface-container text-muted"}`}>
                                                <Icon className="w-6 h-6" />
                                            </div>
                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button className="p-1 hover:bg-surface-container rounded text-muted"> <MoreVertical className="w-4 h-4" /> </button>
                                            </div>
                                        </div>
                                        <h3 className="font-medium text-foreground truncate">{doc.title}</h3>
                                        <p className="text-xs text-muted mt-1">{new Date(doc.updatedAt).toLocaleDateString()}</p>
                                    </motion.div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="bg-surface border border-border rounded-xl overflow-hidden">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-muted uppercase bg-surface-container-low border-b border-border">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">Name</th>
                                        <th className="px-6 py-3 font-medium">Type</th>
                                        <th className="px-6 py-3 font-medium">Last Modified</th>
                                        <th className="px-6 py-3 font-medium text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredDocuments.map(doc => {
                                        const plugin = getDiagramPlugin(doc.diagramType);
                                        const Icon = plugin?.icon || FileText;
                                        return (
                                            <tr
                                                key={doc.id}
                                                className="border-b border-border last:border-0 hover:bg-surface-container-low transition-colors cursor-pointer"
                                                onClick={() => router.push(`/editor?id=${doc.id}`)}
                                            >
                                                <td className="px-6 py-4 font-medium text-foreground flex items-center gap-3">
                                                    <Icon className="w-4 h-4 text-muted" />
                                                    {doc.title}
                                                </td>
                                                <td className="px-6 py-4 text-muted">{plugin?.displayName || doc.diagramType}</td>
                                                <td className="px-6 py-4 text-muted">{new Date(doc.updatedAt).toLocaleString()}</td>
                                                <td className="px-6 py-4 text-right">
                                                    <button className="p-1 hover:bg-surface-container rounded text-muted" onClick={(e) => { e.stopPropagation(); /* Menu */ }}>
                                                        <MoreVertical className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </main>

            {/* New Diagram Dialog */}
            <AnimatePresence>
                {isNewDiagramOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden"
                        >
                            <div className="p-6 border-b border-border flex items-center justify-between">
                                <h2 className="text-xl font-semibold">Create New Diagram</h2>
                                <button onClick={() => setIsNewDiagramOpen(false)} className="text-muted hover:text-foreground">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6 grid grid-cols-2 gap-4">
                                {getAllDiagramPlugins().map(plugin => (
                                    <button
                                        key={plugin.type}
                                        onClick={() => handleCreateDiagram(plugin.type)}
                                        className="flex flex-col items-start gap-4 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-surface-container transition-all text-left group"
                                    >
                                        <div className="p-3 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                                            <plugin.icon size={24} />
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-foreground">{plugin.displayName}</h3>
                                            <p className="text-sm text-muted mt-1">{plugin.description}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* New Folder Dialog */}
            <AnimatePresence>
                {isNewFolderOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="bg-surface border border-border rounded-xl shadow-lg w-full max-w-sm p-6"
                        >
                            <h3 className="text-lg font-medium mb-4">New Folder</h3>
                            <input
                                autoFocus
                                type="text"
                                placeholder="Folder Name"
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleCreateFolder();
                                    if (e.key === "Escape") setIsNewFolderOpen(false);
                                }}
                                className="w-full px-3 py-2 rounded-lg bg-surface-container border-none focus:outline-none focus:ring-2 focus:ring-primary mb-4"
                            />
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setIsNewFolderOpen(false)} className="px-3 py-1.5 text-sm font-medium text-muted hover:text-foreground">Cancel</button>
                                <button onClick={handleCreateFolder} disabled={!newFolderName.trim()} className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg disabled:opacity-50">Create</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
