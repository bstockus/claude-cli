import { describe, it, expect } from "vitest";
import { checkMarkdownLint } from "../../../src/checkers/markdown-lint.js";
import type { Issue } from "../../../src/types.js";

describe("checkMarkdownLint", () => {
  it("produces no issues for valid markdown", async () => {
    const content = "# Heading\n\nSome paragraph text.\n";
    const issues: Issue[] = [];
    await checkMarkdownLint("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });

  it("detects missing blank line before heading", async () => {
    const content = "# Heading\nSome text\n## Another Heading\n";
    const issues: Issue[] = [];
    await checkMarkdownLint("/tmp/test.md", content, issues);
    const headingIssues = issues.filter((i) => i.checker.includes("MD022"));
    expect(headingIssues.length).toBeGreaterThan(0);
  });

  it("does not flag long lines (MD013 disabled in config)", async () => {
    const longLine = "A".repeat(200);
    const content = `# Heading\n\n${longLine}\n`;
    const issues: Issue[] = [];
    await checkMarkdownLint("/tmp/test.md", content, issues);
    const lineIssues = issues.filter((i) => i.checker.includes("MD013"));
    expect(lineIssues).toHaveLength(0);
  });
});
