import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintFile } from "../../src/lint.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures");

describe("lintFile integration", () => {
  it("returns zero issues for clean fixture", async () => {
    const issues = await lintFile(path.join(fixturesDir, "clean.md"));
    expect(issues).toHaveLength(0);
  });

  it("returns zero issues for valid-all-features fixture", async () => {
    const issues = await lintFile(path.join(fixturesDir, "valid-all-features.md"));
    expect(issues).toHaveLength(0);
  });

  it("detects mixed errors in mixed-errors fixture", async () => {
    const issues = await lintFile(path.join(fixturesDir, "mixed-errors.md"));
    expect(issues.length).toBeGreaterThanOrEqual(4);

    const checkers = new Set(issues.map((i) => i.checker));
    expect(checkers.has("katex")).toBe(true);
    expect(checkers.has("mermaid")).toBe(true);
    expect(checkers.has("ref/link")).toBe(true);
    expect(checkers.has("ref/anchor")).toBe(true);
  });

  it("detects mermaid errors in broken-mermaid fixture", async () => {
    const issues = await lintFile(path.join(fixturesDir, "broken-mermaid.md"));
    const mermaidIssues = issues.filter((i) => i.checker === "mermaid");
    expect(mermaidIssues).toHaveLength(1);
  });

  it("detects katex errors in broken-katex fixture", async () => {
    const issues = await lintFile(path.join(fixturesDir, "broken-katex.md"));
    const katexIssues = issues.filter((i) => i.checker === "katex");
    expect(katexIssues).toHaveLength(2);
  });

  it("detects reference errors in broken-refs fixture", async () => {
    const issues = await lintFile(path.join(fixturesDir, "broken-refs.md"));
    const refIssues = issues.filter((i) => i.checker.startsWith("ref/"));
    expect(refIssues.length).toBeGreaterThanOrEqual(2);
  });

  it("detects anchor errors in broken-anchors fixture", async () => {
    const issues = await lintFile(path.join(fixturesDir, "broken-anchors.md"));
    const anchorIssues = issues.filter((i) => i.checker === "ref/anchor");
    expect(anchorIssues).toHaveLength(1);
  });
});
