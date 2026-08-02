import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, "..", "..", "dist", "cli.js");
const fixturesDir = path.join(__dirname, "..", "fixtures");

async function runCli(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await exec("node", [cliPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; code: number };
    return { stdout: e.stdout || "", stderr: e.stderr || "", exitCode: e.code };
  }
}

describe("CLI e2e", () => {
  it("shows help with no arguments", async () => {
    const { stdout, exitCode } = await runCli("help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("claude-cli");
    expect(stdout).toContain("md");
  });

  it("reports a version from package.json", async () => {
    const { stdout, exitCode } = await runCli("--version");
    expect(exitCode).toBe(0);
    // semantic-release owns this value; pre-release it is 0.0.0-development
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("lists check-update in help but hides the internal refresh command", async () => {
    const { stdout, exitCode } = await runCli("help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("check-update");
    expect(stdout).not.toContain("__refresh-update-cache");
  });

  it("documents check-update exit codes", async () => {
    const { stdout, exitCode } = await runCli("check-update", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("newer version");
    expect(stdout).toContain("--format");
  });

  // The notifier writes to stderr, which for `md lint` carries the issue payload
  // (JSON included). A notice leaking into a non-interactive run would corrupt it.
  it("never emits an update notice when stdio is not a TTY", async () => {
    const { stderr, stdout } = await runCli(
      "md",
      "lint",
      path.join(fixturesDir, "broken-katex.md"),
    );
    expect(stderr).not.toContain("Update available");
    expect(stdout).not.toContain("Update available");
  });

  it("shows md lint help with --help", async () => {
    const { stdout, exitCode } = await runCli("md", "lint", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Run all checks on a single markdown file");
    expect(stdout).toContain("--format");
  });

  it("exits 0 for clean file", async () => {
    const { exitCode, stdout } = await runCli("md", "lint", path.join(fixturesDir, "clean.md"));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No issues found");
  });

  it("exits 2 for file with errors", async () => {
    const { exitCode, stderr } = await runCli(
      "md",
      "lint",
      path.join(fixturesDir, "broken-katex.md"),
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("katex");
  });

  it("outputs valid JSON with --format=json", async () => {
    const { exitCode, stderr } = await runCli(
      "md",
      "lint",
      path.join(fixturesDir, "broken-katex.md"),
      "--format=json",
    );
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stderr);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty("file");
    expect(parsed[0]).toHaveProperty("line");
    expect(parsed[0]).toHaveProperty("checker");
    expect(parsed[0]).toHaveProperty("message");
  });

  it("outputs ANSI with -fh shorthand", async () => {
    const { exitCode, stderr } = await runCli(
      "md",
      "lint",
      path.join(fixturesDir, "broken-katex.md"),
      "-fh",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("\x1b[");
  });

  it("lint-dir aggregates issues across files", async () => {
    const { exitCode, stderr } = await runCli("md", "lint-dir", fixturesDir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("total issue(s) across");
  });

  it("lint-dir --summary shows one line per file", async () => {
    const { exitCode, stderr } = await runCli("md", "lint-dir", fixturesDir, "--summary");
    expect(exitCode).toBe(2);
    // Should contain pass/fail markers and file paths
    expect(stderr).toContain("✖");
    expect(stderr).toContain("issue(s)");
    expect(stderr).toContain("passed");
    expect(stderr).toContain("failed");
  });

  it("lint-dir --summary outputs valid JSON", async () => {
    const { exitCode, stderr } = await runCli("md", "lint-dir", fixturesDir, "--summary", "-fj");
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stderr);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("file");
    expect(parsed[0]).toHaveProperty("issues");
    expect(parsed[0]).toHaveProperty("ok");
  });

  it("lint-dir --summary exits 0 for clean directory", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-summary-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "clean.md"), "# Clean\n\nNo issues here.\n");
      const { exitCode, stdout } = await runCli("md", "lint-dir", tmpDir, "--summary");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("✔");
      expect(stdout).toContain("1 file(s)");
      expect(stdout).toContain("0 total issue(s)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("lint-dir exits 0 with no-files message for empty dir", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-"));
    try {
      const { exitCode, stdout } = await runCli("md", "lint-dir", emptyDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("No .md files found");
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("exits 1 for unknown command", async () => {
    const { exitCode, stderr } = await runCli("unknown-cmd");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown command");
  });

  // md refs tests
  it("refs lists references from a file", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "refs",
      path.join(fixturesDir, "refs-source.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("refs-to-target.md");
    expect(stdout).toContain("[exists]");
  });

  it("refs exits 2 when references are missing", async () => {
    const { exitCode, stderr } = await runCli(
      "md",
      "refs",
      path.join(fixturesDir, "broken-refs.md"),
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("MISSING");
  });

  it("refs includes external URLs with --external flag", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "refs",
      path.join(fixturesDir, "refs-source.md"),
      "--external",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("https://example.com");
  });

  it("refs includes anchors with --anchors flag", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "refs",
      path.join(fixturesDir, "refs-source.md"),
      "--anchors",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("#refs-source");
  });

  it("refs outputs valid JSON with --format=json", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "refs",
      path.join(fixturesDir, "refs-source.md"),
      "--format=json",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty("target");
    expect(parsed[0]).toHaveProperty("exists");
  });

  // md refs-to tests
  it("refs-to finds references to a target file", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "refs-to",
      path.join(fixturesDir, "refs-to-target.md"),
      fixturesDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("refs-source.md");
    expect(stdout).toContain("reference(s) to");
  });

  it("refs-to reports no references for unreferenced file", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "refs-to",
      path.join(fixturesDir, "broken-mermaid.md"),
      fixturesDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No references found");
  });

  it("refs-to outputs valid JSON with --format=json", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "refs-to",
      path.join(fixturesDir, "refs-to-target.md"),
      fixturesDir,
      "--format=json",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty("sourceFile");
    expect(parsed[0]).toHaveProperty("line");
  });

  // md headers tests
  it("headers extracts headings with line numbers", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "headers",
      path.join(fixturesDir, "valid-all-features.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("heading(s)");
    expect(stdout).toContain("# Valid All Features");
    expect(stdout).toContain("## Math");
  });

  it("headers respects --max-depth", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "headers",
      path.join(fixturesDir, "valid-all-features.md"),
      "--max-depth",
      "1",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 heading(s)");
    expect(stdout).toContain("# Valid All Features");
    expect(stdout).not.toContain("## Math");
  });

  it("headers outputs valid JSON with --format=json", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "headers",
      path.join(fixturesDir, "valid-all-features.md"),
      "-fj",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("depth");
    expect(parsed[0]).toHaveProperty("text");
    expect(parsed[0]).toHaveProperty("slug");
    expect(parsed[0]).toHaveProperty("line");
  });

  // md outline tests
  it("outline shows indented heading tree", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "outline",
      path.join(fixturesDir, "valid-all-features.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Valid All Features");
    expect(stdout).toContain("  Math");
  });

  it("outline outputs nested JSON tree", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "outline",
      path.join(fixturesDir, "valid-all-features.md"),
      "-fj",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("children");
    expect(parsed[0].children.length).toBeGreaterThan(0);
  });

  // md toc tests
  it("toc generates markdown table of contents", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "toc",
      path.join(fixturesDir, "valid-all-features.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("- [Valid All Features](#valid-all-features)");
    expect(stdout).toContain("  - [Math](#math)");
  });

  it("toc respects --min-depth and --ordered", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "toc",
      path.join(fixturesDir, "valid-all-features.md"),
      "--min-depth",
      "2",
      "--ordered",
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("Valid All Features");
    expect(stdout).toContain("1. [Math](#math)");
  });

  // md stats tests
  it("stats shows document statistics", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "stats",
      path.join(fixturesDir, "valid-all-features.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Words:");
    expect(stdout).toContain("Headings:");
    expect(stdout).toContain("Links:");
    expect(stdout).toContain("Code blocks:");
  });

  it("stats outputs valid JSON", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "stats",
      path.join(fixturesDir, "valid-all-features.md"),
      "-fj",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("wordCount");
    expect(parsed).toHaveProperty("headings");
    expect(parsed).toHaveProperty("links");
    expect(parsed).toHaveProperty("codeBlocks");
  });

  // md code-blocks tests
  it("code-blocks lists code blocks", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "code-blocks",
      path.join(fixturesDir, "valid-all-features.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("code block(s)");
    expect(stdout).toContain("mermaid");
  });

  it("code-blocks filters by --lang", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "code-blocks",
      path.join(fixturesDir, "valid-all-features.md"),
      "--lang",
      "nonexistent",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No code blocks found");
  });

  // md structure tests
  it("structure shows document skeleton", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "structure",
      path.join(fixturesDir, "valid-all-features.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# Valid All Features");
    expect(stdout).toContain("mermaid");
  });

  it("structure outputs valid JSON", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "structure",
      path.join(fixturesDir, "valid-all-features.md"),
      "-fj",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("type");
    expect(parsed[0]).toHaveProperty("line");
    expect(parsed[0]).toHaveProperty("detail");
  });

  // md links tests
  it("links lists links grouped by type", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "links",
      path.join(fixturesDir, "valid-all-features.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("link(s)");
  });

  it("links outputs valid JSON", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "links",
      path.join(fixturesDir, "valid-all-features.md"),
      "-fj",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  // md section tests
  it("section extracts section content", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "section",
      path.join(fixturesDir, "with-sections.md"),
      "Usage",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage");
    expect(stdout).toContain("Use the CLI like this");
  });

  it("section extracts with --raw", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "section",
      path.join(fixturesDir, "with-sections.md"),
      "Usage",
      "--raw",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("## Usage");
    expect(stdout).toContain("Use the CLI like this");
    // Should not contain wrapper text
    expect(stdout).not.toContain("Section ");
  });

  it("section exits 1 for missing heading", async () => {
    const { exitCode, stderr } = await runCli(
      "md",
      "section",
      path.join(fixturesDir, "with-sections.md"),
      "Nonexistent",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Heading not found");
  });

  it("section outputs valid JSON", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "section",
      path.join(fixturesDir, "with-sections.md"),
      "Getting Started",
      "-fj",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("heading", "Getting Started");
    expect(parsed).toHaveProperty("slug", "getting-started");
    expect(parsed).toHaveProperty("depth", 2);
    expect(parsed).toHaveProperty("content");
    expect(parsed.content).toContain("Prerequisites");
  });

  it("section respects --no-children", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "section",
      path.join(fixturesDir, "with-sections.md"),
      "Getting Started",
      "--no-children",
      "--raw",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("getting started section");
    expect(stdout).not.toContain("Prerequisites");
  });

  it("section matches by slug", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "section",
      path.join(fixturesDir, "with-sections.md"),
      "getting-started",
      "--raw",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Getting Started");
  });

  // md frontmatter tests
  it("frontmatter displays parsed frontmatter", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "frontmatter",
      path.join(fixturesDir, "with-frontmatter.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Frontmatter in");
    expect(stdout).toContain("title");
    expect(stdout).toContain("My Document");
  });

  it("frontmatter outputs valid JSON", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "frontmatter",
      path.join(fixturesDir, "with-frontmatter.md"),
      "-fj",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.title).toBe("My Document");
    expect(parsed.author.name).toBe("Jane Doe");
    expect(parsed.tags).toEqual(["markdown", "tools"]);
  });

  it("frontmatter extracts specific key", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "frontmatter",
      path.join(fixturesDir, "with-frontmatter.md"),
      "--key",
      "author.name",
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("Jane Doe");
  });

  it("frontmatter exits 1 for missing key", async () => {
    const { exitCode, stderr } = await runCli(
      "md",
      "frontmatter",
      path.join(fixturesDir, "with-frontmatter.md"),
      "--key",
      "nonexistent.path",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Key not found");
  });

  it("frontmatter handles file without frontmatter", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "frontmatter",
      path.join(fixturesDir, "clean.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No frontmatter");
  });

  // md tasks tests
  it("tasks lists task items", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "tasks",
      path.join(fixturesDir, "with-tasks.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("task(s)");
    expect(stdout).toContain("[x]");
    expect(stdout).toContain("[ ]");
  });

  it("tasks filters by --status done", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "tasks",
      path.join(fixturesDir, "with-tasks.md"),
      "--status",
      "done",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[x]");
    expect(stdout).not.toContain("[ ]");
  });

  it("tasks filters by --status pending", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "tasks",
      path.join(fixturesDir, "with-tasks.md"),
      "--status",
      "pending",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[ ]");
    expect(stdout).not.toContain("[x]");
  });

  it("tasks shows summary with --summary", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "tasks",
      path.join(fixturesDir, "with-tasks.md"),
      "--summary",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("done");
    expect(stdout).toContain("pending");
    expect(stdout).toContain("%");
    // Summary should not list individual tasks
    expect(stdout).not.toContain("L");
  });

  it("tasks outputs valid JSON", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "tasks",
      path.join(fixturesDir, "with-tasks.md"),
      "-fj",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("total");
    expect(parsed).toHaveProperty("done");
    expect(parsed).toHaveProperty("pending");
    expect(parsed).toHaveProperty("tasks");
    expect(parsed.total).toBe(parsed.done + parsed.pending);
    expect(parsed.tasks[0]).toHaveProperty("line");
    expect(parsed.tasks[0]).toHaveProperty("checked");
    expect(parsed.tasks[0]).toHaveProperty("text");
  });

  // md tables tests
  it("tables lists tables with dimensions", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "tables",
      path.join(fixturesDir, "with-tables.md"),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("table(s)");
    expect(stdout).toContain("columns");
    expect(stdout).toContain("rows");
  });

  it("tables extracts specific table with --index", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "tables",
      path.join(fixturesDir, "with-tables.md"),
      "--index",
      "1",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 table(s)");
  });

  it("tables exits 1 for out-of-range --index", async () => {
    const { exitCode, stderr } = await runCli(
      "md",
      "tables",
      path.join(fixturesDir, "with-tables.md"),
      "--index",
      "99",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("out of range");
  });

  it("tables includes content with --content", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "tables",
      path.join(fixturesDir, "with-tables.md"),
      "--content",
      "--index",
      "1",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Name");
    expect(stdout).toContain("format");
  });

  it("tables outputs valid JSON", async () => {
    const { exitCode, stdout } = await runCli(
      "md",
      "tables",
      path.join(fixturesDir, "with-tables.md"),
      "-fj",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0]).toHaveProperty("headers");
    expect(parsed[0]).toHaveProperty("data");
    expect(parsed[0]).toHaveProperty("columns");
    expect(parsed[0]).toHaveProperty("rows");
    expect(parsed[0]).toHaveProperty("align");
  });

  // md orphans tests
  it("orphans finds unreferenced files", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orphans-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "index.md"), "# Index\n\nSee [guide](./guide.md).\n");
      fs.writeFileSync(path.join(tmpDir, "guide.md"), "# Guide\n\nContent.\n");
      fs.writeFileSync(path.join(tmpDir, "orphan.md"), "# Orphan\n\nNobody links here.\n");

      const { exitCode, stderr } = await runCli("md", "orphans", tmpDir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("orphan.md");
      expect(stderr).toContain("index.md");
      // guide.md is referenced, should not be in orphans
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("orphans respects --entry", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orphans-entry-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "README.md"), "# README\n\nSee [other](./other.md).\n");
      fs.writeFileSync(path.join(tmpDir, "other.md"), "# Other\n\nContent.\n");

      const { exitCode, stdout } = await runCli("md", "orphans", tmpDir, "--entry", "README.md");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("No orphans");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("orphans outputs valid JSON", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orphans-json-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "a.md"), "# A\n\n[link](./b.md)\n");
      fs.writeFileSync(path.join(tmpDir, "b.md"), "# B\n");
      fs.writeFileSync(path.join(tmpDir, "c.md"), "# C\n");

      const { exitCode, stderr } = await runCli("md", "orphans", tmpDir, "-fj");
      expect(exitCode).toBe(2);
      const parsed = JSON.parse(stderr);
      expect(parsed).toHaveProperty("totalFiles", 3);
      expect(parsed).toHaveProperty("orphans");
      expect(parsed.orphans.length).toBe(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // md rename-heading tests
  it("rename-heading dry-run shows planned changes", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rename-"));
    const tmpFile = path.join(tmpDir, "test.md");
    try {
      fs.writeFileSync(
        tmpFile,
        "# Title\n\n## Old Section\n\nContent.\n\nSee [link](#old-section).\n",
      );

      const { exitCode, stdout } = await runCli(
        "md",
        "rename-heading",
        tmpFile,
        "Old Section",
        "New Section",
        "--dry-run",
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Old Section");
      expect(stdout).toContain("New Section");
      expect(stdout).toContain("#old-section");
      expect(stdout).toContain("#new-section");
      expect(stdout).toContain("dry run");

      // File should not be modified
      const content = fs.readFileSync(tmpFile, "utf-8");
      expect(content).toContain("## Old Section");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rename-heading applies changes without dry-run", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rename-apply-"));
    const tmpFile = path.join(tmpDir, "test.md");
    try {
      fs.writeFileSync(tmpFile, "# Title\n\n## Old Name\n\nContent.\n\nSee [link](#old-name).\n");

      const { exitCode } = await runCli("md", "rename-heading", tmpFile, "Old Name", "New Name");
      expect(exitCode).toBe(0);

      const content = fs.readFileSync(tmpFile, "utf-8");
      expect(content).toContain("## New Name");
      expect(content).toContain("#new-name");
      expect(content).not.toContain("## Old Name");
      expect(content).not.toContain("#old-name");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rename-heading exits 1 for missing heading", async () => {
    const { exitCode, stderr } = await runCli(
      "md",
      "rename-heading",
      path.join(fixturesDir, "with-sections.md"),
      "Nonexistent",
      "New Name",
      "--dry-run",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Heading not found");
  });

  it("rename-heading outputs valid JSON", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rename-json-"));
    const tmpFile = path.join(tmpDir, "test.md");
    try {
      fs.writeFileSync(tmpFile, "# Title\n\n## My Heading\n\nContent.\n");

      const { exitCode, stdout } = await runCli(
        "md",
        "rename-heading",
        tmpFile,
        "My Heading",
        "Your Heading",
        "--dry-run",
        "-fj",
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty("heading");
      expect(parsed.heading.oldText).toBe("My Heading");
      expect(parsed.heading.newText).toBe("Your Heading");
      expect(parsed.heading.oldSlug).toBe("my-heading");
      expect(parsed.heading.newSlug).toBe("your-heading");
      expect(parsed.dryRun).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
