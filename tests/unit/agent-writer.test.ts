import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeArtifactsAtomically, placeSymlink } from "../../src/agent/writer.js";
import type { Artifact } from "../../src/agent/types.js";

const temporary: string[] = [];

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-writer-"));
  temporary.push(root);
  return root;
}

function artifact(filePath: string, content: string, mode = 0o644): Artifact {
  return { path: filePath, content: Buffer.from(content), mode };
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("writeArtifactsAtomically", () => {
  it("writes artifacts and preserves executable modes", () => {
    const output = path.join(workspace(), "out");
    writeArtifactsAtomically(
      output,
      [artifact("a/plugin/file.md", "hello"), artifact("a/plugin/run.sh", "#!/bin/sh\n", 0o755)],
      { managedRoots: ["a/plugin"], force: false },
    );
    expect(fs.readFileSync(path.join(output, "a/plugin/file.md"), "utf8")).toBe("hello");
    expect(fs.statSync(path.join(output, "a/plugin/run.sh")).mode & 0o777).toBe(0o755);
  });

  it("refuses a nonempty managed root without force", () => {
    const output = path.join(workspace(), "out");
    fs.mkdirSync(path.join(output, "a/plugin"), { recursive: true });
    fs.writeFileSync(path.join(output, "a/plugin/existing.md"), "old");
    expect(() =>
      writeArtifactsAtomically(output, [artifact("a/plugin/file.md", "new")], {
        managedRoots: ["a/plugin"],
        force: false,
      }),
    ).toThrow(/nonempty/);
    expect(fs.existsSync(path.join(output, "a/plugin/existing.md"))).toBe(true);
  });

  it("replaces a managed root wholesale under force", () => {
    const output = path.join(workspace(), "out");
    fs.mkdirSync(path.join(output, "a/plugin"), { recursive: true });
    fs.writeFileSync(path.join(output, "a/plugin/stale.md"), "old");
    writeArtifactsAtomically(output, [artifact("a/plugin/file.md", "new")], {
      managedRoots: ["a/plugin"],
      force: true,
    });
    expect(fs.existsSync(path.join(output, "a/plugin/stale.md"))).toBe(false);
    expect(fs.existsSync(path.join(output, "a/plugin/file.md"))).toBe(true);
  });

  it("replaces loose files individually without owning the root", () => {
    const output = path.join(workspace(), "out");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "report.json"), "{}");
    fs.writeFileSync(path.join(output, "untouched.txt"), "keep");
    writeArtifactsAtomically(
      output,
      [artifact("a/plugin/file.md", "new"), artifact("report.json", '{"ok":true}')],
      { managedRoots: ["a/plugin"], looseFiles: ["report.json"], force: true },
    );
    expect(fs.readFileSync(path.join(output, "report.json"), "utf8")).toBe('{"ok":true}');
    expect(fs.readFileSync(path.join(output, "untouched.txt"), "utf8")).toBe("keep");
  });

  it("creates an empty managed root when no artifact targets it", () => {
    const output = path.join(workspace(), "out");
    writeArtifactsAtomically(output, [artifact("a/plugin/file.md", "x")], {
      managedRoots: ["a/plugin", "a/project"],
      force: false,
    });
    expect(fs.statSync(path.join(output, "a/project")).isDirectory()).toBe(true);
    expect(fs.readdirSync(path.join(output, "a/project"))).toEqual([]);
  });

  it("leaves no staging directory behind when a write fails", () => {
    const root = workspace();
    const output = path.join(root, "out");
    // A path that collides with a file already staged as a directory parent.
    expect(() =>
      writeArtifactsAtomically(
        output,
        [artifact("a/plugin/file.md", "x"), artifact("a/plugin/file.md/nested.md", "y")],
        { managedRoots: ["a/plugin"], force: false },
      ),
    ).toThrow();
    expect(fs.readdirSync(root).filter((name) => name.includes("staging"))).toEqual([]);
  });
});

describe("placeSymlink", () => {
  it("creates a symlink and replaces an existing path", () => {
    const root = workspace();
    const target = path.join(root, "tree");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "file.md"), "hello");
    const link = path.join(root, "plugins", "hello");
    placeSymlink(link, target);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(link, "file.md"), "utf8")).toBe("hello");
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(link, { recursive: true });
    fs.writeFileSync(path.join(link, "old.md"), "stale");
    placeSymlink(link, target);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(link, "file.md"), "utf8")).toBe("hello");
  });
});
