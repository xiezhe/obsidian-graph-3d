export interface Graph3DSettings {
  defaultView: "2d" | "3d";
  nodeSizeMultiplier: number;
  edgeOpacity: number;
  showLabels: "always" | "hover" | "never";
  centerStrength: number;
  repelStrength: number;
  linkDistance: number;
  linkStrength: number;
  colorMode: "degree" | "community";
  bloomEnabled: boolean;
  particleBg: boolean;
  backgroundColor: string;
}

export const DEFAULT_SETTINGS: Graph3DSettings = {
  defaultView: "3d",
  nodeSizeMultiplier: 1.5,
  edgeOpacity: 0.4,
  showLabels: "always",
  centerStrength: 0.5,
  repelStrength: 15,
  linkDistance: 150,
  linkStrength: 0.3,
  colorMode: "community",
  bloomEnabled: false,
  particleBg: false,
  backgroundColor: "#1a1a2e",
};
