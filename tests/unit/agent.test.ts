import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBundle, splitFrontmatter } from "../../src/agent/parser.js";
import { processTargetBlocks, renderBundle } from "../../src/agent/render.js";

const temporary: string[] = [];

function bundleRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bundle-unit-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, "skills", "release"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "agent-bundle.yaml"),
    "schemaVersion: '1'\nname: sample\nversion: 1.0.0\ndescription: Sample bundle\n",
  );
  fs.writeFileSync(
    path.join(root, "skills", "release", "SKILL.md"),
    "---\nname: release\ndescription: Prepare a release\n---\nUse ${ARGUMENTS}.\n<!-- target:cursor -->Cursor only.\n<!-- /target:cursor -->\n",
  );
  fs.writeFileSync(path.join(root, "skills", "release", "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("agent bundles", () => {
  it("parses frontmatter and conventional components", () => {
    const bundle = loadBundle(bundleRoot());
    expect(bundle.name).toBe("sample");
    expect(bundle.skills.map((skill) => skill.name)).toEqual(["release"]);
    expect(bundle.diagnostics).toEqual([]);
  });

  it("rejects malformed frontmatter", () => {
    expect(() => splitFrontmatter("---\nname: [\n---\nbody", "bad.md")).toThrow(
      "invalid frontmatter",
    );
  });

  it("processes canonical and legacy target blocks", () => {
    const source =
      "A\n<!-- target:cursor -->C\n<!-- /target:cursor -->\n<!-- platform:codex -->X\n<!-- /platform:codex -->";
    expect(processTargetBlocks(source, "cursor")).toContain("C");
    expect(processTargetBlocks(source, "cursor")).not.toContain("X");
  });

  it("renders deterministic target layouts and preserves executable modes", () => {
    const rendered = renderBundle(
      loadBundle(bundleRoot()),
      ["claude-code", "cursor"],
      ["plugin", "project"],
    );
    const paths = rendered.artifacts.map((artifact) => artifact.path);
    expect(paths).toContain("claude-code/plugin/.claude-plugin/plugin.json");
    expect(paths).toContain("claude-code/project/.claude/skills/release/SKILL.md");
    expect(paths).toContain("cursor/plugin/skills/sample-release/SKILL.md");
    expect(paths).toContain("cursor/project/.cursor/skills/release/SKILL.md");
    expect(rendered.artifacts.find((artifact) => artifact.path.endsWith("run.sh"))?.mode).toBe(
      0o755,
    );
    const cursor = rendered.artifacts
      .find((artifact) => artifact.path === "cursor/plugin/skills/sample-release/SKILL.md")
      ?.content.toString();
    expect(cursor).toContain("Cursor only.");
    expect(cursor).toContain("literal `$ARGUMENTS`");
  });

  it("reports missing references and cycles", () => {
    const root = bundleRoot();
    fs.writeFileSync(
      path.join(root, "skills", "release", "SKILL.md"),
      "---\nname: release\ndescription: Release\nskills: [release, missing]\n---\nBody\n",
    );
    const codes = loadBundle(root).diagnostics.map((item) => item.code);
    expect(codes).toContain("AB150");
    expect(codes).toContain("AB160");
  });

  it("rejects component paths outside the bundle", () => {
    const root = bundleRoot();
    fs.writeFileSync(
      path.join(root, "agent-bundle.yaml"),
      "schemaVersion: '1'\nname: sample\nversion: 1.0.0\ndescription: Sample\nskills: ../skills\n",
    );
    expect(() => loadBundle(root)).toThrow("escapes the bundle root");
  });

  it("validates target blocks and target IDs", () => {
    const root = bundleRoot();
    fs.writeFileSync(
      path.join(root, "skills", "release", "SKILL.md"),
      "---\nname: release\ndescription: Release\ninclude: [future]\n---\n<!-- target:future -->bad\n",
    );
    const codes = loadBundle(root).diagnostics.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["AB106", "AB120", "AB121"]));
  });

  it("normalizes typed hooks and copies executable hook scripts", () => {
    const root = bundleRoot();
    fs.mkdirSync(path.join(root, "hooks"));
    fs.writeFileSync(
      path.join(root, "hooks", "hooks.yaml"),
      "hooks:\n  pre-tool-use:\n    - matcher: shell\n      command: ${BUNDLE_ROOT}/hooks/check.sh\n      timeout: 5\n",
    );
    fs.writeFileSync(path.join(root, "hooks", "check.sh"), "#!/bin/sh\n", { mode: 0o755 });
    const rendered = renderBundle(loadBundle(root), ["claude-code", "cursor"], ["plugin"]);
    const claude = JSON.parse(
      rendered.artifacts
        .find((artifact) => artifact.path === "claude-code/plugin/hooks/hooks.json")!
        .content.toString(),
    );
    expect(claude.hooks.PreToolUse[0].hooks[0].command).toContain("CLAUDE_PLUGIN_ROOT");
    const cursor = JSON.parse(
      rendered.artifacts
        .find((artifact) => artifact.path === "cursor/plugin/hooks/hooks.json")!
        .content.toString(),
    );
    expect(cursor.version).toBe(1);
    expect(
      rendered.artifacts.find((artifact) => artifact.path.endsWith("hooks/check.sh"))?.mode,
    ).toBe(0o755);
  });

  it("renders command policies with native decisions and examples", () => {
    const root = bundleRoot();
    fs.mkdirSync(path.join(root, "policies"));
    fs.writeFileSync(
      path.join(root, "policies", "git.yaml"),
      "rules:\n  - pattern: [git, push]\n    action: deny\n    justification: Use reviewed automation\n    positiveExamples: [git push origin main]\n    negativeExamples: [git status]\n",
    );
    const rendered = renderBundle(loadBundle(root), ["codex", "cursor"], ["project"]);
    const codex = rendered.artifacts
      .find((artifact) => artifact.path === "codex/project/.codex/rules/bundle.rules")!
      .content.toString();
    expect(codex).toContain('decision = "forbidden"');
    expect(codex).toContain("not_match");
    expect(rendered.diagnostics.map((item) => item.code)).toContain("AB361");
  });
});
