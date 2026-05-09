import { Plugin, WorkspaceLeaf } from "obsidian";

import { Graph3DView, VIEW_TYPE_GRAPH_3D } from "./Graph3DView";
import { DEFAULT_SETTINGS, type Graph3DSettings } from "./settings/defaultSettings";
import { SettingsTab } from "./settings/SettingsTab";

export default class Graph3DPlugin extends Plugin {
  settings: Graph3DSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_GRAPH_3D, (leaf) => new Graph3DView(leaf, this));

    this.addRibbonIcon("box", "Open Graph 3D", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-graph-3d",
      name: "Open Graph 3D",
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new SettingsTab(this.app, this));
  }

  async onunload(): Promise<void> {
    await this.app.workspace.detachLeavesOfType(VIEW_TYPE_GRAPH_3D);
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRAPH_3D)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_GRAPH_3D, active: true });
    }

    this.app.workspace.revealLeaf(leaf);
  }

  async refreshOpenViews(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRAPH_3D);
    await Promise.all(
      leaves.map(async (leaf) => {
        const view = leaf.view;
        if (view instanceof Graph3DView) {
          await view.refresh();
        }
      }),
    );
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
