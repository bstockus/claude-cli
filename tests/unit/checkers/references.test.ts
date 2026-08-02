import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkReferences } from "../../../src/checkers/references.js";
import type { Issue } from "../../../src/types.js";

let tmpDir: string;
let existingFile: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ref-test-"));
  existingFile = path.join(tmpDir, "existing.md");
  fs.writeFileSync(existingFile, "# Existing\n\n## Sub Heading\n");
  fs.writeFileSync(path.join(tmpDir, "image.png"), "fake image");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("checkReferences", () => {
  it("produces no issues for valid relative link", () => {
    const filePath = path.join(tmpDir, "test.md");
    const content = "# Test\n\n[link](./existing.md)\n";
    const issues: Issue[] = [];
    checkReferences(filePath, content, issues);
    expect(issues).toHaveLength(0);
  });

  it("detects broken link to nonexistent file", () => {
    const filePath = path.join(tmpDir, "test.md");
    const content = "# Test\n\n[link](./nonexistent.md)\n";
    const issues: Issue[] = [];
    checkReferences(filePath, content, issues);
    expect(issues).toHaveLength(1);
    expect(issues[0].checker).toBe("ref/link");
    expect(issues[0].line).toBe(3);
  });

  it("produces no issues for valid anchor", () => {
    const content = "# Test\n\n## My Section\n\n[link](#my-section)\n";
    const issues: Issue[] = [];
    checkReferences("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });

  it("detects broken anchor", () => {
    const content = "# Test\n\n[link](#nonexistent)\n";
    const issues: Issue[] = [];
    checkReferences("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(1);
    expect(issues[0].checker).toBe("ref/anchor");
  });

  it("produces no issues for valid image reference", () => {
    const filePath = path.join(tmpDir, "test.md");
    const content = "# Test\n\n![alt](./image.png)\n";
    const issues: Issue[] = [];
    checkReferences(filePath, content, issues);
    expect(issues).toHaveLength(0);
  });

  it("detects broken image reference", () => {
    const filePath = path.join(tmpDir, "test.md");
    const content = "# Test\n\n![alt](./missing.png)\n";
    const issues: Issue[] = [];
    checkReferences(filePath, content, issues);
    expect(issues).toHaveLength(1);
    expect(issues[0].checker).toBe("ref/image");
  });

  it("skips external URLs", () => {
    const content = "# Test\n\n[link](https://example.com)\n[mail](mailto:a@b.com)\n";
    const issues: Issue[] = [];
    checkReferences("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });

  it("validates cross-file anchors", () => {
    const filePath = path.join(tmpDir, "test.md");
    const content = "# Test\n\n[link](./existing.md#sub-heading)\n";
    const issues: Issue[] = [];
    checkReferences(filePath, content, issues);
    expect(issues).toHaveLength(0);
  });

  it("detects broken cross-file anchors", () => {
    const filePath = path.join(tmpDir, "test.md");
    const content = "# Test\n\n[link](./existing.md#nonexistent)\n";
    const issues: Issue[] = [];
    checkReferences(filePath, content, issues);
    expect(issues).toHaveLength(1);
    expect(issues[0].checker).toBe("ref/anchor");
  });

  it("accepts encoded Unicode anchor fragments", () => {
    const content = "# Über café\n\n[link](#%C3%BCber-caf%C3%A9)\n";
    const issues: Issue[] = [];
    checkReferences("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });

  it("validates reference-style links", () => {
    const filePath = path.join(tmpDir, "test.md");
    const content = "# Test\n\n[link][target]\n\n[target]: ./existing.md#sub-heading\n";
    const issues: Issue[] = [];
    checkReferences(filePath, content, issues);
    expect(issues).toHaveLength(0);
  });

  it("skips links inside code blocks", () => {
    const content = "# Test\n\n```\n[link](./nonexistent.md)\n```\n";
    const issues: Issue[] = [];
    checkReferences("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });
});
