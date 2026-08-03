import type { Command } from "commander";
import { BASE_FORMATS } from "../formats.js";
import { buildDescription, selectCommands } from "../contract/describe.js";
import type { DescribeResult, DescribedCommand } from "../contract/describe.js";

export interface DescribeOptions {
  format: string;
  toolName: string;
  toolVersion: string;
}

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function renderCommand(command: DescribedCommand, human: boolean): string[] {
  const name = human ? `${BOLD}${command.id}${RESET}` : command.id;
  const lines = [name, `  ${command.description}`, `  usage: ${command.usage}`];
  if (command.formats?.length)
    lines.push(`  formats: ${command.formats.join(", ")} (default ${command.defaultFormat})`);
  if (command.outputSchema) lines.push(`  json schema: ${command.outputSchema}`);
  if (command.jsonlSchema) lines.push(`  jsonl schema: ${command.jsonlSchema}`);
  if (command.stream)
    lines.push(
      `  stream: ${command.stream.success} on success` +
        (command.stream.findings ? `, ${command.stream.findings} on findings` : ""),
    );
  if (command.writes) lines.push("  writes: may modify files");
  for (const exit of command.exitCodes) lines.push(`  exit ${exit.code}: ${exit.meaning}`);
  if (command.stability === "undeclared")
    lines.push(human ? `  ${DIM}contract: undeclared${RESET}` : "  contract: undeclared");
  if (command.notes) lines.push(`  note: ${command.notes}`);
  return lines;
}

function renderText(result: DescribeResult, human: boolean): string {
  const lines = [
    `${result.tool.name} ${result.tool.version}`,
    `contract schema version: ${result.schemaVersion}`,
    `format shorthands: ${Object.entries(result.formatShorthands)
      .map(([flag, value]) => `${flag} = ${value}`)
      .join(", ")}`,
    "",
    `update notice: ${result.machineStreams.description}`,
    ...result.machineStreams.suppressedWhen.map((condition) => `  suppressed when ${condition}`),
    "",
    `commands (${result.commands.length}):`,
    "",
  ];
  for (const command of result.commands) lines.push(...renderCommand(command, human), "");
  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Describes the CLI contract. Reports the static contract: project
 * configuration is deliberately not applied, so a consumer sees the same answer
 * regardless of the directory it runs in.
 */
export async function describeAction(
  program: Command,
  commandPath: string[],
  opts: DescribeOptions,
): Promise<void> {
  const format = opts.format || "llm";
  // A contract command must not silently substitute a format it was not asked for.
  if (!BASE_FORMATS.includes(format as (typeof BASE_FORMATS)[number]))
    throw new Error(`Invalid output format: ${format}`);
  const full = buildDescription(program, { name: opts.toolName, version: opts.toolVersion });
  const result = commandPath.length ? selectCommands(full, commandPath) : full;
  process.stdout.write(
    format === "json"
      ? JSON.stringify(result, null, 2) + "\n"
      : renderText(result, format === "human"),
  );
}
