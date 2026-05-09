import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import * as THREE from "three";

import type { GraphData, GraphNode } from "../data/types";
import type { Graph3DSettings } from "../settings/defaultSettings";
import { getNodeColor, getNodeSize } from "../theme/ColorScheme";

export type LayoutMode = "force" | "hierarchical" | "radial" | "cluster";

type RenderNode = GraphNode & {
  name: string;
  val: number;
  color: string;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
};
type RenderLink = { source: string; target: string; value: number; color: string; type: string };
type ForceGraphInstance = ForceGraph3DInstance<RenderNode, RenderLink>;

type FilterState = {
  group: string;
  tag: string;
  minDegree: number;
};

interface LabelSprite {
  position: { set: (x: number, y: number, z: number) => void };
  scale: { set: (x: number, y: number, z: number) => void };
  material: { opacity: number };
}

interface ScreenLabelRect {
  nodeId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  depth: number;
  priority: number;
  mat: { opacity: number };
}

export class Renderer3D {
  private readonly container: HTMLElement;
  private graph: ForceGraphInstance | null = null;
  private highlightedNodeIds = new Set<string>();
  private highlightedEdgeKeys = new Set<string>();
  private hoveredNodeId: string | null = null;
  private hiddenNodeIds = new Set<string>();
  private maxDegree = 1;
  private sourceGraphData: GraphData | null = null;
  private visibleGraphData: GraphData = { nodes: new Map(), edges: [] };
  private settings: Graph3DSettings | null = null;
  private filters: FilterState = { group: "all", tag: "all", minDegree: 0 };
  private layoutMode: LayoutMode = "force";
  private particleFlowEnabled = false;
  private firstRender = true;
  private renderedNodeIndex = new Map<string, RenderNode>();
  private readonly textureCache = new Map<string, unknown>();
  private readonly labelTextureCache = new Map<string, LabelSprite>();
  private readonly highlightRings = new Map<string, { visible: boolean }>();
  private readonly labelEntries = new Map<string, { sprite: LabelSprite; priority: number }>();
  private occlusionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.empty();
    this.container.addClass("graph-3d-container");
    this.graph = new ForceGraph3D(this.container, {
      controlType: "orbit",
      rendererConfig: { antialias: true, alpha: true },
    }) as unknown as ForceGraphInstance;
    this.graph
      .enableNodeDrag(true)
      .enablePointerInteraction(true)
      .enableNavigationControls(true)
      .showNavInfo(false)
      .numDimensions(3)
      .onNodeDrag((node) => {
        node.fx = node.x;
        node.fy = node.y;
        node.fz = node.z;
      })
      .onNodeDragEnd((node) => {
        node.fx = node.x;
        node.fy = node.y;
        node.fz = node.z;
      });

