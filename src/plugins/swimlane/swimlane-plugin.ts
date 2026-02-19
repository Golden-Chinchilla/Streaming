/**
 * Swimlane Diagram Plugin
 */

import { Trello } from "lucide-react";
import { registerDiagram, DiagramPlugin, ParseResult } from "@/lib/diagram-registry";
import { SwimlaneCanvas } from "./swimlane-canvas";
import { SwimlaneStylePanel } from "./swimlane-style-panel";
import { defaultSwimlaneData } from "./swimlane-defaults";
import { SwimlaneData } from "./swimlane-types";
import { parseSwimlaneTextDetailed } from "./swimlane-parse";
import { serializeSwimlaneToJson, serializeSwimlaneToCsv } from "./swimlane-serialize";
import { DataFormat } from "@/lib/types";

export const swimlanePlugin: DiagramPlugin<SwimlaneData> = {
    type: "swimlane",
    displayName: "Swimlane Flow",
    description: "Process mapping with pools and lanes",
    icon: Trello,
    editorMode: "code",
    inputModes: ["json"],
    Canvas: SwimlaneCanvas,
    StylePanel: SwimlaneStylePanel,
    defaultData: () => ({ ...defaultSwimlaneData }),

    parse: (text: string, format: DataFormat): ParseResult<SwimlaneData> => {
        const result = parseSwimlaneTextDetailed(text, format);
        if (result.ok) {
            return {
                data: {
                    ...defaultSwimlaneData,
                    format,
                    editorText: text,
                    lanes: result.graph.lanes,
                    nodes: result.graph.nodes,
                    edges: result.graph.edges,
                },
            };
        }
        return {
            data: defaultSwimlaneData,
            error: result.issue.message,
        };
    },

    serialize: (data: SwimlaneData, format: DataFormat): string => {
        const graph = {
            lanes: data.lanes,
            nodes: data.nodes,
            edges: data.edges,
        };
        if (format === "csv") return serializeSwimlaneToCsv(graph);
        return serializeSwimlaneToJson(graph);
    },

    exportFormats: ["svg", "png", "html"],
};

// Auto-register
registerDiagram(swimlanePlugin);
