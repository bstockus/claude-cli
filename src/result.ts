import { COMMAND_CONTRACTS } from "./contract/registry.js";
import { CONTRACT_VERSION } from "./contract/version.js";
import { schemaUriFor } from "./contract/schemas/index.js";
import { packageName, packageVersion } from "./version.js";

export interface EmitOptions {
  /** Canonical command id, e.g. "md graph". */
  command: string;
  ok: boolean;
  exitCode: 0 | 1 | 2;
  /** When false or absent the payload is written exactly as it always was. */
  envelope?: boolean;
  /** Schema id for the wrapped payload; resolved to its canonical uri. */
  schema?: string | null;
  /** Optional command-specific counters. */
  summary?: Record<string, unknown>;
}

export interface ResultEnvelope {
  schemaVersion: string;
  tool: { name: string; version: string };
  command: string;
  ok: boolean;
  exitCode: 0 | 1 | 2;
  schema: string | null;
  data: unknown;
  summary?: Record<string, unknown>;
}

export function wrap(payload: unknown, opts: EmitOptions): ResultEnvelope {
  return {
    schemaVersion: CONTRACT_VERSION,
    tool: { name: packageName, version: packageVersion },
    command: opts.command,
    ok: opts.ok,
    exitCode: opts.exitCode,
    schema: schemaUriFor(opts.schema),
    data: payload,
    ...(opts.summary ? { summary: opts.summary } : {}),
  };
}

/**
 * Renders a JSON payload, optionally wrapped in the versioned envelope.
 *
 * Without `envelope` the output is byte-identical to a direct
 * `JSON.stringify(payload, null, 2)`, which is what keeps `--envelope` an
 * additive change rather than a breaking one.
 */
export function renderJson(payload: unknown, opts: EmitOptions): string {
  return JSON.stringify(opts.envelope ? wrap(payload, opts) : payload, null, 2) + "\n";
}

export function emitJson(
  payload: unknown,
  opts: EmitOptions,
  stream: NodeJS.WritableStream = process.stdout,
): void {
  stream.write(renderJson(payload, opts));
}

export interface Outcome {
  ok?: boolean;
  exitCode?: 0 | 1 | 2;
  summary?: Record<string, unknown>;
}

/**
 * Renders a command's JSON payload, looking its schema id up in the registry.
 *
 * This is the single place every `--format json` write site goes through, so
 * `--envelope` reaches all of them and the unenveloped bytes stay unchanged.
 */
export function jsonPayload(
  command: string,
  payload: unknown,
  opts: { envelope?: boolean },
  outcome: Outcome = {},
): string {
  const exitCode = outcome.exitCode ?? 0;
  return renderJson(payload, {
    command,
    ok: outcome.ok ?? exitCode === 0,
    exitCode,
    envelope: Boolean(opts.envelope),
    schema: COMMAND_CONTRACTS[command]?.outputSchema,
    summary: outcome.summary,
  });
}
