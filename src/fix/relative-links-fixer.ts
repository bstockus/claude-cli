import path from "node:path";
import { extractLinks, parseMarkdown } from "../markdown-ast.js";
import {
  composeTarget,
  escapeTargetParens,
  resolveLocalPath,
  splitLocalTarget,
  targetStyle,
} from "../link-target.js";
import type { PlannedEdit } from "../edit-plan.js";
import type { Fixer, FixerContext, FixerResult } from "./registry.js";

/** A target naming another protocol, which is never a workspace path. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Respells a local target so it resolves to exactly the same absolute path.
 *
 * Deliberately narrow, so the result is deterministic, idempotent, and causes
 * no churn on a first run over an existing repository:
 *
 * - the path is recomputed in the original's own addressing mode, which is what
 *   normalizes `a/../b.md`, `.//b.md`, and `docs/./api.md`;
 * - a `./` prefix is preserved, never added and never removed — which of the
 *   two spellings is "canonical" is a style opinion, and flipping it would
 *   rewrite every link in a repository;
 * - percent-encoding is preserved, never introduced. Encoding a link that
 *   already renders is churn, and `encodeURI` double-encodes a literal `%`;
 * - backslash separators become `/`, which is a real correctness fix;
 * - query and fragment are preserved byte for byte.
 *
 * Returns undefined when the target is already canonical.
 */
export function canonicalLocalTarget(
  rawTarget: string,
  sourceFile: string,
  root: string,
): string | undefined {
  const split = splitLocalTarget(rawTarget);
  if (!split.path) return undefined;

  const style = targetStyle(rawTarget);
  const forwardSlashed = split.path.split("\\").join("/");
  const absolute = resolveLocalPath(sourceFile, forwardSlashed, root);

  let nextPath: string;
  if (style.rootRelative) {
    nextPath = `/${path.relative(root, absolute).split(path.sep).join("/")}`;
  } else {
    nextPath = path.relative(path.dirname(sourceFile), absolute).split(path.sep).join("/");
    if (!nextPath) nextPath = path.basename(absolute);
  }

  const next = composeTarget(nextPath, split, style);
  return next === rawTarget ? undefined : next;
}

export const relativeLinksFixer: Fixer = {
  name: "relative-links",
  description: "Normalize local link paths without changing what they point at",
  network: false,

  plan(files: readonly string[], context: FixerContext): Promise<FixerResult> {
    const edits: PlannedEdit[] = [];

    for (const file of files) {
      const snapshot = context.snapshot(file);
      const content = snapshot.content;
      // Several links can share one reference definition, so a destination span
      // must only be edited once.
      const seen = new Set<string>();

      for (const link of extractLinks(parseMarkdown(content), content)) {
        if (link.isExternal || link.isAnchorOnly) continue;
        if (link.destinationStart === undefined || link.destinationEnd === undefined) continue;
        if (SCHEME.test(link.target)) continue;

        const raw = content.slice(link.destinationStart, link.destinationEnd);
        // Where the source text and the parsed target diverge the offsets do not
        // delimit a plain target and there is nothing safe to rewrite. Escaped
        // parentheses are the one legitimate divergence: the span is still
        // exactly the target, just written with backslashes, and the escaping is
        // restored on output.
        if (raw.replace(/\\([()])/g, "$1") !== link.target) continue;

        const key = `${link.destinationStart}:${link.destinationEnd}`;
        if (seen.has(key)) continue;

        const next = canonicalLocalTarget(link.target, file, context.root);
        if (!next) continue;
        seen.add(key);

        edits.push({
          file,
          start: link.destinationStart,
          end: link.destinationEnd,
          expected: raw,
          replacement: escapeTargetParens(next, targetStyle(link.target, raw)),
          value: escapeTargetParens(next, targetStyle(link.target, raw)),
          diagnostic: {
            rule: "relative-links",
            line: link.destinationLine,
            message: `Link path is not canonical: ${raw} -> ${next}`,
          },
        });
      }
    }

    return Promise.resolve({ edits, unfixable: [] });
  },
};
