import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { buildWorkspaceGraph } from "../../src/graph.js";
import { Workspace } from "../../src/workspace.js";

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cli-graph-"));
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});
const write = (name: string, content: string) => {
  const file = path.join(directory, name);
  fs.writeFileSync(file, content);
  return file;
};

describe("workspace graph", () => {
  it("aggregates references and reports broken targets, cycles, components, and reachability", () => {
    const a = write("a.md", "[B](b.md) [again](b.md) [self](a.md)\n");
    const b = write("b.md", "[A](a.md) [missing](missing.md)\n");
    const c = write("c.md", "# C\n");
    const workspace = new Workspace(loadConfig({ disabled: true }, directory));
    const graph = buildWorkspaceGraph(workspace, [a, b, c], [a]);
    expect(graph.edges.find((edge) => edge.source === a && edge.target === b)?.occurrences).toBe(2);
    expect(graph.broken).toHaveLength(1);
    expect(graph.cycles).toEqual([[a, b]]);
    expect(graph.components).toHaveLength(2);
    expect(graph.unreachable).toEqual([c]);
    expect(graph.nodes.find((node) => node.file === c)?.deadEnd).toBe(true);
  });

  it("leaves reachability unevaluated without applicable entries and ignores assets", () => {
    const a = write("a.md", "![image](missing.png) [web](https://example.com)\n");
    const workspace = new Workspace(loadConfig({ disabled: true }, directory));
    const graph = buildWorkspaceGraph(workspace, [a], []);
    expect(graph.reachabilityEvaluated).toBe(false);
    expect(graph.unreachable).toEqual([]);
    expect(graph.broken).toEqual([]);
  });
});
