#!/usr/bin/env node

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
import { renameFileAction } from "./commands/rename-file.js";
import { graphAction } from "./commands/graph.js";
import { validateFrontmatterAction } from "./commands/validate-frontmatter.js";
import { auditAction } from "./commands/audit.js";
import { queryAction } from "./commands/query.js";
import { indexAction } from "./commands/index.js";
import { checkUpdateAction, refreshUpdateCacheAction } from "./commands/update-check.js";
import { installUpdateNotifier, CHECK_COMMAND, REFRESH_COMMAND } from "./update-notifier.js";
import { loadConfig, selectConfig, defaultLintConcurrency } from "./config.js";
import type { ResolvedConfig } from "./config.js";
import { commandOptions, initializeRuntime, runtime } from "./runtime.js";
import { CommandExit } from "./command-result.js";
import { collect } from "./option-utils.js";
import { formatsFor } from "./formats.js";
import { packageName, packageVersion as version } from "./version.js";
import {
  agentCompatAction,
  agentConvertAction,
  agentInspectAction,
  agentValidateAction,
  agentActionBoundary,
} from "./commands/agent.js";
import { agentSpecsAction } from "./commands/agent-specs.js";
import { agentDoctorAction } from "./commands/agent-doctor.js";
import { describeAction } from "./commands/describe.js";
import { schemaAction } from "./commands/schema.js";

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
  ["json", "jsonl", "sarif"].includes(String(configuredFormat)) && !explicitFormat
    ? [...argv, `--format=${String(configuredFormat)}`]
    : argv;

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

const agent = program
  .command("agent")
  .description("Convert and inspect portable agent bundles")
  .addHelpText(
    "after",
    "\nTargets: claude-code, codex, cursor, or all\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  );

agent
  .command("convert")
  .description("Convert an agent bundle into target-native artifacts")
  .argument("<source>", "Bundle root containing agent-bundle.yaml or a legacy Claude plugin")
  .requiredOption("--target <target>", "Target (repeatable, or all)", collect)
  .requiredOption("--output <dir>", "Output root")
  .option("--profile <profile>", "Output profile: plugin, project, both", "both")
  .option("--strict", "Treat approximations as blocking findings")
  .option("--force", "Replace nonempty selected destinations")
  .option("--dry-run", "Render fully without writing")
  .option("--check", "Compare generated bytes and modes without writing")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--envelope", "Wrap --format json output in the versioned result envelope")
  .addHelpText(
    "after",
    "\nExit codes:\n  0  Successful and lossless\n  1  Invocation or I/O error\n  2  Validation, compatibility, strict, or stale-output finding",
  )
  .action((source: string, opts: Parameters<typeof agentConvertAction>[1]) =>
    agentActionBoundary("convert", opts, () => agentConvertAction(source, opts)),
  );

agent
  .command("validate")
  .description("Validate an agent bundle without generating output")
  .argument("<source>", "Bundle root")
  .option("--target <target>", "Also validate target mappings (repeatable, or all)", collect)
  .option("--strict", "Treat approximations as blocking findings")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--envelope", "Wrap --format json output in the versioned result envelope")
  .action((source: string, opts: Parameters<typeof agentValidateAction>[1]) =>
    agentActionBoundary("validate", opts, () => agentValidateAction(source, opts)),
  );

agent
  .command("inspect")
  .description("Show the normalized bundle, references, overrides, and graph")
  .argument("<source>", "Bundle root")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--envelope", "Wrap --format json output in the versioned result envelope")
  .action((source: string, opts: Parameters<typeof agentInspectAction>[1]) =>
    agentActionBoundary("inspect", opts, () => agentInspectAction(source, opts)),
  );

agent
  .command("compat")
  .description("Show platform compatibility or analyze a bundle")
  .argument("[source]", "Optional bundle root")
  .option("--target <target>", "Target (repeatable, or all)", collect)
  .option("--strict", "Treat approximations as blocking findings")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--envelope", "Wrap --format json output in the versioned result envelope")
  .action((source: string | undefined, opts: Parameters<typeof agentCompatAction>[1]) =>
    agentActionBoundary("compat", opts, () => agentCompatAction(source, opts)),
  );

agent
  .command("doctor")
  .description("Check a bundle and generated output against the target conformance profiles")
  .argument("[source]", "Optional bundle root")
  .option("--target <target>", "Target (repeatable, or all)", collect)
  .option("--profile <profile>", "Output profile: plugin, project, both", "both")
  .option("--output <dir>", "Also check an existing generated output root")
  .option("--host-version <spec>", "Installed host version: <target>@<version>", collect)
  .option("--strict", "Treat warnings as blocking findings")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--envelope", "Wrap --format json output in the versioned result envelope")
  .addHelpText(
    "after",
    "\nRuns without a bundle: profile self-checks and host version reporting still apply.\nNever executes a host's own tooling, so results do not depend on what is installed.\n\nExit codes:\n  0  No blocking conformance findings\n  1  Invocation or I/O error\n  2  Profile, drift, host, or strict finding",
  )
  .action((source: string | undefined, opts: Parameters<typeof agentDoctorAction>[1]) =>
    agentActionBoundary("doctor", opts, () => agentDoctorAction(source, opts)),
  );

agent
  .command("specs")
  .description("Print the versioned target conformance profiles")
  .option("--target <target>", "Target (repeatable, or all)", collect)
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--envelope", "Wrap --format json output in the versioned result envelope")
  .addHelpText(
    "after",
    "\nThe profiles are the source of truth for target behavior; --format json is the\nform to depend on.\n\nExit codes:\n  0  Profiles written to stdout\n  1  Invocation error",
  )
  .action((opts: Parameters<typeof agentSpecsAction>[0]) =>
    agentActionBoundary("specs", opts, () => agentSpecsAction(opts)),
  );

program
  .command(CHECK_COMMAND)
  .description("Check whether a newer version of this CLI has been published")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .option("--envelope", "Wrap --format json output in the versioned result envelope")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nQueries the registry directly rather than using the 24h cache.\n\nExit codes:\n  0  Already on the latest version\n  1  Could not reach the registry\n  2  A newer version is available",
  )
  .action((opts: { format: string }) => checkUpdateAction(packageName, version, opts));

