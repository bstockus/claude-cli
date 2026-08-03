import type { Command } from "commander";
import { BASE_FORMATS } from "../formats.js";
import type { OutputFormat } from "../types.js";
import { SHELLS, buildModel, type Shell } from "../completion/model.js";
import { generateCompletion } from "../completion/shells.js";

export interface CompletionOptions {
  format: string;
  toolName: string;
  toolVersion: string;
}

/**
 * Writes a shell completion script to stdout.
 *
 * `--format` is validated but does not change the output, matching
 * `schema <id>`: the script *is* the payload, and there is no JSON form of it
 * worth publishing — `describe --format json` already emits the same command
 * tree this is generated from.
 */
export function completionAction(
  program: Command,
  shell: string | undefined,
  opts: CompletionOptions,
): void {
  if (!BASE_FORMATS.includes(opts.format as OutputFormat))
    throw new Error(`Invalid output format: ${opts.format}`);
  if (!shell || !SHELLS.includes(shell as Shell))
    throw new Error(`Unknown shell: ${shell ?? ""}. Supported: ${SHELLS.join(", ")}`);
  const model = buildModel(program, { name: opts.toolName, version: opts.toolVersion });
  process.stdout.write(generateCompletion(model, shell as Shell));
}
