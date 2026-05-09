export interface GraphNode {
  id: string;
  label: string;
  group: string;
  path: string;
  degree: number;
  betweenness: number;
  community: number;
  tags: string[];
  weight: number;
  neighbors: string[];
  isOrphan: boolean;
}

export type GraphEdgeType = "link" | "tag" | "embed";

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  type: GraphEdgeType;
}

export interface GraphData {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}
