export interface GraphEdge {
  from: string;
  to: string;
  weight: number;
}

export interface DependencyGraph {
  nodes: string[];
  edges: GraphEdge[];
}
