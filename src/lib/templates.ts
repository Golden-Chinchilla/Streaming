import { SankeyStyle, TemplateSummary } from "@/lib/types";

const defaultStyle: SankeyStyle = {
  nodeWidth: 20,
  nodePadding: 14,
  nodeRadius: 4,
  linkOpacity: 0.6,
  curvature: 0.5,
  showLabels: true,
  labelFontSize: 12,
  labelPosition: "outside",
  labelColor: "#334155",
  labelFontFamily: "Roboto",
  theme: "light",
  palette: "classic",
};

const energyJson = `[
  { "source": "Total Energy", "target": "Renewable", "value": 450 },
  { "source": "Total Energy", "target": "Fossil Fuel", "value": 620 },
  { "source": "Renewable", "target": "Solar", "value": 210 },
  { "source": "Renewable", "target": "Wind", "value": 180 },
  { "source": "Renewable", "target": "Hydro", "value": 60 },
  { "source": "Fossil Fuel", "target": "Gas", "value": 280 },
  { "source": "Fossil Fuel", "target": "Coal", "value": 340 }
]`;

const supplyChainCsv = `source,target,value
Raw Materials,Plant A,350
Raw Materials,Plant B,240
Plant A,Warehouse East,180
Plant A,Warehouse West,170
Plant B,Warehouse East,120
Plant B,Warehouse West,120
Warehouse East,Retail,290
Warehouse West,Retail,290`;

const marketingJson = `[
  { "source": "Traffic", "target": "Landing Page", "value": 12000 },
  { "source": "Landing Page", "target": "Signup", "value": 5200 },
  { "source": "Landing Page", "target": "Bounce", "value": 6800 },
  { "source": "Signup", "target": "Qualified Lead", "value": 2200 },
  { "source": "Qualified Lead", "target": "Opportunity", "value": 980 },
  { "source": "Opportunity", "target": "Won", "value": 310 }
]`;

export const templateList: TemplateSummary[] = [
  {
    id: "energy",
    name: "Energy Distribution",
    category: "Engineering",
    difficulty: "Medium",
    description: "Track energy flows and losses across generation and usage.",
    tags: ["energy", "operations", "flow"],
    accent: "from-blue-500 to-emerald-500",
    document: {
      title: "Q3 Energy Distribution",
      format: "json",
      editorText: energyJson,
      style: defaultStyle,
      nodePositions: {},
      nodeStyles: {},
      linkStyles: {},
    },
  },
  {
    id: "supply-chain",
    name: "Supply Chain Logistics",
    category: "Business",
    difficulty: "Medium",
    description: "Visualize raw material to warehouse to retail flow.",
    tags: ["supply-chain", "logistics", "ops"],
    accent: "from-cyan-500 to-teal-500",
    document: {
      title: "Supply Chain Overview",
      format: "csv",
      editorText: supplyChainCsv,
      style: defaultStyle,
      nodePositions: {},
      nodeStyles: {},
      linkStyles: {},
    },
  },
  {
    id: "marketing",
    name: "Marketing Funnel",
    category: "Marketing",
    difficulty: "Advanced",
    description: "Analyze customer journey from traffic to conversion.",
    tags: ["marketing", "funnel", "conversion"],
    accent: "from-pink-500 to-orange-500",
    document: {
      title: "Campaign Funnel",
      format: "json",
      editorText: marketingJson,
      style: defaultStyle,
      nodePositions: {},
      nodeStyles: {},
      linkStyles: {},
    },
  },
];

export const blankDocument = {
  title: "Untitled Diagram",
  format: "json" as const,
  editorText: energyJson,
  style: defaultStyle,
  nodePositions: {},
  nodeStyles: {},
  linkStyles: {},
};

export function templateById(templateId?: string | null) {
  if (!templateId) {
    return undefined;
  }
  return templateList.find((template) => template.id === templateId);
}


