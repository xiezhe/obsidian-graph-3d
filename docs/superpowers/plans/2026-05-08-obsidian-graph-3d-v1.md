# Obsidian Graph 3D v1.0 - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Obsidian plugin that renders a 3D force-directed graph view of vault links, with adaptive coloring, basic interaction, and editable settings.

**Spec:** `docs/superpowers/specs/2026-05-08-obsidian-graph-3d-design.md`
**Scope:** Phase 1 only — core 3D viewer, no 2D enhancement, no advanced interaction (path highlight, expand/collapse, filter, multi-layout)

---

## File Structure (files to create)

```
obsidian-graph-3d/
├── manifest.json               # Obsidian plugin manifest
├── package.json                # npm deps: three, 3d-force-graph, obsidian types
├── tsconfig.json               # TypeScript config targeting ES2020
├── esbuild.config.mjs          # Build script (esbuild, standard Obsidian plugin pattern)
├── styles.css                  # Empty (reserved for Phase 2)
├── src/
│   ├── main.ts                 # Plugin class: onload, register View + SettingTab
│   ├── Graph3DView.ts          # ItemView: owns canvas container, lifecycle
│   ├── data/
│   │   ├── types.ts            # GraphNode, GraphEdge, GraphData interfaces
│   │   ├── GraphDataExtractor.ts  # Extract nodes/edges from app.metadataCache
│   │   └── GraphMetrics.ts     # Compute degree, community (Louvain)
│   ├── renderer/
│   │   └── Renderer3D.ts       # Three.js + 3d-force-graph scene setup and rendering
│   ├── interaction/
│   │   └── InteractionManager.ts  # OrbitControls, hover tooltip, click, search
│   ├── theme/
│   │   ├── ColorScheme.ts      # Adaptive coloring (degree + community)
│   │   └── presets/
│   │       └── llm-wiki.json   # 10-group color preset
│   └── settings/
│       ├── SettingsTab.ts       # Obsidian SettingsTab UI
│       └── defaultSettings.ts   # Default config values
```

---

## Tasks

### Phase 1: Project Scaffolding

- [ ] **T1: Create manifest.json**
  - Fields: `id: "obsidian-graph-3d"`, `name: "Graph 3D"`, `minAppVersion: "1.5.0"`, `isDesktopOnly: true` (Three.js requires WebGL)
  - Author, description, version "1.0.0"

- [ ] **T2: Create package.json**
  - `devDependencies`: `obsidian` (latest), `typescript`, `esbuild`, `@types/node`
  - `dependencies`: `three`, `3d-force-graph`
  - Scripts: `dev` (esbuild --watch), `build` (esbuild production)
  - Set `"type": "module"` (Obsidian plugins use ESM)

- [ ] **T3: Create tsconfig.json**
  - Target: `ES2020`, module: `ESNext`, moduleResolution: `bundler`
  - `experimentalDecorators: true`, `useDefineForClassFields: true`
  - Include: `src/**/*.ts`, exclude: `node_modules`

- [ ] **T4: Create esbuild.config.mjs**
  - Entry: `src/main.ts`, bundle: true, external: `["obsidian", "electron"]`
  - Format: `cjs` (Obsidian convention), platform: `browser`
  - Output: `main.js` in root

- [ ] **T5: Install dependencies and verify build**
  - Run `npm install`
  - Run `npm run build`
  - Verify `main.js` is produced without errors

---

### Phase 2: Data Layer

- [ ] **T6: Create src/data/types.ts**
  - Define `GraphNode` interface: id, label, group, path, degree, betweenness, community, tags, weight, neighbors, isOrphan
  - Define `GraphEdge` interface: source, target, weight, type
  - Define `GraphData` class: nodes (Map<string, GraphNode>), edges (GraphEdge[])
  - Export all types

- [ ] **T7: Create src/data/GraphDataExtractor.ts**
  - Class `GraphDataExtractor` with method `extract(app: App): GraphData`
  - Iterate `app.metadataCache.getFileCache()` for all `.md` files
  - For each file: extract `links` (→ GraphEdge type 'link'), `tags` (→ GraphEdge type 'tag'), `embeds` (→ GraphEdge type 'embed')
  - Set `node.label` from frontmatter `title` → fallback to filename (without extension)
  - Set `node.group` from directory path (e.g. `wiki/concepts/foo.md` → group `"wiki/concepts"`)
  - Set `node.path` as the directory portion of the file path
  - Set `node.tags` from frontmatter tags
  - Build `neighbors` arrays by collecting all source/target references
  - Mark `isOrphan` if node has no edges and no incoming edges
  - Test: verify extractor produces correct structure on a small test vault

