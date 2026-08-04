import type { AgentDiagnostic, AgentResult } from "../agent/types.js";
import { loadBundle } from "../agent/parser.js";
import { runTests } from "../agent/test/index.js";
import type { AgentOptions } from "./agent.js";
import { outputDecidedResult, profiles, resolveTargets } from "./agent.js";

export interface AgentTestOptions extends AgentOptions {
  tests?: string;
  case?: string[];
}

/**
 * Test's own pass/fail rule.
 *
 * Like doctor, audit, import, upgrade, and package, this cannot use the shared
 * `hasFindings`, which fails on any approximate mapping — every Codex bundle
 * carries those, and they say nothing about whether an expectation held.
 *
 * Unlike audit it needs no per-code split: an unmet expectation is already an
 * error, so severity alone separates "a test failed" from "the render was
 * lossy". The one warning this command mints itself, `AB701`, is deliberately
 * non-blocking by default and blocking under `--strict`, which is how CI asks
 * "and there were tests, right?".
 */
export function testHasFindings(diagnostics: AgentDiagnostic[], strict: boolean): boolean {
  return diagnostics.some(
    (item) => item.severity === "error" || (strict && item.severity === "warning"),
  );
}

export async function agentTestAction(source: string, opts: AgentTestOptions): Promise<void> {
  const targets = resolveTargets(opts.target);
  const selectedProfiles = profiles(opts.profile);
  const bundle = loadBundle(source);
  const { report, diagnostics, forwarded } = runTests(bundle, {
    tests: opts.tests,
    targets,
    profiles: selectedProfiles,
    cases: opts.case ?? [],
  });

  // Bundle diagnostics lead, as in audit; `forwarded` already repeats them for
  // every tree that rendered, and the same rule `renderBundle` applies decides
  // the rest: an identical finding reached from two directions is one finding.
  const unique = [
    ...new Map(
      [...bundle.diagnostics, ...forwarded, ...diagnostics].map((item) => [
        JSON.stringify(item),
        item,
      ]),
    ).values(),
  ];

  outputDecidedResult(
    {
      command: "test",
      ok: !testHasFindings(unique, Boolean(opts.strict)),
      source: bundle.root,
      targets,
      profiles: selectedProfiles,
      artifacts: [],
      diagnostics: unique,
      test: report,
    } satisfies AgentResult,
    opts,
  );
}
