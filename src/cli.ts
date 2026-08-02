#!/usr/bin/env node

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { lintAction } from "./commands/lint.js";
import { lintDirAction } from "./commands/lint-dir.js";
import { refsAction } from "./commands/refs.js";
import { refsToAction } from "./commands/refs-to.js";
import { headersAction } from "./commands/headers.js";
import { outlineAction } from "./commands/outline.js";
import { tocAction } from "./commands/toc.js";
import { statsAction } from "./commands/stats.js";
import { codeBlocksAction } from "./commands/code-blocks.js";
import { structureAction } from "./commands/structure.js";
import { linksAction } from "./commands/links.js";
import { sectionAction } from "./commands/section.js";
import { frontmatterAction } from "./commands/frontmatter.js";
import { tasksAction } from "./commands/tasks.js";
import { tablesAction } from "./commands/tables.js";
import { checkUrlsAction } from "./commands/check-urls.js";
import { orphansAction } from "./commands/orphans.js";
import { renameHeadingAction } from "./commands/rename-heading.js";
import { checkUpdateAction, refreshUpdateCacheAction } from "./commands/update-check.js";
import { installUpdateNotifier, CHECK_COMMAND, REFRESH_COMMAND } from "./update-notifier.js";

// Read the version at runtime rather than inlining it: semantic-release rewrites
// package.json at release time, so a literal here would always be stale.
// From dist/cli.js, "../package.json" is the package root — always present in the tarball.
const { version, name: packageName } = createRequire(import.meta.url)("../package.json") as {
  version: string;
  name: string;
};

// Pre-process argv to expand -fh/-fj shorthands into --format values
// before Commander sees them (Commander doesn't support multi-char short flags)
const argv = process.argv.map((arg) => {
  if (arg === "-fh") return "--format=human";
  if (arg === "-fj") return "--format=json";
  return arg;
});

// Reads the cached result and may schedule a detached refresh. Never blocks and
// never writes to a machine-readable stream — see src/update-notifier.ts.
installUpdateNotifier({
  currentVersion: version,
  packageName,
  argv,
  entryPoint: fileURLToPath(import.meta.url),
});

const program = new Command()
  .name("claude-cli")
  .description("A generic CLI toolkit for working with markdown files and related assets")
  .version(version);

program
  .command(CHECK_COMMAND)
  .description("Check whether a newer version of this CLI has been published")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nQueries the registry directly rather than using the 24h cache.\n\nExit codes:\n  0  Already on the latest version\n  1  Could not reach the registry\n  2  A newer version is available",
  )
  .action((opts: { format: string }) => checkUpdateAction(packageName, version, opts));

// Internal: refreshes the cached latest version. Spawned detached by the notifier.
program
  .command(REFRESH_COMMAND, { hidden: true })
  .description("Internal: refresh the cached latest-version check")
  .action(() => refreshUpdateCacheAction(packageName));

const md = program
  .command("md")
  .description("Markdown validation commands")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  );

md.command("lint")
  .description("Run all checks on a single markdown file")
  .argument("<file>", "Path to the markdown file to validate")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("-s, --style", "Include markdown style checks (markdownlint)", false)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All checks pass\n  2  One or more issues found",
  )
  .action(lintAction);

md.command("lint-dir")
  .description("Run all checks on all markdown files in a directory")
  .argument("<directory>", "Path to the directory to scan")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("-s, --style", "Include markdown style checks (markdownlint)", false)
  .option("--summary", "Show one line per file with pass/fail and issue count", false)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All files pass all checks\n  2  One or more issues found in any file",
  )
  .action(lintDirAction);

md.command("refs")
  .description("List all references from a markdown file and check if targets exist")
  .argument("<file>", "Path to the markdown file to inspect")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("-e, --external", "Include external URLs", false)
  .option("-a, --anchors", "Include anchor-only references", false)
  .option("-i, --images", "Include image references", false)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All referenced targets exist\n  2  One or more targets missing",
  )
  .action(refsAction);

