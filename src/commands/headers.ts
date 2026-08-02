import fs from "node:fs";
import path from "node:path";
import { parseMarkdown, extractHeadings } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";

interface HeadersOptions {
  format: string;
  maxDepth: string;
}

function resolveFormat(opts: HeadersOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

export async function headersAction(file: string, opts: HeadersOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = path.resolve(file);
  const maxDepth = Math.min(6, Math.max(1, parseInt(opts.maxDepth, 10) || 6));

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const tree = parseMarkdown(content);
  const headings = extractHeadings(tree).filter((h) => h.depth <= maxDepth);

  if (format === "json") {
    process.stdout.write(JSON.stringify(headings, null, 2) + "\n");
    return;
  }

  if (headings.length === 0) {
    if (format === "human") {
      process.stdout.write(`\x1b[33mNo headings found in ${filePath}\x1b[0m\n`);
    } else {
      process.stdout.write(`No headings found in ${filePath}\n`);
    }
    return;
  }

  const lines: string[] = [];

  if (format === "human") {
    lines.push(`\n\x1b[1m${headings.length} heading(s) in ${filePath}\x1b[0m\n`);
    for (const h of headings) {
      const prefix = "#".repeat(h.depth);
      lines.push(`  \x1b[36mL${h.line}\x1b[0m  \x1b[33m${prefix}\x1b[0m ${h.text}`);
    }
  } else {
    lines.push(`${headings.length} heading(s) in ${filePath}:`);
    for (const h of headings) {
      const prefix = "#".repeat(h.depth);
      lines.push(`  L${h.line}  ${prefix} ${h.text}`);
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}
