import { App } from "obsidian";

import type { GraphData, GraphNode } from "../data/types";
import { Renderer3D, type LayoutMode } from "../renderer/Renderer3D";

type SearchableNode = GraphNode & { x?: number; y?: number; z?: number };

// ---------------------------------------------------------------------------
// CustomSelect – 完全可控的下拉组件，避免原生 <select> 在 Windows 上的黑背景
// ---------------------------------------------------------------------------
interface CustomSelectOption {
  label: string;
  value: string;
}

class CustomSelect {
  readonly containerEl: HTMLDivElement;
  private readonly labelEl: HTMLButtonElement;
  private readonly menuEl: HTMLDivElement;
  private items: CustomSelectOption[] = [];
  private value_ = "all";
  onChange: (() => void) | null = null;

  constructor(parent: HTMLElement, defaultLabel?: string) {
    this.containerEl = parent.createDiv({ cls: "graph-3d-custom-select" });

    this.labelEl = this.containerEl.createEl("button", { cls: "graph-3d-custom-select-label" });
    this.labelEl.setText(defaultLabel ?? "Select");

    this.menuEl = this.containerEl.createDiv({ cls: "graph-3d-custom-select-menu" });

    this.labelEl.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      this.menuEl.toggleClass("is-open", !this.menuEl.hasClass("is-open"));
    };

    // 点击选项
    this.menuEl.onclick = (e: MouseEvent) => {
      const item = (e.target as HTMLElement)?.closest?.("[data-value]") as HTMLElement | null;
      if (!item) return;
      const val = item.dataset.value ?? "all";
      this.value = val;
      this.menuEl.removeClass("is-open");
      this.onChange?.();
    };

    // 点击外部关闭
    this.closeBound = this.onDocumentClick.bind(this);
    document.addEventListener("click", this.closeBound);
  }

  private closeBound: (e: MouseEvent) => void;

  private onDocumentClick(e: MouseEvent): void {
    if (!this.containerEl.contains(e.target as Node)) {
      this.menuEl.removeClass("is-open");
    }
  }

  get value(): string {
    return this.value_;
  }

  set value(v: string) {
    this.value_ = v;
    const matched = this.items.find((it) => it.value === v);
    this.labelEl.setText(matched?.label ?? v);
    this.menuEl.querySelectorAll(".graph-3d-custom-select-item").forEach((el) => {
      el.toggleClass("is-selected", (el as HTMLElement).dataset.value === v);
    });
  }

  add(opt: { label: string; value: string }): void {
    this.items.push({ label: opt.label, value: opt.value });
    const btn = this.menuEl.createEl("button", {
      cls: "graph-3d-custom-select-item",
      attr: { "data-value": opt.value },
      text: opt.label,
    });
    if (opt.value === this.value_) {
      btn.addClass("is-selected");
    }
  }

  empty(): void {
    this.items = [];
    this.menuEl.empty();
  }

  remove(): void {
    document.removeEventListener("click", this.closeBound);
    this.containerEl.remove();
  }
}
// ---------------------------------------------------------------------------

export class InteractionManager {
  private readonly app: App;
  private readonly container: HTMLElement;
  private readonly renderer: Renderer3D;
  private tooltipEl: HTMLDivElement | null = null;
  private toolbarEl: HTMLDivElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private groupSelect: CustomSelect | null = null;
  private tagSelect: CustomSelect | null = null;
  private degreeInputEl: HTMLInputElement | null = null;
  private layoutSelect: CustomSelect | null = null;
  private pathButtonEl: HTMLButtonElement | null = null;
  private clearButtonEl: HTMLButtonElement | null = null;
  private particleButtonEl: HTMLButtonElement | null = null;
  private nodeIndex = new Map<string, SearchableNode>();
  private pathMode = false;
  private pathSelection: string[] = [];
  private currentGraphData: GraphData = { nodes: new Map(), edges: [] };
  private dragGuardUntil = 0;
  private hiddenNodeRefCounts = new Map<string, number>();
  private collapsedRoots = new Map<string, string[]>();

  constructor(app: App, container: HTMLElement, renderer: Renderer3D) {
    this.app = app;
    this.container = container;
    this.renderer = renderer;
  }

