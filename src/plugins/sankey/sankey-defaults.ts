import { DARK_LABEL_COLOR } from "@/lib/theme";
import { SankeyData, SankeyStyle } from "./sankey-types";

export const defaultSankeyStyle: SankeyStyle = {
  nodeWidth: 20,
  nodePadding: 14,
  nodeRadius: 4,
  linkOpacity: 0.6,
  curvature: 0.5,
  labelStyle: "badge",
  linkRender: "soft",
  colorStrategy: "palette",
  showLabels: true,
  labelFontSize: 12,
  labelPosition: "outside",
  labelColor: DARK_LABEL_COLOR,
  labelFontFamily: "System Sans",
  theme: "dark",
  palette: "ocean",
};

const defaultEditorText = `[
  { "source": "Total Energy", "target": "Renewable", "value": 450 },
  { "source": "Total Energy", "target": "Fossil Fuel", "value": 620 },
  { "source": "Renewable", "target": "Solar", "value": 210 },
  { "source": "Renewable", "target": "Wind", "value": 180 },
  { "source": "Renewable", "target": "Hydro", "value": 60 },
  { "source": "Fossil Fuel", "target": "Gas", "value": 280 },
  { "source": "Fossil Fuel", "target": "Coal", "value": 340 }
]`;

export const defaultSankeyData: SankeyData = {
  format: "json",
  editorText: defaultEditorText,
  style: defaultSankeyStyle,
  nodePositions: {},
  nodeStyles: {},
  linkStyles: {},
};
