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
import { loadConfig, selectConfig, defaultLintConcurrency } from "./config.js";
import type { ResolvedConfig } from "./config.js";
import { commandOptions, initializeRuntime } from "./runtime.js";
import { CommandExit } from "./command-result.js";

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

let projectConfig: ResolvedConfig;
try {
  projectConfig =
    argv[2] === "md" ? loadConfig(selectConfig(argv.slice(2))) : loadConfig({ disabled: true });
  initializeRuntime(projectConfig);
} catch (error) {
  process.stderr.write(`Error: ${(error as Error).message}\n`);
  process.exit(1);
}

const explicitFormat = argv.some(
  (arg, index) =>
    arg.startsWith("--format=") ||
    arg === "-fh" ||
    arg === "-fj" ||
    (arg === "--format" && argv[index + 1]),
);
const mdIndex = argv.indexOf("md");
let configuredCommand: string | undefined;
for (let index = mdIndex + 1; mdIndex !== -1 && index < argv.length; index++) {
  if (argv[index] === "--config") {
    index++;
    continue;
  }
  if (argv[index].startsWith("--config=") || argv[index] === "--no-config") continue;
  if (!argv[index].startsWith("-")) {
    configuredCommand = argv[index];
    break;
  }
}
const configuredFormat =
  (configuredCommand ? projectConfig.commands[configuredCommand]?.format : undefined) ??
  projectConfig.output.format;
const notifierArgv =
  configuredFormat === "json" && !explicitFormat ? [...argv, "--format=json"] : argv;

// Reads the cached result and may schedule a detached refresh. Never blocks and
// never writes to a machine-readable stream — see src/update-notifier.ts.
installUpdateNotifier({
  currentVersion: version,
  packageName,
  argv: notifierArgv,
  entryPoint: fileURLToPath(import.meta.url),
});

const program = new Command()
  .name("claude-cli")
  .description("An agent-agnostic CLI toolkit for working with markdown files and related assets")
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
  .description("Agent-agnostic Markdown validation and analysis commands")
  .option("--config <file>", "Use a specific .claude-cli.yml configuration file")
  .option("--no-config", "Disable project configuration discovery")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  );

function common(command: Command): Command {
  return command
    .option("--format <fmt>", "Output format: llm, human, json")
    .option("--paths <style>", "Path display: absolute, relative");
}

common(md.command("lint"))
  .description("Run all checks on a single markdown file")
  .argument("<file>", "Path to the markdown file to validate")
  .option("-s, --style", "Include markdown style checks (markdownlint)")
  .option("--no-style", "Disable markdown style checks (markdownlint)")
  .option("--mermaid", "Enable Mermaid checks")
  .option("--no-mermaid", "Disable Mermaid checks")
  .option("--katex", "Enable KaTeX checks")
  .option("--no-katex", "Disable KaTeX checks")
  .option("--references", "Enable reference checks")
  .option("--no-references", "Disable reference checks")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All checks pass\n  2  One or more issues found",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    lintAction(
      file,
      commandOptions(
        "lint",
        {
          style: projectConfig.checks.markdownlint,
          mermaid: projectConfig.checks.mermaid,
          katex: projectConfig.checks.katex,
          references: projectConfig.checks.references,
        },
        opts,
      ) as never,
    ),
  );

common(md.command("lint-dir"))
  .description("Run all checks on all markdown files in a directory")
  .argument("[directory]", "Path to the directory to scan (default: workspace root)")
  .option("-s, --style", "Include markdown style checks (markdownlint)")
  .option("--no-style", "Disable markdown style checks (markdownlint)")
  .option("--mermaid", "Enable Mermaid checks")
  .option("--no-mermaid", "Disable Mermaid checks")
  .option("--katex", "Enable KaTeX checks")
  .option("--no-katex", "Disable KaTeX checks")
  .option("--references", "Enable reference checks")
  .option("--no-references", "Disable reference checks")
  .option("--summary", "Show one line per file with pass/fail and issue count")
  .option("--no-summary", "Disable summary output")
  .option("--concurrency <n>", "Maximum files checked concurrently")
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All files pass all checks\n  2  One or more issues found in any file",
  )
  .action((directory: string | undefined, opts: Record<string, unknown>) =>
    lintDirAction(
      directory ?? projectConfig.root,
      commandOptions(
        "lint-dir",
        {
          style: projectConfig.checks.markdownlint,
          summary: false,
          concurrency: String(defaultLintConcurrency()),
          include: projectConfig.files.include,
          exclude: projectConfig.files.exclude,
          mermaid: projectConfig.checks.mermaid,
          katex: projectConfig.checks.katex,
          references: projectConfig.checks.references,
        },
        opts,
      ) as never,
    ),
  );

