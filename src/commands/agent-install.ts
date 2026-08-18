import type { AgentDiagnostic, AgentResult, AgentTarget } from "../agent/types.js";
import { loadBundle } from "../agent/parser.js";
import type { InstallReport } from "../agent/install/index.js";
import {
  commitInstall,
  installIsCurrent,
  planInstall,
  planToEntry,
} from "../agent/install/index.js";
import type { AgentOptions } from "./agent.js";
import { outputDecidedResult, resolveTargets } from "./agent.js";

export interface AgentInstallOptions extends AgentOptions {
  scope?: string;
  into?: string;
  link?: boolean;
  register?: boolean;
}

/**
 * Install's own pass/fail rule.
 *
 * Like package and doctor, this cannot use the shared `hasFindings`: a Codex
 * bundle inherently carries approximate render diagnostics, which say nothing
 * about whether the install landed. Notices (AB802, AB807) never fail.
 */
export function installHasFindings(diagnostics: AgentDiagnostic[], strict: boolean): boolean {
  return diagnostics.some(
    (item) => item.severity === "error" || (strict && item.severity === "warning"),
  );
}

export function requireInstallTarget(values: string[] | undefined): AgentTarget {
  const targets = resolveTargets(values, true);
  if (targets.length !== 1)
    throw new Error("Specify one target; install destinations differ per host.");
  return targets[0];
}

function artifactInfo(plan: ReturnType<typeof planInstall>): AgentResult["artifacts"] {
  return plan.artifacts.map((artifact) => ({
    path: artifact.path,
    bytes: artifact.content.length,
    mode: `0${(artifact.mode & 0o777).toString(8)}`,
    ...(artifact.origin === "native" ? { origin: artifact.origin } : {}),
  }));
}

export async function agentInstallAction(source: string, opts: AgentInstallOptions): Promise<void> {
  if (opts.check && opts.dryRun) throw new Error("--check and --dry-run cannot be used together");
  const target = requireInstallTarget(opts.target);
  const bundle = loadBundle(source);
  const plan = planInstall(bundle, target, {
    scope: opts.scope,
    into: opts.into,
    profile: opts.profile,
    link: opts.link,
    register: opts.register,
    force: opts.force,
  });
  const blocked = installHasFindings(plan.diagnostics, Boolean(opts.strict));
  const stale = Boolean(opts.check && plan.destination && !installIsCurrent(plan));
  if (!opts.dryRun && !opts.check && !blocked && plan.destination) commitInstall(plan);

  const report: InstallReport = { installs: plan.destination ? [planToEntry(plan)] : [] };
  outputDecidedResult(
    {
      command: "install",
      ok: !blocked && !stale,
      source: bundle.root,
      targets: [target],
      ...(plan.destination ? { profiles: [plan.profile] } : {}),
      artifacts: artifactInfo(plan),
      diagnostics: plan.diagnostics,
      install: report,
      ...(opts.dryRun ? { dryRun: true } : {}),
      ...(opts.check ? { check: true, stale } : {}),
    } satisfies AgentResult,
    opts,
  );
}
