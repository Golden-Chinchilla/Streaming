/**
 * Sankey Plugin – barrel export
 */

export { sankeyPlugin } from "./sankey-plugin";
export type { SankeyData, SankeyGraph, SankeyStyle, SankeyLinkInput, EditableLink } from "./sankey-types";
export { defaultSankeyStyle, defaultSankeyData } from "./sankey-defaults";
export { parseSankeyText, parseSankeyTextDetailed } from "./sankey-parse";
export type { ParseIssue } from "./sankey-parse";
export { SankeyCanvas } from "./sankey-canvas";
export { serializeLinksByFormat } from "./sankey-serialize";
