"use client";

import { X, Plus } from "lucide-react";
import { BaseDocument } from "@/lib/types";
import { MouseEvent, useRef, useState, useEffect } from "react";
import { getDiagramPlugin } from "@/lib/diagram-registry";

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
        <div className="flex items-center h-9 bg-surface-container border-b border-border overflow-hidden select-none">
            <div
                ref={containerRef}
                className="flex-1 flex overflow-x-auto no-scrollbar"
                onWheel={(e) => {
                    if (containerRef.current) {
                        containerRef.current.scrollLeft += e.deltaY;
                    }
                }}
            >
                {documents.map((doc) => {
                    const isActive = doc.id === activeDocId;
                    const plugin = getDiagramPlugin(doc.diagramType);
                    const Icon = plugin?.icon;

                    return (
                        <div
                            key={doc.id}
                            className={`
                group relative flex items-center gap-2 px-3 py-1.5 min-w-30 max-w-50
                border-r border-border cursor-pointer transition-colors text-xs font-medium
                ${isActive
                                    ? "bg-surface text-foreground shadow-sm z-10"
                                    : "bg-surface-container-low text-muted hover:bg-surface hover:text-foreground"
                                }
              `}
                            onClick={() => onSelect(doc.id)}
                            onContextMenu={(e) => handleContextMenu(e, doc.id)}
                        >
                            {Icon && <Icon className="w-3.5 h-3.5 opacity-70" />}
                            <span className="truncate flex-1">{doc.title || "Untitled"}</span>
                            <button
                                className={`
                  p-0.5 rounded-sm hover:bg-surface-container-high
                  ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
                  transition-opacity
                `}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClose(doc.id);
                                }}
                            >
                                <X className="w-3 h-3" />
                            </button>

                            {/* Active Indicator Line (Top) */}
                            {isActive && (
                                <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
                            )}
                        </div>
                    );
                })}

                {/* New tab button — sits right after the last tab, like a browser */}
                <button
                    onClick={onNew}
                    className="flex items-center justify-center w-8 h-full shrink-0 hover:bg-surface-container-high transition-colors text-muted hover:text-foreground"
                    title="New Diagram"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 min-w-40 bg-surface-container-high border border-border rounded-lg shadow-lg py-1"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-surface-container flex items-center gap-2"
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
        </div>
    );
}
