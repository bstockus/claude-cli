import { extractCodeBlocks, parseMarkdown } from "../markdown-ast.js";
import { createSourceReader, snippetEdits, synchronizeSnippets } from "../snippets.js";
import { runtime } from "../runtime.js";
import type { PlannedEdit } from "../edit-plan.js";
import type { Fixer, FixerContext, FixerResult, UnfixableFinding } from "./registry.js";

export const snippetsFixer: Fixer = {
  name: "snippets",
  description: "Refresh fenced blocks that declare a source file and region",
  network: false,
  // Opt-in: `md fix --write` with no --rule runs every default fixer, and that
  // command must not silently start reading arbitrary source files and
  // rewriting documentation bodies from them. `md check-snippets` is the
  // command that does this by default.
  default: false,

  plan(files: readonly string[], context: FixerContext): Promise<FixerResult> {
    const edits: PlannedEdit[] = [];
    const unfixable: UnfixableFinding[] = [];
    // Deliberately not `context.root`. That is the containment root for
    // *writes*, which for `md fix docs` is docs/ and would reject every source
    // under src/. Reads are bounded by the workspace instead.
    const readRoot = runtime().config.root;
    const read = createSourceReader(readRoot);

    for (const file of files) {
      const snapshot = context.snapshot(file);
      const document = runtime().workspace.document(file);
      // Offsets address the snapshot's bytes, so the cached tree is only safe
      // to reuse when it was parsed from exactly those bytes.
      const blocks =
        document.content === snapshot.content
          ? extractCodeBlocks(document.tree)
          : extractCodeBlocks(parseMarkdown(snapshot.content));

      const results = synchronizeSnippets(snapshot.content, blocks, {
        file,
        root: readRoot,
        read,
      });
      edits.push(...snippetEdits(file, snapshot.content, results));

      for (const result of results) {
        if (result.status === "current") continue;
        if (result.status === "stale") {
          // A stale block with a write plan is handled by the edit; only one
          // the fence cannot accept is reported here.
          if (result.write) continue;
          unfixable.push({
            file,
            line: result.line,
            rule: "snippets",
            message: `Snippet is out of date with ${result.target}`,
            reason: result.unwritable!.reason,
          });
          continue;
        }
        unfixable.push({
          file,
          line: result.line,
          rule: "snippets",
          message: result.message,
          reason: result.reason,
        });
      }
    }

    return Promise.resolve({ edits, unfixable });
  },
};
