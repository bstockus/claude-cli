import { minimatch } from "minimatch";
import path from "node:path";
import type { PlannedEdit } from "../edit-plan.js";
import { renderToc, synchronizeToc, TOC_START } from "../toc.js";
import { runtime } from "../runtime.js";
import type { Fixer, FixerContext, FixerResult, UnfixableFinding } from "./registry.js";

/** 1-based line containing `offset`. */
function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < content.length; index++) {
    if (content[index] === "\n") line++;
  }
  return line;
}

/**
 * Whether this document is one the project asks to keep a TOC in.
 *
 * With `toc.files` configured the globs decide, matching `md audit`. Without
 * it, only documents that already carry a marker pair are considered — `md fix`
 * never decides on its own that a document should gain a table of contents.
 */
function selected(file: string, content: string): boolean {
  const patterns = runtime().config.toc.files;
  if (!patterns.length) return content.includes(TOC_START);
  const relative = path.relative(runtime().config.root, file).split(path.sep).join("/");
  return patterns.some((pattern) => minimatch(relative, pattern, { dot: true, nonegate: true }));
}

export const tocFixer: Fixer = {
  name: "toc",
  description: "Synchronize the generated block between TOC markers",
  network: false,

  plan(files: readonly string[], context: FixerContext): Promise<FixerResult> {
    const edits: PlannedEdit[] = [];
    const unfixable: UnfixableFinding[] = [];

    for (const file of files) {
      const snapshot = context.snapshot(file);
      if (!selected(file, snapshot.content)) continue;

      const document = runtime().workspace.document(file);
      // Ranges address the snapshot's bytes while headings come from the
      // workspace cache. If those ever disagree the offsets are meaningless,
      // so the file is skipped rather than edited from stale structure.
      if (document.content !== snapshot.content) {
        unfixable.push({
          file,
          line: 1,
          rule: "toc",
          message: "Document changed while it was being planned",
          reason: "stale workspace cache",
        });
        continue;
      }

      const maxDepth = Math.min(6, Math.max(1, parseInt(context.toc.maxDepth, 10) || 6));
      const minDepth = Math.min(6, Math.max(1, parseInt(context.toc.minDepth, 10) || 1));
      const headings = document.headings.filter(
        (heading) => heading.depth >= minDepth && heading.depth <= maxDepth,
      );
      const sync = synchronizeToc(snapshot.content, renderToc(headings, context.toc.ordered));

      // Inserting markers is an authoring decision, not a fix.
      if (sync.status === "missing") continue;
      if (sync.status === "malformed") {
        // A throw would let one bad document kill a whole-tree run.
        unfixable.push({
          file,
          line: 1,
          rule: "toc",
          message: sync.message,
          reason: "malformed markers",
        });
        continue;
      }
      if (sync.status === "current") continue;

      edits.push({
        file,
        start: sync.range.start,
        end: sync.range.end,
        expected: snapshot.content.slice(sync.range.start, sync.range.end),
        replacement: sync.interior,
        value: sync.interior,
        diagnostic: {
          rule: "toc",
          line: lineAt(snapshot.content, sync.range.start),
          message: "Generated TOC is stale",
        },
      });
    }

    return Promise.resolve({ edits, unfixable });
  },
};
