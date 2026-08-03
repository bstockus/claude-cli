import fs from "node:fs";
import path from "node:path";
import type { AgentDiagnostic, AgentResult, Artifact, SourceFile } from "../agent/types.js";
import { diagnostic } from "../agent/types.js";
import { resolveLayout } from "../agent/import/detect.js";
import type { Disposition, ImportProvenance, ImportReport } from "../agent/import/normalize.js";
import { normalizeTree } from "../agent/import/normalize.js";
import { packageName, packageVersion } from "../version.js";
import { writeArtifactsAtomically } from "../agent/writer.js";
import type { AgentOptions } from "./agent.js";
import { outputDecidedResult } from "./agent.js";

export interface AgentImportOptions extends AgentOptions {
  from?: string;
  scope?: string;
  merge?: string;
  bundleName?: string;
  nativeOnly?: boolean;
}

/** File name of the migration report written at the bundle root. */
export const IMPORT_REPORT = "import-report.json";

const MERGE_STRATEGIES = ["refuse", "skip-existing", "overwrite", "native-only"] as const;
type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

function walk(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  const visit = (current: string): void => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const real = fs.realpathSync(full);
        const relative = path.relative(fs.realpathSync(root), real);
        if (relative.startsWith("..") || path.isAbsolute(relative))
          throw new Error(`Symlink escapes the import source: ${full}`);
      }
      if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory()))
        visit(full);
      else
        files.push({
          path: path.relative(root, full),
          content: fs.readFileSync(full),
          mode: fs.statSync(full).mode & 0o777,
        });
    }
  };
  visit(root);
  return files;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Real-paths a destination that does not exist yet.
 *
 * Comparing an unresolved path against a resolved source root would miss the
 * containment violation entirely wherever a parent is a symlink — `/var` on
 * macOS, for one.
 */
function resolveThroughExistingAncestors(candidate: string): string {
  let existing = candidate;
  while (!fs.existsSync(existing) && existing !== path.dirname(existing))
    existing = path.dirname(existing);
  return path.resolve(fs.realpathSync(existing), path.relative(existing, candidate));
}

function nonempty(directory: string): boolean {
  if (!fs.existsSync(directory)) return false;
  return !fs.statSync(directory).isDirectory() || fs.readdirSync(directory).length > 0;
}

function error(code: string, message: string, remediation?: string): AgentDiagnostic {
  return {
    ...diagnostic(code, message, "unsupported", remediation ? { remediation } : {}),
    severity: "error",
  };
}

/**
 * Import's own pass/fail rule.
 *
 * The shared `hasFindings` treats any approximate mapping as blocking, which
 * would make nearly every import exit 2 — approximations are the expected
 * outcome of crossing from a native format back to a portable one. Only errors,
 * and warnings under `--strict`, fail here. Same reasoning as `agent doctor`.
 */
export function importHasFindings(diagnostics: AgentDiagnostic[], strict: boolean): boolean {
  return diagnostics.some(
    (item) => item.severity === "error" || (strict && item.severity === "warning"),
  );
}

function counts(provenance: ImportProvenance[]): Record<Disposition, number> {
  const totals: Record<Disposition, number> = {
    portable: 0,
    native: 0,
    manifest: 0,
    dropped: 0,
  };
  for (const entry of provenance) totals[entry.layer] += 1;
  return totals;
}

