import { ItemView, WorkspaceLeaf } from "obsidian";

import { GraphDataExtractor } from "./data/GraphDataExtractor";
import { GraphMetrics } from "./data/GraphMetrics";
import { InteractionManager } from "./interaction/InteractionManager";
import type Graph3DPlugin from "./main";
import { Renderer3D } from "./renderer/Renderer3D";

export const VIEW_TYPE_GRAPH_3D = "graph-3d-view";

export class Graph3DView extends ItemView {
  private renderer: Renderer3D | null = null;
  private interactionManager: InteractionManager | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: Graph3DPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GRAPH_3D;
  }

  getDisplayText(): string {
    return "Graph 3D";
  }

  getIcon(): string {
    return "box";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("graph-3d-view");
    this.contentEl.style.height = "100%";
    this.contentEl.style.minHeight = "600px";
    this.renderer = new Renderer3D(this.contentEl);
    this.interactionManager = new InteractionManager(this.app, this.contentEl, this.renderer);
    await this.refresh();
    this.registerDomEvent(window, "resize", () => this.renderer?.resize());
  }

  async refresh(): Promise<void> {
    if (!this.renderer) {
      return;
    }

    const graphData = GraphDataExtractor.extract(this.app);
    GraphMetrics.compute(graphData);
    this.renderer.render(graphData, this.plugin.settings);
    this.interactionManager?.bind(graphData);
  }

  async onClose(): Promise<void> {
    this.interactionManager?.dispose();
    this.interactionManager = null;
    this.renderer?.dispose();
    this.renderer = null;
  }
}
