"use client";

import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { SankeyGraph as D3SankeyGraph, sankey, SankeyLink, SankeyNode } from "d3-sankey";
import { SankeyGraph, SankeyStyle } from "@/lib/types";
import { linkStyleKey } from "@/lib/utils";

type Props = {
  graph: SankeyGraph;
  style: SankeyStyle;
  nodePositions: Record<string, number>;
  nodeStyles: Record<string, { color?: string; opacity?: number }>;
  linkStyles: Record<string, { color?: string; opacity?: number; widthScale?: number }>;
  renderHints?: {
    showLabels: boolean;
    enableLinkHover: boolean;
    dragThrottleMs: number;
    simplifyLinkCurves: boolean;
    lowDetailDuringDrag: boolean;
  };
  interactionMode: "select" | "pan";
  selectedNodeIds: string[];
  selectedLinkIndex: number | null;
  traceMode: "none" | "upstream" | "downstream";
  onNodePositionChange: (nodeId: string, y: number) => void;
  onSelectionChange: (ids: string[]) => void;
  onLinkSelectionChange: (index: number | null) => void;
  onZoomChange?: (zoom: number) => void;
  onSvgReady?: (svg: SVGSVGElement | null) => void;
};

type NodeDatum = { id: string };
type LinkDatum = { source: string; target: string; value: number };
type GraphLayout = D3SankeyGraph<NodeDatum, LinkDatum>;

const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 700;
const TOP = 24;
const BOTTOM = 676;

const palettes = {
  classic: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f43f5e"],
  ocean: ["#0ea5e9", "#06b6d4", "#14b8a6", "#22c55e", "#38bdf8", "#0d9488", "#0284c7"],
  sunset: ["#f97316", "#ef4444", "#ec4899", "#f59e0b", "#fb7185", "#f43f5e", "#f97316"],
} as const;

function linkPath(
  link: SankeyLink<NodeDatum, LinkDatum>,
  curvature: number,
  simplify: boolean,
) {
  const source = link.source as SankeyNode<NodeDatum, LinkDatum>;
  const target = link.target as SankeyNode<NodeDatum, LinkDatum>;
  const x0 = source.x1 ?? 0;
  const x1 = target.x0 ?? 0;
  const y0 = link.y0 ?? ((source.y0 ?? 0) + (source.y1 ?? 0)) / 2;
  const y1 = link.y1 ?? ((target.y0 ?? 0) + (target.y1 ?? 0)) / 2;
  if (simplify) {
    return `M${x0},${y0}L${x1},${y1}`;
  }
  const c = Math.max(0.15, Math.min(0.85, curvature));
  const xi = x0 + (x1 - x0) * c;
  const xj = x1 - (x1 - x0) * c;
  return `M${x0},${y0}C${xi},${y0} ${xj},${y1} ${x1},${y1}`;
}