- [ ] **T8: Create src/data/GraphMetrics.ts**
  - Class `GraphMetrics` with static method `compute(graphData: GraphData): void`
  - **Degree**: count edges per node, set `node.degree`
  - **Community detection**: implement Louvain algorithm
    - Initialize each node as its own community
    - First pass: for each node, try moving to neighbor's community, keep move if modularity gain > 0
    - Second pass: aggregate communities into super-nodes, repeat
    - Cap iterations at 20 for performance
    - Set `node.community` to final community ID
  - Run synchronously for < 1000 nodes; for larger graphs, return Promise with `requestAnimationFrame` chunking
  - Test: verify degree and community fields are populated after compute()

---

### Phase 3: Plugin Entry & View

- [ ] **T9: Create src/settings/defaultSettings.ts**
  - Define `Graph3DSettings` interface matching spec:
    ```typescript
    interface Graph3DSettings {
      defaultView: '2d' | '3d';
      nodeSizeMultiplier: number;    // default 1.5
      edgeOpacity: number;           // default 0.4
      showLabels: 'always' | 'hover' | 'never';  // default 'hover'
      centerStrength: number;        // default 0.5
      repelStrength: number;         // default 15
      linkDistance: number;          // default 150
      linkStrength: number;          // default 0.3
      colorMode: 'degree' | 'community';  // default 'community'
      bloomEnabled: boolean;         // default false
      particleBg: boolean;           // default false
      backgroundColor: string;       // default '#1a1a2e'
    }
    ```
  - Export `DEFAULT_SETTINGS` constant with defaults
  - Export `Graph3DSettings` type

- [ ] **T10: Create src/settings/SettingsTab.ts**
  - Class `SettingsTab` extends `PluginSettingTab`
  - Constructor takes `plugin: Graph3DPlugin` (to access `plugin.settings`)
  - `display()` method creates settings UI using `new Setting(containerEl)`:
    - **Rendering section**: Heading + sliders for nodeSizeMultiplier (1-3), edgeOpacity (0.2-1.0), dropdown for showLabels
    - **Force section**: Heading + sliders for centerStrength (0.1-1.0), repelStrength (1-50), linkDistance (50-500), linkStrength (0.1-2.0)
    - **Coloring section**: Heading + dropdown for colorMode (degree/community)
    - **Visual section**: Heading + toggles for bloom, particleBg, color picker for backgroundColor
  - Each setting change calls `await plugin.saveSettings()` and triggers `plugin.refreshView()` (to be defined in main.ts)

- [ ] **T11: Create src/main.ts**
  - Class `Graph3DPlugin` extends `Plugin`
  - `settings: Graph3DSettings`
  - `async onload()`:
    - `await this.loadSettings()`
    - Register view: `this.registerView('graph-3d-view', (leaf) => new Graph3DView(leaf, this))`
    - Add ribbon icon: `this.addRibbonIcon('box', 'Open Graph 3D', () => this.activateView())`
    - Add command: `this.addCommand({ id: 'open-graph-3d', name: 'Open Graph 3D', callback: () => this.activateView() })`
    - Add settings tab: `this.addSettingTab(new SettingsTab(this.app, this))`
  - `async activateView()`: initialize or reveal the view leaf in the right sidebar
  - `refreshView()`: if view is open, tell it to reload data and re-render
  - `async loadSettings()` / `async saveSettings()`: use `this.loadData()` / `this.saveData(this.settings)` with defaults

- [ ] **T12: Create src/Graph3DView.ts**
  - Class `Graph3DView` extends `ItemView`
  - `getViewType(): 'graph-3d-view'`, `getDisplayText(): 'Graph 3D'`, `getIcon(): 'box'`
  - Constructor: store plugin reference, create container div (id `graph-3d-container`)
  - `async onOpen()`:
    - Create container DOM element, append to `contentEl`
    - Initialize `GraphDataExtractor` and `Renderer3D`
    - Call `this.loadGraph()`
  - `async loadGraph()`:
    - Extract data: `const graphData = GraphDataExtractor.extract(this.app)`
    - Compute metrics: `GraphMetrics.compute(graphData)`
    - Render: `this.renderer.render(graphData, this.plugin.settings)`
  - `async onClose()`: call `this.renderer.dispose()` to clean up Three.js resources
  - `refresh()`: re-extract data and re-render (called when settings change)

