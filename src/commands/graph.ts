import fs from "node:fs";
import path from "node:path";
import { buildWorkspaceGraph, type WorkspaceGraph } from "../graph.js";
import { outputPath, runtime } from "../runtime.js";
import { requireDirectory } from "../input.js";
import { terminate } from "../command-result.js";

interface GraphOptions {
  format: string;
  output: "report" | "mermaid" | "dot";
  entry: string[];
  include: string[];
  exclude: string[];
}

function displayed(graph: WorkspaceGraph, opts: GraphOptions): object {
  const show = (file: string) => outputPath(file, opts);
  return {
    files: graph.nodes.length,
    nodes: graph.nodes.map((node) => ({ ...node, file: show(node.file) })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      source: show(edge.source),
      target: show(edge.target),
    })),
    broken: graph.broken.map((edge) => ({
      ...edge,
      source: show(edge.source),
      resolved: show(edge.resolved),
    })),
    entries: graph.entries.map(show),
    reachabilityEvaluated: graph.reachabilityEvaluated,
    unreachable: graph.unreachable.map(show),
    deadEnds: graph.nodes.filter((node) => node.deadEnd).map((node) => show(node.file)),
    components: graph.components.map((group) => group.map(show)),
    cycles: graph.cycles.map((group) => group.map(show)),
  };
}

function rawGraph(graph: WorkspaceGraph, opts: GraphOptions): string {
  const ids = new Map(graph.nodes.map((node, index) => [node.file, `n${index}`]));
  const label = (file: string) =>
    outputPath(file, opts).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (opts.output === "mermaid") {
    return [
      "flowchart LR",
      ...graph.nodes.map((node) => `  ${ids.get(node.file)}["${label(node.file)}"]`),
      ...graph.edges.map((edge) => `  ${ids.get(edge.source)} --> ${ids.get(edge.target)}`),
    ].join("\n");
  }
  return [
    "digraph markdown {",
    ...graph.nodes.map((node) => `  ${ids.get(node.file)} [label="${label(node.file)}"];`),
    ...graph.edges.map((edge) => `  ${ids.get(edge.source)} -> ${ids.get(edge.target)};`),
    "}",
  ].join("\n");
}

export async function graphAction(directory: string, opts: GraphOptions): Promise<void> {
  if (!["report", "mermaid", "dot"].includes(opts.output)) {
    throw new Error("--output must be report, mermaid, or dot");
  }
  const dir = requireDirectory(directory, opts);
  const files = runtime().workspace.markdownFiles(dir, {
    include: opts.include,
    exclude: opts.exclude,
  });
  const entries = opts.entry.map((entry) => path.resolve(entry));
  for (const entry of entries)
    if (!fs.existsSync(entry) || !fs.statSync(entry).isFile())
      throw new Error(`Entry point not found: ${entry}`);
  const graph = buildWorkspaceGraph(runtime().workspace, files, entries);
  const actionable = graph.broken.length + graph.unreachable.length;
  if (opts.output !== "report") {
    process.stdout.write(rawGraph(graph, opts) + "\n");
    if (actionable) terminate(2);
    return;
  }
  const report = displayed(graph, opts);
  if (opts.format === "json") {
    (actionable ? process.stderr : process.stdout).write(JSON.stringify(report, null, 2) + "\n");
  } else {
    const value = report as {
      files: number;
      broken: unknown[];
      unreachable: string[];
      deadEnds: string[];
      components: unknown[];
      cycles: unknown[];
      reachabilityEvaluated: boolean;
    };
    const lines = [
      `Graph: ${value.files} document(s), ${graph.edges.length} edge(s)`,
      `Broken targets: ${value.broken.length}`,
      `Reachability: ${value.reachabilityEvaluated ? `${value.unreachable.length} unreachable` : "not evaluated (no entry points)"}`,
      `Dead ends: ${value.deadEnds.length}`,
      `Weak components: ${value.components.length}`,
      `Cycles: ${value.cycles.length}`,
    ];
    for (const edge of graph.broken)
      lines.push(`  ${outputPath(edge.source, opts)}:${edge.line} [graph/broken] ${edge.target}`);
    for (const file of graph.unreachable)
      lines.push(`  ${outputPath(file, opts)} [graph/unreachable]`);
    (actionable ? process.stderr : process.stdout).write(lines.join("\n") + "\n");
  }
  if (actionable) terminate(2);
}
