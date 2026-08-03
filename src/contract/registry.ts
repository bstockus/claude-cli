import { BASE_FORMATS, formatsFor } from "../formats.js";
import { SARIF_SCHEMA_URI } from "./version.js";
import type { CommandContract, ExitCodeMeaning } from "./types.js";

const OK = (meaning: string): ExitCodeMeaning => ({ code: 0, meaning });
const USAGE: ExitCodeMeaning = { code: 1, meaning: "Invocation, I/O, or configuration error" };
const FINDINGS = (meaning: string): ExitCodeMeaning => ({ code: 2, meaning });

/** A read-only `md` command whose payload always goes to stdout. */
function inspection(name: string, extra: Partial<CommandContract> = {}): CommandContract {
  return {
    id: `md ${name}`,
    formats: formatsFor(name),
    defaultFormat: "llm",
    formatConfigurable: true,
    outputSchema: null,
    exitCodes: [OK("Output written to stdout"), USAGE],
    stream: { success: "stdout" },
    writes: false,
    stability: "stable",
    ...extra,
  };
}

/** A `md` command that reports findings on stderr and exits 2. */
function diagnostic(
  name: string,
  findings: string,
  extra: Partial<CommandContract> = {},
): CommandContract {
  return {
    id: `md ${name}`,
    formats: formatsFor(name),
    defaultFormat: "llm",
    formatConfigurable: true,
    outputSchema: null,
    exitCodes: [OK("No findings"), USAGE, FINDINGS(findings)],
    stream: { success: "stdout", findings: "stderr" },
    writes: false,
    stability: "stable",
    ...extra,
  };
}

function agentCommand(name: string, extra: Partial<CommandContract> = {}): CommandContract {
  return {
    id: `agent ${name}`,
    formats: BASE_FORMATS,
    defaultFormat: "llm",
    formatConfigurable: false,
    outputSchema: "agent-result",
    exitCodes: [OK("No blocking findings"), USAGE, FINDINGS("Blocking findings")],
    stream: { success: "stdout", findings: "stdout" },
    writes: false,
    stability: "stable",
    notes: "All output goes to stdout, including the failure result for an invocation error.",
    ...extra,
  };
}

const AUTOMATION = { jsonlSchema: "diagnostic-record", sarifSchema: SARIF_SCHEMA_URI };

