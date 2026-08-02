import fs from "node:fs";
import path from "node:path";
import type { Issue } from "./types.js";
import { parseMarkdown } from "./markdown-ast.js";
import { checkMarkdownLint } from "./checkers/markdown-lint.js";
import { checkMermaid } from "./checkers/mermaid.js";
import { checkKatex } from "./checkers/katex.js";
import { checkReferences } from "./checkers/references.js";

export interface LintFileOptions {
  style?: boolean;
}

export async function lintFile(filePath: string, options: LintFileOptions = {}): Promise<Issue[]> {
  const content = fs.readFileSync(filePath, "utf-8");
  const tree = parseMarkdown(content);
  const issues: Issue[] = [];
  if (options.style) {
    await checkMarkdownLint(filePath, content, issues);
  }
  await checkMermaid(filePath, content, issues, tree);
  checkKatex(filePath, content, issues, tree);
  checkReferences(filePath, content, issues, tree);
  return issues;
}

export function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results.sort();
}
