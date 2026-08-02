import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { Workspace } from "../../src/workspace.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cli-workspace-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Workspace", () => {
  it("applies include, exclude, permanent exclusions, and stable sorting", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".claude-cli.yml"),
      'version: 1\nfiles:\n  include: ["**/*.md"]\n  exclude: ["drafts/**"]\n',
    );
    fs.mkdirSync(path.join(tmpDir, "drafts"));
    fs.mkdirSync(path.join(tmpDir, "node_modules"));
    fs.mkdirSync(path.join(tmpDir, ".github"));
    fs.writeFileSync(path.join(tmpDir, "b.md"), "# B\n");
    fs.writeFileSync(path.join(tmpDir, "a.md"), "# A\n");
    fs.writeFileSync(path.join(tmpDir, "drafts", "skip.md"), "# Skip\n");
    fs.writeFileSync(path.join(tmpDir, "node_modules", "skip.md"), "# Skip\n");
    fs.writeFileSync(path.join(tmpDir, ".github", "included.md"), "# Included\n");
    const workspace = new Workspace(loadConfig({ disabled: false }, tmpDir));
    expect(workspace.markdownFiles().map((file) => path.basename(file))).toEqual([
      "included.md",
      "a.md",
      "b.md",
    ]);
  });

  it("caches documents and invalidates them", () => {
    const file = path.join(tmpDir, "doc.md");
    fs.writeFileSync(file, "# First\n");
    const workspace = new Workspace(loadConfig({ disabled: true }, tmpDir));
    const first = workspace.document(file);
    fs.writeFileSync(file, "# Second\n");
    expect(workspace.document(file)).toBe(first);
    workspace.invalidate(file);
    expect(workspace.document(file).headings[0].text).toBe("Second");
  });

  it("refuses configured scans outside the workspace", () => {
    fs.writeFileSync(path.join(tmpDir, ".claude-cli.yml"), "version: 1\n");
    const workspace = new Workspace(loadConfig({ disabled: false }, tmpDir));
    expect(() => workspace.markdownFiles(path.dirname(tmpDir))).toThrow("outside configured");
  });
});