program
  .command("describe")
  .description("Describe the CLI contract: commands, options, exit codes, and output schemas")
  .argument("[command...]", "Optional command path, for example: md graph")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .addHelpText(
    "after",
    "\nExamples:\n  claude-cli describe --format json\n  claude-cli describe md graph --format json\n\nReports the static contract; project configuration is not applied.\n\nExit codes:\n  0  Description written to stdout\n  1  Unknown command path or invalid format",
  )
  .action((commandPath: string[], opts: { format: string }) =>
    describeAction(program, commandPath, {
      ...opts,
      toolName: packageName,
      toolVersion: version,
    }),
  );

program
  .command("schema")
  .description("Print a published output schema, or list the available schemas")
  .argument("[id]", "Schema id, for example: agent-result")
  .option("--format <fmt>", "Output format: llm, human, json", "llm")
  .addHelpText(
    "after",
    "\nWith an id, the schema document is written regardless of --format.\nSchema ids are identifiers, not fetchable URLs.\n\nExit codes:\n  0  Schema or index written to stdout\n  1  Unknown schema id or invalid format",
  )
  .action((id: string | undefined, opts: { format: string }) => schemaAction(id, opts));

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
  const formats = formatsFor(command.name()).join(", ");
  return command
    .option("--format <fmt>", `Output format: ${formats}`)
    .option("--envelope", "Wrap --format json output in the versioned result envelope")
    .option("--paths <style>", "Path display: absolute, relative")
    .option("--stdin-name <path>", "Logical workspace path for stdin input");
}