---

### Phase 4: 3D Renderer

- [ ] **T13: Create src/theme/ColorScheme.ts**
  - Function `getNodeColor(node: GraphNode, mode: 'degree' | 'community'): string`
  - **Degree mode**: Map `node.degree` linearly to HSL hue (0 = blue 240°, max_degree = red 0°), use `hsl(${hue}, 70%, 60%)`
  - **Community mode**: Hash `node.community` to a stable HSL hue, use `hsl(${hue}, 70%, 60%)`
  - **Fallback**: if degree/community is 0 or undefined, return `'#888888'`
  - Function `getNodeSize(node: GraphNode, baseMultiplier: number): number`
    - Base size 3 + `Math.log2(node.degree + 1) * 2`, clamped to [3, 20]
    - Multiply by `baseMultiplier` from settings

- [ ] **T14: Create src/theme/presets/llm-wiki.json**
  - Copy the 10-group color preset JSON as defined in the spec
  - This file is bundled with the plugin (not user-editable; Phase 2 will add editable preset management)

- [ ] **T15: Create src/renderer/Renderer3D.ts**
  - Class `Renderer3D`
  - `private scene: THREE.Scene`, `private graph: any` (3d-force-graph instance), `private container: HTMLElement`
  - `constructor(container: HTMLElement)`:
    - Create canvas element, append to container
    - Initialize `ForceGraph3D()(canvasElement)`
    - Configure default camera position: `graph.cameraPosition({ x: 200, y: 200, z: 200 })`
    - Enable orbit controls: `graph.enableNodeDrag(false)`, `graph.enableNavigationControls(true)`
    - Set background color from site theme (dark = `#1a1a2e`, light = `#f0f0f0`) — read from `document.body.classList.contains('theme-dark')`

  - `render(graphData: GraphData, settings: Graph3DSettings): void`:
    - Convert GraphData to 3d-force-graph format: `{ nodes: [...], links: [...] }`
      - Node format: `{ id, name: label, val: size, color, group }`
      - Link format: `{ source: sourceId, target: targetId, value: weight }`
    - Set `graph.graphData(data)`
    - Configure force parameters from settings:
      - `graph.d3Force('center').strength(settings.centerStrength)`
      - `graph.d3Force('charge').strength(-settings.repelStrength)`
      - `graph.d3Force('link').distance(settings.linkDistance).strength(settings.linkStrength)`
    - Configure visual:
      - `graph.nodeColor(d => getNodeColor(d, settings.colorMode))`
      - `graph.nodeVal(d => getNodeSize(d, settings.nodeSizeMultiplier))`
      - `graph.linkOpacity(settings.edgeOpacity)`
      - `graph.linkWidth(d => Math.max(0.5, d.value * 0.5))`
      - Labels: add THREE.Sprite labels when `showLabels === 'always'`, or on hover if `'hover'`
    - Restart simulation with 300 warmup ticks → `graph.warmupTicks(300)`, `graph.numDimensions(3)`
    - On simulation end, adjust camera to frame graph: `graph.zoomToFit(400, 50)`

  - `dispose(): void`:
    - Remove canvas from container
    - Call `graph._destructor()` or manually dispose all Three.js objects
    - Null out scene and graph references

---

### Phase 5: Interaction

- [ ] **T16: Create src/interaction/InteractionManager.ts**
  - Class `InteractionManager`, takes `renderer3D: Renderer3D` and `app: App`
  - `setupInteractions(graphData: GraphData): void`:

  - **Hover tooltip**:
    - `graph.onNodeHover(node => { ... })` — show/hide a floating div with:
      - Node label, degree, tags, group
    - Position tooltip near mouse using CSS `position: fixed`

  - **Click to open**:
    - `graph.onNodeClick(node => { ... })` — open file in Obsidian:
      - `this.app.workspace.openLinkText(node.id, '', true)`

  - **Search & locate**:
    - Add an `<input>` above the canvas container
    - On input: fuzzy filter `graphData.nodes` by label
    - Show dropdown of matches (max 10)
    - On select: `graph.cameraPosition()` animate to node position, temporarily highlight node
    - Node highlight: change color to white/pulse, reset after 2s

  - **Keyboard shortcuts** (mounted on container via `tabIndex`):
    - `R`: reset camera to default position
    - `F`: focus search input
    - `0`: zoom to fit