common(md.command("refs"))
  .description("List all references from a markdown file and check if targets exist")
  .argument("<file>", "Path to the markdown file to inspect")
  .option("-e, --external", "Include external URLs")
  .option("--no-external", "Exclude external URLs")
  .option("-a, --anchors", "Include anchor-only references")
  .option("--no-anchors", "Exclude anchor-only references")
  .option("-i, --images", "Include image references")
  .option("--no-images", "Exclude image references")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All referenced targets exist\n  2  One or more targets missing",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    refsAction(
      file,
      commandOptions("refs", { external: false, anchors: false, images: false }, opts) as never,
    ),
  );

common(md.command("refs-to"))
  .description("Find all markdown files that reference a given file")
  .argument("<file>", "Path to the file to find references to")
  .argument("[directory]", "Directory to search (default: current directory)")
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action((file: string, directory: string | undefined, opts: Record<string, unknown>) =>
    refsToAction(
      file,
      directory ?? projectConfig.root,
      commandOptions(
        "refs-to",
        { include: projectConfig.files.include, exclude: projectConfig.files.exclude },
        opts,
      ) as never,
    ),
  );

common(md.command("headers"))
  .description("Extract headings from a markdown file with line numbers")
  .argument("<file>", "Path to the markdown file")
  .option("--max-depth <n>", "Maximum heading depth to include (1-6)")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    headersAction(file, commandOptions("headers", { maxDepth: "6" }, opts) as never),
  );

common(md.command("outline"))
  .description("Show headings in an indented outline format")
  .argument("<file>", "Path to the markdown file")
  .option("--max-depth <n>", "Maximum heading depth to include (1-6)")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    outlineAction(file, commandOptions("outline", { maxDepth: "6" }, opts) as never),
  );

common(md.command("toc"))
  .description("Generate a markdown table of contents from headings")
  .argument("<file>", "Path to the markdown file")
  .option("--max-depth <n>", "Maximum heading depth to include (1-6)")
  .option("--min-depth <n>", "Minimum heading depth to include (1-6)")
  .option("--ordered", "Use numbered lists instead of bullets")
  .option("--no-ordered", "Use bullet lists")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    tocAction(
      file,
      commandOptions("toc", { maxDepth: "6", minDepth: "1", ordered: false }, opts) as never,
    ),
  );

common(md.command("stats"))
  .description("Show document statistics (words, headings, links, code blocks)")
  .argument("<file>", "Path to the markdown file")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    statsAction(file, commandOptions("stats", {}, opts) as never),
  );

common(md.command("code-blocks"))
  .description("List fenced code blocks with language and line ranges")
  .argument("<file>", "Path to the markdown file")
  .option("--lang <language>", "Filter by code block language")
  .option("--content", "Include code block content in output")
  .option("--no-content", "Exclude code block content from output")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    codeBlocksAction(file, commandOptions("code-blocks", { content: false }, opts) as never),
  );

common(md.command("structure"))
  .description("Show document structure skeleton (headings, code blocks, lists, math)")
  .argument("<file>", "Path to the markdown file")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    structureAction(file, commandOptions("structure", {}, opts) as never),
  );

common(md.command("links"))
  .description("List all links with context, grouped by type")
  .argument("<file>", "Path to the markdown file")
  .option("--broken-only", "Only show broken links")
  .option("--no-broken-only", "Include valid links")
  .option("--type <type>", "Filter by type: internal, external, image, anchor")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All link targets exist (or not checked)\n  2  One or more broken links found",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    linksAction(file, commandOptions("links", { brokenOnly: false }, opts) as never),
  );