export async function agentImportAction(source: string, opts: AgentImportOptions): Promise<void> {
  if (opts.check && opts.dryRun) throw new Error("--check and --dry-run cannot be used together");
  if (!opts.output) throw new Error("--output is required");
  const merge = (opts.merge ?? "refuse") as MergeStrategy;
  if (!MERGE_STRATEGIES.includes(merge))
    throw new Error(`Unknown --merge '${merge}'. Use one of: ${MERGE_STRATEGIES.join(", ")}.`);

  const root = path.resolve(source);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory())
    throw new Error(`Source is not a directory: ${source}`);
  const output = path.resolve(opts.output);
  if (isInside(fs.realpathSync(root), resolveThroughExistingAncestors(output)))
    throw new Error("Output directory must not be inside the import source");

  const files = walk(root);
  const layout = resolveLayout(root, files, opts.from, opts.scope);
  const bundleName = opts.bundleName ?? path.basename(root);
  const result = normalizeTree(
    files,
    layout.target,
    layout.profile,
    bundleName,
    Boolean(opts.nativeOnly) || merge === "native-only",
  );
  const diagnostics: AgentDiagnostic[] = [...result.diagnostics];

  // Every input file must appear in the report exactly once. Anything else
  // means the importer silently lost a file.
  const accounted = new Set(result.provenance.map((entry) => entry.source));
  for (const file of files) {
    const relative = file.path.split(path.sep).join("/");
    if (!accounted.has(relative))
      result.provenance.push({
        source: relative,
        destination: null,
        layer: "dropped",
        fidelity: "unsupported",
        note: "not claimed by any importer",
      });
  }
  result.provenance.sort((a, b) => (a.source < b.source ? -1 : 1));

  let artifacts: Artifact[] = result.artifacts;
  if (merge === "native-only")
    artifacts = artifacts.filter((artifact) => artifact.path.startsWith("native/"));

  if (nonempty(output)) {
    if (merge === "refuse")
      diagnostics.push(
        error(
          "AB236",
          `Destination is nonempty: ${output}`,
          `Choose a merge strategy: --merge ${MERGE_STRATEGIES.filter((s) => s !== "refuse").join(", ")}.`,
        ),
      );
    if (merge === "skip-existing") {
      const kept: Artifact[] = [];
      for (const artifact of artifacts) {
        if (fs.existsSync(path.join(output, artifact.path))) {
          const entry = result.provenance.find((item) => item.destination === artifact.path);
          if (entry) entry.note = "skipped; already present in the destination";
          continue;
        }
        kept.push(artifact);
      }
      artifacts = kept;
    }
    if (merge === "overwrite")
      for (const artifact of artifacts)
        if (fs.existsSync(path.join(output, artifact.path)))
          diagnostics.push(
            diagnostic("AB237", `Replaced existing file '${artifact.path}'`, "approximate", {
              path: artifact.path,
            }),
          );
  }

  const report: ImportReport = {
    from: {
      target: layout.target,
      profile: layout.profile,
      requested: opts.from ?? "auto",
      confidence: layout.confidence,
    },
    merge,
    files: result.provenance,
    counts: counts(result.provenance),
  };
  // No timestamp: the report must change only when the input or the generator
  // does, so importing the same source twice stays byte-identical.
  const reportArtifact: Artifact = {
    path: IMPORT_REPORT,
    content: Buffer.from(
      JSON.stringify(
        { generator: { name: packageName, version: packageVersion }, ...report },
        null,
        2,
      ) + "\n",
    ),
    mode: 0o644,
  };
  const all = [...artifacts, reportArtifact];

  const blocked = importHasFindings(diagnostics, Boolean(opts.strict));
  const stale = opts.check ? !matchesOutput(output, all) : false;
  const readOnly = Boolean(opts.dryRun) || Boolean(opts.check);
  if (!readOnly && !blocked)
    writeArtifactsAtomically(output, all, {
      managedRoots: [],
      looseFiles: all.map((artifact) => artifact.path),
      force: true,
    });

  outputDecidedResult(
    {
      command: "import",
      ok: !blocked && !stale,
      source: root,
      targets: [layout.target],
      profiles: [layout.profile],
      artifacts: all.map((artifact) => ({
        path: artifact.path,
        bytes: artifact.content.length,
        mode: `0${artifact.mode.toString(8)}`,
      })),
      diagnostics,
      import: report,
      ...(opts.dryRun ? { dryRun: true } : {}),
      ...(opts.check ? { check: true, stale } : {}),
    } satisfies AgentResult,
    opts,
  );
}

/**
 * Compares a previously imported tree against what this run would produce.
 *
 * The report is compared by existence only, exactly as `diffOutput` treats
 * `conversion-report.json`: it embeds the generator version, so byte-comparing
 * it would report every tree as stale after any CLI upgrade.
 */
function matchesOutput(output: string, artifacts: Artifact[]): boolean {
  for (const artifact of artifacts) {
    const file = path.join(output, artifact.path);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    if (artifact.path === IMPORT_REPORT) continue;
    if (!fs.readFileSync(file).equals(artifact.content)) return false;
  }
  return true;
}
