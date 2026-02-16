/* ------------------------------------------------------------------ */
/*  Swimlane data parsing                                             */
/* ------------------------------------------------------------------ */

import { z } from "zod";
import { DataFormat } from "@/lib/types";
import {
    SwimlaneGraph,
    SwimlaneNode,
    SwimlaneEdge,
    SwimlaneLane,
    SwimlaneNodeType,
} from "./swimlane-types";

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

const nodeTypeSchema = z.enum(["start", "end", "task", "decision", "subprocess"]);

const laneSchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    color: z.string().optional(),
});

const nodeSchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    type: nodeTypeSchema.default("task"),
    laneId: z.string().min(1),
    color: z.string().optional(),
});

const edgeSchema = z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string().optional(),
});

const swimlaneJsonSchema = z.object({
    lanes: z.array(laneSchema).min(1),
    nodes: z.array(nodeSchema).min(1),
    edges: z.array(edgeSchema),
});

/* ------------------------------------------------------------------ */
/*  Parse issue type                                                  */
/* ------------------------------------------------------------------ */

export type SwimlaneParseIssue = {
    message: string;
    line?: number;
    column?: number;
};

export type SwimlaneParseResult =
    | { ok: true; graph: SwimlaneGraph }
    | { ok: false; issue: SwimlaneParseIssue };

/* ------------------------------------------------------------------ */
/*  Auto-layout (topological sort within lanes)                       */
/* ------------------------------------------------------------------ */

function autoLayout(
    lanes: SwimlaneLane[],
    nodes: SwimlaneNode[],
    edges: SwimlaneEdge[],
): SwimlaneNode[] {
    // Build adjacency and in-degree maps
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    for (const node of nodes) {
        adj.set(node.id, []);
        inDegree.set(node.id, 0);
    }
    for (const edge of edges) {
        adj.get(edge.source)?.push(edge.target);
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }

    // Topological sort via Kahn's algorithm to determine column position
    const queue: string[] = [];
    const topoOrder = new Map<string, number>();
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }
    let step = 0;
    while (queue.length > 0) {
        const size = queue.length;
        for (let i = 0; i < size; i++) {
            const current = queue.shift()!;
            topoOrder.set(current, step);
            for (const next of adj.get(current) ?? []) {
                const newDeg = (inDegree.get(next) ?? 1) - 1;
                inDegree.set(next, newDeg);
                if (newDeg === 0) queue.push(next);
            }
        }
        step++;
    }

    // Assign any remaining (cycles) a high step
    for (const node of nodes) {
        if (!topoOrder.has(node.id)) {
            topoOrder.set(node.id, step++);
        }
    }

    // Build lane index map
    const laneIndex = new Map<string, number>();
    lanes.forEach((lane, idx) => laneIndex.set(lane.id, idx));

    // Layout constants
    const NODE_WIDTH = 140;
    const NODE_HEIGHT = 40;
    const COL_GAP = 60;
    const ROW_GAP = 30;
    const LANE_HEIGHT = 100;
    const PADDING_LEFT = 40;
    const PADDING_TOP = 20;

    // Group nodes by column
    const colCounts = new Map<number, Map<string, number>>();
    for (const node of nodes) {
        const col = topoOrder.get(node.id) ?? 0;
        if (!colCounts.has(col)) colCounts.set(col, new Map());
        const laneMap = colCounts.get(col)!;
        laneMap.set(node.laneId, (laneMap.get(node.laneId) ?? 0) + 1);
    }

    // Track per-lane per-column counter for Y offset
    const laneColCounter = new Map<string, Map<number, number>>();

    return nodes.map((node) => {
        const col = topoOrder.get(node.id) ?? 0;
        const laneIdx = laneIndex.get(node.laneId) ?? 0;

        if (!laneColCounter.has(node.laneId)) laneColCounter.set(node.laneId, new Map());
        const colMap = laneColCounter.get(node.laneId)!;
        const rowInCol = colMap.get(col) ?? 0;
        colMap.set(col, rowInCol + 1);

        return {
            ...node,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            x: PADDING_LEFT + col * (NODE_WIDTH + COL_GAP),
            y: PADDING_TOP + laneIdx * LANE_HEIGHT + rowInCol * (NODE_HEIGHT + ROW_GAP),
        };
    });
}

/* ------------------------------------------------------------------ */
/*  Cycle detection for swimlane graphs                                */
/* ------------------------------------------------------------------ */