common(md.command("section"))
  .description("Extract content of a section by heading text or slug")
  .argument("<file>", "Path to the markdown file")
  .argument("<heading>", "Heading text or anchor slug (case-insensitive)")
  .option("--include-heading", "Include the heading line in output")
  .option("--no-include-heading", "Exclude the heading line from output")
  .option("--children", "Include nested subsections")
  .option("--no-children", "Exclude nested subsections")
  .option("--raw", "Output raw markdown only (no metadata)")
  .option("--no-raw", "Include section metadata")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  Section found and extracted\n  1  File not found or heading not found",
  )
  .action((file: string, heading: string, opts: Record<string, unknown>) =>
    sectionAction(
      file,
      heading,
      commandOptions(
        "section",
        { includeHeading: true, children: true, raw: false },
        opts,
      ) as never,
    ),
  );

common(md.command("frontmatter"))
  .description("Parse and display YAML frontmatter from a markdown file")
  .argument("<file>", "Path to the markdown file")
  .option("--key <key>", "Extract a specific key (dot notation for nested keys)")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  Frontmatter found (or no frontmatter)\n  1  File not found or key not found",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    frontmatterAction(file, commandOptions("frontmatter", {}, opts) as never),
  );

common(md.command("tasks"))
  .description("Extract GFM task list items with completion status")
  .argument("<file>", "Path to the markdown file")
  .option("--status <status>", "Filter by status: done, pending")
  .option("--summary", "Show only summary counts")
  .option("--no-summary", "Show individual tasks")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    tasksAction(file, commandOptions("tasks", { summary: false }, opts) as never),
  );

common(md.command("tables"))
  .description("List or extract GFM tables with location and dimensions")
  .argument("<file>", "Path to the markdown file")
  .option("--content", "Include table content in output")
  .option("--no-content", "Exclude table content from output")
  .option("--index <n>", "Extract only the nth table (1-based)")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    tablesAction(file, commandOptions("tables", { content: false }, opts) as never),
  );

common(md.command("check-urls"))
  .description("Validate external URLs by making HTTP requests")
  .argument("<file>", "Path to the markdown file")
  .option("--timeout <ms>", "Request timeout per URL in milliseconds")
  .option("--concurrency <n>", "Maximum concurrent requests")
  .option("--retry <n>", "Number of retries on failure")
  .option("--include-ok", "Include successful URLs in output")
  .option("--no-include-ok", "Exclude successful URLs from output")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All URLs reachable (or no external URLs)\n  2  One or more URLs are broken",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    checkUrlsAction(
      file,
      commandOptions(
        "check-urls",
        { timeout: "5000", concurrency: "5", retry: "1", includeOk: false },
        opts,
      ) as never,
    ),
  );

function collect(val: string, acc: string[] = []): string[] {
  acc.push(val);
  return acc;
}

common(md.command("orphans"))
  .description("Find markdown files not referenced by any other markdown file")
  .argument("[directory]", "Directory to scan (default: workspace root)")
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .option("--ignore <glob>", "Glob pattern to exclude (repeatable)", collect, [])
  .option("--entry <file>", "Entry-point file not considered orphan (repeatable)", collect, [])
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  No orphans found\n  2  One or more orphans found",
  )
  .action((directory: string | undefined, opts: Record<string, unknown>) =>
    orphansAction(
      directory ?? projectConfig.root,
      commandOptions(
        "orphans",
        {
          ignore: [],
          include: projectConfig.files.include,
          exclude: projectConfig.files.exclude,
          entry: projectConfig.files.entryPoints,
        },
        opts,
      ) as never,
    ),
  );

common(md.command("rename-heading"))
  .description("Rename a heading and update all internal anchor references")
  .argument("<file>", "Path to the markdown file containing the heading")
  .argument("<old-heading>", "Current heading text (case-insensitive)")
  .argument("<new-heading>", "New heading text")
  .option("--directory <dir>", "Also update references in other files within this directory")
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .option("--dry-run", "Show what would change without modifying files")
  .option("--no-dry-run", "Apply changes")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  Heading renamed successfully (or dry-run completed)\n  1  File/heading not found or new heading slug already exists",
  )
  .action((file: string, oldHeading: string, newHeading: string, opts: Record<string, unknown>) =>
    renameHeadingAction(
      file,
      oldHeading,
      newHeading,
      commandOptions(
        "rename-heading",
        {
          dryRun: false,
          include: projectConfig.files.include,
          exclude: projectConfig.files.exclude,
        },
        opts,
      ) as never,
    ),
  );

try {
  await program.parseAsync(argv);
} catch (error) {
  if (error instanceof CommandExit) {
    process.exitCode = error.exitCode;
  } else {
    process.stderr.write(`Error: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
