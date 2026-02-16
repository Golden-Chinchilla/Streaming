"use client";

import React, { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasProps } from "@/lib/diagram-registry";
import { SwimlaneData, SwimlaneNode, SwimlaneLane, SwimlaneNodeType } from "./swimlane-types";
import { parseSwimlaneTextDetailed } from "./swimlane-parse";
// Theme helpers not currently needed (colors set inline)

/* ------------------------------------------------------------------ */
/*  Constants & utilities                                             */
/* ------------------------------------------------------------------ */

const LANE_PALETTE_DARK = [
    "rgba(56, 189, 248, 0.06)",
    "rgba(244, 114, 182, 0.06)",
    "rgba(74, 222, 128, 0.06)",
    "rgba(251, 191, 36, 0.06)",
    "rgba(167, 139, 250, 0.06)",
    "rgba(251, 146, 60, 0.06)",
];
const LANE_PALETTE_LIGHT = [
    "rgba(56, 189, 248, 0.08)",
    "rgba(244, 114, 182, 0.08)",
    "rgba(74, 222, 128, 0.08)",
    "rgba(251, 191, 36, 0.08)",
    "rgba(167, 139, 250, 0.08)",
    "rgba(251, 146, 60, 0.08)",
];

const NODE_COLORS: Record<SwimlaneNodeType, string> = {
    start: "var(--flow-2)",
    end: "var(--flow-5)",
    task: "var(--flow-1)",
    decision: "var(--flow-4)",
    subprocess: "var(--flow-3)",
};

/* ------------------------------------------------------------------ */
/*  SwimlaneCanvas                                                    */
/* ------------------------------------------------------------------ */

