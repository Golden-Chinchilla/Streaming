"use client";

import React, { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SankeyGraph as D3SankeyGraph, sankey, SankeyLink, SankeyNode, sankeyCenter, sankeyJustify, sankeyLeft, sankeyRight } from "d3-sankey";
import { CanvasProps } from "@/lib/diagram-registry";
import { SankeyData } from "./sankey-types";
import { parseSankeyTextDetailed } from "./sankey-parse";
import { defaultSankeyStyle } from "./sankey-defaults";
import { linkStyleKey } from "@/lib/utils";
import { DARK_LABEL_COLOR, LIGHT_LABEL_COLOR } from "@/lib/theme";

// Define the interaction state expected by this canvas
type SankeyInteractionState = {
  interactionMode?: "select" | "pan";
  isSpacePanning?: boolean;
  selectedNodeIds?: string[];
  selectedLinkIndex?: number | null;
  traceMode?: "none" | "upstream" | "downstream";
  pulseLinkIndex?: number | null;
  pulseNodeId?: string | null;
  onSelectionChange?: (ids: string[]) => void;
  onLinkSelectionChange?: (index: number | null) => void;
  onLinkEditRequest?: (index: number, anchor: { x: number; y: number }) => void;
  onNodeEditRequest?: (nodeId: string, anchor: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
  renderHints?: {
    showLabels: boolean;
    enableLinkHover: boolean;
    dragThrottleMs: number;
    simplifyLinkCurves: boolean;
    lowDetailDuringDrag: boolean;
  };
};

type NodeDatum = { id: string };
type LinkDatum = {
  source: string;
  target: string;
  value: number;
  originalIndex?: number;
  originalSource?: string;
  originalTarget?: string;
};
type GraphLayout = D3SankeyGraph<NodeDatum, LinkDatum>;
type DisplayLink = {
  originalIndex: number;
  originalSource: string;
  originalTarget: string;
  value: number;
  width: number;
  y0: number;
  y1: number;
};
const DUMMY_NODE_PREFIX = "__stage_dummy__";
const EMPTY_NODE_POSITIONS: SankeyData["nodePositions"] = {};
const EMPTY_NODE_STYLES: SankeyData["nodeStyles"] = {};
const EMPTY_LINK_STYLES: SankeyData["linkStyles"] = {};
const EMPTY_LAYOUT = { nodes: [], links: [] } as unknown as GraphLayout;



const palettes = {
  classic: ["var(--flow-1)", "var(--flow-2)", "var(--flow-4)", "var(--flow-5)", "var(--flow-3)", "var(--flow-6)", "var(--flow-8)"],
  ocean: ["var(--flow-1)", "var(--flow-6)", "var(--flow-2)", "var(--flow-8)", "var(--flow-3)", "var(--flow-7)", "var(--flow-5)"],
  sunset: ["var(--flow-4)", "var(--flow-5)", "var(--flow-1)", "var(--flow-3)", "var(--flow-7)", "var(--flow-2)", "var(--flow-6)"],
} as const;
const SEMANTIC_ROLE_COLORS = {
  source: "var(--flow-2)",
  intermediate: "var(--flow-1)",
  sink: "var(--flow-5)",
} as const;
const DEFAULT_RENDER_HINTS: NonNullable<SankeyInteractionState["renderHints"]> = {
  showLabels: true,
  enableLinkHover: true,
  dragThrottleMs: 0,
  simplifyLinkCurves: false,
  lowDetailDuringDrag: false,
};



function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

function formatCompactValue(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function toFiniteNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function sanitizeRenderHints(rawHints: unknown): NonNullable<SankeyInteractionState["renderHints"]> {
  if (!rawHints || typeof rawHints !== "object") return { ...DEFAULT_RENDER_HINTS };
  const hints = rawHints as Partial<NonNullable<SankeyInteractionState["renderHints"]>>;
  return {
    showLabels: typeof hints.showLabels === "boolean" ? hints.showLabels : DEFAULT_RENDER_HINTS.showLabels,
    enableLinkHover: typeof hints.enableLinkHover === "boolean" ? hints.enableLinkHover : DEFAULT_RENDER_HINTS.enableLinkHover,
    dragThrottleMs: toFiniteNumber(
      hints.dragThrottleMs,
      DEFAULT_RENDER_HINTS.dragThrottleMs,
      0,
      2_000,
    ),
    simplifyLinkCurves:
      typeof hints.simplifyLinkCurves === "boolean"
        ? hints.simplifyLinkCurves
        : DEFAULT_RENDER_HINTS.simplifyLinkCurves,
    lowDetailDuringDrag:
      typeof hints.lowDetailDuringDrag === "boolean"
        ? hints.lowDetailDuringDrag
        : DEFAULT_RENDER_HINTS.lowDetailDuringDrag,
  };
}

function sanitizeSankeyStyle(rawStyle: Partial<SankeyData["style"]>): SankeyData["style"] {
  const merged = { ...defaultSankeyStyle, ...rawStyle };
  return {
    ...merged,
    nodeWidth: toFiniteNumber(merged.nodeWidth, defaultSankeyStyle.nodeWidth, 4, 320),
    nodePadding: toFiniteNumber(merged.nodePadding, defaultSankeyStyle.nodePadding, 0, 240),
    nodeRadius: toFiniteNumber(merged.nodeRadius, defaultSankeyStyle.nodeRadius, 0, 40),
    linkOpacity: toFiniteNumber(merged.linkOpacity, defaultSankeyStyle.linkOpacity, 0.02, 1),
    curvature: toFiniteNumber(merged.curvature, defaultSankeyStyle.curvature, 0, 1),
    labelFontSize: toFiniteNumber(merged.labelFontSize, defaultSankeyStyle.labelFontSize, 8, 48),
    labelThreshold: toFiniteNumber(merged.labelThreshold ?? 0, 0, 0, Number.MAX_SAFE_INTEGER),
    showLabels: typeof merged.showLabels === "boolean" ? merged.showLabels : defaultSankeyStyle.showLabels,
    labelPosition: merged.labelPosition === "inside" || merged.labelPosition === "outside"
      ? merged.labelPosition
      : defaultSankeyStyle.labelPosition,
    labelFontFamily:
      merged.labelFontFamily === "Roboto" || merged.labelFontFamily === "Google Sans" || merged.labelFontFamily === "System Sans"
        ? merged.labelFontFamily
        : defaultSankeyStyle.labelFontFamily,
    theme: merged.theme === "light" || merged.theme === "dark" ? merged.theme : defaultSankeyStyle.theme,
    palette: merged.palette === "classic" || merged.palette === "ocean" || merged.palette === "sunset"
      ? merged.palette
      : defaultSankeyStyle.palette,
    colorStrategy: merged.colorStrategy === "palette" || merged.colorStrategy === "semantic"
      ? merged.colorStrategy
      : defaultSankeyStyle.colorStrategy,
    labelStyle: merged.labelStyle === "plain" || merged.labelStyle === "badge"
      ? merged.labelStyle
      : defaultSankeyStyle.labelStyle,
    linkRender: merged.linkRender === "flat" || merged.linkRender === "soft"
      ? merged.linkRender
      : defaultSankeyStyle.linkRender,
    align:
      merged.align === "justify" || merged.align === "left" || merged.align === "right" || merged.align === "center"
        ? merged.align
        : defaultSankeyStyle.align,
    linkBlendMode: merged.linkBlendMode === "multiply" || merged.linkBlendMode === "normal"
      ? merged.linkBlendMode
      : defaultSankeyStyle.linkBlendMode,
    labelColor: typeof merged.labelColor === "string" && merged.labelColor.trim().length > 0
      ? merged.labelColor
      : defaultSankeyStyle.labelColor,
    linkGradient: typeof merged.linkGradient === "boolean" ? merged.linkGradient : defaultSankeyStyle.linkGradient,
    transparent: typeof merged.transparent === "boolean" ? merged.transparent : defaultSankeyStyle.transparent,
  };
}

export function SankeyCanvas({
  data,
  width,
  height,
  interactionState = {},
  onDataChange,
  onSvgReady,
}: CanvasProps<SankeyData>) {
  // Destructure data
  const rawStyle = (data?.style ?? {}) as Partial<SankeyData["style"]>;
  const style = sanitizeSankeyStyle(rawStyle);
  const nodePositions = data?.nodePositions ?? EMPTY_NODE_POSITIONS;
  const nodeStyles = data?.nodeStyles ?? EMPTY_NODE_STYLES;
  const linkStyles = data?.linkStyles ?? EMPTY_LINK_STYLES;
  const editorText = data?.editorText;
  const format = data?.format;
  const safeEditorText = typeof editorText === "string" ? editorText : "";
  const safeFormat = format === "csv" ? "csv" : "json";

  // Unpack interaction state
  const {
    interactionMode = "select",
    isSpacePanning = false,
    selectedNodeIds = [],
    selectedLinkIndex = null,
    traceMode = "none",
    pulseLinkIndex = null,
    pulseNodeId = null,
    renderHints,
    onSelectionChange = () => { },
    onLinkSelectionChange = () => { },
    onLinkEditRequest = () => { },
    onNodeEditRequest = () => { },
    onZoomChange = () => { },
  } = (interactionState || {}) as SankeyInteractionState;

  // Internal Parsing
  const { graph } = useMemo(() => {
    const result = parseSankeyTextDetailed(safeEditorText, safeFormat);
    if (result.ok) return { graph: result.graph };
    // TODO: Expose error state needed? For now return empty graph or partial
    // We could fallback to a safe empty graph
    return { graph: { nodes: [], links: [] } };
  }, [safeEditorText, safeFormat]);

  // Handler adapters
  const onNodePositionChange = (nodeId: string, y: number) => {
    onDataChange?.({
      ...data,
      nodePositions: { ...nodePositions, [nodeId]: y },
    });
  };

  const VIEW_WIDTH = width;
  const VIEW_HEIGHT = height;
  const LEFT = 52;
  const RIGHT = width - 52;
  const TOP = 34;
  const BOTTOM = height - 34;

  // Helper inside component to access dynamic height
  const clampNodeTop = useCallback((top: number, nodeHeight: number) => {
    return Math.max(TOP, Math.min(BOTTOM - nodeHeight, top));
  }, [TOP, BOTTOM]);

  const [hoverText, setHoverText] = useState<string | null>(null);
  const [hoveredLinkIndex, setHoveredLinkIndex] = useState<number | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(
    typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : style.theme === "dark"
        ? "dark"
        : "light",
  );
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
  const paletteKey = typeof style.palette === "string" && style.palette in palettes ? style.palette : "ocean";
  const colors = palettes[paletteKey];
  const colorStrategy = style.colorStrategy ?? "palette";
  const labelStyle = style.labelStyle ?? "badge";
  const linkRender = style.linkRender ?? "soft";
  const isDark = resolvedTheme === "dark";
  const tooltipBg = isDark ? "var(--bg-secondary)" : "var(--text-primary)";
  const labelColor = style.labelColor || (isDark ? DARK_LABEL_COLOR : LIGHT_LABEL_COLOR);
  const insideLabelColor = isDark ? "rgba(248,250,252,0.96)" : "rgba(15,23,42,0.92)";
  const insideLabelStroke = isDark ? "rgba(15,23,42,0.72)" : "rgba(248,250,252,0.86)";
  const zoomPillClass = isDark
    ? "absolute right-3 top-3 z-10 rounded-full border border-slate-600/60 bg-slate-900/62 px-3 py-1 text-xs font-medium text-slate-200/90 shadow-sm backdrop-blur"
    : "absolute right-3 top-3 z-10 rounded-full border border-slate-300/80 bg-white/86 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur";
  const effectiveHints = sanitizeRenderHints(renderHints);
  const degradedDetail =
    effectiveHints.lowDetailDuringDrag && (Boolean(dragState) || Boolean(panning));
  const canShowLabels = style.showLabels && effectiveHints.showLabels && !degradedDetail;
  const canHoverLinks = effectiveHints.enableLinkHover && !degradedDetail;
  const isPanActive = interactionMode === "pan" || isSpacePanning;
  const cursorClass = panning ? "cursor-grabbing" : isPanActive ? "cursor-grab" : "cursor-default";

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

  const nodeRoleMap = useMemo(() => {
    const indegree = new Map<string, number>();
    const outdegree = new Map<string, number>();
    for (const node of graph.nodes) {
      indegree.set(node.id, 0);
      outdegree.set(node.id, 0);
    }
    for (const link of graph.links) {
      outdegree.set(link.source, (outdegree.get(link.source) ?? 0) + 1);
      indegree.set(link.target, (indegree.get(link.target) ?? 0) + 1);
    }
    const roleById = new Map<string, "source" | "intermediate" | "sink">();
    for (const node of graph.nodes) {
      const inCount = indegree.get(node.id) ?? 0;
      const outCount = outdegree.get(node.id) ?? 0;
      if (inCount === 0) {
        roleById.set(node.id, "source");
      } else if (outCount === 0) {
        roleById.set(node.id, "sink");
      } else {
        roleById.set(node.id, "intermediate");
      }
    }
    return roleById;
  }, [graph.links, graph.nodes]);

  useEffect(() => {
    onSvgReady?.(svgRef.current);
    return () => onSvgReady?.(null);
  }, [onSvgReady]);

  useEffect(() => {
    onZoomChange?.(zoom);
  }, [onZoomChange, zoom]);

  useEffect(() => {
    if (canHoverLinks) return;
    setHoveredLinkIndex(null);
    setHoveredNodeId(null);
    setHoverText(null);
  }, [canHoverLinks]);

  const expandedGraph = useMemo(() => {
    const nodeIds = graph.nodes.map((node) => node.id);
    const nodeSet = new Set(nodeIds);
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, Array<{ target: string; value: number; index: number }>>();
    const layer = new Map<string, number>();
    const queue: string[] = [];

    for (const id of nodeIds) {
      indegree.set(id, 0);
      outgoing.set(id, []);
      layer.set(id, 0);
    }

    graph.links.forEach((link, index) => {
      if (!nodeSet.has(link.source) || !nodeSet.has(link.target)) return;
      outgoing.get(link.source)?.push({ target: link.target, value: link.value, index });
      indegree.set(link.target, (indegree.get(link.target) ?? 0) + 1);
    });

    for (const id of nodeIds) {
      if ((indegree.get(id) ?? 0) === 0) queue.push(id);
    }

    const remaining = new Map(indegree);
    const topoOrder: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      topoOrder.push(current);
      for (const edge of outgoing.get(current) ?? []) {
        const nextLayer = Math.max(layer.get(edge.target) ?? 0, (layer.get(current) ?? 0) + 1);
        layer.set(edge.target, nextLayer);
        const left = (remaining.get(edge.target) ?? 0) - 1;
        remaining.set(edge.target, left);
        if (left === 0) {
          queue.push(edge.target);
        }
      }
    }

    if (topoOrder.length !== nodeIds.length) {
      return {
        nodes: graph.nodes.map((node) => ({ ...node })),
        links: graph.links.map((link, index) => ({
          ...link,
          originalIndex: index,
          originalSource: link.source,
          originalTarget: link.target,
        })),
        layerById: new Map<string, number>(),
      };
    }

    const nodes: NodeDatum[] = graph.nodes.map((node) => ({ ...node }));
    const links: LinkDatum[] = [];

    graph.links.forEach((link, index) => {
      const sourceLayer = layer.get(link.source) ?? 0;
      const targetLayer = layer.get(link.target) ?? sourceLayer + 1;
      const span = Math.max(1, targetLayer - sourceLayer);

      if (span <= 1) {
        links.push({
          ...link,
          originalIndex: index,
          originalSource: link.source,
          originalTarget: link.target,
        });
        return;
      }

      let previous = link.source;
      for (let step = 1; step <= span; step += 1) {
        const isLastStep = step === span;
        const next = isLastStep ? link.target : `${DUMMY_NODE_PREFIX}${index}_${step}`;
        if (!isLastStep) {
          nodes.push({ id: next });
          layer.set(next, sourceLayer + step);
        }
        links.push({
          source: previous,
          target: next,
          value: link.value,
          originalIndex: index,
          originalSource: link.source,
          originalTarget: link.target,
        });
        previous = next;
      }
    });

    return { nodes, links, layerById: layer };
  }, [graph.links, graph.nodes]);

  const layoutOrdering = useMemo(() => {
    const nodeIndex = new Map<string, number>();
    const indegree = new Map<string, number>();
    const incoming = new Map<string, Array<{ source: string; value: number }>>();
    const outgoing = new Map<string, Array<{ target: string; value: number }>>();
    const inFlow = new Map<string, number>();
    const outFlow = new Map<string, number>();

    expandedGraph.nodes.forEach((node, index) => {
      nodeIndex.set(node.id, index);
      indegree.set(node.id, 0);
      incoming.set(node.id, []);
      outgoing.set(node.id, []);
      inFlow.set(node.id, 0);
      outFlow.set(node.id, 0);
    });

    for (const link of expandedGraph.links) {
      incoming.get(link.target)?.push({ source: link.source, value: link.value });
      outgoing.get(link.source)?.push({ target: link.target, value: link.value });
      indegree.set(link.target, (indegree.get(link.target) ?? 0) + 1);
      inFlow.set(link.target, (inFlow.get(link.target) ?? 0) + link.value);
      outFlow.set(link.source, (outFlow.get(link.source) ?? 0) + link.value);
    }

    const sourceIds = expandedGraph.nodes
      .filter((node) => (indegree.get(node.id) ?? 0) === 0)
      .map((node) => node.id)
      .sort((a, b) => (nodeIndex.get(a) ?? 0) - (nodeIndex.get(b) ?? 0));
    const sourceRank = new Map<string, number>(sourceIds.map((id, index) => [id, index]));

    const dominantCache = new Map<string, string>();
    const dominantSourceFor = (nodeId: string, trail = new Set<string>()): string => {
      if (dominantCache.has(nodeId)) return dominantCache.get(nodeId)!;
      if (sourceRank.has(nodeId)) {
        dominantCache.set(nodeId, nodeId);
        return nodeId;
      }
      if (trail.has(nodeId)) {
        const fallback = sourceIds[0] ?? nodeId;
        dominantCache.set(nodeId, fallback);
        return fallback;
      }
      const nextTrail = new Set(trail);
      nextTrail.add(nodeId);

      const candidates = (incoming.get(nodeId) ?? []).slice().sort((a, b) => {
        if (b.value !== a.value) return b.value - a.value;
        return (nodeIndex.get(a.source) ?? 0) - (nodeIndex.get(b.source) ?? 0);
      });
      if (candidates.length === 0) {
        const fallback = sourceIds[0] ?? nodeId;
        dominantCache.set(nodeId, fallback);
        return fallback;
      }
      const dominant = dominantSourceFor(candidates[0].source, nextTrail);
      dominantCache.set(nodeId, dominant);
      return dominant;
    };

    const roleRank = (nodeId: string) => {
      const role = nodeRoleMap.get(nodeId) ?? "intermediate";
      return role === "source" ? 0 : role === "intermediate" ? 1 : 2;
    };
    const clusterRank = (nodeId: string) => {
      const source = dominantSourceFor(nodeId);
      return sourceRank.get(source) ?? 9_999;
    };
    const flowRank = (nodeId: string) => {
      const out = outFlow.get(nodeId) ?? 0;
      const incomingValue = inFlow.get(nodeId) ?? 0;
      return out > 0 ? out : incomingValue;
    };
    const highFanNodes = expandedGraph.nodes.reduce((count, node) => {
      if (node.id.startsWith(DUMMY_NODE_PREFIX)) return count;
      const inCount = incoming.get(node.id)?.length ?? 0;
      const outCount = outgoing.get(node.id)?.length ?? 0;
      return inCount + outCount >= 4 ? count + 1 : count;
    }, 0);
    const denseGraph = expandedGraph.links.length > expandedGraph.nodes.length * 1.35;
    const useAutomaticOrdering =
      expandedGraph.links.length >= 32 ||
      expandedGraph.nodes.length >= 22 ||
      highFanNodes >= 4 ||
      denseGraph;

    const nodeSort = (a: SankeyNode<NodeDatum, LinkDatum>, b: SankeyNode<NodeDatum, LinkDatum>) => {
      const clusterDelta = clusterRank(a.id) - clusterRank(b.id);
      if (clusterDelta !== 0) return clusterDelta;
      const roleDelta = roleRank(a.id) - roleRank(b.id);
      if (roleDelta !== 0) return roleDelta;
      const flowDelta = flowRank(b.id) - flowRank(a.id);
      if (flowDelta !== 0) return flowDelta;
      return a.id.localeCompare(b.id);
    };

    const linkSort = (a: SankeyLink<NodeDatum, LinkDatum>, b: SankeyLink<NodeDatum, LinkDatum>) => {
      const sourceA = (a.source as SankeyNode<NodeDatum, LinkDatum>).id;
      const sourceB = (b.source as SankeyNode<NodeDatum, LinkDatum>).id;
      const targetA = (a.target as SankeyNode<NodeDatum, LinkDatum>).id;
      const targetB = (b.target as SankeyNode<NodeDatum, LinkDatum>).id;

      const clusterDelta = clusterRank(targetA) - clusterRank(targetB);
      if (clusterDelta !== 0) return clusterDelta;
      const sourceClusterDelta = clusterRank(sourceA) - clusterRank(sourceB);
      if (sourceClusterDelta !== 0) return sourceClusterDelta;
      const valueDelta = (b.value ?? 0) - (a.value ?? 0);
      if (valueDelta !== 0) return valueDelta;
      const sourceDelta = sourceA.localeCompare(sourceB);
      if (sourceDelta !== 0) return sourceDelta;
      return targetA.localeCompare(targetB);
    };

    const iterations =
      expandedGraph.links.length > 80 || expandedGraph.nodes.length > 32
        ? 96
        : expandedGraph.links.length > 40 || expandedGraph.nodes.length > 20
          ? 72
          : 36;

    return {
      nodeSort: useAutomaticOrdering ? undefined : nodeSort,
      linkSort: useAutomaticOrdering ? undefined : linkSort,
      iterations,
    };
  }, [expandedGraph.links, expandedGraph.nodes, nodeRoleMap]);

  const layout: GraphLayout = useMemo(() => {
    if (expandedGraph.nodes.length === 0 || expandedGraph.links.length === 0) {
      return EMPTY_LAYOUT;
    }
    const generator = sankey<NodeDatum, LinkDatum>()
      .nodeId((node) => node.id)
      .nodeAlign((node, depthCount) => {
        // If user specified an alignment, use it (and let D3 handle the layers naturally, even with dummy nodes)
        if (style.align === "left") return sankeyLeft(node, depthCount);
        if (style.align === "right") return sankeyRight(node, depthCount);
        if (style.align === "center") return sankeyCenter(node, depthCount);
        if (style.align === "justify") return sankeyJustify(node, depthCount);

        // Default to the explicit layering logic if no specific align is requested (or for 'custom')
        const maxLayer = Math.max(0, depthCount - 1);
        const explicitLayer = expandedGraph.layerById.get(node.id);
        const fallbackLayer = explicitLayer ?? node.depth ?? 0;
        const normalizedLayer = Number.isFinite(fallbackLayer) ? Math.floor(fallbackLayer) : 0;
        return Math.max(0, Math.min(maxLayer, normalizedLayer));
      })
      .nodeWidth(style.nodeWidth)
      .nodePadding(style.nodePadding)
      .iterations(layoutOrdering.iterations)
      .nodeSort(layoutOrdering.nodeSort)
      .linkSort(layoutOrdering.linkSort)
      .extent([
        [LEFT, TOP],
        [RIGHT, BOTTOM],
      ]);

    try {
      const built = generator({
        nodes: expandedGraph.nodes.map((node) => ({ ...node })),
        links: expandedGraph.links.map((link) => ({ ...link })),
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
    } catch (error) {
      console.error("Failed to build Sankey layout", error);
      return EMPTY_LAYOUT;
    }
  }, [expandedGraph, layoutOrdering, nodePositions, style.nodePadding, style.nodeWidth, style.align, RIGHT, BOTTOM, clampNodeTop]);

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
    const translateX = (1 - zoom) * (VIEW_WIDTH / 2) + pan.x;
    const translateY = (1 - zoom) * (VIEW_HEIGHT / 2) + pan.y;
    return {
      x: (svgX - translateX) / zoom,
      y: (svgY - translateY) / zoom,
    };
  };

  const nodeMap = useMemo(() => {
    return new Map(layout.nodes.map((node) => [node.id, node]));
  }, [layout.nodes]);

  const layoutBounds = useMemo(() => {
    let minX0 = Number.POSITIVE_INFINITY;
    let maxX1 = Number.NEGATIVE_INFINITY;
    for (const node of layout.nodes) {
      minX0 = Math.min(minX0, node.x0 ?? 0);
      maxX1 = Math.max(maxX1, node.x1 ?? 0);
    }
    return {
      minX0: Number.isFinite(minX0) ? minX0 : LEFT,
      maxX1: Number.isFinite(maxX1) ? maxX1 : RIGHT,
    };
  }, [layout.nodes, LEFT, RIGHT]);

  const displayLinks = useMemo(() => {
    const grouped = new Map<
      number,
      {
        originalSource: string;
        originalTarget: string;
        value: number;
        first: SankeyLink<NodeDatum, LinkDatum> | null;
        last: SankeyLink<NodeDatum, LinkDatum> | null;
      }
    >();

    for (const link of layout.links) {
      const source = link.source as SankeyNode<NodeDatum, LinkDatum>;
      const target = link.target as SankeyNode<NodeDatum, LinkDatum>;
      const originalIndex = link.originalIndex ?? link.index ?? 0;
      const originalSource = link.originalSource ?? source.id;
      const originalTarget = link.originalTarget ?? target.id;

      const entry =
        grouped.get(originalIndex) ??
        {
          originalSource,
          originalTarget,
          value: link.value ?? 0,
          first: null,
          last: null,
        };

      if (source.id === originalSource || entry.first == null) {
        entry.first = link;
      }
      if (target.id === originalTarget || entry.last == null) {
        entry.last = link;
      }
      entry.value = link.value ?? entry.value;
      grouped.set(originalIndex, entry);
    }

    const links: DisplayLink[] = [];
    const sortedEntries = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);

    for (const [originalIndex, entry] of sortedEntries) {
      if (!entry.first || !entry.last) continue;
      const sourceNode = entry.first.source as SankeyNode<NodeDatum, LinkDatum>;
      const targetNode = entry.last.target as SankeyNode<NodeDatum, LinkDatum>;
      if (
        sourceNode.id.startsWith(DUMMY_NODE_PREFIX) ||
        targetNode.id.startsWith(DUMMY_NODE_PREFIX)
      ) {
        continue;
      }

      const y0 =
        entry.first.y0 ?? ((sourceNode.y0 ?? 0) + (sourceNode.y1 ?? sourceNode.y0 ?? 0)) / 2;
      const y1 =
        entry.last.y1 ?? ((targetNode.y0 ?? 0) + (targetNode.y1 ?? targetNode.y0 ?? 0)) / 2;

      links.push({
        originalIndex,
        originalSource: entry.originalSource,
        originalTarget: entry.originalTarget,
        value: entry.value,
        width: Math.max(1, entry.first.width ?? entry.last.width ?? 1),
        y0,
        y1,
      });
    }

    return links;
  }, [layout.links]);

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
          includedLinks.add(link.originalIndex ?? index);
          if (!includedNodes.has(source)) {
            includedNodes.add(source);
            queue.push(source);
          }
        }
        if (traceMode === "downstream" && source === current) {
          includedLinks.add(link.originalIndex ?? index);
          if (!includedNodes.has(target)) {
            includedNodes.add(target);
            queue.push(target);
          }
        }
      });
    }

    return { includedNodes, includedLinks };
  }, [layout.links, selectedNodeIds, traceMode]);

  const nodeValueMap = useMemo(() => {
    const inValues = new Map<string, number>();
    const outValues = new Map<string, number>();
    for (const node of layout.nodes) {
      inValues.set(node.id, 0);
      outValues.set(node.id, 0);
    }
    for (const link of layout.links) {
      const source = (link.source as SankeyNode<NodeDatum, LinkDatum>).id;
      const target = (link.target as SankeyNode<NodeDatum, LinkDatum>).id;
      const value = link.value ?? 0;
      outValues.set(source, (outValues.get(source) ?? 0) + value);
      inValues.set(target, (inValues.get(target) ?? 0) + value);
    }
    const values = new Map<string, number>();
    for (const node of layout.nodes) {
      const outValue = outValues.get(node.id) ?? 0;
      const inValue = inValues.get(node.id) ?? 0;
      values.set(node.id, outValue > 0 ? outValue : inValue);
    }
    return values;
  }, [layout.links, layout.nodes]);

  const { maxLinkValue, totalLinkValue } = useMemo(() => {
    let maxValue = 0;
    let totalValue = 0;
    for (const link of displayLinks) {
      const v = link.value ?? 0;
      maxValue = Math.max(maxValue, v);
      totalValue += v;
    }
    return { maxLinkValue: maxValue || 1, totalLinkValue: totalValue || 1 };
  }, [displayLinks]);

  const nodeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    layout.nodes.forEach((node, index) => {
      if (colorStrategy === "semantic") {
        const role = nodeRoleMap.get(node.id) ?? "intermediate";
        map.set(node.id, SEMANTIC_ROLE_COLORS[role]);
      } else {
        map.set(node.id, colors[index % colors.length]);
      }
    });
    return map;
  }, [colorStrategy, colors, layout.nodes, nodeRoleMap]);

  const hoverContext = useMemo(() => {
    if (traceMode !== "none") return null;
    if (hoveredLinkIndex == null && hoveredNodeId == null) return null;

    const highlightedNodes = new Set<string>();
    const highlightedLinks = new Set<number>();
    const softenedLinks = new Set<number>();

    // Full chain path highlighting logic (BFS Upstream + Downstream)
    const highlightPath = (startNodeIds: string[]) => {
      const queue = [...startNodeIds];
      const visited = new Set(startNodeIds);

      // Add initial nodes
      startNodeIds.forEach(id => highlightedNodes.add(id));

      // 1. Trace Downstream
      queue.length = 0;
      queue.push(...startNodeIds);
      visited.clear();
      startNodeIds.forEach(id => visited.add(id));

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        displayLinks.forEach((link, idx) => {
          if (link.originalSource === currentId) {
            highlightedLinks.add(idx);
            if (!highlightedNodes.has(link.originalTarget)) {
              highlightedNodes.add(link.originalTarget);
              queue.push(link.originalTarget);
            }
          }
        });
      }

      // 2. Trace Upstream
      queue.length = 0;
      queue.push(...startNodeIds);
      visited.clear();
      startNodeIds.forEach(id => visited.add(id));

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        displayLinks.forEach((link, idx) => {
          if (link.originalTarget === currentId) {
            highlightedLinks.add(idx);
            if (!highlightedNodes.has(link.originalSource)) {
              highlightedNodes.add(link.originalSource);
              queue.push(link.originalSource);
            }
          }
        });
      }
    };

    if (hoveredNodeId) {
      highlightPath([hoveredNodeId]);
    } else if (hoveredLinkIndex != null) {
      const link = displayLinks[hoveredLinkIndex];
      // Highlight specific link and trace from both ends
      highlightedLinks.add(hoveredLinkIndex);
      highlightPath([link.originalSource, link.originalTarget]);
    }

    // Soften others (optional, logic kept from before but simplified)
    if (highlightedLinks.size > 0) {
      displayLinks.forEach((link, idx) => {
        if (!highlightedLinks.has(idx)) {
          // Check if it shares a node with highlighted path? 
          // For now just everything else is dimmed (handled by renderer usually)
          // But we can add "softened" if we want a second degree of highlight
        }
      });
    }

    return { highlightedNodes, highlightedLinks, softenedLinks };
  }, [displayLinks, hoveredLinkIndex, hoveredNodeId, traceMode]);

  const onCanvasMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    if (panning) {
      setPan({
        x: panning.originX + (event.clientX - panning.startX),
        y: panning.originY + (event.clientY - panning.startY),
      });
      return;
    }
    if (dragState && !isPanActive) {
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
    if (selectionBox && !isPanActive) {
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
          onSelectionChange?.([]);
          onLinkSelectionChange?.(null);
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
          onSelectionChange?.(uniqueIds([...selectedNodeIds, ...hitIds]));
        } else {
          onSelectionChange?.(hitIds);
          onLinkSelectionChange?.(null);
        }
      }
    }

    setSelectionBox(null);
    setDragState(null);
    setPanning(null);
  };

  const onCanvasMouseDown = (event: MouseEvent<SVGSVGElement>) => {
    const isMiddleButton = event.button === 1;
    if (isMiddleButton || isPanActive) {
      event.preventDefault();
      setPanning({
        startX: event.clientX,
        startY: event.clientY,
        originX: pan.x,
        originY: pan.y,
      });
      return;
    }
    if (isPanActive) return;
    if (event.button !== 0) return;
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

  const handleCanvasWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    setZoom((currentZoom) => {
      const next = currentZoom + (event.deltaY > 0 ? -0.05 : 0.05);
      return Math.max(0.5, Math.min(1.8, next));
    });
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
      className={`relative h-full w-full overflow-hidden rounded-2xl border ${cursorClass} ${isDark ? "border-slate-700 bg-slate-950/70" : "border-slate-300 bg-white/90"}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_16%,rgba(56,189,248,0.05)_0%,transparent_62%),radial-gradient(ellipse_at_82%_72%,rgba(244,114,182,0.035)_0%,transparent_56%)]" />
      <div className={zoomPillClass}>
        {Math.round(zoom * 100)}%
      </div>
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
        <g transform={`translate(${(1 - zoom) * 600 + pan.x}, ${(1 - zoom) * 350 + pan.y}) scale(${zoom})`}>
          {displayLinks.map((link, index) => (
            (() => {
              const originalIndex = link.originalIndex;
              const key = linkStyleKey(originalIndex);
              const linkStyle = linkStyles[key];
              const originalSource = link.originalSource;
              const originalTarget = link.originalTarget;
              const baseColor = linkStyle?.color || nodeColorMap.get(originalSource) || colors[index % colors.length];
              const baseOpacity = Math.max(
                0.05,
                Math.min(1, linkStyle?.opacity ?? style.linkOpacity),
              );
              const widthScale = Math.max(0.2, Math.min(4, linkStyle?.widthScale ?? 1));
              const baseWidth = Math.max(1, link.width * widthScale);
              const valueWeight = Math.max(0, Math.min(1, link.value / maxLinkValue));
              const tonedBaseOpacity = Math.max(0.08, Math.min(1, baseOpacity * (0.78 + valueWeight * 0.22)));
              const opacity =
                trace
                  ? trace.includedLinks.has(originalIndex)
                    ? Math.min(1, tonedBaseOpacity + 0.2)
                    : Math.max(0.08, tonedBaseOpacity * 0.22)
                  : hoverContext
                    ? hoverContext.highlightedLinks.has(index)
                      ? Math.min(1, tonedBaseOpacity + 0.22)
                      : hoverContext.softenedLinks.has(index)
                        ? Math.max(0.1, tonedBaseOpacity * 0.72)
                        : Math.max(0.06, tonedBaseOpacity * 0.2)
                    : hoveredLinkIndex === index || selectedLinkIndex === originalIndex
                      ? Math.min(1, tonedBaseOpacity + 0.16)
                      : tonedBaseOpacity;

              const sourceNode = nodeMap.get(originalSource);
              const targetNode = nodeMap.get(originalTarget);
              if (!sourceNode || !targetNode) return null;
              const x0 = sourceNode.x1 ?? 0;
              const x1 = targetNode.x0 ?? 0;
              const path = effectiveHints.simplifyLinkCurves
                ? `M${x0},${link.y0}L${x1},${link.y1}`
                : (() => {
                  const c = Math.max(0.15, Math.min(0.85, style.curvature));
                  const xi = x0 + (x1 - x0) * c;
                  const xj = x1 - (x1 - x0) * c;
                  return `M${x0},${link.y0}C${xi},${link.y0} ${xj},${link.y1} ${x1},${link.y1}`;
                })();

              // 1. Calculate Staggered Delay based on horizontal position (x0)
              // The further right, the longer the delay.
              const delay = (sourceNode.x0 ?? 0) / VIEW_WIDTH * 0.6; // 0.6s total spread

              return (

                <React.Fragment key={`link-${index}`}>
                  {/* Global animation style (injected once practically, or we rely on class) */}
                  {index === 0 && (
                    <style dangerouslySetInnerHTML={{
                      __html: `
                        @keyframes sankey-flow {
                          from { stroke-dashoffset: 1; }
                          to { stroke-dashoffset: 0; }
                        }
                      `
                    }} />
                  )}
                  <path
                    pathLength="1" // Trick: Normalize path length to 1 for CSS
                    d={path}
                    style={{
                      // In dark mode, 'multiply' makes things invisible against dark bg. Use 'screen' or 'normal'.
                      mixBlendMode: isDark && style.linkBlendMode === "multiply" ? "screen" : style.linkBlendMode,
                      strokeDasharray: 1,
                      strokeDashoffset: 1, // Start hidden
                      animation: `sankey-flow 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards`, // Smooth ease-out
                      animationDelay: `${delay}s`
                    }}
                    fill="none"
                    stroke={baseColor}
                    strokeOpacity={opacity}
                    strokeWidth={
                      hoveredLinkIndex === index || selectedLinkIndex === originalIndex || pulseLinkIndex === originalIndex
                        ? Math.max(2, baseWidth + 1)
                        : baseWidth
                    }
                    strokeLinecap="butt"
                    strokeLinejoin={linkRender === "soft" ? "round" : "miter"}
                    className={!isPanActive && interactionMode === "select" ? "cursor-pointer" : "cursor-grab"}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      if (isPanActive || interactionMode !== "select") return;
                      event.preventDefault();
                      event.stopPropagation();
                      onLinkSelectionChange(originalIndex);
                      if (onLinkEditRequest) {
                        onLinkEditRequest(originalIndex, {
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }
                    }}
                    onMouseEnter={() => {
                      if (!canHoverLinks) return;
                      setHoveredLinkIndex(index);
                      const pct = ((link.value / totalLinkValue) * 100).toFixed(1);
                      setHoverText(
                        `${originalSource} → ${originalTarget}: ${formatCompactValue(link.value)} (${pct}%)`,
                      );
                    }}
                    onMouseLeave={() => {
                      setHoveredLinkIndex(null);
                      setHoverText(null);
                    }}
                  />
                </React.Fragment>
              );
            })()
          ))}

          {layout.nodes.map((node, index) => {
            const x0 = node.x0 ?? 0;
            const x1 = node.x1 ?? 0;
            const y0 = node.y0 ?? 0;
            const y1 = node.y1 ?? 0;
            const nodeId = node.id;
            if (nodeId.startsWith(DUMMY_NODE_PREFIX)) return null;
            const centerY = (y0 + y1) / 2;
            const leftSide = x0 < 600;
            const nodeHeight = y1 - y0;
            const isSelected = selectedNodeIds.includes(nodeId);
            const dimmedByTrace = Boolean(trace && !trace.includedNodes.has(nodeId));
            const dimmedByHover = Boolean(
              !trace && hoverContext && !hoverContext.highlightedNodes.has(nodeId),
            );
            const atSourceEdge = Math.abs(x0 - layoutBounds.minX0) < 1;
            const atSinkEdge = Math.abs(x1 - layoutBounds.maxX1) < 1;
            const forceOutsideLabel = atSourceEdge || atSinkEdge;
            const canShowInsideLabel =
              style.labelPosition === "inside" && !forceOutsideLabel && nodeHeight >= style.labelFontSize + 10;
            const labelX = canShowInsideLabel
              ? x0 + (x1 - x0) / 2
              : atSourceEdge
                ? x0 - 10
                : atSinkEdge
                  ? x1 + 10
                  : leftSide
                    ? x1 + 12
                    : x0 - 12;
            const labelAnchor = canShowInsideLabel
              ? "middle"
              : atSourceEdge
                ? "end"
                : atSinkEdge
                  ? "start"
                  : leftSide
                    ? "start"
                    : "end";
            const nodeValue = nodeValueMap.get(nodeId) ?? 0;
            const isThresholdHidden = (style.labelThreshold ?? 0) > 0 && nodeValue < (style.labelThreshold ?? 0);
            const valueText = formatCompactValue(nodeValue);
            const titleFontSize = Math.max(16, style.labelFontSize + 4);
            const valueFontSize = Math.max(13, style.labelFontSize + 1);
            const hoverBadgeVisible =
              labelStyle === "badge" &&
              !canShowInsideLabel &&
              (hoveredNodeId === nodeId || isSelected);
            const badgeWidth = Math.max(120, Math.max(nodeId.length, valueText.length) * 8 + 28);
            const badgeHeight = 50;
            const badgeX =
              labelAnchor === "start"
                ? labelX - 8
                : labelAnchor === "end"
                  ? labelX - badgeWidth + 8
                  : labelX - badgeWidth / 2;
            const badgeY = centerY - badgeHeight / 2;
            const nodeFill = nodeStyles[nodeId]?.color || nodeColorMap.get(nodeId) || colors[index % colors.length];
            const badgeFill = isDark ? "rgba(15, 23, 42, 0.78)" : "rgba(255, 255, 255, 0.9)";
            const badgeStroke = isDark ? "rgba(148, 163, 184, 0.4)" : "rgba(148, 163, 184, 0.65)";
            const badgeTitle = isDark ? "#f8fafc" : "#0f172a";
            const badgeValue = isDark ? "#cbd5e1" : "#475569";
            const badgeHalo = isDark ? "rgba(15, 23, 42, 0.86)" : "rgba(255, 255, 255, 0.95)";

            return (
              <g key={`${node.id}-${index}`} opacity={dimmedByTrace ? 0.3 : dimmedByHover ? 0.35 : 1}>
                <rect
                  x={x0}
                  y={y0}
                  width={Math.max(1, x1 - x0)}
                  height={Math.max(8, y1 - y0)}
                  rx={style.nodeRadius}
                  fill={nodeFill}
                  fillOpacity={
                    Math.max(0.15, Math.min(1, nodeStyles[nodeId]?.opacity ?? 1)) *
                    (pulseNodeId === nodeId ? 1 : 1)
                  }
                  stroke={
                    isSelected || hoveredNodeId === nodeId || pulseNodeId === nodeId
                      ? "var(--text-primary)"
                      : "none"
                  }
                  strokeWidth={
                    pulseNodeId === nodeId
                      ? 2.4
                      : isSelected
                        ? 2
                        : hoveredNodeId === nodeId
                          ? 1.5
                          : 0
                  }
                  className={!isPanActive && interactionMode === "select" ? "cursor-ns-resize" : "cursor-grab"}
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    if (isPanActive || interactionMode !== "select") return;
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
                  onMouseEnter={() => {
                    if (!canHoverLinks) return;
                    setHoveredNodeId(nodeId);
                  }}
                  onMouseLeave={() => {
                    if (!canHoverLinks) return;
                    setHoveredNodeId((current) => (current === nodeId ? null : current));
                  }}
                  onClick={(event) => {
                    if (event.button !== 0) return;
                    if (isPanActive || interactionMode !== "select") return;
                    event.preventDefault();
                    event.stopPropagation();
                    onNodeEditRequest?.(nodeId, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                />
                {canShowLabels && !isThresholdHidden && hoverBadgeVisible && (
                  <g pointerEvents="none">
                    <rect
                      x={badgeX}
                      y={badgeY}
                      width={badgeWidth}
                      height={badgeHeight}
                      rx={8}
                      fill={badgeFill}
                      stroke={badgeStroke}
                      strokeOpacity={1}
                    />
                    <text
                      x={labelX}
                      y={centerY - 10}
                      textAnchor={labelAnchor}
                      dominantBaseline="middle"
                      fontSize={titleFontSize}
                      fontWeight={700}
                      fontFamily={style.labelFontFamily === "System Sans" ? "ui-sans-serif, system-ui, sans-serif" : style.labelFontFamily}
                      fill={badgeTitle}
                      stroke={badgeHalo}
                      strokeWidth={2}
                      paintOrder="stroke"
                    >
                      {nodeId}
                    </text>
                    <text
                      x={labelX}
                      y={centerY + 14}
                      textAnchor={labelAnchor}
                      dominantBaseline="middle"
                      fontSize={valueFontSize}
                      fontWeight={500}
                      fontFamily={style.labelFontFamily === "System Sans" ? "ui-sans-serif, system-ui, sans-serif" : style.labelFontFamily}
                      fill={badgeValue}
                    >
                      {valueText}
                    </text>
                  </g>
                )}
                {canShowLabels && !isThresholdHidden && !hoverBadgeVisible && canShowInsideLabel && (
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
                    fill={insideLabelColor}
                    stroke={insideLabelStroke}
                    strokeWidth={1.6}
                    paintOrder="stroke"
                    fontWeight={600}
                  >
                    {nodeId}
                  </text>
                )}
                {canShowLabels && !isThresholdHidden && !hoverBadgeVisible && !canShowInsideLabel && (
                  <g pointerEvents="none">
                    <text
                      x={labelX}
                      y={centerY - Math.max(9, titleFontSize * 0.45)}
                      textAnchor={labelAnchor}
                      dominantBaseline="middle"
                      fontSize={titleFontSize}
                      fontWeight={700}
                      fontFamily={style.labelFontFamily === "System Sans" ? "ui-sans-serif, system-ui, sans-serif" : style.labelFontFamily}
                      fill={labelColor}
                      stroke="var(--bg-elevated)"
                      strokeWidth={2}
                      paintOrder="stroke"
                    >
                      {nodeId}
                    </text>
                    <text
                      x={labelX}
                      y={centerY + Math.max(10, valueFontSize * 0.95)}
                      textAnchor={labelAnchor}
                      dominantBaseline="middle"
                      fontSize={valueFontSize}
                      fontWeight={500}
                      fontFamily={style.labelFontFamily === "System Sans" ? "ui-sans-serif, system-ui, sans-serif" : style.labelFontFamily}
                      fill={isDark ? "rgba(226, 232, 240, 0.88)" : "rgba(15, 23, 42, 0.78)"}
                    >
                      {valueText}
                    </text>
                  </g>
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
              fill="var(--primary-subtle)"
              stroke="var(--primary)"
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>

      {hoverText && canHoverLinks && (
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
