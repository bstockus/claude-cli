import fs from "node:fs";
import path from "node:path";
import type { Issue } from "../types.js";
import { extractReferences } from "../refs.js";
import { parseMarkdown, extractHeadings, type Root } from "../markdown-ast.js";

function checkAnchor(
  sourceFile: string,
  targetContent: string | Root,
  lineNum: number,
  anchor: string,
  issues: Issue[],
): void {
  const tree = typeof targetContent === "string" ? parseMarkdown(targetContent) : targetContent;
  const headingSlugs = new Set(extractHeadings(tree).map((h) => h.slug));

  if (!headingSlugs.has(anchor.toLowerCase())) {
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
  const dir = path.dirname(filePath);
  const parsedTree = tree ?? parseMarkdown(content);
  const refs = extractReferences(parsedTree);

  for (const ref of refs) {
    if (ref.isExternal) continue;

    if (ref.isAnchorOnly) {
      checkAnchor(filePath, parsedTree, ref.line, ref.target.substring(1), issues);
      continue;
    }

    const [targetFile, anchor] = ref.target.split("#", 2);

    if (targetFile) {
      const resolvedPath = path.resolve(dir, targetFile);
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
        let targetContent: string;
        try {
          targetContent = fs.readFileSync(resolvedPath, "utf-8");
        } catch {
          continue;
        }
        checkAnchor(filePath, targetContent, ref.line, anchor, issues);
      }
    }
  }
}
