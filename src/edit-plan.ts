import fs from "node:fs";
import path from "node:path";

/**
 * A replacement of `[start, end)` with `value`.
 *
 * Offsets are UTF-16 code-unit indices into the utf-8-decoded file — exactly what
 * `content.slice(start, end)` uses, and the same unit mdast positions and
 * `MdLink.destinationStart` already carry. They are not byte offsets.
 */
export interface TextEdit {
  start: number;
  /** Exclusive. `start === end` is a pure insertion. */
  end: number;
  value: string;
}

/**
 * Applies edits back to front so earlier offsets stay valid.
 *
 * Overlapping edits are not detected here; the caller owns that, because the
 * right response depends on whether the overlap is a planner bug or a genuine
 * collision between two rules.
 */
export function applyEdits(content: string, edits: readonly TextEdit[]): string {
  let result = content;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  }
  return result;
}

/**
 * An unused path beside `file`, for staging a write that is committed by rename.
 *
 * A sibling rather than a temp directory so the rename stays within one
 * filesystem and is therefore atomic.
 */
export function temporarySibling(file: string): string {
  for (let index = 0; index < 100; index++) {
    const candidate = path.join(
      path.dirname(file),
      `.${path.basename(file)}.claude-cli-${process.pid}-${index}.tmp`,
    );
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate temporary file beside ${file}`);
}
