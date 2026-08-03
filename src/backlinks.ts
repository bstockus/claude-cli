import { resolveLocalPath, splitLocalTarget } from "./link-target.js";
import { runtime } from "./runtime.js";

export interface IncomingReference {
  sourceFile: string;
  line: number;
  linkText: string;
  rawTarget: string;
  /** The reference's `#fragment`, decoded, when it carried one. */
  fragment?: string;
}

/**
 * Every local reference in `files` that resolves to `targetPath`.
 *
 * Paths are absolute on both sides; callers map them for display. External and
 * anchor-only references are skipped, matching the workspace graph.
 */
export function documentsReferencing(
  files: readonly string[],
  targetPath: string,
): IncomingReference[] {
  const root = runtime().config.root;
  const found: IncomingReference[] = [];
  for (const file of files) {
    for (const reference of runtime().workspace.document(file).references) {
      if (reference.isExternal || reference.isAnchorOnly) continue;
      const parsed = splitLocalTarget(reference.target);
      if (resolveLocalPath(file, parsed.path, root) !== targetPath) continue;
      found.push({
        sourceFile: file,
        line: reference.line,
        linkText: reference.linkText,
        rawTarget: reference.target,
        ...(parsed.fragment === undefined ? {} : { fragment: parsed.fragment }),
      });
    }
  }
  return found;
}
