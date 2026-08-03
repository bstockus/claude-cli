import fs from "node:fs";
import path from "node:path";
import type { AgentDiagnostic, AgentResult, Artifact } from "../agent/types.js";
import { diagnostic } from "../agent/types.js";
import { loadBundle } from "../agent/parser.js";
import { renderBundle } from "../agent/render.js";
import { diffOutput, outputMatches } from "../agent/output.js";
import type { MarketplaceMode, PackageReport } from "../agent/package/index.js";
import {
  PACKAGE_REPORT,
  buildArchives,
  buildCatalogs,
  buildChecksums,
  buildSbom,
  checkAssets,
  checkCaseCollisions,
  checkExecutables,
  checkPinning,
} from "../agent/package/index.js";
import { TarPathTooLongError } from "../agent/package/tar.js";
import { packageName, packageVersion } from "../version.js";
import { writeArtifactsAtomically } from "../agent/writer.js";
import type { AgentOptions } from "./agent.js";
import { outputDecidedResult, profiles, resolveTargets } from "./agent.js";

export interface AgentPackageOptions extends AgentOptions {
  marketplace?: string;
  archive?: boolean;
  fromDist?: string;
}

const MODES = ["repo", "local", "none"] as const;

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveThroughExistingAncestors(candidate: string): string {
  let existing = candidate;
  while (!fs.existsSync(existing) && existing !== path.dirname(existing))
    existing = path.dirname(existing);
  return path.resolve(fs.realpathSync(existing), path.relative(existing, candidate));
}

/**
 * Package's own pass/fail rule.
 *
 * Like import and doctor, this cannot use the shared `hasFindings`: a codex
 * bundle inherently carries approximate render diagnostics, which would fail
 * every codex package regardless of its publish readiness.
 */
export function packageHasFindings(diagnostics: AgentDiagnostic[], strict: boolean): boolean {
  return diagnostics.some(
    (item) => item.severity === "error" || (strict && item.severity === "warning"),
  );
}

export async function agentPackageAction(source: string, opts: AgentPackageOptions): Promise<void> {
  if (opts.check && opts.dryRun) throw new Error("--check and --dry-run cannot be used together");
  if (!opts.output) throw new Error("--output is required");
  const targets = resolveTargets(opts.target, true);
  const selectedProfiles = profiles(opts.profile);
  const mode = (opts.marketplace ?? "repo") as MarketplaceMode;
  if (!MODES.includes(mode))
    throw new Error(`Unknown --marketplace '${mode}'. Use one of: ${MODES.join(", ")}.`);

  const bundle = loadBundle(source);
  const output = path.resolve(opts.output);
  if (isInside(fs.realpathSync(bundle.root), resolveThroughExistingAncestors(output)))
    throw new Error("Output directory must not be inside the bundle");

  // Rendering here rather than trusting an existing tree means the catalog and
  // checksums are provably derived from the source of truth. `convert` stays a
  // pure compiler; packaging adds no rendering logic of its own.
  const rendered = renderBundle(bundle, targets, selectedProfiles);
  const diagnostics: AgentDiagnostic[] = [...rendered.diagnostics];

  if (opts.fromDist) {
    // Verifying an existing tree is a separate question from building one: it
    // asks whether CI packaged what this bundle actually produces.
    const dist = path.resolve(opts.fromDist);
    if (!fs.existsSync(dist)) throw new Error(`--from-dist directory does not exist: ${dist}`);
    if (!outputMatches(diffOutput(dist, rendered.artifacts, targets, selectedProfiles)))
      diagnostics.push({
        ...diagnostic(
          "AB508",
          `The tree at ${dist} is not what this bundle produces`,
          "unsupported",
          { remediation: "Re-run agent convert, or package without --from-dist." },
        ),
        severity: "error",
      });
  }

  const catalogs = buildCatalogs(bundle, targets, selectedProfiles, mode);
  diagnostics.push(...catalogs.diagnostics);

  const payload = [...rendered.artifacts, ...catalogs.artifacts].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );

  diagnostics.push(
    ...checkAssets(bundle, targets, payload),
    ...checkExecutables(payload),
    ...checkCaseCollisions(payload),
    ...checkPinning(bundle),
  );

  let archives: PackageReport["archives"] = [];
  const extra: Artifact[] = [];
  if (opts.archive) {
    try {
      const built = buildArchives(bundle, payload, targets, selectedProfiles);
      extra.push(...built.artifacts);
      archives = built.archives;
    } catch (cause) {
      if (!(cause instanceof TarPathTooLongError)) throw cause;
      diagnostics.push({
        ...diagnostic("AB509", cause.message, "unsupported", {
          path: cause.path,
          remediation: "Shorten the path; ustar headers cannot express it.",
        }),
        severity: "error",
      });
    }
  }

  const withArchives = [...payload, ...extra];
  const checksums = buildChecksums(withArchives);
  const sbom = buildSbom(bundle, withArchives);

  const report: PackageReport = {
    catalogs: catalogs.entries,
    archives,
    checksums: checksums.path,
    sbom: sbom.path,
    checks: {
      failed: diagnostics.filter((item) => item.severity === "error").length,
      passed: diagnostics.filter((item) => item.severity !== "error").length,
    },
  };

  const all = [
    ...withArchives,
    checksums,
    sbom,
    {
      path: PACKAGE_REPORT,
      content: Buffer.from(
        JSON.stringify(
          { generator: { name: packageName, version: packageVersion }, ...report },
          null,
          2,
        ) + "\n",
      ),
      mode: 0o644,
    },
  ];

  const blocked = packageHasFindings(diagnostics, Boolean(opts.strict));
  const stale = opts.check ? !matchesPackage(output, all) : false;
  const readOnly = Boolean(opts.dryRun) || Boolean(opts.check);
  if (!readOnly && !blocked)
    writeArtifactsAtomically(output, all, {
      managedRoots: targets.flatMap((target) =>
        selectedProfiles.map((profile) => path.join(target, profile)),
      ),
      looseFiles: all
        .filter((artifact) => !/^[^/]+\/(plugin|project)\//.test(artifact.path))
        .map((artifact) => artifact.path),
      force: Boolean(opts.force),
    });

  outputDecidedResult(
    {
      command: "package",
      ok: !blocked && !stale,
      source: bundle.root,
      targets,
      profiles: selectedProfiles,
      artifacts: all.map((artifact) => ({
        path: artifact.path,
        bytes: artifact.content.length,
        mode: `0${artifact.mode.toString(8)}`,
        ...(artifact.origin === "native" ? { origin: artifact.origin } : {}),
      })),
      diagnostics,
      package: report,
      ...(opts.dryRun ? { dryRun: true } : {}),
      ...(opts.check ? { check: true, stale } : {}),
    } satisfies AgentResult,
    opts,
  );
}

/**
 * Compares a package tree against what this run would produce.
 *
 * The report is compared by existence only — it embeds the generator version,
 * so byte-comparing it would call every package stale after a CLI upgrade.
 * Same rule `diffOutput` applies to `conversion-report.json`.
 */
function matchesPackage(output: string, artifacts: Artifact[]): boolean {
  for (const artifact of artifacts) {
    const file = path.join(output, artifact.path);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    if (artifact.path === PACKAGE_REPORT) continue;
    if (!fs.readFileSync(file).equals(artifact.content)) return false;
  }
  return true;
}