  bind(graphData: GraphData): void {
    this.currentGraphData = graphData;
    this.nodeIndex = new Map(Array.from(graphData.nodes.values()).map((node) => [node.id, node]));
    this.ensureUi();

    const graph = this.renderer.getGraph();
    if (
      !graph ||
      !this.tooltipEl ||
      !this.searchInputEl ||
      !this.groupSelect ||
      !this.tagSelect ||
      !this.degreeInputEl ||
      !this.layoutSelect ||
      !this.pathButtonEl ||
      !this.clearButtonEl ||
      !this.particleButtonEl
    ) {
      return;
    }

    this.populateFilterOptions(graphData);

    graph
      .onNodeHover((node) => {
        document.body.style.cursor = node ? "pointer" : "default";
        this.updateTooltip(node);
        this.renderer.setHoveredNode(node ? node.id : null);
      })
      .onNodeDrag(() => {
        this.dragGuardUntil = Date.now() + 250;
      })
      .onNodeDragEnd(() => {
        this.dragGuardUntil = Date.now() + 250;
      })
      .onNodeClick((node, event) => {
        if (Date.now() < this.dragGuardUntil) {
          return;
        }

        if (event.ctrlKey || event.metaKey) {
          this.toggleNeighborCollapse(node.id);
          return;
        }

        if (this.pathMode) {
          this.handlePathSelection(node.id);
          return;
        }

        this.renderer.setHighlightedNodeIds([node.id]);
        if (!node.id.startsWith("tag:")) {
          void this.app.workspace.openLinkText(node.id, "", true);
        }
      });

    this.searchInputEl.onkeydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") {
        return;
      }

      const query = this.searchInputEl?.value.trim().toLowerCase() ?? "";
      if (!query) {
        return;
      }

      const match = Array.from(this.nodeIndex.values()).find(
        (node) => node.label.toLowerCase().includes(query) || node.id.toLowerCase().includes(query),
      );