md.command("refs-to")
  .description("Find all markdown files that reference a given file")
  .argument("<file>", "Path to the file to find references to")
  .argument("[directory]", "Directory to search (default: current directory)")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action(refsToAction);

md.command("headers")
  .description("Extract headings from a markdown file with line numbers")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--max-depth <n>", "Maximum heading depth to include (1-6)", "6")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action(headersAction);

md.command("outline")
  .description("Show headings in an indented outline format")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--max-depth <n>", "Maximum heading depth to include (1-6)", "6")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action(outlineAction);

md.command("toc")
  .description("Generate a markdown table of contents from headings")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--max-depth <n>", "Maximum heading depth to include (1-6)", "6")
  .option("--min-depth <n>", "Minimum heading depth to include (1-6)", "1")
  .option("--ordered", "Use numbered lists instead of bullets", false)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action(tocAction);

md.command("stats")
  .description("Show document statistics (words, headings, links, code blocks)")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action(statsAction);

md.command("code-blocks")
  .description("List fenced code blocks with language and line ranges")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--lang <language>", "Filter by code block language")
  .option("--content", "Include code block content in output", false)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action(codeBlocksAction);

md.command("structure")
  .description("Show document structure skeleton (headings, code blocks, lists, math)")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action(structureAction);

md.command("links")
  .description("List all links with context, grouped by type")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--broken-only", "Only show broken links", false)
  .option("--type <type>", "Filter by type: internal, external, image, anchor")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All link targets exist (or not checked)\n  2  One or more broken links found",
  )
  .action(linksAction);

md.command("section")
  .description("Extract content of a section by heading text or slug")
  .argument("<file>", "Path to the markdown file")
  .argument("<heading>", "Heading text or anchor slug (case-insensitive)")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--no-include-heading", "Exclude the heading line from output")
  .option("--no-children", "Exclude nested subsections")
  .option("--raw", "Output raw markdown only (no metadata)", false)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  Section found and extracted\n  1  File not found or heading not found",
  )
  .action(sectionAction);

md.command("frontmatter")
  .description("Parse and display YAML frontmatter from a markdown file")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--key <key>", "Extract a specific key (dot notation for nested keys)")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  Frontmatter found (or no frontmatter)\n  1  File not found or key not found",
  )
  .action(frontmatterAction);

md.command("tasks")
  .description("Extract GFM task list items with completion status")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--status <status>", "Filter by status: done, pending")
  .option("--summary", "Show only summary counts", false)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action(tasksAction);

md.command("tables")
  .description("List or extract GFM tables with location and dimensions")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--content", "Include table content in output", false)
  .option("--index <n>", "Extract only the nth table (1-based)")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action(tablesAction);

md.command("check-urls")
  .description("Validate external URLs by making HTTP requests")
  .argument("<file>", "Path to the markdown file")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--timeout <ms>", "Request timeout per URL in milliseconds", "5000")
  .option("--concurrency <n>", "Maximum concurrent requests", "5")
  .option("--retry <n>", "Number of retries on failure", "1")
  .option("--include-ok", "Include successful URLs in output", false)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All URLs reachable (or no external URLs)\n  2  One or more URLs are broken",
  )
  .action(checkUrlsAction);

function collect(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}

md.command("orphans")
  .description("Find markdown files not referenced by any other markdown file")
  .argument("<directory>", "Directory to scan for markdown files")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--ignore <glob>", "Glob pattern to exclude (repeatable)", collect, [])
  .option("--entry <file>", "Entry-point file not considered orphan (repeatable)", collect, [])
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  No orphans found\n  2  One or more orphans found",
  )
  .action(orphansAction);

md.command("rename-heading")
  .description("Rename a heading and update all internal anchor references")
  .argument("<file>", "Path to the markdown file containing the heading")
  .argument("<old-heading>", "Current heading text (case-insensitive)")
  .argument("<new-heading>", "New heading text")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--directory <dir>", "Also update references in other files within this directory")
  .option("--dry-run", "Show what would change without modifying files", false)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  Heading renamed successfully (or dry-run completed)\n  1  File/heading not found or new heading slug already exists",
  )
  .action(renameHeadingAction);

program.parse(argv);
