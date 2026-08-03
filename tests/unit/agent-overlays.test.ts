import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyOverlayManifest,
  loadOverlays,
  mergeOverlay,
  overlayArtifacts,
  safeOverlayOutputPath,
} from "../../src/agent/overlays.js";
import { loadBundle } from "../../src/agent/parser.js";
import { renderBundle } from "../../src/agent/render.js";
import type { AgentDiagnostic, Artifact, NativeOverlay } from "../../src/agent/types.js";
import { TARGETS } from "../../src/agent/types.js";

const temporary: string[] = [];

function bundle(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-overlay-"));
  temporary.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const MANIFEST = [
  "schemaVersion: '2'",
  "name: demo",
  "version: 1.0.0",
  "description: A demo",
  "",
].join("\n");

const SKILL = "---\nname: hello\ndescription: Say hello\n---\n\nSay hello.\n";

function artifact(filePath: string, content = "x"): Artifact {
  return { path: filePath, content: Buffer.from(content), mode: 0o644 };
}

function overlay(filePath: string, content = "native"): Artifact {
  return { ...artifact(filePath, content), origin: "native" };
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("safeOverlayOutputPath", () => {
  it("accepts an ordinary relative path", () => {
    expect(safeOverlayOutputPath("extras/note.md")).toBe("extras/note.md");
  });

  it("refuses anything that could leave the target output root", () => {
    for (const candidate of [
      "",
      "/etc/passwd",
      "../escape.md",
      "a/../../escape.md",
      "./relative.md",
      "C:/windows",
      "a\\b.md",
    ])
      expect(safeOverlayOutputPath(candidate)).toBeNull();
  });
});

describe("loadOverlays", () => {
  function load(files: Record<string, string>) {
    const root = bundle(files);
    const diagnostics: AgentDiagnostic[] = [];
    const overlays = loadOverlays(
      root,
      TARGETS.map((target) => ({ target, root: `native/${target}` })),
      path.join(root, "agent-bundle.yaml"),
      diagnostics,
    );
    return { overlays, diagnostics, codes: diagnostics.map((item) => item.code).sort() };
  }

  it("returns nothing when no overlay directory exists", () => {
    const { overlays, codes } = load({ "agent-bundle.yaml": MANIFEST });
    expect(overlays).toEqual([]);
    expect(codes).toEqual([]);
  });

  it("loads files under each output profile and preserves modes", () => {
    const root = bundle({
      "agent-bundle.yaml": MANIFEST,
      "native/codex/plugin/extras/note.md": "note",
      "native/codex/project/.codex/thing.toml": "x = 1",
      "native/codex/plugin/hooks/run.sh": "#!/bin/sh\n",
    });
    fs.chmodSync(path.join(root, "native/codex/plugin/hooks/run.sh"), 0o755);
    const diagnostics: AgentDiagnostic[] = [];
    const overlays = loadOverlays(
      root,
      [{ target: "codex", root: "native/codex" }],
      path.join(root, "agent-bundle.yaml"),
      diagnostics,
    );
    expect(diagnostics).toEqual([]);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].files.plugin.map((file) => file.path).sort()).toEqual([
      "extras/note.md",
      "hooks/run.sh",
    ]);
    expect(overlays[0].files.project.map((file) => file.path)).toEqual([".codex/thing.toml"]);
    expect(overlays[0].files.plugin.find((f) => f.path === "hooks/run.sh")?.mode).toBe(0o755);
  });

  it("reads a manifest fragment", () => {
    const { overlays, codes } = load({
      "agent-bundle.yaml": MANIFEST,
      "native/codex/manifest.json": '{"keywords":["x"]}',
    });
    expect(codes).toEqual([]);
    expect(overlays[0].manifest).toEqual({ keywords: ["x"] });
  });

  it("reports an invalid manifest fragment with AB182", () => {
    expect(
      load({ "agent-bundle.yaml": MANIFEST, "native/codex/manifest.json": "[1,2]" }).codes,
    ).toEqual(["AB182"]);
    expect(
      load({ "agent-bundle.yaml": MANIFEST, "native/codex/manifest.json": "{oops" }).codes,
    ).toEqual(["AB182"]);
  });

  it("refuses an entry that is not an output profile with AB186", () => {
    expect(
      load({ "agent-bundle.yaml": MANIFEST, "native/codex/somewhere/x.md": "x" }).codes,
    ).toEqual(["AB186"]);
    expect(load({ "agent-bundle.yaml": MANIFEST, "native/codex/stray.md": "x" }).codes).toEqual([
      "AB186",
    ]);
  });

  it("refuses an overlay root outside the bundle with AB183", () => {
    const root = bundle({ "agent-bundle.yaml": MANIFEST });
    const diagnostics: AgentDiagnostic[] = [];
    loadOverlays(
      root,
      [{ target: "codex", root: "../elsewhere" }],
      path.join(root, "agent-bundle.yaml"),
      diagnostics,
    );
    expect(diagnostics.map((item) => item.code)).toEqual(["AB183"]);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("refuses a symlink that leaves the overlay root", () => {
    const root = bundle({ "agent-bundle.yaml": MANIFEST, secret: "classified" });
    fs.mkdirSync(path.join(root, "native/codex/plugin"), { recursive: true });
    fs.symlinkSync(path.join(root, "secret"), path.join(root, "native/codex/plugin/leak"));
    expect(() =>
      loadOverlays(
        root,
        [{ target: "codex", root: "native/codex" }],
        path.join(root, "agent-bundle.yaml"),
        [],
      ),
    ).toThrow(/escapes its root/);
  });
});

describe("mergeOverlay", () => {
  it("returns the portable set untouched when there is no overlay", () => {
    const portable = [artifact("a.md")];
    expect(mergeOverlay(portable, [], "overlay-wins", "codex", "plugin", [])).toBe(portable);
  });

  it("adds non-colliding overlay artifacts with native origin and no diagnostic", () => {
    const diagnostics: AgentDiagnostic[] = [];
    const merged = mergeOverlay(
      [artifact("a.md")],
      [overlay("b.md")],
      "overlay-wins",
      "codex",
      "plugin",
      diagnostics,
    );
    expect(diagnostics).toEqual([]);
    expect(merged.map((item) => [item.path, item.origin])).toEqual([
      ["a.md", undefined],
      ["b.md", "native"],
    ]);
  });

  it("lets the overlay win a collision and reports AB181", () => {
    const diagnostics: AgentDiagnostic[] = [];
    const merged = mergeOverlay(
      [artifact("a.md", "portable")],
      [overlay("a.md", "native")],
      "overlay-wins",
      "codex",
      "plugin",
      diagnostics,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].content.toString()).toBe("native");
    expect(diagnostics.map((item) => [item.code, item.severity, item.quality])).toEqual([
      ["AB181", "warning", "approximate"],
    ]);
  });

  it("keeps the portable artifact and errors under onCollision: error", () => {
    const diagnostics: AgentDiagnostic[] = [];
    const merged = mergeOverlay(
      [artifact("a.md", "portable")],
      [overlay("a.md", "native")],
      "error",
      "codex",
      "plugin",
      diagnostics,
    );
    expect(merged[0].content.toString()).toBe("portable");
    expect(diagnostics.map((item) => [item.code, item.severity])).toEqual([["AB181", "error"]]);
  });

  it("does not depend on the order artifacts arrive in", () => {
    const run = (portable: Artifact[]) =>
      mergeOverlay(portable, [overlay("b.md")], "overlay-wins", "codex", "plugin", [])
        .map((item) => item.path)
        .sort();
    expect(run([artifact("a.md"), artifact("c.md")])).toEqual(
      run([artifact("c.md"), artifact("a.md")]),
    );
  });
});

describe("applyOverlayManifest", () => {
  it("returns the generated manifest untouched without a fragment", () => {
    const generated = { name: "x" };
    expect(applyOverlayManifest(generated, undefined, "codex", [])).toBe(generated);
  });

  it("adds new keys silently and reports overrides with AB182", () => {
    const diagnostics: AgentDiagnostic[] = [];
    const merged = applyOverlayManifest(
      { name: "x", description: "generated" },
      { keywords: ["a"], description: "overridden" },
      "codex",
      diagnostics,
    );
    expect(merged).toEqual({ name: "x", description: "overridden", keywords: ["a"] });
    expect(diagnostics.map((item) => item.code)).toEqual(["AB182"]);
    expect(diagnostics[0].message).toContain("description");
  });
});

describe("overlayArtifacts", () => {
  it("sorts by byte order, not locale order", () => {
    const overlayValue: NativeOverlay = {
      target: "codex",
      root: "/x",
      files: {
        plugin: [
          { path: "aB.md", content: Buffer.from("1"), mode: 0o644 },
          { path: "a-b.md", content: Buffer.from("2"), mode: 0o644 },
        ],
        project: [],
      },
      onCollision: "overlay-wins",
    };
    // "a-b.md" < "aB.md" by byte value; localeCompare disagrees.
    expect(overlayArtifacts(overlayValue, "plugin").map((item) => item.path)).toEqual([
      "a-b.md",
      "aB.md",
    ]);
  });
});

describe("end to end through renderBundle", () => {
  it("emits overlay files verbatim without placeholder rewriting", () => {
    // A portable component would have ${BUNDLE_ROOT} rewritten. An overlay is
    // already native, so rewriting it would corrupt deliberate native content.
    const root = bundle({
      "agent-bundle.yaml": MANIFEST,
      "skills/hello/SKILL.md": SKILL,
      "native/claude-code/plugin/extras/note.md": "Path: ${BUNDLE_ROOT}/x\n",
    });
    const { artifacts } = renderBundle(loadBundle(root), ["claude-code"], ["plugin"]);
    const note = artifacts.find((item) => item.path.endsWith("extras/note.md"));
    expect(note?.content.toString()).toBe("Path: ${BUNDLE_ROOT}/x\n");
    expect(note?.origin).toBe("native");
  });

  it("renders identically twice", () => {
    const root = bundle({
      "agent-bundle.yaml": MANIFEST,
      "skills/hello/SKILL.md": SKILL,
      "native/codex/plugin/extras/note.md": "note\n",
    });
    const render = () =>
      renderBundle(loadBundle(root), [...TARGETS], ["plugin", "project"]).artifacts.map((item) => [
        item.path,
        item.content.toString(),
        item.mode,
        item.origin,
      ]);
    expect(render()).toEqual(render());
  });

  it("leaves a v1 bundle with a native directory completely untouched", () => {
    // The native block is v2-only, so a v1 bundle that happens to contain a
    // native/ directory must not pick it up.
    const v1 = MANIFEST.replace("'2'", "'1'");
    const withOverlay = bundle({
      "agent-bundle.yaml": v1,
      "skills/hello/SKILL.md": SKILL,
      "native/codex/plugin/extras/note.md": "note\n",
    });
    const without = bundle({ "agent-bundle.yaml": v1, "skills/hello/SKILL.md": SKILL });
    const render = (root: string) =>
      renderBundle(loadBundle(root), [...TARGETS], ["plugin", "project"]).artifacts.map((item) => [
        item.path,
        item.content.toString(),
      ]);
    expect(render(withOverlay)).toEqual(render(without));
  });
});
