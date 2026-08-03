import type { OutputFormat } from "./types.js";

/** Every format the CLI can emit. */
export const ALL_FORMATS: readonly OutputFormat[] = ["llm", "human", "json", "jsonl", "sarif"];

/** Formats every command supports. */
export const BASE_FORMATS: readonly OutputFormat[] = ["llm", "human", "json"];

/**
 * `md` commands that additionally accept the automation formats. These emit
 * `Issue` diagnostics, which are the only payload jsonl and sarif can represent.
 */
export const DIAGNOSTIC_FORMAT_COMMANDS: readonly string[] = [
  "lint",
  "lint-dir",
  "audit",
  "validate-frontmatter",
  "check-urls",
];

export function supportsDiagnosticFormats(mdCommand: string): boolean {
  return DIAGNOSTIC_FORMAT_COMMANDS.includes(mdCommand);
}

/** Formats accepted by `md <mdCommand>`. */
export function formatsFor(mdCommand: string): readonly OutputFormat[] {
  return supportsDiagnosticFormats(mdCommand) ? ALL_FORMATS : BASE_FORMATS;
}

/**
 * `agent` subcommands that additionally accept SARIF.
 *
 * Deliberately not `ALL_FORMATS`: `jsonl`'s published `diagnostic-record`
 * schema is the `Issue` shape, which an `AgentDiagnostic` does not fit.
 */
export const AGENT_SARIF_COMMANDS: readonly string[] = ["audit"];

/** Formats accepted by `agent <agentCommand>`. */
export function agentFormatsFor(agentCommand: string): readonly OutputFormat[] {
  return AGENT_SARIF_COMMANDS.includes(agentCommand) ? [...BASE_FORMATS, "sarif"] : BASE_FORMATS;
}
