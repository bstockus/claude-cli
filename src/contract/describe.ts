import type { Argument, Command, Option } from "commander";
import { collect } from "../option-utils.js";
import { NOTIFIER_CONTRACT } from "../update-notifier.js";
import { COMMAND_CONTRACTS } from "./registry.js";
import { SCHEMAS } from "./schemas/index.js";
import { CONTRACT_VERSION } from "./version.js";
import type { ContractStream, ExitCodeMeaning } from "./types.js";

export interface DescribedArgument {
  name: string;
  required: boolean;
  variadic: boolean;
  description: string;
  default?: unknown;
}

export interface DescribedOption {
  flags: string;
  long: string | null;
  short: string | null;
  description: string;
  valueName: string | null;
  valueRequired: boolean;
  valueOptional: boolean;
  mandatory: boolean;
  variadic: boolean;
  negated: boolean;
  repeatable: boolean;
  default?: unknown;
}

export interface DescribedCommand {
  id: string;
  path: string[];
  description: string;
  usage: string;
  arguments: DescribedArgument[];
  options: DescribedOption[];
  subcommands: string[];
  formats: string[] | null;
  defaultFormat: string | null;
  formatConfigurable: boolean;
  outputSchema: string | null;
  jsonlSchema?: string | null;
  sarifSchema?: string | null;
  exitCodes: ExitCodeMeaning[];
  stream: { success: ContractStream; findings?: ContractStream } | null;
  writes: boolean | null;
  stability: "stable" | "experimental" | "undeclared";
  notes?: string;
}

export interface DescribeResult {
  schemaVersion: string;
  tool: { name: string; version: string };
  formatShorthands: Record<string, string>;
  machineStreams: typeof NOTIFIER_CONTRACT;
  schemas: Array<{ id: string; uri: string; title: string; commands: string[] }>;
  commands: DescribedCommand[];
}

const VALUE_NAME = /[<[]([^>\]]+)[>\]]/;

function describeOption(option: Option): DescribedOption {
  return {
    flags: option.flags,
    long: option.long ?? null,
    short: option.short ?? null,
    description: option.description,
    valueName: VALUE_NAME.exec(option.flags)?.[1] ?? null,
    valueRequired: Boolean(option.required),
    valueOptional: Boolean(option.optional),
    mandatory: Boolean(option.mandatory),
    variadic: Boolean(option.variadic),
    negated: Boolean(option.negate),
    // Repeatable options accumulate through `collect`; comparing by identity
    // avoids inferring repeatability from description text.
    repeatable: option.parseArg === collect,
    ...(option.defaultValue === undefined ? {} : { default: option.defaultValue }),
  };
}

function describeArgument(argument: Argument): DescribedArgument {
  return {
    name: argument.name(),
    required: argument.required,
    variadic: argument.variadic,
    description: argument.description,
    ...(argument.defaultValue === undefined ? {} : { default: argument.defaultValue }),
  };
}

/**
 * Walks the commander tree for the mechanical facts, which cannot drift, and
 * merges the registry for the semantic ones commander cannot know: exit code
 * meanings, stream assignment, schema ids, and whether a command writes.
 *
 * A command with no registry entry is reported as `undeclared` rather than
 * throwing — a user should not get a crash because a contract row is missing.
 * `tests/e2e/contract.test.ts` fails on it instead, in both directions.
 */
export function walkCommands(program: Command): DescribedCommand[] {
  const described: DescribedCommand[] = [];
  const visit = (command: Command, path: string[]): void => {
    // visibleCommands is the public accessor that already excludes hidden
    // commands such as the internal cache refresh.
    const children = command
      .createHelp()
      .visibleCommands(command)
      .filter((child) => child.name() !== "help");
    if (path.length) {
      const id = path.join(" ");
      const contract = COMMAND_CONTRACTS[id];
      described.push({
        id,
        path,
        description: command.description(),
        usage: `${program.name()} ${path.join(" ")} ${command.usage()}`.trim(),
        arguments: command.registeredArguments.map(describeArgument),
        options: command.options.filter((option) => !option.hidden).map(describeOption),
        subcommands: children.map((child) => [...path, child.name()].join(" ")),
        formats: contract ? [...contract.formats] : null,
        defaultFormat: contract?.defaultFormat ?? null,
        formatConfigurable: contract?.formatConfigurable ?? false,
        outputSchema: contract?.outputSchema ?? null,
        jsonlSchema: contract?.jsonlSchema ?? null,
        sarifSchema: contract?.sarifSchema ?? null,
        exitCodes: contract?.exitCodes ?? [],
        stream: contract?.stream ?? null,
        writes: contract?.writes ?? null,
        stability: contract?.stability ?? "undeclared",
        ...(contract?.notes ? { notes: contract.notes } : {}),
      });
    }
    for (const child of children) visit(child, [...path, child.name()]);
  };
  visit(program, []);
  return described;
}

export function buildDescription(
  program: Command,
  tool: { name: string; version: string },
): DescribeResult {
  return {
    schemaVersion: CONTRACT_VERSION,
    tool,
    formatShorthands: { "-fh": "--format=human", "-fj": "--format=json" },
    machineStreams: NOTIFIER_CONTRACT,
    schemas: SCHEMAS.map(({ id, uri, title, commands }) => ({ id, uri, title, commands })),
    commands: walkCommands(program),
  };
}

/** Narrows a description to one command path and its descendants. */
export function selectCommands(result: DescribeResult, path: string[]): DescribeResult {
  const id = path.join(" ");
  const commands = result.commands.filter(
    (command) => command.id === id || command.id.startsWith(`${id} `),
  );
  if (!commands.length) throw new Error(`Unknown command: ${id}`);
  return { ...result, commands };
}