common(md.command("lint"))
  .description("Run all checks on a single markdown file or multiple Markdown inputs")
  .argument("<files...>", "Markdown files or globs to validate")
  .option("-s, --style", "Include markdown style checks (markdownlint)")
  .option("--no-style", "Disable markdown style checks (markdownlint)")
  .option("--mermaid", "Enable Mermaid checks")
  .option("--no-mermaid", "Disable Mermaid checks")
  .option("--katex", "Enable KaTeX checks")
  .option("--no-katex", "Disable KaTeX checks")
  .option("--references", "Enable reference checks")
  .option("--no-references", "Disable reference checks")
  .option("--changed-since <revision>", "Only files changed since a Git revision")
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All checks pass\n  2  One or more issues found",
  )
  .action((files: string[], opts: Record<string, unknown>) =>
    lintAction(
      files,
      commandOptions(
        "lint",
        {
          style: projectConfig.checks.markdownlint,
          mermaid: projectConfig.checks.mermaid,
          katex: projectConfig.checks.katex,
          references: projectConfig.checks.references,
          include: projectConfig.files.include,
          exclude: projectConfig.files.exclude,
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
  .option("--changed-since <revision>", "Only files changed since a Git revision")
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
  .option("--check", "Check marker-based TOC synchronization")
  .option("--write", "Update the content between TOC markers")
  .option("--dry-run", "Print the proposed marker block without writing")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json",
  )
  .action((file: string, opts: Record<string, unknown>) =>
    tocAction(
      file,
      commandOptions(
        "toc",
        { maxDepth: "6", minDepth: "1", ordered: false, check: false, write: false, dryRun: false },
        opts,
      ) as never,
    ),
  );

common(md.command("graph"))
  .description("Analyze the workspace Markdown document graph")
  .argument("[directory]", "Directory to scan (default: workspace root)")
  .option("--output <mode>", "Graph output: report, mermaid, dot")
  .option("--entry <file>", "Entry point for reachability (repeatable)", collect)
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .addHelpText(
    "after",
    "\nExit codes:\n  0  No broken or unreachable documents\n  2  Broken or unreachable documents found",
  )
  .action((directory: string | undefined, opts: Record<string, unknown>) =>
    graphAction(
      directory ?? projectConfig.root,
      commandOptions(
        "graph",
        {
          output: "report",
          entry: projectConfig.files.entryPoints,
          include: projectConfig.files.include,
          exclude: projectConfig.files.exclude,
        },
        opts,
      ) as never,
    ),
  );

common(md.command("validate-frontmatter"))
  .description("Validate Markdown frontmatter with schema and workspace rules")
  .argument("<paths...>", "Markdown files, directories, or globs")
  .option("--schema <file>", "JSON or YAML Schema file")
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .option("--changed-since <revision>", "Only files changed since a Git revision")
  .addHelpText(
    "after",
    "\nExit codes:\n  0  Frontmatter is valid\n  1  Configuration or schema error\n  2  Validation findings",
  )
  .action((target: string[], opts: Record<string, unknown>) =>
    validateFrontmatterAction(
      target,
      commandOptions(
        "validate-frontmatter",
        {
          schema: projectConfig.frontmatter.schema,
          include: projectConfig.files.include,
          exclude: projectConfig.files.exclude,
        },
        opts,
      ) as never,
    ),
  );

common(md.command("audit"))
  .description("Run composable checks across a Markdown workspace")
  .argument("[directory]", "Directory to scan (default: workspace root)")
  .option("--summary", "Show per-check and per-file counts")
  .option("--no-summary", "Show detailed findings")
  .option("--external", "Check external URLs")
  .option("--no-external", "Do not check external URLs")
  .option("--frontmatter", "Enable configured frontmatter checks")
  .option("--no-frontmatter", "Disable frontmatter checks")
  .option("--graph", "Enable graph checks")
  .option("--no-graph", "Disable graph checks")
  .option("--toc", "Enable configured TOC checks")
  .option("--no-toc", "Disable TOC checks")
  .option("-s, --style", "Include markdown style checks")
  .option("--no-style", "Disable markdown style checks")
  .option("--mermaid", "Enable Mermaid checks")
  .option("--no-mermaid", "Disable Mermaid checks")
  .option("--katex", "Enable KaTeX checks")
  .option("--no-katex", "Disable KaTeX checks")
  .option("--references", "Enable reference checks")
  .option("--no-references", "Disable reference checks")
  .option("--concurrency <n>", "Maximum concurrent checks")
  .option("--timeout <ms>", "External URL timeout")
  .option("--retry <n>", "External URL retry count")
  .option("--changed-since <revision>", "Only files changed since a Git revision")
  .option("--entry <file>", "Graph entry point (repeatable)", collect)
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .addHelpText(
    "after",
    "\nExit codes:\n  0  Audit passed\n  1  Operational error\n  2  Actionable findings",
  )
  .action((directory: string | undefined, opts: Record<string, unknown>) =>
    auditAction(
      directory ?? projectConfig.root,
      commandOptions(
        "audit",
        {
          summary: false,
          external: projectConfig.checks.external,
          frontmatter: projectConfig.checks.frontmatter,
          graph: projectConfig.checks.graph,
          toc: projectConfig.checks.toc,
          style: projectConfig.checks.markdownlint,
          mermaid: projectConfig.checks.mermaid,
          katex: projectConfig.checks.katex,
          references: projectConfig.checks.references,
          concurrency: String(defaultLintConcurrency()),
          timeout: "5000",
          retry: "1",
          entry: projectConfig.files.entryPoints,
          include: projectConfig.files.include,
          exclude: projectConfig.files.exclude,
          maxDepth: String(projectConfig.commands.toc?.maxDepth ?? "6"),
          minDepth: String(projectConfig.commands.toc?.minDepth ?? "1"),
          ordered: Boolean(projectConfig.commands.toc?.ordered ?? false),
        },
        opts,
      ) as never,
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
  .description("Validate external URLs across Markdown inputs")
  .argument("<inputs...>", "Markdown files, directories, globs, or -")
  .option("--timeout <ms>", "Request timeout per URL in milliseconds")
  .option("--concurrency <n>", "Maximum concurrent requests")
  .option("--retry <n>", "Number of retries on failure")
  .option("--include-ok", "Include successful URLs in output")
  .option("--no-include-ok", "Exclude successful URLs from output")
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .option("--changed-since <revision>", "Only files changed since a Git revision")
  .option("--ignore <glob>", "Ignore matching URL (repeatable)", collect)
  .option("--ignore-domain <domain>", "Ignore domain and subdomains (repeatable)", collect)
  .option("--allowed-status <code>", "Treat HTTP status as allowed (repeatable)", collect)
  .option("--cache", "Use the URL result cache")
  .option("--no-cache", "Disable the URL result cache")
  .option("--cache-ttl <ms>", "URL cache lifetime in milliseconds")
  .option("--head-fallback-status <code>", "HEAD status that triggers GET (repeatable)", collect)
  .option("--report-redirects", "Report redirects and final destinations")
  .option("--no-report-redirects", "Do not report redirects")
  .addHelpText(
    "after",
    "\nFormat shorthands:\n  -fh             Shorthand for --format=human\n  -fj             Shorthand for --format=json\n\nExit codes:\n  0  All URLs reachable (or no external URLs)\n  2  One or more URLs are broken",
  )
  .action((file: string[], opts: Record<string, unknown>) =>
    checkUrlsAction(
      file,
      commandOptions(
        "check-urls",
        {
          timeout: "5000",
          concurrency: "5",
          retry: "1",
          includeOk: false,
          include: projectConfig.files.include,
          exclude: projectConfig.files.exclude,
          ignore: projectConfig.urls.ignore,
          ignoreDomain: projectConfig.urls.ignoreDomains,
          allowedStatus: projectConfig.urls.allowedStatuses,
          cache: projectConfig.urls.cache,
          cacheTtl: String(projectConfig.urls.cacheTtl),
          headFallbackStatus: projectConfig.urls.headFallbackStatuses,
          reportRedirects: projectConfig.urls.reportRedirects,
        },
        opts,
      ) as never,
    ),
  );

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

common(md.command("query"))
  .description("Run a focused query across the Markdown workspace")
  .argument(
    "<kind>",
    "Query kind: links-to, duplicates, unused-assets, code-blocks, tasks, missing-h1",
  )
  .argument("[directory]", "Directory to query (default: workspace root)")
  .option("--target <path>", "Target path and optional heading fragment for links-to")
  .option("--field <field>", "Duplicate field: title, slug, heading-slug, frontmatter:<key>")
  .option("--lang <language>", "Code-block language filter")
  .option("--content", "Include code-block content")
  .option("--no-content", "Exclude code-block content")
  .option("--status <status>", "Task status: all, done, pending")
  .option("--summary", "Show task totals without individual tasks")
  .option("--no-summary", "Include individual tasks")
  .option("--asset-extension <ext>", "Asset extension override (repeatable)", collect)
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Workspace exclude glob (repeatable)", collect)
  .addHelpText("after", "\nQuery matches are informational and exit 0.")
  .action((kind: string, directory: string | undefined, opts: Record<string, unknown>) =>
    queryAction(
      kind,
      directory ?? projectConfig.root,
      commandOptions(
        "query",
        {
          include: projectConfig.files.include,
          exclude: projectConfig.files.exclude,
          field: "title",
          content: false,
          status: "all",
          summary: false,
          assetExtension: projectConfig.assets.extensions,
        },
        opts,
      ) as never,
    ),
  );

common(md.command("index"))
  .description("Inspect or manage the persistent workspace index")
  .argument("<action>", "Index action: status, build, clear")
  .argument("[directory]", "Directory to inspect or build (default: workspace root)")
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .addHelpText(
    "after",
    "\nActions:\n  status  Inspect cache coverage\n  build   Force a rebuild\n  clear   Clear this workspace cache",
  )
  .action((action: string, directory: string | undefined, opts: Record<string, unknown>) =>
    indexAction(
      action,
      directory ?? projectConfig.root,
      commandOptions(
        "index",
        { include: projectConfig.files.include, exclude: projectConfig.files.exclude },
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

common(md.command("rename-file"))
  .description("Move a workspace file and update Markdown references")
  .argument("<source>", "Existing Markdown document or referenced asset")
  .argument("<destination>", "New path (parent directory must exist)")
  .option("--include <glob>", "Markdown include glob (repeatable)", collect)
  .option("--exclude <glob>", "Markdown exclude glob (repeatable)", collect)
  .option("--dry-run", "Show changes without modifying files")
  .option("--no-dry-run", "Apply changes")
  .action((source: string, destination: string, opts: Record<string, unknown>) =>
    renameFileAction(
      source,
      destination,
      commandOptions(
        "rename-file",
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
runtime().workspace.flush();
