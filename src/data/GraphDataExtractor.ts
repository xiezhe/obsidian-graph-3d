import { App, CachedMetadata, TFile } from "obsidian";

import type { GraphData, GraphEdge, GraphNode, GraphEdgeType } from "./types";

export class GraphDataExtractor {
  static extract(app: App): GraphData {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const edgeKeys = new Set<string>();
    const incomingCounts = new Map<string, number>();
    const files = app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = app.metadataCache.getFileCache(file);
      const node = this.buildFileNode(file, cache);
      nodes.set(node.id, node);
    }

    for (const file of files) {
      const cache = app.metadataCache.getFileCache(file);
      if (!cache) {
        continue;
      }

      this.addReferenceEdges(app, file, cache, cache.links, "link", nodes, edges, edgeKeys, incomingCounts);
      this.addReferenceEdges(app, file, cache, cache.embeds, "embed", nodes, edges, edgeKeys, incomingCounts);
      this.addTagEdges(file, cache, nodes, edges, edgeKeys, incomingCounts);
    }

    for (const node of nodes.values()) {
      node.neighbors = Array.from(new Set(node.neighbors)).sort();
      const hasOutgoing = node.neighbors.length > 0;
      const hasIncoming = (incomingCounts.get(node.id) ?? 0) > 0;
      node.isOrphan = !hasOutgoing && !hasIncoming;
    }

    return { nodes, edges };
  }

  private static buildFileNode(file: TFile, cache: CachedMetadata | null): GraphNode {
    const label = this.getNodeLabel(file, cache);
    const tags = this.getNodeTags(cache);
    const group = file.parent?.path ?? "";

    return {
      id: file.path,
      label,
      group,
      path: group,
      degree: 0,
      betweenness: 0,
      community: -1,
      tags,
      weight: 1,
      neighbors: [],
      isOrphan: true,
    };
  }

  private static getNodeLabel(file: TFile, cache: CachedMetadata | null): string {
    const title = cache?.frontmatter?.title;
    return typeof title === "string" && title.trim().length > 0 ? title.trim() : file.basename;
  }

  private static getNodeTags(cache: CachedMetadata | null): string[] {
    const tags = new Set<string>();

    for (const tag of cache?.tags ?? []) {
      if (tag.tag) {
        tags.add(tag.tag);
      }
    }

    const frontmatterTags = cache?.frontmatter?.tags;
    if (Array.isArray(frontmatterTags)) {
      for (const tag of frontmatterTags) {
        if (typeof tag === "string" && tag.trim().length > 0) {
          tags.add(tag.startsWith("#") ? tag : `#${tag}`);
        }
      }
    } else if (typeof frontmatterTags === "string" && frontmatterTags.trim().length > 0) {
      tags.add(frontmatterTags.startsWith("#") ? frontmatterTags : `#${frontmatterTags}`);
    }

    return Array.from(tags).sort();
  }

  private static addReferenceEdges(
    app: App,
    file: TFile,
    _cache: CachedMetadata,
    references: Array<{ link: string }> | undefined,
    type: Extract<GraphEdgeType, "link" | "embed">,
    nodes: Map<string, GraphNode>,
    edges: GraphEdge[],
    edgeKeys: Set<string>,
    incomingCounts: Map<string, number>,
  ): void {
    for (const reference of references ?? []) {
      const targetFile = app.metadataCache.getFirstLinkpathDest(reference.link, file.path);
      if (!targetFile || targetFile.extension !== "md") {
        continue;
      }

      if (!nodes.has(targetFile.path)) {
        nodes.set(targetFile.path, this.buildFileNode(targetFile, app.metadataCache.getFileCache(targetFile)));
      }

      this.addEdge(file.path, targetFile.path, type, nodes, edges, edgeKeys, incomingCounts);
    }
  }

  private static addTagEdges(
    file: TFile,
    cache: CachedMetadata,
    nodes: Map<string, GraphNode>,
    edges: GraphEdge[],
    edgeKeys: Set<string>,
    incomingCounts: Map<string, number>,
  ): void {
    for (const tag of this.getNodeTags(cache)) {
      const tagId = `tag:${tag}`;
      if (!nodes.has(tagId)) {
        nodes.set(tagId, {
          id: tagId,
          label: tag,
          group: "tags",
          path: "tags",
          degree: 0,
          betweenness: 0,
          community: -1,
          tags: [],
          weight: 1,
          neighbors: [],
          isOrphan: true,
        });
      }

      this.addEdge(file.path, tagId, "tag", nodes, edges, edgeKeys, incomingCounts);
    }
  }

  private static addEdge(
    source: string,
    target: string,
    type: GraphEdgeType,
    nodes: Map<string, GraphNode>,
    edges: GraphEdge[],
    edgeKeys: Set<string>,
    incomingCounts: Map<string, number>,
  ): void {
    const key = `${source}::${target}::${type}`;
    if (edgeKeys.has(key)) {
      return;
    }

    edgeKeys.add(key);
    edges.push({ source, target, weight: 1, type });

    const sourceNode = nodes.get(source);
    const targetNode = nodes.get(target);
    if (sourceNode) {
      sourceNode.neighbors.push(target);
    }
    if (targetNode) {
      targetNode.neighbors.push(source);
    }

    incomingCounts.set(target, (incomingCounts.get(target) ?? 0) + 1);
  }
}
