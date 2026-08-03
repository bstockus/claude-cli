import {
  loadMarkdownlintConfig,
  lintContent,
  type MarkdownlintError,
  type MarkdownlintFixInfo,
} from "../checkers/markdown-lint.js";
import { runtime } from "../runtime.js";
import type { PlannedEdit } from "../edit-plan.js";
import type { Fixer, FixerContext, FixerResult } from "./registry.js";

/**
 * Rules whose fixes are unambiguous.
 *
 * Every entry is whitespace- or punctuation-local and rewrites at most one span
 * per line. Rules excluded despite offering a fix, with the reason:
 *
 * - MD004, MD029, MD035, MD048, MD049, MD050 — config-dependent *style*
 *   choices that rewrite prose markers to match a preference.
 * - MD044 — substring replacement inside prose.
 * - MD005, MD007 — list indentation, where fixes interact across lines.
 * - MD034 — turning a bare URL into an autolink changes how it renders.
 */
export const ALLOWED_RULES = new Set([
  "MD009", // Trailing spaces
  "MD010", // Hard tabs
  "MD012", // Multiple consecutive blank lines
  "MD018", // No space after hash on ATX heading
  "MD019", // Multiple spaces after hash on ATX heading
  "MD020", // No space inside hashes on closed ATX heading
  "MD021", // Multiple spaces inside hashes on closed ATX heading
  "MD023", // Headings must start at the beginning of the line
  "MD027", // Multiple spaces after blockquote symbol
  "MD030", // Spaces after list markers
  "MD037", // Spaces inside emphasis markers
  "MD038", // Spaces inside code span elements
  "MD039", // Spaces inside link text
  "MD047", // Files should end with a single newline
]);

/** Offset of the start of every line. */
function lineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

export interface FixRange {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Maps one `fixInfo` onto an offset range.
 *
 * Three details a naive translation gets wrong, all of which markdownlint's own
 * `applyFix` handles: `deleteCount === -1` removes the whole line *including*
 * its terminator; `editColumn` and `deleteCount` index the line with its
 * terminator stripped, so a range must never cross that bound; and `insertText`
 * may contain newlines, which have to be written in the file's own line ending.
 *
 * Returns undefined when the fix cannot be mapped, in which case it is skipped
 * rather than guessed at.
 */
export function fixInfoRange(
  content: string,
  starts: readonly number[],
  errorLine: number,
  info: MarkdownlintFixInfo,
  eol: string,
): FixRange | undefined {
  const lineNumber = info.lineNumber ?? errorLine;
  const base = starts[lineNumber - 1];
  if (base === undefined) return undefined;

  const lineEnd = starts[lineNumber] ?? content.length;
  if (info.deleteCount === -1) return { start: base, end: lineEnd, replacement: "" };

  const terminator = /\r?\n$/.exec(content.slice(base, lineEnd))?.[0].length ?? 0;
  const textEnd = lineEnd - terminator;
  const start = base + (info.editColumn ?? 1) - 1;
  const end = start + (info.deleteCount ?? 0);
  if (start < base || start > textEnd || end > textEnd) return undefined;

  return { start, end, replacement: (info.insertText ?? "").replace(/\n/g, eol) };
}

/** markdownlint's own de-duplication: identical fixes on a line collapse to one. */
function distinct(errors: readonly MarkdownlintError[]): MarkdownlintError[] {
  const seen = new Set<string>();
  const kept: MarkdownlintError[] = [];
  for (const error of errors) {
    const info = error.fixInfo;
    if (!info) continue;
    const key = [
      info.lineNumber ?? error.lineNumber,
      info.editColumn ?? "",
      info.deleteCount ?? "",
      info.insertText ?? "",
    ].join("\0");
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(error);
  }
  return kept;
}

export const markdownlintFixer: Fixer = {
  name: "markdownlint",
  description: "Apply markdownlint fixes for rules with an unambiguous repair",
  network: false,
  default: true,

  async plan(files: readonly string[], context: FixerContext): Promise<FixerResult> {
    const config = await loadMarkdownlintConfig(runtime().config.markdownlint.config);
    const edits: PlannedEdit[] = [];

    for (const file of files) {
      const snapshot = context.snapshot(file);
      const content = snapshot.content;
      const eol = content.includes("\r\n") ? "\r\n" : "\n";
      const starts = lineStarts(content);

      const errors = distinct(await lintContent(file, content, config)).filter((error) =>
        ALLOWED_RULES.has(error.ruleNames[0]),
      );

      for (const error of errors) {
        const range = fixInfoRange(content, starts, error.lineNumber, error.fixInfo!, eol);
        if (!range) continue;
        edits.push({
          file,
          start: range.start,
          end: range.end,
          expected: content.slice(range.start, range.end),
          replacement: range.replacement,
          value: range.replacement,
          diagnostic: {
            rule: `markdownlint/${error.ruleNames[0]}`,
            line: error.lineNumber,
            message: `${error.ruleDescription}${error.errorDetail ? `: ${error.errorDetail}` : ""}`,
          },
        });
      }
    }

    return { edits, unfixable: [] };
  },
};
