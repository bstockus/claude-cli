import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { lintFile, findMarkdownFiles } from "../../src/lint.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-test-"));
  fs.writeFileSync(path.join(tmpDir, "a.md"), "# File A\n\nSome text.\n");
  fs.writeFileSync(path.join(tmpDir, "b.md"), "# File B\n\nMore text.\n");
  fs.mkdirSync(path.join(tmpDir, "sub"));
  fs.writeFileSync(path.join(tmpDir, "sub", "c.md"), "# File C\n\nNested.\n");
  fs.writeFileSync(path.join(tmpDir, "not-md.txt"), "not markdown");
  fs.mkdirSync(path.join(tmpDir, "node_modules"));
  fs.writeFileSync(path.join(tmpDir, "node_modules", "skip.md"), "# Should be skipped\n");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("lintFile", () => {
  it("returns issues from multiple checkers", async () => {
    const filePath = path.join(tmpDir, "test-errors.md");
    fs.writeFileSync(filePath, "# Test\n\nBad math: $\\invalid$\n\n[broken](./nope.md)\n");
    const issues = await lintFile(filePath);
    const checkers = new Set(issues.map((i) => i.checker));
    expect(checkers.has("katex")).toBe(true);
    expect(checkers.has("ref/link")).toBe(true);
  });
});

describe("findMarkdownFiles", () => {
  it("finds .md files recursively", () => {
    const files = findMarkdownFiles(tmpDir);
    const names = files.map((f) => path.basename(f));
    expect(names).toContain("a.md");
    expect(names).toContain("b.md");
    expect(names).toContain("c.md");
  });

  it("excludes non-.md files", () => {
    const files = findMarkdownFiles(tmpDir);
    const names = files.map((f) => path.basename(f));
    expect(names).not.toContain("not-md.txt");
  });

  it("excludes node_modules", () => {
    const files = findMarkdownFiles(tmpDir);
    const names = files.map((f) => path.basename(f));
    expect(names).not.toContain("skip.md");
  });

  it("returns sorted results", () => {
    const files = findMarkdownFiles(tmpDir);
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });
});
