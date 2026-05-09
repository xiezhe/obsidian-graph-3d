import { App, PluginSettingTab, Setting } from "obsidian";

import type Graph3DPlugin from "../main";

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: Graph3DPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Graph 3D Settings" });

    containerEl.createEl("h3", { text: "Rendering" });

    new Setting(containerEl)
      .setName("Default view")
      .setDesc("Which graph mode to open by default")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("2d", "2D")
          .addOption("3d", "3D")
          .setValue(this.plugin.settings.defaultView)
          .onChange(async (value: string) => {
            this.plugin.settings.defaultView = value as "2d" | "3d";
            await this.plugin.saveSettings();
          }),
      );

    this.addSliderSetting(containerEl, "Node size multiplier", "Scale node sizes", 1, 3, 0.1, "nodeSizeMultiplier");
    this.addSliderSetting(containerEl, "Edge opacity", "Line transparency", 0.2, 1, 0.05, "edgeOpacity");

    new Setting(containerEl)
      .setName("Show labels")
      .setDesc("When labels should be visible")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("always", "Always")
          .addOption("hover", "On hover")
          .addOption("never", "Never")
          .setValue(this.plugin.settings.showLabels)
          .onChange(async (value: string) => {
            this.plugin.settings.showLabels = value as "always" | "hover" | "never";
            await this.plugin.saveSettings();
            await this.plugin.refreshOpenViews();
          }),
      );

    containerEl.createEl("h3", { text: "Force Parameters" });
    this.addSliderSetting(containerEl, "Center strength", "Graph centering force", 0.1, 1, 0.05, "centerStrength");
    this.addSliderSetting(containerEl, "Repel strength", "Node repulsion", 1, 50, 1, "repelStrength");
    this.addSliderSetting(containerEl, "Link distance", "Preferred edge distance", 50, 500, 10, "linkDistance");
    this.addSliderSetting(containerEl, "Link strength", "Spring strength of links", 0.1, 2, 0.05, "linkStrength");

    containerEl.createEl("h3", { text: "Coloring" });
    new Setting(containerEl)
      .setName("Color mode")
      .setDesc("Choose the adaptive coloring dimension")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("degree", "Degree")
          .addOption("community", "Community")
          .setValue(this.plugin.settings.colorMode)
          .onChange(async (value: string) => {
            this.plugin.settings.colorMode = value as "degree" | "community";
            await this.plugin.saveSettings();
            await this.plugin.refreshOpenViews();
          }),
      );

    containerEl.createEl("h3", { text: "Visual" });
    new Setting(containerEl)
      .setName("Bloom effect")
      .setDesc("Reserved for a later post-processing pass")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.bloomEnabled).onChange(async (value) => {
          this.plugin.settings.bloomEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Particle background")
      .setDesc("Reserved for a later background effect")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.particleBg).onChange(async (value) => {
          this.plugin.settings.particleBg = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Background color")
      .setDesc("3D canvas background")
      .addColorPicker((picker) =>
        picker.setValue(this.plugin.settings.backgroundColor).onChange(async (value) => {
          this.plugin.settings.backgroundColor = value;
          await this.plugin.saveSettings();
          await this.plugin.refreshOpenViews();
        }),
      );
  }

  private addSliderSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    min: number,
    max: number,
    step: number,
    key:
      | "nodeSizeMultiplier"
      | "edgeOpacity"
      | "centerStrength"
      | "repelStrength"
      | "linkDistance"
      | "linkStrength",
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addSlider((slider) =>
        slider
          .setLimits(min, max, step)
          .setValue(this.plugin.settings[key])
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
            await this.plugin.refreshOpenViews();
          }),
      );
  }
}
