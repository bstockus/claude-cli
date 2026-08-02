import fs from "node:fs";
import type { Issue } from "../types.js";
import { extractReferences } from "../refs.js";
import { parseMarkdown, extractHeadings, type Root } from "../markdown-ast.js";
import { splitLocalTarget, resolveLocalPath } from "../link-target.js";
import { runtime } from "../runtime.js";

function checkAnchor(
  sourceFile: string,
  targetContent: string | Root,
  lineNum: number,
  anchor: string,
  issues: Issue[],
): void {
  const tree = typeof targetContent === "string" ? parseMarkdown(targetContent) : targetContent;
  const headingSlugs = new Set(extractHeadings(tree).map((h) => h.slug));

  if (!headingSlugs.has(anchor)) {
    issues.push({
      file: sourceFile,
      line: lineNum,
      checker: "ref/anchor",
      message: `Heading anchor not found: #${anchor}`,
    });
  }
}

export function checkReferences(
  filePath: string,
  content: string,
  issues: Issue[],
  tree?: Root,
): void {
  const parsedTree = tree ?? parseMarkdown(content);
  const refs = extractReferences(parsedTree);

  for (const ref of refs) {
    if (ref.isExternal) continue;

    if (ref.isAnchorOnly) {
      const target = splitLocalTarget(ref.target);
      checkAnchor(filePath, parsedTree, ref.line, target.fragment ?? "", issues);
      continue;
    }

    const target = splitLocalTarget(ref.target);
    const targetFile = target.path;
    const anchor = target.fragment;

    if (targetFile) {
      const resolvedPath = resolveLocalPath(filePath, targetFile, runtime().config.root);
      if (!fs.existsSync(resolvedPath)) {
        issues.push({
          file: filePath,
          line: ref.line,
          checker: ref.isImage ? "ref/image" : "ref/link",
          message: `${ref.isImage ? "Image" : "Link"} target not found: ${targetFile}`,
        });
        continue;
      }

      if (anchor) {
        try {
          const targetDocument = runtime().workspace.document(resolvedPath);
          checkAnchor(filePath, targetDocument.tree, ref.line, anchor, issues);
        } catch {
          continue;
        }
      }
    }
  }
}
