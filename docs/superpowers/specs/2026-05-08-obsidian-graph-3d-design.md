# Obsidian Graph 3D - Design Spec

**Date**: 2026-05-08
**Status**: Draft
**Reference**: 知识图谱可视化技术在美团团的实践与探索 (Meituan uni-graph paper)

---

## 1. Overview

A Obsidian plugin that enhances the built-in 2D graph view with better visual styling and provides an optional 3D graph panel for immersive knowledge graph exploration.

### 1.1 Decisions Summary

| Decision | Choice |
|----------|--------|
| Product form | C — 2D enhancement + 3D switching |
| Tech stack | A — Three.js + 3d-force-graph |
| Color scheme | C — Adaptive coloring + importable presets |
| Interaction depth | C — Deep analysis (path highlight, expand/collapse, cluster, multi-layout) |
| Architecture | A — Monolithic dual-mode with shared data layer |

---

## 2. Architecture

```
obsidian-graph-3d/
├── src/
│   ├── main.ts                    # Plugin entry, register View + SettingTab
│   ├── Graph3DView.ts             # ItemView: canvas container, mode switching
│   ├── data/
│   │   ├── GraphDataExtractor.ts  # Extract nodes/edges from app.metadataCache
│   │   ├── GraphMetrics.ts        # Degree, betweenness, community detection
│   │   └── types.ts               # GraphNode, GraphEdge, GraphData
│   ├── renderer/
│   │   ├── Renderer2D.ts          # CSS injection + force param tuning
│   │   └── Renderer3D.ts          # Three.js + 3d-force-graph core
│   ├── interaction/
│   │   ├── InteractionManager.ts  # Unified interaction: hover/click/select/search
│   │   ├── FilterEngine.ts        # Filter by path/tag/degree/group
│   │   └── LayoutEngine.ts        # Force / Hierarchical / Radial / Cluster
│   ├── theme/
│   │   ├── ColorScheme.ts         # Adaptive (degree/betweenness/community)
│   │   ├── PresetManager.ts       # Preset import/export/management
│   │   └── presets/
│   │       └── llm-wiki.json      # 10-group color preset for LLM Wiki vault
│   └── settings/
│       ├── SettingsTab.ts         # Obsidian settings panel UI
│       └── defaultSettings.ts     # Default configuration
├── styles.css
├── manifest.json
└── package.json
```

**Data flow**: `GraphDataExtractor` → `GraphMetrics` (compute metrics) → `Renderer2D/3D` (consume) → `InteractionManager` (handle input) → `FilterEngine` / `LayoutEngine` (respond) → re-render.

---

## 3. Data Model

### 3.1 Core Types

```typescript
interface GraphNode {
  id: string;              // File path, e.g. "wiki/concepts/Attention.md"
  label: string;           // Display name (frontmatter title or filename)
  group: string;           // Group name, e.g. "concept" / "entity" / "topic"
  path: string;            // Directory path, e.g. "wiki/concepts"

  // Computed by GraphMetrics
  degree: number;          // Connection count
  betweenness: number;     // Betweenness centrality (bridge nodes)
  community: number;       // Community detection result (community ID)

  // Extracted from Obsidian metadata
  tags: string[];
  weight: number;          // Node size weight
  neighbors: string[];     // Adjacent node ID list
  isOrphan: boolean;
}

interface GraphEdge {
  source: string;          // Source node ID
  target: string;          // Target node ID
  weight: number;          // Edge thickness (reference count)
  type: 'link' | 'tag' | 'embed';
}

interface GraphData {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}
```

### 3.2 Data Extraction

- Source: `app.metadataCache` — all markdown file link relationships
- Group assignment: read frontmatter `tags`, `fields`, directory path
- `GraphMetrics` computes degree and betweenness asynchronously (approximate algorithm when > 500 nodes)
- Community detection: Louvain algorithm (downgrade to Label Propagation when > 1000 nodes)

### 3.3 Group Mapping

- **Default mode**: Auto-color by `community` detection result, no preset dependency
- **Preset mode**: Load `llm-wiki.json`, match by `path:` prefix (e.g. `path:wiki/concepts` → cyan)

---

## 4. Renderer Design

### 4.1 Renderer2D (Non-invasive enhancement)

- **CSS injection**: Register CSS snippets via Obsidian's `customCss` / style element injection onto `.graph-view`, overriding colors, opacity, and node sizes using the same CSS variable targets as built-in graph themes
- **Parameter tuning**: Read graph.json force parameters via `app.workspace`; expose adjustable sliders in settings panel; apply changes by updating the workspace leaf's view state
- **Does NOT replace**: Built-in graph rendering engine (2D is not the main focus)

### 4.2 Renderer3D (Three.js + 3d-force-graph)

```
Renderer3D responsibilities:
├── Initialize Three.js scene (camera, lighting, background)
├── Convert GraphData to 3d-force-graph graphData format
├── Force simulation (d3-force-3d)
├── Node rendering: sphere + label Sprite, size scaled by degree
├── Edge rendering: semi-transparent lines, thickness by edge.weight
├── Post-processing: optional Bloom (glow) effect
└── Teardown: dispose all Three.js resources, prevent memory leaks
```

### 4.3 Mode Switching

`Graph3DView` holds two DOM containers:
- **2D mode**: `.graph-2d-container` — Obsidian native graph view
- **3D mode**: `.graph-3d-container` — Three.js canvas
- Switch: `display: none/block` toggle, pause/resume 3D animation loop

---

## 5. Interaction System

