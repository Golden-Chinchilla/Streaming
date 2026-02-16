import { SwimlaneData, SwimlaneStyle } from "./swimlane-types";

export const defaultSwimlaneStyle: SwimlaneStyle = {
    theme: "dark",
    laneHeaderWidth: 120,
    nodeRadius: 6,
    edgeOpacity: 0.6,
    showLabels: true,
    labelFontSize: 12,
    edgeCurvature: 0.5,
    palette: "ocean",
};

const defaultEditorText = `{
  "lanes": [
    { "id": "customer", "label": "Customer" },
    { "id": "sales", "label": "Sales Team" },
    { "id": "engineering", "label": "Engineering" }
  ],
  "nodes": [
    { "id": "request", "label": "Submit Request", "type": "start", "laneId": "customer" },
    { "id": "review", "label": "Review Request", "type": "task", "laneId": "sales" },
    { "id": "approve", "label": "Approved?", "type": "decision", "laneId": "sales" },
    { "id": "develop", "label": "Develop Feature", "type": "task", "laneId": "engineering" },
    { "id": "test", "label": "QA Testing", "type": "subprocess", "laneId": "engineering" },
    { "id": "deliver", "label": "Deliver to Customer", "type": "task", "laneId": "sales" },
    { "id": "done", "label": "Complete", "type": "end", "laneId": "customer" },
    { "id": "reject", "label": "Request Rejected", "type": "end", "laneId": "customer" }
  ],
  "edges": [
    { "id": "e1", "source": "request", "target": "review" },
    { "id": "e2", "source": "review", "target": "approve" },
    { "id": "e3", "source": "approve", "target": "develop", "label": "Yes" },
    { "id": "e4", "source": "approve", "target": "reject", "label": "No" },
    { "id": "e5", "source": "develop", "target": "test" },
    { "id": "e6", "source": "test", "target": "deliver" },
    { "id": "e7", "source": "deliver", "target": "done" }
  ]
}`;

export const defaultSwimlaneData: SwimlaneData = {
    format: "json",
    editorText: defaultEditorText,
    lanes: [
        { id: "customer", label: "Customer" },
        { id: "sales", label: "Sales Team" },
        { id: "engineering", label: "Engineering" },
    ],
    nodes: [
        { id: "request", label: "Submit Request", type: "start", laneId: "customer", x: 0, y: 0, width: 140, height: 40 },
        { id: "review", label: "Review Request", type: "task", laneId: "sales", x: 0, y: 0, width: 140, height: 40 },
        { id: "approve", label: "Approved?", type: "decision", laneId: "sales", x: 0, y: 0, width: 140, height: 40 },
        { id: "develop", label: "Develop Feature", type: "task", laneId: "engineering", x: 0, y: 0, width: 140, height: 40 },
        { id: "test", label: "QA Testing", type: "subprocess", laneId: "engineering", x: 0, y: 0, width: 140, height: 40 },
        { id: "deliver", label: "Deliver to Customer", type: "task", laneId: "sales", x: 0, y: 0, width: 140, height: 40 },
        { id: "done", label: "Complete", type: "end", laneId: "customer", x: 0, y: 0, width: 140, height: 40 },
        { id: "reject", label: "Request Rejected", type: "end", laneId: "customer", x: 0, y: 0, width: 140, height: 40 },
    ],
    edges: [
        { id: "e1", source: "request", target: "review" },
        { id: "e2", source: "review", target: "approve" },
        { id: "e3", source: "approve", target: "develop", label: "Yes" },
        { id: "e4", source: "approve", target: "reject", label: "No" },
        { id: "e5", source: "develop", target: "test" },
        { id: "e6", source: "test", target: "deliver" },
        { id: "e7", source: "deliver", target: "done" },
    ],
    style: defaultSwimlaneStyle,
};
