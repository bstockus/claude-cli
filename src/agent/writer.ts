import fs from "node:fs";
import path from "node:path";
import type { Artifact } from "./types.js";

export interface WriteOptions {
  /**
   * Directories, relative to the output root, that this write owns entirely.
   * Each is replaced wholesale, so a component removed from the source stops
   * existing in the output instead of lingering as an orphan.
   */
  managedRoots: string[];
  /** Artifacts at the output root that are replaced individually, not by directory. */
  looseFiles?: string[];
  /** Replace a nonempty managed root instead of refusing. */
  force: boolean;
}

function nonempty(directory: string): boolean {
  if (!fs.existsSync(directory)) return false;
  return !fs.statSync(directory).isDirectory() || fs.readdirSync(directory).length > 0;
}

/**
 * Writes every artifact under `root` through a staging directory.
 *
 * The staging directory is a sibling of the output root rather than a temp
 * directory, so it is on the same filesystem and the final `rename` is atomic.
 * Nothing is visible at the destination until every artifact has been written
 * successfully.
 */
export function writeArtifactsAtomically(
  root: string,
  artifacts: Artifact[],
  options: WriteOptions,
): void {
  for (const managed of options.managedRoots) {
    const destination = path.join(root, managed);
    if (nonempty(destination) && !options.force)
      throw new Error(`Destination is nonempty: ${destination} (use --force)`);
  }
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, `.${path.basename(root)}.staging-`));
  try {
    for (const artifact of artifacts) {
      const destination = path.join(staging, artifact.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, artifact.content, { mode: artifact.mode });
      fs.chmodSync(destination, artifact.mode);
    }
    fs.mkdirSync(root, { recursive: true });
    for (const managed of options.managedRoots) {
      const destination = path.join(root, managed);
      const staged = path.join(staging, managed);
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (fs.existsSync(staged)) fs.renameSync(staged, destination);
      else fs.mkdirSync(destination, { recursive: true });
    }
    for (const loose of options.looseFiles ?? []) {
      const destination = path.join(root, loose);
      const staged = path.join(staging, loose);
      if (!fs.existsSync(staged)) continue;
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(staged, destination);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
