import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkMarkdownLint } from "../../../src/checkers/markdown-lint.js";
import type { Issue } from "../../../src/types.js";

describe("checkMarkdownLint", () => {
  const tempDirectories: string[] = [];
  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
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

  it("merges a YAML project configuration over packaged defaults", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "markdownlint-config-"));
    tempDirectories.push(directory);
    const configPath = path.join(directory, "rules.yml");
    fs.writeFileSync(configPath, "MD013:\n  line_length: 20\n");
    const issues: Issue[] = [];
    await checkMarkdownLint(
      "/tmp/test.md",
      "# Heading\n\nThis is a deliberately long paragraph line for linting.\n",
      issues,
      configPath,
    );
    expect(issues.some((issue) => issue.checker.includes("MD013"))).toBe(true);
  });
});
