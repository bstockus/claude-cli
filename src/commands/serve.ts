import { initializeRuntime, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { defaultLintConcurrency } from "../config.js";
import { resolveRoot } from "../serve/paths.js";
import { serveStdio } from "../serve/server.js";
import type { ServeContext } from "../serve/tools.js";

export interface ServeOptions {
  root: string;
  maxDocuments: string;
  concurrency: string;
}

const PROTOCOLS = ["mcp"];

/**
 * Upper bound on documents held in memory at once.
 *
 * Large enough that an ordinary workspace never evicts, small enough that a
 * server pointed at a huge tree cannot grow without limit.
 */
const DEFAULT_MAX_DOCUMENTS = 2048;

function bounded(value: string, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

export async function serveAction(protocol: string, opts: ServeOptions): Promise<void> {
  if (!PROTOCOLS.includes(protocol)) {
    process.stderr.write(
      `Error: Unknown protocol: ${protocol}. Supported: ${PROTOCOLS.join(", ")}\n`,
    );
    terminate(1);
  }

  const root = resolveRoot(opts.root);
  const config = runtime().config;

  // Reinstalls the runtime with a workspace suited to a long-lived process: the
  // document cache is bounded, and the shared on-disk index is left alone. That
  // index accumulates every parse until a flush and latches its load once, so
  // flushing at shutdown would rewrite a snapshot a concurrent `md index clear`
  // had already deleted. It has to replace the runtime's own workspace rather
  // than sit beside it, because library helpers reach for `runtime().workspace`.
  const { workspace } = initializeRuntime(config, {
    maxDocuments: bounded(opts.maxDocuments, "max-documents", DEFAULT_MAX_DOCUMENTS),
    persistIndex: false,
  });

  const context: ServeContext = {
    workspace,
    config,
    root,
    concurrency: bounded(opts.concurrency, "concurrency", defaultLintConcurrency()),
  };

  await serveStdio(context);
}
