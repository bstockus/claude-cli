import type { FileSnapshot, PlannedEdit } from "../edit-plan.js";
import { markdownlintFixer } from "./markdownlint-fixer.js";
import { relativeLinksFixer } from "./relative-links-fixer.js";
import { tocFixer } from "./toc-fixer.js";

/** A finding a fixer recognized but deliberately did not act on. */
export interface UnfixableFinding {
  file: string;
  line: number;
  rule: string;
  message: string;
  /** Why no edit was produced, e.g. "malformed markers". */
  reason: string;
}

export interface FixerResult {
  edits: PlannedEdit[];
  unfixable: UnfixableFinding[];
}

export interface FixerContext {
  root: string;
  /** Memoized per run; the single source of truth for content and fingerprint. */
  snapshot: (file: string) => FileSnapshot;
  /** TOC generation settings, taken from the project's `md toc` defaults. */
  toc: { maxDepth: string; minDepth: string; ordered: boolean };
}

export interface Fixer {
  name: string;
  description: string;
  /** True when the fixer performs network I/O. */
  network: boolean;
  plan(files: readonly string[], context: FixerContext): Promise<FixerResult>;
}

export const FIXERS: readonly Fixer[] = [markdownlintFixer, relativeLinksFixer, tocFixer];

/**
 * Resolves `--rule` names, defaulting to every offline fixer.
 *
 * An unknown name is a usage error rather than a silent no-op, so
 * `md fix --rule typo --check` can never exit 0 and look like a pass.
 */
export function selectFixers(names: readonly string[]): Fixer[] {
  if (!names.length) return FIXERS.filter((fixer) => !fixer.network);
  const available = FIXERS.map((fixer) => fixer.name).join(", ");
  return names.map((name) => {
    const fixer = FIXERS.find((candidate) => candidate.name === name);
    if (!fixer) throw new Error(`Unknown rule: ${name}. Available rules: ${available}`);
    return fixer;
  });
}
