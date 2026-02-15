/**
 * Sankey Diagram Plugin
 *
 * Registers the Sankey diagram type with the global diagram registry.
 * This file is the single entry point – import it once at app startup.
 */

import { GitBranch } from "lucide-react";
import { registerDiagram, DiagramPlugin } from "@/lib/diagram-registry";
import { SankeyCanvas } from "./sankey-canvas";
import { defaultSankeyData } from "./sankey-defaults";
import { parseSankeyText } from "./sankey-parse";
import { SankeyData } from "./sankey-types";
import { SankeyStylePanel } from "./sankey-style-panel";
import { DataFormat } from "@/lib/types";

export const sankeyPlugin: DiagramPlugin<SankeyData> = {
    type: "sankey",
    displayName: "Sankey Diagram",
    description: "Flow diagrams showing quantities between stages",
    icon: GitBranch,
    editorMode: "code",
    Canvas: SankeyCanvas,
    StylePanel: SankeyStylePanel,
    defaultData: () => ({ ...defaultSankeyData }),

    parse: (text: string, format: DataFormat) => {
        try {
            const graph = parseSankeyText(text, format);
            return { data: { ...defaultSankeyData, editorText: text, format } as SankeyData, graph };
        } catch (error) {
            return {
                data: { ...defaultSankeyData, editorText: text, format } as SankeyData,
                error: error instanceof Error ? error.message : "Parse failed",
            };
        }
    },

    exportFormats: ["png", "svg"],
};

// Auto-register when imported
registerDiagram(sankeyPlugin);
