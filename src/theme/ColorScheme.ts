import type { GraphNode } from "../data/types";

const CYBER_PALETTE = ["#39e7ff", "#3f7bff", "#f0c419", "#2ec4b6", "#5aa9ff"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getNodeColor(node: GraphNode, mode: "degree" | "community", maxDegree = 1): string {
  if (mode === "degree") {
    const ratio = maxDegree <= 0 ? 0 : clamp(node.degree / maxDegree, 0, 1);
    if (ratio > 0.72) {
      return "#f0c419";
    }
    if (ratio > 0.38) {
      return "#2ec4b6";
    }
    return "#3f7bff";
  }

  if (node.community < 0) {
    return "#3f7bff";
  }

  return CYBER_PALETTE[Math.abs(node.community) % CYBER_PALETTE.length];
}

export function getNodeSize(node: GraphNode, baseMultiplier: number): number {
  const rawSize = 3.5 + Math.log2(node.degree + 1) * 2.4;
  return clamp(rawSize * baseMultiplier, 4, 22);
}
