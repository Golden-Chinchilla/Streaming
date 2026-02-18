"use client";

import { X, Plus, FileText } from "lucide-react";
import { BaseDocument } from "@/lib/types";
import { MouseEvent, useRef, useState, useEffect } from "react";
import { getDiagramPlugin } from "@/lib/diagram-registry";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";

type EditorTabsProps = {
    documents: BaseDocument[];
    activeDocId: string | null;
    onSelect: (docId: string) => void;
    onClose: (docId: string) => void;
    onNew: () => void;
    onDelete: (docId: string) => void;
};

export function EditorTabs({
    documents,
    activeDocId,
    onSelect,
    onClose,
    onNew,
    onDelete,
}: EditorTabsProps) {
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        docId: string;
    } | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleGlobalClick = () => setContextMenu(null);
        window.addEventListener("click", handleGlobalClick);
        return () => window.removeEventListener("click", handleGlobalClick);
    }, []);

    const handleContextMenu = (e: MouseEvent, docId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, docId });
    };

    return (
        <div className="relative flex min-w-0 w-full items-center select-none">
            <div
                ref={containerRef}
                className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar mask-to-r px-1 py-1"
                onWheel={(e) => {
                    if (containerRef.current) {
                        containerRef.current.scrollLeft += e.deltaY;
                    }
                }}
            >
                <AnimatePresence initial={false}>
                    {documents.map((doc) => {
                        const isActive = doc.id === activeDocId;
                        const plugin = getDiagramPlugin(doc.diagramType);
                        const Icon = plugin?.icon || FileText;

                        return (
                            <motion.div
                                key={doc.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9, x: -10 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.9, width: 0 }}
                                className={cn(
                                    "group relative flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full cursor-pointer transition-colors min-w-[120px] max-w-[200px]",
                                    isActive ? "z-10 text-primary" : "text-text-secondary hover:bg-surface-container hover:text-foreground"
                                )}
                                onClick={() => onSelect(doc.id)}
                                onContextMenu={(e) => handleContextMenu(e, doc.id)}
                            >
                                {isActive && (
                                    <motion.div
                                        layoutId="activeTabPill"
                                        className="absolute inset-0 rounded-full border border-primary/35 bg-primary/12 shadow-(--shadow-sm)"
                                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                    />
                                )}

                                <span className="relative z-10 flex items-center justify-center">
                                    <Icon className={cn("w-3.5 h-3.5", isActive ? "opacity-100" : "opacity-70")} />
                                </span>

                                <span className="relative z-10 truncate flex-1 text-xs font-medium tracking-wide">
                                    {doc.title || "Untitled"}
                                </span>

                                <button
                                    className={cn(
                                        "relative z-10 rounded-full p-0.5 transition-all hover:bg-surface-container",
                                        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100"
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onClose(doc.id);
                                    }}
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>

                {/* New Tab Button */}
                <motion.button
                    layout
                    whileTap={{ scale: 0.9 }}
                    onClick={onNew}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-container hover:text-primary"
                    title="New Diagram"
                >
                    <Plus className="w-4 h-4" />
                </motion.button>
            </div>

            {/* Context Menu (Floating Glass) */}
            <AnimatePresence>
                {contextMenu && (
                    <div
                        className="fixed z-[100] min-w-[160px] transform overflow-hidden rounded-xl border border-border bg-surface-container-high py-1 shadow-(--shadow-lg)"
                        style={{ top: contextMenu.y + 10, left: contextMenu.x }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-(--error) transition-colors hover:bg-surface-container"
                            onClick={() => {
                                onDelete(contextMenu.docId);
                                setContextMenu(null);
                            }}
                        >
                            <X className="w-3.5 h-3.5" />
                            Close & Delete
                        </button>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
