import crypto from "node:crypto";
import path from "node:path";
import type { AgentDiagnostic, AgentResult, Artifact } from "../agent/types.js";
import { loadBundle } from "../agent/parser.js";
import { renderBundle } from "../agent/render.js";
import {
  classify,
  checkCaseCollisions,
  checkExecutables,
  checkPinning,
} from "../agent/package/index.js";
import type { AuditReport } from "../agent/audit/index.js";
import {
  AUDIT_CODES,
  AUDIT_LIMITATIONS,
  BASELINE_CHECKS,
  RENDERED_CHECKS,
  SOURCE_CHECKS,
  buildSourceInventory,
  checkCapabilities,
  checkCommands,
  checkInventory,
  checkManifestClaims,
  checkMcp,
  checkPolicies,
  checkRendered,
  collectCommands,
  binaryKind,
} from "../agent/audit/index.js";
import type { AuditBaseline } from "../agent/audit/baseline.js";
import { diffBaseline, readBaseline } from "../agent/audit/baseline.js";
import type { AgentOptions } from "./agent.js";
import { outputDecidedResult, profiles, resolveTargets } from "./agent.js";

export interface AgentAuditOptions extends AgentOptions {
  baseline?: string;
}

/**
 * Audit's own pass/fail rule.
 *
 * Like package, doctor, and import, this cannot use the shared `hasFindings`:
 * audit forwards the render diagnostics, which are approximate for every codex
 * bundle and say nothing about what a reviewer should inspect.
 *
 * It also cannot simply copy `packageHasFindings`. Almost every review finding
 * is a warning by design — "look at this", not "this is broken" — so a rule that
 * only blocked on errors would let a bundle embedding a literal credential exit
 * 0, and audit would be useless as a CI gate. The rule is therefore split by
 * origin: a warning audit *found* blocks, a warning it *forwarded* does not
 * unless `--strict` says so.
 */
export function auditHasFindings(diagnostics: AgentDiagnostic[], strict: boolean): boolean {
  return diagnostics.some(
    (item) =>
      item.severity === "error" ||
      (item.severity === "warning" && (strict || AUDIT_CODES.has(item.code))),
  );
}

function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function agentAuditAction(source: string, opts: AgentAuditOptions): Promise<void> {
  const targets = resolveTargets(opts.target);
  const selectedProfiles = profiles(opts.profile);
  if (opts.baseline && !targets.length)
    throw new Error(
      "--baseline requires --target: baseline paths are package-relative, so there is nothing to compare without a rendered tree",
    );

  const bundle = loadBundle(source);
  const files = buildSourceInventory(bundle);
  const commands = collectCommands(bundle);
  const inventory: Artifact[] = files.map((file) => ({
    path: file.path,
    content: file.content,
    mode: file.mode,
  }));

  const diagnostics: AgentDiagnostic[] = [
    ...bundle.diagnostics,
    // Reused verbatim from the packager rather than reimplemented: one
    // condition must keep one diagnostic ID whichever command surfaces it.
    ...checkExecutables(inventory),
    ...checkCaseCollisions(inventory),
    ...checkPinning(bundle),
    ...checkCommands(commands, bundle),
    ...checkMcp(bundle),
    ...checkPolicies(bundle),
    ...checkCapabilities(bundle),
    ...checkInventory(bundle, files),
    ...checkManifestClaims(bundle),
  ];

  const checks = [...SOURCE_CHECKS];
  let rendered: Artifact[] = [];
  if (targets.length) {
    const result = renderBundle(bundle, targets, selectedProfiles);
    rendered = result.artifacts;
    diagnostics.push(...result.diagnostics);
    diagnostics.push(...checkRendered(bundle, rendered, targets, selectedProfiles));
    checks.push(...RENDERED_CHECKS);
  }

  let baseline: AuditBaseline | undefined;
  if (opts.baseline) {
    const file = path.resolve(opts.baseline);
    const diff = diffBaseline(readBaseline(file), file, rendered, targets, selectedProfiles);
    diagnostics.push(...diff.diagnostics);
    baseline = diff.report;
    checks.push(...BASELINE_CHECKS);
  }

  // Same rule `renderBundle` applies: an identical finding reached from two
  // directions is one finding.
  const unique = [...new Map(diagnostics.map((item) => [JSON.stringify(item), item])).values()];

  const report: AuditReport = {
    checks: checks.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    counts: {
      error: unique.filter((item) => item.severity === "error").length,
      warning: unique.filter((item) => item.severity === "warning").length,
      notice: unique.filter((item) => item.severity === "notice").length,
    },
    surface: {
      hooks: commands.filter((item) => item.origin === "hook").length,
      mcpServers: new Set(commands.filter((item) => item.origin === "mcp").map((item) => item.name))
        .size,
      policies: bundle.policies.length,
      files: files.length,
      executables: files.filter((file) => (file.mode & 0o111) !== 0).length,
      symlinks: 0,
      binaries: files.filter((file) => binaryKind(file.content) !== null).length,
      bytes: files.reduce((total, file) => total + file.content.length, 0),
    },
    executables: inventory
      .filter((artifact) => (artifact.mode & 0o111) !== 0)
      .map((artifact) => ({
        path: artifact.path,
        mode: `0${artifact.mode.toString(8)}`,
        sha256: sha256(artifact.content),
        kind: classify(artifact),
      })),
    commands,
    ...(baseline ? { baseline } : {}),
    limitations: AUDIT_LIMITATIONS,
  };
  report.surface.symlinks = unique.filter((item) => item.code === "AB630").length;

  outputDecidedResult(
    {
      command: "audit",
      ok: !auditHasFindings(unique, Boolean(opts.strict)),
      source: bundle.root,
      targets,
      ...(targets.length ? { profiles: selectedProfiles } : {}),
      artifacts: [],
      diagnostics: unique,
      audit: report,
    } satisfies AgentResult,
    opts,
  );
}
