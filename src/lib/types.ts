export type DataFormat = "json" | "csv";
export type PerformanceMode = "auto" | "quality" | "balanced" | "performance";

export type SankeyLinkInput = {
  source: string;
  target: string;
  value: number;
};

export type SankeyGraph = {
  nodes: { id: string }[];
  links: SankeyLinkInput[];
};

export type SankeyStyle = {
  nodeWidth: number;
  nodePadding: number;
  nodeRadius: number;
  linkOpacity: number;
  curvature: number;
  showLabels: boolean;
  labelFontSize: number;
  labelPosition: "inside" | "outside";
  labelColor: string;
  labelFontFamily: "Roboto" | "Google Sans" | "System Sans";
  theme: "light" | "dark";
  palette: "classic" | "ocean" | "sunset";
};

export type SankeyDocument = {
  id: string;
  title: string;
  format: DataFormat;
  editorText: string;
  style: SankeyStyle;
  nodePositions: Record<string, number>;
  nodeStyles: Record<string, { color?: string; opacity?: number }>;
  linkStyles: Record<string, { color?: string; opacity?: number; widthScale?: number }>;
  updatedAt: number;
};

export type TemplateSummary = {
  id: string;
  name: string;
  category: string;
  difficulty: "Easy" | "Medium" | "Advanced";
  description: string;
  tags?: string[];
  accent: string;
  document: Omit<SankeyDocument, "id" | "updatedAt">;
};

export type AppPreferences = {
  defaultTheme: "light" | "dark";
  defaultPerformanceMode: PerformanceMode;
  defaultExportTransparentBg: boolean;
  defaultExportFileTemplate: string;
};