export function SwimlaneCanvas({
    data,
    width,
    height,
    onDataChange,
    onSvgReady,
}: CanvasProps<SwimlaneData>) {
    const { style, editorText, format } = data;
    const isDark = style.theme === "dark";

    const svgRef = useRef<SVGSVGElement | null>(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [panning, setPanning] = useState<{
        startX: number;
        startY: number;
        originX: number;
        originY: number;
    } | null>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
    const [dragState, setDragState] = useState<{
        nodeId: string;
        startX: number;
        startY: number;
        initialX: number;
        initialY: number;
    } | null>(null);
    const [hoverText, setHoverText] = useState<string | null>(null);

    const VIEW_WIDTH = width;
    const VIEW_HEIGHT = height;

    // Notify parent that SVG element is ready
    useEffect(() => {
        if (svgRef.current) {
            onSvgReady?.(svgRef.current);
        }
    }, [onSvgReady]);

    // Sync theme on mount
    useEffect(() => {
        const isSystemDark = document.documentElement.classList.contains("dark");
        if (isSystemDark && style.theme === "light") {
            onDataChange?.({
                ...data,
                style: { ...style, theme: "dark" },
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Internal parsing
    const parseResult = useMemo(() => {
        return parseSwimlaneTextDetailed(editorText, format);
    }, [editorText, format]);

    const graph = useMemo(() => {
        if (parseResult.ok) return parseResult.graph;
        return { lanes: data.lanes, nodes: data.nodes, edges: data.edges };
    }, [parseResult, data.lanes, data.nodes, data.edges]);

    // Build lookup maps
    const nodeMap = useMemo(
        () => new Map(graph.nodes.map((n) => [n.id, n])),
        [graph.nodes],
    );

    const laneColors = useMemo(() => {
        const palette = isDark ? LANE_PALETTE_DARK : LANE_PALETTE_LIGHT;
        return new Map(graph.lanes.map((lane, idx) => [lane.id, lane.color || palette[idx % palette.length]]));
    }, [graph.lanes, isDark]);

    // Lane layout dimensions
    const HEADER_WIDTH = style.laneHeaderWidth;
    const LANE_MIN_HEIGHT = 100;
    const LANE_PAD_Y = 20;
    const LANE_PAD_X = 40;

    const laneLayout = useMemo(() => {
        const layout: { lane: SwimlaneLane; y: number; height: number }[] = [];
        let currentY = 10;

        for (const lane of graph.lanes) {
            const laneNodes = graph.nodes.filter((n) => n.laneId === lane.id);
            let maxBottom = 0;
            for (const node of laneNodes) {
                maxBottom = Math.max(maxBottom, node.y + node.height + LANE_PAD_Y);
            }
            const laneHeight = Math.max(LANE_MIN_HEIGHT, maxBottom + LANE_PAD_Y);
            layout.push({ lane, y: currentY, height: laneHeight });
            currentY += laneHeight;
        }
        return layout;
    }, [graph.lanes, graph.nodes, LANE_PAD_Y]);


    const totalWidth = useMemo(() => {
        let maxRight = 0;
        for (const node of graph.nodes) {
            maxRight = Math.max(maxRight, node.x + node.width + LANE_PAD_X);
        }
        return Math.max(VIEW_WIDTH, HEADER_WIDTH + maxRight + 40);
    }, [graph.nodes, HEADER_WIDTH, VIEW_WIDTH, LANE_PAD_X]);

    // Hover context: path highlighting
    const hoverContext = useMemo(() => {
        if (!hoveredNodeId && !hoveredEdgeId) return null;

        const highlightedNodes = new Set<string>();
        const highlightedEdges = new Set<string>();

        if (hoveredNodeId) {
            highlightedNodes.add(hoveredNodeId);
            for (const edge of graph.edges) {
                if (edge.source === hoveredNodeId || edge.target === hoveredNodeId) {
                    highlightedEdges.add(edge.id);
                    highlightedNodes.add(edge.source);
                    highlightedNodes.add(edge.target);
                }
            }
        } else if (hoveredEdgeId) {
            const edge = graph.edges.find((e) => e.id === hoveredEdgeId);
            if (edge) {
                highlightedEdges.add(edge.id);
                highlightedNodes.add(edge.source);
                highlightedNodes.add(edge.target);
            }
        }

        return { highlightedNodes, highlightedEdges };
    }, [hoveredNodeId, hoveredEdgeId, graph.edges]);

    // Coordinate conversion
    const pointerToGraphPoint = useCallback(
        (event: MouseEvent<SVGSVGElement> | MouseEvent<SVGRectElement>) => {
            const ref = svgRef.current;
            if (!ref) return { x: 0, y: 0 };
            const rect = ref.getBoundingClientRect();
            const svgX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
            const svgY = ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT;
            const translateX = (1 - zoom) * (VIEW_WIDTH / 2) + pan.x;
            const translateY = (1 - zoom) * (VIEW_HEIGHT / 2) + pan.y;
            return {
                x: (svgX - translateX) / zoom,
                y: (svgY - translateY) / zoom,
            };
        },
        [VIEW_WIDTH, VIEW_HEIGHT, zoom, pan],
    );

    // Node movement handler
    const handleNodePositionUpdate = useCallback(
        (nodeId: string, x: number, y: number) => {
            const updatedNodes = data.nodes.map((n) =>
                n.id === nodeId ? { ...n, x, y } : n,
            );
            onDataChange?.({
                ...data,
                nodes: updatedNodes,
            });
        },
        [data, onDataChange],
    );

    // Edge path generator
    const getEdgePath = useCallback(
        (sourceNode: SwimlaneNode, targetNode: SwimlaneNode): string => {
            const sx = HEADER_WIDTH + sourceNode.x + sourceNode.width;
            const sy = (() => {
                const laneEntry = laneLayout.find((l) => l.lane.id === sourceNode.laneId);
                return (laneEntry?.y ?? 0) + sourceNode.y + sourceNode.height / 2;
            })();
            const tx = HEADER_WIDTH + targetNode.x;
            const ty = (() => {
                const laneEntry = laneLayout.find((l) => l.lane.id === targetNode.laneId);
                return (laneEntry?.y ?? 0) + targetNode.y + targetNode.height / 2;
            })();

            const curvature = Math.max(0.1, Math.min(0.9, style.edgeCurvature));
            const dx = tx - sx;
            const cx1 = sx + dx * curvature;
            const cx2 = tx - dx * curvature;
            return `M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}`;
        },
        [HEADER_WIDTH, laneLayout, style.edgeCurvature],
    );

    // Get node shape (SVG element based on type)
    const getNodeShape = useCallback(
        (
            node: SwimlaneNode,
            nodeX: number,
            nodeY: number,
            fill: string,
            strokeColor: string,
            strokeWidth: number,
        ) => {
            const w = node.width;
            const h = node.height;
            const r = style.nodeRadius;

            switch (node.type) {
                case "start":
                    // Rounded pill
                    return (
                        <rect
                            x={nodeX}
                            y={nodeY}
                            width={w}
                            height={h}
                            rx={h / 2}
                            fill={fill}
                            stroke={strokeColor}
                            strokeWidth={strokeWidth}
                        />
                    );
                case "end":
                    // Double-border rounded pill
                    return (
                        <g>
                            <rect
                                x={nodeX}
                                y={nodeY}
                                width={w}
                                height={h}
                                rx={h / 2}
                                fill={fill}
                                stroke={strokeColor}
                                strokeWidth={strokeWidth + 1}
                            />
                            <rect
                                x={nodeX + 3}
                                y={nodeY + 3}
                                width={w - 6}
                                height={h - 6}
                                rx={(h - 6) / 2}
                                fill="none"
                                stroke={strokeColor}
                                strokeWidth={0.5}
                                strokeOpacity={0.5}
                            />
                        </g>
                    );
                case "decision":
                    // Diamond
                    {
                        const cx = nodeX + w / 2;
                        const cy = nodeY + h / 2;
                        const dx = w / 2;
                        const dy = h / 2;
                        return (
                            <polygon
                                points={`${cx},${cy - dy} ${cx + dx},${cy} ${cx},${cy + dy} ${cx - dx},${cy}`}
                                fill={fill}
                                stroke={strokeColor}
                                strokeWidth={strokeWidth}
                            />
                        );
                    }
                case "subprocess":
                    // Rounded rect with inner lines
                    return (
                        <g>
                            <rect
                                x={nodeX}
                                y={nodeY}
                                width={w}
                                height={h}
                                rx={r}
                                fill={fill}
                                stroke={strokeColor}
                                strokeWidth={strokeWidth}
                            />
                            <line
                                x1={nodeX + 8}
                                y1={nodeY}
                                x2={nodeX + 8}
                                y2={nodeY + h}
                                stroke={strokeColor}
                                strokeWidth={0.5}
                                strokeOpacity={0.4}
                            />
                            <line
                                x1={nodeX + w - 8}
                                y1={nodeY}
                                x2={nodeX + w - 8}
                                y2={nodeY + h}
                                stroke={strokeColor}
                                strokeWidth={0.5}
                                strokeOpacity={0.4}
                            />
                        </g>
                    );
                default:
                    // task: simple rounded rectangle
                    return (
                        <rect
                            x={nodeX}
                            y={nodeY}
                            width={w}
                            height={h}
                            rx={r}
                            fill={fill}
                            stroke={strokeColor}
                            strokeWidth={strokeWidth}
                        />
                    );
            }
        },
        [style.nodeRadius],
    );

    // Mouse handlers
    const onCanvasMouseDown = (event: MouseEvent<SVGSVGElement>) => {
        if (event.button === 1 || event.button === 0) {
            // Start panning (middle click, or left click on empty canvas)
            if (event.target === event.currentTarget || event.button === 1) {
                event.preventDefault();
                setPanning({
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: pan.x,
                    originY: pan.y,
                });
            }
        }
    };

    const onCanvasMouseMove = (event: MouseEvent<SVGSVGElement>) => {
        if (panning) {
            setPan({
                x: panning.originX + (event.clientX - panning.startX),
                y: panning.originY + (event.clientY - panning.startY),
            });
            return;
        }
        if (dragState) {
            const pt = pointerToGraphPoint(event);
            const dx = pt.x - dragState.startX;
            const dy = pt.y - dragState.startY;
            handleNodePositionUpdate(
                dragState.nodeId,
                Math.max(0, dragState.initialX + dx),
                Math.max(0, dragState.initialY + dy),
            );
        }
    };

    const onCanvasMouseUp = () => {
        setPanning(null);
        setDragState(null);
    };

    // Cursor style
    const cursorClass = panning
        ? "cursor-grabbing"
        : dragState
            ? "cursor-move"
            : "cursor-default";

    const tooltipBg = isDark ? "var(--bg-secondary)" : "var(--text-primary)";
    const laneSeparatorColor = isDark ? "rgba(148, 163, 184, 0.15)" : "rgba(148, 163, 184, 0.25)";
    const laneHeaderBg = isDark ? "rgba(15, 23, 42, 0.6)" : "rgba(248, 250, 252, 0.85)";
    const laneHeaderText = isDark ? "#e2e8f0" : "#334155";

    // Zoom pill CSS
    const zoomPillClass = `absolute top-3 right-3 z-10 rounded-full px-2.5 py-1 text-[10px] font-medium shadow-md backdrop-blur-md
        ${isDark ? "bg-slate-800/80 text-slate-300 border border-slate-600/40" : "bg-white/80 text-slate-600 border border-slate-200/60"}`;

    return (
        <div
            className={`relative h-full w-full overflow-hidden rounded-2xl border ${cursorClass} ${isDark ? "border-slate-700 bg-slate-950/70" : "border-slate-300 bg-white/90"
                }`}
        >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_16%,rgba(56,189,248,0.05)_0%,transparent_62%),radial-gradient(ellipse_at_82%_72%,rgba(244,114,182,0.035)_0%,transparent_56%)]" />
            <div className={zoomPillClass}>{Math.round(zoom * 100)}%</div>

            <svg
                ref={svgRef}
                id="streaming-svg"
                className={`h-full w-full ${cursorClass}`}
                viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                onWheel={(event) => {
                    event.preventDefault();
                    setZoom((z) => Math.max(0.3, Math.min(2.5, z + (event.deltaY > 0 ? -0.05 : 0.05))));
                }}
                onMouseDown={onCanvasMouseDown}
                onMouseMove={onCanvasMouseMove}
                onMouseUp={onCanvasMouseUp}
                onMouseLeave={onCanvasMouseUp}
            >
                <g
                    transform={`translate(${(1 - zoom) * (VIEW_WIDTH / 2) + pan.x}, ${(1 - zoom) * (VIEW_HEIGHT / 2) + pan.y
                        }) scale(${zoom})`}
                >
                    {/* Lane backgrounds */}
                    {laneLayout.map((entry, idx) => (
                        <g key={entry.lane.id}>
                            {/* Lane background */}
                            <rect
                                x={0}
                                y={entry.y}
                                width={totalWidth}
                                height={entry.height}
                                fill={laneColors.get(entry.lane.id) ?? "transparent"}
                                rx={4}
                            />
                            {/* Lane separator line */}
                            {idx > 0 && (
                                <line
                                    x1={0}
                                    y1={entry.y}
                                    x2={totalWidth}
                                    y2={entry.y}
                                    stroke={laneSeparatorColor}
                                    strokeWidth={1}
                                    strokeDasharray="6 4"
                                />
                            )}
                            {/* Lane header */}
                            <rect
                                x={0}
                                y={entry.y}
                                width={HEADER_WIDTH}
                                height={entry.height}
                                fill={laneHeaderBg}
                                rx={4}
                            />
                            <text
                                x={HEADER_WIDTH / 2}
                                y={entry.y + entry.height / 2}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize={Math.max(13, style.labelFontSize + 2)}
                                fontWeight={600}
                                fontFamily="ui-sans-serif, system-ui, sans-serif"
                                fill={laneHeaderText}
                            >
                                {entry.lane.label}
                            </text>
                        </g>
                    ))}

                    {/* Edges */}
                    {graph.edges.map((edge) => {
                        const sourceNode = nodeMap.get(edge.source);
                        const targetNode = nodeMap.get(edge.target);
                        if (!sourceNode || !targetNode) return null;

                        const path = getEdgePath(sourceNode, targetNode);
                        const isHighlighted = hoverContext?.highlightedEdges.has(edge.id);
                        const isDimmed = hoverContext && !isHighlighted;
                        const opacity = isDimmed
                            ? style.edgeOpacity * 0.2
                            : isHighlighted
                                ? Math.min(1, style.edgeOpacity + 0.3)
                                : style.edgeOpacity;

                        // Edge label midpoint
                        const sx = HEADER_WIDTH + sourceNode.x + sourceNode.width;
                        const sy = (() => {
                            const le = laneLayout.find((l) => l.lane.id === sourceNode.laneId);
                            return (le?.y ?? 0) + sourceNode.y + sourceNode.height / 2;
                        })();
                        const tx = HEADER_WIDTH + targetNode.x;
                        const ty = (() => {
                            const le = laneLayout.find((l) => l.lane.id === targetNode.laneId);
                            return (le?.y ?? 0) + targetNode.y + targetNode.height / 2;
                        })();
                        const midX = (sx + tx) / 2;
                        const midY = (sy + ty) / 2;

                        return (
                            <g key={edge.id}>
                                <defs>
                                    <marker
                                        id={`arrow-${edge.id}`}
                                        viewBox="0 0 10 6"
                                        refX="10"
                                        refY="3"
                                        markerWidth="8"
                                        markerHeight="6"
                                        orient="auto"
                                    >
                                        <path d="M0,0 L10,3 L0,6 Z" fill={isDark ? "#94a3b8" : "#64748b"} />
                                    </marker>
                                </defs>
                                <path
                                    d={path}
                                    fill="none"
                                    stroke={isDark ? "#94a3b8" : "#64748b"}
                                    strokeWidth={isHighlighted ? 2.5 : 1.5}
                                    strokeOpacity={opacity}
                                    markerEnd={`url(#arrow-${edge.id})`}
                                    className="cursor-pointer transition-all"
                                    onMouseEnter={() => {
                                        setHoveredEdgeId(edge.id);
                                        setHoverText(
                                            `${edge.source} → ${edge.target}${edge.label ? ` [${edge.label}]` : ""}`,
                                        );
                                    }}
                                    onMouseLeave={() => {
                                        setHoveredEdgeId(null);
                                        setHoverText(null);
                                    }}
                                />
                                {edge.label && style.showLabels && (
                                    <text
                                        x={midX}
                                        y={midY - 8}
                                        textAnchor="middle"
                                        fontSize={Math.max(10, style.labelFontSize - 1)}
                                        fontFamily="ui-sans-serif, system-ui, sans-serif"
                                        fontWeight={500}
                                        fill={isDark ? "#cbd5e1" : "#475569"}
                                        opacity={isDimmed ? 0.3 : 1}
                                    >
                                        {edge.label}
                                    </text>
                                )}
                            </g>
                        );
                    })}

                    {/* Nodes */}
                    {graph.nodes.map((node) => {
                        const laneEntry = laneLayout.find((l) => l.lane.id === node.laneId);
                        if (!laneEntry) return null;

                        const nodeX = HEADER_WIDTH + node.x;
                        const nodeY = laneEntry.y + node.y;
                        const isSelected = selectedNodeId === node.id;
                        const isHovered = hoveredNodeId === node.id;
                        const isDimmed = hoverContext && !hoverContext.highlightedNodes.has(node.id);

                        const baseFill = node.color || NODE_COLORS[node.type] || NODE_COLORS.task;
                        const strokeColor = isSelected || isHovered
                            ? "var(--text-primary)"
                            : isDark
                                ? "rgba(148, 163, 184, 0.3)"
                                : "rgba(148, 163, 184, 0.5)";
                        const strokeWidth = isSelected ? 2 : isHovered ? 1.5 : 0.5;

                        return (
                            <g
                                key={node.id}
                                opacity={isDimmed ? 0.3 : 1}
                                className="transition-opacity"
                            >
                                {getNodeShape(node, nodeX, nodeY, baseFill, strokeColor, strokeWidth)}

                                {/* Node label */}
                                {style.showLabels && (
                                    <text
                                        x={nodeX + node.width / 2}
                                        y={nodeY + node.height / 2}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                        fontSize={style.labelFontSize}
                                        fontWeight={500}
                                        fontFamily="ui-sans-serif, system-ui, sans-serif"
                                        fill={isDark ? "#f1f5f9" : "#1e293b"}
                                        pointerEvents="none"
                                    >
                                        {node.label}
                                    </text>
                                )}

                                {/* Invisible hit area for interaction */}
                                <rect
                                    x={nodeX - 2}
                                    y={nodeY - 2}
                                    width={node.width + 4}
                                    height={node.height + 4}
                                    fill="transparent"
                                    className="cursor-move"
                                    onMouseDown={(event) => {
                                        if (event.button !== 0) return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setSelectedNodeId(node.id);
                                        const pt = pointerToGraphPoint(
                                            event as unknown as MouseEvent<SVGSVGElement>,
                                        );
                                        setDragState({
                                            nodeId: node.id,
                                            startX: pt.x,
                                            startY: pt.y,
                                            initialX: node.x,
                                            initialY: node.y,
                                        });
                                    }}
                                    onMouseEnter={() => {
                                        setHoveredNodeId(node.id);
                                        setHoverText(`${node.label} (${node.type}) — ${laneEntry.lane.label}`);
                                    }}
                                    onMouseLeave={() => {
                                        setHoveredNodeId(null);
                                        setHoverText(null);
                                    }}
                                />
                            </g>
                        );
                    })}
                </g>
            </svg>

            {/* Tooltip */}
            {hoverText && (
                <div
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-slate-600/70 bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg"
                    style={{ backgroundColor: tooltipBg }}
                >
                    {hoverText}
                </div>
            )}
        </div>
    );
}
