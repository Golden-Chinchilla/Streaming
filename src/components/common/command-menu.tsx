"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { Folder, LayoutGrid, Plus, Search, Sun, Moon } from "lucide-react";
import { getAllDiagramPlugins, getDiagramPlugin } from "@/lib/diagram-registry";
import { loadAppPreferences, saveAppPreferences, upsertDocument } from "@/lib/storage";
import { setThemeWithTransition, AppTheme } from "@/lib/theme-transition";
import { BaseDocument, DiagramType } from "@/lib/types";

export function CommandMenu() {
    const [open, setOpen] = useState(false);
    const [theme, setTheme] = useState<AppTheme>("dark");
    const router = useRouter();

    useEffect(() => {
        loadAppPreferences().then((prefs) => {
            setTheme(prefs.defaultTheme);
        });

        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen((open) => !open);
            }
        };
        document.addEventListener("keydown", down);
        const root = document.documentElement;
        const observer = new MutationObserver((mutations) => {
            const themeChanged = mutations.some(
                (mutation) => mutation.type === "attributes" && mutation.attributeName === "data-theme",
            );
            if (themeChanged) {
                setTheme(root.getAttribute("data-theme") === "dark" ? "dark" : "light");
            }
        });
        observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

        return () => {
            document.removeEventListener("keydown", down);
            observer.disconnect();
        };
    }, []);

    const handleToggleTheme = async () => {
        const next = theme === "dark" ? "light" : "dark";
        setTheme(next);
        setThemeWithTransition(next);
        const prefs = await loadAppPreferences();
        await saveAppPreferences({ ...prefs, defaultTheme: next });
        setOpen(false);
    };

    const createDiagram = async (type: DiagramType) => {
        const plugin = getDiagramPlugin(type);
        if (!plugin) return;
        // eslint-disable-next-line
        const now = Date.now();
        const newDoc: BaseDocument = {
            id: crypto.randomUUID(),
            title: `Untitled ${plugin.displayName}`,
            diagramType: type,
            folderId: null,
            createdAt: now,
            updatedAt: now,
            data: plugin.defaultData(),
        };
        await upsertDocument(newDoc);
        router.push(`/editor?id=${newDoc.id}`);
        setOpen(false);
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-start justify-center pt-[15vh] px-4">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/40 backdrop-blur-sm"
                onClick={() => setOpen(false)}
                aria-hidden="true"
            />

            <Command
                className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface-container-high shadow-(--shadow-2xl)"
                loop
            >
                <div className="flex items-center border-b border-border px-4" cmdk-input-wrapper="">
                    <Search className="mr-3 h-5 w-5 text-text-tertiary shrink-0" />
                    <Command.Input
                        autoFocus
                        placeholder="Type a command or search..."
                        className="flex h-12 w-full bg-transparent text-sm font-medium outline-none placeholder:text-text-tertiary disabled:cursor-not-allowed disabled:opacity-50"
                    />
                </div>

                <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden p-2 text-foreground">
                    <Command.Empty className="py-6 text-center text-sm text-text-muted">
                        No results found.
                    </Command.Empty>

                    <Command.Group heading="Navigation" className="px-2 py-1.5 text-xs font-medium text-text-secondary">
                        <Command.Item
                            onSelect={() => {
                                router.push("/");
                                setOpen(false);
                            }}
                            className="relative flex cursor-pointer select-none items-center rounded-lg px-2 py-2.5 text-sm outline-none aria-selected:bg-surface-container hover:bg-surface-container aria-selected:text-primary hover:text-primary data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
                        >
                            <LayoutGrid className="mr-2 h-4 w-4" />
                            <span>Dashboard</span>
                        </Command.Item>
                        <Command.Item
                            onSelect={() => {
                                router.push("/hub");
                                setOpen(false);
                            }}
                            className="relative flex cursor-pointer select-none items-center rounded-lg px-2 py-2.5 text-sm outline-none aria-selected:bg-surface-container hover:bg-surface-container aria-selected:text-primary hover:text-primary data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
                        >
                            <Folder className="mr-2 h-4 w-4" />
                            <span>Document Hub</span>
                        </Command.Item>
                    </Command.Group>

                    <Command.Group heading="Create" className="px-2 py-1.5 text-xs font-medium text-text-secondary">
                        {getAllDiagramPlugins().map((plugin) => (
                            <Command.Item
                                key={plugin.type}
                                onSelect={() => createDiagram(plugin.type)}
                                className="relative flex cursor-pointer select-none items-center rounded-lg px-2 py-2.5 text-sm outline-none aria-selected:bg-surface-container hover:bg-surface-container aria-selected:text-primary hover:text-primary"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                <span>New {plugin.displayName}</span>
                            </Command.Item>
                        ))}
                    </Command.Group>

                    <Command.Group heading="Settings" className="px-2 py-1.5 text-xs font-medium text-text-secondary">
                        <Command.Item
                            onSelect={() => {
                                handleToggleTheme();
                            }}
                            className="relative flex cursor-pointer select-none items-center rounded-lg px-2 py-2.5 text-sm outline-none aria-selected:bg-surface-container hover:bg-surface-container aria-selected:text-primary hover:text-primary"
                        >
                            {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                            <span>Toggle Theme</span>
                        </Command.Item>
                    </Command.Group>

                </Command.List>
            </Command>
        </div>
    );
}
