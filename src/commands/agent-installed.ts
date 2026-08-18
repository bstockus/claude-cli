import type { AgentResult } from "../agent/types.js";
import { TARGETS } from "../agent/types.js";
import { listInstalled } from "../agent/install/index.js";
import type { AgentOptions } from "./agent.js";
import { outputDecidedResult, resolveTargets } from "./agent.js";

export interface AgentInstalledOptions extends AgentOptions {
  scope?: string;
  into?: string;
}

export async function agentInstalledAction(opts: AgentInstalledOptions): Promise<void> {
  const selected = resolveTargets(opts.target);
  const targets = selected.length ? selected : [...TARGETS];
  const installs = listInstalled(targets, { scope: opts.scope, into: opts.into });
  outputDecidedResult(
    {
      command: "installed",
      ok: true,
      targets,
      artifacts: [],
      diagnostics: [],
      install: { installs },
    } satisfies AgentResult,
    opts,
  );
}
