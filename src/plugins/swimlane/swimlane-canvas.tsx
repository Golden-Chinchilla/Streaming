"use client";

import React, { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasProps } from "@/lib/diagram-registry";
import { SwimlaneData, SwimlaneNode, SwimlaneLane, SwimlaneNodeType } from "./swimlane-types";
import { parseSwimlaneTextDetailed } from "./swimlane-parse";
// Theme helpers not currently needed (colors set inline)

/* ------------------------------------------------------------------ */
/*  Constants & utilities                                             */
/* ------------------------------------------------------------------ */

const SWIMLANE_PALETTES: Record<
    "classic" | "ocean" | "sunset",
    {
        lanesDark: string[];
        lanesLight: string[];
        nodes: Record<SwimlaneNodeType, string>;
    }
> = {
    classic: {
        lanesDark: [
            "rgba(96, 165, 250, 0.08)",
            "rgba(248, 113, 113, 0.08)",
            "rgba(74, 222, 128, 0.08)",
            "rgba(250, 204, 21, 0.08)",
            "rgba(167, 139, 250, 0.08)",
            "rgba(251, 146, 60, 0.08)",
        ],
        lanesLight: [
            "rgba(96, 165, 250, 0.12)",
            "rgba(248, 113, 113, 0.12)",
            "rgba(74, 222, 128, 0.12)",
            "rgba(250, 204, 21, 0.12)",
            "rgba(167, 139, 250, 0.12)",
            "rgba(251, 146, 60, 0.12)",
        ],
        nodes: {
            start: "#5f8f49",
            end: "#6a9c8f",
            task: "#2f3742",
            decision: "#d45745",
            subprocess: "#d8a066",
        },
    },
    ocean: {
        lanesDark: [
            "rgba(34, 211, 238, 0.08)",
            "rgba(56, 189, 248, 0.08)",
            "rgba(59, 130, 246, 0.08)",
            "rgba(14, 165, 233, 0.08)",
            "rgba(99, 102, 241, 0.08)",
            "rgba(168, 85, 247, 0.08)",
        ],
        lanesLight: [
            "rgba(34, 211, 238, 0.13)",
            "rgba(56, 189, 248, 0.13)",
            "rgba(59, 130, 246, 0.13)",
            "rgba(14, 165, 233, 0.13)",
            "rgba(99, 102, 241, 0.13)",
            "rgba(168, 85, 247, 0.13)",
        ],
        nodes: {
            start: "#3f9a74",
            end: "#6b92c9",
            task: "#2b557f",
            decision: "#348ca8",
            subprocess: "#7db8c7",
        },
    },
    sunset: {
        lanesDark: [
            "rgba(251, 146, 60, 0.09)",
            "rgba(249, 115, 22, 0.08)",
            "rgba(244, 63, 94, 0.08)",
            "rgba(236, 72, 153, 0.08)",
            "rgba(234, 88, 12, 0.08)",
            "rgba(250, 204, 21, 0.08)",
        ],
        lanesLight: [
            "rgba(251, 146, 60, 0.14)",
            "rgba(249, 115, 22, 0.13)",
            "rgba(244, 63, 94, 0.13)",
            "rgba(236, 72, 153, 0.13)",
            "rgba(234, 88, 12, 0.13)",
            "rgba(250, 204, 21, 0.13)",
        ],
        nodes: {
            start: "#9f7b35",
            end: "#cf6a5d",
            task: "#65463d",
            decision: "#c6473c",
            subprocess: "#df985f",
        },
    },
};

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

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
    const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(
        typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark"
            ? "dark"
            : style.theme === "dark"
                ? "dark"
                : "light",
    );
    const isDark = resolvedTheme === "dark";
    const orientation = style.orientation ?? "horizontal";
    const paletteKey = style.palette ?? "ocean";
    const activePalette = SWIMLANE_PALETTES[paletteKey] ?? SWIMLANE_PALETTES.ocean;

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

    // Follow app theme changes (`data-theme`) to keep canvas in sync with light/dark mode.
    useEffect(() => {
        if (typeof document === "undefined") return;

        const resolve = () => {
            setResolvedTheme(
                document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
            );
        };

        resolve();

        const observer = new MutationObserver((mutations) => {
            const themeChanged = mutations.some(
                (mutation) => mutation.type === "attributes" && mutation.attributeName === "data-theme",
            );
            if (themeChanged) resolve();
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });

        return () => observer.disconnect();
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
        const lanePalette = isDark ? activePalette.lanesDark : activePalette.lanesLight;
        return new Map(graph.lanes.map((lane, idx) => [lane.id, lane.color || lanePalette[idx % lanePalette.length]]));
    }, [graph.lanes, isDark, activePalette]);

    // Lane layout dimensions
    const HEADER_WIDTH = style.laneHeaderWidth;
    const LANE_MIN_HEIGHT = 100;
    const LANE_PAD_Y = 20;
    const LANE_PAD_X = 40;

    const laneLayout = useMemo(() => {
        const layout: { lane: SwimlaneLane; start: number; size: number }[] = [];
        let current = 10;

        for (const lane of graph.lanes) {
            const laneNodes = graph.nodes.filter((n) => n.laneId === lane.id);
            let maxBottom = 0;
            for (const node of laneNodes) {
                maxBottom = Math.max(maxBottom, node.y + node.height + LANE_PAD_Y);
            }
            const laneSize = Math.max(LANE_MIN_HEIGHT, maxBottom + LANE_PAD_Y);
            layout.push({ lane, start: current, size: laneSize });
            current += laneSize;
        }
        return layout;
    }, [graph.lanes, graph.nodes, LANE_PAD_Y]);

    const laneStartMap = useMemo(
        () => new Map(laneLayout.map((entry) => [entry.lane.id, entry.start])),
        [laneLayout],
    );

    const laneSpan = useMemo(
        () => laneLayout.length > 0 ? laneLayout[laneLayout.length - 1].start + laneLayout[laneLayout.length - 1].size + 10 : 0,
        [laneLayout],
    );

    const flowSpan = useMemo(() => {
        let maxRight = 0;
        for (const node of graph.nodes) {
            maxRight = Math.max(maxRight, node.x + node.width + LANE_PAD_X);
        }
        return HEADER_WIDTH + maxRight + 40;
    }, [graph.nodes, HEADER_WIDTH, LANE_PAD_X]);

    const flowScale = useMemo(() => {
        const target = (orientation === "horizontal" ? VIEW_WIDTH : VIEW_HEIGHT) - 40;
        const minScale = orientation === "horizontal" ? 0.7 : 0.5;
        return clamp(target / Math.max(flowSpan, 1), minScale, 1.4);
    }, [orientation, VIEW_WIDTH, VIEW_HEIGHT, flowSpan]);

    const laneScale = useMemo(() => {
        const target = (orientation === "horizontal" ? VIEW_HEIGHT : VIEW_WIDTH) - 24;
        return clamp(target / Math.max(laneSpan, 1), 0.9, 1.8);
    }, [orientation, VIEW_WIDTH, VIEW_HEIGHT, laneSpan]);

    const flowRenderSpan = flowSpan * flowScale;
    const laneRenderSpan = laneSpan * laneScale;

    const totalWidth = useMemo(
        () => Math.max(VIEW_WIDTH, orientation === "horizontal" ? flowRenderSpan : laneRenderSpan),
        [VIEW_WIDTH, orientation, flowRenderSpan, laneRenderSpan],
    );

    const totalHeight = useMemo(
        () => Math.max(VIEW_HEIGHT, orientation === "horizontal" ? laneRenderSpan : flowRenderSpan),
        [VIEW_HEIGHT, orientation, laneRenderSpan, flowRenderSpan],
    );

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

    const orientPoint = useCallback(
        (x: number, y: number) => (
            orientation === "horizontal"
                ? { x: x * flowScale, y: y * laneScale }
                : { x: y * laneScale, y: x * flowScale }
        ),
        [orientation, flowScale, laneScale],
    );

    const orientRect = useCallback(
        (x: number, y: number, rectWidth: number, rectHeight: number) => (
            orientation === "horizontal"
                ? {
                    x: x * flowScale,
                    y: y * laneScale,
                    width: rectWidth * flowScale,
                    height: rectHeight * laneScale,
                }
                : {
                    x: y * laneScale,
                    y: x * flowScale,
                    width: rectHeight * laneScale,
                    height: rectWidth * flowScale,
                }
        ),
        [orientation, flowScale, laneScale],
    );

    const getNodeLayoutPosition = useCallback(
        (node: SwimlaneNode) => {
            const laneStart = laneStartMap.get(node.laneId) ?? 0;
            const baseX = HEADER_WIDTH + node.x;
            const baseY = laneStart + node.y;
            return orientPoint(baseX, baseY);
        },
        [laneStartMap, HEADER_WIDTH, orientPoint],
    );

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
            const sourcePos = getNodeLayoutPosition(sourceNode);
            const targetPos = getNodeLayoutPosition(targetNode);

            const sx = sourcePos.x + sourceNode.width;
            const sy = sourcePos.y + sourceNode.height / 2;
            const tx = targetPos.x;
            const ty = targetPos.y + targetNode.height / 2;

            const curvature = Math.max(0.1, Math.min(0.9, style.edgeCurvature));
            if (orientation === "horizontal") {
                const dx = tx - sx;
                const cx1 = sx + dx * curvature;
                const cx2 = tx - dx * curvature;
                return `M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}`;
            }

            const dy = ty - sy;
            const cy1 = sy + dy * curvature;
            const cy2 = ty - dy * curvature;
            return `M${sx},${sy} C${sx},${cy1} ${tx},${cy2} ${tx},${ty}`;
        },
        [getNodeLayoutPosition, style.edgeCurvature, orientation],
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
            const flowDelta = (orientation === "horizontal" ? dx : dy) / Math.max(flowScale, 0.001);
            const laneDelta = (orientation === "horizontal" ? dy : dx) / Math.max(laneScale, 0.001);
            const nextX = dragState.initialX + flowDelta;
            const nextY = dragState.initialY + laneDelta;
            handleNodePositionUpdate(
                dragState.nodeId,
                Math.max(0, nextX),
                Math.max(0, nextY),
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

    const handleCanvasWheel = useCallback((event: WheelEvent) => {
        event.preventDefault();
        setZoom((z) => Math.max(0.3, Math.min(2.5, z + (event.deltaY > 0 ? -0.05 : 0.05))));
    }, []);

    useEffect(() => {
        const svgElement = svgRef.current;
        if (!svgElement) return;
        svgElement.addEventListener("wheel", handleCanvasWheel, { passive: false });
        return () => {
            svgElement.removeEventListener("wheel", handleCanvasWheel);
        };
    }, [handleCanvasWheel]);

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
                onMouseDown={onCanvasMouseDown}
                onMouseMove={onCanvasMouseMove}
                onMouseUp={onCanvasMouseUp}
                onMouseLeave={onCanvasMouseUp}
            >
                <g
                    transform={`translate(${(1 - zoom) * (VIEW_WIDTH / 2) + pan.x}, ${(1 - zoom) * (VIEW_HEIGHT / 2) + pan.y
                        }) scale(${zoom})`}
                >
                    <rect x={0} y={0} width={totalWidth} height={totalHeight} fill="transparent" pointerEvents="none" />
                    {/* Lane backgrounds */}
                    {laneLayout.map((entry, idx) => (
                        <g key={entry.lane.id}>
                            {/* Lane background */}
                            {(() => {
                                const laneRect = orientRect(0, entry.start, flowSpan, entry.size);
                                return (
                                    <rect
                                        x={laneRect.x}
                                        y={laneRect.y}
                                        width={laneRect.width}
                                        height={laneRect.height}
                                        fill={laneColors.get(entry.lane.id) ?? "transparent"}
                                        rx={4}
                                    />
                                );
                            })()}
                            {/* Lane separator line */}
                            {idx > 0 && (
                                (() => {
                                    const p1 = orientPoint(0, entry.start);
                                    const p2 = orientPoint(flowSpan, entry.start);
                                    return (
                                        <line
                                            x1={p1.x}
                                            y1={p1.y}
                                            x2={p2.x}
                                            y2={p2.y}
                                            stroke={laneSeparatorColor}
                                            strokeWidth={1}
                                            strokeDasharray="6 4"
                                        />
                                    );
                                })()
                            )}
                            {/* Lane header */}
                            {(() => {
                                const headerRect = orientRect(0, entry.start, HEADER_WIDTH, entry.size);
                                return (
                                    <rect
                                        x={headerRect.x}
                                        y={headerRect.y}
                                        width={headerRect.width}
                                        height={headerRect.height}
                                        fill={laneHeaderBg}
                                        rx={4}
                                    />
                                );
                            })()}
                            <text
                                x={orientation === "horizontal" ? HEADER_WIDTH / 2 : entry.start + entry.size / 2}
                                y={orientation === "horizontal" ? entry.start + entry.size / 2 : HEADER_WIDTH / 2}
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
                        const sourcePos = getNodeLayoutPosition(sourceNode);
                        const targetPos = getNodeLayoutPosition(targetNode);
                        const sx = sourcePos.x + sourceNode.width;
                        const sy = sourcePos.y + sourceNode.height / 2;
                        const tx = targetPos.x;
                        const ty = targetPos.y + targetNode.height / 2;
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
                        const nodePos = getNodeLayoutPosition(node);
                        const laneLabel = graph.lanes.find((lane) => lane.id === node.laneId)?.label ?? node.laneId;
                        const nodeX = nodePos.x;
                        const nodeY = nodePos.y;
                        const isSelected = selectedNodeId === node.id;
                        const isHovered = hoveredNodeId === node.id;
                        const isDimmed = hoverContext && !hoverContext.highlightedNodes.has(node.id);

                        const baseFill = node.color || activePalette.nodes[node.type] || activePalette.nodes.task;
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
                                        setHoverText(`${node.label} (${node.type}) - ${laneLabel}`);
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
                    className="absolute left-1/2 -translate-x-1/2 rounded-lg border border-slate-600/70 bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg"
                    style={{
                        backgroundColor: tooltipBg,
                        bottom: "calc(var(--editor-bottom-safe-area, 0px) + 0.75rem)",
                    }}
                >
                    {hoverText}
                </div>
            )}
        </div>
    );
}