      if (match) {
        const renderedNode = this.renderer.getRenderedNode(match.id) ?? match;
        this.renderer.setHighlightedNodeIds([match.id]);
        this.renderer.focusNode(renderedNode);
      }
    };

    this.groupSelect.onChange = () => this.applyFilters();
    this.tagSelect.onChange = () => this.applyFilters();
    this.degreeInputEl.oninput = () => this.applyFilters();
    const layout = this.layoutSelect;
    layout.onChange = () => this.renderer.setLayout(layout.value as LayoutMode);
    this.pathButtonEl.onclick = () => this.togglePathMode();
    this.clearButtonEl.onclick = () => this.resetControls();
    this.particleButtonEl.onclick = () => {
      const enabled = !this.renderer.getParticleFlow();
      this.renderer.setParticleFlow(enabled);
      this.particleButtonEl?.toggleClass("is-active", enabled);
      this.particleButtonEl?.setText(enabled ? "Flow: ON" : "Flow");
    };
  }

  private ensureUi(): void {
    if (!this.toolbarEl) {
      this.toolbarEl = this.container.createDiv({ cls: "graph-3d-toolbar" });
    }

    if (!this.searchInputEl) {
      const searchWrapper = this.toolbarEl.createDiv({ cls: "graph-3d-search" });
      this.searchInputEl = searchWrapper.createEl("input", {
        attr: { type: "search", placeholder: "Search nodes and press Enter..." },
      });
    }

    if (!this.groupSelect) {
      this.groupSelect = new CustomSelect(this.toolbarEl, "All groups");
    }

    if (!this.tagSelect) {
      this.tagSelect = new CustomSelect(this.toolbarEl, "All tags");
    }

    if (!this.degreeInputEl) {
      this.degreeInputEl = this.toolbarEl.createEl("input", {
        cls: "graph-3d-degree",
        attr: { type: "number", min: "0", step: "1", placeholder: "Min degree" },
      });
      this.degreeInputEl.value = String(this.renderer.getFilterState().minDegree);
    }

    if (!this.layoutSelect) {
      this.layoutSelect = new CustomSelect(this.toolbarEl);
      this.layoutSelect.add({ label: "Force", value: "force" });
      this.layoutSelect.add({ label: "Hierarchical", value: "hierarchical" });
      this.layoutSelect.add({ label: "Radial", value: "radial" });
      this.layoutSelect.add({ label: "Cluster", value: "cluster" });
      this.layoutSelect.value = this.renderer.getLayoutMode();
    }

    if (!this.pathButtonEl) {
      this.pathButtonEl = this.toolbarEl.createEl("button", { text: "Path mode" });
    }

    if (!this.clearButtonEl) {
      this.clearButtonEl = this.toolbarEl.createEl("button", { text: "Reset" });
    }

    if (!this.particleButtonEl) {
      this.particleButtonEl = this.toolbarEl.createEl("button", { text: "Flow" });
      if (this.renderer.getParticleFlow()) {
        this.particleButtonEl.addClass("is-active");
        this.particleButtonEl.setText("Flow: ON");
      }
    }

    if (!this.tooltipEl) {
      this.tooltipEl = this.container.createDiv({ cls: "graph-3d-tooltip" });
      this.tooltipEl.hide();
    }
  }

  private updateTooltip(node: SearchableNode | null): void {
    if (!this.tooltipEl) {
      return;
    }

    if (!node) {
      this.tooltipEl.hide();
      return;
    }

    const tags = node.tags.length > 0 ? `<div>Tags: ${node.tags.join(", ")}</div>` : "";
    this.tooltipEl.innerHTML = `<strong>${node.label}</strong><div>Degree: ${node.degree}</div><div>Group: ${node.group || "root"}</div>${tags}`;
    this.tooltipEl.show();
  }

  private populateFilterOptions(graphData: GraphData): void {
    if (!this.groupSelect || !this.tagSelect) {
      return;
    }

    const selectedGroup = this.groupSelect.value || "all";
    const selectedTag = this.tagSelect.value || "all";

    this.groupSelect.empty();
    this.groupSelect.add({ label: "All groups", value: "all" });
    const groups = Array.from(new Set(Array.from(graphData.nodes.values()).map((node) => node.group).filter(Boolean))).sort();
    for (const group of groups) {
      this.groupSelect.add({ label: group, value: group });
    }
    this.groupSelect.value = groups.includes(selectedGroup) ? selectedGroup : "all";

    this.tagSelect.empty();
    this.tagSelect.add({ label: "All tags", value: "all" });
    const tags = Array.from(new Set(Array.from(graphData.nodes.values()).flatMap((node) => node.tags))).sort();
    for (const tag of tags) {
      this.tagSelect.add({ label: tag, value: tag });
    }
    this.tagSelect.value = tags.includes(selectedTag) ? selectedTag : "all";
  }

  private applyFilters(): void {
    this.renderer.clearHighlights();
    this.pathSelection = [];
    this.hiddenNodeRefCounts.clear();
    this.collapsedRoots.clear();
    this.renderer.setFilters({
      group: this.groupSelect?.value ?? "all",
      tag: this.tagSelect?.value ?? "all",
      minDegree: Number(this.degreeInputEl?.value ?? 0) || 0,
    });
  }

  private togglePathMode(): void {
    this.pathMode = !this.pathMode;
    this.pathSelection = [];
    this.renderer.clearHighlights();
    if (this.pathButtonEl) {
      this.pathButtonEl.toggleClass("is-active", this.pathMode);
      this.pathButtonEl.setText(this.pathMode ? "Path mode: ON" : "Path mode");
    }
  }

  private resetControls(): void {
    if (this.groupSelect) this.groupSelect.value = "all";
    if (this.tagSelect) this.tagSelect.value = "all";
    if (this.degreeInputEl) this.degreeInputEl.value = "0";
    if (this.layoutSelect) this.layoutSelect.value = "force";
    this.pathMode = false;
    this.pathSelection = [];
    this.hiddenNodeRefCounts.clear();
    this.collapsedRoots.clear();
    if (this.pathButtonEl) {
      this.pathButtonEl.removeClass("is-active");
      this.pathButtonEl.setText("Path mode");
    }
    this.renderer.clearHighlights();
    this.renderer.setHiddenNodeIds([]);
    this.renderer.setFilters({ group: "all", tag: "all", minDegree: 0 });
    this.renderer.setLayout("force");
    this.renderer.setParticleFlow(false);
    if (this.particleButtonEl) {
      this.particleButtonEl.removeClass("is-active");
      this.particleButtonEl.setText("Flow");
    }
  }

  private handlePathSelection(nodeId: string): void {
    if (this.pathSelection.length === 0) {
      this.pathSelection = [nodeId];
      this.renderer.setHighlightedNodeIds([nodeId]);
      return;
    }

    const start = this.pathSelection[0];
    const end = nodeId;
    const result = this.findShortestPath(start, end, this.renderer.getVisibleGraphData());
    if (!result) {
      this.pathSelection = [end];
      this.renderer.setHighlightedNodeIds([end]);
      return;
    }

    const edgeKeys = result.path.slice(1).map((current, index) => this.edgeKey(result.path[index], current));
    this.renderer.setHighlightedPath(result.path, edgeKeys);
    const endNode = this.renderer.getRenderedNode(end);
    if (endNode) {
      this.renderer.focusNode(endNode);
    }
    this.pathSelection = [];
  }

  private findShortestPath(start: string, end: string, graphData: GraphData): { path: string[] } | null {
    if (start === end) {
      return { path: [start] };
    }

    const adjacency = new Map<string, string[]>();
    for (const node of graphData.nodes.values()) {
      adjacency.set(node.id, []);
    }
    for (const edge of graphData.edges) {
      adjacency.get(edge.source)?.push(edge.target);
      adjacency.get(edge.target)?.push(edge.source);
    }

    const queue: string[] = [start];
    const visited = new Set<string>([start]);
    const previous = new Map<string, string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);
        previous.set(neighbor, current);
        if (neighbor === end) {
          const path = [end];
          let cursor = end;
          while (previous.has(cursor)) {
            cursor = previous.get(cursor)!;
            path.unshift(cursor);
          }
          return { path };
        }
        queue.push(neighbor);
      }
    }

    return null;
  }

  private edgeKey(a: string, b: string): string {
    return [a, b].sort((left, right) => left.localeCompare(right)).join("::");
  }

  private toggleNeighborCollapse(nodeId: string): void {
    const neighbors = this.currentGraphData.nodes.get(nodeId)?.neighbors.filter((neighborId) => neighborId !== nodeId) ?? [];
    if (neighbors.length === 0) {
      this.renderer.setHighlightedNodeIds([nodeId]);
      window.setTimeout(() => this.renderer.clearHighlights(), 1200);
      return;
    }

    if (this.collapsedRoots.has(nodeId)) {
      for (const neighborId of this.collapsedRoots.get(nodeId) ?? []) {
        const nextCount = (this.hiddenNodeRefCounts.get(neighborId) ?? 1) - 1;
        if (nextCount <= 0) {
          this.hiddenNodeRefCounts.delete(neighborId);
        } else {
          this.hiddenNodeRefCounts.set(neighborId, nextCount);
        }
      }
      this.collapsedRoots.delete(nodeId);
    } else {
      this.collapsedRoots.set(nodeId, neighbors);
      for (const neighborId of neighbors) {
        this.hiddenNodeRefCounts.set(neighborId, (this.hiddenNodeRefCounts.get(neighborId) ?? 0) + 1);
      }
    }

    this.renderer.setHiddenNodeIds(Array.from(this.hiddenNodeRefCounts.keys()));
    this.renderer.setHighlightedNodeIds([nodeId]);
    window.setTimeout(() => this.renderer.clearHighlights(), 1200);
  }

  dispose(): void {
    document.body.style.cursor = "default";
    this.toolbarEl?.remove();
    this.searchInputEl?.remove();
    this.tooltipEl?.remove();
    this.groupSelect?.remove();
    this.tagSelect?.remove();
    this.degreeInputEl?.remove();
    this.layoutSelect?.remove();
    this.pathButtonEl?.remove();
    this.clearButtonEl?.remove();
    this.particleButtonEl?.remove();
    this.toolbarEl = null;
    this.searchInputEl = null;
    this.tooltipEl = null;
    this.groupSelect = null;
    this.tagSelect = null;
    this.degreeInputEl = null;
    this.layoutSelect = null;
    this.pathButtonEl = null;
    this.clearButtonEl = null;
    this.particleButtonEl = null;
  }
}
