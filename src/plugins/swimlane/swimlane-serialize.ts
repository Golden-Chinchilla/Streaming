/* ------------------------------------------------------------------ */
/*  Swimlane serialization utilities                                  */
/* ------------------------------------------------------------------ */

import { SwimlaneGraph } from "./swimlane-types";

/**
 * Serialize a SwimlaneGraph back to a format string.
 */
export function serializeSwimlaneToJson(graph: SwimlaneGraph): string {
    const output = {
        lanes: graph.lanes.map((l) => ({
            id: l.id,
            label: l.label,
            ...(l.color ? { color: l.color } : {}),
        })),
        nodes: graph.nodes.map((n) => ({
            id: n.id,
            label: n.label,
            type: n.type,
            laneId: n.laneId,
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height,
            ...(n.color ? { color: n.color } : {}),
        })),
        edges: graph.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            ...(e.label ? { label: e.label } : {}),
        })),
    };
    return JSON.stringify(output, null, 2);
}

export function serializeSwimlaneToCsv(graph: SwimlaneGraph): string {
    const headers = ["source", "target", "label", "lane"];
    const rows = graph.edges.map((edge) => {
        const lane = graph.nodes.find((n) => n.id === edge.source)?.laneId ?? "";
        return [edge.source, edge.target, edge.label ?? "", lane].join(",");
    });
    return [headers.join(","), ...rows].join("\n");
}
