import { TARGETS } from "../agent/types.js";
import { specsPayload } from "../agent/targets/index.js";
import type { AgentOptions } from "./agent.js";
import { outputResult, resolveTargets } from "./agent.js";

export type AgentSpecsOptions = Pick<AgentOptions, "target" | "format">;

/**
 * Publishes the versioned target conformance profiles. This is the machine
 * readable form of the compatibility information `agent compat` summarizes.
 */
export async function agentSpecsAction(opts: AgentSpecsOptions): Promise<void> {
  const selected = resolveTargets(opts.target);
  const targets = selected.length ? selected : [...TARGETS];
  outputResult(
    {
      command: "specs",
      ok: true,
      targets,
      artifacts: [],
      diagnostics: [],
      specs: specsPayload(targets),
    },
    opts,
  );
}
