import fs from "node:fs";
import path from "node:path";
import { splitLocalTarget, resolveLocalPath } from "./link-target.js";
import type { Workspace } from "./workspace.js";

export interface GraphEdge {
  source: string;
  target: string;
  lines: number[];
  occurrences: number;
}
export interface BrokenGraphEdge {
  source: string;
  target: string;
  resolved: string;
  line: number;
}
export interface GraphNode {
  file: string;
  inbound: number;
  outbound: number;
  deadEnd: boolean;
  reachable?: boolean;
}
export interface WorkspaceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  broken: BrokenGraphEdge[];
  components: string[][];
  cycles: string[][];
  entries: string[];
  reachabilityEvaluated: boolean;
  unreachable: string[];
}

function documentTarget(target: string): boolean {
  const extension = path.extname(target).toLowerCase();
  return extension === ".md" || extension === ".markdown";
}

function components(files: string[], edges: GraphEdge[]): string[][] {
  const adjacent = new Map(files.map((file) => [file, new Set<string>()]));
  for (const edge of edges) {
    adjacent.get(edge.source)?.add(edge.target);
    adjacent.get(edge.target)?.add(edge.source);
  }
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const file of files) {
    if (seen.has(file)) continue;
    const group: string[] = [];
    const pending = [file];
    seen.add(file);
    while (pending.length) {
      const current = pending.pop()!;
      group.push(current);
      for (const next of adjacent.get(current) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          pending.push(next);
        }
    }
    result.push(group.sort());
  }
  return result;
}

function stronglyConnected(files: string[], edges: GraphEdge[]): string[][] {
  const adjacent = new Map(files.map((file) => [file, [] as string[]]));
  for (const edge of edges) adjacent.get(edge.source)?.push(edge.target);
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  const visit = (file: string): void => {
    indices.set(file, index);
    low.set(file, index++);
    stack.push(file);
    onStack.add(file);
    for (const target of adjacent.get(file) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(file, Math.min(low.get(file)!, low.get(target)!));
      } else if (onStack.has(target)) low.set(file, Math.min(low.get(file)!, indices.get(target)!));
    }
    if (low.get(file) === indices.get(file)) {
      const group: string[] = [];
      let current: string;
      do {
        current = stack.pop()!;
        onStack.delete(current);
        group.push(current);
      } while (current !== file);
      const self = group.length === 1 && (adjacent.get(file) ?? []).includes(file);
      if (group.length > 1 || self) result.push(group.sort());
    }
  };
  for (const file of files) if (!indices.has(file)) visit(file);
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Narrows a built graph to the documents within `depth` undirected hops of any
 * focus file.
 *
 * Undirected on purpose: "what touches this document" is the question a
 * neighborhood report answers, and a directed walk would hide every backlink.
 *
 * This projects an already-built graph rather than narrowing the file list
 * first. Building from a narrowed list would turn every link to an
 * in-workspace but out-of-radius document into a fabricated `broken` target,
 * and would recompute `components` and `cycles` over a truncated graph —
 * reporting a document as cycle-free when it is not.
 *
 * `inbound`, `outbound`, and `deadEnd` therefore keep their full-graph values:
 * they describe the document, not the picture it is being drawn into. A
 * component or cycle is kept **whole** when any member is in focus, because a
 * truncated cycle group would read as a self-link that does not exist.
 */
export function focusGraph(graph: WorkspaceGraph, focus: string[], depth: number): WorkspaceGraph {
  const adjacent = new Map(graph.nodes.map((node) => [node.file, new Set<string>()]));
  for (const edge of graph.edges) {
    adjacent.get(edge.source)?.add(edge.target);
    adjacent.get(edge.target)?.add(edge.source);
  }
  const kept = new Set<string>();
  let frontier: string[] = [];
  for (const file of focus)
    if (adjacent.has(file) && !kept.has(file)) {
      kept.add(file);
      frontier.push(file);
    }
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const file of frontier)
      for (const neighbour of adjacent.get(file) ?? [])
        if (!kept.has(neighbour)) {
          kept.add(neighbour);
          next.push(neighbour);
        }
    if (!next.length) break;
    frontier = next;
  }
  const inFocus = (file: string): boolean => kept.has(file);
  return {
    nodes: graph.nodes.filter((node) => inFocus(node.file)),
    edges: graph.edges.filter((edge) => inFocus(edge.source) && inFocus(edge.target)),
    broken: graph.broken.filter((edge) => inFocus(edge.source)),
    components: graph.components.filter((group) => group.some(inFocus)),
    cycles: graph.cycles.filter((group) => group.some(inFocus)),
    entries: graph.entries.filter(inFocus),
    reachabilityEvaluated: graph.reachabilityEvaluated,
    unreachable: graph.unreachable.filter(inFocus),
  };
}

export function buildWorkspaceGraph(
  workspace: Workspace,
  files: string[],
  entries: string[] = [],
): WorkspaceGraph {
  const sorted = [...new Set(files.map((file) => path.resolve(file)))].sort();
  const selected = new Set(sorted);
  const edgeMap = new Map<string, GraphEdge>();
  const broken: BrokenGraphEdge[] = [];
  for (const source of sorted) {
    for (const ref of workspace.document(source).references) {
      if (ref.isExternal || ref.isAnchorOnly || ref.isImage) continue;
      const targetPath = splitLocalTarget(ref.target).path;
      if (!targetPath || !documentTarget(targetPath)) continue;
      const target = resolveLocalPath(source, targetPath, workspace.root);
      if (selected.has(target)) {
        const key = `${source}\0${target}`;
        const edge = edgeMap.get(key);
        if (edge) {
          edge.lines.push(ref.line);
          edge.occurrences++;
        } else edgeMap.set(key, { source, target, lines: [ref.line], occurrences: 1 });
      } else if (!fs.existsSync(target)) {
        broken.push({ source, target: targetPath, resolved: target, line: ref.line });
      }
    }
  }
  const edges = [...edgeMap.values()].sort(
    (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );
  const applicableEntries = [
    ...new Set(entries.map((entry) => path.resolve(entry)).filter((entry) => selected.has(entry))),
  ].sort();
  const reachable = new Set<string>();
  if (applicableEntries.length) {
    const adjacent = new Map(sorted.map((file) => [file, [] as string[]]));
    for (const edge of edges) adjacent.get(edge.source)?.push(edge.target);
    const pending = [...applicableEntries];
    for (const entry of pending) reachable.add(entry);
    while (pending.length)
      for (const target of adjacent.get(pending.shift()!) ?? [])
        if (!reachable.has(target)) {
          reachable.add(target);
          pending.push(target);
        }
  }
  const nodes = sorted.map((file) => ({
    file,
    inbound: edges
      .filter((edge) => edge.target === file)
      .reduce((sum, edge) => sum + edge.occurrences, 0),
    outbound: edges
      .filter((edge) => edge.source === file)
      .reduce((sum, edge) => sum + edge.occurrences, 0),
    deadEnd: !edges.some((edge) => edge.source === file),
    ...(applicableEntries.length ? { reachable: reachable.has(file) } : {}),
  }));
  return {
    nodes,
    edges,
    broken: broken.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line),
    components: components(sorted, edges),
    cycles: stronglyConnected(sorted, edges),
    entries: applicableEntries,
    reachabilityEvaluated: applicableEntries.length > 0,
    unreachable: applicableEntries.length ? sorted.filter((file) => !reachable.has(file)) : [],
  };
}
