import fs from "node:fs";
import path from "node:path";
import type { AgentProfile, AgentTarget, Artifact } from "./types.js";

/** File name of the report `agent convert` writes at the output root. */
export const CONVERSION_REPORT = "conversion-report.json";

/**
 * Provenance recorded in the conversion report so `agent doctor` can tell a
 * tree generated against an older target profile from a current one.
 */
export interface ConversionProvenance {
  generator: { name: string; version: string };
  profileSchemaVersion: string;
  targetProfiles: Record<string, { documentationRevision: string }>;
}

export interface OutputDiff {
  /** Expected artifacts absent from the tree, or present but not a regular file. */
  missing: string[];
  /** Expected artifacts whose bytes or mode differ. */
  changed: string[];
  /** Files inside a rendered target/profile root that no artifact accounts for. */
  unmanaged: string[];
}

function walk(directory: string, onFile: (file: string) => void): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

/**
 * Compares a generated tree against the artifacts that should produce it.
 *
 * The conversion report is compared by existence only. It embeds the generator
 * version and target profile revisions, so byte-comparing it would report every
 * tree as stale after any CLI upgrade — and it is derived from artifacts that
 * are already compared byte for byte.
 */
export function diffOutput(
  output: string,
  artifacts: Artifact[],
  targets: AgentTarget[],
  profiles: AgentProfile[],
): OutputDiff {
  const diff: OutputDiff = { missing: [], changed: [], unmanaged: [] };
  const expected = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
  for (const artifact of artifacts) {
    const file = path.join(output, artifact.path);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      diff.missing.push(artifact.path);
      continue;
    }
    if (artifact.path === CONVERSION_REPORT) continue;
    if (
      !fs.readFileSync(file).equals(artifact.content) ||
      (fs.statSync(file).mode & 0o777) !== artifact.mode
    )
      diff.changed.push(artifact.path);
  }
  for (const target of targets)
    for (const profile of profiles) {
      const root = path.join(output, target, profile);
      if (!fs.existsSync(root)) {
        diff.missing.push(`${target}/${profile}`);
        continue;
      }
      walk(root, (file) => {
        const relative = path.relative(output, file).split(path.sep).join("/");
        if (!expected.has(relative)) diff.unmanaged.push(relative);
      });
    }
  return diff;
}

/** True when the generated tree matches the artifacts exactly. */
export function outputMatches(diff: OutputDiff): boolean {
  return !diff.missing.length && !diff.changed.length && !diff.unmanaged.length;
}