---

### Phase 6: Integration & Polish

- [ ] **T17: Wire everything together**
  - In `Graph3DView.onOpen()`:
    1. Initialize `InteractionManager`
    2. Call `this.loadGraph()`
    3. After render, call `interactionManager.setupInteractions(graphData)`
  - Verify the full pipeline: open view → data extracted → metrics computed → rendered → interactions work

- [ ] **T18: Create styles.css**
  - Basic styling for the plugin UI:
    ```css
    .graph-3d-container {
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
    }
    .graph-3d-container canvas {
      display: block;
    }
    .graph-3d-tooltip {
      position: fixed;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 12px;
      pointer-events: none;
      z-index: 1000;
      max-width: 250px;
    }
    .graph-3d-search {
      position: absolute;
      top: 12px;
      left: 12px;
      z-index: 10;
    }
    .graph-3d-search input {
      width: 200px;
      padding: 6px 10px;
      border-radius: 4px;
      border: 1px solid var(--background-modifier-border);
      background: var(--background-primary);
      color: var(--text-normal);
    }
    ```

- [ ] **T19: Build and test manually**
  - Copy plugin folder to a test vault's `.obsidian/plugins/obsidian-graph-3d/`
  - Open Obsidian, enable plugin
  - Verify: ribbon icon appears, clicking opens Graph 3D panel
  - Verify: nodes and edges render correctly in 3D space
  - Verify: orbit controls work (drag to rotate, scroll to zoom, right-drag to pan)
  - Verify: hover shows tooltip with node info
  - Verify: click opens file in Obsidian
  - Verify: search input finds and navigates to nodes
  - Verify: settings changes take effect on reload
  - Verify: no console errors, no memory leaks on view close/reopen

- [ ] **T20: Optimize and fix**
  - Check performance: profile with 500+ nodes, ensure >30fps
  - Fix any visual glitches (z-fighting, label overlapping, clipping)
  - Ensure dark/light theme compatibility
  - Add loading indicator while data is being extracted (if > 2000 nodes)

---

## Implementation Order

```
Phase 1 (Scaffold):  T1 → T2 → T3 → T4 → T5
Phase 2 (Data):      T6 → T7 → T8                    (parallel after scaffold)
Phase 3 (Plugin):    T9 → T10 → T11 → T12            (depends on data types T6)
Phase 4 (Renderer):  T13 → T14 → T15                 (depends on data types T6)
Phase 5 (Interact):  T16                             (depends on renderer T15)
Phase 6 (Integrate): T17 → T18 → T19 → T20           (depends on all above)

Independent work that can be parallelized:
  - T9+T10 (settings) can start after T6 (types)
  - T11+T12 (plugin entry + view) can start after T6 (types) — use stub renderers
  - T13+T14+T15 (renderer theme + engine) can start after T6 (types)
  - T16 (interaction) needs T15 (renderer)
```

---

## Testing Strategy

- **T7**: Create a small test vault with 5-10 markdown files, verify extractor output matches expectations
- **T8**: Unit test community detection with a known small graph (3 communities, 15 nodes), verify community assignments
- **T15**: Manual visual inspection: nodes should spread in 3D, not clump, layout should stabilize within 300 ticks
- **T19**: Full manual smoke test as described above
- No automated Jest/Vitest setup for v1 (Obsidian plugin testing requires complex DOM mocking; defer to v2)

---

## Commit Strategy

Commit after each task (or small group of related tasks):
1. `scaffold: add manifest, package.json, tsconfig, esbuild config`
2. `data: add GraphNode, GraphEdge, GraphData types`
3. `data: add GraphDataExtractor implementation`
4. `data: add GraphMetrics (degree + Louvain)`
5. `settings: add default settings and SettingsTab`
6. `plugin: add main.ts entry point`
7. `view: add Graph3DView with lifecycle`
8. `theme: add ColorScheme and llm-wiki preset`
9. `renderer: add Renderer3D with Three.js integration`
10. `interaction: add hover tooltip, click-to-open, search`
11. `integration: wire everything together, add styles`
12. `polish: fix bugs, optimize performance`