function clampNodeTop(top: number, nodeHeight: number) {
  return Math.max(TOP, Math.min(BOTTOM - nodeHeight, top));
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

export function SankeyCanvas({
  graph,
  style,
  nodePositions,
  nodeStyles,
  linkStyles,
  renderHints,
  interactionMode,
  selectedNodeIds,
  selectedLinkIndex,
  traceMode,
  onNodePositionChange,
  onSelectionChange,
  onLinkSelectionChange,
  onZoomChange,
  onSvgReady,
}: Props) {
  const [hoverText, setHoverText] = useState<string | null>(null);
  const [hoveredLinkIndex, setHoveredLinkIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [dragState, setDragState] = useState<{
    nodeIds: string[];
    startY: number;
    initialTops: Record<string, number>;
  } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    additive: boolean;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lastDragEmitAtRef = useRef(0);
  const colors = palettes[style.palette];
  const isDark = style.theme === "dark";
  const canvasBg = isDark ? "#0f172a" : "#f8fafc";
  const tooltipBg = isDark ? "#111827" : "#0f172a";
  const labelColor = style.labelColor || (isDark ? "#cbd5e1" : "#334155");
  const insideLabelColor = "#f8fafc";
  const zoomPillClass = isDark
    ? "absolute right-3 top-3 z-10 rounded-full bg-slate-800/95 px-3 py-1 text-xs font-medium text-slate-200 shadow"
    : "absolute right-3 top-3 z-10 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-500 shadow";
  const effectiveHints = renderHints ?? {
    showLabels: true,
    enableLinkHover: true,
    dragThrottleMs: 0,
    simplifyLinkCurves: false,
    lowDetailDuringDrag: false,
  };
  const degradedDetail =
    effectiveHints.lowDetailDuringDrag && (Boolean(dragState) || Boolean(panning));
  const canShowLabels = style.showLabels && effectiveHints.showLabels && !degradedDetail;
  const canHoverLinks = effectiveHints.enableLinkHover && !degradedDetail;

  useEffect(() => {
    onSvgReady?.(svgRef.current);
    return () => onSvgReady?.(null);
  }, [onSvgReady]);

  useEffect(() => {
    onZoomChange?.(zoom);
  }, [onZoomChange, zoom]);

  const layout: GraphLayout = useMemo(() => {
    const generator = sankey<NodeDatum, LinkDatum>()
      .nodeId((node) => node.id)
      .nodeWidth(style.nodeWidth)
      .nodePadding(style.nodePadding)
      .extent([
        [TOP, TOP],
        [1176, BOTTOM],
      ]);

    const built = generator({
      nodes: graph.nodes.map((node) => ({ ...node })),
      links: graph.links.map((link) => ({ ...link })),
    });

    for (const node of built.nodes) {
      if (node.id in nodePositions) {
        const currentTop = node.y0 ?? 0;
        const currentBottom = node.y1 ?? currentTop;
        const height = currentBottom - currentTop;
        const desiredTop = clampNodeTop(nodePositions[node.id], height);
        node.y0 = desiredTop;
        node.y1 = desiredTop + height;
      }
    }

    generator.update(built);
    return built;
  }, [graph, nodePositions, style.nodePadding, style.nodeWidth]);

  const sourceName = (link: SankeyLink<NodeDatum, LinkDatum>) =>
    (link.source as SankeyNode<NodeDatum, LinkDatum>).id;
  const targetName = (link: SankeyLink<NodeDatum, LinkDatum>) =>
    (link.target as SankeyNode<NodeDatum, LinkDatum>).id;

  const pointerToGraphPoint = (
    event: MouseEvent<SVGSVGElement> | MouseEvent<SVGRectElement>,
    svgElement?: SVGSVGElement | null,
  ) => {
    const ref = svgElement ?? svgRef.current;
    if (!ref) return { x: 0, y: 0 };
    const rect = ref.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
    const svgY = ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT;
    const translateX = (1 - zoom) * 600 + pan.x;
    const translateY = (1 - zoom) * 350 + pan.y;
    return {
      x: (svgX - translateX) / zoom,
      y: (svgY - translateY) / zoom,
    };
  };

  const nodeMap = useMemo(() => {
    return new Map(layout.nodes.map((node) => [node.id, node]));
  }, [layout.nodes]);

  const trace = useMemo(() => {
    if (traceMode === "none" || selectedNodeIds.length === 0) return null;

    const includedNodes = new Set(selectedNodeIds);
    const includedLinks = new Set<number>();
    const queue = [...selectedNodeIds];

    while (queue.length > 0) {
      const current = queue.shift()!;
      layout.links.forEach((link, index) => {
        const source = sourceName(link);
        const target = targetName(link);
        if (traceMode === "upstream" && target === current) {
          includedLinks.add(index);
          if (!includedNodes.has(source)) {
            includedNodes.add(source);
            queue.push(source);
          }
        }
        if (traceMode === "downstream" && source === current) {
          includedLinks.add(index);
          if (!includedNodes.has(target)) {
            includedNodes.add(target);
            queue.push(target);
          }
        }
      });
    }

    return { includedNodes, includedLinks };
  }, [layout.links, selectedNodeIds, traceMode]);

  const onCanvasMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    if (panning) {
      setPan({
        x: panning.originX + (event.clientX - panning.startX),
        y: panning.originY + (event.clientY - panning.startY),
      });
      return;
    }
    if (dragState && interactionMode === "select") {
      if (effectiveHints.dragThrottleMs > 0) {
        const now = event.timeStamp;
        if (now - lastDragEmitAtRef.current < effectiveHints.dragThrottleMs) {
          return;
        }
        lastDragEmitAtRef.current = now;
      }
      const { y: graphY } = pointerToGraphPoint(event);
      const delta = graphY - dragState.startY;
      for (const nodeId of dragState.nodeIds) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        const currentTop = node.y0 ?? 0;
        const currentBottom = node.y1 ?? currentTop;
        const height = currentBottom - currentTop;
        const initialTop = dragState.initialTops[nodeId] ?? currentTop;
        const nextTop = clampNodeTop(initialTop + delta, height);
        onNodePositionChange(nodeId, nextTop);
      }
      return;
    }
    if (selectionBox && interactionMode === "select") {
      const point = pointerToGraphPoint(event);
      setSelectionBox((current) =>
        current
          ? {
              ...current,
              x: point.x,
              y: point.y,
            }
          : current,
      );
    }
  };

  const onCanvasMouseUp = () => {
    if (selectionBox) {
      const minX = Math.min(selectionBox.startX, selectionBox.x);
      const maxX = Math.max(selectionBox.startX, selectionBox.x);
      const minY = Math.min(selectionBox.startY, selectionBox.y);
      const maxY = Math.max(selectionBox.startY, selectionBox.y);
      const isClick = Math.abs(maxX - minX) < 3 && Math.abs(maxY - minY) < 3;

      if (isClick) {
        if (!selectionBox.additive) {
          onSelectionChange([]);
          onLinkSelectionChange(null);
        }
      } else {
        const hitIds = layout.nodes
          .filter((node) => {
            const x0 = node.x0 ?? 0;
            const x1 = node.x1 ?? x0;
            const y0 = node.y0 ?? 0;
            const y1 = node.y1 ?? y0;
            return x1 >= minX && x0 <= maxX && y1 >= minY && y0 <= maxY;
          })
          .map((node) => node.id);

        if (selectionBox.additive) {
          onSelectionChange(uniqueIds([...selectedNodeIds, ...hitIds]));
        } else {
          onSelectionChange(hitIds);
          onLinkSelectionChange(null);
        }
      }
    }

    setSelectionBox(null);
    setDragState(null);
    setPanning(null);
  };

  const onCanvasMouseDown = (event: MouseEvent<SVGSVGElement>) => {
    if (interactionMode === "pan") {
      setPanning({
        startX: event.clientX,
        startY: event.clientY,
        originX: pan.x,
        originY: pan.y,
      });
      return;
    }
    if (interactionMode !== "select") return;
    if (event.target !== event.currentTarget) return;
    const point = pointerToGraphPoint(event);
    setSelectionBox({
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      additive: event.shiftKey,
    });
  };

  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-2xl border ${isDark ? "border-slate-700" : "border-slate-200"}`}
      style={{ backgroundColor: canvasBg }}
    >
      <div className={zoomPillClass}>
        {Math.round(zoom * 100)}%
      </div>
      <svg
        ref={svgRef}
        id="streaming-svg"
        className="h-full w-full"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        onWheel={(event) => {
          event.preventDefault();
          setZoom((currentZoom) => {
            const next = currentZoom + (event.deltaY > 0 ? -0.05 : 0.05);
            return Math.max(0.5, Math.min(1.8, next));
          });
        }}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={onCanvasMouseMove}
        onMouseUp={onCanvasMouseUp}
        onMouseLeave={onCanvasMouseUp}
      >
        <g transform={`translate(${(1 - zoom) * 600 + pan.x}, ${(1 - zoom) * 350 + pan.y}) scale(${zoom})`}>
          {layout.links.map((link, index) => (
            (() => {
              const key = linkStyleKey(index);
              const linkStyle = linkStyles[key];
              const baseOpacity = Math.max(
                0.05,
                Math.min(1, linkStyle?.opacity ?? style.linkOpacity),
              );
              const widthScale = Math.max(0.2, Math.min(4, linkStyle?.widthScale ?? 1));
              const baseWidth = Math.max(1, (link.width ?? 1) * widthScale);
              const opacity =
                trace
                  ? trace.includedLinks.has(index)
                    ? Math.min(1, baseOpacity + 0.25)
                    : Math.max(0.08, baseOpacity * 0.2)
                  : hoveredLinkIndex === index || selectedLinkIndex === index
                    ? Math.min(1, baseOpacity + 0.25)
                    : baseOpacity;

              return (
                <path
                  key={`link-${index}`}
                  d={linkPath(link, style.curvature, effectiveHints.simplifyLinkCurves)}
                  fill="none"
                  stroke={linkStyle?.color || colors[index % colors.length]}
                  strokeOpacity={opacity}
                  strokeWidth={
                    hoveredLinkIndex === index || selectedLinkIndex === index
                      ? Math.max(2, baseWidth + 1.5)
                      : baseWidth
                  }
                  className={interactionMode === "select" ? "cursor-pointer" : undefined}
                  onMouseDown={(event) => {
                    if (interactionMode !== "select") return;
                    event.preventDefault();
                    event.stopPropagation();
                    onLinkSelectionChange(index);
                  }}
                  onMouseEnter={() => {
                    if (!canHoverLinks) return;
                    setHoveredLinkIndex(index);
                    setHoverText(
                      `${sourceName(link)} -> ${targetName(link)} (${link.value.toLocaleString()})`,
                    );
                  }}
                  onMouseLeave={() => {
                    setHoveredLinkIndex(null);
                    setHoverText(null);
                  }}
                />
              );
            })()
          ))}

          {layout.nodes.map((node, index) => {
            const x0 = node.x0 ?? 0;
            const x1 = node.x1 ?? 0;
            const y0 = node.y0 ?? 0;
            const y1 = node.y1 ?? 0;
            const nodeId = node.id;
            const centerY = (y0 + y1) / 2;
            const leftSide = x0 < 600;
            const nodeHeight = y1 - y0;
            const isSelected = selectedNodeIds.includes(nodeId);
            const dimmedByTrace = Boolean(trace && !trace.includedNodes.has(nodeId));
            const canShowInsideLabel =
              style.labelPosition === "inside" && nodeHeight >= style.labelFontSize + 4;
            const labelX = canShowInsideLabel ? x0 + (x1 - x0) / 2 : leftSide ? x1 + 8 : x0 - 8;
            const labelAnchor = canShowInsideLabel ? "middle" : leftSide ? "start" : "end";

            return (
              <g key={`${node.id}-${index}`} opacity={dimmedByTrace ? 0.3 : 1}>
                <rect
                  x={x0}
                  y={y0}
                  width={Math.max(1, x1 - x0)}
                  height={Math.max(8, y1 - y0)}
                  rx={style.nodeRadius}
                  fill={nodeStyles[nodeId]?.color || colors[index % colors.length]}
                  fillOpacity={Math.max(0.15, Math.min(1, nodeStyles[nodeId]?.opacity ?? 1))}
                  stroke={isSelected ? (isDark ? "#f8fafc" : "#0f172a") : "none"}
                  strokeWidth={isSelected ? 2 : 0}
                  className={interactionMode === "select" ? "cursor-ns-resize" : "cursor-grab"}
                  onMouseDown={(event) => {
                    if (interactionMode !== "select") return;
                    event.preventDefault();
                    event.stopPropagation();
                    const graphPoint = pointerToGraphPoint(
                      event,
                      event.currentTarget.ownerSVGElement ?? svgRef.current,
                    );
                    const additive = event.shiftKey;

                    let dragNodeIds: string[] = [nodeId];
                    if (additive) {
                      if (selectedNodeIds.includes(nodeId)) {
                        onSelectionChange(selectedNodeIds.filter((id) => id !== nodeId));
                        return;
                      }
                      const next = uniqueIds([...selectedNodeIds, nodeId]);
                      onSelectionChange(next);
                      dragNodeIds = next;
                    } else if (!selectedNodeIds.includes(nodeId)) {
                      onSelectionChange([nodeId]);
                      onLinkSelectionChange(null);
                    } else {
                      dragNodeIds = selectedNodeIds.length > 0 ? selectedNodeIds : [nodeId];
                    }

                    const initialTops: Record<string, number> = {};
                    for (const id of dragNodeIds) {
                      const dragNode = nodeMap.get(id);
                      if (!dragNode) continue;
                      initialTops[id] = dragNode.y0 ?? 0;
                    }

                    setDragState({
                      nodeIds: dragNodeIds,
                      startY: graphPoint.y,
                      initialTops,
                    });
                  }}
                />
                {canShowLabels && (
                  <text
                    x={labelX}
                    y={centerY}
                    textAnchor={labelAnchor}
                    dominantBaseline="middle"
                    fontSize={style.labelFontSize}
                    fontFamily={
                      style.labelFontFamily === "System Sans"
                        ? "ui-sans-serif, system-ui, sans-serif"
                        : style.labelFontFamily
                    }
                    fill={canShowInsideLabel ? insideLabelColor : labelColor}
                  >
                    {nodeId}
                  </text>
                )}
              </g>
            );
          })}
          {selectionBox && (
            <rect
              x={Math.min(selectionBox.startX, selectionBox.x)}
              y={Math.min(selectionBox.startY, selectionBox.y)}
              width={Math.abs(selectionBox.x - selectionBox.startX)}
              height={Math.abs(selectionBox.y - selectionBox.startY)}
              fill={isDark ? "rgba(148,163,184,0.18)" : "rgba(59,130,246,0.15)"}
              stroke={isDark ? "#94a3b8" : "#2563eb"}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>

      {hoverText && canHoverLinks && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg px-3 py-2 text-xs text-white shadow-lg"
          style={{ backgroundColor: tooltipBg }}
        >
          {hoverText}
        </div>
      )}
    </div>
  );
}