export function detectSwimlaneCycle(edges: SwimlaneEdge[]): string[] | null {
    const adj = new Map<string, string[]>();
    const allNodes = new Set<string>();
    for (const edge of edges) {
        allNodes.add(edge.source);
        allNodes.add(edge.target);
        if (!adj.has(edge.source)) adj.set(edge.source, []);
        adj.get(edge.source)!.push(edge.target);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    function dfs(node: string): boolean {
        visited.add(node);
        inStack.add(node);
        path.push(node);
        for (const next of adj.get(node) ?? []) {
            if (inStack.has(next)) {
                const cycleStart = path.indexOf(next);
                return true; // cycle found
            }
            if (!visited.has(next) && dfs(next)) return true;
        }
        path.pop();
        inStack.delete(node);
        return false;
    }

    for (const node of allNodes) {
        if (!visited.has(node) && dfs(node)) return path;
    }
    return null;
}

/* ------------------------------------------------------------------ */
/*  JSON Parser                                                       */
/* ------------------------------------------------------------------ */

function parseJson(text: string): SwimlaneParseResult {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Invalid JSON";
        return { ok: false, issue: { message: msg } };
    }

    const result = swimlaneJsonSchema.safeParse(raw);
    if (!result.success) {
        const first = result.error.issues[0];
        return {
            ok: false,
            issue: {
                message: `${first.path.join(".")}: ${first.message}`,
            },
        };
    }

    const data = result.data;

    // Validate node laneIds reference existing lanes
    const laneIds = new Set(data.lanes.map((l) => l.id));
    for (const node of data.nodes) {
        if (!laneIds.has(node.laneId)) {
            return {
                ok: false,
                issue: { message: `Node "${node.id}" references unknown lane "${node.laneId}"` },
            };
        }
    }

    // Validate edge references
    const nodeIds = new Set(data.nodes.map((n) => n.id));
    for (const edge of data.edges) {
        if (!nodeIds.has(edge.source)) {
            return {
                ok: false,
                issue: { message: `Edge "${edge.id}" references unknown source "${edge.source}"` },
            };
        }
        if (!nodeIds.has(edge.target)) {
            return {
                ok: false,
                issue: { message: `Edge "${edge.id}" references unknown target "${edge.target}"` },
            };
        }
    }

    // Duplicate node id check
    const seenNodeIds = new Set<string>();
    for (const node of data.nodes) {
        if (seenNodeIds.has(node.id)) {
            return {
                ok: false,
                issue: { message: `Duplicate node id: "${node.id}"` },
            };
        }
        seenNodeIds.add(node.id);
    }

    // Cycle warning (non-blocking)
    const cycle = detectSwimlaneCycle(data.edges);

    const lanes: SwimlaneLane[] = data.lanes.map((l) => ({
        id: l.id,
        label: l.label,
        color: l.color,
    }));

    const rawNodes: SwimlaneNode[] = data.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        type: n.type as SwimlaneNodeType,
        laneId: n.laneId,
        x: 0,
        y: 0,
        width: 140,
        height: 40,
        color: n.color,
    }));

    const edges: SwimlaneEdge[] = data.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
    }));

    const layoutNodes = autoLayout(lanes, rawNodes, edges);

    return {
        ok: true,
        graph: { lanes, nodes: layoutNodes, edges },
    };
}

/* ------------------------------------------------------------------ */
/*  CSV Parser (rows: source, target, label)                          */
/* ------------------------------------------------------------------ */

function parseCsv(text: string): SwimlaneParseResult {
    // Simple approach: CSV has edges; nodes and lanes are inferred
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
        return { ok: false, issue: { message: "CSV must have a header row and at least one data row" } };
    }

    // Parse header
    const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
    const srcIdx = header.findIndex((h) => ["source", "from", "src"].includes(h));
    const tgtIdx = header.findIndex((h) => ["target", "to", "dst"].includes(h));
    const lblIdx = header.findIndex((h) => ["label", "name", "edge"].includes(h));
    const laneIdx = header.findIndex((h) => ["lane", "pool", "swimlane"].includes(h));

    if (srcIdx < 0 || tgtIdx < 0) {
        return { ok: false, issue: { message: "CSV must have 'source' and 'target' columns" } };
    }

    const edges: SwimlaneEdge[] = [];
    const nodeSet = new Set<string>();
    const nodeLane = new Map<string, string>();

    for (let i = 1; i < lines.length; i++) {
        const fields = lines[i].split(",").map((f) => f.trim());
        const source = fields[srcIdx] ?? "";
        const target = fields[tgtIdx] ?? "";
        if (!source || !target) continue;

        const label = lblIdx >= 0 ? fields[lblIdx] : undefined;
        const lane = laneIdx >= 0 ? fields[laneIdx] : undefined;

        edges.push({
            id: `e${i}`,
            source,
            target,
            label: label || undefined,
        });

        nodeSet.add(source);
        nodeSet.add(target);
        if (lane) {
            nodeLane.set(source, lane);
        }
    }

    // Infer lanes from unique lane assignments; default to "Default" lane
    const laneNames = new Set(nodeLane.values());
    if (laneNames.size === 0) laneNames.add("Default");
    const lanes: SwimlaneLane[] = Array.from(laneNames).map((name) => ({
        id: name.toLowerCase().replace(/\s+/g, "-"),
        label: name,
    }));
    const defaultLaneId = lanes[0].id;

    const nodes: SwimlaneNode[] = Array.from(nodeSet).map((id) => {
        const laneLabel = nodeLane.get(id);
        const laneObj = lanes.find((l) => l.label === laneLabel);
        // Determine type heuristics
        const isSource = edges.some((e) => e.source === id) && !edges.some((e) => e.target === id);
        const isSink = edges.some((e) => e.target === id) && !edges.some((e) => e.source === id);
        const type: SwimlaneNodeType = isSource ? "start" : isSink ? "end" : "task";

        return {
            id,
            label: id,
            type,
            laneId: laneObj?.id ?? defaultLaneId,
            x: 0,
            y: 0,
            width: 140,
            height: 40,
        };
    });

    const layoutNodes = autoLayout(lanes, nodes, edges);

    return {
        ok: true,
        graph: { lanes, nodes: layoutNodes, edges },
    };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export function parseSwimlaneText(text: string, format: DataFormat): SwimlaneGraph {
    const result = parseSwimlaneTextDetailed(text, format);
    if (result.ok) return result.graph;
    throw new Error(result.issue.message);
}

export function parseSwimlaneTextDetailed(
    text: string,
    format: DataFormat,
): SwimlaneParseResult {
    const trimmed = text.trim();
    if (!trimmed) {
        return { ok: false, issue: { message: "Input is empty" } };
    }

    if (format === "json") {
        return parseJson(trimmed);
    }
    if (format === "csv") {
        return parseCsv(trimmed);
    }

    // Try JSON first, then CSV
    const jsonResult = parseJson(trimmed);
    if (jsonResult.ok) return jsonResult;
    return parseCsv(trimmed);
}
