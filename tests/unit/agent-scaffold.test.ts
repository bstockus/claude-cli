import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMPONENT_KINDS,
  applyManifestEdits,
  scaffoldBundle,
  scaffoldComponent,
  sortArtifacts,
} from "../../src/agent/scaffold.js";
import type { ComponentKind } from "../../src/agent/scaffold.js";
import { loadBundle } from "../../src/agent/parser.js";
import { renderBundle } from "../../src/agent/render.js";
import { PORTABLE_HOOK_EVENTS } from "../../src/agent/targets/schema.js";
import { TARGETS } from "../../src/agent/types.js";
import type { AgentProfile, Artifact } from "../../src/agent/types.js";

const temporary: string[] = [];
const PROFILES: AgentProfile[] = ["plugin", "project"];

function materialize(artifacts: Artifact[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-scaffold-"));
  temporary.push(root);
  for (const artifact of artifacts) {
    const full = path.join(root, artifact.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, artifact.content, { mode: artifact.mode });
  }
  return root;
}

function bundleSpec(components: ComponentKind[], overlays = false) {
  return {
    name: "demo",
    version: "0.1.0",
    description: "A demo bundle",
    license: "MIT",
    components,
    targets: [...TARGETS],
    overlays,
  };
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("scaffoldBundle", () => {
  it("scaffolds only the manifest and a skill by default", () => {
    const { artifacts } = scaffoldBundle(bundleSpec(["skill"]));
    expect(artifacts.map((item) => item.path)).toEqual([
      "agent-bundle.yaml",
      "skills/demo/SKILL.md",
    ]);
  });

  it("produces a bundle that parses with no diagnostics at all", () => {
    // The scaffold is the one input fully under our control. If it cannot
    // validate cleanly, `agent init` has emitted something a user must fix.
    const root = materialize(scaffoldBundle(bundleSpec(["skill"])).artifacts);
    const bundle = loadBundle(root);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.schemaVersion).toBe("2");
  });

  it("renders with no error-severity diagnostic for every component kind", () => {
    const kinds = COMPONENT_KINDS.filter((kind) => kind !== "overlay");
    const root = materialize(scaffoldBundle(bundleSpec([...kinds])).artifacts);
    const { diagnostics } = renderBundle(loadBundle(root), [...TARGETS], PROFILES);
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("names a scaffolded hook after a portable event, not the bundle", () => {
    // A hook named after the bundle maps to no target and emits AB320.
    const { artifacts } = scaffoldBundle(bundleSpec(["hook"]));
    const hooks = artifacts.find((item) => item.path === "hooks/hooks.yaml");
    expect(hooks?.content.toString()).toContain(`  ${PORTABLE_HOOK_EVENTS[0]}:`);
    expect(artifacts.map((item) => item.path)).toContain(`hooks/${PORTABLE_HOOK_EVENTS[0]}.sh`);
  });

  it("marks the scaffolded hook script executable", () => {
    const { artifacts } = scaffoldBundle(bundleSpec(["hook"]));
    const script = artifacts.find((item) => item.path.endsWith(".sh"));
    expect(script?.mode).toBe(0o755);
  });

  it("writes an overlay README that the overlay loader tolerates", () => {
    const root = materialize(scaffoldBundle(bundleSpec(["skill"], true)).artifacts);
    expect(fs.existsSync(path.join(root, "native/codex/README.md"))).toBe(true);
    expect(loadBundle(root).diagnostics).toEqual([]);
  });

  it("scaffolds nothing but the manifest for --component none", () => {
    const { artifacts } = scaffoldBundle(bundleSpec([]));
    expect(artifacts.map((item) => item.path)).toEqual(["agent-bundle.yaml"]);
    expect(loadBundle(materialize(artifacts)).diagnostics).toEqual([]);
  });

  it("accepts an empty publisher name, deferring completeness to agent package", () => {
    const { artifacts } = scaffoldBundle(bundleSpec(["skill"]));
    const manifest = artifacts[0].content.toString();
    expect(manifest).toContain('name: ""');
    expect(loadBundle(materialize(artifacts)).diagnostics).toEqual([]);
  });
});

describe("scaffoldComponent", () => {
  const base = { name: "thing", description: "A thing", activation: "always", globs: [] };

  it("emits no manifest edit when the component root is the default", () => {
    for (const kind of COMPONENT_KINDS) {
      if (kind === "overlay") continue;
      expect(scaffoldComponent({ ...base, kind }).edits).toEqual([]);
    }
  });

  it("records a non-default root in the manifest", () => {
    const { edits } = scaffoldComponent({ ...base, kind: "skill", root: "lib/skills" });
    expect(edits).toEqual([
      { path: ["components", "skills"], value: "lib/skills", onlyIfAbsent: false },
    ]);
  });

  it("produces a policy with matching examples so it parses cleanly", () => {
    // Without positive/negative examples the parser reports AB141, and an
    // example that does not match the prefix reports AB142/AB143.
    const { artifacts } = scaffoldComponent({ ...base, kind: "policy", command: "git" });
    const root = materialize([
      ...scaffoldBundle(bundleSpec([])).artifacts,
      ...artifacts.map((item) => ({ ...item, path: item.path })),
    ]);
    expect(loadBundle(root).diagnostics).toEqual([]);
  });

  it("places a rule's globs only when it has them", () => {
    const without = scaffoldComponent({ ...base, kind: "rule" }).artifacts[0].content.toString();
    const with_ = scaffoldComponent({
      ...base,
      kind: "rule",
      activation: "files",
      globs: ["src/**"],
    }).artifacts[0].content.toString();
    expect(without).not.toContain("globs:");
    expect(with_).toContain('globs: ["src/**"]');
    expect(with_).toContain("activation: files");
  });
});

describe("sortArtifacts", () => {
  it("sorts by byte order, not locale order", () => {
    // "a-b" < "aB" by byte value; localeCompare disagrees, and an ICU
    // difference between machines would otherwise reorder generated output.
    const sorted = sortArtifacts([
      { path: "aB.md", content: Buffer.alloc(0), mode: 0o644 },
      { path: "a-b.md", content: Buffer.alloc(0), mode: 0o644 },
    ]);
    expect(sorted.map((item) => item.path)).toEqual(["a-b.md", "aB.md"]);
  });
});

describe("applyManifestEdits", () => {
  const source = [
    "# lead comment",
    "schemaVersion: '2'",
    "name: demo # trailing",
    "components:",
    "  skills: skills",
    "",
  ].join("\n");

  it("returns the source bytes untouched when nothing changes", () => {
    const result = applyManifestEdits(source, []);
    expect(result.changed).toBe(false);
    expect(result.content.toString()).toBe(source);
  });

  it("treats an edit that matches the current value as no change", () => {
    const result = applyManifestEdits(source, [
      { path: ["components", "skills"], value: "skills", onlyIfAbsent: false },
    ]);
    expect(result.changed).toBe(false);
    expect(result.content.toString()).toBe(source);
  });

  it("preserves comments and key order when it does edit", () => {
    const result = applyManifestEdits(source, [
      { path: ["components", "agents"], value: "agents", onlyIfAbsent: false },
    ]);
    expect(result.changed).toBe(true);
    const output = result.content.toString();
    expect(output).toContain("# lead comment");
    expect(output).toContain("# trailing");
    expect(output).toContain("  agents: agents");
    expect(output.indexOf("schemaVersion")).toBeLessThan(output.indexOf("components"));
  });

  it("respects onlyIfAbsent", () => {
    const result = applyManifestEdits(source, [
      { path: ["components", "skills"], value: "other", onlyIfAbsent: true },
    ]);
    expect(result.changed).toBe(false);
  });

  it("reports reformatting when re-serializing would normalize whitespace", () => {
    // parseDocument keeps comments but collapses the double space before `#`.
    const messy = "name: demo  # two spaces\ncomponents:\n  skills: skills\n";
    const result = applyManifestEdits(messy, [
      { path: ["components", "agents"], value: "agents", onlyIfAbsent: false },
    ]);
    expect(result.changed).toBe(true);
    expect(result.reformatted).toBe(true);
  });

  it("does not claim reformatting when no edit applies", () => {
    const messy = "name: demo  # two spaces\n";
    expect(applyManifestEdits(messy, []).reformatted).toBe(false);
  });
});