const CONTRACTS: CommandContract[] = [
  // Top level
  {
    id: "check-update",
    formats: BASE_FORMATS,
    defaultFormat: "llm",
    formatConfigurable: false,
    outputSchema: "check-update",
    exitCodes: [
      OK("Already on the latest version"),
      { code: 1, meaning: "Could not reach the registry" },
      FINDINGS("A newer version is available"),
    ],
    stream: { success: "stdout", findings: "stderr" },
    writes: false,
    stability: "stable",
    notes:
      "Queries the registry directly rather than using the cache. An unreachable registry writes the error form to stderr; an available update writes the success form to stdout and exits 2.",
  },
  {
    id: "describe",
    formats: BASE_FORMATS,
    defaultFormat: "llm",
    formatConfigurable: false,
    outputSchema: "describe",
    exitCodes: [
      OK("Description written to stdout"),
      { code: 1, meaning: "Unknown command path or invalid format" },
    ],
    stream: { success: "stdout" },
    writes: false,
    stability: "stable",
    notes: "Reports the static contract; project configuration is not applied.",
  },
  {
    id: "schema",
    formats: BASE_FORMATS,
    defaultFormat: "llm",
    formatConfigurable: false,
    outputSchema: "schema-list",
    exitCodes: [
      OK("Schema or index written to stdout"),
      { code: 1, meaning: "Unknown schema id or invalid format" },
    ],
    stream: { success: "stdout" },
    writes: false,
    stability: "stable",
    notes:
      "With an id, the schema document is written regardless of --format; --format only affects the index listing.",
  },

  // Agent
  agentCommand("convert", {
    writes: true,
    exitCodes: [
      OK("Successful and lossless"),
      USAGE,
      FINDINGS("Validation, compatibility, strict, or stale-output finding"),
    ],
    notes:
      "All output goes to stdout, including failures. A non-strict conversion may write usable artifacts and still exit 2.",
  }),
  agentCommand("validate"),
  agentCommand("inspect", {
    exitCodes: [OK("Bundle inspected"), USAGE, FINDINGS("Bundle findings")],
  }),
  agentCommand("compat"),
  agentCommand("doctor", {
    exitCodes: [
      OK("No blocking conformance findings"),
      USAGE,
      FINDINGS("Profile, drift, host, or strict finding"),
    ],
    notes:
      "All output goes to stdout. An approximate mapping alone does not fail doctor, unlike convert and validate.",
  }),
  agentCommand("specs", {
    exitCodes: [OK("Profiles written to stdout"), USAGE],
    stream: { success: "stdout" },
    notes: "All output goes to stdout. Prints static data, so it never reports findings.",
  }),

  // Markdown: validation
  diagnostic("lint", "One or more issues found", {
    outputSchema: "issue-list",
    ...AUTOMATION,
  }),
  diagnostic("lint-dir", "One or more issues found in any file", {
    outputSchema: "issue-list",
    ...AUTOMATION,
    notes:
      "--summary --format json emits the lint-dir-summary shape instead of a finding list. 'No markdown files found' is reported on stdout with exit 0.",
  }),
  diagnostic("validate-frontmatter", "Validation findings", {
    outputSchema: "issue-list",
    ...AUTOMATION,
    exitCodes: [OK("Frontmatter is valid"), USAGE, FINDINGS("Validation findings")],
  }),
  diagnostic("audit", "Actionable findings", {
    outputSchema: "md-audit",
    ...AUTOMATION,
    notes:
      "The jsonl and sarif forms carry only the findings; the totals and graph summary have no representation in them.",
  }),
  diagnostic("check-urls", "One or more URLs are broken", {
    outputSchema: "md-check-urls",
    ...AUTOMATION,
    notes: "The `file` key is present only when exactly one input file was checked.",
  }),

  // Markdown: references and graph
  diagnostic("refs", "One or more targets missing"),
  inspection("refs-to"),
  diagnostic("links", "One or more broken links found", {
    outputSchema: "issue-list",
    notes:
      "--format json writes to stdout and returns before the broken-link check, so it exits 0 even when broken links exist. Changing this would be a breaking change.",
  }),
  diagnostic("orphans", "One or more orphans found", { outputSchema: "md-orphans" }),
  diagnostic("graph", "Broken or unreachable documents found", {
    outputSchema: "md-graph",
    notes:
      "--output mermaid|dot writes the diagram to stdout regardless of exit status and ignores --format.",
  }),

  // Markdown: document inspection
  inspection("headers"),
  inspection("outline"),
  inspection("stats"),
  inspection("structure"),
  inspection("code-blocks"),
  inspection("tasks"),
  inspection("tables"),
  inspection("section", {
    exitCodes: [
      OK("Section found and extracted"),
      { code: 1, meaning: "File or heading not found" },
    ],
    notes: "--raw writes markdown to stdout regardless of --format.",
  }),
  inspection("frontmatter", {
    exitCodes: [
      OK("Frontmatter found, or none present"),
      { code: 1, meaning: "File not found or key not found" },
    ],
    notes: "--key --format json emits the raw extracted value, which may be a scalar or null.",
  }),
  inspection("toc", {
    writes: true,
    exitCodes: [
      OK("Table of contents current, or written"),
      USAGE,
      FINDINGS("--check found a stale table of contents"),
    ],
    stream: { success: "stdout", findings: "stderr" },
    notes:
      "Emits a different shape per mode: --write, --dry-run, --check, and the default listing. Only --write modifies files.",
  }),

  // Markdown: workspace data
  inspection("query", { outputSchema: "md-query" }),
  inspection("index", {
    outputSchema: "md-index",
    writes: true,
    notes: "Writes only the workspace cache, never workspace files.",
  }),

  // Markdown: refactoring
  inspection("rename-heading", {
    writes: true,
    exitCodes: [
      OK("Heading renamed, or dry run completed"),
      { code: 1, meaning: "File or heading not found, or the new slug already exists" },
    ],
  }),
  inspection("rename-file", {
    writes: true,
    exitCodes: [
      OK("File renamed, or dry run completed"),
      { code: 1, meaning: "Source not found, or the destination already exists" },
    ],
  }),
];

export const COMMAND_CONTRACTS: Readonly<Record<string, CommandContract>> = Object.fromEntries(
  CONTRACTS.map((contract) => [contract.id, contract]),
);
