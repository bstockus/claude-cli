import fs from "node:fs";
import path from "node:path";
import { parseMarkdown, extractCodeBlocks } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";

interface CodeBlocksOptions {
  format: string;
  lang?: string;
  content: boolean;
}

function resolveFormat(opts: CodeBlocksOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

export async function codeBlocksAction(file: string, opts: CodeBlocksOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const tree = parseMarkdown(content);
  let blocks = extractCodeBlocks(tree);

  if (opts.lang) {
    blocks = blocks.filter((b) => b.lang === opts.lang);
  }

  if (format === "json") {
    const output = blocks.map((b) => ({
      line: b.line,
      endLine: b.endLine,
      lang: b.lang,
      lines: b.endLine - b.line + 1,
      ...(opts.content ? { content: b.value } : {}),
    }));
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    return;
  }

  if (blocks.length === 0) {
    if (format === "human") {
      process.stdout.write(`\x1b[33mNo code blocks found in ${filePath}\x1b[0m\n`);
    } else {
      process.stdout.write(`No code blocks found in ${filePath}\n`);
    }
    return;
  }

  const lines: string[] = [];
  const isHuman = format === "human";

  if (isHuman) {
    lines.push(`\n\x1b[1m${blocks.length} code block(s) in ${filePath}\x1b[0m\n`);
  } else {
    lines.push(`${blocks.length} code block(s) in ${filePath}:`);
  }

  for (const b of blocks) {
    const lineCount = b.endLine - b.line + 1;
    const lang = b.lang ?? "(none)";
    if (isHuman) {
      lines.push(
        `  \x1b[36mL${b.line}-L${b.endLine}\x1b[0m  \x1b[33m${lang}\x1b[0m  (${lineCount} lines)`,
      );
    } else {
      lines.push(`  L${b.line}-L${b.endLine}  ${lang}  (${lineCount} lines)`);
    }

    if (opts.content) {
      const contentLines = b.value.split("\n");
      for (const cl of contentLines) {
        lines.push(`    ${cl}`);
      }
      lines.push("");
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}
