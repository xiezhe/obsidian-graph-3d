import type { GraphData } from "./types";

export class GraphMetrics {
  static compute(graphData: GraphData): void {
    this.computeDegree(graphData);
    this.computeCommunities(graphData);
  }

  private static computeDegree(graphData: GraphData): void {
    for (const node of graphData.nodes.values()) {
      node.degree = 0;
      node.betweenness = 0;
    }

    for (const edge of graphData.edges) {
      const source = graphData.nodes.get(edge.source);
      const target = graphData.nodes.get(edge.target);

      if (source) {
        source.degree += edge.weight;
      }

      if (target) {
        target.degree += edge.weight;
      }
    }
  }

  private static computeCommunities(graphData: GraphData): void {
    const visited = new Set<string>();
    let communityId = 0;

    for (const node of graphData.nodes.values()) {
      if (visited.has(node.id)) {
        continue;
      }

      const stack = [node.id];
      while (stack.length > 0) {
        const currentId = stack.pop();
        if (!currentId || visited.has(currentId)) {
          continue;
        }

        visited.add(currentId);
        const currentNode = graphData.nodes.get(currentId);
        if (!currentNode) {
          continue;
        }

        currentNode.community = communityId;
        for (const neighborId of currentNode.neighbors) {
          if (!visited.has(neighborId) && graphData.nodes.has(neighborId)) {
            stack.push(neighborId);
          }
        }
      }

      communityId += 1;
    }
  }
}