| Interaction | Implementation |
|-------------|---------------|
| Rotate/zoom/pan | 3d-force-graph built-in OrbitControls |
| Hover node | Highlight node + adjacent edges + tooltip (label, degree, tags) |
| Click node | Select state + open file in Obsidian |
| Search & locate | Input box → fuzzy match label → camera fly to target |
| Path highlight | Select two nodes → Dijkstra shortest path → highlight path nodes/edges |
| Expand/collapse | Right-click → "Expand neighbors" (2-hop) / "Collapse" (hide subgraph) |
| Filter | FilterBar: filter by group, tag, degree range |
| Layout switch | Dropdown menu to switch layout algorithm |

---

## 6. Layout Engine

| Layout | Use case | Implementation |
|--------|----------|---------------|
| Force-directed (default) | General relationship exploration | d3-force-3d |
| Hierarchical | Parent-child / level relationships | Layer by depth along Y-axis + force on XZ plane |
| Radial | Center node + neighbor ring | Center node at origin, neighbors evenly distributed on sphere |
| Cluster | Community detection visualization | Louvain groups → each group gathered in distinct spatial region |

---

## 7. Theme & Settings

### 7.1 Color Scheme (dual mode)

**Mode 1: Adaptive coloring** (default, zero config)

| Dimension | Algorithm | Effect |
|-----------|-----------|--------|
| Degree | Linear map degree → HSL hue | More connections = "warmer" |
| Community | Louvain → one hue per group | Same community same color, visual clustering |
| Centrality | Betweenness → node size + glow intensity | Bridge nodes are "brighter" |

**Mode 2: Preset coloring** (import llm-wiki.json)

```json
{
  "name": "LLM Wiki",
  "groups": [
    { "name": "概念",   "pattern": "path:wiki/concepts/",    "color": "#02c5f0" },
    { "name": "实体",   "pattern": "path:wiki/entities/",    "color": "#ff0000" },
    { "name": "主题",   "pattern": "path:wiki/topics/",      "color": "#ff8c00" },
    { "name": "工具",   "pattern": "path:wiki/tools/",       "color": "#081b70" },
    { "name": "摘要",   "pattern": "path:wiki/summaries/",   "color": "#800080" },
    { "name": "对比",   "pattern": "path:wiki/comparisons/", "color": "#00ced1" },
    { "name": "综合",   "pattern": "path:wiki/synthesis/",   "color": "#ed64a1" },
    { "name": "工作流", "pattern": "path:wiki/workflows/",   "color": "#0f6b08" },
    { "name": "素材",   "pattern": "path:raw/",              "color": "#808080" },
    { "name": "剪藏",   "pattern": "path:Clippings/",        "color": "#c0c0ff" }
  ]
}
```

- Unmatched nodes fall back to gray `#888888`
- Presets stored via Obsidian's `Plugin.loadData()` / `Plugin.saveData()` API (serialized in `data.json`), plus option to export standalone `.json` files

### 7.2 Settings Panel Layout

```
Graph 3D Settings
├── Rendering
│   ├── Default view: [2D / 3D]
│   ├── Node size multiplier: 1.0 —— 3.0
│   ├── Edge opacity: 0.2 —— 1.0
│   └── Show labels: [Always / On hover / Never]
│
├── Force Parameters
│   ├── Center strength: 0.1 —— 1.0
│   ├── Repel strength: 1 —— 50
│   ├── Link distance: 50 —— 500
│   └── Link strength: 0.1 —— 2.0
│
├── Coloring Mode
│   ├── [Adaptive] / [Import preset...]
│   └── Adaptive dimension: [Degree / Community / Centrality]
│
├── Post-processing
│   ├── [ ] Bloom effect
│   ├── [ ] Particle background
│   └── Background color: [#1a1a2e]
│
└── Preset Management
    ├── [Import preset JSON] [Export current preset]
    └── Installed presets list
```

### 7.3 Preset Import/Export

- **Import**: User selects `.json` file → plugin validates format → writes to `presets/`
- **Export**: Serialize active preset to JSON → save to user-specified location
- **Management**: List imported presets, support activate/delete

---

## 8. Dependencies

| Package | Purpose | Size (est.) |
|---------|---------|-------------|
| `three` | 3D rendering engine | ~600KB |
| `3d-force-graph` | Force-directed 3D graph wrapper | ~100KB |
| `d3-force-3d` | 3D force simulation (included in 3d-force-graph) | ~30KB |
| `obsidian` | Obsidian API types (devDependency) | — |

Total bundle: ~750KB (acceptable for a desktop plugin)

---

## 9. Implementation Phasing

To keep scope manageable, implementation is split into two phases:

**Phase 1 (v1.0)** — Core 3D viewer
- GraphDataExtractor + GraphMetrics
- Renderer3D with force-directed layout (default)
- Basic interaction: orbit, hover tooltip, click-to-open, search & locate
- Adaptive coloring (degree + community)
- Settings panel (rendering + force params + coloring)
- llm-wiki.json preset bundled

**Phase 2 (v1.1+)** — Advanced features
- Renderer2D CSS enhancement
- Advanced interaction: path highlight, expand/collapse, filter bar
- Additional layouts: hierarchical, radial, cluster
- Post-processing: bloom, particle background
- Preset import/export UI
- Preset coloring mode with pattern matching

---

## 10. Non-functional Requirements

- **Performance**: Smooth 60fps at up to 2000 nodes, 30fps at 5000+ nodes
- **Memory**: Full Three.js teardown on view close (no leaks)
- **Compatibility**: Obsidian >= 1.5.0, both light and dark themes
- **A11y**: Keyboard shortcuts for all major interactions (search, layout switch, reset view)