    const controls = this.graph.controls() as {
      enablePan?: boolean;
      enableZoom?: boolean;
      enableRotate?: boolean;
      screenSpacePanning?: boolean;
      mouseButtons?: { LEFT: number; MIDDLE: number; RIGHT: number };
      update?: () => void;
    };
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.screenSpacePanning = true;
    if (controls.mouseButtons) {
      controls.mouseButtons = {
        LEFT: 0,
        MIDDLE: 1,
        RIGHT: 2,
      };
    }
    controls.update?.();
    (controls as unknown as { addEventListener: (ev: string, fn: () => void) => void }).addEventListener?.("change", () => {
      this.scheduleOcclusionCheck();
    });
    // 加速力模拟衰减，拖拽后更快稳定
    const sim = this.graph as unknown as Record<string, unknown>;
    if (typeof sim.d3AlphaDecay === "function") {
      (sim.d3AlphaDecay as (v: number) => void)(0.05);
    }
    if (typeof sim.d3VelocityDecay === "function") {
      (sim.d3VelocityDecay as (v: number) => void)(0.45);
    }
    this.resize();
  }

  render(graphData: GraphData, settings: Graph3DSettings): void {
    this.sourceGraphData = graphData;
    this.settings = settings;
    // 首次渲染延迟到下一帧，确保容器已布局完
    if (this.firstRender) {
      this.firstRender = false;
      requestAnimationFrame(() => {
        this.applyState();
      });
    } else {
      this.applyState();
    }
  }

  setFilters(nextFilters: Partial<FilterState>): void {
    this.filters = { ...this.filters, ...nextFilters };
    this.applyState();
  }

  setLayout(mode: LayoutMode): void {
    this.layoutMode = mode;
    this.applyState();
  }

  setHighlightedNodeIds(nodeIds: string[]): void {
    // hide all rings, then show only for highlighted
    for (const ring of this.highlightRings.values()) {
      ring.visible = false;
    }
    this.highlightedNodeIds = new Set(nodeIds);
    for (const nodeId of nodeIds) {
      const ring = this.highlightRings.get(nodeId);
      if (ring) {
        ring.visible = true;
      }
    }
  }

  setHoveredNode(nodeId: string | null): void {
    if (this.hoveredNodeId === nodeId) {
      return;
    }
    this.hoveredNodeId = nodeId;
    this.graph?.refresh();
  }

  setHighlightedPath(nodeIds: string[], edgeKeys: string[]): void {
    // hide all rings first
    for (const ring of this.highlightRings.values()) {
      ring.visible = false;
    }
    this.highlightedNodeIds = new Set(nodeIds);
    this.highlightedEdgeKeys = new Set(edgeKeys);
    for (const nodeId of nodeIds) {
      const ring = this.highlightRings.get(nodeId);
      if (ring) {
        ring.visible = true;
      }
    }
  }

  clearHighlights(): void {
    this.highlightedNodeIds.clear();
    this.highlightedEdgeKeys.clear();
    for (const ring of this.highlightRings.values()) {
      ring.visible = false;
    }
  }

  private createHighlightRing(): unknown {
    const D = 128;
    const canvas = document.createElement("canvas");
    canvas.width = D;
    canvas.height = D;
    const ctx = canvas.getContext("2d")!;
    const half = D / 2;

    const glow = ctx.createRadialGradient(half, half, half * 0.1, half, half, half * 0.85);
    glow.addColorStop(0, "#facc15");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(half, half, half * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = half * 0.08;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(half, half, half * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.2, 2.2, 1);
    (sprite as Record<string, unknown>).renderOrder = 1;
    return sprite;
  }

  setHiddenNodeIds(nodeIds: string[]): void {
    this.hiddenNodeIds = new Set(nodeIds);
    this.applyState();
  }

  getVisibleGraphData(): GraphData {
    return this.visibleGraphData;
  }

  getRenderedNode(nodeId: string): RenderNode | null {
    return this.renderedNodeIndex.get(nodeId) ?? null;
  }

  getFilterState(): FilterState {
    return { ...this.filters };
  }

  getLayoutMode(): LayoutMode {
    return this.layoutMode;
  }

  setParticleFlow(enabled: boolean): void {
    this.particleFlowEnabled = enabled;
    if (!this.graph) return;
    const g = this.graph as unknown as Record<string, unknown>;
    if (enabled) {
      if (typeof g.linkDirectionalParticles === "function") g.linkDirectionalParticles(2);
      if (typeof g.linkDirectionalParticleSpeed === "function") g.linkDirectionalParticleSpeed(0.0015);
      if (typeof g.linkDirectionalParticleWidth === "function") g.linkDirectionalParticleWidth(1.8);
      if (typeof g.linkDirectionalParticleColor === "function") {
        g.linkDirectionalParticleColor((link: { color: string }) => link.color);
      }
      if (typeof g.linkDirectionalParticleResolution === "function") g.linkDirectionalParticleResolution(6);
    } else {
      if (typeof g.linkDirectionalParticles === "function") g.linkDirectionalParticles(0);
    }
  }

  getParticleFlow(): boolean {
    return this.particleFlowEnabled;
  }

  private applyState(zoomToFit = true): void {
    if (!this.graph) {
      return;
    }

    if (!this.sourceGraphData || !this.settings) {
      return;
    }

    const settings = this.settings;
    const { nodes: visibleNodesMap, edges: visibleEdges } = this.buildVisibleGraph(this.sourceGraphData);
    this.visibleGraphData = { nodes: visibleNodesMap, edges: visibleEdges };

    const nodes = Array.from(visibleNodesMap.values());
    this.maxDegree = nodes.reduce((max, node) => Math.max(max, node.degree), 1);

    const renderNodes: RenderNode[] = nodes.map((node) => {
      const n = node as Partial<GraphNode>;
      return {
        id: n.id ?? "",
        label: n.label ?? "",
        group: n.group ?? "",
        path: n.path ?? "",
        degree: n.degree ?? 0,
        betweenness: n.betweenness ?? 0,
        community: n.community ?? -1,
        tags: n.tags ?? [],
        weight: n.weight ?? 1,
        neighbors: [],
        isOrphan: n.isOrphan ?? true,
        name: n.label ?? "",
        val: getNodeSize(node, settings.nodeSizeMultiplier),
        color: getNodeColor(node, settings.colorMode, this.maxDegree),
      };
    });

    this.applyLayout(renderNodes);

    const renderLinks: RenderLink[] = visibleEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      value: edge.weight,
      color: edge.type === "tag" ? "#8b5cf6" : edge.type === "embed" ? "#22c55e" : "#94a3b8",
      type: edge.type,
    }));

    this.renderedNodeIndex = new Map(renderNodes.map((node) => [node.id, node]));
    this.labelEntries.clear();

    this.graph
      .backgroundColor("rgba(0,0,0,0)")
      .graphData({ nodes: renderNodes, links: renderLinks })
      .nodeLabel((node) => (settings.showLabels !== "never" ? this.buildNodeLabel(node) : ""))
      .nodeThreeObject((node: RenderNode) => this.buildNodeObject(node, settings))
      .nodeThreeObjectExtend(false)
      .nodeVal((node) => getNodeSize(node, settings.nodeSizeMultiplier))
      .linkOpacity(Math.max(settings.edgeOpacity, 0.12))
      .linkWidth((link) => {
        if (this.highlightedEdgeKeys.has(this.getEdgeKey(String(link.source), String(link.target)))) {
          return 3;
        }
        const src = this.renderedNodeIndex.get(String(link.source));
        const tgt = this.renderedNodeIndex.get(String(link.target));
        const minDeg = Math.min(src?.degree ?? 0, tgt?.degree ?? 0);
        const lr = this.maxDegree > 0 ? minDeg / this.maxDegree : 0;
        let w = Math.max(0.35, link.value * 0.45);
        if (lr >= 0.25) w *= 1.7;
        else if (lr < 0.05) w *= 0.45;
        return w;
      })
      .linkColor((link) =>
        this.highlightedEdgeKeys.has(this.getEdgeKey(String(link.source), String(link.target))) ? "#f59e0b" : link.color,
      )
      .linkCurvature((link) => (link.type === "tag" ? 0.18 : 0.08))
      .linkResolution(10)
      .warmupTicks(this.guessWarmupTicks(renderNodes.length));

    // 在每次渲染时保留粒子流动开关状态
    if (this.particleFlowEnabled) {
    const g = this.graph as unknown as Record<string, unknown>;
      if (typeof g.linkDirectionalParticles === "function") g.linkDirectionalParticles(2);
      if (typeof g.linkDirectionalParticleSpeed === "function") g.linkDirectionalParticleSpeed(0.0015);
      if (typeof g.linkDirectionalParticleWidth === "function") g.linkDirectionalParticleWidth(1.8);
      if (typeof g.linkDirectionalParticleColor === "function") {
        g.linkDirectionalParticleColor((link: { color: string }) => link.color);
      }
      if (typeof g.linkDirectionalParticleResolution === "function") g.linkDirectionalParticleResolution(6);
    }

    const nodeCount = renderNodes.length;
    const centerStrength = this.layoutMode === "force" ? settings.centerStrength : 0.05;
    const repelStrength = this.layoutMode === "force"
      ? Math.max(settings.repelStrength, nodeCount * 0.1)
      : 5;
    const linkDist = this.layoutMode === "force"
      ? Math.max(settings.linkDistance, nodeCount * 1.5)
      : 60;
    const linkStr = this.layoutMode === "force" ? settings.linkStrength : 0.05;

    const centerForce = this.graph.d3Force("center");
    centerForce?.strength?.(centerStrength);

    const chargeForce = this.graph.d3Force("charge");
    chargeForce?.strength?.(-repelStrength);

    const linkForce = this.graph.d3Force("link");
    linkForce?.distance?.(linkDist);
    linkForce?.strength?.(linkStr);

    const collideForce = this.graph.d3Force("collide");
    if (collideForce) {
      collideForce.radius((node: object) => {
        const n = node as RenderNode;
        const val = n.val ?? 1;
        return Math.max(val * 0.35, 2);
      });
      collideForce.strength?.(this.layoutMode === "force" ? 0.7 : 0.3);
    }

    this.resize();

    if (zoomToFit) {
      // zoomToFit 自动计算最佳相机距离和视角，无过渡动画
      this.graph.zoomToFit(0, 60);
    } else {
      this.graph.refresh();
    }
    this.updateLabelOcclusion();
  }

  getGraph(): ForceGraphInstance | null {
    return this.graph;
  }

  resize(): void {
    if (!this.graph) {
      return;
    }

    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.graph.width(width).height(height);
  }

  focusNode(node: Partial<RenderNode> | null, transitionMs = 1200): void {
    if (!this.graph || !node || node.x == null || node.y == null || node.z == null) {
      return;
    }

    const distance = 120;
    const magnitude = Math.max(1, Math.hypot(node.x, node.y, node.z));
    const distRatio = 1 + distance / magnitude;

    this.graph.cameraPosition(
      { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
      { x: node.x, y: node.y, z: node.z },
      transitionMs,
    );
  }

  dispose(): void {
    if (!this.graph) {
      return;
    }

    this.highlightRings.clear();
    this.graph.onNodeHover(() => {}).onNodeClick(() => {});
    this.graph.pauseAnimation();
    this.graph._destructor();
    this.container.empty();
    this.graph = null;
    this.textureCache.clear();
    this.labelTextureCache.clear();
    this.renderedNodeIndex.clear();
    this.labelEntries.clear();
    if (this.occlusionDebounceTimer !== null) {
      clearTimeout(this.occlusionDebounceTimer);
      this.occlusionDebounceTimer = null;
    }
  }

  private buildNodeLabel(node: RenderNode): string {
    const tags = node.tags.length > 0 ? `<br/>Tags: ${node.tags.join(", ")}` : "";
    return `<div><strong>${node.label}</strong><br/>Degree: ${node.degree}${tags}</div>`;
  }

  private buildNodeObject(node: RenderNode, settings: Graph3DSettings): unknown {
    const size = getNodeSize(node, settings.nodeSizeMultiplier);
    const lod = this.getNodeLod(node);
    const nodeSprite = this.createNodeSprite(node, settings);

    // highlight ring — hidden by default, toggled via highlightRings map
    const highlightRing = this.createHighlightRing() as unknown as { visible: boolean; scale: { set: (x: number, y: number, z: number) => void } };
    highlightRing.visible = false;
    const ringScale = Math.max(size * 0.55, 6);
    highlightRing.scale.set(ringScale, ringScale, 1);
    this.highlightRings.set(node.id, highlightRing);

    if (settings.showLabels === "always" && lod < 2) {
      const labelSprite = this.createLabelSprite(node.label, size, lod);
      labelSprite.position.set(0, size * 0.4 + 3, 0);
      const baseH = lod === 0 ? size * 0.24 : size * 0.18;
      const tex = (labelSprite as unknown as { material?: { map?: { image?: { width: number; height: number } } } }).material?.map?.image;
      const aspect = tex ? tex.width / Math.max(tex.height, 1) : 4;
      (labelSprite.scale as { set: (x: number, y: number, z: number) => void }).set(baseH * aspect, baseH, 1);
      this.labelEntries.set(node.id, { sprite: labelSprite, priority: node.degree });

      const group = new THREE.Group();
      group.add(nodeSprite as unknown as Record<string, unknown>);
      group.add(highlightRing as unknown as Record<string, unknown>);
      group.add(labelSprite as unknown as Record<string, unknown>);
      return group;
    }

    // L2: no label, but still add highlight ring
    const group = new THREE.Group();
    group.add(nodeSprite as unknown as Record<string, unknown>);
    group.add(highlightRing as unknown as Record<string, unknown>);
    return group;
  }

  private getNodeLod(node: RenderNode): number {
    const total = this.maxDegree;
    // 节点很少(<10)时所有节点都显示文字
    if (this.renderedNodeIndex.size < 10) return 0;
    const ratio = total > 0 ? node.degree / total : 0;
    if (ratio >= 0.25) {
      return 0;
    }
    if (ratio >= 0.05) {
      return 1;
    }
    return 2;
  }

  private createNodeSprite(node: RenderNode, settings: Graph3DSettings): LabelSprite {
    const lod = this.getNodeLod(node);
    const color = getNodeColor(node, settings.colorMode, this.maxDegree);
    const cacheKey = `${color}|lod${lod}`;
    let material = this.textureCache.get(cacheKey) as unknown as { clone?: () => unknown } | undefined;

    if (!material) {
      const D = lod === 0 ? 256 : lod === 1 ? 128 : 64;
      const canvas = document.createElement("canvas");
      canvas.width = D;
      canvas.height = D;
      const ctx = canvas.getContext("2d")!;
      const half = D / 2;

      if (lod >= 2) {
        // minimal dot
        const r = half * 0.7;
        const g = ctx.createRadialGradient(half, half, 0, half, half, r);
        g.addColorStop(0, color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(half, half, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // glow
        const glowRadius = lod === 0 ? 0.85 : 0.7;
        const glow = ctx.createRadialGradient(half, half, half * 0.12, half, half, half * glowRadius);
        glow.addColorStop(0, color);
        glow.addColorStop(0.45, color);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.globalAlpha = lod === 0 ? 0.5 : 0.4;
        ctx.fillRect(0, 0, D, D);
        ctx.globalAlpha = 1;

        if (lod === 0) {
          // outer ring
          ctx.strokeStyle = color;
          ctx.lineWidth = half * 0.08;
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(half, half, half * 0.45, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;

          // inner ring
          ctx.strokeStyle = "#dff8ff";
          ctx.lineWidth = half * 0.05;
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          ctx.arc(half, half, half * 0.3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // core dot
        const coreR = half * 0.22;
        const coreGrad = ctx.createRadialGradient(half, half, 0, half, half, coreR);
        coreGrad.addColorStop(0, "#ffffff");
        coreGrad.addColorStop(0.5, color);
        coreGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(half, half, coreR, 0, Math.PI * 2);
        ctx.fill();
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      material = new THREE.SpriteMaterial({
        map: texture,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        transparent: true,
      });
      this.textureCache.set(cacheKey, material);
    }

    const size = getNodeSize(node, settings.nodeSizeMultiplier);
    const sprite = new THREE.Sprite((material as { clone?: () => unknown }).clone?.() as Record<string, unknown> ?? material);
    (sprite as Record<string, unknown>).renderOrder = 2;
    const scale = Math.max(size * 0.44, 8);
    sprite.scale.set(scale, scale, 1);
    return sprite;
  }

  private createLabelSprite(text: string, nodeSize: number, lod: number): LabelSprite {
    const truncated = text.length > 18 ? text.slice(0, 17) + "…" : text;
    const fontSize = lod >= 1
      ? Math.round(Math.max(nodeSize * 3.5, 20))
      : Math.round(Math.max(nodeSize * 5.5, 36));
    const cacheKey = `${truncated}|lod${lod}|${fontSize}`;

    const cachedMat = this.labelTextureCache.get(cacheKey);
    if (cachedMat) {
      const sprite = new THREE.Sprite((cachedMat as unknown as { clone: () => unknown }).clone()) as unknown as LabelSprite;
      (sprite as unknown as { renderOrder: number }).renderOrder = 3;
      return sprite;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    const fontStr = `700 ${fontSize}px "Inter", -apple-system, system-ui, sans-serif`;
    ctx.font = fontStr;

    // Measure actual text width and size canvas to fit exactly
    const metrics = ctx.measureText(truncated);
    const textWidth = metrics.width;
    const paddingX = lod >= 1 ? 40 : 60;
    const paddingY = lod >= 1 ? 20 : 30;
    canvas.width = Math.max(Math.ceil(textWidth + paddingX), 128);
    canvas.height = Math.max(Math.ceil(fontSize * 1.4 + paddingY), 48);

    // Re-set font after canvas resize (resize clears context)
    ctx.font = fontStr;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    if (lod >= 1) {
      ctx.shadowColor = "#2e8cff";
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#d9f6ff";
      ctx.fillText(truncated, cx, cy);
      ctx.shadowBlur = 2;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(truncated, cx, cy);
    } else {
      ctx.shadowColor = "#2e8cff";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#d9f6ff";
      ctx.fillText(truncated, cx, cy);
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(truncated, cx, cy);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });
    this.labelTextureCache.set(cacheKey, material as unknown as LabelSprite);

    const sprite = new THREE.Sprite(material) as unknown as LabelSprite;
    (sprite as unknown as { renderOrder: number }).renderOrder = 3;
    return sprite;
  }

  private scheduleOcclusionCheck(): void {
    if (this.occlusionDebounceTimer !== null) {
      clearTimeout(this.occlusionDebounceTimer);
    }
    this.occlusionDebounceTimer = setTimeout(() => {
      this.occlusionDebounceTimer = null;
      this.updateLabelOcclusion();
    }, 80);
  }

  private updateLabelOcclusion(): void {
    if (this.labelEntries.size < 2 || this.settings?.showLabels !== "always") {
      return;
    }

    const camera = this.graph?.camera?.() as {
      position: { x: number; y: number; z: number };
      projectionMatrix: number[][];
      matrixWorldInverse: number[][];
      getWorldDirection?: (v: unknown) => void;
    } | undefined;
    const renderer = this.graph?.renderer?.() as {
      domElement?: { width: number; height: number };
    } | undefined;

    if (!camera || !renderer?.domElement) {
      return;
    }

    const viewW = renderer.domElement.width || 1920;
    const viewH = renderer.domElement.height || 1080;

    const rects: ScreenLabelRect[] = [];
    for (const [nodeId, entry] of this.labelEntries) {
      const node = this.renderedNodeIndex.get(nodeId);
      if (!node || node.x == null || node.y == null || node.z == null) {
        continue;
      }

      const pos = this.projectToScreen(node.x, node.y, node.z, camera, viewW, viewH);
      if (!pos) {
        continue;
      }

      const depth = this.getDepth(node.x, node.y, node.z, camera);
      const labelW = 140;
      const labelH = 30;
      rects.push({
        nodeId,
        left: pos.x - labelW / 2,
        right: pos.x + labelW / 2,
        top: pos.y - labelH / 2,
        bottom: pos.y + labelH / 2,
        depth,
        priority: entry.priority,
        mat: entry.sprite.material,
      });
    }

    if (rects.length < 2) {
      // 只有 0~1 个标签时不做遮挡剔除
      for (const entry of this.labelEntries.values()) {
        entry.sprite.material.opacity = 1;
      }
      return;
    }

    // Compute average label aspect ratio (paper: optimize grid cell shape)
    let totalRatio = 0;
    for (const r of rects) {
      const w = r.right - r.left;
      const h = Math.max(r.bottom - r.top, 1);
      totalRatio += w / h;
    }
    const avgRatio = totalRatio / rects.length;

    // Adaptive cell size based on average label aspect ratio
    const cellW = Math.max((avgRatio > 1 ? avgRatio * 45 : 80), 30);
    const cellH = Math.max((avgRatio <= 1 ? 40 / avgRatio : 50), 20);

    // Build spatial grid
    const grid = new Map<string, number[]>();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const minCol = Math.floor(r.left / cellW);
      const maxCol = Math.floor(r.right / cellW);
      const minRow = Math.floor(r.top / cellH);
      const maxRow = Math.floor(r.bottom / cellH);

      for (let col = minCol; col <= maxCol; col++) {
        for (let row = minRow; row <= maxRow; row++) {
          const key = `${col},${row}`;
          let list = grid.get(key);
          if (!list) {
            list = [];
            grid.set(key, list);
          }
          list.push(i);
        }
      }
    }

    // Detect overlaps within each grid cell
    const overlapped = new Set<number>();
    for (const [, indices] of grid) {
      if (indices.length < 2) {
        continue;
      }
      for (let a = 0; a < indices.length; a++) {
        for (let b = a + 1; b < indices.length; b++) {
          const i = indices[a];
          const j = indices[b];
          if (overlapped.has(i) && overlapped.has(j)) {
            continue;
          }
          // Axis-aligned bounding box overlap check
          if (
            rects[i].left < rects[j].right &&
            rects[i].right > rects[j].left &&
            rects[i].top < rects[j].bottom &&
            rects[i].bottom > rects[j].top
          ) {
            // Keep the higher-priority (higher degree) label visible
            // Tie-break by depth (closer to camera wins)
            const iWins =
              rects[i].priority > rects[j].priority ||
              (rects[i].priority === rects[j].priority && rects[i].depth < rects[j].depth);
            overlapped.add(iWins ? j : i);
          }
        }
      }
    }

    // Apply opacity: full for visible, dim for occluded
    for (let i = 0; i < rects.length; i++) {
      rects[i].mat.opacity = overlapped.has(i) ? 0.18 : 0.9;
    }
  }

  private projectToScreen(
    x: number,
    y: number,
    z: number,
    camera: Record<string, unknown>,
    viewW: number,
    viewH: number,
  ): { x: number; y: number } | null {
    try {
      const viewMat = (camera.matrixWorldInverse as { elements: number[] | Float32Array })?.elements;
      const projMat = (camera.projectionMatrix as { elements: number[] | Float32Array })?.elements;

      if (!viewMat || !projMat) {
        return null;
      }

      // Manual NDC transform using column-major 4x4 matrices
      // p_cam = lookAt * [x, y, z, 1]
      const cx = viewMat[0] * x + viewMat[4] * y + viewMat[8] * z + viewMat[12];
      const cy = viewMat[1] * x + viewMat[5] * y + viewMat[9] * z + viewMat[13];
      const cz = viewMat[2] * x + viewMat[6] * y + viewMat[10] * z + viewMat[14];
      const cw = viewMat[3] * x + viewMat[7] * y + viewMat[11] * z + viewMat[15];

      // p_clip = projection * p_cam
      const nx = projMat[0] * cx + projMat[4] * cy + projMat[8] * cz + projMat[12] * cw;
      const ny = projMat[1] * cx + projMat[5] * cy + projMat[9] * cz + projMat[13] * cw;
      const nz = projMat[2] * cx + projMat[6] * cy + projMat[10] * cz + projMat[14] * cw;
      const nw = projMat[3] * cx + projMat[7] * cy + projMat[11] * cz + projMat[15] * cw;

      if (Math.abs(nw) < 1e-10) {
        return null;
      }

      const ndcX = nx / nw;
      const ndcY = ny / nw;

      if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) {
        return null;
      }

      return {
        x: (ndcX + 1) / 2 * viewW,
        y: (-ndcY + 1) / 2 * viewH,
      };
    } catch {
      return null;
    }
  }

  private getDepth(x: number, y: number, z: number, camera: Record<string, unknown>): number {
    const pos = camera.position as { x: number; y: number; z: number };
    if (!pos) {
      return 0;
    }
    const dx = x - pos.x;
    const dy = y - pos.y;
    const dz = z - pos.z;
    return Math.hypot(dx, dy, dz);
  }

  private guessWarmupTicks(nodeCount: number): number {
    if (nodeCount < 60) {
      return 200;
    }
    if (nodeCount < 300) {
      return 260;
    }
    return Math.min(300 + Math.floor(nodeCount * 0.06), 500);
  }

  private buildVisibleGraph(graphData: GraphData): GraphData {
    const visibleNodes = new Map<string, GraphNode>();

    for (const node of graphData.nodes.values()) {
      const groupOk = this.filters.group === "all" || node.group === this.filters.group;
      const tagOk = this.filters.tag === "all" || node.tags.includes(this.filters.tag);
      const degreeOk = node.degree >= this.filters.minDegree;
      const hiddenOk = !this.hiddenNodeIds.has(node.id);

      if (groupOk && tagOk && degreeOk && hiddenOk) {
        visibleNodes.set(node.id, { ...node, neighbors: [...node.neighbors] });
      }
    }

    const visibleEdges = graphData.edges.filter((edge) => visibleNodes.has(edge.source) && visibleNodes.has(edge.target));
    for (const node of visibleNodes.values()) {
      node.neighbors = node.neighbors.filter((neighborId) => visibleNodes.has(neighborId));
      node.isOrphan = node.neighbors.length === 0;
    }

    return { nodes: visibleNodes, edges: visibleEdges };
  }

  private applyLayout(nodes: RenderNode[]): void {
    if (this.layoutMode === "force") {
      for (const node of nodes) {
        delete node.fx;
        delete node.fy;
        delete node.fz;
      }
      return;
    }

    if (this.layoutMode === "hierarchical") {
      const groups = new Map<number, RenderNode[]>();
      for (const node of nodes) {
        const depth = node.path.split("/").filter(Boolean).length;
        const list = groups.get(depth) ?? [];
        list.push(node);
        groups.set(depth, list);
      }

      for (const [depth, depthNodes] of groups.entries()) {
        depthNodes.sort((a, b) => a.community - b.community || a.label.localeCompare(b.label));
        const spread = Math.max(depthNodes.length - 1, 1) * 60;
        depthNodes.forEach((node, index) => {
          const x = (index * 60) - spread / 2;
          const y = -depth * 120;
          const z = (depth % 3) * 40 - 40;
          node.x = x;
          node.y = y;
          node.z = z;
          node.fx = x;
          node.fy = y;
          node.fz = z;
        });
      }
      return;
    }

    if (this.layoutMode === "radial") {
      const sorted = [...nodes].sort((a, b) => b.degree - a.degree);
      sorted.forEach((node, index) => {
        if (index === 0) {
          node.x = 0;
          node.y = 0;
          node.z = 0;
        } else {
          const ring = Math.floor(Math.sqrt(index));
          const angle = index * 1.2;
          const radius = 90 + ring * 70;
          node.x = Math.cos(angle) * radius;
          node.y = (ring % 3) * 50 - 50;
          node.z = Math.sin(angle) * radius;
        }
        node.fx = node.x;
        node.fy = node.y;
        node.fz = node.z;
      });
      return;
    }

    const byCommunity = new Map<number, RenderNode[]>();
    for (const node of nodes) {
      const list = byCommunity.get(node.community) ?? [];
      list.push(node);
      byCommunity.set(node.community, list);
    }

    Array.from(byCommunity.entries()).forEach(([communityId, communityNodes], communityIndex) => {
      const clusterAngle = communityIndex * 1.6;
      const clusterRadius = 180;
      const clusterX = Math.cos(clusterAngle) * clusterRadius;
      const clusterZ = Math.sin(clusterAngle) * clusterRadius;
      communityNodes.forEach((node, index) => {
        const localAngle = index * 0.9;
        const localRadius = 20 + Math.floor(index / 8) * 24;
        const x = clusterX + Math.cos(localAngle) * localRadius;
        const y = (communityId % 4) * 40 - 60;
        const z = clusterZ + Math.sin(localAngle) * localRadius;
        node.x = x;
        node.y = y;
        node.z = z;
        node.fx = x;
        node.fy = y;
        node.fz = z;
      });
    });
  }

  private getEdgeKey(a: string, b: string): string {
    return [a, b].sort((left, right) => left.localeCompare(right)).join("::");
  }
}
